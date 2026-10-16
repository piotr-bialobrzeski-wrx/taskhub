// Task Hub na Maca: okno z aplikacją, ikona w pasku menu, szybkie zadanie (⌃⌥T) i mostek do Claude Code w środku.
import AppKit

let app = NSApplication.shared
var delegate: AppDelegate? = nil          // NSApplication trzyma delegata słabo, więc trzymamy go tu
delegate = AppDelegate()
app.delegate = delegate
_ = app.setActivationPolicy(.regular)
app.run()
