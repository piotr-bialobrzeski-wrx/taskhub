// Strażnik biegów mostka: Claude Code woła go przed każdym narzędziem (hook PreToolUse z pliku ustawień biegu)
// jako „Task Hub --hook-guard”. Czyta JSON ze stdin; odmowa = kod 2 i powód na stderr, zgoda = kod 0 bez wyjścia
// (nigdy „allow”: o reszcie decydują zasady biegu). Bez AppKit i bez okien, żeby był szybki; nieczytelne wejście = odmowa.
// To druga linia obrony: pierwsza to lista dozwolonych narzędzi i piaskownica Basha.
import Darwin
import Foundation

enum Guard {
    static let fileTools: Set<String> = ["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep", "LS"]
    static let writeTools: Set<String> = ["Edit", "Write", "MultiEdit", "NotebookEdit"]
    static let shellTools: Set<String> = ["Bash", "Monitor", "PowerShell"]
    static let netCommands: Set<String> = ["curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "rsync", "ftp", "telnet", "socat"]
    static let blockedCommands: Set<String> = ["security", "osascript", "open", "launchctl", "sudo", "crontab"]
    static let wrappers: Set<String> = ["env", "nohup", "time", "nice", "xargs", "timeout", "command", "exec", "builtin", "caffeinate"]
    // fragmenty ścieżek z sekretami (porównanie bez cudzysłowów, ukośników wstecznych i wielkości liter)
    static let markers = ["/.ssh", ".ssh/", "/.aws", ".aws/", ".config/gh", ".git-credentials", ".netrc", ".npmrc", ".credentials.json", ".claude.json",
                          ".taskhub-bridge", "library/keychains", "library/cookies", "library/httpstorages", "library/webkit", "../config.json", "../run/",
                          "/.pgpass", ".docker/", "/.kube", ".config/gcloud", "/.gnupg", ".supabase", "com.vercel.cli", "zsh_history", "bash_history"]

    static func run() -> Int32 {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let obj = try? JSONSerialization.jsonObject(with: data), let ev = obj as? [String: Any],
              let tool = ev["tool_name"] as? String, !tool.isEmpty else {
            return deny("Strażnik Task Hub nie odczytał wywołania narzędzia, więc go nie przepuszcza.")
        }
        if let mode = ev["permission_mode"] as? String, mode != "dontAsk" {
            return deny("Strażnik Task Hub: bieg mostka ruszył w trybie \(mode) zamiast dontAsk, narzędzie zablokowane.")
        }
        let input = (ev["tool_input"] as? [String: Any]) ?? [:]
        let cwd = (ev["cwd"] as? String) ?? FileManager.default.currentDirectoryPath
        let allowed = (ProcessInfo.processInfo.environment["TASKHUB_ALLOWED_DIRS"] ?? "")
            .split(separator: ":").map { String($0) }.filter { $0.hasPrefix("/") }
        let fileDirs = (ProcessInfo.processInfo.environment["TASKHUB_FILE_DIRS"] ?? "")
            .split(separator: ":").map { String($0) }.filter { $0.hasPrefix("/") }
        if let why = check(tool: tool, input: input, cwd: cwd, allowed: allowed, fileDirs: fileDirs) { return deny(why) }
        return 0
    }

    static func deny(_ why: String) -> Int32 {
        FileHandle.standardError.write((why + "\n").data(using: .utf8) ?? Data())
        return 2
    }

    // nil = przepuść (decydują zasady biegu); tekst = odmowa z tym powodem. fileDirs = foldery na pliki: tylko zapis nowych plików, bez czytania
    static func check(tool: String, input: [String: Any], cwd: String, allowed: [String], fileDirs: [String] = []) -> String? {
        if shellTools.contains(tool) {
            return commandProblem((input["command"] as? String) ?? "")
        }
        guard fileTools.contains(tool) else { return nil }
        let paths = ["file_path", "notebook_path", "path"].compactMap { input[$0] as? String }.filter { !$0.isEmpty }
        for p in paths where isSecret(absolute(p, cwd)) {
            return "Strażnik Task Hub: \(p) to chronione dane (tokeny, klucze, ciasteczka), bieg mostka ich nie czyta."
        }
        for k in ["pattern", "glob"] where tool == "Glob" || k == "glob" {
            if let s = input[k] as? String, let m = secretMarker(s) { return "Strażnik Task Hub: wzorzec sięga do chronionych danych (\(m))." }
        }
        // foldery na pliki: Claude tylko zapisuje tam nowe pliki; Read, Glob, Grep i LS w nich odmawiamy (także wzorzec Glob ze ścieżką bezwzględną)
        if !fileDirs.isEmpty && !writeTools.contains(tool) {
            let fileRoots = fileDirs.map { canonical($0) }
            var probes = paths.map { canonical(absolute($0, cwd)) }
            if tool == "Glob", let pat = input["pattern"] as? String, pat.hasPrefix("/") || pat.hasPrefix("~/") { probes.append(canonical(absolute(pat, cwd))) }
            if probes.contains(where: { p in fileRoots.contains(where: { under(p, $0, caseless: false) }) }) {
                return "Strażnik Task Hub: w folderach na pliki Claude tylko zapisuje nowe pliki, bez czytania."
            }
        }
        guard writeTools.contains(tool) else { return nil }
        guard !paths.isEmpty else { return "Strażnik Task Hub: zmiana pliku bez ścieżki, zablokowana." }
        let roots = allowed.map { canonical($0) }
        for p in paths {
            let c = canonical(absolute(p, cwd))
            if !roots.contains(where: { under(c, $0, caseless: false) }) {
                return "Strażnik Task Hub: zmiany plików tylko w katalogu roboczym, w folderach z kodem i w folderach na pliki z Ustawień aplikacji (\(p))."
            }
            let comps = c.split(separator: "/").map { String($0) }
            if comps.contains(".git") || comps.contains(".claude") || comps.last == ".mcp.json" {
                return "Strażnik Task Hub: pliki gita i ustawień Claude Code zmienia tylko człowiek (\(p))."
            }
        }
        return nil
    }

    // ---------- polecenia powłoki ----------
    static let execFlags: Set<String> = ["-exec", "-execdir", "-ok", "-okdir"]
    static let gitArgOptions: Set<String> = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--attr-source"]
    static let gitConfigReads: Set<String> = ["--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l", "get", "list"]
    static let gitFiles = [".git/hooks", ".git/config", ".git/info", ".git/modules", ".git/worktrees", ".git/commondir"]
    // podkomendy, które robią commity albo przestawiają gałąź: commit (i push) robi aplikacja po zatwierdzeniu szkicu
    static let gitCommitting: Set<String> = ["commit", "commit-tree", "update-ref", "reset", "rebase", "merge", "cherry-pick", "am", "revert",
                                             "replace", "pull", "filter-branch", "fast-import"]

    static func commandProblem(_ cmd: String, depth: Int = 0) -> String? {
        if let m = secretMarker(cmd) { return "Strażnik Task Hub: polecenie sięga do chronionych danych (\(m))." }
        let flat = cmd.lowercased().replacingOccurrences(of: "\\", with: "")
        if let g = gitFiles.first(where: { flat.contains($0) }) { return "Strażnik Task Hub: pliki gita (\(g)) zmienia tylko człowiek." }
        for words in segments(cmd) {
            if let why = segmentProblem(words) { return why }
            // tekst w cudzysłowach może być osobnym poleceniem (sh -c 'git push', eval "curl …")
            if depth < 4 {
                for w in words where w.unicodeScalars.contains(where: { " \t\n\r;&|()`{}<>".unicodeScalars.contains($0) }) {
                    if let why = commandProblem(w, depth: depth + 1) { return why }
                }
            }
        }
        return nil
    }

    // polecenie → człony (po ; & | ( ) ` { } < > i nowych liniach poza cudzysłowami) → słowa już bez cudzysłowów;
    // po znakach Unicode jak bash po bajtach (apostrof ze znakiem łączącym to nadal apostrof)
    static func segments(_ cmd: String) -> [[String]] {
        var segs: [[String]] = []
        var words: [String] = []
        var cur = ""
        var inWord = false
        var quote: Unicode.Scalar? = nil
        var escaped = false
        func endWord() { if inWord { words.append(cur); cur = ""; inWord = false } }
        func endSegment() { endWord(); if !words.isEmpty { segs.append(words); words = [] } }
        for ch in cmd.unicodeScalars {
            if escaped {
                if ch != "\n" { cur.unicodeScalars.append(ch) }   // ukośnik i nowa linia = ciąg dalszy linii
                inWord = true; escaped = false; continue
            }
            if let q = quote {
                if ch == q { quote = nil } else if ch == "\\" && q == "\"" { escaped = true } else { cur.unicodeScalars.append(ch) }
                continue
            }
            switch ch {
            case "\\": escaped = true; inWord = true
            case "'", "\"": quote = ch; inWord = true
            case " ", "\t": endWord()
            case "\n", "\r", ";", "&", "|", "(", ")", "`", "{", "}", "<", ">": endSegment()
            default: cur.unicodeScalars.append(ch); inWord = true
            }
        }
        endSegment()
        return segs
    }

    static func segmentProblem(_ all: [String]) -> String? {
        var words = all
        var wrapped = false
        // pomiń przypisania zmiennych (FOO=1) i nakładki (env, nohup, timeout 5s…) razem z ich opcjami
        while let w = words.first {
            if w.contains("=") && !w.hasPrefix("-") && !w.hasPrefix("/") && !w.hasPrefix(".") { words.removeFirst(); continue }
            if wrappers.contains(base(w)) {
                wrapped = true
                words.removeFirst()
                while let o = words.first, o.hasPrefix("-") || o.first?.isNumber == true { words.removeFirst() }
                continue
            }
            break
        }
        guard let first = words.first else { return nil }
        // za nakładką polecenie bywa dalej (env -u X curl): wtedy sprawdzamy każde słowo
        let names = wrapped ? words.map { base($0) } : [base(first)]
        if let c = names.first(where: { netCommands.contains($0) }) { return "Strażnik Task Hub: \(c) jest zablokowany (bieg mostka nie łączy się z siecią poza npm)." }
        if let c = names.first(where: { blockedCommands.contains($0) }) { return "Strażnik Task Hub: \(c) jest zablokowany w biegach mostka." }
        let c = base(first)
        let rest = words.dropFirst().map { $0.lowercased() }
        if c == "find", let i = words.firstIndex(where: { execFlags.contains($0) }), i + 1 < words.count {
            if let why = segmentProblem(Array(words[(i + 1)...])) { return why }
        }
        if c == "defaults" && rest.contains(where: { $0 == "write" || $0 == "delete" || $0 == "import" || $0 == "rename" }) {
            return "Strażnik Task Hub: defaults write jest zablokowany w biegach mostka."
        }
        guard c == "git" else { return nil }
        if rest.contains("push") || rest.contains("send-pack") || rest.contains("http-push") {
            return "Strażnik Task Hub: git push robi aplikacja po zatwierdzeniu szkicu, nie bieg."
        }
        if rest.contains(where: { $0.hasPrefix("alias.") }) { return "Strażnik Task Hub: aliasy gita są w biegach mostka zablokowane." }
        let sub = gitSubcommand(words)
        if sub == "remote" { return "Strażnik Task Hub: git remote jest zablokowany w biegach mostka." }
        if let s = sub, gitCommitting.contains(s) { return "Strażnik Task Hub: git \(s) jest zablokowany w biegach mostka (commit robi aplikacja po zatwierdzeniu szkicu)." }
        if sub == "config" && !rest.contains(where: { gitConfigReads.contains($0) }) {
            return "Strażnik Task Hub: ustawienia gita zmienia tylko człowiek (w biegu git config tylko do odczytu, np. --get)."
        }
        if let s = sub, s.contains("$") { return "Strażnik Task Hub: podkomenda gita ze zmiennej jest zablokowana." }
        return nil
    }

    // „git -C /repo -c x=y status” → „status”
    static func gitSubcommand(_ words: [String]) -> String? {
        var i = 1
        while i < words.count {
            let w = words[i]
            if gitArgOptions.contains(w) { i += 2; continue }
            if w.hasPrefix("-") { i += 1; continue }
            return w.lowercased()
        }
        return nil
    }

    static func base(_ w: String) -> String {
        let bare = w.trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
        return (bare as NSString).lastPathComponent.lowercased()
    }

    // fragment chronionej ścieżki w tekście albo nil; katalog Task Hub poza work/ też (config.json z tokenem mostka, run/)
    static func secretMarker(_ text: String) -> String? {
        let flat = text.lowercased().replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
        if let m = markers.first(where: { flat.contains($0) }) { return m }
        if flat.range(of: "application support/task hub(?!/work(/|\\s|$))", options: .regularExpression) != nil { return "Application Support/Task Hub" }
        return nil
    }

    // ---------- ścieżki ----------
    static func absolute(_ p: String, _ cwd: String) -> String {
        var s = p
        if s == "~" || s.hasPrefix("~/") { s = Policy.home + String(s.dropFirst(1)) }
        if !s.hasPrefix("/") { s = cwd + "/" + s }
        return (s as NSString).standardizingPath
    }

    // ścieżka bez dowiązań: realpath najdłuższego istniejącego początku + reszta (plik może jeszcze nie istnieć)
    static func canonical(_ p: String) -> String {
        var head = (p as NSString).standardizingPath
        var tail: [String] = []
        while head.count > 1 {
            if let r = realpath(head, nil) {
                let s = String(cString: r)
                free(r)
                if tail.isEmpty { return s }
                return (s == "/" ? "" : s) + "/" + tail.reversed().joined(separator: "/")
            }
            tail.append((head as NSString).lastPathComponent)
            head = (head as NSString).deletingLastPathComponent
        }
        return "/" + tail.reversed().joined(separator: "/")
    }

    static func under(_ p: String, _ root: String, caseless: Bool) -> Bool {
        let a = caseless ? p.lowercased() : p, b = caseless ? root.lowercased() : root
        return a == b || a.hasPrefix(b.hasSuffix("/") ? b : b + "/")
    }

    // sekret: chroniony katalog albo plik, albo cokolwiek w katalogu Task Hub poza work/ (porównanie bez wielkości liter, jak na dysku Maca)
    static func isSecret(_ p: String) -> Bool {
        let forms = [p, canonical(p)]
        let roots = Policy.secretDirs() + Policy.secretFiles()
        for f in forms {
            for r in roots where under(f, r, caseless: true) || under(f, canonical(r), caseless: true) { return true }
            let app = Store.dir.path, work = Store.workDir.path
            if (under(f, app, caseless: true) || under(f, canonical(app), caseless: true))
                && !(under(f, work, caseless: true) || under(f, canonical(work), caseless: true)) { return true }
        }
        return false
    }
}
