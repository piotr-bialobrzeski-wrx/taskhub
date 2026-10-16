// Claude Code na tym Macu: gdzie go szukać, z jakim środowiskiem uruchamiać (bez klucza API, subskrypcja),
// konektor Task Hub w pliku mcp.json oraz rozpoznawanie limitu i wylogowania (te same wzorce, co w skrypcie mostka).
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
    static let bridgeVersion = "1"
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

    // konektor Task Hub podany wprost (bez `claude mcp add`); plik tylko dla właściciela, token nie trafia do listy procesów
    static func writeMcpConfig(url: String, token: String) throws -> URL {
        let f = Store.workDir.appendingPathComponent("mcp.json")
        let cfg: [String: Any] = ["mcpServers": ["task-hub": ["type": "http", "url": url, "headers": ["Authorization": "Bearer \(token)"]]]]
        let d = try JSONSerialization.data(withJSONObject: cfg)
        try FileManager.default.createDirectory(at: Store.workDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try d.write(to: f, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: f.path)
        return f
    }

    // `claude --version` z limitem czasu; nil = nie da się uruchomić
    static func version(_ bin: String) async -> String? {
        let runner = ProcessRunner(bin: bin, args: ["--version"], cwd: Store.workDir.path, env: env(), maxSeconds: 20, stallSeconds: 20, json: false)
        let r = await runner.run { _ in }
        return r.ok ? r.text : nil
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
