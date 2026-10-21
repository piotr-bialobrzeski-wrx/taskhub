// Zasady biegów mostka (od 0.1.7): Claude Code dostaje listę dozwolonych narzędzi zamiast pełnej swobody.
// Bieg „work” czyta konektory, a pisze tylko w work/ i w folderach z kodem; bieg „send” wysyła jeden zatwierdzony szkic
// jednym konektorem. Zasady idą w argumentach i w pliku ustawień biegu (piaskownica, strażnik). Gdy czegoś nie da się
// zbudować albo sprawdzić, bieg nie rusza: nigdy nie wracamy do bypassPermissions.
// Nazwy kluczy i składnię reguł sprawdziliśmy na Claude Code 2.1.304 (notatka e0-policy-tests).
import Foundation

struct PolicyError: LocalizedError {
    let text: String
    init(_ t: String) { text = t }
    var errorDescription: String? { text }
}

// wersja Claude Code z „2.1.304 (Claude Code)”
struct CCVersion: Equatable, Comparable, CustomStringConvertible {
    let parts: [Int]

    init(_ a: Int, _ b: Int, _ c: Int) { parts = [a, b, c] }

    init?(_ text: String) {
        guard let re = try? NSRegularExpression(pattern: "(\\d+)\\.(\\d+)\\.(\\d+)"),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        var p: [Int] = []
        for i in 1...3 {
            guard let r = Range(m.range(at: i), in: text), let n = Int(text[r]) else { return nil }
            p.append(n)
        }
        parts = p
    }

    static func < (a: CCVersion, b: CCVersion) -> Bool { a.parts.lexicographicallyPrecedes(b.parts) }
    var description: String { parts.map { String($0) }.joined(separator: ".") }
}

// wynik próby: co Claude Code na tym Macu ma (narzędzia, konektory) i co z tego wolno nam użyć
struct Probe {
    var bin: String
    var version: CCVersion
    var info: InitInfo
    var restricted: Bool        // --restricted nie ukrył konektorów, więc go używamy
    var at: Date

    var prompts: Bool { version >= Policy.promptsFrom }       // --permission-prompts none
    var onFailure: Bool { version >= Policy.onFailureFrom }   // hook z onFailure: "block"
}

// gotowy bieg: argumenty, środowisko i pliki do skasowania po biegu
struct RunPlan {
    var args: [String]
    var env: [String: String]
    var files: [URL]
    var canary: String          // narzędzie zablokowane tylko w pliku ustawień: jego brak w init = plik przyjęty
    var mustLack: [String]      // narzędzia zablokowane w argumentach: init nie może ich pokazać
    var known: Set<String> = [] // narzędzia z próby: konektor, którego próba nie widziała, nie ma reguły (blokuje go strażnik, po biegu nowa próba)
}

struct McpName {
    var server: String
    var tool: String
}

enum Policy {
    static let minVersion = CCVersion(2, 1, 200)
    static let restrictedFrom = CCVersion(2, 1, 248)
    static let promptsFrom = CCVersion(2, 1, 259)
    static let onFailureFrom = CCVersion(2, 1, 295)

    static let hub = "task-hub"     // serwer MCP Task Hub w pliku biegu (token biegu)
    static let readVerbs = ["get", "list", "search", "read", "find", "fetch", "query", "describe", "download", "lookup", "view", "check", "count", "whoami"]
    // słowa zapisu porównywane jako całe człony nazwy (rzeczowniki jak draft, label, run, link, tag nie przeszkadzają w czytaniu)
    static let writeWords: Set<String> = ["send", "create", "update", "delete", "trash", "move", "merge", "share", "reply", "forward", "respond", "schedule", "add", "remove", "upload",
                                          "attach", "start", "stop", "set", "mark", "write", "post", "comment", "react", "archive", "invite", "publish", "edit", "modify", "insert",
                                          "patch", "put", "upsert", "save", "assign", "approve", "close", "complete", "submit", "cancel", "transfer", "import", "apply", "execute",
                                          "enable", "disable", "rename", "restore", "subscribe", "unsubscribe", "pin", "unpin", "fork", "untrash", "unlabel", "unmark"]
    // znane narzędzia czytające z czasownikiem na końcu (GitHub, ClickUp, Kalendarz Google)
    static let readAllow = ["pull_request_read", "issue_read", "filter_tasks", "suggest_time", "resolve_assignees"]
    static let bashAllow = ["git status", "git diff", "git log", "git show", "git branch", "git switch", "git checkout", "git stash", "git restore", "git rev-parse", "git ls-files", "git add", "npm", "npx", "node", "pnpm", "yarn", "tsc", "vitest", "jest", "ls", "pwd", "mkdir", "mv", "cp", "touch", "cat", "head", "tail", "wc", "sort", "diff", "grep", "find", "sed -n", "echo", "which"]
    static let bashDeny = ["git push", "git remote", "git config", "git commit", "git commit-tree", "git update-ref", "git reset", "git rebase", "git merge",
                           "git cherry-pick", "git am", "git revert", "git replace", "curl", "wget", "ssh", "scp", "rsync", "nc", "security", "osascript", "open", "sudo", "launchctl", "defaults", "crontab"]
    static let npmDomains = ["registry.npmjs.org", "*.npmjs.org", "registry.yarnpkg.com"]
    // kandydaci na narzędzie-próbkę (pierwsze, które próba pokazała i którego bieg i tak nie potrzebuje)
    static let canaries = ["NotebookEdit", "EnterWorktree", "ExitWorktree", "CronCreate", "CronDelete", "CronList", "Monitor", "PushNotification", "ScheduleWakeup", "RemoteTrigger", "Agent", "Task"]
    static let sendHubTools = ["get_task", "get_rules", "list_connections", "add_facts", "complete_step", "leave_step"]
    // w folderach z kodem piaskownica nie zapisze tego, co uruchamia programy poza nią (haki i ustawienia gita, ustawienia
    // edytorów i Claude Code); dla work/ Claude Code chroni to sam (sprawdzone na 2.1.304: echo >> .git/config = Read-only file system)
    static let protectedInRepo = [".git/hooks", ".git/config", ".git/config.worktree", ".git/info", ".git/modules", ".git/worktrees",
                                  ".git/commondir", ".gitmodules", ".claude", ".mcp.json", ".vscode", ".idea"]

    // ---------- sekrety: tego agent nie czyta (tokeny, ciasteczka okna aplikacji, klucze) ----------
    static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }

    static func secretDirs() -> [String] {
        let h = home
        return [Store.runDir.path, h + "/.taskhub-bridge", h + "/Library/WebKit", h + "/Library/HTTPStorages", h + "/Library/Cookies",
                h + "/Library/Keychains", h + "/.ssh", h + "/.aws", h + "/.config/gh", h + "/.docker", h + "/.kube", h + "/.config/gcloud",
                h + "/.gnupg", h + "/.supabase", h + "/Library/Application Support/com.vercel.cli"]
    }

    static func secretFiles() -> [String] {
        let h = home
        return [Store.file.path, h + "/.npmrc", h + "/.netrc", h + "/.git-credentials", h + "/.claude/.credentials.json", h + "/.claude.json",
                h + "/.pgpass", h + "/.zsh_history", h + "/.bash_history"]
    }

    // reguły Read(//ścieżka): podwójny ukośnik = ścieżka bezwzględna; Read blokuje też Edit i Write
    static func secretReadRules() -> [String] {
        secretDirs().map { "Read(/\($0)/**)" } + secretFiles().map { "Read(/\($0))" }
    }

    // ścieżka nadaje się do reguł (wzorce jak w .gitignore) i do listy TASKHUB_ALLOWED_DIRS (dwukropek dzieli)
    static func ruleSafe(_ p: String) -> Bool {
        p.hasPrefix("/") && p.count > 1 && !p.contains { "*?[]\\:\n\r\"".contains($0) }
    }

    // foldery z kodem (albo na pliki) z Ustawień, sprawdzone tak samo jak przy dodawaniu; złe pomijamy (zasady są wtedy węższe, nie szersze)
    static func codeFolders(_ list: [String], what: String = "folder z kodem") -> [String] {
        var out: [String] = []
        for raw in list {
            let p = Store.normalizedFolder(URL(fileURLWithPath: raw))
            if let why = Store.folderProblem(p) { Log.write("\(what) pominięty (\(raw)): \(why)"); continue }
            guard ruleSafe(p) else { Log.write("\(what) pominięty (\(raw)): ścieżka ma znak *, ?, [, ], \\, \" albo :"); continue }
            if !out.contains(p) { out.append(p) }
        }
        return out
    }

    // ---------- narzędzia konektorów ----------
    // „mcp__claude_ai_Slack__slack_read_channel” → serwer „claude_ai_Slack”, narzędzie „slack_read_channel”
    static func split(_ full: String) -> McpName? {
        guard full.hasPrefix("mcp__") else { return nil }
        let rest = String(full.dropFirst(5))
        guard let r = rest.range(of: "__") else { return nil }
        let server = String(rest[..<r.lowerBound]), tool = String(rest[r.upperBound...])
        return server.isEmpty || tool.isEmpty ? nil : McpName(server: server, tool: tool)
    }

    // nazwa serwera w nazwach narzędzi, jak w Claude Code: „claude.ai Slack” → „claude_ai_Slack”
    static func norm(_ name: String) -> String {
        var r = String(name.map { c -> Character in
            (c.isASCII && (c.isLetter || c.isNumber)) || c == "_" || c == "-" ? c : "_"
        })
        if name.hasPrefix("claude.ai ") {
            while r.contains("__") { r = r.replacingOccurrences(of: "__", with: "_") }
            while r.hasPrefix("_") { r.removeFirst() }
            while r.hasSuffix("_") { r.removeLast() }
        }
        return r
    }

    // tylko do odczytu: pierwszy człon nazwy (albo drugi, po „slack_”, „clickup_”…) to czasownik czytania, a żaden inny człon
    // nie jest słowem zapisu; do tego znane czytające z czasownikiem na końcu; nieznane = niedozwolone
    static func isReadOnly(_ tool: String) -> Bool {
        let low = tool.lowercased()
        if low.contains("execute_operator") { return false }
        for a in readAllow {
            if low == a { return true }
            if low.hasSuffix("_" + a) {
                let pre = String(low.dropLast(a.count + 1))
                if !pre.isEmpty && !pre.contains("_") && !writeWords.contains(pre) { return true }
            }
        }
        let w = words(tool)
        guard let v = w.indices.prefix(2).first(where: { readVerbs.contains(w[$0]) }) else { return false }
        return !w.indices.contains { $0 != v && writeWords.contains(w[$0]) }
    }

    // „slack_read_channel”, „notion-fetch”, „getTaskComments” → człony małymi literami
    static func words(_ name: String) -> [String] {
        var out: [String] = []
        var cur = ""
        var prevLower = false
        for ch in name {
            if ch == "_" || ch == "-" || ch == "." || ch == " " {
                if !cur.isEmpty { out.append(cur.lowercased()); cur = "" }
                prevLower = false
                continue
            }
            if ch.isUppercase && prevLower && !cur.isEmpty { out.append(cur.lowercased()); cur = "" }
            cur.append(ch)
            prevLower = ch.isLowercase || ch.isNumber
        }
        if !cur.isEmpty { out.append(cur.lowercased()) }
        return out
    }

    // narzędzia konektorów z próby (bez Task Hub mostka), podzielone na czytające i resztę
    static func connectorTools(_ info: InitInfo) -> (read: [String], write: [String]) {
        var r: [String] = [], w: [String] = []
        for t in info.tools {
            guard let n = split(t), n.server != hub else { continue }
            if isReadOnly(n.tool) { r.append(t) } else { w.append(t) }
        }
        return (r, w)
    }

    static func pickCanary(_ info: InitInfo, excluded: [String]) throws -> String {
        guard let c = canaries.first(where: { info.tools.contains($0) && !excluded.contains($0) }) else {
            throw PolicyError("Nie umiem sprawdzić, czy Claude Code przyjmie zasady mostka (brak znanego narzędzia do próby). Zaktualizuj Claude Code i aplikację Task Hub.")
        }
        return c
    }

    // ---------- pliki biegu (run/, 0600) ----------
    static func writeFile(_ obj: [String: Any], name: String) throws -> URL {
        Store.privateDir(Store.runDir)
        let f = Store.runDir.appendingPathComponent(name)
        let d = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        guard FileManager.default.createFile(atPath: f.path, contents: d, attributes: [.posixPermissions: 0o600]) else {
            throw PolicyError("Nie udało się zapisać pliku biegu \(f.lastPathComponent).")
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: f.path)
        return f
    }

    // po starcie aplikacji: resztki po przerwanych biegach (tokeny biegów) do kosza
    static func cleanRunDir() {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: Store.runDir.path) else { return }
        for n in names where n.hasSuffix("-mcp.json") || n.hasSuffix("-settings.json") {
            try? fm.removeItem(at: Store.runDir.appendingPathComponent(n))
        }
    }

    static func remove(_ files: [URL]) {
        for f in files { try? FileManager.default.removeItem(at: f) }
    }

    static func safeId(_ id: String) -> String {
        let s = String(id.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }.prefix(64))
        return s.isEmpty ? "bieg" : s
    }

    // konektor Task Hub z tokenem biegu (nigdy tokenem mostka); plik tylko dla właściciela, token nie trafia do listy procesów
    static func mcpFile(runId: String, url: String, token: String) throws -> URL {
        guard let u = URL(string: url), u.scheme == "https" || u.scheme == "http", u.host != nil else {
            throw PolicyError("Task Hub podał zły adres konektora: \(url)")
        }
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !t.contains("\n") else { throw PolicyError("Task Hub nie podał tokenu biegu. Zaktualizuj Task Hub (serwer).") }
        let server: [String: Any] = ["type": "http", "url": url, "headers": ["Authorization": "Bearer \(t)"]]
        let cfg: [String: Any] = ["mcpServers": [hub: server]]
        return try writeFile(cfg, name: safeId(runId) + "-mcp.json")
    }

    // strażnik: ta sama aplikacja wywołana z --hook-guard (bez okien); ścieżka w apostrofach, bo ma spację
    static func hooks(_ probe: Probe) throws -> [String: Any] {
        guard let exe = Bundle.main.executablePath, FileManager.default.isExecutableFile(atPath: exe) else {
            throw PolicyError("Nie znalazłem pliku aplikacji Task Hub dla strażnika biegów.")
        }
        var h: [String: Any] = ["type": "command", "command": shellQuote(exe) + " --hook-guard", "timeout": 15]
        if probe.onFailure { h["onFailure"] = "block" }   // awaria strażnika = odmowa (starsze wersje nie znają tego klucza)
        let entry: [String: Any] = ["matcher": ".*", "hooks": [h]]
        return ["PreToolUse": [entry]]
    }

    static func shellQuote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    // wspólne flagi: tryb ograniczony (tylko --settings i zarządzane), pytania o zgodę = odmowa, model
    static func common(_ probe: Probe, tools: [String], model: String) -> [String] {
        var a: [String] = []
        if probe.restricted { a += ["--restricted", "--tools", tools.joined(separator: ",")] }
        else { a += ["--setting-sources", "user"] }   // bez ustawień projektu z work/ (agent mógłby je tam podłożyć)
        if probe.prompts { a += ["--permission-prompts", "none"] }
        let m = model.trimmingCharacters(in: .whitespaces)
        if !m.isEmpty { a += ["--model", m] }
        return a
    }

    // ---------- bieg „work” ----------
    // files = foldery na pliki (kroki „Plik na Macu”): Claude tylko zapisuje tam nowe pliki; bez Read, bez Basha, bez --add-dir
    static func work(runId: String, prompt: String, mcp: String, token: String, probe: Probe, folders: [String], files: [String] = [], model: String) throws -> RunPlan {
        let work = Store.workDir.path
        guard ruleSafe(work) else { throw PolicyError("Ścieżka katalogu roboczego ma znaki, których zasady nie obsłużą: \(work)") }
        let dirs = [work] + folders
        let conn = connectorTools(probe.info)
        // WebFetch zostaje (research, ceny, dokumentacja); Read tylko w work/ i folderach z kodem, więc pliki z dysku nie mają czym wyjść
        var allow = ["mcp__" + hub, "Glob", "Grep", "TodoWrite", "ToolSearch", "WebSearch", "WebFetch"]
        for d in dirs { allow.append("Read(/\(d)/**)") }
        // duży wynik narzędzia Claude Code zapisuje w ~/.claude/projects/<katalog roboczy>/ i każe go przeczytać przez Read
        let results = home + "/.claude/projects/" + String(work.map { (c: Character) -> Character in c.isASCII && (c.isLetter || c.isNumber) ? c : "-" })
        if ruleSafe(results) { allow.append("Read(/\(results)/**)") }
        for d in dirs { allow += ["Edit(/\(d)/**)", "Write(/\(d)/**)"] }
        for d in files { allow += ["Edit(/\(d)/**)", "Write(/\(d)/**)"] }
        allow += conn.read
        if !folders.isEmpty { allow += bashAllow.map { "Bash(\($0):*)" } }
        var deny = conn.write + bashDeny.map { "Bash(\($0):*)" } + secretReadRules()
        if folders.isEmpty { deny.append("Bash") }   // bez folderów z kodem nie ma po co uruchamiać poleceń
        let canary = try pickCanary(probe.info, excluded: allow + deny)
        let hasBash = !folders.isEmpty
        let builtins: [String] = (hasBash ? ["Bash"] : []) + ["Read", "Edit", "Write", "Glob", "Grep", "TodoWrite", "ToolSearch", "WebSearch", "WebFetch", canary]
        // tryb zwykły (bez --tools): pozostałe wbudowane narzędzia z próby (Agent, NotebookEdit…) wprost zablokowane, bo reguły „allow”
        // z ~/.claude/settings.json Piotra też obowiązują; zablokowane w argumentach, więc init nie może ich pokazać
        let extra = probe.restricted ? [] : plainExtras(probe.info, keep: builtins, deny: deny)
        deny += extra
        let hk = try hooks(probe)
        let perms: [String: Any] = ["defaultMode": "dontAsk", "allow": allow, "deny": deny + [canary]]
        var locked: [String] = []
        for f in folders { locked += protectedInRepo.map { f + "/" + $0 } }
        let fs: [String: Any] = ["allowWrite": dirs + ["/tmp", "~/.npm"], "denyRead": secretDirs() + secretFiles() + files, "denyWrite": locked]
        let net: [String: Any] = ["allowedDomains": npmDomains, "allowLocalBinding": true]
        // piaskownica Basha: zapis tylko w work/, folderach z kodem i tymczasowych; sieć tylko do rejestru npm.
        // Gdy piaskownica nie wstanie, Claude Code kończy bieg (zamiast puszczać polecenia bez niej).
        let sandbox: [String: Any] = ["enabled": hasBash, "autoAllowBashIfSandboxed": hasBash, "allowUnsandboxedCommands": false,
                                      "failIfUnavailable": hasBash, "filesystem": fs, "network": net]
        let settings: [String: Any] = ["permissions": perms, "sandbox": sandbox, "hooks": hk, "disableAllHooks": false]
        let mcpF = try mcpFile(runId: runId, url: mcp, token: token)
        let setF: URL
        do { setF = try writeFile(settings, name: safeId(runId) + "-settings.json") } catch { remove([mcpF]); throw error }
        var p = prompt + (folders.isEmpty
            ? "\n\nNa tym Macu nie ma folderów z kodem: kroki z kodem oddaj przez leave_step z prośbą o dodanie folderu w Ustawieniach aplikacji."
            : "\n\nFoldery z kodem na tym Macu: " + folders.joined(separator: ", "))
        p += files.isEmpty
            ? "\n\nNa tym Macu nie ma folderów na pliki: kroki „Plik na Macu” (tool file) oddaj przez leave_step z prośbą o dodanie folderu w Ustawieniach aplikacji (Foldery na pliki)."
            : "\n\nFoldery na pliki na tym Macu (tylko nowe pliki narzędziem Write; bez czytania i bez poleceń): " + files.joined(separator: ", ")
        var args: [String] = ["-p", p, "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk",
                              "--mcp-config", mcpF.path, "--settings", setF.path, "--allowedTools"]
        args += allow
        args.append("--disallowedTools")
        args += deny
        // foldery na pliki też jako katalogi robocze (inaczej Claude Code pyta o zapis poza nimi, a w dontAsk pytanie = odmowa);
        // czytania w nich pilnuje strażnik (TASKHUB_FILE_DIRS) i denyRead piaskownicy
        if !folders.isEmpty || !files.isEmpty { args.append("--add-dir"); args += folders + files }
        args += common(probe, tools: builtins, model: model)
        var env = ClaudeCLI.env()
        env["TASKHUB_ALLOWED_DIRS"] = (dirs + files).joined(separator: ":")
        env["TASKHUB_FILE_DIRS"] = files.joined(separator: ":")
        env["TASKHUB_ALLOWED_TOOLS"] = guardTools(allow, builtins: builtins, canary: canary)
        return RunPlan(args: args, env: env, files: [mcpF, setF], canary: canary, mustLack: conn.write + (hasBash ? [] : ["Bash"]) + extra,
                       known: Set(probe.info.tools))
    }

    // lista dla strażnika (TASKHUB_ALLOWED_TOOLS): nazwy z reguł „allow” bez wzorców w nawiasach („Read(//x/**)” → „Read”,
    // „Bash(git status:*)” → „Bash”) i wbudowane narzędzia biegu bez narzędzia-próbki; „mcp__serwer” obejmuje wszystkie narzędzia serwera.
    // Czego tu nie ma, strażnik odmawia: także narzędzi konektora, który doszedł po próbie (bieg idzie dalej bez niego)
    static func guardTools(_ allow: [String], builtins: [String], canary: String) -> String {
        var out: [String] = []
        for raw in allow + builtins {
            let name = raw.split(separator: "(", maxSplits: 1).first.map(String.init) ?? raw
            guard !name.isEmpty, name != canary, !name.contains(":"), !out.contains(name) else { continue }
            out.append(name)
        }
        return out.joined(separator: ":")
    }

    // wbudowane narzędzia z próby, których bieg nie używa (bez narzędzia-próbki i już zablokowanych)
    static func plainExtras(_ info: InitInfo, keep: [String], deny: [String]) -> [String] {
        info.tools.filter { !$0.hasPrefix("mcp__") && !keep.contains($0) && !deny.contains($0) }
    }

    // ---------- bieg „send” (szkic do aplikacji przez konektor) ----------
    // serwery Claude Code znane z próby (także te bez narzędzi, np. czekające na logowanie)
    static func knownServers(_ info: InitInfo) -> Set<String> {
        Set(info.tools.compactMap { split($0)?.server }).union(info.servers.map { norm($0.name) })
    }

    static func send(runId: String, prompt: String, mcp: String, token: String, servers: [String], probe: Probe, model: String) throws -> RunPlan {
        var names: [String] = []
        for s in servers {
            let n = norm(s)
            if !n.isEmpty && n != hub && !names.contains(n) { names.append(n) }
        }
        guard !names.isEmpty else { throw PolicyError("Task Hub nie wskazał konektora do wysyłki.") }
        let known = knownServers(probe.info)
        guard names.contains(where: { known.contains($0) }) else {
            throw PolicyError("Na tym Macu Claude Code nie ma konektora: \(servers.joined(separator: ", ")). Dodaj go w Claude Code albo wyślij ręcznie.")
        }
        let allow = sendHubTools.map { "mcp__\(hub)__\($0)" } + names.map { "mcp__" + $0 }
        let others = known.subtracting(names).subtracting([hub]).sorted()
        let base = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]
        var deny = base + others.map { "mcp__" + $0 } + secretReadRules()
        let canary = try pickCanary(probe.info, excluded: allow + deny)
        let builtins = ["Read", "TodoWrite", "ToolSearch", canary]
        let extra = probe.restricted ? [] : plainExtras(probe.info, keep: builtins, deny: deny)   // jak w biegu „work”
        deny += extra
        let hk = try hooks(probe)
        let perms: [String: Any] = ["defaultMode": "dontAsk", "allow": allow, "deny": deny + [canary]]
        let settings: [String: Any] = ["permissions": perms, "hooks": hk, "disableAllHooks": false]
        let mcpF = try mcpFile(runId: runId, url: mcp, token: token)
        let setF: URL
        do { setF = try writeFile(settings, name: safeId(runId) + "-settings.json") } catch { remove([mcpF]); throw error }
        var args: [String] = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk",
                              "--mcp-config", mcpF.path, "--settings", setF.path, "--allowedTools"]
        args += allow
        args.append("--disallowedTools")
        args += deny
        args += ["--max-turns", "15"]
        args += common(probe, tools: builtins, model: model)
        var env = ClaudeCLI.env()
        env["TASKHUB_ALLOWED_DIRS"] = ""   // wysyłka niczego nie zmienia na dysku
        env["TASKHUB_ALLOWED_TOOLS"] = guardTools(allow, builtins: builtins, canary: canary)
        let lack = base.filter { probe.info.tools.contains($0) } + probe.info.tools.filter { t in split(t).map { others.contains($0.server) } ?? false } + extra
        return RunPlan(args: args, env: env, files: [mcpF, setF], canary: canary, mustLack: lack, known: Set(probe.info.tools))
    }

    // ---------- kontrola zdarzenia startowego ----------
    // nil = Claude Code ruszył z naszymi zasadami; inaczej powód przerwania
    static func check(_ i: InitInfo, _ plan: RunPlan) -> String? {
        guard i.permissionMode == "dontAsk" else { return "Claude Code nie przyjął zasad mostka (tryb uprawnień: \(i.permissionMode ?? "brak"))" }
        if i.tools.contains(plan.canary) { return "Claude Code nie przyjął zasad mostka (pominął plik ustawień biegu)" }
        if let t = plan.mustLack.first(where: { i.tools.contains($0) }) { return "Claude Code nie przyjął zasad mostka (nie zablokował \(t))" }
        return nil
    }

    // narzędzia konektorów, których próba nie widziała (konektor doszedł po próbie, np. Figma w próbie jeszcze „pending”): nie mają reguły
    // w ustawieniach biegu, więc w tym biegu blokuje je strażnik (lista TASKHUB_ALLOWED_TOOLS), a mostek przed następnym robi nową próbę.
    // Do 0.1.7 taki bieg był przerywany i mostek stawał na 10 minut, więc jeden kapryśny konektor zatrzymywał całą pracę.
    static func unknownTools(_ i: InitInfo, _ plan: RunPlan) -> [String] {
        i.tools.filter { t in split(t).map { $0.server != hub && !plan.known.contains(t) } ?? false }
    }
}
