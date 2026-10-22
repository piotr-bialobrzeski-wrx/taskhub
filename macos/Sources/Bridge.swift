// Mostek (wzorzec z Project Hub): co kilkanaście sekund pyta Task Hub tanim HTTP (zero tokenów), a gdy czeka praca,
// bierze bieg na wyłączność i uruchamia Claude Code na subskrypcji z konektorem Task Hub. Limit, wylogowanie i błędy
// zgłasza do Task Hub i odczekuje. Serwer podaje prompt i adres konektora, więc zmiany w zasadach nie wymagają nowej aplikacji.
// Mostek v2 (0.1.7): najpierw wysyłki zatwierdzonych szkiców (osobny bieg z jednym konektorem albo commit robiony przez
// aplikację), potem praca. Każdy bieg ma własny token biegu i zasady z Policy (nigdy bypassPermissions); „Zatrzymaj”
// przerywa bieg i wstrzymuje nowe na 10 minut.
import Foundation

struct BridgeWork {
    var pending: Int
    var sends: Int           // zatwierdzone szkice gotowe do wysyłki
    var work: Int            // reszta pracy
    var pollMs: Int
    var runBridge: String?   // kto trzyma otwarty bieg (inny komputer), nil = wolne
    var key: String = ""     // odcisk listy pracy (serwer v2); pusty = nie wiadomo
}

@MainActor
final class Bridge: ObservableObject {
    enum State: String { case off, idle, running, limit, auth, error, offline, stopped }
    enum Outcome: String { case done, error, limit, auth, busy, stopped, nothing }
    enum Kind: String { case work, send }

    @Published private(set) var state: State = .off
    @Published private(set) var detail = ""          // ostatnia informacja dla człowieka
    @Published private(set) var pending = 0
    @Published private(set) var lastPoll: Date? = nil
    @Published private(set) var until: Date? = nil   // kiedy znów próbować po limicie / błędzie / zatrzymaniu
    @Published private(set) var busyBy: String? = nil
    @Published private(set) var runs = 0             // udane biegi od startu
    @Published private(set) var isRunningNow = false // trwa bieg (Claude albo commit): „Zatrzymaj bieg” w menu i w powiadomieniu
    @Published private(set) var runLabel = ""        // co robi bieg, po ludzku

    private let store: Store
    private var loopTask: Task<Void, Never>? = nil
    private var sleeper: Task<Void, Never>? = nil
    private var current: ProcessRunner? = nil
    private var gitSend: GitSend? = nil
    private var userStopped = false
    private var serverStopped = false                // Piotr wycofał zgodę na szkic w Task Hub: bieg przerwany bez 10-minutowej przerwy
    private var runId: String? = nil                 // trwający bieg (do odpowiedzi „cancel” na touch)
    private var lastWorkKey: String? = nil           // odcisk listy pracy, z którą ruszył ostatni udany bieg pracy
    private var stuckKey: String? = nil              // ta sama lista pracy po udanym biegu: bieg niczego nie ruszył, nie powtarzamy go od razu
    private var stuckUntil: Date? = nil
    private let stuckHold: Double = 20 * 60
    private var planFailed = false                   // zasad biegu nie dało się zbudować: bieg nie ruszył
    private var probe: Probe? = nil                  // ostatnia próba Claude Code (narzędzia, konektory, tryb)
    private var noSendsUntil: Date? = nil            // serwer nie dał wysyłki (204): przez chwilę nie pytamy
    private var lastReport: Date? = nil              // kiedy ostatnio zgłoszono listę konektorów do rejestru połączeń
    private let reportEvery: Double = 6 * 3600
    private let probeEvery: Double = 6 * 3600
    private let stopHold: Double = 10 * 60

    init(store: Store) { self.store = store }

    var running: Bool { loopTask != nil }

    var statusLine: String {
        switch state {
        case .off: return store.configured ? "wyłączony" : "nie połączony: podaj adres i token"
        case .idle:
            if pending > 0 { return "czuwa, czeka \(pending)" + (busyBy.map { " (pracuje \($0))" } ?? "") }
            return "czuwa, nic nie czeka"
        case .running: return (runLabel.isEmpty ? "Claude pracuje" : runLabel) + (detail.isEmpty ? "" : " · \(detail)")
        case .limit: return "limit Claude" + (until.map { ", wracam \(ClaudeCLI.hhmm($0))" } ?? "")
        case .auth: return "Claude Code wylogowany: w Terminalu wpisz claude, potem /login"
        case .error: return "błąd: \(detail)"
        case .offline: return "brak połączenia z Task Hub: \(detail)"
        case .stopped: return "zatrzymany przez Ciebie" + (until.map { ", wracam o \(ClaudeCLI.hhmm($0))" } ?? "")
        }
    }

    func start() {
        guard loopTask == nil else { return }
        guard store.configured else { state = .off; detail = "Podaj adres i token w Ustawieniach."; return }
        state = .idle
        detail = "Sprawdzam, co czeka…"
        until = nil
        Policy.cleanRunDir()
        Log.write("mostek start → \(store.baseURL) · komputer: \(store.cfg.name)")
        loopTask = Task { [weak self] in await self?.loop() }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
        sleeper?.cancel()
        current?.kill("mostek zatrzymany", wait: true)
        current = nil
        gitSend?.cancel()
        if state != .off { Log.write("mostek stop") }
        state = .off
        detail = ""
    }

    func restart() {
        stop()
        start()
    }

    // „Sprawdź teraz”: przerwij czekanie, zapomnij o odłożonym terminie (także po „Zatrzymaj”)
    func poke() {
        guard running else { return }
        if state == .limit || state == .auth || state == .error || state == .offline || state == .stopped { state = .idle }
        until = nil
        noSendsUntil = nil
        stuckKey = nil     // „Sprawdź teraz” puszcza też pracę, która ostatnio stała w miejscu
        lastReport = nil   // „Sprawdź teraz” odświeża też rejestr połączeń
        sleeper?.cancel()
    }

    // „Zatrzymaj” z powiadomienia albo z menu: przerwij bieg, zgłoś „stopped” i nie bierz nowych biegów przez 10 minut
    func cancelRun() {
        guard isRunningNow else { return }
        userStopped = true
        current?.kill("zatrzymany przez Ciebie")
        gitSend?.cancel()
        detail = "zatrzymuję bieg…"
        Log.write("bieg: zatrzymany przez Ciebie")
    }

    // Rejestr połączeń w Task Hub: po starcie i co kilka godzin wysyła listę serwerów MCP, które widzi Claude Code na tym Macu
    // (nazwy, adresy, stan; żadnych tokenów). Dzięki temu agent wie, czym dysponuje z tego komputera, a Task Hub ma gotową konfigurację dla nowego silnika.
    private func reportConnections() async {
        if let l = lastReport, Date().timeIntervalSince(l) < reportEvery { return }
        guard let bin = ClaudeCLI.find(store.cfg.claude) else { return }
        lastReport = Date()
        guard let servers = await ClaudeCLI.mcpList(bin) else { Log.write("rejestr połączeń: claude mcp list nie odpowiedział"); return }
        let list: [[String: Any]] = servers.map { s in
            var d: [String: Any] = ["name": s.name, "transport": s.transport, "ok": s.ok, "status": s.status]
            if s.target.hasPrefix("http") { d["url"] = s.target } else { d["command"] = s.target }
            return d
        }
        do {
            let (code, j) = try await request("POST", "/api/bridge/connections", body: ["host": store.cfg.name, "servers": list])
            if code == 200 {
                let n = { (k: String) -> Int in (j[k] as? Int) ?? 0 }
                Log.write("rejestr połączeń: \(servers.count) konektorów (nowe \(n("added")), odświeżone \(n("updated")), wyłączone \(n("off")))")
            } else {
                Log.write("rejestr połączeń: HTTP \(code)")
            }
        } catch {
            Log.write("rejestr połączeń: \(error.localizedDescription)")
        }
    }

    // ---------- pętla ----------
    private func nap(_ seconds: Double) async {
        let t = Task<Void, Never> {
            do { try await Task.sleep(nanoseconds: UInt64(max(1, seconds) * 1_000_000_000)) } catch {}
        }
        sleeper = t
        await t.value
        sleeper = nil
    }

    private func loop() async {
        var lastErr = ""
        while !Task.isCancelled {
            var wait = 15.0
            do {
                if let u = until, Date() >= u { until = nil; state = .idle; detail = "Próbuję ponownie." }
                let w = try await poll()
                lastPoll = Date()
                pending = w.pending
                busyBy = w.runBridge
                if w.pollMs > 0 { wait = Double(w.pollMs) / 1000 }
                lastErr = ""
                if state == .offline { state = .idle }
                await reportConnections()
                // po udanym biegu pracy lista pracy bez zmian (np. krok oddany przez leave_step): kolejny bieg zrobiłby to samo,
                // więc praca czeka do zmiany listy, „Sprawdź teraz” albo 20 minut
                if let k = lastWorkKey {
                    lastWorkKey = nil
                    if !k.isEmpty && k == w.key { stuckKey = k; stuckUntil = Date().addingTimeInterval(stuckHold) }
                }
                if let k = stuckKey, k != w.key || Date() >= (stuckUntil ?? Date()) { stuckKey = nil }
                if w.runBridge == nil && until == nil && (w.sends > 0 || w.work > 0) {
                    // najpierw wysyłki (krótkie, ktoś na nie czeka), potem praca
                    var o = Outcome.nothing
                    if w.sends > 0 && (noSendsUntil.map { Date() >= $0 } ?? true) {
                        o = await runOnce(.send)
                        if o == .nothing { noSendsUntil = Date().addingTimeInterval(60) }
                    }
                    if o == .nothing && w.work > 0 && until == nil && !Task.isCancelled {
                        if stuckKey == nil {
                            o = await runOnce(.work)
                            if o == .done { lastWorkKey = w.key }
                        } else if state == .idle {
                            detail = "ostatni bieg nie ruszył czekającej pracy; ponowię po zmianie w zadaniach albo o \(ClaudeCLI.hhmm(stuckUntil ?? Date()))"
                        }
                    }
                    if o == .done && !Task.isCancelled { continue }   // od razu sprawdź, czy coś jeszcze czeka
                } else if state == .idle {
                    detail = ""
                }
            } catch let e as BridgeError {
                let msg = e.errorDescription ?? "błąd"
                if msg != lastErr { Log.write(msg) }
                lastErr = msg
                if case .auth = e {
                    state = .auth
                    detail = "Task Hub odrzucił token mostka. Utwórz nowy w Ustawieniach Task Hub."
                    wait = 60
                } else {
                    state = .offline
                    detail = msg
                    wait = 30
                }
            } catch {
                state = .offline
                detail = error.localizedDescription
                wait = 30
            }
            if Task.isCancelled { break }
            await nap(wait)
        }
    }

    // ---------- HTTP ----------
    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> (Int, [String: Any]) {
        let data = body.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        return try await requestRaw(method, path, data: data)
    }

    private func requestRaw(_ method: String, _ path: String, data: Data?, type: String = "application/json", timeout: TimeInterval = 30) async throws -> (Int, [String: Any]) {
        guard let url = URL(string: store.baseURL + path) else { throw BridgeError.bad("zły adres Task Hub") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = timeout
        r.setValue("Bearer \(store.cfg.token.trimmingCharacters(in: .whitespaces))", forHTTPHeaderField: "Authorization")
        r.setValue(type, forHTTPHeaderField: "Content-Type")
        r.setValue(ClaudeCLI.userAgent, forHTTPHeaderField: "User-Agent")
        if let d = data { r.httpBody = d }
        let pair: (Data, URLResponse)
        do { pair = try await URLSession.shared.data(for: r) } catch { throw BridgeError.network(error.localizedDescription) }
        let (body, resp) = pair
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let json = ((try? JSONSerialization.jsonObject(with: body)) as? [String: Any]) ?? [:]
        if code == 401 { throw BridgeError.auth((json["error"] as? String) ?? "401") }
        return (code, json)
    }

    private func poll() async throws -> BridgeWork {
        var items = [
            URLQueryItem(name: "host", value: store.cfg.name),
            URLQueryItem(name: "runner", value: "claude"),
            URLQueryItem(name: "state", value: state.rawValue),
            URLQueryItem(name: "v", value: ClaudeCLI.bridgeVersion),
        ]
        if let u = until { items.append(URLQueryItem(name: "until", value: ISO8601DateFormatter().string(from: u))) }
        var c = URLComponents()
        c.queryItems = items
        let (code, j) = try await request("GET", "/api/bridge/work?" + (c.percentEncodedQuery ?? ""))
        guard code == 200 else { throw BridgeError.http(code, (j["error"] as? String) ?? "") }
        let run = j["run"] as? [String: Any]
        let who: String? = run.map { ($0["bridge"] as? String) ?? "inny komputer" }
        let pending = (j["pending"] as? Int) ?? 0
        let sends = (j["sends"] as? Int) ?? 0
        let work = (j["work"] as? Int) ?? max(0, pending - sends)   // serwer bez v2: wszystko to praca
        return BridgeWork(pending: pending, sends: sends, work: work, pollMs: (j["pollMs"] as? Int) ?? 0, runBridge: who, key: (j["key"] as? String) ?? "")
    }

    private func touch(_ id: String, note: String?) async {
        var body: [String: Any] = [:]
        if let n = note { body["note"] = String(n.prefix(200)) }
        guard let r = try? await request("PATCH", "/api/bridge/run/\(id)", body: body) else { return }
        // cancel: Piotr zatrzymał ten bieg w Task Hub („Zatrzymaj” w dymku pracy) albo wycofał zgodę na szkic tej wysyłki („Zatrzymaj” na karcie), więc bieg kończy się od razu
        if (r.1["cancel"] as? Bool) == true, isRunningNow, runId == id, !serverStopped, !userStopped {
            serverStopped = true
            current?.kill("zatrzymany w Task Hub")
            gitSend?.cancel()
            detail = "zatrzymuję bieg (zatrzymany w Task Hub)…"
            Log.write("bieg: zatrzymany w Task Hub")
        }
    }

    // koniec biegu w Task Hub; osobne zadanie, żeby zgłoszenie wyszło także po wyłączeniu mostka (anulowana pętla)
    private func finishRun(_ id: String, _ body: [String: Any]) async {
        let data = try? JSONSerialization.data(withJSONObject: body)
        let path = "/api/bridge/run/\(id)"
        let t = Task { @MainActor in _ = try? await self.requestRaw("PATCH", path, data: data) }
        await t.value
    }

    // szybkie zadanie z okienka „Nowe zadanie”
    // szybki pasek: tekst i pliki jak z głównego pola na kanwie (multipart „text” + „files”); wynik: nowe zadanie i jego adres
    func quickSend(_ text: String, files: [QuickFile]) async throws -> (id: String?, url: String?) {
        let boundary = "TaskHub-\(UUID().uuidString)"
        var d = Data()
        func part(_ head: String, _ body: Data) {
            d.append("--\(boundary)\r\n\(head)\r\n\r\n".data(using: .utf8)!)
            d.append(body)
            d.append("\r\n".data(using: .utf8)!)
        }
        part("Content-Disposition: form-data; name=\"text\"", text.data(using: .utf8) ?? Data())
        for f in files {
            let name = f.name.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
            part("Content-Disposition: form-data; name=\"files\"; filename=\"\(name)\"\r\nContent-Type: \(f.mime)", f.data)
        }
        d.append("--\(boundary)--\r\n".data(using: .utf8)!)
        let (code, j) = try await requestRaw("POST", "/api/bridge/task", data: d, type: "multipart/form-data; boundary=\(boundary)", timeout: 90)
        guard code == 200 else { throw BridgeError.http(code, (j["error"] as? String) ?? "") }
        return (j["id"] as? String, j["url"] as? String)
    }

    // sprawdzenie połączenia z Ustawień: ile rzeczy czeka
    func check() async throws -> Int {
        let host = store.cfg.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let (code, j) = try await request("GET", "/api/bridge/work?host=\(host)&runner=claude&state=check&v=\(ClaudeCLI.bridgeVersion)")
        guard code == 200 else { throw BridgeError.http(code, (j["error"] as? String) ?? "") }
        return (j["pending"] as? Int) ?? 0
    }

    // ---------- zasady: próba Claude Code ----------
    // świeża próba po starcie, co 6 h i po zmianie wersji Claude Code; za stara wersja = mostek stoi
    private func ensureProbe(_ bin: String) async throws -> Probe {
        guard let text = await ClaudeCLI.version(bin), let v = CCVersion(text) else {
            throw PolicyError("Claude Code nie podał wersji (\(bin) --version). Sprawdź instalację: w Terminalu claude --version.")
        }
        guard v >= Policy.minVersion else {
            throw PolicyError("Zaktualizuj Claude Code: w Terminalu claude update (jest \(v), mostek potrzebuje co najmniej \(Policy.minVersion)).")
        }
        if let p = probe, p.bin == bin, p.version == v, Date().timeIntervalSince(p.at) < probeEvery { return p }
        var plain = await ClaudeCLI.probe(bin, restricted: false)
        if let first = plain.initInfo, first.servers.contains(where: { $0.status == "pending" }) {
            // konektor jeszcze się łączył (np. Figma): chwila i druga próba; zostaje ta z większą liczbą połączonych serwerów i narzędzi,
            // bo konektor widziany dopiero w biegu nie ma reguły i strażnik go blokuje
            let names = first.servers.filter { $0.status == "pending" }.map { $0.name }.joined(separator: ", ")
            Log.write("próba Claude Code: konektory jeszcze się łączą (\(names)), za chwilę druga próba")
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            let again = await ClaudeCLI.probe(bin, restricted: false)
            if again.ok, let second = again.initInfo, (Bridge.connected(second), second.tools.count) > (Bridge.connected(first), first.tools.count) {
                plain = again
            }
        }
        guard plain.ok, let info = plain.initInfo else {
            if ClaudeCLI.isAuth(plain.text) { throw PolicyError("Claude Code wylogowany: \(plain.text)") }
            throw PolicyError("Próba Claude Code się nie udała: \(String(plain.text.prefix(300)))")
        }
        guard info.permissionMode == "dontAsk" else {
            throw PolicyError("\(Bridge.rejected) (próba: tryb \(info.permissionMode ?? "brak"))")
        }
        // --restricted tylko gdy nie chowa konektorów, które Claude Code ma bez niego
        var restricted = false
        if v >= Policy.restrictedFrom {
            let r = await ClaudeCLI.probe(bin, restricted: true)
            if r.ok, let ri = r.initInfo, ri.permissionMode == "dontAsk" {
                let want = Set(info.servers.filter { $0.status == "connected" }.map { $0.name })
                let got = Set(ri.servers.filter { $0.status == "connected" }.map { $0.name })
                restricted = want.isSubset(of: got)
            }
        }
        let p = Probe(bin: bin, version: v, info: info, restricted: restricted, at: Date())
        probe = p
        let names = info.servers.map { "\($0.name) (\($0.status))" }.joined(separator: ", ")
        let conn = Policy.connectorTools(info)
        Log.write("próba Claude Code \(v): \(info.tools.count) narzędzi; konektory: \(names.isEmpty ? "brak" : names); do odczytu \(conn.read.count), zablokowane \(conn.write.count); tryb ograniczony: \(restricted ? "tak" : "nie")")
        return p
    }

    static let rejected = "Claude Code nie przyjął zasad mostka"
    private static func connected(_ i: InitInfo) -> Int { i.servers.filter { $0.status == "connected" }.count }

    // błąd przed biegiem: stan, opis i termin kolejnej próby
    private func hold(_ s: State, _ msg: String, _ seconds: Double) -> Outcome {
        if state != s || detail != msg { Log.write("mostek czeka: \(msg)") }
        state = s
        detail = msg
        until = Date().addingTimeInterval(seconds)
        return s == .auth ? .auth : .error
    }

    // ---------- jeden bieg ----------
    private func runOnce(_ kind: Kind) async -> Outcome {
        guard let bin = ClaudeCLI.find(store.cfg.claude) else {
            return hold(.error, "nie znaleziono Claude Code na tym Macu. Zainstaluj go i zaloguj się (w Terminalu: claude, potem /login) albo wskaż ścieżkę w Ustawieniach.", 10 * 60)
        }
        // zasady przed biegiem: bez udanej próby nie bierzemy biegu z Task Hub
        let pr: Probe
        do { pr = try await ensureProbe(bin) } catch {
            let msg = error.localizedDescription
            if ClaudeCLI.isAuth(msg) { return hold(.auth, "wylogowany", 5 * 60) }
            return hold(.error, msg, 10 * 60)
        }
        if Task.isCancelled { return .error }

        let res: (Int, [String: Any])
        do { res = try await request("POST", "/api/bridge/run", body: ["bridge": store.cfg.name, "v": 2, "kind": kind.rawValue]) } catch {
            state = .offline
            detail = error.localizedDescription
            return .error
        }
        let (code, j) = res
        if code == 409 {
            busyBy = ((j["run"] as? [String: Any])?["bridge"] as? String) ?? "inny komputer"
            return .busy
        }
        if code == 204 { return .nothing }   // nic gotowego do wysłania
        if code == 422 {
            // serwer nie znalazł konektora: cofnął zatwierdzenie i napisał o tym w zadaniu
            Log.write("wysyłka odłożona: \((j["error"] as? String) ?? "brak konektora na tym Macu")")
            return .nothing
        }
        guard code == 200, let run = j["run"] as? [String: Any], let id = run["id"] as? String else {
            return hold(.error, "Task Hub nie dał biegu (HTTP \(code))", 60)
        }
        guard (j["kind"] as? String) == kind.rawValue else {
            await finishRun(id, ["outcome": "error", "note": "Serwer odpowiedział bez mostka v2 (brak kind=\(kind.rawValue)). Aplikacja 0.1.7 nie uruchomi biegu w starym trybie."])
            return hold(.error, "Task Hub nie obsługuje jeszcze mostka v2. Zaktualizuj serwer Task Hub.", 10 * 60)
        }
        let maxMin = (j["maxMinutes"] as? Int) ?? (kind == .send ? 10 : 45)
        let title = ((j["step"] as? [String: Any])?["title"] as? String) ?? ""
        let app = ((j["target"] as? [String: Any])?["app"] as? String) ?? ""
        let git = kind == .send ? (j["git"] as? [String: Any]) : nil
        let label: String
        if kind == .work { label = "Claude pracuje nad zadaniami" }
        else if git != nil { label = "Commit: " + (title.isEmpty ? "zatwierdzony szkic" : title) }
        else { label = "Wysyłka" + (app.isEmpty ? "" : " do \(app)") + (title.isEmpty ? "" : ": \(title)") }

        state = .running
        detail = "start"
        userStopped = false
        serverStopped = false
        runId = id
        isRunningNow = true
        runLabel = label
        Notifier.shared.runStarted(label: label)
        Log.write("▶ bieg \(id.prefix(8)) (\(kind.rawValue)): \(label)")

        let keep = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if Task.isCancelled { break }
                await self?.touch(id, note: nil)
            }
        }
        let result: ProcessResult
        var sent: [String: Any]? = nil
        planFailed = false
        if let g = git {
            if let job = GitJob(g) {
                let gs = GitSend()
                gitSend = gs
                if userStopped || serverStopped { gs.cancel() }
                let r = await gs.run(job, folders: Policy.codeFolders(store.cfg.codeFolders))
                gitSend = nil
                result = ProcessResult(ok: r.ok, text: r.text)
                if r.ok {
                    var s: [String: Any] = ["summary": r.text]
                    if let l = r.link { s["link"] = l }
                    sent = s
                }
            } else {
                result = ProcessResult(ok: false, text: "Task Hub podał niepełne dane commita (repo, gałąź, opis, pliki).")
            }
        } else {
            result = await runClaude(kind, id: id, j: j, probe: pr, bin: bin, maxMin: maxMin)
        }
        keep.cancel()

        var outcome = Outcome.done
        var note = String(result.text.prefix(600))
        if Task.isCancelled {
            // mostek wyłączony albo przestawiony w trakcie: stanem zajmuje się stop()/start()
            outcome = .stopped
            note = "mostek wyłączony na tym Macu w trakcie biegu"
        } else if userStopped {
            outcome = .stopped
            state = .stopped
            until = Date().addingTimeInterval(stopHold)
            detail = "zatrzymany przez Ciebie"
            note = "zatrzymany przez właściciela na Macu"
        } else if serverStopped {
            // zatrzymany w Task Hub: tylko ten bieg; przerwę w pracy (po „Zatrzymaj” w dymku) liczy serwer, więc /api/bridge/work zgłasza brak pracy
            outcome = .stopped
            state = .idle
            detail = ""
            note = "zatrzymany w Task Hub"
        } else if result.ok {
            state = .idle
            until = nil
            runs += 1
            detail = ""
        } else if planFailed || result.text.hasPrefix(Bridge.rejected) {
            // zasady się nie zbudowały albo Claude Code je zignorował: nie próbujemy co minutę, przed kolejnym biegiem nowa próba
            outcome = .error
            state = .error
            until = Date().addingTimeInterval(10 * 60)
            detail = String(note.prefix(160))
            probe = nil
        } else if ClaudeCLI.isLimit(result.text) {
            outcome = .limit
            state = .limit
            until = ClaudeCLI.resetDate(result.text) ?? Date().addingTimeInterval(30 * 60)
            detail = "limit Claude"
        } else if ClaudeCLI.isAuth(result.text) {
            outcome = .auth
            state = .auth
            until = Date().addingTimeInterval(5 * 60)
            detail = "wylogowany"
        } else {
            outcome = .error
            state = .error
            until = Date().addingTimeInterval(60)
            detail = String(note.prefix(160))
        }
        if note.isEmpty { note = result.ok ? "zrobione" : "błąd bez komunikatu" }
        var body: [String: Any] = ["outcome": outcome.rawValue, "note": note]
        if outcome == .done, let s = sent { body["sent"] = s }
        await finishRun(id, body)
        isRunningNow = false
        runLabel = ""
        userStopped = false
        serverStopped = false
        runId = nil
        Notifier.shared.runEnded()
        Log.write("\(outcome == .done ? "✓" : "✗") bieg \(id.prefix(8)) (\(kind.rawValue), \(outcome.rawValue)): \(note.prefix(200))")
        return outcome
    }

    // bieg Claude Code z zasadami z Policy; pliki biegu (token biegu, ustawienia) znikają zaraz po biegu
    private func runClaude(_ kind: Kind, id: String, j: [String: Any], probe pr: Probe, bin: String, maxMin: Int) async -> ProcessResult {
        guard let prompt = j["prompt"] as? String, !prompt.isEmpty, let mcp = j["mcp"] as? String else {
            planFailed = true
            return ProcessResult(ok: false, text: "Task Hub nie podał promptu albo adresu konektora.")
        }
        let token = (j["token"] as? String) ?? ""   // token biegu; tokenu mostka nigdy nie dajemy Claude
        let model = store.cfg.model
        var use = pr
        let servers = ((j["servers"] as? [Any]) ?? []).compactMap { $0 as? String }
        if kind == .send {
            // konektor dodany po ostatniej próbie: jedna nowa próba, zanim uznamy, że go nie ma
            let known = Policy.knownServers(pr.info)
            if !servers.contains(where: { known.contains(Policy.norm($0)) }) {
                probe = nil
                if let fresh = try? await ensureProbe(bin) { use = fresh }
            }
        }
        let plan: RunPlan
        do {
            if kind == .work {
                plan = try Policy.work(runId: id, prompt: prompt, mcp: mcp, token: token, probe: use, folders: Policy.codeFolders(store.cfg.codeFolders),
                                       files: Policy.codeFolders(store.cfg.fileFolders, what: "folder na pliki"), model: model, bin: bin)
            } else {
                plan = try Policy.send(runId: id, prompt: prompt, mcp: mcp, token: token, servers: servers, probe: use, model: model)
            }
        } catch {
            planFailed = true
            return ProcessResult(ok: false, text: error.localizedDescription)
        }
        defer { Policy.remove(plan.files) }
        if userStopped || serverStopped || Task.isCancelled { return ProcessResult(ok: false, text: "zatrzymany przez Ciebie") }
        let p = plan
        let bridge = self
        let runner = ProcessRunner(bin: bin, args: p.args, cwd: Store.workDir.path, env: p.env, maxSeconds: Double(maxMin * 60),
                                   onInit: { info in
            // konektor, którego próba nie widziała: bieg idzie dalej (strażnik blokuje jego narzędzia), a przed następnym biegiem nowa próba
            let fresh = Policy.unknownTools(info, p)
            if !fresh.isEmpty {
                let servers = Set(fresh.compactMap { Policy.split($0)?.server }).sorted().joined(separator: ", ")
                Task { @MainActor in
                    Log.write("  konektor doszedł po próbie (\(servers), narzędzi: \(fresh.count)): w tym biegu blokuje je strażnik, przed następnym nowa próba")
                    bridge.probe = nil
                }
            }
            return Policy.check(info, p)
        })
        current = runner
        let result = await runner.run { step in
            Task { @MainActor in
                bridge.detail = step
                Log.write("  · \(step)")
                await bridge.touch(id, note: step)
            }
        }
        current = nil
        if let i = result.initInfo {
            Log.write("  zasady: tryb \(i.permissionMode ?? "?"), narzędzia \(i.tools.count), konektory \(i.servers.count)\(use.restricted ? ", tryb ograniczony" : "")")
        }
        return result
    }
}
