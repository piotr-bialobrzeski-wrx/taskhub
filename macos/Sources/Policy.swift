// Zasady biegów mostka (od 0.1.7): Claude Code dostaje listę dozwolonych narzędzi zamiast pełnej swobody.
// Bieg „work” (od paczki 25) ma pełny Claude Code poza wysyłką na zewnątrz; bieg „send” wysyła jeden zatwierdzony szkic
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
    var flags: Set<String> = [] // flagi z claude --help (--effort, --fallback-model)
    var tools = ""              // odcisk serwerów z folderów z narzędziami, z którymi szła próba (inny w Ustawieniach = nowa próba)

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
    static let bashDeny = ["git push", "git remote", "git config", "git commit", "git commit-tree", "git update-ref", "git reset", "git rebase", "git merge",
                           "git cherry-pick", "git am", "git revert", "git replace", "curl", "wget", "ssh", "scp", "rsync", "nc", "security", "osascript", "open", "sudo", "launchctl", "defaults", "crontab"]
    // kandydaci na narzędzie-próbkę (pierwsze, które próba pokazała i którego bieg i tak nie potrzebuje)
    static let canaries = ["NotebookEdit", "EnterWorktree", "ExitWorktree", "CronCreate", "CronDelete", "CronList", "Monitor", "PushNotification", "ScheduleWakeup", "RemoteTrigger", "Agent", "Task"]
    static let sendHubTools = ["get_task", "get_rules", "list_connections", "add_facts", "complete_step", "leave_step"]
    // lista zadań sesji Claude Code (nowsze wersje dają ją zamiast TodoWrite albo obok niego); nie ma nic wspólnego z zadaniami Task Hub.
    // Bieg pracy może nią planować; bieg wysyłki jej nie dostaje (paczka 20: Sonnet brał TaskGet za get_task Task Hub, strażnik go blokował i krok wracał)
    static let sessionTaskTools = ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]
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
                h + "/.pgpass", h + "/.zsh_history", h + "/.bash_history", h + "/.cargo/credentials.toml", h + "/.cargo/credentials", h + "/.pypirc"]
            + ToolFolders.secretFiles(Store.diskConfig())   // .mcp.json i .env folderów z narzędziami (tokeny serwerów Pirxey World)
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
    // extra: serwery z folderów z narzędziami (ToolFolders), obok Task Hub w tym samym pliku
    static func mcpFile(runId: String, url: String, token: String, extra: [String: Any] = [:]) throws -> URL {
        guard let u = URL(string: url), u.scheme == "https" || u.scheme == "http", u.host != nil else {
            throw PolicyError("Task Hub podał zły adres konektora: \(url)")
        }
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !t.contains("\n") else { throw PolicyError("Task Hub nie podał tokenu biegu. Zaktualizuj Task Hub (serwer).") }
        let server: [String: Any] = ["type": "http", "url": url, "headers": ["Authorization": "Bearer \(t)"]]
        var servers = extra
        servers[hub] = server   // Task Hub zawsze z tokenem biegu, nawet gdy folder ma serwer o tej nazwie
        return try writeFile(["mcpServers": servers], name: safeId(runId) + "-mcp.json")
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

    // model biegu od Task Hub (dobór do poziomu kroku): skrót modelu, wysiłek i zapasowy na przeciążenie w trakcie biegu
    struct ModelChoice { var model = ""; var effort = ""; var fallback = "" }

    // wspólne flagi: tryb ograniczony (tylko --settings i zarządzane), pytania o zgodę = odmowa, model, wysiłek i model zapasowy
    // (dwa ostatnie tylko, gdy ta wersja Claude Code je zna)
    static func common(_ probe: Probe, tools: [String], model m: ModelChoice) -> [String] {
        var a: [String] = []
        if probe.restricted { a += ["--restricted", "--tools", tools.joined(separator: ",")] }
        else { a += ["--setting-sources", "user"] }   // bez ustawień projektu z work/ (agent mógłby je tam podłożyć)
        if probe.prompts { a += ["--permission-prompts", "none"] }
        let model = m.model.trimmingCharacters(in: .whitespaces)
        if !model.isEmpty { a += ["--model", model] }
        let effort = m.effort.trimmingCharacters(in: .whitespaces)
        if !effort.isEmpty && probe.flags.contains("--effort") { a += ["--effort", effort] }
        let fb = m.fallback.trimmingCharacters(in: .whitespaces)
        if !fb.isEmpty && fb != model && probe.flags.contains("--fallback-model") { a += ["--fallback-model", fb] }
        return a
    }

    // ---------- bieg „work” ----------
    // Od paczki 25 (decyzja Piotra 2026-10-27: „Pełny Claude Code, wysyłka po zgodzie”) bieg pracy ma to, co Claude Code Piotra:
    // czyta i zmienia pliki w katalogu domowym i /tmp, uruchamia polecenia bez piaskownicy (pakiety, build, testy), ma wszystkie
    // wbudowane narzędzia (także podagentów), konektory do czytania, serwery i skille z folderów z narzędziami (Pirxey World).
    // Zostaje jedna granica: nic nie wychodzi na zewnątrz bez zgody. Zapis konektorami, git commit/push, curl, ssh, osascript
    // i harmonogramy są zablokowane (szkic do zgody, potem bieg „send” albo commit przez aplikację). Sekretów (tokeny, klucze,
    // ciasteczka) i miejsc, z których dałoby się obejść te zasady (ustawienia Claude Code, haki gita, autostart, profile powłoki), bieg nie rusza.
    // folders = foldery z kodem (commit po zatwierdzeniu robi w nich aplikacja); files = foldery na pliki (kroki „Plik na Macu”)
    static let workBlocked = ["CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "RemoteTrigger", "PushNotification"]

    static func work(runId: String, prompt: String, mcp: String, token: String, probe: Probe, folders: [String], files: [String] = [], tools: [ToolFolders.Server] = [], model: ModelChoice, bin: String = "") throws -> RunPlan {
        let work = Store.workDir.path
        guard ruleSafe(work) else { throw PolicyError("Ścieżka katalogu roboczego ma znaki, których zasady nie obsłużą: \(work)") }
        let conn = connectorTools(probe.info)
        let toolRoots = toolFolderPaths(tools)
        let present = probe.info.tools.filter { !$0.hasPrefix("mcp__") }
        // narzędzie-próbka z tych, których bieg i tak nie dostaje (harmonogramy, zdalne uruchamianie)
        guard let canary = workBlocked.first(where: { present.contains($0) }) else {
            throw PolicyError("Nie umiem sprawdzić, czy Claude Code przyjmie zasady mostka (brak znanego narzędzia do próby). Zaktualizuj Claude Code i aplikację Task Hub.")
        }
        let blocked = workBlocked.filter { present.contains($0) && $0 != canary }
        let builtins = present.filter { !workBlocked.contains($0) } + [canary]
        var allow = ["mcp__" + hub] + present.filter { !workBlocked.contains($0) } + conn.read
        allow = allow.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let deny = conn.write + bashDeny.map { "Bash(\($0):*)" } + secretReadRules() + blocked
        let hk = try hooks(probe)
        let perms: [String: Any] = ["defaultMode": "dontAsk", "allow": allow, "deny": deny + [canary], "additionalDirectories": [home, "/tmp"]]
        // polecenia bez piaskownicy (jak w Claude Code Piotra: sieć do pakietów, build, testy); pilnuje ich strażnik
        let settings: [String: Any] = ["permissions": perms, "sandbox": ["enabled": false], "hooks": hk, "disableAllHooks": false]
        let mcpF = try mcpFile(runId: runId, url: mcp, token: token, extra: ToolFolders.mcpServers(tools))
        let setF: URL
        do { setF = try writeFile(settings, name: safeId(runId) + "-settings.json") } catch { remove([mcpF]); throw error }
        var p = prompt + "\n\nMasz pełny Claude Code na Macu Piotra: czytasz i zmieniasz pliki w jego katalogu domowym i w /tmp (poza danymi logowania i ustawieniami Claude Code), uruchamiasz polecenia, instalujesz pakiety, budujesz i testujesz. Niczego nie wysyłasz na zewnątrz: zapis w aplikacjach (ClickUp, Slack, mail, Figma…), git commit i git push, curl, ssh są zablokowane; to przygotowujesz jako szkic do zgody Piotra (set_blocks), a wyśle go aplikacja po jego kliknięciu. Folderu na Macu nie musisz o nic prosić: ścieżki z zasad projektu czytasz wprost."
        if !folders.isEmpty { p += "\n\nFoldery z kodem (zmiany w nich zatwierdza Piotr, commit robi aplikacja): " + folders.joined(separator: ", ") }
        p += files.isEmpty
            ? "\n\nNa tym Macu nie ma folderów na pliki: krok „Plik na Macu” (tool file) zapisz w miejscu z zasad projektu, a gdy go nie ma, oddaj przez leave_step z needFolder (kind files, pełna ścieżka)."
            : "\n\nFoldery na pliki na tym Macu (kroki „Plik na Macu”): " + files.joined(separator: ", ")
        if !tools.isEmpty {
            p += "\n\nNarzędzia z folderów na tym Macu (jak w Claude Code otwartym w " + toolRoots.joined(separator: ", ") + "): serwery " + tools.map { $0.name }.joined(separator: ", ")
                + ". Ich narzędzia do czytania są dozwolone, zapis tylko jako szkic do zgody Piotra."
        }
        var args: [String] = ["-p", p, "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk",
                              "--mcp-config", mcpF.path, "--settings", setF.path, "--allowedTools"]
        args += allow
        args.append("--disallowedTools")
        args += deny
        // foldery z narzędziami, z kodem i na pliki jako katalogi robocze: Claude Code ładuje z nich skille, polecenia i podagentów,
        // a z CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD także ich CLAUDE.md (jak w sesji otwartej w tym folderze)
        let added = (toolRoots + folders + files).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        if !added.isEmpty { args.append("--add-dir"); args += added }
        args += common(probe, tools: builtins, model: model)
        var env = ClaudeCLI.env()
        env["TASKHUB_ALLOWED_DIRS"] = [home, "/tmp", "/private/tmp"].joined(separator: ":")
        env["TASKHUB_FILE_DIRS"] = ""
        env["TASKHUB_ALLOWED_TOOLS"] = guardTools(allow, builtins: builtins, canary: canary)
        env["CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD"] = "1"
        return RunPlan(args: args, env: env, files: [mcpF, setF], canary: canary, mustLack: conn.write + blocked,
                       known: Set(probe.info.tools))
    }

    // foldery serwerów z folderów z narzędziami, bez powtórzeń i tylko te, które nadają się do reguł
    static func toolFolderPaths(_ tools: [ToolFolders.Server]) -> [String] {
        var out: [String] = []
        for t in tools where ruleSafe(t.folder) && !out.contains(t.folder) { out.append(t.folder) }
        return out
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

    // tools: serwery z folderów z narzędziami; do pliku MCP wysyłki trafia tylko ten, którym idzie wysyłka
    static func send(runId: String, prompt: String, mcp: String, token: String, servers: [String], probe: Probe, tools: [ToolFolders.Server] = [], model: ModelChoice) throws -> RunPlan {
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
        // listy zadań sesji: zablokowane, ale bez przerywania biegu, gdy jakaś wersja Claude Code pokaże je mimo to (strażnik i tak odmówi)
        var deny = base + ["TodoWrite"] + sessionTaskTools + others.map { "mcp__" + $0 } + secretReadRules()
        let canary = try pickCanary(probe.info, excluded: allow + deny)
        let builtins = ["Read", "ToolSearch", canary]
        let extra = probe.restricted ? [] : plainExtras(probe.info, keep: builtins, deny: deny)   // jak w biegu „work”
        deny += extra
        let hk = try hooks(probe)
        let perms: [String: Any] = ["defaultMode": "dontAsk", "allow": allow, "deny": deny + [canary]]
        let settings: [String: Any] = ["permissions": perms, "hooks": hk, "disableAllHooks": false]
        let mcpF = try mcpFile(runId: runId, url: mcp, token: token, extra: ToolFolders.mcpServers(tools.filter { names.contains($0.name) }))
        let setF: URL
        do { setF = try writeFile(settings, name: safeId(runId) + "-settings.json") } catch { remove([mcpF]); throw error }
        var args: [String] = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk",
                              "--mcp-config", mcpF.path, "--settings", setF.path, "--allowedTools"]
        args += allow
        args.append("--disallowedTools")
        args += deny
        // 30, nie 15: serwer Task Hub łączy się czasem kilkanaście sekund po starcie biegu, a agent w tym czasie ponawia ToolSearch;
        // przy 15 turach bieg kończył się „Reached maximum number of turns” bez wysyłki („wysyłka nie została potwierdzona”)
        args += ["--max-turns", "30"]
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
