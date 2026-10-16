// Ustawienia aplikacji: ~/Library/Application Support/Task Hub/config.json (tylko dla właściciela, 0600).
// Token mostka leży w tym pliku tak jak w Project Hub; katalog „work” to miejsce, w którym pracuje Claude Code.
import Foundation

struct Config: Codable, Equatable {
    var url: String = ""        // adres Task Hub, np. https://taskhub-lac.vercel.app
    var token: String = ""      // token mostka z Ustawień Task Hub
    var name: String = ""       // nazwa tego komputera (widać ją w Task Hub)
    var claude: String = ""     // ścieżka do Claude Code; puste = szukaj w typowych miejscach
    var model: String = ""      // model dla biegów; puste = domyślny Claude Code
    var bridge: Bool = true     // czy mostek ma pracować
}

final class Store: ObservableObject {
    static let shared = Store()
    static let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Task Hub", isDirectory: true)
    static let workDir = dir.appendingPathComponent("work", isDirectory: true)
    static let file = dir.appendingPathComponent("config.json")

    @Published var cfg: Config {
        didSet { if cfg != oldValue { save() } }
    }

    private init() {
        var c = Config()
        if let d = try? Data(contentsOf: Store.file), let x = try? JSONDecoder().decode(Config.self, from: d) { c = x }
        if c.name.isEmpty { c.name = Store.computerName() }
        cfg = c
        try? FileManager.default.createDirectory(at: Store.workDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
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

    func save() {
        try? FileManager.default.createDirectory(at: Store.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let d = try? enc.encode(cfg) else { return }
        try? d.write(to: Store.file, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Store.file.path)
    }
}
