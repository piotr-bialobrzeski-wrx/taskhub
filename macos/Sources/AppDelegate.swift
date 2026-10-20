// Spina wszystko: menu aplikacji, ikonę w pasku menu, okno z Task Hub, okienko szybkiego zadania, Ustawienia,
// link taskhub://connect z Ustawień Task Hub (tylko po pytaniu) i mostek, który pracuje także przy zamkniętym oknie.
import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let store = Store.shared
    private(set) lazy var bridge = Bridge(store: store)
    private(set) lazy var updater = Updater(store: store)
    private var web: WebWindowController! = nil
    private var quick: QuickEntryController! = nil
    private var settings: NSWindowController? = nil
    private var statusItem: NSStatusItem! = nil
    private let statusMenu = NSMenu()
    private var hotKey: HotKey? = nil
    private var bag = Set<AnyCancellable>()
    private var applied = ""
    private var connecting = false   // okno „Połączyć…?” już wisi

    var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.write("Task Hub \(version) start")
        buildMainMenu()
        web = WebWindowController(store: store)
        web.onConnectURL = { [weak self] u in self?.handle(url: u) }
        quick = QuickEntryController(bridge: bridge, store: store)
        quick.model.openSettings = { [weak self] in self?.showSettings() }
        setupStatusItem()
        // powiadomienie „Claude pracuje” z przyciskiem Zatrzymaj (mostek woła runStarted/runEnded)
        Notifier.shared.onStop = { [weak self] in self?.stopRun() }
        Notifier.shared.onOpen = { [weak self] in self?.showMain() }
        Notifier.shared.setup()
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
        // samoaktualizacja: cicho, gdy okna zamknięte i mostek nie pracuje; inaczej pytamy
        updater.canRelaunchQuietly = { [weak self] in
            guard let self = self else { return false }
            let visible = [self.web.window, self.settings?.window, self.quick.window].contains { $0?.isVisible == true }
            return !visible && self.bridge.state != .running
        }
        updater.askRelaunch = { [weak self] v in self?.askRelaunch(v) }
        updater.startSchedule()
    }

    private func askRelaunch(_ version: String) {
        let a = NSAlert()
        a.messageText = "Task Hub \(version) gotowy"
        a.informativeText = "Nowa wersja jest już zainstalowana. Uruchomić aplikację ponownie teraz? Mostek wznowi pracę po chwili."
        a.addButton(withTitle: "Uruchom ponownie")
        a.addButton(withTitle: "Później")
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertFirstButtonReturn { updater.relaunch() }
    }

    @objc func checkUpdates() {
        Task { @MainActor [self] in
            await self.updater.check(auto: false)
            if self.updater.ready == nil { self.alert("Aktualizacje", self.updater.status.isEmpty ? "Masz najnowszą wersję (\(self.updater.currentVersion))." : self.updater.status) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }   // mostek pracuje dalej z paska menu

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMain()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        bridge.stop()
        Notifier.shared.runEnded()
        Log.write("Task Hub koniec")
    }

    // taskhub://connect?url=…&token=… (z Ustawień Task Hub), taskhub://reload, taskhub://settings
    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls { handle(url: u) }
    }

    private func handle(url: URL) {
        guard url.scheme?.lowercased() == "taskhub" else { return }
        switch (url.host ?? "").lowercased() {
        case "connect": connect(url)
        case "reload": web.reload()       // ze strony zastępczej w oknie
        case "settings": showSettings()
        default: Log.write("link taskhub://\(url.host ?? "") pominięty")
        }
    }

    // Link połączenia zmienia adres i token mostka, więc nigdy nie działa po cichu: tylko https (http wyłącznie lokalnie),
    // przy połączonej aplikacji tylko ten sam host, zawsze z pytaniem pokazującym adres.
    private func connect(_ link: URL) {
        guard !connecting else { return }
        let q = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let raw = (q.first { $0.name == "url" }?.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let token = (q.first { $0.name == "token" }?.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, !token.isEmpty else { alert("Link połączenia jest niepełny.", "Utwórz nowy token mostka w Ustawieniach Task Hub i kliknij „Połącz aplikację” jeszcze raz."); return }
        guard let u = URL(string: raw), let scheme = u.scheme?.lowercased(), let host = Store.hostKey(u),
              scheme == "https" || (scheme == "http" && Store.isLocalHost(u.host?.lowercased())) else {
            Log.write("link połączenia odrzucony: adres \(raw.prefix(80))")
            alert("Link połączenia ma zły adres.", "Task Hub musi mieć adres https://…. Nic nie zmieniłem.")
            return
        }
        guard token.count <= 256, token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) else {
            Log.write("link połączenia odrzucony: zły token")
            alert("Link połączenia ma zły token.", "Utwórz nowy token mostka w Ustawieniach Task Hub i kliknij „Połącz aplikację” jeszcze raz.")
            return
        }
        let origin = "\(scheme)://\(host)"
        let current = store.host
        if store.configured, let cur = current, cur != host {
            Log.write("link połączenia odrzucony: \(host), a aplikacja jest połączona z \(cur)")
            alert("Ten link prowadzi do innego Task Hub.", "Aplikacja jest połączona z \(cur), a link wskazuje \(host). Nic nie zmieniłem. Jeśli naprawdę chcesz przejść na nowy adres, wpisz go razem z nowym tokenem w Ustawieniach aplikacji.")
            return
        }
        if store.configured && store.baseURL == origin && store.cfg.token == token { showMain(); return }   // nic nowego

        let known = host == current || host == Store.defaultHost
        let a = NSAlert()
        a.messageText = "Połączyć tę aplikację z Task Hub pod adresem \(host)?"
        a.informativeText = (known ? "" : "Ten adres różni się od zwykłego (\(Store.defaultHost)). ")
            + "Mostek na tym Macu (\(store.cfg.name)) będzie brał stamtąd zadania i uruchamiał na nich Claude Code. Połącz tylko wtedy, gdy przed chwilą sam kliknąłeś „Połącz aplikację” w swoim Task Hub."
        a.alertStyle = known ? .informational : .warning
        a.addButton(withTitle: "Połącz")
        a.addButton(withTitle: "Anuluj")
        if known {
            a.buttons[1].keyEquivalent = "\u{1b}"
        } else {
            // nieznany adres: Enter anuluje
            a.buttons[0].keyEquivalent = ""
            a.buttons[1].keyEquivalent = "\r"
        }
        NSApp.activate(ignoringOtherApps: true)
        connecting = true
        let ok = a.runModal() == .alertFirstButtonReturn
        connecting = false
        guard ok else { Log.write("link połączenia: anulowano (\(host))"); return }

        var c = store.cfg
        c.url = origin
        c.token = token
        c.bridge = true
        store.cfg = c
        applyConfig()
        web.load(force: false)
        showMain()
        Log.write("połączono przez link: \(store.baseURL)")
        alert("Połączono z Task Hub", "Mostek pracuje na tym Macu: \(store.cfg.name). Claude Code zajmie się zadaniami, gdy tylko się pojawią. Okienko nowego zadania: ⌃⌥T.")
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
        if bridge.isRunningNow {
            let stop = item("Zatrzymaj bieg", #selector(stopRun), "")
            if !bridge.runLabel.isEmpty { stop.toolTip = bridge.runLabel }
            menu.addItem(stop)
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
        if let v = updater.ready {
            menu.addItem(item("Uruchom ponownie: wersja \(v) gotowa", #selector(relaunchApp), ""))
        }
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
        appMenu.addItem(withTitle: "Sprawdź aktualizacje…", action: #selector(checkUpdates), keyEquivalent: "")
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

    // Zatrzymaj z paska menu albo z powiadomienia: przerywa bieżący bieg, mostek odczeka chwilę
    @objc func stopRun() {
        guard bridge.isRunningNow else { return }
        Log.write("bieg: Zatrzymaj")
        bridge.cancelRun()
    }
    @objc func relaunchApp() { updater.relaunch() }

    @objc func showLog() {
        if !FileManager.default.fileExists(atPath: Log.url.path) { Log.write("dziennik założony") }
        NSWorkspace.shared.open(Log.url)
    }

    @objc func showSettings() {
        if settings == nil {
            // Form (lista) nie ma własnej wysokości, więc rozmiar okna ustawiamy wprost; inaczej okno ma sam pasek tytułu
            let host = NSHostingController(rootView: SettingsView(store: store, bridge: bridge, updater: updater))
            host.view.frame = NSRect(x: 0, y: 0, width: 620, height: 640)
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 640), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Ustawienia Task Hub"
            w.isReleasedWhenClosed = false
            w.contentViewController = host
            w.contentMinSize = NSSize(width: 560, height: 420)
            w.setContentSize(NSSize(width: 620, height: 640))
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
            .credits: NSAttributedString(string: "Zadania z mostkiem do Claude Code na tym Macu."),
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
