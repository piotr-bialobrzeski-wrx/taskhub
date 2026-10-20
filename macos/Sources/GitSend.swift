// Wysyłka do gita bez modelu: po zatwierdzeniu szkicu aplikacja sama robi commit dokładnie tych plików, z treścią szkicu
// jako opisem, i push, gdy szkic tego chce (nigdy --force). Repozytorium musi leżeć w jednym z folderów z kodem,
// a bieżąca gałąź musi się zgadzać ze szkicem. Haki gita są wyłączone, a repozytorium z ustawieniami, które uruchamiają
// programy albo kierują push gdzie indziej, odrzucamy: aplikacja działa poza piaskownicą biegów.
// Commit musi mieć dokładnie te zmiany, które Piotr zatwierdził (diff każdego pliku z podpisanego bloku zmian), a push
// wysyła tylko commity zrobione tu po zgodzie (lista w git-commits.json, poza piaskownicą biegów).
import Foundation

struct GitJob {
    var repo: String        // „owner/name”
    var branch: String
    var message: String
    var files: [String]     // ścieżki względem katalogu repozytorium
    var push: Bool
    var diffs: [String: String]   // zatwierdzony diff każdego pliku (git diff HEAD -- plik)

    init?(_ j: [String: Any]) {
        guard let repo = j["repo"] as? String, let branch = j["branch"] as? String, let message = j["message"] as? String,
              let files = j["files"] as? [Any] else { return nil }
        self.repo = repo.trimmingCharacters(in: .whitespacesAndNewlines)
        self.branch = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        self.message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        self.files = files.compactMap { $0 as? String }
        self.push = (j["push"] as? Bool) ?? false
        self.diffs = (j["diffs"] as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
    }
}

struct GitResult {
    var ok: Bool
    var text: String        // podsumowanie („commit abc1234 na main”) albo powód błędu
    var link: String? = nil
}

@MainActor
final class GitSend {
    private var current: ProcessRunner? = nil
    private var cancelled = false
    private var critical = false   // commit już jest: sprawdzenie i ewentualne cofnięcie kończymy mimo „Zatrzymaj”

    func cancel() {
        cancelled = true
        if !critical { current?.kill("zatrzymany przez Ciebie") }
    }

    static var gitBin: String {
        ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/git"
    }

    // git bez pytań o hasło, bez haków i bez fsmonitora; ścieżki dosłownie (bez wzorców i „magii” pathspec)
    private func git(_ dir: String, _ args: [String], seconds: Double = 60, maxText: Int = 2000) async -> ProcessResult {
        if cancelled && !critical { return ProcessResult(ok: false, text: "zatrzymany przez Ciebie") }
        var env = ClaudeCLI.env()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GIT_ASKPASS"] = "/usr/bin/false"
        let all = ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "--literal-pathspecs", "--no-replace-objects"] + args
        let r = ProcessRunner(bin: GitSend.gitBin, args: all, cwd: dir, env: env, maxSeconds: seconds, stallSeconds: seconds, json: false, maxText: maxText)
        current = r
        let res = await r.run { _ in }
        current = nil
        return res
    }

    func run(_ job: GitJob, folders: [String]) async -> GitResult {
        let want = GitSend.repoKey(job.repo)
        guard want.contains("/") else { return GitResult(ok: false, text: "Szkic nie podaje repozytorium w postaci właściciel/nazwa (\(job.repo)).") }
        guard GitSend.validBranch(job.branch) else { return GitResult(ok: false, text: "Nieprawidłowa nazwa gałęzi w szkicu: \(job.branch)") }
        guard !job.message.isEmpty else { return GitResult(ok: false, text: "Szkic commita nie ma opisu.") }
        guard !job.files.isEmpty else { return GitResult(ok: false, text: "Szkic commita nie ma listy plików.") }
        if let bad = job.files.first(where: { !GitSend.validFile($0) }) { return GitResult(ok: false, text: "Nieprawidłowa ścieżka pliku w szkicu: \(bad)") }
        if let f = job.files.first(where: { job.diffs[$0] == nil }) {
            return GitResult(ok: false, text: "Task Hub nie podał zatwierdzonego diffu pliku \(f), więc nie sprawdzę, co pójdzie do commita. Zaktualizuj serwer Task Hub i zatwierdź szkic ponownie.")
        }
        guard !folders.isEmpty else { return GitResult(ok: false, text: "Na tym Macu nie ma folderów z kodem. Dodaj folder repozytorium w Ustawieniach aplikacji Task Hub i zatwierdź szkic ponownie.") }

        // folder: ten, którego origin wskazuje na repozytorium; awaryjnie folder o tej nazwie bez żadnego origin
        let name = String(want.split(separator: "/").last ?? "")
        var folder: String? = nil
        var remote = ""
        var byName: String? = nil
        for f in folders {
            let r = await git(f, ["remote", "get-url", "origin"], seconds: 20)
            if cancelled { return GitResult(ok: false, text: "zatrzymany przez Ciebie") }
            if r.ok && GitSend.remoteMatches(r.text, want) { folder = f; remote = r.text; break }
            if !r.ok && byName == nil && (f as NSString).lastPathComponent.lowercased() == name { byName = f }
        }
        if folder == nil { folder = byName }
        guard let dir = folder else {
            return GitResult(ok: false, text: "Nie znalazłem repozytorium \(job.repo) w folderach z kodem na tym Macu. Dodaj jego folder w Ustawieniach aplikacji Task Hub.")
        }

        if let why = await repoProblem(dir) { return GitResult(ok: false, text: why) }
        let head = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"], seconds: 20)
        guard head.ok else { return GitResult(ok: false, text: "Nie odczytałem gałęzi w \(dir): \(head.text)") }
        guard head.text == job.branch else {
            return GitResult(ok: false, text: "W folderze \(dir) jest gałąź \(head.text), a szkic jest dla \(job.branch). Przełącz gałąź i zatwierdź szkic ponownie.")
        }
        // pliki, nie foldery: folder wciągnąłby do commita pliki, których Piotr nie widział
        for f in job.files {
            let t = (try? FileManager.default.attributesOfItem(atPath: dir + "/" + f))?[.type] as? FileAttributeType
            if t == .typeDirectory {
                return GitResult(ok: false, text: "„\(f)” w bloku zmian to folder, a commit obejmuje tylko pliki z bloku zmian. Popraw blok zmian i zatwierdź szkic ponownie.")
            }
        }
        let start = await git(dir, ["rev-parse", "--verify", "-q", "HEAD"], seconds: 20)
        guard start.ok, !start.text.isEmpty else {
            return GitResult(ok: false, text: "Repozytorium w \(dir) nie ma jeszcze żadnego commita (albo nie odczytałem HEAD). Pierwszy commit zrób sam.")
        }
        var made = GitSend.loadMade()
        var sha = ""
        var resumed = false
        // commit z poprzedniej zgody (wtedy nie udał się push): HEAD zrobiony tutaj, z tymi samymi plikami i diffami, a na dysku nic nowego
        if made.contains(start.text) {
            let st = await git(dir, ["status", "--porcelain", "-z", "--untracked-files=all", "--"] + job.files, seconds: 60, maxText: 4_000_000)
            var same = false
            if st.ok && st.text.isEmpty { same = await commitProblem(dir, job, start.text) == nil }
            if same {
                let msg = await git(dir, ["log", "-1", "--format=%B", start.text, "--"], seconds: 20, maxText: 100_000)
                guard msg.ok, GitSend.sameText(msg.text, job.message) else {
                    return GitResult(ok: false, text: "Te zmiany są już w commicie \(start.text.prefix(7)) na \(job.branch), ale z innym opisem niż w szkicu. Wypchnij go sam albo popraw opis szkicu i zatwierdź ponownie.")
                }
                sha = start.text
                resumed = true
            }
        }
        if !resumed {
            let add = await git(dir, ["add", "--"] + job.files)
            guard add.ok else { return GitResult(ok: false, text: "git add się nie udał: \(add.text)") }
            // to, co jest w indeksie, ma być dokładnie zatwierdzonym diffem; inaczej nic nie commitujemy
            for f in job.files {
                if let why = await diffProblem(dir, f, job.diffs[f] ?? "", ["diff", "--cached"] + GitSend.diffFlags + ["--", f]) {
                    _ = await git(dir, ["reset", "-q", "--"] + job.files, seconds: 30)
                    return GitResult(ok: false, text: why + " Nic nie zacommitowałem; sprawdź zmiany i zatwierdź szkic ponownie.")
                }
            }
            let commit = await git(dir, ["commit", "-m", job.message, "--"] + job.files)
            guard commit.ok else { return GitResult(ok: false, text: "git commit się nie udał: \(commit.text)") }
            critical = true
            defer { critical = false }
            let rev = await git(dir, ["rev-parse", "--verify", "-q", "HEAD"], seconds: 20)
            guard rev.ok, !rev.text.isEmpty, rev.text != start.text else { return GitResult(ok: false, text: "Nie odczytałem nowego commita w \(dir): \(rev.text)") }
            sha = rev.text
            // jeszcze raz na gotowym commicie: git commit z listą plików bierze je z dysku, który mógł się zmienić po porównaniu
            if let why = await commitProblem(dir, job, sha) {
                let back = await git(dir, ["update-ref", "-m", "task-hub: commit niezgodny ze szkicem", "refs/heads/" + job.branch, start.text, sha], seconds: 20)
                let what = back.ok ? "cofnąłem (zmiany zostały na dysku)" : "został na tym Macu; cofnij go: git reset --soft HEAD~1"
                return GitResult(ok: false, text: "\(why) Commit \(sha.prefix(7)) \(what). Sprawdź zmiany i zatwierdź szkic ponownie.")
            }
            made.append(sha)
            GitSend.saveMade(made)
        }
        let short = String(sha.prefix(7))
        var summary = "commit \(short) na \(job.branch)" + (resumed ? " (zrobiony przy poprzedniej zgodzie)" : "")
        if job.push {
            if let why = await rangeProblem(dir, job.branch, sha, made) {
                return GitResult(ok: false, text: "\(summary) jest na tym Macu, ale go nie wypchnąłem: \(why)")
            }
            // dokładnie ten commit (nie to, na co gałąź wskaże za chwilę)
            let p = await git(dir, ["-c", "push.recurseSubmodules=no", "push", "origin", sha + ":refs/heads/" + job.branch], seconds: 180)
            guard p.ok else { return GitResult(ok: false, text: "\(summary) jest zrobiony na tym Macu, ale push się nie udał: \(p.text)") }
            summary += ", wypchnięty do origin"
        }
        Log.write("git: \(summary) (\(dir))")
        return GitResult(ok: true, text: summary, link: GitSend.githubLink(remote, sha))
    }

    static let diffFlags = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"]

    // diff pliku z gita (bez zewnętrznych programów) ma te same zmiany co zatwierdzony; nil = zgadza się
    private func diffProblem(_ dir: String, _ f: String, _ approved: String, _ args: [String]) async -> String? {
        let r = await git(dir, args, seconds: 60, maxText: 50_000_000)
        guard r.ok else { return "Nie odczytałem zmian pliku \(f): \(r.text)" }
        guard let got = GitSend.hunks(r.text), let want = GitSend.hunks(approved) else {
            return "Plik \(f) jest binarny, a takiej zmiany aplikacja nie porówna z zatwierdzonym szkicem. Ten commit zrób sam."
        }
        return got == want ? nil : "Plik \(f) różni się od zmian, które zatwierdziłeś (zmienił się po zapisaniu bloku zmian albo diff w szkicu nie jest pełnym wynikiem git diff)."
    }

    // commit zmienia dokładnie pliki ze szkicu i dokładnie tak, jak zatwierdzono (porównanie z rodzicem); nil = zgadza się
    private func commitProblem(_ dir: String, _ job: GitJob, _ sha: String) async -> String? {
        let names = await git(dir, ["diff", "--name-only", "-z", "--no-renames", sha + "~1", sha, "--"], seconds: 60, maxText: 4_000_000)
        guard names.ok else { return "Nie odczytałem plików commita \(sha.prefix(7)): \(names.text)" }
        let got = Set(names.text.components(separatedBy: "\0").filter { !$0.isEmpty })
        guard got == Set(job.files) else { return "Commit \(sha.prefix(7)) zmienia inne pliki niż blok zmian w szkicu." }
        for f in job.files {
            if let why = await diffProblem(dir, f, job.diffs[f] ?? "", ["diff"] + GitSend.diffFlags + [sha + "~1", sha, "--", f]) { return why }
        }
        return nil
    }

    // push wysyła tylko commity zrobione tutaj po zgodzie: wszystko, czego gałąź na origin jeszcze nie ma (gałęzi nie ma: żadna gałąź
    // na origin), musi być na liście. Stan origin z ls-remote, nie z refs/remotes (te bieg w repozytorium mógł zmienić); nil = można
    private func rangeProblem(_ dir: String, _ branch: String, _ sha: String, _ made: [String]) async -> String? {
        let ls = await git(dir, ["ls-remote", "--heads", "origin"], seconds: 60, maxText: 4_000_000)
        guard ls.ok else { return "nie odczytałem gałęzi na origin: \(ls.text)" }
        var tips: [String] = []
        var mine: String? = nil
        for line in ls.text.components(separatedBy: "\n") {
            let parts = line.split(separator: "\t", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            guard parts.count == 2, parts[0].range(of: "^[0-9a-f]{40,64}$", options: .regularExpression) != nil else { continue }
            tips.append(parts[0])
            if parts[1] == "refs/heads/" + branch { mine = parts[0] }
        }
        let not = mine.map { [$0] } ?? tips
        let list = await git(dir, ["rev-list", "--ignore-missing", sha, "--not"] + not + ["--"], seconds: 60, maxText: 4_000_000)
        guard list.ok else { return "nie policzyłem commitów do wypchnięcia: \(list.text)" }
        let todo = list.text.components(separatedBy: "\n").filter { !$0.isEmpty }
        if let bad = todo.first(where: { !made.contains($0) }) {
            return "na gałęzi \(branch) jest commit \(bad.prefix(7)), którego origin nie ma, a nie zrobiła go ta aplikacja po Twojej zgodzie. Wypchnij go sam albo usuń z gałęzi i zatwierdź szkic ponownie."
        }
        return nil
    }

    // linie zmian z wyniku git diff: tryby plików i wszystko od „@@” (bez nagłówków diff --git, index, ---, +++ i bez opisu po „@@ … @@”),
    // bez końcowych spacji i pustych linii (wklejony diff je gubi); nil = plik binarny
    static func hunks(_ diff: String) -> [String]? {
        var out: [String] = []
        var inHunk = false
        for raw in diff.components(separatedBy: "\n") {
            var l = raw
            if l.hasSuffix("\r") { l.removeLast() }
            if l.hasPrefix("diff --git ") { inHunk = false; continue }
            if l.hasPrefix("Binary files ") || l.hasPrefix("GIT binary patch") { return nil }
            if l.hasPrefix("@@") {
                if let r = l.range(of: " @@", range: l.index(l.startIndex, offsetBy: 2)..<l.endIndex) { l = String(l[..<r.upperBound]) }
                inHunk = true
                out.append(l)
                continue
            }
            if !inHunk {
                if ["old mode ", "new mode ", "new file mode ", "deleted file mode "].contains(where: { l.hasPrefix($0) }) { out.append(l) }
                continue
            }
            while let c = l.last, c == " " || c == "\t" { l.removeLast() }
            if !l.isEmpty { out.append(l) }
        }
        return out
    }

    // opis commita po git commit -m (bez końcowych spacji, pustych linii na końcu) porównany z treścią szkicu
    static func sameText(_ a: String, _ b: String) -> Bool {
        a.split(whereSeparator: { $0.isWhitespace }) == b.split(whereSeparator: { $0.isWhitespace })
    }

    // commity zrobione tutaj po zgodzie (ostatnie 500); plik poza piaskownicą biegów i poza work/
    static var madeFile: URL { Store.dir.appendingPathComponent("git-commits.json") }

    static func loadMade() -> [String] {
        guard let d = try? Data(contentsOf: madeFile), let a = (try? JSONSerialization.jsonObject(with: d)) as? [String] else { return [] }
        return a
    }

    static func saveMade(_ list: [String]) {
        try? FileManager.default.createDirectory(at: Store.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard let d = try? JSONSerialization.data(withJSONObject: Array(list.suffix(500))) else { return }
        try? d.write(to: madeFile, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: madeFile.path)
    }

    // folder to główny katalog repozytorium (nie podfolder, nie core.worktree gdzie indziej), bez groźnych ustawień lokalnych
    private func repoProblem(_ dir: String) async -> String? {
        let top = await git(dir, ["rev-parse", "--show-toplevel"], seconds: 20)
        guard top.ok else { return "Nie odczytałem repozytorium w \(dir): \(top.text)" }
        if GitSend.resolved(top.text) != GitSend.resolved(dir) {
            return "Folder \(dir) nie jest głównym folderem repozytorium (\(top.text)). Dodaj w Ustawieniach aplikacji Task Hub główny folder repozytorium i zatwierdź szkic ponownie."
        }
        if FileManager.default.fileExists(atPath: dir + "/.git/commondir") {
            return "W \(dir)/.git jest plik commondir, którego zwykłe repozytorium nie ma. Sprawdź repozytorium i zatwierdź szkic ponownie."
        }
        var scoped = true
        var list = await git(dir, ["config", "--list", "--show-scope"], seconds: 20, maxText: 4_000_000)
        if !list.ok && !cancelled {   // git starszy niż 2.26: same ustawienia repozytorium
            scoped = false
            list = await git(dir, ["config", "--local", "--list"], seconds: 20, maxText: 4_000_000)
        }
        guard list.ok else { return "Nie odczytałem ustawień gita w \(dir): \(list.text)" }
        for line in list.text.split(separator: "\n") {
            var entry = String(line)
            if scoped {
                guard let tab = entry.firstIndex(of: "\t") else { continue }
                let scope = String(entry[..<tab])
                guard scope == "local" || scope == "worktree" else { continue }
                entry = String(entry[entry.index(after: tab)...])
            }
            let kv = entry.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let key = kv.isEmpty ? "" : String(kv[0])
            let value = kv.count > 1 ? String(kv[1]) : ""
            if GitSend.riskyKey(key, value) {
                return "Repozytorium \(dir) ma w ustawieniach (.git/config) \(key), które przy commicie albo pushu może uruchomić program albo wysłać kod gdzie indziej. Sprawdź je poleceniem git config --local --list, usuń, jeśli go nie dodałeś, i zatwierdź szkic ponownie."
            }
        }
        return nil
    }

    // klucze z ustawień repozytorium, których add, commit i push używają do uruchamiania programów albo wyboru serwera
    static func riskyKey(_ key: String, _ value: String) -> Bool {
        let parts = key.lowercased().split(separator: ".", omittingEmptySubsequences: false).map { String($0) }
        guard parts.count >= 2 else { return false }
        let section = parts[0], name = parts[parts.count - 1]
        switch section {
        case "include", "includeif", "url", "protocol", "trace2": return true
        case "filter": return !knownFilter(value)
        case "credential": return name == "helper" && !value.isEmpty
        case "gpg": return name == "program" || name == "defaultkeycommand"
        case "core": return ["sshcommand", "gitproxy", "askpass", "alternaterefscommand"].contains(name)
        case "remote": return ["receivepack", "uploadpack", "pushurl", "proxy", "vcs"].contains(name)
        case "http": return ["proxy", "sslverify", "sslcainfo", "sslcapath", "sslcert", "sslkey", "extraheader", "cookiefile", "curloptresolve"].contains(name)
        default: return false
        }
    }

    // filtry git-lfs i git-crypt (z PATH albo ze zwykłych katalogów programów) są w porządku, inne odrzucamy
    static func knownFilter(_ value: String) -> Bool {
        let v = value.trimmingCharacters(in: .whitespaces)
        if v == "true" || v == "false" { return true }
        var first = String(v.split(separator: " ").first ?? "")
        first = first.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        let name = (first as NSString).lastPathComponent
        guard name == "git-lfs" || name == "git-crypt" else { return false }
        let dir = (first as NSString).deletingLastPathComponent
        return dir.isEmpty || ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"].contains(dir)
    }

    // ścieżka bez dowiązań, do porównań (dysk Maca zwykle nie rozróżnia wielkości liter)
    static func resolved(_ p: String) -> String {
        URL(fileURLWithPath: p.trimmingCharacters(in: .whitespacesAndNewlines)).resolvingSymlinksInPath().standardizedFileURL.path.lowercased()
    }

    // „https://github.com/Owner/Name.git” → „owner/name”
    static func repoKey(_ s: String) -> String {
        var k = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while k.hasSuffix("/") { k.removeLast() }
        if k.hasSuffix(".git") { k.removeLast(4) }
        while k.hasPrefix("/") { k.removeFirst() }
        return k
    }

    static func remoteMatches(_ url: String, _ want: String) -> Bool {
        let u = repoKey(url)
        return !want.isEmpty && (u == want || u.hasSuffix("/" + want) || u.hasSuffix(":" + want))
    }

    static func validBranch(_ b: String) -> Bool {
        guard !b.isEmpty, !b.hasPrefix("-"), !b.contains(".."), !b.hasSuffix("/"), !b.hasSuffix(".lock") else { return false }
        return b.range(of: "^[A-Za-z0-9._/-]+$", options: .regularExpression) != nil
    }

    // ścieżka względna, bez „..”, bez „-” i „:” na początku (opcje gita, magia pathspec)
    static func validFile(_ f: String) -> Bool {
        guard !f.isEmpty, !f.hasPrefix("/"), !f.hasPrefix("-"), !f.hasPrefix(":"), !f.contains("\n"), !f.contains("\r"), !f.contains("\0") else { return false }
        return !f.split(separator: "/").contains("..")
    }

    // link do commita tylko dla github.com (adres bez loginu i tokenu)
    static func githubLink(_ remote: String, _ sha: String) -> String? {
        guard !sha.isEmpty else { return nil }
        var r = remote.trimmingCharacters(in: .whitespacesAndNewlines)
        while r.hasSuffix("/") { r.removeLast() }
        if r.lowercased().hasSuffix(".git") { r.removeLast(4) }
        for p in ["https://github.com/", "ssh://git@github.com/", "git@github.com:"] where r.lowercased().hasPrefix(p) {
            let path = String(r.dropFirst(p.count))
            let parts = path.split(separator: "/")
            guard parts.count == 2, path.range(of: "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { return nil }
            return "https://github.com/\(path)/commit/\(sha)"
        }
        return nil
    }
}
