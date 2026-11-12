// Paczka 60: sygnał w chwili zmiany (Supabase Realtime). Zamiast pytać Task Hub co 15 s, mostek słucha kanału, na który baza wysyła
// krótki sygnał „coś się zmieniło” (bez danych), i dopiero wtedy pyta. Adres i nazwę kanału podaje Task Hub w odpowiedzi /api/bridge/work.
// Minimalny klient protokołu Phoenix 1.0: dołącz do kanału, bij serce co 25 s, przy zerwaniu łącz ponownie (2 s, 4 s, … do 60 s).
import Foundation

@MainActor
final class LiveSignal {
    private(set) var joined = false          // kanał działa: mostek może pytać rzadko
    private(set) var lastSignal: Date? = nil
    private var socket = ""
    private var topic = ""
    private var task: URLSessionWebSocketTask? = nil
    private var loop: Task<Void, Never>? = nil
    private var beat: Task<Void, Never>? = nil
    private var ref = 0
    private let onSignal: (String) -> Void   // nazwa tabeli, w której coś się zmieniło

    init(onSignal: @escaping (String) -> Void) { self.onSignal = onSignal }

    // wołane po każdym pytaniu mostka: łączy się, gdy kanał jest nowy albo zmieniony; ten sam = nic
    func ensure(socket: String, topic: String) {
        if socket == self.socket && topic == self.topic && loop != nil { return }
        stop()
        self.socket = socket
        self.topic = topic
        Log.write("sygnał: łączę z kanałem zmian")
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        loop?.cancel(); loop = nil
        beat?.cancel(); beat = nil
        task?.cancel(with: .goingAway, reason: nil); task = nil
        joined = false
        socket = ""; topic = ""
    }

    private func send(_ t: URLSessionWebSocketTask, _ topic: String, _ event: String, _ payload: [String: Any]) async {
        ref += 1
        let msg: [String: Any] = ["topic": topic, "event": event, "payload": payload, "ref": String(ref)]
        guard let d = try? JSONSerialization.data(withJSONObject: msg), let s = String(data: d, encoding: .utf8) else { return }
        try? await t.send(.string(s))
    }

    private func run() async {
        var wait: Double = 2
        while !Task.isCancelled {
            guard let url = URL(string: socket) else { return }
            let t = URLSession.shared.webSocketTask(with: url)
            task = t
            t.resume()
            let channel = "realtime:\(topic)"
            await send(t, channel, "phx_join", ["config": ["broadcast": ["self": false, "ack": false], "presence": ["key": ""], "private": false]])
            beat?.cancel()
            beat = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
                    await self?.send(t, "phoenix", "heartbeat", [:])
                }
            }
            do {
                while !Task.isCancelled {
                    let m = try await t.receive()
                    var text = ""
                    switch m {
                    case .string(let s): text = s
                    case .data(let d): text = String(data: d, encoding: .utf8) ?? ""
                    @unknown default: continue
                    }
                    guard let j = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { continue }
                    let event = (j["event"] as? String) ?? ""
                    let payload = (j["payload"] as? [String: Any]) ?? [:]
                    if event == "phx_reply" && (j["topic"] as? String) == channel {
                        let ok = (payload["status"] as? String) == "ok"
                        if ok != joined { Log.write(ok ? "sygnał: kanał zmian działa" : "sygnał: kanał odrzucił dołączenie") }
                        joined = ok
                        wait = 2
                    } else if event == "broadcast" && (payload["event"] as? String) == "change" {
                        lastSignal = Date()
                        let table = ((payload["payload"] as? [String: Any])?["t"] as? String) ?? ""
                        onSignal(table)
                    } else if event == "phx_error" || event == "phx_close" {
                        break
                    }
                }
            } catch {
                if !Task.isCancelled { Log.write("sygnał: połączenie zerwane (\(error.localizedDescription)), łączę ponownie za \(Int(wait)) s") }
            }
            beat?.cancel(); beat = nil
            t.cancel(with: .goingAway, reason: nil)
            joined = false
            if Task.isCancelled { return }
            do { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) } catch { return }
            wait = min(wait * 2, 60)
        }
    }
}
