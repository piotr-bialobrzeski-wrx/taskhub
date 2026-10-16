// Okienko „Nowe zadanie” (⌃⌥T z każdego miejsca, ⌘N w aplikacji): wkleja maila albo opis, ⌘↩ wysyła do Task Hub,
// a mostek od razu rusza z pracą. Wygląd jak dok czatu w aplikacji webowej.
import AppKit
import SwiftUI

@MainActor
final class QuickEntryModel: ObservableObject {
    @Published var text = ""
    @Published var busy = false
    @Published var info = ""
    @Published var error = ""
    let bridge: Bridge
    let store: Store
    var close: (() -> Void)? = nil
    var openSettings: (() -> Void)? = nil

    init(bridge: Bridge, store: Store) { self.bridge = bridge; self.store = store }

    func submit() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !busy else { return }
        guard store.configured else { error = "Najpierw połącz aplikację z Task Hub (Ustawienia)."; return }
        busy = true
        error = ""
        info = ""
        Task { [self] in
            do {
                let msg = try await self.bridge.quickTask(t)
                self.busy = false
                self.text = ""
                self.info = msg
                self.bridge.poke()
                Log.write("nowe zadanie: \(t.prefix(80))")
                do { try await Task.sleep(nanoseconds: 1_600_000_000) } catch {}
                if self.info == msg { self.info = ""; self.close?() }
            } catch {
                self.busy = false
                self.error = error.localizedDescription
            }
        }
    }
}

struct QuickEntryView: View {
    @ObservedObject var m: QuickEntryModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                LogoMark()
                Text("Nowe zadanie").font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.text)
                Spacer()
                Text("⌃⌥T otwiera z każdego miejsca").font(.system(size: 11)).foregroundColor(Theme.sub)
            }
            ZStack(alignment: .topLeading) {
                if m.text.isEmpty {
                    Text("Co masz na głowie? Wklej maila, wiadomość albo opisz zadanie…")
                        .foregroundColor(Theme.sub)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 12)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $m.text)
                    .font(.system(size: 13.5))
                    .foregroundColor(Theme.text)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .focused($focused)
            }
            .frame(minHeight: 130)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
            HStack(spacing: 10) {
                if !m.error.isEmpty {
                    Text(m.error).font(.system(size: 12)).foregroundColor(Theme.danger).lineLimit(2)
                    if !m.store.configured { Button("Ustawienia") { m.openSettings?() }.buttonStyle(PillStyle()) }
                } else if !m.info.isEmpty {
                    Text(m.info).font(.system(size: 12)).foregroundColor(Theme.text).lineLimit(2)
                } else {
                    Text("⌘↩ dodaje zadanie, Claude zaczyna od razu").font(.system(size: 12)).foregroundColor(Theme.sub)
                }
                Spacer()
                Button("Anuluj") { m.close?() }.buttonStyle(PillStyle()).keyboardShortcut(.cancelAction)
                Button(m.busy ? "Dodaję…" : "Dodaj zadanie") { m.submit() }
                    .buttonStyle(PillStyle(primary: true))
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(m.busy || m.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(18)
        .frame(width: 580)
        .background(Theme.bg)
        .onAppear { focused = true }
    }
}

final class QuickEntryController: NSWindowController, NSWindowDelegate {
    let model: QuickEntryModel

    init(bridge: Bridge, store: Store) {
        model = QuickEntryModel(bridge: bridge, store: store)
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 580, height: 240), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "Nowe zadanie"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.backgroundColor = Theme.bgNS
        let host = NSHostingController(rootView: QuickEntryView(m: model))
        host.view.frame = NSRect(x: 0, y: 0, width: 580, height: 250)
        panel.contentViewController = host
        if (panel.contentView?.frame.height ?? 0) < 100 { panel.setContentSize(NSSize(width: 580, height: 250)) }
        super.init(window: panel)
        panel.delegate = self
        model.close = { [weak self] in self?.window?.close() }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show() {
        guard let w = window else { return }
        if !w.isVisible {
            // u góry ekranu z kursorem, jak Spotlight
            let screen = NSScreen.main ?? NSScreen.screens.first
            if let f = screen?.visibleFrame {
                let x = f.midX - w.frame.width / 2
                let y = f.maxY - f.height * 0.22 - w.frame.height
                w.setFrameOrigin(NSPoint(x: x, y: max(f.minY, y)))
            }
        }
        model.error = ""
        model.info = ""
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
