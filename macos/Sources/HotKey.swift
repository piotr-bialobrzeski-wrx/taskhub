// Globalne skróty klawiszowe (Carbon): skrót szybkiego paska (domyślnie ⌥Spacja, zmiana w Ustawieniach) działa z każdego miejsca.
// Carbon nie rozróżnia lewego i prawego Option; to wymagałoby event tapa i zgody macOS na monitorowanie klawiatury.
import AppKit
import Carbon
import Foundation

// skrót zapisany w config.json: kod klawisza i modyfikatory w zapisie Carbon, plus etykieta do pokazania („⌥Spacja”)
struct Shortcut: Codable, Equatable {
    var key: UInt32
    var mods: UInt32
    var label: String

    static let quickBar = Shortcut(key: 49, mods: UInt32(optionKey), label: "⌥Spacja")   // kVK_Space

    static func carbonMods(_ f: NSEvent.ModifierFlags) -> UInt32 {
        var m: UInt32 = 0
        if f.contains(.control) { m |= UInt32(controlKey) }
        if f.contains(.option) { m |= UInt32(optionKey) }
        if f.contains(.shift) { m |= UInt32(shiftKey) }
        if f.contains(.command) { m |= UInt32(cmdKey) }
        return m
    }

    static func modsLabel(_ m: UInt32) -> String {
        (m & UInt32(controlKey) != 0 ? "⌃" : "") + (m & UInt32(optionKey) != 0 ? "⌥" : "") + (m & UInt32(shiftKey) != 0 ? "⇧" : "") + (m & UInt32(cmdKey) != 0 ? "⌘" : "")
    }

    static let keyNames: [UInt16: String] = [
        49: "Spacja", 36: "↩", 48: "⇥", 51: "⌫", 117: "⌦", 53: "Esc", 123: "←", 124: "→", 125: "↓", 126: "↑", 115: "Home", 119: "End", 116: "PgUp", 121: "PgDn",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
    ]

    // z naciśnięcia w Ustawieniach; nil = bez ⌘, ⌃ ani ⌥ (sama litera albo ⇧ zabrałyby zwykłe pisanie)
    static func from(_ e: NSEvent) -> Shortcut? {
        let f = e.modifierFlags.intersection([.command, .control, .option, .shift])
        guard !f.intersection([.command, .control, .option]).isEmpty else { return nil }
        let mods = carbonMods(f)
        let name = keyNames[e.keyCode] ?? (e.charactersIgnoringModifiers ?? "").uppercased()
        guard !name.isEmpty, !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return Shortcut(key: UInt32(e.keyCode), mods: mods, label: modsLabel(mods) + name)
    }

    // Claude Code Quick trzyma swój skrót w ~/.claude-code-quick/config.json („shortcut”: „Alt+Space”); ten sam skrót = konflikt
    static func claudeQuick() -> String? {
        let u = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude-code-quick/config.json")
        guard let d = try? Data(contentsOf: u), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
        return j["shortcut"] as? String
    }

    func same(asText s: String) -> Bool {
        var m: UInt32 = 0
        var key = ""
        for raw in s.split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces).lowercased() }) {
            switch raw {
            case "alt", "option", "opt": m |= UInt32(optionKey)
            case "ctrl", "control": m |= UInt32(controlKey)
            case "cmd", "command", "meta", "super", "commandorcontrol", "cmdorctrl": m |= UInt32(cmdKey)
            case "shift": m |= UInt32(shiftKey)
            default: key = raw
            }
        }
        let mine = (Shortcut.keyNames[UInt16(self.key)] ?? String(label.drop(while: { "⌃⌥⇧⌘".contains($0) }))).lowercased()
        let theirs = key == "space" ? "spacja" : key
        return m == mods && mine == theirs
    }
}

final class HotKey {
    private static var actions: [UInt32: () -> Void] = [:]
    private static var handler: EventHandlerRef? = nil
    private static var nextId: UInt32 = 1

    private var ref: EventHotKeyRef? = nil
    private let id: UInt32
    let status: OSStatus
    var ok: Bool { status == noErr }

    init(keyCode: UInt32, modifiers: UInt32, action: @escaping () -> Void) {
        HotKey.installHandler()
        id = HotKey.nextId
        HotKey.nextId += 1
        HotKey.actions[id] = action
        var r: EventHotKeyRef? = nil
        status = RegisterEventHotKey(keyCode, modifiers, EventHotKeyID(signature: OSType(0x5448_4B31), id: id), GetApplicationEventTarget(), 0, &r)   // "THK1"
        ref = r
        if status != noErr { Log.write("skrót \(Shortcut.modsLabel(modifiers))\(keyCode): macOS go nie przyjął (\(status)), pewnie zajęty") }
    }

    private static func installHandler() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, event, _) -> OSStatus in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let id = hk.id
            DispatchQueue.main.async { HotKey.actions[id]?() }
            return noErr
        }, 1, &spec, nil, &handler)
    }

    deinit {
        if let r = ref { UnregisterEventHotKey(r) }
        HotKey.actions[id] = nil
    }
}

// stan skrótu paska dla Ustawień: czy macOS go przyjął i czy właśnie nagrywamy nowy (wtedy skrót jest wyłączony)
final class ShortcutState: ObservableObject {
    static let shared = ShortcutState()
    @Published var ok = true
    @Published var recording = false
}
