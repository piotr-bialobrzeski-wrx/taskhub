// Task Hub na Maca: okno z aplikacją, ikona w pasku menu, szybkie zadanie (⌃⌥T) i mostek do Claude Code w środku.
// Punkt wejścia na głównym wątku (@main zamiast main.swift, żeby cały start był izolowany do MainActor).
// „Task Hub --hook-guard” to strażnik biegów mostka (hook Claude Code): odpowiada i kończy, bez NSApplication i okien.
import AppKit

@main
struct TaskHubApp {
    static var delegate: AppDelegate? = nil          // NSApplication trzyma delegata słabo, więc trzymamy go tu

    @MainActor static func main() {
        let argv = CommandLine.arguments
        if argv.count > 1 && argv[1] == "--hook-guard" { exit(Guard.run()) }
        let app = NSApplication.shared
        let d = AppDelegate()
        delegate = d
        app.delegate = d
        _ = app.setActivationPolicy(.regular)
        app.run()
    }
}
