// Claude Code na tym Macu: gdzie go szukać, z jakim środowiskiem uruchamiać (bez klucza API, subskrypcja),
// próba (co Claude Code ma: narzędzia, konektory, tryb) oraz rozpoznawanie limitu i wylogowania (te same wzorce, co w skrypcie mostka).
// Pliki biegu (konektor Task Hub z tokenem biegu, ustawienia) pisze Policy do run/, poza katalogiem roboczym.
import Foundation

enum BridgeError: LocalizedError {
    case auth(String), http(Int, String), network(String), bad(String)
    var errorDescription: String? {
        switch self {
        case .auth(let s): return "Task Hub odrzucił token mostka (\(s))"
        case .http(let c, let s): return "Task Hub odpowiedział HTTP \(c)\(s.isEmpty ? "" : ": \(s)")"
        case .network(let s): return "błąd połączenia: \(s)"
        case .bad(let s): return s
        }
    }
}

enum ClaudeCLI {
    static let bridgeVersion = "2"   // v2: osobne biegi „work” i „send”, token biegu, zasady zamiast bypassPermissions
    static var userAgent: String { "TaskHubMac/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")" }

    static func candidates() -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [home + "/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude", home + "/.claude/local/claude", home + "/.npm-global/bin/claude", home + "/.volta/bin/claude"]
    }

    static func find(_ custom: String) -> String? {
        let c = custom.trimmingCharacters(in: .whitespaces)
        if !c.isEmpty { return FileManager.default.isExecutableFile(atPath: c) ? c : nil }
        return candidates().first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    static func env() -> [String: String] {
        var e = ProcessInfo.processInfo.environment
        e.removeValue(forKey: "ANTHROPIC_API_KEY")   // subskrypcja, nie faktura za tokeny
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        e["PATH"] = [home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", e["PATH"] ?? "/usr/bin:/bin"].joined(separator: ":")
        e["HOME"] = home
        if e["LANG"] == nil { e["LANG"] = "en_US.UTF-8" }
        return e
    }

    // próba: Claude Code rusza bez zadania i bez serwerów z naszego pliku, zgłasza narzędzia, konektory i tryb uprawnień,
    // a my kończymy go zaraz po zdarzeniu startowym (przed pierwszym zapytaniem do modelu, więc bez kosztu)
    static func probe(_ bin: String, restricted: Bool) async -> ProcessResult {
        let f: URL
        do { f = try Policy.writeFile(["mcpServers": [String: Any]()], name: "probe-mcp.json") } catch {
            return ProcessResult(ok: false, text: error.localizedDescription)
        }
        var args = ["-p", "ok", "--output-format", "stream-json", "--verbose", "--max-turns", "1", "--no-session-persistence",
                    "--permission-mode", "dontAsk", "--mcp-config", f.path]
        // tak jak w biegu: bez ustawień projektu z work/ (agent mógłby tam podłożyć hak, który uruchomiłby się już przy próbie)
        if restricted { args.append("--restricted") } else { args += ["--setting-sources", "user"] }
        let runner = ProcessRunner(bin: bin, args: args, cwd: Store.workDir.path, env: env(), maxSeconds: 120, stallSeconds: 120, stopAfterInit: true)
        return await runner.run { _ in }
    }

    // `claude --version` z limitem czasu; nil = nie da się uruchomić
    static func version(_ bin: String) async -> String? {
        let runner = ProcessRunner(bin: bin, args: ["--version"], cwd: Store.workDir.path, env: env(), maxSeconds: 20, stallSeconds: 20, json: false)
        let r = await runner.run { _ in }
        return r.ok ? r.text : nil
    }

    // ---------- lista konektorów tego komputera (rejestr połączeń w Task Hub) ----------
    struct McpServer {
        var name: String
        var target: String      // adres (http/sse) albo polecenie (stdio)
        var transport: String   // http, sse, stdio
        var ok: Bool
        var status: String
    }

    // `claude mcp list` pokazuje serwery MCP skonfigurowane w Claude Code na tym Macu, po jednym w linii:
    // „slack: https://mcp.slack.com/mcp (HTTP) - ✓ Connected” albo „clickup: … (HTTP) - ✗ Needs authentication”. Bez tokenów: tylko nazwy, adresy i stan.
    static func mcpList(_ bin: String) async -> [McpServer]? {
        let runner = ProcessRunner(bin: bin, args: ["mcp", "list"], cwd: Store.workDir.path, env: env(), maxSeconds: 120, stallSeconds: 120, json: false, maxText: 40_000)
        let r = await runner.run { _ in }
        return r.ok ? parseMcpList(r.text) : nil
    }

    static func parseMcpList(_ text: String) -> [McpServer] {
        var out: [McpServer] = []
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
            // konektory z konta Claude mają nazwę ze spacją („claude.ai Gmail”); inne nazwy ze spacją to komunikaty („Checking MCP server health...”)
            guard !name.isEmpty, !name.contains(" ") || name.hasPrefix("claude.ai "), !name.hasPrefix("http") else { continue }
            var rest = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            var status = ""
            if let dash = rest.range(of: " - ", options: .backwards) {
                status = String(rest[dash.upperBound...]).trimmingCharacters(in: .whitespaces)
                rest = String(rest[..<dash.lowerBound]).trimmingCharacters(in: .whitespaces)
            }
            var transport = ""
            if rest.hasSuffix(")"), let open = rest.range(of: "(", options: .backwards) {
                transport = String(rest[rest.index(after: open.lowerBound)...].dropLast()).trimmingCharacters(in: .whitespaces).lowercased()
                rest = String(rest[..<open.lowerBound]).trimmingCharacters(in: .whitespaces)
            }
            guard !rest.isEmpty else { continue }
            // znaczek bywa różny (✓, ✔, ✗, !, ⚠), więc stan czytamy z napisu po nim
            let clean = status.trimmingCharacters(in: CharacterSet.letters.inverted.union(.whitespaces))
            let ok = clean.lowercased().hasPrefix("connected")
            if transport.isEmpty { transport = rest.hasPrefix("http") ? "http" : "stdio" }
            out.append(McpServer(name: name, target: rest, transport: transport, ok: ok, status: clean))
        }
        return out
    }

    static let limitPattern = "usage limit|rate limit|limit reached|too many requests|quota|resource[_ ]?exhausted|overloaded"
    static let authPattern = "not logged in|please run /login|run /login|invalid api key|authentication[_ ]?error|failed to authenticate|unauthorized|oauth token (has )?expired|refresh token is no longer valid|could not be refreshed|session expired"
    static func isLimit(_ t: String) -> Bool { t.range(of: limitPattern, options: [.regularExpression, .caseInsensitive]) != nil }
    static func isAuth(_ t: String) -> Bool { t.range(of: authPattern, options: [.regularExpression, .caseInsensitive]) != nil }

    // czas odblokowania limitu: Claude Code podaje go jako sekundy uniksowe („…|1760630400”)
    static func resetDate(_ t: String) -> Date? {
        guard let re = try? NSRegularExpression(pattern: "\\b(1[6-9][0-9]{8})\\b"),
              let m = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)),
              let r = Range(m.range(at: 1), in: t),
              let s = Double(t[r]) else { return nil }
        return Date(timeIntervalSince1970: s)
    }

    static func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}
