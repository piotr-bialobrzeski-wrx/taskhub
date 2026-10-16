// Task Hub na Maca: okno z aplikacją, ikona w pasku menu, szybkie zadanie (⌃⌥T) i mostek do Claude Code w środku.
// Punkt wejścia na głównym wątku (@main zamiast main.swift, żeby cały start był izolowany do MainActor).
import AppKit

@main
struct TaskHubApp {
    static var delegate: AppDelegate? = nil          // NSApplication trzyma delegata słabo, więc trzymamy go tu

    @MainActor static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        delegate = d
        app.delegate = d
        _ = app.setActivationPolicy(.regular)
        app.run()
    }
}
