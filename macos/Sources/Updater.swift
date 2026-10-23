// Samoaktualizacja: co 6 godzin (i 20 s po starcie) pyta Task Hub (GET /api/bridge/app z tokenem mostka) o najnowsze
// wydanie app-v…, pobiera archiwum .zip z aplikacją (pobrane przez aplikację nie dostaje kwarantanny, więc Gatekeeper nie pyta),
// sprawdza sumę SHA-256, podmienia /Applications/Task Hub.app (stara wersja ląduje w Koszu) i uruchamia aplikację ponownie,
// gdy nic nie przerywa: okna zamknięte, mostek nie pracuje. Bez prawa zapisu w /Applications otwiera instalator .pkg (poprosi o hasło).
// Publiczny GitHub tylko wtedy, gdy Task Hub nie zna jeszcze tej ścieżki (404, starszy serwer), sam nie dostał wydań z GitHub (502)
// albo aplikacja nie jest połączona.
import AppKit
import CryptoKit

enum UpdateError: LocalizedError {
    case bad(String)
    var errorDescription: String? { if case .bad(let s) = self { return s }; return nil }
}

// token mostka tylko do Task Hub: przekierowanie na inny host (np. plik z GitHuba) idzie już bez nagłówka Authorization
final class DropAuthOnRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let host: String
    init(host: String) { self.host = host }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
        var r = request
        let keep = !host.isEmpty && r.url.map { Store.hostKey($0) == host && Updater.webURL($0) } == true
        if !keep { r.setValue(nil, forHTTPHeaderField: "Authorization") }
        return r
    }
}

@MainActor
final class Updater: ObservableObject {
    static let api = "https://api.github.com/repos/piotr-bialobrzeski-wrx/taskhub/releases/latest"
    static let interval: TimeInterval = 6 * 3600

    // jeden plik wydania: adres pobrania i (gdy jest) suma SHA-256
    struct Asset {
        var url: URL
        var sha256: String?
    }

    @Published private(set) var status = ""
    @Published private(set) var available: String? = nil   // nowsza wersja w wydaniach
    @Published private(set) var ready: String? = nil       // zainstalowana, czeka na ponowne uruchomienie
    @Published private(set) var lastCheck: Date? = nil
    private var busy = false
    private var timer: Timer? = nil
    private let store: Store
    var canRelaunchQuietly: () -> Bool = { false }
    var askRelaunch: (String) -> Void = { _ in }

    init(store: Store) { self.store = store }

    var currentVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }

    func startSchedule() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: Updater.interval, repeats: true) { [weak self] _ in
            guard let strong = self else { return }
            Task { @MainActor in await strong.check(auto: true) }
        }
        Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 20_000_000_000) } catch {}
            await self?.check(auto: true)
        }
    }

    // porównanie wersji „0.1.2” > „0.1.1”
    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    // suma z odpowiedzi albo z pliku .sha256 („<hex>  <nazwa>”): 64 znaki hex małymi literami, inaczej nil
    nonisolated static func hex(_ s: String?) -> String? {
        guard let first = s?.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" }).first else { return nil }
        let h = first.lowercased()
        return h.count == 64 && h.allSatisfy({ $0.isHexDigit }) ? h : nil
    }

    nonisolated static func sha256(of file: URL) throws -> String {
        let fh = try FileHandle(forReadingFrom: file)
        defer { try? fh.close() }
        var h = SHA256()
        while let chunk = try fh.read(upToCount: 1 << 20), !chunk.isEmpty { h.update(data: chunk) }
        return h.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func check(auto: Bool) async {
        guard !busy else { return }
        if auto && !store.cfg.autoUpdate { return }
        if let r = ready {
            status = "Wersja \(r) czeka na ponowne uruchomienie."
            if auto { maybeRelaunch(r) }
            return
        }
        busy = true
        defer { busy = false }
        status = "Sprawdzam…"
        do {
            let (ver, zip, pkg) = try await latest()
            lastCheck = Date()
            guard Updater.isNewer(ver, than: currentVersion) else {
                available = nil
                status = "Masz najnowszą wersję (\(currentVersion))."
                return
            }
            available = ver
            // nowa wersja już leży w /Applications (instalator zrobił swoje), a działa jeszcze stara: wystarczy ponowne uruchomienie.
            // Bez tego co 6 h otwierał się instalator, który kończył się „nie ma żadnego programu do zainstalowania” (2026-10-22, 0.1.11)
            if let onDisk = installedVersion(), !Updater.isNewer(ver, than: onDisk) {
                ready = onDisk
                status = "Wersja \(onDisk) jest już zainstalowana, zadziała po ponownym uruchomieniu."
                Log.write("aktualizacja: \(onDisk) już zainstalowana (działa \(currentVersion)), czeka na ponowne uruchomienie")
                if auto { maybeRelaunch(onDisk) } else { askRelaunch(onDisk) }
                return
            }
            Log.write("aktualizacja: dostępna \(ver), mam \(currentVersion)")
            try await install(version: ver, zip: zip, pkg: pkg)
        } catch {
            status = "Aktualizacja: \(error.localizedDescription)"
            Log.write(status)
        }
    }

    // ---------- skąd wydanie ----------
    private func latest() async throws -> (String, Asset?, Asset?) {
        if store.configured, let base = URL(string: store.baseURL), let u = URL(string: store.baseURL + "/api/bridge/app") {
            var r = URLRequest(url: u)
            r.timeoutInterval = 20
            r.setValue("Bearer \(store.cfg.token.trimmingCharacters(in: .whitespaces))", forHTTPHeaderField: "Authorization")
            r.setValue("application/json", forHTTPHeaderField: "Accept")
            r.setValue(ClaudeCLI.userAgent, forHTTPHeaderField: "User-Agent")
            let (data, resp) = try await URLSession.shared.data(for: r, delegate: DropAuthOnRedirect(host: Store.hostKey(base) ?? ""))
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            // 502: Task Hub nie dostał odpowiedzi od GitHub (limit zapytań wspólnych adresów serwera), więc pytamy GitHub sami
            if code != 404 && code != 502 {
                if code == 401 { throw UpdateError.bad("Task Hub odrzucił token mostka") }
                guard code == 200, let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let v = j["version"] as? String, !v.isEmpty else { throw UpdateError.bad("Task Hub nie podał wersji (HTTP \(code))") }
                let ver = v.hasPrefix("app-v") ? String(v.dropFirst(5)) : v
                return (ver, asset(j["zip"], base: base), asset(j["pkg"], base: base))
            }
            Log.write(code == 502 ? "aktualizacja: Task Hub nie dostał listy wydań (HTTP 502), pytam GitHub" : "aktualizacja: Task Hub nie zna /api/bridge/app (starszy serwer), pytam GitHub")
        }
        return try await github()
    }

    // {url, sha256?}; adres względny liczony od Task Hub, tylko https (http wyłącznie lokalnie)
    private func asset(_ v: Any?, base: URL) -> Asset? {
        guard let d = v as? [String: Any], let s = d["url"] as? String, !s.isEmpty,
              let u = URL(string: s, relativeTo: base)?.absoluteURL, Updater.webURL(u) else { return nil }
        return Asset(url: u, sha256: Updater.hex(d["sha256"] as? String))
    }

    nonisolated static func webURL(_ u: URL) -> Bool {
        let s = u.scheme?.lowercased()
        return s == "https" || (s == "http" && Store.isLocalHost(u.host?.lowercased()))
    }

    // zapas dla starszego serwera: publiczne API wydań GitHuba (bez tokenu); suma z pliku <nazwa>.sha256, gdy jest w wydaniu
    private func github() async throws -> (String, Asset?, Asset?) {
        guard let api = URL(string: Updater.api) else { throw UpdateError.bad("zły adres GitHuba") }
        var r = URLRequest(url: api)
        r.timeoutInterval = 20
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        r.setValue(ClaudeCLI.userAgent, forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: r)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let tag = j["tag_name"] as? String else { throw UpdateError.bad("GitHub nie odpowiedział") }
        let ver = tag.hasPrefix("app-v") ? String(tag.dropFirst(5)) : tag
        let assets = (j["assets"] as? [[String: Any]]) ?? []
        func named(_ test: (String) -> Bool) -> (String, URL)? {
            for a in assets {
                if let n = a["name"] as? String, test(n), let s = a["browser_download_url"] as? String, let u = URL(string: s), Updater.webURL(u) { return (n, u) }
            }
            return nil
        }
        func pick(_ suffix: String) async throws -> Asset? {
            guard let hit = named({ $0.hasSuffix(suffix) }) else { return nil }
            let (name, url) = hit
            guard let sumHit = named({ $0 == name + ".sha256" }) else { return Asset(url: url, sha256: nil) }
            var sr = URLRequest(url: sumHit.1)
            sr.timeoutInterval = 20
            sr.setValue(ClaudeCLI.userAgent, forHTTPHeaderField: "User-Agent")
            let (sd, sresp) = try await URLSession.shared.data(for: sr)
            guard (sresp as? HTTPURLResponse)?.statusCode == 200, let sum = Updater.hex(String(data: sd, encoding: .utf8)) else { throw UpdateError.bad("nie mogę pobrać sumy kontrolnej \(name)") }
            return Asset(url: url, sha256: sum)
        }
        let zip = try await pick(".zip")
        let pkg = try await pick(".pkg")
        return (ver, zip, pkg)
    }

    // ---------- pobranie i podmiana ----------
    // pobiera plik; token mostka idzie tylko do hosta Task Hub; gdy jest suma, plik musi się z nią zgadzać
    private func fetch(_ a: Asset, to file: URL) async throws {
        var r = URLRequest(url: a.url)
        r.timeoutInterval = 120
        r.setValue(ClaudeCLI.userAgent, forHTTPHeaderField: "User-Agent")
        let tm = URL(string: store.baseURL).flatMap { Store.hostKey($0) }
        let mine = store.configured && tm != nil && Store.hostKey(a.url) == tm
        if mine { r.setValue("Bearer \(store.cfg.token.trimmingCharacters(in: .whitespaces))", forHTTPHeaderField: "Authorization") }
        let (tmp, resp) = try await URLSession.shared.download(for: r, delegate: DropAuthOnRedirect(host: mine ? (tm ?? "") : ""))
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            try? FileManager.default.removeItem(at: tmp)
            throw UpdateError.bad("pobieranie nie powiodło się (HTTP \(code))")
        }
        try? FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: tmp, to: file)
        if let want = a.sha256 {
            let got = try Updater.sha256(of: file)
            guard got == want else {
                try? FileManager.default.removeItem(at: file)
                Log.write("aktualizacja: suma SHA-256 się nie zgadza (\(a.url.lastPathComponent)): jest \(got), miało być \(want)")
                throw UpdateError.bad("pobrany plik ma inną sumę kontrolną niż wydanie, przerywam")
            }
        } else {
            Log.write("aktualizacja: wydanie bez sumy SHA-256 dla \(a.url.lastPathComponent)")
        }
    }

    private func install(version: String, zip: Asset?, pkg: Asset?) async throws {
        let dir = Store.dir.appendingPathComponent("updates", isDirectory: true)
        let fm = FileManager.default
        try? fm.removeItem(at: dir)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard let zip = zip else {
            if let pkg = pkg { try await openPkg(pkg, version: version, dir: dir); return }
            throw UpdateError.bad("wydanie nie ma pliku do pobrania")
        }
        status = "Pobieram \(version)…"
        let zipFile = dir.appendingPathComponent("app.zip")
        try await fetch(zip, to: zipFile)
        status = "Rozpakowuję…"
        let unzip = ProcessRunner(bin: "/usr/bin/ditto", args: ["-x", "-k", zipFile.path, dir.path], cwd: dir.path, env: ProcessInfo.processInfo.environment, maxSeconds: 120, stallSeconds: 120, json: false)
        let r = await unzip.run { _ in }
        guard r.ok else { throw UpdateError.bad("rozpakowanie nie powiodło się: \(r.text)") }
        let newApp = dir.appendingPathComponent("Task Hub.app")
        guard let plist = NSDictionary(contentsOf: newApp.appendingPathComponent("Contents/Info.plist")),
              (plist["CFBundleShortVersionString"] as? String) == version else { throw UpdateError.bad("pobrane archiwum jest niekompletne") }
        let target = Bundle.main.bundleURL
        do {
            var trashed: NSURL? = nil
            try fm.trashItem(at: target, resultingItemURL: &trashed)
            try fm.moveItem(at: newApp, to: target)
        } catch {
            Log.write("aktualizacja: podmiana nie powiodła się (\(error.localizedDescription)), otwieram instalator")
            try? fm.removeItem(at: newApp)   // rozpakowana kopia zostawiona obok myliła Instalator: widział już „zainstalowaną” nową wersję
            if let pkg = pkg { try await openPkg(pkg, version: version, dir: dir); return }
            throw error
        }
        ready = version
        status = "Wersja \(version) zainstalowana, zadziała po ponownym uruchomieniu."
        Log.write("aktualizacja \(currentVersion) → \(version) zainstalowana w \(target.path)")
        maybeRelaunch(version)
    }

    // wersja aplikacji na dysku (może być nowsza niż ta, która działa)
    private func installedVersion() -> String? {
        NSDictionary(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Contents/Info.plist"))?["CFBundleShortVersionString"] as? String
    }

    // adres z Task Hub kończy się na …/download?asset=…, więc nazwę pliku nadajemy sami (Instalator potrzebuje .pkg)
    private func openPkg(_ pkg: Asset, version: String, dir: URL) async throws {
        status = "Pobieram instalator…"
        let file = dir.appendingPathComponent("Task-Hub-\(version).pkg")
        try await fetch(pkg, to: file)
        status = "Otwieram instalator (poprosi o hasło)."
        NSWorkspace.shared.open(file)
    }

    private func maybeRelaunch(_ version: String) {
        if canRelaunchQuietly() { relaunch() } else { askRelaunch(version) }
    }

    // nowa instancja startuje po sekundzie, ta kończy pracę
    func relaunch() {
        let path = Bundle.main.bundleURL.path.replacingOccurrences(of: "\"", with: "\\\"")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1.5; /usr/bin/open -n \"\(path)\""]
        do { try p.run() } catch { Log.write("ponowne uruchomienie: \(error.localizedDescription)"); return }
        Log.write("ponowne uruchomienie po aktualizacji")
        NSApp.terminate(nil)
    }
}
