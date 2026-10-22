// Powiadomienie o biegu: gdy Claude pracuje na tym Macu, w rogu ekranu wisi „Claude pracuje” z przyciskiem „Zatrzymaj”.
// Koniec biegu zdejmuje powiadomienie. Gdy macOS nie pozwala na powiadomienia, zostaje „Zatrzymaj bieg” w pasku menu.
import Foundation
import UserNotifications

// stałe poza klasą z MainActor, żeby metody delegata (nonisolated) mogły ich używać
enum RunNote {
    static let category = "run"
    static let stop = "stop"
    static let id = "taskhub-run"
}

@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    var onStop: () -> Void = {}   // AppDelegate: bridge.cancelRun()
    var onOpen: () -> Void = {}   // kliknięcie w treść: okno Task Hub
    private var ready = false
    private var failed = false    // błąd dodania loguj raz, nie przy każdym biegu

    private override init() { super.init() }

    // raz na start: delegat, kategoria z przyciskiem „Zatrzymaj”, prośba o zgodę (macOS pyta tylko za pierwszym razem)
    func setup() {
        guard !ready else { return }
        ready = true
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        let stop = UNNotificationAction(identifier: RunNote.stop, title: "Zatrzymaj", options: [.destructive])
        c.setNotificationCategories([UNNotificationCategory(identifier: RunNote.category, actions: [stop], intentIdentifiers: [], options: [])])
        c.requestAuthorization(options: [.alert]) { granted, error in
            if let e = error { Log.write("powiadomienia: \(e.localizedDescription)") }
            else if !granted { Log.write("powiadomienia wyłączone w Ustawieniach systemowych; bieg zatrzymasz z paska menu") }
        }
    }

    func runStarted(label: String) {
        setup()
        let content = UNMutableNotificationContent()
        content.title = "Claude pracuje na tym Macu"
        content.body = label.isEmpty ? "Bieg mostka Task Hub." : label
        content.categoryIdentifier = RunNote.category
        let req = UNNotificationRequest(identifier: RunNote.id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req) { error in
            guard let e = error else { return }
            let msg = e.localizedDescription
            Task { @MainActor in Notifier.shared.addFailed(msg) }
        }
    }

    private func addFailed(_ msg: String) {
        guard !failed else { return }
        failed = true
        Log.write("powiadomienie o biegu: \(msg)")
    }

    // zwykła informacja (np. wiadomość z szybkiego paska nie poszła)
    func notice(_ title: String, _ body: String) {
        setup()
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "taskhub-notice-\(UUID().uuidString)", content: content, trigger: nil)) { error in
            if let e = error { let msg = e.localizedDescription; Task { @MainActor in Log.write("powiadomienie: \(msg)") } }
        }
    }

    func runEnded() {
        let c = UNUserNotificationCenter.current()
        c.removePendingNotificationRequests(withIdentifiers: [RunNote.id])
        c.removeDeliveredNotifications(withIdentifiers: [RunNote.id])
    }

    // ---------- delegat (wywołania spoza głównego wątku) ----------
    // także przy otwartym oknie aplikacji pokaż powiadomienie
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let action = response.actionIdentifier
        let id = response.notification.request.identifier
        completionHandler()
        guard id == RunNote.id else { return }
        Task { @MainActor in
            if action == RunNote.stop {
                Log.write("bieg: Zatrzymaj z powiadomienia")
                Notifier.shared.onStop()
            } else if action == UNNotificationDefaultActionIdentifier {
                Notifier.shared.onOpen()
            }
        }
    }
}
