// Ustawienia aplikacji (⌘,): połączenie z Task Hub, szybki pasek (skrót), mostek, Claude Code, foldery z kodem, start po zalogowaniu, dziennik.
import AppKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: Store
    @ObservedObject var bridge: Bridge
    @ObservedObject var updater: Updater
    @ObservedObject var keys = ShortcutState.shared
    @State private var keyMonitor: Any? = nil
    @State private var keyInfo = ""
    @State private var connectInfo = ""
    @State private var checking = false
    @State private var claudeInfo = ""
    @State private var loginItem = SettingsView.loginEnabled()
    @State private var loginError = ""
    @State private var folderInfo = ""
    @State private var fileFolderInfo = ""

    static func loginEnabled() -> Bool {
        if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
        return false
    }

    var claudePath: String {
        let custom = store.cfg.claude.trimmingCharacters(in: .whitespaces)
        if !custom.isEmpty { return custom }
        return ClaudeCLI.find("") ?? "nie znaleziono (zainstaluj Claude Code)"
    }

    var body: some View {
        Form {
            Section("Połączenie z Task Hub") {
                TextField("Adres", text: $store.cfg.url, prompt: Text("https://taskhub-lac.vercel.app"))
                SecureField("Token mostka", text: $store.cfg.token, prompt: Text("th_… z Ustawień Task Hub → Agent → Mostek"))
                HStack(spacing: 10) {
                    Button(checking ? "Sprawdzam…" : "Sprawdź połączenie") { check() }.disabled(checking || !store.configured)
                    Text(connectInfo).font(.system(size: 12)).foregroundColor(Theme.sub).lineLimit(2)
                }
                Text("Najprościej: w Task Hub (przeglądarka) → Ustawienia → Mostek na komputerze → „Połącz aplikację Task Hub na tym Macu”. Adres i token wpiszą się same.")
                    .font(.system(size: 11.5)).foregroundColor(Theme.sub)
            }
            Section("Szybki pasek") {
                LabeledContent("Skrót") {
                    HStack(spacing: 8) {
                        Button(keys.recording ? "Naciśnij nowy skrót…" : store.cfg.quickBar.label) { keys.recording ? stopRecording() : startRecording() }
                            .help(keys.recording ? "Esc anuluje" : "Kliknij i naciśnij nowy skrót")
                        if store.cfg.quickBar != Shortcut.quickBar && !keys.recording { Button("Domyślny (⌥Spacja)") { store.cfg.quickBar = Shortcut.quickBar; keyInfo = "" } }
                        Button("Otwórz pasek") { (NSApp.delegate as? AppDelegate)?.showQuickBar() }
                    }
                }
                if !keyInfo.isEmpty { Text(keyInfo).font(.system(size: 12)).foregroundColor(Theme.danger) }
                if !keys.ok && !keys.recording {
                    Text("macOS nie przyjął skrótu \(store.cfg.quickBar.label): pewnie ma go już inna aplikacja. Wybierz inny.").font(.system(size: 12)).foregroundColor(Theme.danger)
                }
                if let cq = Shortcut.claudeQuick(), store.cfg.quickBar.same(asText: cq) {
                    Text("Ten sam skrót otwiera Claude Code Quick (\(cq)). Zmień skrót tam albo wybierz tu inny, inaczej oba okienka będą się kłócić.").font(.system(size: 12)).foregroundColor(Theme.danger)
                }
                Text("Pasek otworzysz tym skrótem z każdego miejsca i biurka. Lewy i prawy Option działają tak samo: macOS nie rozróżnia ich w skrótach.")
                    .font(.system(size: 11.5)).foregroundColor(Theme.sub)
            }
            Section("Mostek: Claude pracuje w tle na tym Macu") {
                Toggle("Mostek włączony", isOn: $store.cfg.bridge)
                LabeledContent("Stan") { Text(bridge.statusLine).lineLimit(2) }
                LabeledContent("Claude Code") {
                    HStack(spacing: 8) {
                        Text(claudePath).lineLimit(1).truncationMode(.middle)
                        Button("Zmień…") { pickClaude() }
                        if !store.cfg.claude.isEmpty { Button("Domyślna") { store.cfg.claude = "" ; claudeInfo = "" } }
                        Button("Sprawdź") { checkClaude() }
                    }
                }
                if !claudeInfo.isEmpty { Text(claudeInfo).font(.system(size: 12)).foregroundColor(Theme.sub) }
                TextField("Nazwa tego komputera", text: $store.cfg.name)
                TextField("Model (puste = domyślny Claude Code)", text: $store.cfg.model, prompt: Text("np. sonnet"))
                Toggle("Uruchamiaj Task Hub po zalogowaniu do Maca", isOn: $loginItem)
                    .onChange(of: loginItem) { v in setLogin(v) }
                if !loginError.isEmpty { Text(loginError).font(.system(size: 12)).foregroundColor(Theme.danger) }
                Text("Mostek pyta Task Hub co kilkanaście sekund (bez tokenów) i uruchamia Claude Code tylko wtedy, gdy czeka praca. Gdy Mac śpi, pracę przejmuje automat co godzinę.")
                    .font(.system(size: 11.5)).foregroundColor(Theme.sub)
            }
            Section("Foldery z kodem") {
                ForEach(store.cfg.codeFolders, id: \.self) { f in
                    HStack(spacing: 8) {
                        Image(systemName: "folder").foregroundColor(Theme.sub)
                        Text(f).lineLimit(1).truncationMode(.middle)
                        if !SettingsView.isFolder(f) { Text("nie ma go").font(.system(size: 11.5)).foregroundColor(Theme.danger) }
                        else if !SettingsView.isRepoRoot(f) { Text("bez .git: to nie główny folder repozytorium").font(.system(size: 11.5)).foregroundColor(Theme.sub) }
                        Spacer()
                        Button("Usuń") { removeFolder(f) }
                    }
                }
                if store.cfg.codeFolders.isEmpty {
                    Text("Brak. Kroki z kodem wrócą do Ciebie z prośbą o dodanie folderu.").font(.system(size: 12)).foregroundColor(Theme.sub)
                }
                HStack(spacing: 10) {
                    Button("Dodaj folder…") { addFolders() }
                    if !folderInfo.isEmpty { Text(folderInfo).font(.system(size: 12)).foregroundColor(Theme.danger).lineLimit(2) }
                }
                Text("Tylko w tych folderach Claude może zmieniać pliki i uruchamiać testy w krokach z kodem. Dodaj główny folder repozytorium (ten z katalogiem .git).")
                    .font(.system(size: 11.5)).foregroundColor(Theme.sub)
                if store.cfg.codeFolders.contains(where: SettingsView.isProtected) {
                    Text("Dokumenty, Biurko i Pobrane macOS chroni osobno: przy pierwszym biegu może zapytać, czy Task Hub ma do nich dostęp.")
                        .font(.system(size: 11.5)).foregroundColor(Theme.sub)
                }
            }
            Section("Foldery na pliki") {
                ForEach(store.cfg.fileFolders, id: \.self) { f in
                    HStack(spacing: 8) {
                        Image(systemName: "doc").foregroundColor(Theme.sub)
                        Text(f).lineLimit(1).truncationMode(.middle)
                        if !SettingsView.isFolder(f) { Text("nie ma go").font(.system(size: 11.5)).foregroundColor(Theme.danger) }
                        Spacer()
                        Button("Usuń") { removeFileFolder(f) }
                    }
                }
                if store.cfg.fileFolders.isEmpty {
                    Text("Brak. Kroki „Plik na Macu” wrócą do Ciebie z prośbą o dodanie folderu.").font(.system(size: 12)).foregroundColor(Theme.sub)
                }
                HStack(spacing: 10) {
                    Button("Dodaj folder…") { addFileFolders() }
                    if !fileFolderInfo.isEmpty { Text(fileFolderInfo).font(.system(size: 12)).foregroundColor(Theme.danger).lineLimit(2) }
                }
                Text("Tu Claude zapisuje pliki z kroków „Plik na Macu”, np. story do folderu roboczego. Tylko nowe pliki: bez czytania folderu i bez poleceń. Nie dodawaj folderów udostępnianych innym (Dysk Google, Dropbox, iCloud).")
                    .font(.system(size: 11.5)).foregroundColor(Theme.sub)
                if store.cfg.fileFolders.contains(where: SettingsView.isProtected) {
                    Text("Dokumenty, Biurko i Pobrane macOS chroni osobno: przy pierwszym biegu może zapytać, czy Task Hub ma do nich dostęp.")
                        .font(.system(size: 11.5)).foregroundColor(Theme.sub)
                }
            }
            Section("Aktualizacje") {
                Toggle("Aktualizuj automatycznie (sprawdza co 6 godzin)", isOn: $store.cfg.autoUpdate)
                LabeledContent("Wersja") {
                    HStack(spacing: 8) {
                        Text(updater.currentVersion)
                        Button("Sprawdź teraz") { Task { @MainActor in await updater.check(auto: false) } }
                        if updater.ready != nil { Button("Uruchom ponownie") { updater.relaunch() } }
                    }
                }
                if !updater.status.isEmpty { Text(updater.status).font(.system(size: 12)).foregroundColor(Theme.sub).lineLimit(2) }
            }
            Section("Dziennik") {
                HStack(spacing: 10) {
                    Button("Pokaż dziennik") { NSWorkspace.shared.open(Log.url) }
                    Text(Log.url.path).font(.system(size: 11)).foregroundColor(Theme.sub).lineLimit(1).truncationMode(.middle)
                }
            }
        }
        .formStyle(.grouped)
        .onDisappear { stopRecording() }
        .frame(minWidth: 560, idealWidth: 620, maxWidth: .infinity, minHeight: 420, idealHeight: 640, maxHeight: .infinity)
    }

    // nagrywanie skrótu: następne naciśnięcie z ⌘, ⌃ albo ⌥ zostaje skrótem paska; Esc anuluje
    @MainActor private func startRecording() {
        keyInfo = ""
        keys.recording = true
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            let plain = e.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty
            if e.keyCode == 53 && plain { stopRecording(); return nil }   // Esc
            guard let s = Shortcut.from(e) else {
                keyInfo = "Skrót musi mieć ⌘, ⌃ albo ⌥ (np. ⌥Spacja, ⌃⌥T)."
                NSSound.beep()
                return nil
            }
            store.cfg.quickBar = s
            stopRecording()
            return nil
        }
    }

    @MainActor private func stopRecording() {
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        keyMonitor = nil
        if keys.recording { keys.recording = false }
    }

    @MainActor private func check() {
        checking = true
        connectInfo = ""
        Task { @MainActor in
            do {
                let n = try await bridge.check()
                connectInfo = n == 0 ? "Połączono. Nic nie czeka." : "Połączono. Czeka: \(n)."
            } catch {
                connectInfo = error.localizedDescription
            }
            checking = false
        }
    }

    @MainActor private func checkClaude() {
        guard let bin = ClaudeCLI.find(store.cfg.claude) else {
            claudeInfo = "Nie znaleziono Claude Code. Zainstaluj go (claude.ai/code), zaloguj się w Terminalu (claude → /login) albo wskaż plik „claude”."
            return
        }
        claudeInfo = "Sprawdzam…"
        Task { @MainActor in
            if let v = await ClaudeCLI.version(bin) { claudeInfo = "Claude Code \(v) (\(bin)). Zalogowanie sprawdzi pierwszy bieg." }
            else { claudeInfo = "Plik \(bin) nie odpowiada na --version." }
        }
    }

    @MainActor private func pickClaude() {
        let p = NSOpenPanel()
        p.canChooseFiles = true
        p.canChooseDirectories = false
        p.showsHiddenFiles = true
        p.message = "Wskaż program „claude” (np. ~/.local/bin/claude)"
        if p.runModal() == .OK, let u = p.url {
            store.cfg.claude = u.path
            claudeInfo = ""
        }
    }

    static func isFolder(_ path: String) -> Bool {
        var d: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &d) && d.boolValue
    }

    // główny folder repozytorium: ma .git (katalog albo plik); commit z aplikacji podfolderu nie przyjmie
    static func isRepoRoot(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: path + "/.git")
    }

    // foldery, o które macOS pyta osobno (prywatność): Dokumenty, Biurko, Pobrane
    static func isProtected(_ path: String) -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let names: [String] = ["Documents", "Desktop", "Downloads"]
        for name in names {
            let root = home + "/" + name
            if path == root || path.hasPrefix(root + "/") { return true }
        }
        return false
    }

    @MainActor private func addFolders() {
        let p = NSOpenPanel()
        p.canChooseFiles = false
        p.canChooseDirectories = true
        p.allowsMultipleSelection = true
        p.canCreateDirectories = false
        p.prompt = "Dodaj"
        p.message = "Wskaż główny folder repozytorium (ten z katalogiem .git). Claude będzie mógł w nim zmieniać pliki i uruchamiać testy."
        guard p.runModal() == .OK else { return }
        var list = store.cfg.codeFolders
        var refused: [String] = []
        for u in p.urls {
            let path = Store.normalizedFolder(u)
            if let why = Store.folderProblem(path) { refused.append("\((path as NSString).lastPathComponent): \(why)"); continue }
            if !list.contains(path) { list.append(path) }
        }
        if list != store.cfg.codeFolders { store.cfg.codeFolders = list }
        folderInfo = refused.isEmpty ? "" : "Nie dodałem: " + refused.joined(separator: "; ")
        if !refused.isEmpty { Log.write("foldery z kodem: odrzucone \(refused.joined(separator: "; "))") }
    }

    @MainActor private func removeFolder(_ path: String) {
        store.cfg.codeFolders.removeAll { $0 == path }
        folderInfo = ""
    }

    // foldery na pliki: jak foldery z kodem, ale bez wymogu .git
    @MainActor private func addFileFolders() {
        let p = NSOpenPanel()
        p.canChooseFiles = false
        p.canChooseDirectories = true
        p.allowsMultipleSelection = true
        p.canCreateDirectories = true
        p.prompt = "Dodaj"
        p.message = "Wskaż folder, w którym Claude może zapisywać nowe pliki (np. robocze/dev-ready)."
        guard p.runModal() == .OK else { return }
        var list = store.cfg.fileFolders
        var refused: [String] = []
        for u in p.urls {
            let path = Store.normalizedFolder(u)
            if let why = Store.folderProblem(path) { refused.append("\((path as NSString).lastPathComponent): \(why)"); continue }
            if !list.contains(path) { list.append(path) }
        }
        if list != store.cfg.fileFolders { store.cfg.fileFolders = list }
        fileFolderInfo = refused.isEmpty ? "" : "Nie dodałem: " + refused.joined(separator: "; ")
        if !refused.isEmpty { Log.write("foldery na pliki: odrzucone \(refused.joined(separator: "; "))") }
    }

    @MainActor private func removeFileFolder(_ path: String) {
        store.cfg.fileFolders.removeAll { $0 == path }
        fileFolderInfo = ""
    }

    @MainActor private func setLogin(_ on: Bool) {
        guard #available(macOS 13.0, *) else { return }
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = ""
        } catch {
            loginError = error.localizedDescription
            loginItem = SettingsView.loginEnabled()
        }
    }
}
