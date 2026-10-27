// Foldery z narzędziami (paczka 22): np. ~/world (Pirxey World). Claude Code w okienku otwartym w takim folderze widzi serwery MCP
// z jego .mcp.json (Slack, Google, pirxey-time…), a bieg mostka pracuje w work/ i ustawień folderów celowo nie wczytuje. Dlatego mostek
// czyta z .mcp.json tylko listę serwerów (nic innego z ustawień folderu: haki, uprawnienia, skille) i podaje ją w pliku MCP biegu.
// Narzędzia tych serwerów przechodzą przez te same zasady co konektory: czytanie bez pytania, zapis zablokowany (szkic do zgody Piotra).
// Plik .mcp.json i .env w tych folderach trzymają tokeny, więc agent ich nie czyta (Policy.secretFiles).
import Foundation

enum ToolFolders {
    // pliki z tokenami w folderze z narzędziami: tego agent nie czyta
    static let secretNames = [".mcp.json", ".env", ".envrc", ".claude/settings.local.json"]

    struct Server {
        var name: String
        var folder: String
        var transport: String     // stdio, http, sse
        var target: String        // polecenie albo adres (bez tokenów)
        var config: [String: Any]
    }

    // foldery z Ustawień, które się nadają (jak foldery z kodem); złe pomijamy
    static func folders(_ cfg: Config) -> [String] { Policy.codeFolders(cfg.toolFolders, what: "folder z narzędziami") }

    // serwery z .mcp.json jednego folderu, w kolejności z pliku; zły plik = pusta lista (bieg idzie bez nich)
    static func servers(in folder: String) -> [Server] {
        let f = URL(fileURLWithPath: folder).appendingPathComponent(".mcp.json")
        guard let d = try? Data(contentsOf: f), let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let list = obj["mcpServers"] as? [String: Any] else { return [] }
        var out: [Server] = []
        for name in list.keys.sorted() {
            guard let c = list[name] as? [String: Any], valid(name) else { continue }
            let url = (c["url"] as? String) ?? ""
            let cmd = (c["command"] as? String) ?? ""
            let type = ((c["type"] as? String) ?? (url.isEmpty ? "stdio" : "http")).lowercased()
            if type == "stdio" ? cmd.isEmpty : url.isEmpty { continue }
            // konfiguracja bez zmian: bieg startuje w work/, więc działają polecenia ze ścieżką bezwzględną albo z PATH (node, npx, uvx)
            out.append(Server(name: name, folder: folder, transport: type, target: type == "stdio" ? cmd : url, config: c))
        }
        return out
    }

    // nazwa serwera nadaje się do reguł (mcp__nazwa__narzędzie) i nie podszywa się pod Task Hub
    static func valid(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 64 && name != Policy.hub && Policy.norm(name) == name && !name.contains("__")
    }

    // serwery wszystkich folderów bez wyłączonych w Ustawieniach; ta sama nazwa w dwóch folderach: wygrywa pierwszy folder
    static func enabled(_ cfg: Config) -> [Server] {
        var out: [Server] = []
        for f in folders(cfg) {
            for s in servers(in: f) where !cfg.toolSkip.contains(s.name) && !out.contains(where: { $0.name == s.name }) { out.append(s) }
        }
        return out
    }

    // fragment pliku MCP biegu: nazwa → konfiguracja (z tokenami; plik biegu leży w run/, 0600, i znika po biegu)
    static func mcpServers(_ list: [Server]) -> [String: Any] {
        var d: [String: Any] = [:]
        for s in list { d[s.name] = s.config }
        return d
    }

    // pliki z tokenami we wszystkich folderach z narzędziami z Ustawień (także wyłączonych serwerów), po ścieżce zapisanej i bez dowiązań;
    // bez sprawdzania folderów i bez wpisów do dziennika, bo woła to też strażnik przed każdym narzędziem
    static func secretFiles(_ cfg: Config) -> [String] {
        var out: [String] = []
        for raw in cfg.toolFolders where raw.hasPrefix("/") {
            for f in [raw, Store.normalizedFolder(URL(fileURLWithPath: raw))] {
                for n in secretNames where !out.contains(f + "/" + n) { out.append(f + "/" + n) }
            }
        }
        return out
    }
}
