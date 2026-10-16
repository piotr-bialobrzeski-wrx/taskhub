// Task Hub na Maca: okno z aplikacją, ikona w pasku menu, szybkie zadanie (⌃⌥T) i mostek do Claude Code w środku.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
