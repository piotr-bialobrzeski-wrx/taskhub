// Dziennik aplikacji: ~/Library/Logs/Task Hub.log (to samo, co widać w Ustawieniach → Dziennik).
import Foundation

enum Log {
    static let url: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Task Hub.log")
    private static let queue = DispatchQueue(label: "taskhub.log")
    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func write(_ s: String) {
        let line = "\(fmt.string(from: Date())) \(s)\n"
        NSLog("%@", s)
        queue.async {
            guard let d = line.data(using: .utf8) else { return }
            rotateIfNeeded()
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile()
                h.write(d)
                try? h.close()
            } else {
                try? d.write(to: url)
            }
        }
    }

    // plik rośnie bez końca, więc po 2 MB zostawiamy tylko końcówkę
    private static func rotateIfNeeded() {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path), let size = attrs[.size] as? Int, size > 2_000_000 else { return }
        guard let d = try? Data(contentsOf: url) else { return }
        let tail = d.suffix(500_000)
        try? tail.write(to: url)
    }

    static func tail(_ lines: Int = 40) -> String {
        guard let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s.split(separator: "\n").suffix(lines).joined(separator: "\n")
    }
}
