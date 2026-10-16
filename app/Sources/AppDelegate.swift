// Spina wszystko: menu aplikacji, ikonę w pasku menu, okno z Task Hub, okienko szybkiego zadania, Ustawienia,
// link taskhub://connect z Ustawień Task Hub i mostek, który pracuje także przy zamkniętym oknie.
import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let store = Store.shared
    private(set) lazy var bridge = Bridge(store: store)
    private var web: WebWindowController! = nil
    private var quick: QuickEntryController! = nil
    private var settings: NSWindowController? = nil
    private var statusItem: NSStatusItem! = nil
    private let statusMenu = NSMenu()
    private var hotKey: HotKey? = nil
    private var bag = Set<AnyCancellable>()
    private var applied = ""

    var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.write("Task Hub \(version) start")
        buildMainMenu()
        web = WebWindowController(store: store)
        web.onConnectURL = { [weak self] u in self?.handle(url: u) }
        quick = QuickEntryController(bridge: bridge, store: store)
        quick.model.openSettings = { [weak self] in self?.showSettings() }
        setupStatusItem()
        hotKey = HotKey(keyCode: HotKey.keyT, modifiers: HotKey.ctrlAlt) { [weak self] in self?.showQuickEntry() }
        bridge.objectWillChange.receive(on: DispatchQueue.main).sink { [weak self] _ in Task { @MainActor in self?.refreshStatusIcon() } }.store(in: &bag)
        store.$cfg.dropFirst().removeDuplicates().debounce(for: .seconds(0.8), scheduler: DispatchQueue.main).sink { [weak self] _ in self?.applyConfig() }.store(in: &bag)
        if store.configured {
            web.show()
            applyConfig()
        } else {
            web.show()
            showSettings()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }   // mostek pracuje dalej z paska menu

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMain()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        bridge.stop()
        Log.write("Task Hub koniec")
    }

    // taskhub://connect?url=…&token=… (z Ustawień Task Hub), taskhub://reload, taskhub://settings
    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls { handle(url: u) }
    }

    private func handle(url: URL) {
        switch url.host ?? "" {
        case "connect":
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let base = q.first { $0.name == "url" }?.value ?? ""
            let token = q.first { $0.name == "token" }?.value ?? ""
            guard !base.isEmpty, !token.isEmpty else { alert("Link połączenia jest niepełny.", "Utwórz nowy token mostka w Ustawieniach Task Hub i kliknij „Połącz aplikację” jeszcze raz."); return }
            var c = store.cfg
            c.url = base
            c.token = token
            c.bridge = true
            store.cfg = c
            applyConfig()
            web.load(force: false)
            showMain()
            Log.write("połączono przez link: \(store.baseURL)")
            alert("Połączono z Task Hub", "Mostek pracuje na tym Macu: \(store.cfg.name). Claude Code zajmie się zadaniami, gdy tylko się pojawią. Okienko nowego zadania: ⌃⌥T.")
        case "reload": web.reload()
        case "settings": showSettings()
        default: break
        }
    }

    // ---------- konfiguracja → mostek ----------
    private func applyConfig() {
        web.load(force: false)
        let key = store.baseURL + "|" + store.cfg.token + "|" + String(store.cfg.bridge)
        guard key != applied else { return }
        applied = key
        if store.configured && store.cfg.bridge { bridge.restart() } else { bridge.stop() }
        refreshStatusIcon()
    }

    // ---------- pasek menu ----------
    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusMenu.delegate = self
        statusItem.menu = statusMenu
        refreshStatusIcon()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === statusMenu else { return }
        menu.removeAllItems()
        let head = NSMenuItem(title: "Mostek: \(bridge.statusLine)", action: nil, keyEquivalent: "")
        head.isEnabled = false
        menu.addItem(head)
        if let t = bridge.lastPoll {
            let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
            let sub = NSMenuItem(title: "ostatni sygnał \(f.string(from: t)) · biegi: \(bridge.runs)", action: nil, keyEquivalent: "")
            sub.isEnabled = false
            menu.addItem(sub)
        }
        menu.addItem(.separator())
        menu.addItem(item("Otwórz Task Hub", #selector(showMain), "1"))
        menu.addItem(item("Nowe zadanie…", #selector(showQuickEntry), "n"))
        menu.addItem(.separator())
        let toggle = item(store.cfg.bridge ? "Wyłącz mostek" : "Włącz mostek", #selector(toggleBridge), "")
        toggle.isEnabled = store.configured
        menu.addItem(toggle)
        let now = item("Sprawdź teraz", #selector(pokeBridge), "")
        now.isEnabled = bridge.running
        menu.addItem(now)
        menu.addItem(.separator())
        menu.addItem(item("Ustawienia…", #selector(showSettings), ","))
        menu.addItem(item("Dziennik", #selector(showLog), ""))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Zakończ Task Hub", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        menu.addItem(quit)
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    private func refreshStatusIcon() {
        guard let button = statusItem?.button else { return }
        let state = bridge.state
        let img = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            let r = rect.insetBy(dx: 2.5, dy: 2.5)
            let path = NSBezierPath(roundedRect: r, xRadius: 4, yRadius: 4)
            path.lineWidth = 1.6
            NSColor.black.setStroke()
            path.stroke()
            let line = NSBezierPath()
            line.lineWidth = 1.6
            line.lineCapStyle = .round
            line.move(to: NSPoint(x: r.minX + 3.5, y: r.midY + 2)); line.line(to: NSPoint(x: r.maxX - 3.5, y: r.midY + 2))
            line.move(to: NSPoint(x: r.minX + 3.5, y: r.midY - 2)); line.line(to: NSPoint(x: r.midX + 0.5, y: r.midY - 2))
            line.stroke()
            if state == .running {
                NSColor.black.setFill()
                NSBezierPath(ovalIn: NSRect(x: r.maxX - 4.5, y: r.minY - 0.5, width: 5, height: 5)).fill()
            }
            return true
        }
        img.isTemplate = true
        button.image = img
        button.toolTip = "Task Hub · mostek: \(bridge.statusLine)"
        button.appearsDisabled = (state == .off || state == .offline || state == .auth)
    }

    // ---------- menu główne ----------
    private func buildMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "O Task Hub", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ustawienia…", action: #selector(showSettings), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ukryj Task Hub", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Ukryj pozostałe", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Pokaż wszystkie", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Zakończ Task Hub", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "Plik")
        fileMenu.addItem(withTitle: "Nowe zadanie…", action: #selector(showQuickEntry), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Zamknij okno", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Edycja")
        editMenu.addItem(withTitle: "Cofnij", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Ponów", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Wytnij", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Kopiuj", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Wklej", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Zaznacz wszystko", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "Widok")
        viewMenu.addItem(withTitle: "Odśwież", action: #selector(reloadWeb), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Wstecz", action: #selector(goBack), keyEquivalent: "[")
        viewMenu.addItem(.separator())
        let full = viewMenu.addItem(withTitle: "Pełny ekran", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Okno")
        windowMenu.addItem(withTitle: "Task Hub", action: #selector(showMain), keyEquivalent: "1")
        windowMenu.addItem(withTitle: "Minimalizuj", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    // ---------- akcje ----------
    @objc func showMain() {
        web.show()
    }

    @objc func showQuickEntry() {
        quick.show()
    }

    @objc func reloadWeb() { web.reload() }
    @objc func goBack() { web.goBack() }

    @objc func toggleBridge() {
        store.cfg.bridge.toggle()
        applyConfig()
    }

    @objc func pokeBridge() { bridge.poke() }

    @objc func showLog() {
        if !FileManager.default.fileExists(atPath: Log.url.path) { Log.write("dziennik założony") }
        NSWorkspace.shared.open(Log.url)
    }

    @objc func showSettings() {
        if settings == nil {
            let host = NSHostingController(rootView: SettingsView(store: store, bridge: bridge))
            let w = NSWindow(contentViewController: host)
            w.title = "Ustawienia Task Hub"
            w.styleMask = [.titled, .closable, .miniaturizable]
            w.isReleasedWhenClosed = false
            w.setFrameAutosaveName("TaskHubSettings")
            w.center()
            settings = NSWindowController(window: w)
        }
        settings?.showWindow(nil)
        settings?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func showAbout() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Task Hub",
            .applicationVersion: version,
            .credits: NSAttributedString(string: "Zadania z mostkiem do Claude Code na tym Macu.\nhttps://github.com/piotr-bialobrzeski-wrx/taskhub"),
        ])
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }
}
