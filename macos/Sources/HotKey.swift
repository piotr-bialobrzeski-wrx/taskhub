// Globalny skrót klawiszowy (Carbon): ⌃⌥T otwiera okienko „Nowe zadanie” z każdego miejsca, jak w Claude Code Quick.
import Carbon
import Foundation

final class HotKey {
    static let keyT: UInt32 = 17                                     // kVK_ANSI_T
    static let ctrlAlt: UInt32 = UInt32(controlKey | optionKey)
    private static var current: HotKey? = nil                        // jeden skrót w aplikacji

    private var hotKeyRef: EventHotKeyRef? = nil
    private var handlerRef: EventHandlerRef? = nil
    private let action: () -> Void

    init(keyCode: UInt32, modifiers: UInt32, action: @escaping () -> Void) {
        self.action = action
        HotKey.current = self
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, _) -> OSStatus in
            DispatchQueue.main.async { HotKey.current?.action() }
            return noErr
        }, 1, &spec, nil, &handlerRef)
        let id = EventHotKeyID(signature: OSType(0x5448_4B31), id: 1)   // "THK1"
        RegisterEventHotKey(keyCode, modifiers, id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    deinit {
        if let r = hotKeyRef { UnregisterEventHotKey(r) }
        if let h = handlerRef { RemoveEventHandler(h) }
    }
}
