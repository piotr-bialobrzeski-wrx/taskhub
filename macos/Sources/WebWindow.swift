// Główne okno: aplikacja webowa Task Hub w WKWebView z trwałym logowaniem. Linki poza Task Hub idą do przeglądarki,
// link taskhub://connect z Ustawień Task Hub łapiemy sami, okienka JS (alert/confirm/plik) dostają natywne panele.
// Na zewnątrz wychodzą tylko http(s), mailto i tel; innych schematów (file:, inne aplikacje) okno nie otwiera.
import AppKit
import WebKit

final class WebWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let webView: WKWebView
    private let store: Store
    var onConnectURL: ((URL) -> Void)? = nil
    private var loadedBase = ""
    private var previews: [NSWindow] = []   // okna podglądu (prototyp z /api/preview), trzymane do zamknięcia

    init(store: Store) {
        self.store = store
        let conf = WKWebViewConfiguration()
        conf.websiteDataStore = WKWebsiteDataStore.default()
        conf.applicationNameForUserAgent = ClaudeCLI.userAgent
        conf.preferences.javaScriptCanOpenWindowsAutomatically = false   // nowe okna tylko po kliknięciu
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 860), configuration: conf)
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "Task Hub"
        w.minSize = NSSize(width: 880, height: 560)
        w.tabbingMode = .disallowed
        w.isReleasedWhenClosed = false
        w.backgroundColor = Theme.bgNS
        w.contentView = webView
        w.center()
        w.setFrameAutosaveName("TaskHubMain")
        super.init(window: w)
        w.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // bez gestu wstecz/dalej: WebKit łapał poziomy ruch dwoma palcami i kanwa przesuwała się tylko w pionie
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = Theme.bgNS }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show() {
        load(force: false)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // ładuje stronę główną, gdy jeszcze nic nie ma albo zmienił się adres
    func load(force: Bool) {
        let base = store.baseURL
        guard !base.isEmpty, let u = URL(string: base + "/") else {
            if webView.url == nil { webView.loadHTMLString(WebWindowController.page(title: "Połącz aplikację z Task Hub", text: "Wpisz adres Task Hub i token mostka w Ustawieniach (⌘,) albo kliknij „Połącz aplikację Task Hub na tym Macu” w Ustawieniach Task Hub w przeglądarce.", retry: false), baseURL: nil) }
            return
        }
        if force || loadedBase != base || webView.url == nil || webView.url?.scheme == "about" {
            loadedBase = base
            webView.load(URLRequest(url: u))
        }
    }

    // konkretna strona Task Hub (np. /tasks/<id> z historii szybkiego paska), zawsze pod adresem z Ustawień
    func open(path: String) {
        guard !store.baseURL.isEmpty, path.hasPrefix("/"), let u = URL(string: store.baseURL + path) else { show(); return }
        loadedBase = store.baseURL
        webView.load(URLRequest(url: u))
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func reload() {
        if webView.url == nil || webView.url?.scheme == "about" { load(force: true) } else { webView.reload() }
    }

    func goBack() { if webView.canGoBack { webView.goBack() } }

    // ---------- nawigacja ----------
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "taskhub" {
            decisionHandler(.cancel)
            // okno dialogowe dopiero po odpowiedzi dla WebKitu
            DispatchQueue.main.async { [weak self] in self?.onConnectURL?(url) }
            return
        }
        if scheme == "mailto" || scheme == "tel" {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }   // tylko po kliknięciu
            return
        }
        let web = scheme == "http" || scheme == "https"
        if navigationAction.navigationType == .linkActivated, web, let host = url.host, let base = URL(string: store.baseURL), host != base.host {
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
            return
        }
        // główna ramka (albo nowe okno) tylko na http(s) i about: (strona zastępcza); reszta zostaje w miejscu
        let main = navigationAction.targetFrame?.isMainFrame ?? true
        if main && !web && scheme != "about" {
            Log.write("okno: zablokowany adres \(scheme):")
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // target=_blank i window.open: strona Task Hub (np. „Otwórz prototyp”) w osobnym oknie aplikacji, bo w przeglądarce Piotr zwykle
    // nie jest zalogowany i podgląd odpowiada „Zaloguj się” (paczka 25); inne http(s) i mailto do przeglądarki/poczty, taskhub do nas
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "http" || scheme == "https", let host = url.host, let base = URL(string: store.baseURL), host == base.host {
            return previewWindow(configuration)
        }
        switch scheme {
        case "taskhub": DispatchQueue.main.async { [weak self] in self?.onConnectURL?(url) }
        case "http", "https", "mailto": NSWorkspace.shared.open(url)
        default: Log.write("okno: nie otwieram nowego okna z \(url.scheme ?? "?"):")
        }
        return nil
    }

    // okno z tą samą sesją (ciasteczka logowania); WebKit sam załaduje w nim adres z kliknięcia
    private func previewWindow(_ configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 860), configuration: configuration)
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "Podgląd · Task Hub"
        w.tabbingMode = .disallowed
        w.isReleasedWhenClosed = false
        w.backgroundColor = Theme.bgNS
        w.contentView = view
        if let main = window { w.setFrame(main.frame.offsetBy(dx: 28, dy: -28), display: false) } else { w.center() }
        previews.append(w)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self, weak w] _ in
            self?.previews.removeAll { $0 === w }
        }
        w.makeKeyAndOrderFront(nil)
        return view
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }

    private func showError(_ e: Error) {
        let ns = e as NSError
        if ns.code == NSURLErrorCancelled { return }
        Log.write("okno: \(ns.localizedDescription)")
        webView.loadHTMLString(WebWindowController.page(title: "Nie mogę otworzyć Task Hub", text: ns.localizedDescription, retry: true), baseURL: nil)
    }

    // strona zastępcza w stylu aplikacji
    static func page(title: String, text: String, retry: Bool) -> String {
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        let button = retry ? "<a class=\"pill\" href=\"taskhub://reload\">Spróbuj ponownie</a>" : "<a class=\"pill\" href=\"taskhub://settings\">Otwórz Ustawienia</a>"
        return """
        <!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Task Hub</title><style>
        :root { --bg:#ECEEF7; --surface:#fff; --text:#20203A; --sub:#6E7090; --accent:#5A5CE6; --accent-2:#6A6CF0; --shadow:rgba(58,60,130,.14); }
        @media (prefers-color-scheme: dark) { :root { --bg:#101018; --surface:#1B1B28; --text:#ECECF5; --sub:#9A9CB8; --accent:#7C7EF5; --accent-2:#8B8DF7; --shadow:rgba(0,0,0,.45); } }
        body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font:13.5px/1.45 -apple-system, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing:antialiased; }
        .card { width:min(420px, 86vw); background:var(--surface); border-radius:16px; padding:22px 24px; box-shadow:0 14px 34px var(--shadow); }
        h1 { font-size:15px; margin:0 0 8px; } p { margin:0 0 14px; color:var(--sub); }
        .pill { display:inline-flex; align-items:center; padding:8px 14px; border-radius:999px; font-weight:600; font-size:12.5px; text-decoration:none; color:#fff; background:linear-gradient(180deg, var(--accent-2), var(--accent)); box-shadow:0 3px 12px rgba(90,92,230,.4); }
        </style></head><body><div class="card"><h1>\(esc(title))</h1><p>\(esc(text))</p>\(button)</div></body></html>
        """
    }

    // ---------- okienka JS ----------
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Anuluj")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Anuluj")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // spinacz w czacie: wybór plików
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = parameters.allowsDirectories
        p.canChooseFiles = true
        p.begin { r in completionHandler(r == .OK ? p.urls : nil) }
    }
}
