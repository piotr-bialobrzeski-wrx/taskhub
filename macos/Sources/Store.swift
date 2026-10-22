// Ustawienia aplikacji: ~/Library/Application Support/Task Hub/config.json (tylko dla właściciela, 0600).
// Token mostka leży w tym pliku tak jak w Project Hub; katalog „work” to miejsce, w którym pracuje Claude Code,
// a „run” trzyma pliki pojedynczego biegu (konfiguracja MCP z tokenem biegu, ustawienia) poza zasięgiem agenta.
import Foundation

struct Config: Codable, Equatable {
    var url = ""            // adres Task Hub, np. https://taskhub-lac.vercel.app
    var token = ""          // token mostka z Ustawień Task Hub
    var name = ""           // nazwa tego komputera (widać ją w Task Hub)
    var claude = ""         // ścieżka do Claude Code; puste = szukaj w typowych miejscach
    var model = ""          // model dla biegów; puste = domyślny Claude Code
    var bridge = true       // czy mostek ma pracować
    var autoUpdate = true   // czy aplikacja ma się sama aktualizować (wydania przez Task Hub)
    var codeFolders: [String] = []   // foldery z kodem (ścieżki bezwzględne): tylko tu Claude zmienia pliki w krokach z kodem
    var fileFolders: [String] = []   // foldery na pliki: tylko tu Claude zapisuje nowe pliki kroków „Plik na Macu”
    var quickBar = Shortcut.quickBar // skrót szybkiego paska

    init() {}

    // brakujące klucze (starszy plik) dostają wartości domyślne zamiast psuć całą konfigurację
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
        token = try c.decodeIfPresent(String.self, forKey: .token) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        claude = try c.decodeIfPresent(String.self, forKey: .claude) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        bridge = try c.decodeIfPresent(Bool.self, forKey: .bridge) ?? true
        autoUpdate = try c.decodeIfPresent(Bool.self, forKey: .autoUpdate) ?? true
        codeFolders = (try? c.decodeIfPresent([String].self, forKey: .codeFolders)) ?? []
        fileFolders = (try? c.decodeIfPresent([String].self, forKey: .fileFolders)) ?? []
        quickBar = (try? c.decodeIfPresent(Shortcut.self, forKey: .quickBar)) ?? Shortcut.quickBar
    }
}

final class Store: ObservableObject {
    static let shared = Store()
    static let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Task Hub", isDirectory: true)
    static let workDir = dir.appendingPathComponent("work", isDirectory: true)
    static let runDir = dir.appendingPathComponent("run", isDirectory: true)   // pliki biegu, poza work/
    static let file = dir.appendingPathComponent("config.json")
    static let defaultHost = "taskhub-lac.vercel.app"   // Task Hub Piotra

    @Published var cfg: Config {
        didSet { if cfg != oldValue { save() } }
    }

    private init() {
        var c = Config()
        if let d = try? Data(contentsOf: Store.file), let x = try? JSONDecoder().decode(Config.self, from: d) { c = x }
        if c.name.isEmpty { c.name = Store.computerName() }
        cfg = c
        Store.privateDir(Store.workDir)
        Store.privateDir(Store.runDir)
    }

    // katalog tylko dla właściciela (0700), także gdy już istniał z innymi prawami
    static func privateDir(_ u: URL) {
        let fm = FileManager.default
        try? fm.createDirectory(at: u, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: u.path)
    }

    static func computerName() -> String {
        let n = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
        return n.replacingOccurrences(of: ".local", with: "")
    }

    var baseURL: String {
        var u = cfg.url.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        if !u.isEmpty, !u.hasPrefix("http://"), !u.hasPrefix("https://") { u = "https://" + u }
        return u
    }
    var configured: Bool { !baseURL.isEmpty && !cfg.token.trimmingCharacters(in: .whitespaces).isEmpty }
    var host: String? { URL(string: baseURL).flatMap { Store.hostKey($0) } }   // np. taskhub-lac.vercel.app

    // host (małymi literami) z portem, gdy podany: tym porównujemy adresy Task Hub
    static func hostKey(_ u: URL) -> String? {
        guard let h = u.host?.lowercased(), !h.isEmpty else { return nil }
        return u.port.map { "\(h):\($0)" } ?? h
    }

    static func isLocalHost(_ h: String?) -> Bool { h == "localhost" || h == "127.0.0.1" }   // http tylko przy pracy lokalnej

    // ---------- foldery z kodem ----------
    // ścieżka do zapisania: bez dowiązań i końcowego „/”
    static func normalizedFolder(_ u: URL) -> String {
        var p = u.standardizedFileURL.resolvingSymlinksInPath().path
        while p.count > 1 && p.hasSuffix("/") { p.removeLast() }
        return p
    }

    // nil = folder się nadaje; inaczej powód po ludzku (cały dysk, katalog domowy, Biblioteka, ukryte foldery z kluczami, system)
    static func folderProblem(_ path: String) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.resolvingSymlinksInPath().path
        let under = { (root: String) in path == root || path.hasPrefix(root + "/") }
        var isDir: ObjCBool = false
        guard path.hasPrefix("/"), FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { return "to nie jest folder" }
        if path == "/" || home == path || home.hasPrefix(path + "/") { return "za szeroko: wybierz folder konkretnego projektu" }
        if path == "/Volumes" || path == "/Users" { return "za szeroko: wybierz folder konkretnego projektu" }
        if under(home + "/Library") { return "Biblioteka (~/Library) trzyma dane aplikacji i hasła" }
        if path.hasPrefix(home + "/.") { return "ukryte foldery w katalogu domowym trzymają klucze i ustawienia" }
        for sys in ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/tmp", "/opt", "/cores", "/dev"] where under(sys) { return "folder systemowy" }
        return nil
    }

    func save() {
        try? FileManager.default.createDirectory(at: Store.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let d = try? enc.encode(cfg) else { return }
        try? d.write(to: Store.file, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Store.file.path)
    }
}
