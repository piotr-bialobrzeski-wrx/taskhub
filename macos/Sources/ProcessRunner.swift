// Jeden bieg Claude Code (`claude -p … --output-format stream-json`): czyta zdarzenia na bieżąco, przekazuje użycia narzędzi
// jako postęp, bierze wynik z ostatniego zdarzenia „result”. Strażnik: brak sygnału przez 10 min albo bieg dłuższy niż limit → przerwanie.
// Zdarzenie startowe (system/init) mówi, z jakimi zasadami Claude Code naprawdę ruszył: sprawdzamy je, zanim użyje narzędzia.
// Przerwanie zabija całe drzewo procesów (claude, jego powłoki, serwery MCP), nie tylko sam proces claude.
import Darwin
import Foundation

struct McpStatus {
    var name: String
    var status: String      // connected, failed, needs-auth, pending…
}

// co Claude Code zgłosił na starcie: tryb uprawnień, narzędzia (po blokadach), serwery MCP
struct InitInfo {
    var permissionMode: String?
    var version: String
    var tools: [String]
    var servers: [McpStatus]

    init(_ ev: [String: Any]) {
        permissionMode = ev["permissionMode"] as? String
        version = (ev["claude_code_version"] as? String) ?? (ev["version"] as? String) ?? ""
        tools = ((ev["tools"] as? [Any]) ?? []).compactMap { $0 as? String }
        let list = ((ev["mcp_servers"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }
        servers = list.map { McpStatus(name: ($0["name"] as? String) ?? "", status: ($0["status"] as? String) ?? "") }
    }
}

struct ProcessResult {
    var ok: Bool
    var text: String      // odpowiedź Claude albo opis błędu
    var initInfo: InitInfo? = nil
}

final class ProcessRunner {
    private let bin: String
    private let args: [String]
    private let cwd: String
    private let env: [String: String]
    private let maxSeconds: Double
    private let stallSeconds: Double
    private let json: Bool
    private let maxText: Int   // ile znaków wyjścia zwrócić bez stream-json (wersja: koniec; lista konektorów: całość)
    private let onInit: (@Sendable (InitInfo) -> String?)?   // nil = zasady w porządku; tekst = przerwij bieg z tym powodem
    private let stopAfterInit: Bool                          // próba: wystarczy zdarzenie startowe

    private let queue = DispatchQueue(label: "taskhub.process")
    private let proc = Process()
    private var out = Data()
    private var err = Data()
    private var buf = Data()
    private var finalEvent: [String: Any]? = nil
    private var initInfo: InitInfo? = nil
    private var probeDone = false
    private var killing = false
    private var lastData = Date()
    private var started = Date()
    private var finished = false
    private var terminated = false
    private var outClosed = false
    private var errClosed = false
    private var killedWhy: String? = nil
    private var timer: DispatchSourceTimer? = nil
    private var done: ((ProcessResult) -> Void)? = nil

    init(bin: String, args: [String], cwd: String, env: [String: String], maxSeconds: Double, stallSeconds: Double = 600, json: Bool = true, maxText: Int = 600,
         onInit: (@Sendable (InitInfo) -> String?)? = nil, stopAfterInit: Bool = false) {
        self.bin = bin; self.args = args; self.cwd = cwd; self.env = env
        self.maxSeconds = maxSeconds; self.stallSeconds = stallSeconds; self.json = json; self.maxText = maxText
        self.onInit = onInit; self.stopAfterInit = stopAfterInit
    }

    private var name: String { (bin as NSString).lastPathComponent }

    // wait: przy zamykaniu aplikacji sygnał musi wyjść, zanim proces aplikacji zniknie
    func kill(_ why: String = "przerwany", wait: Bool = false) {
        let work = {
            if self.killedWhy == nil { self.killedWhy = why }
            self.killTree()
        }
        if wait { queue.sync(execute: work) } else { queue.async(execute: work) }
    }

    func run(onStep: @escaping @Sendable (String) -> Void) async -> ProcessResult {
        await withCheckedContinuation { (cont: CheckedContinuation<ProcessResult, Never>) in
            queue.async {
                self.launch(onStep: onStep) { r in cont.resume(returning: r) }
            }
        }
    }

    private func launch(onStep: @escaping @Sendable (String) -> Void, done: @escaping (ProcessResult) -> Void) {
        self.done = done
        if killedWhy != nil { finish(); return }   // zatrzymany, zanim ruszył
        proc.executableURL = URL(fileURLWithPath: bin)
        proc.arguments = args
        proc.currentDirectoryURL = URL(fileURLWithPath: cwd)
        proc.environment = env
        let o = Pipe(), e = Pipe()
        proc.standardOutput = o
        proc.standardError = e
        proc.standardInput = FileHandle.nullDevice

        o.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard let self = self else { return }
            if d.isEmpty {
                h.readabilityHandler = nil
                self.queue.async { self.outClosed = true; self.maybeFinish() }
                return
            }
            self.queue.async {
                self.lastData = Date()
                self.out.append(d)
                if self.json { self.buf.append(d); self.drain(onStep: onStep) }
            }
        }
        e.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard let self = self else { return }
            if d.isEmpty {
                h.readabilityHandler = nil
                self.queue.async { self.errClosed = true; self.maybeFinish() }
                return
            }
            self.queue.async { self.lastData = Date(); self.err.append(d) }
        }
        proc.terminationHandler = { [weak self] _ in
            guard let self = self else { return }
            self.queue.async { self.terminated = true; self.maybeFinish() }
            // gdyby potoki nie domknęły się same (dzieci claude trzymają je otwarte)
            self.queue.asyncAfter(deadline: .now() + 2) { self.finish() }
        }

        let t = DispatchSource.makeTimerSource(queue: queue)
        timer = t
        t.schedule(deadline: .now() + 15, repeating: 15)
        t.setEventHandler { [weak self] in
            guard let self = self, self.proc.isRunning else { return }
            if Date().timeIntervalSince(self.lastData) > self.stallSeconds {
                if self.killedWhy == nil { self.killedWhy = "\(self.name) nie dał znaku życia przez \(Int(self.stallSeconds / 60)) min, proces przerwany" }
                self.killTree()
            } else if Date().timeIntervalSince(self.started) > self.maxSeconds {
                if self.killedWhy == nil { self.killedWhy = "bieg przekroczył \(Int(self.maxSeconds / 60)) min, proces przerwany" }
                self.killTree()
            }
        }
        t.resume()

        do {
            try proc.run()
            started = Date()
            lastData = Date()
        } catch {
            let hint = name == "claude" ? " Zainstaluj Claude Code i zaloguj się (w Terminalu: claude, potem /login) albo wskaż ścieżkę w Ustawieniach." : ""
            killedWhy = "nie udało się uruchomić „\(bin)”: \(error.localizedDescription).\(hint)"
            finish()
        }
    }

    // SIGTERM do claude, jego grupy i wszystkich potomków (powłoki, serwery MCP); po 5 s SIGKILL do tych, które zostały
    private func killTree() {
        let pid = proc.processIdentifier
        guard pid > 0, !killing else { return }
        killing = true
        let kids = ProcessRunner.descendants(of: pid)
        _ = Darwin.kill(-pid, SIGTERM)
        _ = Darwin.kill(pid, SIGTERM)
        for k in kids { _ = Darwin.kill(k, SIGTERM) }
        queue.asyncAfter(deadline: .now() + 5) {
            let late = ProcessRunner.descendants(of: pid)
            for k in kids + late where Darwin.kill(k, 0) == 0 { _ = Darwin.kill(k, SIGKILL) }
            if self.proc.isRunning { _ = Darwin.kill(pid, SIGKILL) }
            _ = Darwin.kill(-pid, SIGKILL)
        }
    }

    // potomkowie procesu (dzieci, wnuki…) z `ps`; zbierane przed zabiciem, bo osierocone dzieci przechodzą do launchd
    static func descendants(of root: Int32) -> [Int32] {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/ps")
        p.arguments = ["-axo", "pid=,ppid="]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return [] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        var children: [Int32: [Int32]] = [:]
        for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
            let f = line.split(separator: " ", omittingEmptySubsequences: true)
            guard f.count >= 2, let pid = Int32(f[0]), let ppid = Int32(f[1]) else { continue }
            children[ppid, default: []].append(pid)
        }
        var found: [Int32] = []
        var stack: [Int32] = [root]
        while let x = stack.popLast() {
            for c in children[x] ?? [] where c != root && !found.contains(c) {
                found.append(c)
                stack.append(c)
            }
        }
        return found
    }

    private func maybeFinish() {
        if terminated && outClosed && errClosed { finish() }
    }

    private func finish() {
        guard !finished, let done = done else { return }
        finished = true
        timer?.cancel()
        timer = nil
        if probeDone { done(ProcessResult(ok: true, text: "", initInfo: initInfo)); return }
        if let why = killedWhy { done(ProcessResult(ok: false, text: why, initInfo: initInfo)); return }
        let code: Int32 = proc.isRunning ? -1 : proc.terminationStatus
        if json && onInit != nil && initInfo == nil {
            done(ProcessResult(ok: false, text: "Claude Code nie przyjął zasad mostka (brak zdarzenia startowego)"))
            return
        }
        if json, let f = finalEvent {
            let isError = (f["is_error"] as? Bool) ?? false
            let subtype = f["subtype"] as? String
            let bad = isError || (subtype != nil && subtype != "success")
            var detail = (f["result"] as? String) ?? ""
            if detail.isEmpty, let errs = f["errors"] as? [Any] { detail = errs.compactMap { $0 as? String }.joined(separator: "; ") }
            if bad { done(ProcessResult(ok: false, text: detail.isEmpty ? "claude: \(subtype ?? "error")" : detail, initInfo: initInfo)) }
            else { done(ProcessResult(ok: true, text: detail, initInfo: initInfo)) }
            return
        }
        let errText = String(data: err, encoding: .utf8) ?? ""
        let outText = String(data: out, encoding: .utf8) ?? ""
        let tail = String((errText.isEmpty ? outText : errText).suffix(400)).trimmingCharacters(in: .whitespacesAndNewlines)
        if code != 0 { done(ProcessResult(ok: false, text: "\(name) zakończył się kodem \(code): \(tail.isEmpty ? "(bez komunikatu)" : tail)", initInfo: initInfo)); return }
        if json { done(ProcessResult(ok: false, text: "brak wyniku z \(name): \(tail)", initInfo: initInfo)) }
        else { done(ProcessResult(ok: true, text: String(outText.trimmingCharacters(in: .whitespacesAndNewlines).suffix(maxText)))) }
    }

    // linie stream-json: init → kontrola zasad, użycia narzędzi → postęp, zdarzenie result → wynik
    private func drain(onStep: @escaping @Sendable (String) -> Void) {
        while let nl = buf.firstIndex(of: 0x0A) {
            let line = buf.subdata(in: buf.startIndex..<nl)
            buf.removeSubrange(buf.startIndex...nl)
            guard !line.isEmpty, let ev = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], let type = ev["type"] as? String else { continue }
            if type == "system", (ev["subtype"] as? String) == "init" {
                let info = InitInfo(ev)
                initInfo = info
                if stopAfterInit {
                    probeDone = true
                    killTree()
                } else if let check = onInit, let why = check(info) {
                    if killedWhy == nil { killedWhy = why }
                    killTree()
                }
                continue
            }
            if killing { continue }
            if type == "assistant", let m = ev["message"] as? [String: Any], let content = m["content"] as? [[String: Any]] {
                if onInit != nil && initInfo == nil {
                    // narzędzie przed zdarzeniem startowym: nie wiemy, z jakimi zasadami ruszył, więc przerywamy
                    if killedWhy == nil { killedWhy = "Claude Code nie przyjął zasad mostka (brak zdarzenia startowego)" }
                    killTree()
                    continue
                }
                for b in content where (b["type"] as? String) == "tool_use" { onStep(ProcessRunner.label(b)) }
            } else if type == "result" {
                finalEvent = ev
            }
        }
    }

    // etykieta użycia narzędzia dla podglądu postępu w Task Hub: „add_steps: abc”
    static func label(_ b: [String: Any]) -> String {
        var name = (b["name"] as? String) ?? "narzędzie"
        if let n = Policy.split(name) { name = n.tool }
        let inp = (b["input"] as? [String: Any]) ?? [:]
        for k in ["title", "query", "summary", "stepId", "taskId", "command"] {
            if let v = inp[k] as? String, !v.isEmpty { return "\(name): \(String(v.prefix(60)))" }
        }
        return name
    }
}
