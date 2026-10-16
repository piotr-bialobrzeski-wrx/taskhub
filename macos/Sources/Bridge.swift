// Mostek (wzorzec z Project Hub): co kilkanaście sekund pyta Task Hub tanim HTTP (zero tokenów), a gdy czeka praca,
// bierze bieg na wyłączność i uruchamia Claude Code na subskrypcji z konektorem Task Hub. Limit, wylogowanie i błędy
// zgłasza do Task Hub i odczekuje. Serwer podaje prompt i adres konektora, więc zmiany w zasadach nie wymagają nowej aplikacji.
import Foundation

struct BridgeWork {
    var pending: Int
    var pollMs: Int
    var runBridge: String?   // kto trzyma otwarty bieg (inny komputer), nil = wolne
}

@MainActor
final class Bridge: ObservableObject {
    enum State: String { case off, idle, running, limit, auth, error, offline }
    enum Outcome: String { case done, error, limit, auth, busy }

    @Published private(set) var state: State = .off
    @Published private(set) var detail = ""          // ostatnia informacja dla człowieka
    @Published private(set) var pending = 0
    @Published private(set) var lastPoll: Date? = nil
    @Published private(set) var until: Date? = nil   // kiedy znów próbować po limicie / błędzie
    @Published private(set) var busyBy: String? = nil
    @Published private(set) var runs = 0             // udane biegi od startu

    private let store: Store
    private var loopTask: Task<Void, Never>? = nil
    private var sleeper: Task<Void, Never>? = nil
    private var current: ProcessRunner? = nil

    init(store: Store) { self.store = store }

    var running: Bool { loopTask != nil }

    var statusLine: String {
        switch state {
        case .off: return store.configured ? "wyłączony" : "nie połączony: podaj adres i token"
        case .idle:
            if pending > 0 { return "czuwa, czeka \(pending)" + (busyBy.map { " (pracuje \($0))" } ?? "") }
            return "czuwa, nic nie czeka"
        case .running: return "Claude pracuje" + (detail.isEmpty ? "" : " · \(detail)")
        case .limit: return "limit Claude" + (until.map { ", wracam \(ClaudeCLI.hhmm($0))" } ?? "")
        case .auth: return "Claude Code wylogowany: w Terminalu wpisz claude, potem /login"
        case .error: return "błąd: \(detail)"
        case .offline: return "brak połączenia z Task Hub: \(detail)"
        }
    }

    func start() {
        guard loopTask == nil else { return }
        guard store.configured else { state = .off; detail = "Podaj adres i token w Ustawieniach."; return }
        state = .idle
        detail = "Sprawdzam, co czeka…"
        until = nil
        Log.write("mostek start → \(store.baseURL) · komputer: \(store.cfg.name)")
        loopTask = Task { [weak self] in await self?.loop() }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
        sleeper?.cancel()
        current?.kill("mostek zatrzymany")
        current = nil
        if state != .off { Log.write("mostek stop") }
        state = .off
        detail = ""
    }

    func restart() {
        stop()
        start()
    }

    // „Sprawdź teraz”: przerwij czekanie, zapomnij o odłożonym terminie
    func poke() {
        guard running else { return }
        if state == .limit || state == .auth || state == .error || state == .offline { state = .idle }
        until = nil
        sleeper?.cancel()
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
                if w.pending > 0 && w.runBridge == nil && until == nil {
                    let o = await runOnce()
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
        guard let url = URL(string: store.baseURL + path) else { throw BridgeError.bad("zły adres Task Hub") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 30
        r.setValue("Bearer \(store.cfg.token.trimmingCharacters(in: .whitespaces))", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(ClaudeCLI.userAgent, forHTTPHeaderField: "User-Agent")
        if let b = body { r.httpBody = try? JSONSerialization.data(withJSONObject: b) }
        let pair: (Data, URLResponse)
        do { pair = try await URLSession.shared.data(for: r) } catch { throw BridgeError.network(error.localizedDescription) }
        let (data, resp) = pair
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let json = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
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
        return BridgeWork(pending: (j["pending"] as? Int) ?? 0, pollMs: (j["pollMs"] as? Int) ?? 0, runBridge: who)
    }

    private func touch(_ id: String, note: String?) async {
        var body: [String: Any] = [:]
        if let n = note { body["note"] = String(n.prefix(200)) }
        _ = try? await request("PATCH", "/api/bridge/run/\(id)", body: body)
    }

    // szybkie zadanie z okienka „Nowe zadanie”
    func quickTask(_ text: String) async throws -> String {
        let (code, j) = try await request("POST", "/api/bridge/task", body: ["text": text])
        guard code == 200 else { throw BridgeError.http(code, (j["error"] as? String) ?? "") }
        return (j["message"] as? String) ?? "Mam to."
    }

    // sprawdzenie połączenia z Ustawień: ile rzeczy czeka
    func check() async throws -> Int {
        let host = store.cfg.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let (code, j) = try await request("GET", "/api/bridge/work?host=\(host)&runner=claude&state=check&v=\(ClaudeCLI.bridgeVersion)")
        guard code == 200 else { throw BridgeError.http(code, (j["error"] as? String) ?? "") }
        return (j["pending"] as? Int) ?? 0
    }

    // ---------- jeden bieg ----------
    private func runOnce() async -> Outcome {
        let res: (Int, [String: Any])
        do { res = try await request("POST", "/api/bridge/run", body: ["bridge": store.cfg.name]) } catch {
            state = .offline
            detail = error.localizedDescription
            return .error
        }
        let (code, j) = res
        if code == 409 {
            busyBy = ((j["run"] as? [String: Any])?["bridge"] as? String) ?? "inny komputer"
            return .busy
        }
        guard code == 200, let run = j["run"] as? [String: Any], let id = run["id"] as? String, let prompt = j["prompt"] as? String, let mcp = j["mcp"] as? String else {
            state = .error
            detail = "Task Hub nie dał biegu (HTTP \(code))"
            until = Date().addingTimeInterval(60)
            return .error
        }
        let maxMin = (j["maxMinutes"] as? Int) ?? 45
        state = .running
        detail = "start"
        Log.write("▶ bieg \(id.prefix(8))")

        let keep = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if Task.isCancelled { break }
                await self?.touch(id, note: nil)
            }
        }
        var result: ProcessResult
        if let bin = ClaudeCLI.find(store.cfg.claude) {
            do {
                let mcpFile = try ClaudeCLI.writeMcpConfig(url: mcp, token: store.cfg.token.trimmingCharacters(in: .whitespaces))
                var args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--mcp-config", mcpFile.path]
                let model = store.cfg.model.trimmingCharacters(in: .whitespaces)
                if !model.isEmpty { args += ["--model", model] }
                let runner = ProcessRunner(bin: bin, args: args, cwd: Store.workDir.path, env: ClaudeCLI.env(), maxSeconds: Double(maxMin * 60))
                current = runner
                let bridge = self
                result = await runner.run { step in
                    Task { @MainActor in
                        bridge.detail = step
                        Log.write("  · \(step)")
                        await bridge.touch(id, note: step)
                    }
                }
                current = nil
            } catch {
                result = ProcessResult(ok: false, text: error.localizedDescription)
            }
        } else {
            result = ProcessResult(ok: false, text: "nie znaleziono Claude Code na tym Macu. Zainstaluj go i zaloguj się (w Terminalu: claude, potem /login) albo wskaż ścieżkę w Ustawieniach.")
        }
        keep.cancel()

        var outcome = Outcome.done
        var note = String(result.text.prefix(600))
        if result.ok {
            state = .idle
            until = nil
            runs += 1
            detail = ""
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
        _ = try? await request("PATCH", "/api/bridge/run/\(id)", body: ["outcome": outcome.rawValue, "note": note])
        Log.write("\(result.ok ? "✓" : "✗") bieg \(id.prefix(8)) (\(outcome.rawValue)): \(note.prefix(200))")
        return outcome
    }
}
