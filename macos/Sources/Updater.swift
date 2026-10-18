// Samoaktualizacja: co 6 godzin (i 20 s po starcie) pyta GitHub o najnowsze wydanie app-v…, pobiera archiwum .zip
// z aplikacją (pobrane przez aplikację nie dostaje kwarantanny, więc Gatekeeper nie pyta), podmienia /Applications/Task Hub.app
// (stara wersja ląduje w Koszu) i uruchamia aplikację ponownie, gdy nic nie przerywa: okna zamknięte, mostek nie pracuje.
// Bez prawa zapisu w /Applications otwiera instalator .pkg (poprosi o hasło).
import AppKit

enum UpdateError: LocalizedError {
    case bad(String)
    var errorDescription: String? { if case .bad(let s) = self { return s }; return nil }
}

@MainActor
final class Updater: ObservableObject {
    static let api = "https://api.github.com/repos/piotr-bialobrzeski-wrx/taskhub/releases/latest"
    static let interval: TimeInterval = 6 * 3600

    @Published private(set) var status = ""
    @Published private(set) var available: String? = nil   // nowsza wersja na GitHubie
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
            guard let api = URL(string: Updater.api) else { return }
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
            func asset(_ suffix: String) -> String? {
                assets.first { (($0["name"] as? String) ?? "").hasSuffix(suffix) }?["browser_download_url"] as? String
            }
            lastCheck = Date()
            guard Updater.isNewer(ver, than: currentVersion) else {
                available = nil
                status = "Masz najnowszą wersję (\(currentVersion))."
                return
            }
            available = ver
            Log.write("aktualizacja: dostępna \(ver), mam \(currentVersion)")
            try await install(version: ver, zip: asset(".zip"), pkg: asset(".pkg"))
        } catch {
            status = "Aktualizacja: \(error.localizedDescription)"
            Log.write(status)
        }
    }

    private func install(version: String, zip: String?, pkg: String?) async throws {
        let dir = Store.dir.appendingPathComponent("updates", isDirectory: true)
        let fm = FileManager.default
        try? fm.removeItem(at: dir)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let zip = zip, let zipURL = URL(string: zip) else {
            if let pkg = pkg { try await openPkg(pkg, dir: dir); return }
            throw UpdateError.bad("wydanie nie ma pliku do pobrania")
        }
        status = "Pobieram \(version)…"
        let (tmp, _) = try await URLSession.shared.download(from: zipURL)
        let zipFile = dir.appendingPathComponent("app.zip")
        try fm.moveItem(at: tmp, to: zipFile)
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
            if let pkg = pkg { try await openPkg(pkg, dir: dir); return }
            throw error
        }
        ready = version
        status = "Wersja \(version) zainstalowana, zadziała po ponownym uruchomieniu."
        Log.write("aktualizacja \(currentVersion) → \(version) zainstalowana w \(target.path)")
        maybeRelaunch(version)
    }

    private func openPkg(_ pkg: String, dir: URL) async throws {
        guard let u = URL(string: pkg) else { throw UpdateError.bad("zły adres instalatora") }
        status = "Pobieram instalator…"
        let (tmp, _) = try await URLSession.shared.download(from: u)
        let file = dir.appendingPathComponent(u.lastPathComponent)
        try FileManager.default.moveItem(at: tmp, to: file)
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
