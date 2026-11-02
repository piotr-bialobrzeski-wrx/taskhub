// Codex CLI na tym Macu (paczka 40): drugi wykonawca obok Claude Code, wybierany przełącznikiem „Agent: Claude | GPT” w Task Hub.
// Logowanie kontem ChatGPT (`codex login`, subskrypcja), bez klucza API: klucze OPENAI_API_KEY i CODEX_API_KEY nie idą do procesu.
// Bieg: `codex exec --json` z jednym serwerem MCP (Task Hub, token biegu ze zmiennej środowiska, bez pliku na dysku), bez innych serwerów
// z ~/.codex/config.toml, piaskownica tylko do odczytu, bez powłoki. Narzędzia MCP muszą mieć default_tools_approval_mode = "auto",
// inaczej codex exec anuluje ich wywołania (czeka na zgodę, której w tle nikt nie da).
import Foundation

enum CodexCLI {
    static let hub = "taskhub"            // nazwa serwera MCP Task Hub w biegu Codex
    static let tokenEnv = "TASKHUB_RUN_TOKEN"

    enum State: String { case ready, auth, missing }

    static func candidates() -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", home + "/.local/bin/codex", home + "/.npm-global/bin/codex", home + "/.volta/bin/codex", home + "/.bun/bin/codex"]
    }

    static func find(_ custom: String) -> String? {
        let c = custom.trimmingCharacters(in: .whitespaces)
        if !c.isEmpty { return FileManager.default.isExecutableFile(atPath: c) ? c : nil }
        return candidates().first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    static func env(token: String? = nil) -> [String: String] {
        var e = ClaudeCLI.env()
        e.removeValue(forKey: "OPENAI_API_KEY")   // subskrypcja ChatGPT, nie faktura za tokeny
        e.removeValue(forKey: "CODEX_API_KEY")
        e.removeValue(forKey: tokenEnv)
        if let t = token { e[tokenEnv] = t }
        return e
    }

    static func version(_ bin: String) async -> String? {
        let runner = ProcessRunner(bin: bin, args: ["--version"], cwd: Store.workDir.path, env: env(), maxSeconds: 20, stallSeconds: 20, json: false)
        let r = await runner.run { _ in }
        return r.ok ? r.text : nil
    }

    // `codex login status`: „Logged in using ChatGPT” (kod 0) albo „Not logged in” (kod 1); logowanie kluczem API też liczymy jako brak,
    // bo praca ma iść na subskrypcji. Komunikat Codex pisze na stderr
    static func loginState(_ bin: String) async -> (State, String) {
        let runner = ProcessRunner(bin: bin, args: ["login", "status"], cwd: Store.workDir.path, env: env(), maxSeconds: 30, stallSeconds: 30, json: false, maxText: 400, mergeErr: true)
        let r = await runner.run { _ in }
        let t = r.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if r.ok && t.range(of: "chatgpt", options: .caseInsensitive) != nil { return (.ready, "zalogowany kontem ChatGPT") }
        if r.ok && t.range(of: "api key", options: .caseInsensitive) != nil { return (.auth, "zalogowany kluczem API; potrzebne konto ChatGPT (codex logout, potem codex login)") }
        return (.auth, "wylogowany (w Terminalu: codex login, „Sign in with ChatGPT”)")
    }

    // napis TOML w cudzysłowie (adres, nazwa modelu): tylko bezpieczne znaki, reszta odrzucona wcześniej
    static func toml(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    struct Plan { var args: [String]; var env: [String: String] }

    // argumenty biegu pracy; prompt idzie jako ostatni argument (kilkanaście KB, daleko od limitu systemu)
    static func work(prompt: String, mcp: String, token: String, model: String, effort: String, disabled: [String]) throws -> Plan {
        guard let u = URL(string: mcp), u.scheme == "https" || Store.isLocalHost(u.host) else { throw PolicyError("Task Hub podał zły adres konektora dla Codex") }
        guard token.count >= 16 else { throw PolicyError("Task Hub nie podał tokenu biegu dla Codex") }
        let safe = "^[A-Za-z0-9._-]{1,64}$"
        let tools = disabled.filter { $0.range(of: safe, options: .regularExpression) != nil }.map(toml).joined(separator: ",")
        // całe mcp_servers podmienione: w biegu nie ma serwerów z ~/.codex/config.toml, tylko Task Hub z tokenem biegu
        let server = "{\(hub)={url=\(toml(mcp)),bearer_token_env_var=\(toml(tokenEnv)),default_tools_approval_mode=\"auto\",disabled_tools=[\(tools)],startup_timeout_sec=30,tool_timeout_sec=120}}"
        var args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", Store.workDir.path,
                    "-c", "mcp_servers=\(server)",
                    "-c", "approval_policy=\"never\"",
                    "-c", "tools.web_search=true",
                    "-c", "features.shell_tool=false"]
        if model.range(of: safe, options: .regularExpression) != nil { args += ["-m", model] }
        if ["low", "medium", "high"].contains(effort) { args += ["-c", "model_reasoning_effort=\(toml(effort))"] }
        args.append(prompt)
        return Plan(args: args, env: env(token: token))
    }

    // etykieta wywołania narzędzia dla podglądu postępu w Task Hub: „add_steps: abc”
    static func label(tool: String, arguments: Any?) -> String {
        var inp = arguments as? [String: Any] ?? [:]
        if inp.isEmpty, let s = arguments as? String, let d = s.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { inp = o }
        for k in ["title", "query", "summary", "stepId", "taskId"] {
            if let v = inp[k] as? String, !v.isEmpty { return "\(tool): \(String(v.prefix(60)))" }
        }
        return tool
    }
}
