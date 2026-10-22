// Szybki pasek (tylko aplikacja na Maca): skrót z Ustawień (domyślnie ⌥Spacja) otwiera z każdego miejsca pole jak dok w Task Hub:
// spinacz, tekst rosnący do 168 pt, historia i okrągły przycisk wysyłania. Wysyłka idzie tą samą drogą co główne pole na kanwie
// (POST /api/bridge/task → src/lib/intake.ts). Pasek pokazuje się na ekranie z kursorem i na bieżącym biurku, nad wszystkim;
// klik obok, Esc albo zmiana biurka go chowa, a wpisany tekst i załączniki czekają do następnego otwarcia.
import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

struct QuickFile: Identifiable {
    let id = UUID()
    var name: String
    var mime: String
    var data: Data
    var preview: NSImage?
}

// wpis historii: 10 ostatnich wysłanych; sent == nil = w trakcie wysyłki
struct QuickSent: Codable, Identifiable, Equatable {
    var id = UUID().uuidString
    var text: String
    var files: [String] = []
    var started: Date
    var sent: Date? = nil
    var taskId: String? = nil
    var shown: String {
        if !text.isEmpty { return text }
        return files.count == 1 ? "Załącznik: \(files[0])" : "Załączniki: \(files.joined(separator: ", "))"
    }
}

private struct QuickState: Codable {
    var draft = ""
    var history: [QuickSent] = []
}

@MainActor
final class QuickBarModel: ObservableObject {
    static let width: CGFloat = 680
    static let maxText: CGFloat = 168          // jak dok: textarea max-height 168px
    static let minText: CGFloat = 34
    static let maxFile = 4 * 1024 * 1024        // jak dok: każdy plik do 4 MB
    static let maxTotal = 4_300_000             // całe żądanie na Vercelu do 4,5 MB
    static let maxFiles = 8
    static let keep = 10
    static let file = Store.dir.appendingPathComponent("quickbar.json")

    @Published var text = ""
    @Published var files: [QuickFile] = []
    @Published var history: [QuickSent] = []    // od najstarszej do najnowszej (najnowsza tuż nad paskiem)
    @Published var showHistory = false
    @Published var error = ""
    @Published var textHeight: CGFloat = QuickBarModel.minText
    @Published var histContent: CGFloat = 0
    @Published var maxHist: CGFloat = 420

    let bridge: Bridge
    let store: Store
    var close: () -> Void = {}
    var pickFiles: () -> Void = {}
    var openTask: (String?) -> Void = { _ in }
    var focus: () -> Void = {}
    private var errorTimer: Task<Void, Never>? = nil

    init(bridge: Bridge, store: Store) {
        self.bridge = bridge
        self.store = store
        if let d = try? Data(contentsOf: QuickBarModel.file), let s = try? JSONDecoder().decode(QuickState.self, from: d) {
            text = s.draft
            // wysyłka przerwana zamknięciem aplikacji: nie wiadomo, czy doszła, więc tekst wraca do paska zamiast zniknąć
            let lost = s.history.filter { $0.sent == nil }
            history = s.history.filter { $0.sent != nil }
            for l in lost where !l.text.isEmpty {
                text = text.isEmpty ? l.text : l.text + "\n\n" + text
                Log.write("szybki pasek: wysyłka przerwana zamknięciem aplikacji, tekst wrócił do paska")
            }
        }
    }

    var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !files.isEmpty }

    func save() {
        let enc = JSONEncoder()
        guard let d = try? enc.encode(QuickState(draft: text, history: history)) else { return }
        try? FileManager.default.createDirectory(at: Store.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try? d.write(to: QuickBarModel.file, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: QuickBarModel.file.path)
    }

    func flash(_ msg: String) {
        error = msg
        errorTimer?.cancel()
        errorTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            if !Task.isCancelled, self?.error == msg { self?.error = "" }
        }
    }

    // ---------- wysyłka ----------
    func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !files.isEmpty else { return }
        guard store.configured else { flash("Najpierw połącz aplikację z Task Hub (Ustawienia, ⌘,)."); return }
        let total = files.reduce(0) { $0 + $1.data.count }
        guard total <= QuickBarModel.maxTotal else {
            flash("Załączniki mają razem \(QuickBarModel.mb(total)), a Task Hub przyjmie najwyżej 4 MB naraz. Usuń któryś.")
            return
        }
        let item = QuickSent(text: t, files: files.map { $0.name }, started: Date())
        let sending = files
        history.append(item)
        if history.count > QuickBarModel.keep { history.removeFirst(history.count - QuickBarModel.keep) }
        text = ""
        files = []
        error = ""
        save()
        close()
        Task { [weak self] in
            guard let self = self else { return }
            do {
                let r = try await self.bridge.quickSend(t, files: sending)
                if let i = self.history.firstIndex(where: { $0.id == item.id }) {
                    self.history[i].sent = Date()
                    self.history[i].taskId = r.id
                }
                self.bridge.poke()
                Log.write("szybki pasek: wysłano \(t.prefix(80))\(sending.isEmpty ? "" : " (+\(sending.count) plik.)")")
            } catch {
                // nic nie ginie: tekst i pliki wracają do paska, a powiadomienie mówi dlaczego
                self.history.removeAll { $0.id == item.id }
                self.text = self.text.isEmpty ? t : t + "\n\n" + self.text
                self.files = sending + self.files
                self.flash("Nie wysłałem: \(error.localizedDescription)")
                Notifier.shared.notice("Wiadomość z paska nie poszła", "\(error.localizedDescription). Tekst czeka w pasku, spróbuj jeszcze raz.")
                Log.write("szybki pasek: nie wysłano (\(error.localizedDescription))")
            }
            self.save()
        }
    }

    // ---------- załączniki: spinacz, ⌘V, przeciągnięcie ----------
    func addFiles(_ urls: [URL]) {
        for u in urls {
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue { flash("„\(u.lastPathComponent)” to folder; dodaj pliki z jego środka."); continue }
            guard let d = try? Data(contentsOf: u) else { flash("Nie mogę odczytać „\(u.lastPathComponent)”."); continue }
            let mime = UTType(filenameExtension: u.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            add(name: u.lastPathComponent, mime: mime, data: d)
        }
    }

    // wklejona grafika bez pliku (zrzut ekranu do schowka, obrazek z przeglądarki)
    func addImage(_ raw: Data) {
        let png = NSBitmapImageRep(data: raw)?.representation(using: .png, properties: [:]) ?? raw
        let f = DateFormatter()
        f.dateFormat = "HH.mm.ss"
        f.timeZone = TimeZone(identifier: "Europe/Warsaw")
        add(name: "Wklejony obraz \(f.string(from: Date())).png", mime: "image/png", data: png)
    }

    private func add(name: String, mime: String, data: Data) {
        guard files.count < QuickBarModel.maxFiles else { flash("Najwyżej \(QuickBarModel.maxFiles) załączników naraz."); return }
        let s = QuickBarModel.shrink(name: name, mime: mime, data: data)
        guard s.data.count <= QuickBarModel.maxFile else { flash("„\(name)” jest za duży (maks. 4 MB)."); return }
        let preview = s.mime.hasPrefix("image/") ? QuickBarModel.thumb(s.data) : nil
        files.append(QuickFile(name: s.name, mime: s.mime, data: s.data, preview: preview))
    }

    func remove(_ id: UUID) { files.removeAll { $0.id == id } }

    // jak w doku: duże grafiki zmniejszamy do 1800 px (JPEG), mieszczą się w limicie i są tańsze dla agenta
    static func shrink(name: String, mime: String, data: Data) -> (name: String, mime: String, data: Data) {
        let kinds: Set<String> = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/tiff", "image/heic"]
        guard kinds.contains(mime), data.count >= 700_000,
              let src = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 1800,
              ] as CFDictionary),
              let jpg = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.88]),
              jpg.count < data.count else { return (name, mime, data) }
        let base = (name as NSString).deletingPathExtension
        return ((base.isEmpty ? name : base) + ".jpg", "image/jpeg", jpg)
    }

    static func thumb(_ data: Data) -> NSImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 64] as CFDictionary)
        else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }

    static func mb(_ n: Int) -> String { String(format: "%.1f MB", Double(n) / 1_048_576).replacingOccurrences(of: ".", with: ",") }

    static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "Europe/Warsaw")
        return f
    }()
}

// ---------- pole tekstu: NSTextView, bo ⌘V z plikami i grafikami, przeciąganie i Enter = wyślij ----------
final class BarTextView: NSTextView {
    var onFiles: ([URL]) -> Void = { _ in }
    var onImage: (Data) -> Void = { _ in }

    private static func fileURLs(_ pb: NSPasteboard) -> [URL] {
        (pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }

    // jak dok: pliki ze schowka idą jako załączniki; grafika też, a tekst obok niej wkleja się normalnie
    override func paste(_ sender: Any?) {
        let pb = NSPasteboard.general
        let urls = BarTextView.fileURLs(pb)
        if !urls.isEmpty { onFiles(urls); return }
        if let img = pb.data(forType: .png) ?? pb.data(forType: .tiff) {
            onImage(img)
            if pb.string(forType: .string) != nil { pasteAsPlainText(sender) }
            return
        }
        pasteAsPlainText(sender)
    }

    // panel nie aktywuje aplikacji, więc skróty edycji obsługujemy tu, a nie przez menu Edycja
    override func performKeyEquivalent(with e: NSEvent) -> Bool {
        guard e.type == .keyDown, window?.firstResponder === self else { return super.performKeyEquivalent(with: e) }
        let m = e.modifierFlags.intersection([.command, .shift, .option, .control])
        switch (m, e.charactersIgnoringModifiers?.lowercased() ?? "") {
        case ([.command], "v"): paste(nil); return true
        case ([.command], "c"): copy(nil); return true
        case ([.command], "x"): cut(nil); return true
        case ([.command], "a"): selectAll(nil); return true
        case ([.command], "z"): undoManager?.undo(); return true
        case ([.command, .shift], "z"): undoManager?.redo(); return true
        default: return super.performKeyEquivalent(with: e)
        }
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = BarTextView.fileURLs(sender.draggingPasteboard)
        if !urls.isEmpty { onFiles(urls); return true }
        return super.performDragOperation(sender)
    }
}

struct BarTextField: NSViewRepresentable {
    @ObservedObject var m: QuickBarModel

    final class Coordinator: NSObject, NSTextViewDelegate {
        let m: QuickBarModel
        weak var tv: BarTextView?
        init(_ m: QuickBarModel) { self.m = m }

        @MainActor func measure() {
            guard let tv = tv, let lm = tv.layoutManager, let tc = tv.textContainer, tc.size.width > 1 else { return }
            lm.ensureLayout(for: tc)
            let h = ceil(lm.usedRect(for: tc).height + tv.textContainerInset.height * 2)
            let c = min(QuickBarModel.maxText, max(QuickBarModel.minText, h))
            if m.textHeight != c { m.textHeight = c }
        }

        @MainActor func textDidChange(_ notification: Notification) {
            guard let tv = tv else { return }
            if m.text != tv.string { m.text = tv.string }
            measure()
        }

        // Enter wysyła, ⇧Enter (i ⌥Enter) to nowa linia, Esc chowa pasek
        @MainActor func textView(_ textView: NSTextView, doCommandBy sel: Selector) -> Bool {
            if sel == #selector(NSResponder.insertNewline(_:)) {
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true { textView.insertNewlineIgnoringFieldEditor(nil); return true }
                m.send()
                return true
            }
            if sel == #selector(NSResponder.cancelOperation(_:)) { m.close(); return true }
            return false
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(m) }

    func makeNSView(context: Context) -> NSScrollView {
        let tv = BarTextView(frame: NSRect(x: 0, y: 0, width: 400, height: QuickBarModel.minText))
        tv.isRichText = false
        tv.importsGraphics = false
        tv.allowsUndo = true
        tv.drawsBackground = false
        tv.font = .systemFont(ofSize: 14)
        tv.textColor = Theme.textNS
        tv.insertionPointColor = Theme.accentNS
        tv.textContainerInset = NSSize(width: 0, height: 7)
        tv.textContainer?.lineFragmentPadding = 0
        tv.textContainer?.widthTracksTextView = true
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.minSize = NSSize(width: 0, height: 0)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = 20
        p.maximumLineHeight = 20
        tv.defaultParagraphStyle = p
        tv.typingAttributes = [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: Theme.textNS, .paragraphStyle: p]
        tv.string = m.text
        tv.delegate = context.coordinator
        let model = m
        tv.onFiles = { urls in Task { @MainActor in model.addFiles(urls) } }
        tv.onImage = { d in Task { @MainActor in model.addImage(d) } }
        context.coordinator.tv = tv
        m.focus = { [weak tv] in
            guard let tv = tv else { return }
            tv.window?.makeFirstResponder(tv)
            tv.setSelectedRange(NSRange(location: (tv.string as NSString).length, length: 0))
        }

        let sv = NSScrollView()
        sv.documentView = tv
        sv.drawsBackground = false
        sv.borderType = .noBorder
        sv.hasVerticalScroller = true
        sv.autohidesScrollers = true
        sv.scrollerStyle = .overlay
        tv.postsFrameChangedNotifications = true
        let coord = context.coordinator
        NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: sv.contentView, queue: .main) { _ in
            Task { @MainActor in coord.measure() }
        }
        sv.contentView.postsFrameChangedNotifications = true
        DispatchQueue.main.async { coord.measure() }
        return sv
    }

    func updateNSView(_ sv: NSScrollView, context: Context) {
        guard let tv = context.coordinator.tv, tv.string != m.text else { return }
        tv.string = m.text   // wyczyszczony po wysłaniu albo przywrócony po błędzie
        let coord = context.coordinator
        DispatchQueue.main.async { coord.measure() }
    }
}

// ---------- wygląd ----------
// szkło jak .glass w aplikacji webowej: rozmycie pod spodem, półprzezroczysta warstwa, cienka krawędź
struct VisualEffect: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .popover
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) {}
}

struct Glass: View {
    var radius: CGFloat
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack { VisualEffect(); Theme.glass }
            .clipShape(shape)
            .overlay(shape.stroke(Theme.line, lineWidth: 1))
    }
}

// .icobtn: okrągły, szary, podświetlenie przy najechaniu; on = otwarta historia
struct BarIconButton: View {
    let symbol: String
    var on = false
    let help: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(on ? Theme.accent : hover ? Theme.text : Theme.sub)
                .frame(width: 32, height: 32)
                .background(Circle().fill(on || hover ? Theme.accentSoft : Color.clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

// .send: okrągły, gradient akcentu, strzałka w górę
struct BarSendButton: View {
    let enabled: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.up")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 34, height: 34)
                .background(Circle().fill(LinearGradient(colors: [Theme.accent2, Theme.accent], startPoint: .top, endPoint: .bottom)))
                .shadow(color: Theme.accent.opacity(0.35), radius: 6, x: 0, y: 3)
                .opacity(enabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help("Wyślij (Enter)")
        .accessibilityLabel("Wyślij")
    }
}

struct BarChip: View {
    let f: QuickFile
    let remove: () -> Void
    var body: some View {
        HStack(spacing: 6) {
            if let img = f.preview {
                Image(nsImage: img).resizable().scaledToFill().frame(width: 22, height: 22).clipShape(Circle())
            } else {
                let ext = (f.name as NSString).pathExtension
                Text(ext.isEmpty ? "PLIK" : String(ext.prefix(4)).uppercased())
                    .font(.system(size: 9.5, weight: .bold)).foregroundColor(Theme.sub)
                    .frame(width: 22, height: 22).background(Circle().fill(Theme.surface))
            }
            Text(f.name).font(.system(size: 12)).foregroundColor(Theme.text).lineLimit(1).truncationMode(.middle).frame(maxWidth: 200, alignment: .leading)
            Button(action: remove) {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(Theme.sub).frame(width: 18, height: 18).contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Usuń \(f.name)")
        }
        .padding(.leading, 4)
        .padding(.trailing, 4)
        .frame(height: 28)
        .background(Capsule().fill(Theme.accentSoft))
        .help(f.name)
    }
}

private struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct HistoryRow: View {
    let item: QuickSent
    let open: () -> Void
    @State private var hover = false
    var body: some View {
        let done = item.sent != nil
        let color = done ? Theme.ok : Theme.warn
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        VStack(alignment: .trailing, spacing: 3) {
            Text(item.shown)
                .font(.system(size: 13))
                .foregroundColor(Theme.text)
                .lineLimit(4)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(shape.fill(Theme.surface))
                .overlay(shape.stroke(color, lineWidth: hover && done ? 2.5 : 1.5))
            Text(QuickBarModel.clock.string(from: item.sent ?? item.started))
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(color)
                .padding(.trailing, 6)
        }
        .contentShape(Rectangle())
        .onTapGesture { if done { open() } }
        .onHover { h in
            hover = h
            if done { if h { NSCursor.pointingHand.push() } else { NSCursor.pop() } }
        }
        .help(done ? "Wysłane \(QuickBarModel.clock.string(from: item.sent!)). Kliknij, żeby otworzyć zadanie w Task Hub." : "Wysyłam od \(QuickBarModel.clock.string(from: item.started))…")
    }
}

struct HistoryPanel: View {
    @ObservedObject var m: QuickBarModel
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(spacing: 10) {
                    if m.history.isEmpty {
                        Text("Tu zobaczysz 10 ostatnich wiadomości wysłanych z paska.")
                            .font(.system(size: 12)).foregroundColor(Theme.sub)
                            .frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    ForEach(m.history) { it in
                        HistoryRow(item: it) { m.openTask(it.taskId) }.id(it.id)
                    }
                }
                .padding(10)
                .background(GeometryReader { g in Color.clear.preference(key: HeightKey.self, value: g.size.height) })
            }
            .frame(height: min(max(m.histContent, 40), m.maxHist))
            .onPreferenceChange(HeightKey.self) { h in if abs(m.histContent - h) > 0.5 { m.histContent = h } }
            .onAppear { if let last = m.history.last?.id { proxy.scrollTo(last, anchor: .bottom) } }
            .onChange(of: m.history.count) { _ in if let last = m.history.last?.id { proxy.scrollTo(last, anchor: .bottom) } }
        }
        .background(Glass(radius: 20))
    }
}

struct QuickBarView: View {
    @ObservedObject var m: QuickBarModel

    var body: some View {
        VStack(spacing: 8) {
            if m.showHistory { HistoryPanel(m: m) }
            bar
        }
        .frame(width: QuickBarModel.width)
    }

    private var bar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !m.files.isEmpty {
                // chipy w jednym rzędzie (bez zawijania), przewijane w bok
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) { ForEach(m.files) { f in BarChip(f: f) { m.remove(f.id) } } }
                        .padding(.horizontal, 4)
                }
                .frame(height: 28)
            }
            if !m.error.isEmpty {
                Text(m.error).font(.system(size: 12)).foregroundColor(Theme.danger).lineLimit(2).padding(.horizontal, 8)
            }
            HStack(alignment: .bottom, spacing: 6) {
                BarIconButton(symbol: "paperclip", help: "Dodaj plik lub grafikę (albo wklej ⌘V / przeciągnij tutaj)") { m.pickFiles() }
                    .padding(.bottom, 1)
                ZStack(alignment: .topLeading) {
                    BarTextField(m: m)
                    if m.text.isEmpty {
                        Text("Co masz na głowie? Wklej maila, wiadomość albo opisz zadanie…")
                            .font(.system(size: 14)).foregroundColor(Theme.sub)
                            .lineLimit(1)
                            .padding(.top, 7)
                            .allowsHitTesting(false)
                    }
                }
                .frame(height: m.textHeight)
                BarIconButton(symbol: "clock.arrow.circlepath", on: m.showHistory, help: m.showHistory ? "Zamknij historię" : "Ostatnio wysłane") { m.showHistory.toggle() }
                    .padding(.bottom, 1)
                BarSendButton(enabled: m.canSend) { m.send() }
            }
            .padding(.leading, 4)
        }
        .padding(6)
        .background(Glass(radius: 23))
    }
}

// ---------- okno ----------
// panel bez ramki, który nie aktywuje aplikacji (zostajesz w tym, w czym pracowałeś), ale przyjmuje klawiaturę
final class BarPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class QuickBarController: NSObject, NSWindowDelegate {
    let model: QuickBarModel
    let panel: BarPanel
    private let host: NSHostingView<QuickBarView>
    private var centerX: CGFloat = 0
    private var bottom: CGFloat = 0           // dół paska stoi w miejscu: tekst i historia rosną w górę, jak dok w Task Hub
    private var clickMonitor: Any? = nil
    private var picking = false
    private var hiding = false
    private var activated = false
    private var previousApp: NSRunningApplication? = nil
    private var bag: [NSObjectProtocol] = []
    private var sink: Any? = nil

    var isVisible: Bool { panel.isVisible }

    init(bridge: Bridge, store: Store) {
        model = QuickBarModel(bridge: bridge, store: store)
        panel = BarPanel(contentRect: NSRect(x: 0, y: 0, width: QuickBarModel.width, height: 60), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        host = NSHostingView(rootView: QuickBarView(m: model))
        super.init()
        panel.isFloatingPanel = true
        panel.level = .statusBar                                                    // nad oknami wszystkich aplikacji
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary, .transient, .ignoresCycle]   // bieżące biurko, także nad pełnym ekranem
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.worksWhenModal = true
        if #available(macOS 13.0, *) { host.sizingOptions = [] }
        panel.contentView = host
        panel.delegate = self

        model.close = { [weak self] in self?.hide() }
        model.pickFiles = { [weak self] in self?.pick() }
        sink = model.objectWillChange.sink { [weak self] _ in DispatchQueue.main.async { self?.layout() } }
        // inne biurko albo zmiana monitorów: pasek się chowa, skrót otworzy go na nowo tam, gdzie jesteś
        bag.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in if self?.picking == false { self?.hide() } }
        })
        bag.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.hide() }
        })
    }

    func toggle() { panel.isVisible ? hide() : show() }

    func show() {
        guard !panel.isVisible else { panel.makeKey(); model.focus(); return }
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
        if let f = screen?.visibleFrame {
            centerX = f.midX
            bottom = f.minY + f.height * 0.28
            model.maxHist = max(160, min(560, f.maxY - bottom - QuickBarModel.maxText - 60))
        }
        model.showHistory = false      // po otwarciu sam pasek, bez historii
        model.error = ""
        let front = NSWorkspace.shared.frontmostApplication
        previousApp = front?.processIdentifier == ProcessInfo.processInfo.processIdentifier ? nil : front
        layout(force: true)
        panel.orderFrontRegardless()
        panel.makeKey()
        model.focus()
        startClickMonitor()
    }

    func hide() {
        guard panel.isVisible, !hiding else { return }
        hiding = true
        stopClickMonitor()
        panel.orderOut(nil)
        model.showHistory = false
        model.save()
        // jeśli do wyboru plików trzeba było aktywować Task Hub, wracamy do aplikacji, w której byłeś
        if activated {
            activated = false
            if NSApp.isActive { previousApp?.activate() }
        }
        hiding = false
    }

    private func layout(force: Bool = false) {
        guard force || panel.isVisible else { return }
        let s = host.fittingSize
        let frame = NSRect(x: round(centerX - s.width / 2), y: round(bottom), width: ceil(s.width), height: ceil(s.height))
        guard frame != panel.frame else { return }
        panel.setFrame(frame, display: true)
        panel.invalidateShadow()
    }

    // klik w innej aplikacji albo na biurku; klik w innym oknie Task Hub zabiera panelowi klawiaturę (windowDidResignKey)
    private func startClickMonitor() {
        stopClickMonitor()
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in
            Task { @MainActor in if self?.picking == false { self?.hide() } }
        }
    }

    private func stopClickMonitor() {
        if let m = clickMonitor { NSEvent.removeMonitor(m) }
        clickMonitor = nil
    }

    func windowDidResignKey(_ notification: Notification) {
        if !picking { hide() }
    }

    // spinacz: systemowe okno wyboru plików, nad paskiem
    private func pick() {
        guard !picking else { return }
        picking = true
        let p = NSOpenPanel()
        p.allowsMultipleSelection = true
        p.canChooseFiles = true
        p.canChooseDirectories = false
        p.prompt = "Dodaj"
        p.message = "Wybierz pliki albo grafiki do wiadomości"
        p.level = NSWindow.Level(rawValue: panel.level.rawValue + 1)
        if !NSApp.isActive { activated = true }
        NSApp.activate(ignoringOtherApps: true)
        p.begin { [weak self] r in
            guard let self = self else { return }
            Task { @MainActor in
                self.picking = false
                if r == .OK { self.model.addFiles(p.urls) }
                if self.panel.isVisible {
                    self.panel.makeKeyAndOrderFront(nil)
                    self.model.focus()
                }
            }
        }
    }
}
