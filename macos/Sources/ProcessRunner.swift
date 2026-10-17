// Jeden bieg Claude Code (`claude -p … --output-format stream-json`): czyta zdarzenia na bieżąco, przekazuje użycia narzędzi
// jako postęp, bierze wynik z ostatniego zdarzenia „result”. Strażnik: brak sygnału przez 10 min albo bieg dłuższy niż limit → przerwanie.
import Foundation

struct ProcessResult {
    var ok: Bool
    var text: String      // odpowiedź Claude albo opis błędu
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

    private let queue = DispatchQueue(label: "taskhub.process")
    private let proc = Process()
    private var out = Data()
    private var err = Data()
    private var buf = Data()
    private var finalEvent: [String: Any]? = nil
    private var lastData = Date()
    private var started = Date()
    private var finished = false
    private var terminated = false
    private var outClosed = false
    private var errClosed = false
    private var killedWhy: String? = nil
    private var timer: DispatchSourceTimer? = nil
    private var done: ((ProcessResult) -> Void)? = nil

    init(bin: String, args: [String], cwd: String, env: [String: String], maxSeconds: Double, stallSeconds: Double = 600, json: Bool = true, maxText: Int = 600) {
        self.bin = bin; self.args = args; self.cwd = cwd; self.env = env
        self.maxSeconds = maxSeconds; self.stallSeconds = stallSeconds; self.json = json; self.maxText = maxText
    }

    func kill(_ why: String = "przerwany") {
        queue.async {
            if self.killedWhy == nil { self.killedWhy = why }
            if self.proc.isRunning { self.proc.terminate() }
        }
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
            // gdyby potoki nie domknęły się same
            self.queue.asyncAfter(deadline: .now() + 2) { self.finish() }
        }

        let t = DispatchSource.makeTimerSource(queue: queue)
        timer = t
        t.schedule(deadline: .now() + 15, repeating: 15)
        t.setEventHandler { [weak self] in
            guard let self = self, self.proc.isRunning else { return }
            if Date().timeIntervalSince(self.lastData) > self.stallSeconds {
                self.killedWhy = "Claude nie dał znaku życia przez \(Int(self.stallSeconds / 60)) min, proces przerwany"
                self.proc.terminate()
            } else if Date().timeIntervalSince(self.started) > self.maxSeconds {
                self.killedWhy = "bieg przekroczył \(Int(self.maxSeconds / 60)) min, proces przerwany"
                self.proc.terminate()
            }
        }
        t.resume()

        do {
            try proc.run()
            started = Date()
            lastData = Date()
        } catch {
            killedWhy = "nie udało się uruchomić „\(bin)”: \(error.localizedDescription). Zainstaluj Claude Code i zaloguj się (w Terminalu: claude, potem /login) albo wskaż ścieżkę w Ustawieniach."
            finish()
        }
    }

    private func maybeFinish() {
        if terminated && outClosed && errClosed { finish() }
    }

    private func finish() {
        guard !finished, let done = done else { return }
        finished = true
        timer?.cancel()
        timer = nil
        if let why = killedWhy { done(ProcessResult(ok: false, text: why)); return }
        let code: Int32 = proc.isRunning ? -1 : proc.terminationStatus
        if json, let f = finalEvent {
            let isError = (f["is_error"] as? Bool) ?? false
            let subtype = f["subtype"] as? String
            let bad = isError || (subtype != nil && subtype != "success")
            var detail = (f["result"] as? String) ?? ""
            if detail.isEmpty, let errs = f["errors"] as? [Any] { detail = errs.compactMap { $0 as? String }.joined(separator: "; ") }
            if bad { done(ProcessResult(ok: false, text: detail.isEmpty ? "claude: \(subtype ?? "error")" : detail)) }
            else { done(ProcessResult(ok: true, text: detail)) }
            return
        }
        let errText = String(data: err, encoding: .utf8) ?? ""
        let outText = String(data: out, encoding: .utf8) ?? ""
        let tail = String((errText.isEmpty ? outText : errText).suffix(400)).trimmingCharacters(in: .whitespacesAndNewlines)
        if code != 0 { done(ProcessResult(ok: false, text: "claude zakończył się kodem \(code): \(tail.isEmpty ? "(bez komunikatu)" : tail)")); return }
        if json { done(ProcessResult(ok: false, text: "brak wyniku z claude: \(tail)")) }
        else { done(ProcessResult(ok: true, text: String(outText.trimmingCharacters(in: .whitespacesAndNewlines).suffix(maxText)))) }
    }

    // linie stream-json: użycia narzędzi → postęp, zdarzenie result → wynik
    private func drain(onStep: @escaping @Sendable (String) -> Void) {
        while let nl = buf.firstIndex(of: 0x0A) {
            let line = buf.subdata(in: buf.startIndex..<nl)
            buf.removeSubrange(buf.startIndex...nl)
            guard !line.isEmpty, let ev = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], let type = ev["type"] as? String else { continue }
            if type == "assistant", let m = ev["message"] as? [String: Any], let content = m["content"] as? [[String: Any]] {
                for b in content where (b["type"] as? String) == "tool_use" { onStep(ProcessRunner.label(b)) }
            } else if type == "result" {
                finalEvent = ev
            }
        }
    }

    // etykieta użycia narzędzia dla podglądu postępu w Task Hub: „add_steps: abc”
    static func label(_ b: [String: Any]) -> String {
        var name = (b["name"] as? String) ?? "narzędzie"
        if name.hasPrefix("mcp__") {
            let parts = name.split(separator: "_", omittingEmptySubsequences: true)
            if parts.count >= 3 { name = parts.dropFirst(2).joined(separator: "_") }
        }
        let inp = (b["input"] as? [String: Any]) ?? [:]
        for k in ["title", "query", "summary", "stepId", "taskId", "command"] {
            if let v = inp[k] as? String, !v.isEmpty { return "\(name): \(String(v.prefix(60)))" }
        }
        return name
    }
}
