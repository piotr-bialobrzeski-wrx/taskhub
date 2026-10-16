// Ustawienia aplikacji (⌘,): połączenie z Task Hub, mostek, Claude Code, start po zalogowaniu, dziennik.
import AppKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: Store
    @ObservedObject var bridge: Bridge
    @State private var connectInfo = ""
    @State private var checking = false
    @State private var claudeInfo = ""
    @State private var loginItem = SettingsView.loginEnabled()
    @State private var loginError = ""

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
            Section("Dziennik") {
                HStack(spacing: 10) {
                    Button("Pokaż dziennik") { NSWorkspace.shared.open(Log.url) }
                    Text(Log.url.path).font(.system(size: 11)).foregroundColor(Theme.sub).lineLimit(1).truncationMode(.middle)
                }
                Text("Task Hub na Maca \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")").font(.system(size: 11)).foregroundColor(Theme.sub)
            }
        }
        .formStyle(.grouped)
        .frame(width: 600)
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
