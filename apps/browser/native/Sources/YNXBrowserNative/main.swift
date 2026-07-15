import AppKit
import WebKit

struct TabRecord: Codable { let id: UUID; var url: String; var title: String; let isPrivate: Bool; var crashed: Bool }
struct VisitRecord: Codable { let url: String; let title: String; let visitedAt: Date }

@MainActor final class BrowserController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSTextFieldDelegate {
    private var window: NSWindow!
    private var address = NSTextField()
    private var tabPicker = NSPopUpButton()
    private var security = NSTextField(labelWithString: "Security details unavailable")
    private var webViews: [UUID: WKWebView] = [:]
    private var tabs: [TabRecord] = []
    private var activeID: UUID?
    private let defaults = UserDefaults.standard
    private let phishingOrigins = Set(ProcessInfo.processInfo.environment["YNX_BROWSER_BLOCKED_ORIGINS"]?.split(separator: ",").map(String.init) ?? [])

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "YNX Browser · WebKit"
        window.backgroundColor = .white
        window.center()
        buildChrome()
        restoreTabs()
        if tabs.isEmpty { openTab(url: URL(string: "https://example.com")!, isPrivate: false) } else { activate(tabs.last!.id) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildChrome() {
        let root = NSView(); root.translatesAutoresizingMaskIntoConstraints = false; window.contentView = root
        let back = button("←", #selector(goBack), "Go back")
        let forward = button("→", #selector(goForward), "Go forward")
        let reload = button("↻", #selector(reload), "Reload")
        let newTab = button("＋", #selector(newTabAction), "New tab")
        let privateTab = button("◐", #selector(privateTabAction), "New private tab")
        let bookmark = button("☆", #selector(bookmarkAction), "Bookmark page")
        address.placeholderString = "Search authorized sources or enter an address"; address.delegate = self; address.setAccessibilityLabel("Address or search query")
        tabPicker.target = self; tabPicker.action = #selector(selectTab); tabPicker.setAccessibilityLabel("Open tabs")
        security.font = .systemFont(ofSize: 11); security.textColor = .secondaryLabelColor; security.lineBreakMode = .byTruncatingTail
        let bar = NSStackView(views: [back, forward, reload, tabPicker, address, bookmark, newTab, privateTab]); bar.orientation = .horizontal; bar.spacing = 8; bar.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(bar); root.addSubview(security); security.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([bar.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 16),bar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -16),bar.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),address.widthAnchor.constraint(greaterThanOrEqualToConstant: 420),security.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18),security.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18),security.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 7)])
    }

    private func button(_ title: String, _ action: Selector, _ label: String) -> NSButton { let value = NSButton(title: title, target: self, action: action); value.bezelStyle = .rounded; value.contentTintColor = NSColor(srgbRed: 0, green: 47.0 / 255.0, blue: 167.0 / 255.0, alpha: 1); value.setAccessibilityLabel(label); return value }

    private func openTab(url: URL, isPrivate: Bool) {
        let id = UUID(); let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = isPrivate ? .nonPersistent() : .default(); configuration.preferences.isElementFullscreenEnabled = true
        let view = WKWebView(frame: .zero, configuration: configuration); view.navigationDelegate = self; view.uiDelegate = self; view.allowsBackForwardNavigationGestures = true; view.translatesAutoresizingMaskIntoConstraints = false
        webViews[id] = view; tabs.append(TabRecord(id: id, url: url.absoluteString, title: isPrivate ? "Private tab" : "New tab", isPrivate: isPrivate, crashed: false)); persistTabs(); activate(id); view.load(URLRequest(url: url))
    }

    private func activate(_ id: UUID) {
        guard let root = window.contentView, let view = webViews[id] else { return }
        for current in webViews.values { current.removeFromSuperview() }
        root.addSubview(view); NSLayoutConstraint.activate([view.leadingAnchor.constraint(equalTo: root.leadingAnchor),view.trailingAnchor.constraint(equalTo: root.trailingAnchor),view.topAnchor.constraint(equalTo: security.bottomAnchor, constant: 8),view.bottomAnchor.constraint(equalTo: root.bottomAnchor)])
        activeID = id; refreshChrome()
    }

    private func refreshChrome() { guard let id = activeID, let tab = tabs.first(where: { $0.id == id }) else { return }; address.stringValue = tab.url; tabPicker.removeAllItems(); for item in tabs { tabPicker.addItem(withTitle: "\(item.isPrivate ? "Private · " : "")\(item.crashed ? "Crashed · " : "")\(item.title)") }; tabPicker.selectItem(at: tabs.firstIndex(where: { $0.id == id }) ?? 0) }
    private func persistTabs() { let persistent = tabs.filter { !$0.isPrivate }; if let data = try? JSONEncoder().encode(persistent) { defaults.set(data, forKey: "tabs") } }
    private func restoreTabs() { guard let data = defaults.data(forKey: "tabs"), let restored = try? JSONDecoder().decode([TabRecord].self, from: data) else { return }; for tab in restored { let config = WKWebViewConfiguration(); config.websiteDataStore = .default(); let view = WKWebView(frame: .zero, configuration: config); view.navigationDelegate = self; view.uiDelegate = self; view.translatesAutoresizingMaskIntoConstraints = false; webViews[tab.id] = view; tabs.append(tab); if let url = URL(string: tab.url) { view.load(URLRequest(url: url)) } } }
    private func activeWebView() -> WKWebView? { guard let id = activeID else { return nil }; return webViews[id] }
    private func index(for view: WKWebView) -> Int? { guard let id = webViews.first(where: { $0.value === view })?.key else { return nil }; return tabs.firstIndex(where: { $0.id == id }) }
    private func navigate(_ input: String) { let value = input.trimmingCharacters(in: .whitespacesAndNewlines); let target: URL? = value.contains(" ") || !value.contains(".") ? URL(string: "http://127.0.0.1:4313/?q=\(value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") : URL(string: value.contains("://") ? value : "https://\(value)"); if let target { activeWebView()?.load(URLRequest(url: target)) } }

    func controlTextDidEndEditing(_ obj: Notification) { if let field = obj.object as? NSTextField, field === address { navigate(field.stringValue) } }
    @objc private func goBack() { activeWebView()?.goBack() }; @objc private func goForward() { activeWebView()?.goForward() }; @objc private func reload() { activeWebView()?.reload() }
    @objc private func newTabAction() { openTab(url: URL(string: "http://127.0.0.1:4313")!, isPrivate: false) }; @objc private func privateTabAction() { openTab(url: URL(string: "http://127.0.0.1:4313")!, isPrivate: true) }
    @objc private func selectTab() { let index = tabPicker.indexOfSelectedItem; if tabs.indices.contains(index) { activate(tabs[index].id) } }
    @objc private func bookmarkAction() { guard let tab = activeID.flatMap({ id in tabs.first(where: { $0.id == id }) }) else { return }; var values = defaults.array(forKey: "bookmarks") as? [[String:String]] ?? []; values.append(["url":tab.url,"title":tab.title]); defaults.set(values, forKey: "bookmarks") }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "ynx-wallet" { decisionHandler(.cancel); showBoundary(title: "Wallet authorization request", message: "Review requester, callback, scopes, account, expiry, chain ynx_6423-1 and exact transaction in YNX Wallet. This browser never signs."); return }
        if phishingOrigins.contains("\(url.scheme ?? "")://\(url.host ?? "")") { decisionHandler(.cancel); showBoundary(title: "Known-list warning", message: "This origin matches the configured operator blocklist. Navigation stopped. This does not guarantee protection from other phishing sites."); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { guard let i = index(for: webView) else { return }; tabs[i].url = webView.url?.absoluteString ?? tabs[i].url; tabs[i].title = webView.title ?? webView.url?.host ?? "Untitled"; tabs[i].crashed = false; if !tabs[i].isPrivate { var visits = (try? JSONDecoder().decode([VisitRecord].self, from: defaults.data(forKey: "history") ?? Data())) ?? []; visits.insert(VisitRecord(url: tabs[i].url,title: tabs[i].title,visitedAt:Date()),at:0); if let data=try? JSONEncoder().encode(Array(visits.prefix(5000))){defaults.set(data,forKey:"history")} }; persistTabs(); refreshChrome(); security.stringValue = webView.url?.scheme == "https" ? "HTTPS transport · certificate validated by WebKit; inspect system trust details before sensitive actions" : "Not HTTPS · connection is not encrypted" }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if let i=index(for:webView){tabs[i].crashed=true;persistTabs();refreshChrome()};webView.reload() }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { let trust=challenge.protectionSpace.serverTrust; security.stringValue = trust == nil ? "Certificate trust unavailable" : "TLS certificate received for \(challenge.protectionSpace.host) · system trust evaluation applies"; completionHandler(.performDefaultHandling,nil) }
    private func showBoundary(title: String, message: String) { let alert=NSAlert();alert.messageText=title;alert.informativeText=message;alert.alertStyle = .warning;alert.addButton(withTitle:"Close");alert.runModal() }
    func applicationWillTerminate(_ notification: Notification) { tabs.removeAll(where: { $0.isPrivate }); persistTabs() }
}

let app = NSApplication.shared
let delegate = BrowserController()
app.delegate = delegate
app.run()
