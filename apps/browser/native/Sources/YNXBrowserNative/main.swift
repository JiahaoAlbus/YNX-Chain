import AppKit
import WebKit
import CryptoKit
import Security

struct TabRecord: Codable { let id: UUID; var url: String; var title: String; let isPrivate: Bool; var crashed: Bool; var group: String? }
struct VisitRecord: Codable { let url: String; let title: String; let visitedAt: Date }
struct DownloadRecord: Codable { let filename: String; let source: String; let finishedAt: Date }
struct PermissionRecord: Codable { let origin: String; let permission: String; let decision: String; let decidedAt: Date }

final class TabButton: NSButton { var tabID: UUID? }

@MainActor final class BrowserController: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSTextFieldDelegate {
    private var window: NSWindow!
    private let address = NSTextField()
    private let security = NSTextField(labelWithString: "Start page · authorized Search scope")
    private let tabStrip = NSStackView()
    private let libraryList = NSStackView()
    private let pageHost = NSView()
    private let libraryTitle = NSTextField(labelWithString: "History")
    private let libraryBoundary = NSTextField(wrappingLabelWithString: "History is stored on this Mac. Private tabs never appear here.")
    private var webViews: [UUID: WKWebView] = [:]
    private var tabs: [TabRecord] = []
    private var activeID: UUID?
    private var selectedLibrary = "history"
    private let defaults = UserDefaults.standard
    private let environment = ProcessInfo.processInfo.environment
    private lazy var searchURL = environment["YNX_SEARCH_URL"] ?? "https://search-staging.43.153.202.237.sslip.io"
    private lazy var phishingOrigins = Set(environment["YNX_BROWSER_BLOCKED_ORIGINS"]?.split(separator: ",").map(String.init) ?? [])

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "YNX Browser"
        window.identifier = NSUserInterfaceItemIdentifier("com.ynxweb4.browser.main-window.v3")
        window.isRestorable = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 920, height: 620)
        window.delegate = self
        if environment["YNX_BROWSER_APPEARANCE"] == "dark" { window.appearance = NSAppearance(named: .darkAqua) }
        if environment["YNX_BROWSER_APPEARANCE"] == "light" { window.appearance = NSAppearance(named: .aqua) }
        window.setFrame(NSRect(x: 0, y: 120, width: 1440, height: 900), display: true)
        window.center()
        buildChrome()
        buildMenu()
        window.makeKeyAndOrderFront(nil)
        window.setFrame(NSRect(x: 0, y: 0, width: 1440, height: 900), display: true, animate: false)
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        restoreTabs()
        if tabs.isEmpty { openTab(url: startURL(), isPrivate: false) } else { activate(tabs.last!.id) }
        applyEvidenceState()
    }

    private func startURL() -> URL { URL(string: searchURL) ?? URL(string: "https://example.com")! }

    private func buildMenu() {
        let menu = NSMenu()
        let app = NSMenuItem(); menu.addItem(app)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About YNX Browser", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Clear Browsing Data…", action: #selector(clearData), keyEquivalent: "")
        appMenu.addItem(withTitle: "Check for Signed Updates…", action: #selector(checkUpdates), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit YNX Browser", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.submenu = appMenu
        let file = NSMenuItem(); menu.addItem(file)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "New Tab", action: #selector(newTabAction), keyEquivalent: "t")
        let privateItem = fileMenu.addItem(withTitle: "New Private Tab", action: #selector(privateTabAction), keyEquivalent: "n"); privateItem.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Close Tab", action: #selector(closeTabAction), keyEquivalent: "w")
        file.submenu = fileMenu
        NSApp.mainMenu = menu
    }

    private func buildChrome() {
        let root = NSView(frame: window.contentView?.bounds ?? .zero); root.autoresizingMask = [.width, .height]; root.translatesAutoresizingMaskIntoConstraints = true; window.contentView = root
        let tabBackground = NSVisualEffectView(); tabBackground.material = .headerView; tabBackground.blendingMode = .withinWindow; tabBackground.translatesAutoresizingMaskIntoConstraints = false
        tabStrip.orientation = .horizontal; tabStrip.alignment = .centerY; tabStrip.spacing = 6; tabStrip.translatesAutoresizingMaskIntoConstraints = false
        let tabsScroll = NSScrollView(); tabsScroll.drawsBackground = false; tabsScroll.hasHorizontalScroller = false; tabsScroll.documentView = tabStrip; tabsScroll.translatesAutoresizingMaskIntoConstraints = false
        let addTab = symbolButton("plus", #selector(newTabAction), "New tab")
        let privateTab = symbolButton("eye.slash", #selector(privateTabAction), "New private tab")
        tabBackground.addSubview(tabsScroll); tabBackground.addSubview(addTab); tabBackground.addSubview(privateTab)

        let back = symbolButton("chevron.left", #selector(goBack), "Go back")
        let forward = symbolButton("chevron.right", #selector(goForward), "Go forward")
        let reload = symbolButton("arrow.clockwise", #selector(reload), "Reload")
        let siteInfo = symbolButton("info.circle", #selector(showSecurity), "Site information")
        let bookmark = symbolButton("star", #selector(bookmarkAction), "Bookmark page")
        let ai = button("AI", #selector(aiPageAction), "Use AI with this page")
        let wallet = button("Wallet", #selector(startWalletSignIn), "Sign in with YNX Wallet")
        address.placeholderString = "Search authorized sources or enter an address"
        address.delegate = self
        address.focusRingType = .exterior
        address.setAccessibilityLabel("Address or search query")
        let bar = NSStackView(views: [back, forward, reload, siteInfo, address, bookmark, wallet, ai]); bar.orientation = .horizontal; bar.spacing = 7; bar.translatesAutoresizingMaskIntoConstraints = false
        security.font = .systemFont(ofSize: 11, weight: .medium); security.textColor = .secondaryLabelColor; security.lineBreakMode = .byTruncatingTail; security.translatesAutoresizingMaskIntoConstraints = false

        let split = NSSplitView(); split.isVertical = true; split.dividerStyle = .thin; split.translatesAutoresizingMaskIntoConstraints = false
        let sidebar = buildLibrary(); pageHost.translatesAutoresizingMaskIntoConstraints = false
        split.addArrangedSubview(sidebar); split.addArrangedSubview(pageHost); sidebar.widthAnchor.constraint(equalToConstant: 226).isActive = true

        root.addSubview(tabBackground); root.addSubview(bar); root.addSubview(security); root.addSubview(split)
        NSLayoutConstraint.activate([
            tabBackground.leadingAnchor.constraint(equalTo: root.leadingAnchor), tabBackground.trailingAnchor.constraint(equalTo: root.trailingAnchor), tabBackground.topAnchor.constraint(equalTo: root.topAnchor), tabBackground.heightAnchor.constraint(equalToConstant: 50),
            tabsScroll.leadingAnchor.constraint(equalTo: tabBackground.leadingAnchor, constant: 76), tabsScroll.trailingAnchor.constraint(equalTo: addTab.leadingAnchor, constant: -6), tabsScroll.topAnchor.constraint(equalTo: tabBackground.topAnchor, constant: 9), tabsScroll.bottomAnchor.constraint(equalTo: tabBackground.bottomAnchor, constant: -7),
            addTab.trailingAnchor.constraint(equalTo: privateTab.leadingAnchor, constant: -5), addTab.centerYAnchor.constraint(equalTo: tabsScroll.centerYAnchor), privateTab.trailingAnchor.constraint(equalTo: tabBackground.trailingAnchor, constant: -12), privateTab.centerYAnchor.constraint(equalTo: tabsScroll.centerYAnchor),
            bar.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 12), bar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -12), bar.topAnchor.constraint(equalTo: tabBackground.bottomAnchor, constant: 8), address.widthAnchor.constraint(greaterThanOrEqualToConstant: 420),
            security.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18), security.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18), security.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 6),
            split.leadingAnchor.constraint(equalTo: root.leadingAnchor), split.trailingAnchor.constraint(equalTo: root.trailingAnchor), split.topAnchor.constraint(equalTo: security.bottomAnchor, constant: 7), split.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
    }

    private func buildLibrary() -> NSView {
        let sidebar = NSVisualEffectView(); sidebar.material = .sidebar; sidebar.blendingMode = .withinWindow; sidebar.translatesAutoresizingMaskIntoConstraints = false
        let product = NSTextField(labelWithString: "YNX BROWSER"); product.font = .systemFont(ofSize: 11, weight: .bold); product.textColor = accent(); product.translatesAutoresizingMaskIntoConstraints = false
        let history = libraryButton("History", "clock", #selector(showHistory))
        let bookmarks = libraryButton("Bookmarks", "star", #selector(showBookmarks))
        let downloads = libraryButton("Downloads", "arrow.down.circle", #selector(showDownloads))
        let permissions = libraryButton("Site permissions", "lock.shield", #selector(showPermissions))
        let navigation = NSStackView(views: [history, bookmarks, downloads, permissions]); navigation.orientation = .vertical; navigation.alignment = .leading; navigation.spacing = 4; navigation.translatesAutoresizingMaskIntoConstraints = false
        libraryTitle.font = .systemFont(ofSize: 13, weight: .semibold); libraryTitle.translatesAutoresizingMaskIntoConstraints = false
        libraryBoundary.font = .systemFont(ofSize: 11); libraryBoundary.textColor = .secondaryLabelColor; libraryBoundary.translatesAutoresizingMaskIntoConstraints = false
        libraryList.orientation = .vertical; libraryList.alignment = .leading; libraryList.spacing = 8; libraryList.translatesAutoresizingMaskIntoConstraints = false
        let listScroll = NSScrollView(); listScroll.drawsBackground = false; listScroll.hasVerticalScroller = true; listScroll.documentView = libraryList; listScroll.translatesAutoresizingMaskIntoConstraints = false
        sidebar.addSubview(product); sidebar.addSubview(navigation); sidebar.addSubview(libraryTitle); sidebar.addSubview(libraryBoundary); sidebar.addSubview(listScroll)
        NSLayoutConstraint.activate([
            product.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 18), product.topAnchor.constraint(equalTo: sidebar.topAnchor, constant: 20),
            navigation.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 10), navigation.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -10), navigation.topAnchor.constraint(equalTo: product.bottomAnchor, constant: 16),
            libraryTitle.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 18), libraryTitle.topAnchor.constraint(equalTo: navigation.bottomAnchor, constant: 24),
            libraryBoundary.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 18), libraryBoundary.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -14), libraryBoundary.topAnchor.constraint(equalTo: libraryTitle.bottomAnchor, constant: 6),
            listScroll.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 14), listScroll.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -8), listScroll.topAnchor.constraint(equalTo: libraryBoundary.bottomAnchor, constant: 12), listScroll.bottomAnchor.constraint(equalTo: sidebar.bottomAnchor, constant: -12),
            libraryList.widthAnchor.constraint(equalTo: listScroll.contentView.widthAnchor, constant: -8)
        ])
        refreshLibrary()
        return sidebar
    }

    private func button(_ title: String, _ action: Selector, _ label: String) -> NSButton { let value = NSButton(title: title, target: self, action: action); value.bezelStyle = .rounded; value.controlSize = .large; value.contentTintColor = accent(); value.setAccessibilityLabel(label); return value }
    private func symbolButton(_ symbol: String, _ action: Selector, _ label: String) -> NSButton { let value = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: label) ?? NSImage(), target: self, action: action); value.bezelStyle = .rounded; value.controlSize = .large; value.contentTintColor = accent(); value.setAccessibilityLabel(label); return value }
    private func accent() -> NSColor { NSColor(srgbRed: 0, green: 60.0 / 255.0, blue: 1, alpha: 1) }
    private func libraryButton(_ title: String, _ symbol: String, _ action: Selector) -> NSButton { let value = NSButton(title: title, image: NSImage(systemSymbolName: symbol, accessibilityDescription: title) ?? NSImage(), target: self, action: action); value.bezelStyle = .recessed; value.imagePosition = .imageLeading; value.alignment = .left; value.font = .systemFont(ofSize: 13, weight: .medium); return value }

    private func openTab(url: URL, isPrivate: Bool) {
        let id = UUID(); let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = isPrivate ? .nonPersistent() : .default(); configuration.preferences.isElementFullscreenEnabled = true
        let view = WKWebView(frame: .zero, configuration: configuration); view.navigationDelegate = self; view.uiDelegate = self; view.allowsBackForwardNavigationGestures = true; view.translatesAutoresizingMaskIntoConstraints = false
        webViews[id] = view; tabs.append(TabRecord(id: id, url: url.absoluteString, title: isPrivate ? "Private tab" : "Start page", isPrivate: isPrivate, crashed: false, group: isPrivate ? "PRIVATE" : "YNX")); persistTabs(); activate(id); view.load(URLRequest(url: url))
    }

    private func activate(_ id: UUID) {
        guard let view = webViews[id] else { return }
        for current in webViews.values { current.removeFromSuperview() }
        pageHost.addSubview(view); NSLayoutConstraint.activate([view.leadingAnchor.constraint(equalTo: pageHost.leadingAnchor), view.trailingAnchor.constraint(equalTo: pageHost.trailingAnchor), view.topAnchor.constraint(equalTo: pageHost.topAnchor), view.bottomAnchor.constraint(equalTo: pageHost.bottomAnchor)])
        activeID = id; refreshChrome()
    }

    private func refreshChrome() {
        guard let id = activeID, let tab = tabs.first(where: { $0.id == id }) else { return }
        address.stringValue = tab.url
        for view in tabStrip.arrangedSubviews { tabStrip.removeArrangedSubview(view); view.removeFromSuperview() }
        for item in tabs {
            let prefix = item.isPrivate ? "Private · " : item.crashed ? "Crashed · " : ""
            let group = item.group.map { "\($0) · " } ?? ""
            let title = String(item.title.prefix(26))
            let value = TabButton(title: "\(prefix)\(group)\(title)", target: self, action: #selector(selectTab(_:)))
            value.tabID = item.id; value.bezelStyle = item.id == id ? .texturedRounded : .recessed; value.controlSize = .small; value.setAccessibilityLabel("\(item.isPrivate ? "Private " : "")tab \(title)")
            tabStrip.addArrangedSubview(value)
        }
    }
    private func persistTabs() { let persistent = tabs.filter { !$0.isPrivate }; if let data = try? JSONEncoder().encode(persistent) { defaults.set(data, forKey: "tabs") } }
    private func restoreTabs() { guard let data = defaults.data(forKey: "tabs"), let restored = try? JSONDecoder().decode([TabRecord].self, from: data) else { return }; for tab in restored { let config = WKWebViewConfiguration(); config.websiteDataStore = .default(); let view = WKWebView(frame: .zero, configuration: config); view.navigationDelegate = self; view.uiDelegate = self; view.translatesAutoresizingMaskIntoConstraints = false; webViews[tab.id] = view; tabs.append(tab); if let url = URL(string: tab.url) { view.load(URLRequest(url: url)) } } }
    private func activeWebView() -> WKWebView? { guard let id = activeID else { return nil }; return webViews[id] }
    private func index(for view: WKWebView) -> Int? { guard let id = webViews.first(where: { $0.value === view })?.key else { return nil }; return tabs.firstIndex(where: { $0.id == id }) }
    private func navigate(_ input: String) { let value = input.trimmingCharacters(in: .whitespacesAndNewlines); let target: URL? = value.contains(" ") || !value.contains(".") ? URL(string: "\(searchURL)/?q=\(value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") : URL(string: value.contains("://") ? value : "https://\(value)"); if let target { activeWebView()?.load(URLRequest(url: target)) } }

    private func refreshLibrary() {
        for view in libraryList.arrangedSubviews { libraryList.removeArrangedSubview(view); view.removeFromSuperview() }
        let values: [(String,String)]
        switch selectedLibrary {
        case "bookmarks": values = (defaults.array(forKey: "bookmarks") as? [[String:String]] ?? []).prefix(30).map { ($0["title"] ?? "Untitled", $0["url"] ?? "") }
        case "downloads": values = ((try? JSONDecoder().decode([DownloadRecord].self, from: defaults.data(forKey: "downloads") ?? Data())) ?? []).prefix(30).map { ($0.filename, $0.source) }
        case "permissions": values = ((try? JSONDecoder().decode([PermissionRecord].self, from: defaults.data(forKey: "permissions") ?? Data())) ?? []).prefix(30).map { ("\($0.permission) · \($0.decision)", $0.origin) }
        default: values = ((try? JSONDecoder().decode([VisitRecord].self, from: defaults.data(forKey: "history") ?? Data())) ?? []).prefix(30).map { ($0.title, $0.url) }
        }
        if values.isEmpty { let empty = NSTextField(wrappingLabelWithString: "Nothing here yet."); empty.textColor = .tertiaryLabelColor; empty.font = .systemFont(ofSize: 12); libraryList.addArrangedSubview(empty) }
        for (title, detail) in values { let titleField = NSTextField(labelWithString: String(title.prefix(30))); titleField.font = .systemFont(ofSize: 12, weight: .medium); let detailField = NSTextField(labelWithString: String(detail.prefix(40))); detailField.font = .systemFont(ofSize: 10); detailField.textColor = .secondaryLabelColor; let item = NSStackView(views: [titleField, detailField]); item.orientation = .vertical; item.alignment = .leading; item.spacing = 1; libraryList.addArrangedSubview(item) }
    }
    private func selectLibrary(_ value: String, title: String, boundary: String) { selectedLibrary = value; libraryTitle.stringValue = title; libraryBoundary.stringValue = boundary; refreshLibrary() }

    func controlTextDidEndEditing(_ obj: Notification) { if let field = obj.object as? NSTextField, field === address { navigate(field.stringValue) } }
    @objc private func goBack() { activeWebView()?.goBack() }
    @objc private func goForward() { activeWebView()?.goForward() }
    @objc private func reload() { activeWebView()?.reload() }
    @objc private func newTabAction() { openTab(url: startURL(), isPrivate: false) }
    @objc private func privateTabAction() { openTab(url: startURL(), isPrivate: true); security.stringValue = "Private · YNX history, recovery, permissions and AI are not persisted. Sites, network, OS and downloads may retain activity." }
    @objc private func selectTab(_ sender: TabButton) { if let id = sender.tabID { activate(id) } }
    @objc private func closeTabAction() { guard let id = activeID else { return }; webViews[id]?.removeFromSuperview(); webViews.removeValue(forKey: id); tabs.removeAll { $0.id == id }; persistTabs(); if let next = tabs.last { activate(next.id) } else { openTab(url: startURL(), isPrivate: false) } }
    @objc private func bookmarkAction() { guard let tab = activeID.flatMap({ id in tabs.first(where: { $0.id == id }) }), !tab.isPrivate else { security.stringValue = "Private tabs cannot be bookmarked without leaving private mode."; return }; var values = defaults.array(forKey: "bookmarks") as? [[String:String]] ?? []; values.insert(["url":tab.url,"title":tab.title], at: 0); defaults.set(values, forKey: "bookmarks"); selectLibrary("bookmarks", title: "Bookmarks", boundary: "Bookmarks sync is not configured; records remain on this Mac.") }
    @objc private func showHistory() { selectLibrary("history", title: "History", boundary: "History is stored on this Mac. Private tabs never appear here.") }
    @objc private func showBookmarks() { selectLibrary("bookmarks", title: "Bookmarks", boundary: "Bookmarks sync is not configured; records remain on this Mac.") }
    @objc private func showDownloads() { selectLibrary("downloads", title: "Downloads", boundary: "Downloaded files may remain outside YNX even after browser data is cleared.") }
    @objc private func showPermissions() { selectLibrary("permissions", title: "Site permissions", boundary: "Decisions are bound to an exact origin. Private decisions are never saved.") }
    @objc private func showSecurity() { let url = activeWebView()?.url; let origin = url.flatMap { value in value.host.map { "\(value.scheme ?? "unknown")://\($0)" } } ?? "No origin"; let transport = url?.scheme == "https" ? "Encrypted HTTPS transport; WebKit applies system certificate trust." : "Not HTTPS; transport is not encrypted."; showBoundary(title: origin, message: "\(transport)\n\nA valid certificate does not prove a site is honest. Phishing protection uses only the configured operator list and is not complete.") }
    @objc private func aiPageAction() { guard let tab = activeID.flatMap({ id in tabs.first(where: { $0.id == id }) }) else { return }; if tab.isPrivate { showBoundary(title: "AI unavailable in Private", message: "Private page content is never sent to an AI provider."); return }; let configured = environment["YNX_AI_GATEWAY_URL"] != nil && environment["YNX_AI_GATEWAY_CLIENT_TOKEN"] != nil; let alert = NSAlert(); alert.messageText = "Review page context for AI"; alert.informativeText = "Action: summarize selected page\nProvider: \(configured ? "YNX AI Gateway" : "unavailable")\nModel: default\nContext: current page text and URL only\nExcluded: history, other tabs, Wallet identity and private data\nCost: provider-dependent, maximum 50,000 page characters\n\nGeneration requires permission, supports cancellation, and must be reviewed before use."; alert.addButton(withTitle: configured ? "Allow page context" : "Provider unavailable"); alert.addButton(withTitle: "Cancel"); if !configured { alert.buttons[0].isEnabled = false }; _ = alert.runModal() }
    @objc private func startWalletSignIn() {
        do {
            let issued = Date(), expires = issued.addingTimeInterval(300), nonce = randomToken(32), key = try devicePublicKey()
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let request: [String:Any] = ["version":"1","nonce":nonce,"chainId":"ynx_6423-1","requestingProduct":"browser","productClientId":"ynx-browser-macos","bundleId":"com.ynxweb4.browser.macos","productDeviceAlgorithm":"p256-sha256","productDeviceKey":key,"callback":"ynxbrowser://com.ynxweb4.browser.macos/auth/callback","scopes":["account:read","browser:wallet-request"],"purpose":"Sign in to YNX Browser","issuedAt":formatter.string(from:issued),"expiresAt":formatter.string(from:expires)]
            let data = try JSONSerialization.data(withJSONObject: request)
            var components = URLComponents(); components.scheme = "ynxwallet"; components.host = "authorize"; components.queryItems = [URLQueryItem(name:"request", value:data.base64URLEncodedString())]
            guard let link = components.url else { throw NSError(domain:"YNXBrowser",code:1,userInfo:[NSLocalizedDescriptionKey:"Wallet link creation failed"]) }
            defaults.set(nonce, forKey:"walletPendingNonce"); defaults.set(expires.timeIntervalSince1970, forKey:"walletPendingExpiry")
            if !NSWorkspace.shared.open(link) { security.stringValue = "YNX Wallet is unavailable. No session was created." }
        } catch { security.stringValue = "Wallet request failed: \(error.localizedDescription). No session was created." }
    }
    @objc private func showAbout() { showBoundary(title: "YNX Browser · Testnet Preview", message: "Engine: Apple WebKit (WKWebView)\nSearch: registered authorized sources only\nPrivacy: no claim of perfect privacy\nSigning: the browser never signs; YNX Wallet performs final review.") }
    @objc private func clearData() { let alert=NSAlert();alert.messageText="Clear browsing data?";alert.informativeText="Cookies, cache, history, permissions and recovery state are cleared. Bookmarks and downloaded files remain.";alert.addButton(withTitle:"Clear");alert.addButton(withTitle:"Cancel");guard alert.runModal() == .alertFirstButtonReturn else{return};WKWebsiteDataStore.default().removeData(ofTypes:WKWebsiteDataStore.allWebsiteDataTypes(),modifiedSince:.distantPast){};defaults.removeObject(forKey:"history");defaults.removeObject(forKey:"permissions");defaults.removeObject(forKey:"tabs");security.stringValue="Local browsing data cleared. Bookmarks and downloaded files remain.";refreshLibrary() }
    @objc private func checkUpdates() { showBoundary(title:"Signed update boundary",message:"No signed update feed is configured. Web pages and AI output cannot replace this app. Install only a signed and notarized application bundle from the reviewed release channel.") }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if ["ynxwallet", "ynx-wallet"].contains(url.scheme) { decisionHandler(.cancel); reviewWalletURL(url); return }
        let origin = "\(url.scheme ?? "")://\(url.host ?? "")"
        if phishingOrigins.contains(origin) { decisionHandler(.cancel); showBoundary(title: "Known-list warning", message: "This origin matches the configured operator blocklist. Navigation stopped. This list does not guarantee protection from other phishing sites."); return }
        decisionHandler(.allow)
    }
    private func reviewWalletURL(_ url: URL) { let components = URLComponents(url: url, resolvingAgainstBaseURL: false); let fields = Dictionary(uniqueKeysWithValues: (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") }); let detail = ["Requester: \(fields["requestingProduct"] ?? activeWebView()?.url?.host ?? "unavailable")", "Callback: \(fields["callback"] ?? "must be reviewed in Wallet")", "Scopes: \(fields["scopes"] ?? "must be reviewed in Wallet")", "Recipient: \(fields["recipient"] ?? "not supplied")", "YNXT amount: \(fields["amount"] ?? "not supplied")", "Fee: \(fields["fee"] ?? "not supplied")", "Contract data: \(fields["data"] ?? "not supplied")", "Network: ynx_6423-1", "Expiry: \(fields["expiresAt"] ?? "must be reviewed in Wallet")"].joined(separator: "\n"); showBoundary(title: "Wallet signing review", message: "\(detail)\n\nContinue only after YNX Wallet verifies exact bindings. This browser never signs or reports a completed transaction.") }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { guard let i = index(for: webView) else { return }; tabs[i].url = webView.url?.absoluteString ?? tabs[i].url; tabs[i].title = webView.title ?? webView.url?.host ?? "Untitled"; tabs[i].crashed = false; if !tabs[i].isPrivate { var visits = (try? JSONDecoder().decode([VisitRecord].self, from: defaults.data(forKey: "history") ?? Data())) ?? []; visits.insert(VisitRecord(url: tabs[i].url,title: tabs[i].title,visitedAt:Date()),at:0); if let data=try? JSONEncoder().encode(Array(visits.prefix(5000))){defaults.set(data,forKey:"history")} }; persistTabs(); refreshChrome(); refreshLibrary(); security.stringValue = tabs[i].isPrivate ? "Private · no YNX history, recovery, permission persistence or AI context" : webView.url?.scheme == "https" ? "HTTPS · WebKit system trust · certificate validity does not prove site identity" : "Not HTTPS · connection is not encrypted" }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { security.stringValue = "Page failed to load · \(error.localizedDescription) · Retry is safe" }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if let i=index(for:webView){tabs[i].crashed=true;persistTabs();refreshChrome();security.stringValue="Web content process crashed · session recovery preserved · press Reload to continue"} }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { let trust=challenge.protectionSpace.serverTrust; security.stringValue = trust == nil ? "Certificate trust unavailable" : "TLS certificate received for \(challenge.protectionSpace.host) · system trust evaluation applies"; completionHandler(.performDefaultHandling,nil) }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { let permission=type == .camera ? "camera" : type == .microphone ? "microphone" : "camera and microphone";let exactOrigin="\(origin.protocol)://\(origin.host):\(origin.port)";let alert=NSAlert();alert.messageText="Site permission";alert.informativeText="Allow \(permission) once for exact origin \(exactOrigin)? Persistent allow is not offered in this preview.";alert.addButton(withTitle:"Allow once");alert.addButton(withTitle:"Deny");let granted=alert.runModal() == .alertFirstButtonReturn;if let i=index(for:webView),!tabs[i].isPrivate{var values=(try? JSONDecoder().decode([PermissionRecord].self,from:defaults.data(forKey:"permissions") ?? Data())) ?? [];values.insert(PermissionRecord(origin:exactOrigin,permission:permission,decision:granted ? "allow-once" : "deny",decidedAt:Date()),at:0);if let data=try? JSONEncoder().encode(Array(values.prefix(500))){defaults.set(data,forKey:"permissions")};refreshLibrary()};decisionHandler(granted ? .grant : .deny) }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) { let panel=NSOpenPanel();panel.canChooseFiles=true;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.beginSheetModal(for:window){completionHandler($0 == .OK ? panel.urls : nil)} }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate=self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) { let panel=NSSavePanel();panel.nameFieldStringValue=suggestedFilename;panel.beginSheetModal(for:window){ result in completionHandler(result == .OK ? panel.url : nil) } }
    func downloadDidFinish(_ download: WKDownload) { let record=DownloadRecord(filename:"User-selected file",source:activeWebView()?.url?.absoluteString ?? "unknown",finishedAt:Date());var values=(try? JSONDecoder().decode([DownloadRecord].self,from:defaults.data(forKey:"downloads") ?? Data())) ?? [];values.insert(record,at:0);if let data=try? JSONEncoder().encode(Array(values.prefix(500))){defaults.set(data,forKey:"downloads")};security.stringValue="Download completed to the user-selected file.";refreshLibrary() }
    private func showBoundary(title: String, message: String) { let alert=NSAlert();alert.messageText=title;alert.informativeText=message;alert.alertStyle = .informational;alert.addButton(withTitle:"Close");alert.runModal() }

    private func applyEvidenceState() { guard let state = environment["YNX_BROWSER_EVIDENCE_STATE"] else { return }; if state == "private" { privateTabAction() }; if state == "crash", let id=activeID, let i=tabs.firstIndex(where:{$0.id==id}){tabs[i].crashed=true;refreshChrome();security.stringValue="Web content process crashed · session recovery preserved · press Reload to continue"}; if state == "permissions" { showPermissions() }; if state == "downloads" { showDownloads() } }
    func application(_ application: NSApplication, open urls: [URL]) { guard let value = urls.first else { return }; if value.scheme == "ynxbrowser", value.host == "com.ynxweb4.browser.macos", value.path == "/auth/callback" { handleWalletCallback(value) } else if value.scheme == "ynxbrowser", let components = URLComponents(url: value, resolvingAgainstBaseURL: false), let target = components.queryItems?.first(where: { $0.name == "url" })?.value { navigate(target) } else if ["http", "https"].contains(value.scheme) { activeWebView()?.load(URLRequest(url: value)) } }
    private func handleWalletCallback(_ url: URL) { do { guard let encoded=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="response"})?.value,let data=Data(base64URLEncoded:encoded),let response=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw NSError(domain:"YNXBrowser",code:2,userInfo:[NSLocalizedDescriptionKey:"malformed callback"])};guard defaults.double(forKey:"walletPendingExpiry")>Date().timeIntervalSince1970,response["nonce"] as? String==defaults.string(forKey:"walletPendingNonce"),response["chainId"] as? String=="ynx_6423-1",response["productClientId"] as? String=="ynx-browser-macos",response["bundleId"] as? String=="com.ynxweb4.browser.macos" else{throw NSError(domain:"YNXBrowser",code:3,userInfo:[NSLocalizedDescriptionKey:"replay, expiry or product binding mismatch"])};defaults.removeObject(forKey:"walletPendingNonce");defaults.removeObject(forKey:"walletPendingExpiry");security.stringValue="Wallet response received. Central Gateway signature and device challenge verification are required; no local session was created."}catch{security.stringValue="Wallet callback rejected: \(error.localizedDescription)"} }
    private func randomToken(_ count:Int)->String{var bytes=[UInt8](repeating:0,count:count);_ = SecRandomCopyBytes(kSecRandomDefault,count,&bytes);return Data(bytes).base64URLEncodedString()}
    private func devicePublicKey() throws -> String { let service="com.ynxweb4.browser.macos",account="wallet-product-device-p256",query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account,kSecReturnData as String:true];var item:CFTypeRef?;let key:P256.Signing.PrivateKey;if SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess,let data=item as? Data{key=try P256.Signing.PrivateKey(rawRepresentation:data)}else{key=P256.Signing.PrivateKey();let add:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,kSecValueData as String:key.rawRepresentation];SecItemDelete(query as CFDictionary);guard SecItemAdd(add as CFDictionary,nil)==errSecSuccess else{throw NSError(domain:"YNXBrowser",code:4,userInfo:[NSLocalizedDescriptionKey:"device key storage failed"])} };guard let compact=key.publicKey.compactRepresentation else{throw NSError(domain:"YNXBrowser",code:5,userInfo:[NSLocalizedDescriptionKey:"device key encoding failed"])};return compact.base64URLEncodedString() }
    func applicationWillTerminate(_ notification: Notification) { tabs.removeAll(where: { $0.isPrivate }); persistTabs() }
}

let app = NSApplication.shared
let delegate = BrowserController()
app.delegate = delegate
app.run()

extension Data {
    func base64URLEncodedString() -> String { base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
    init?(base64URLEncoded:String) { var value=base64URLEncoded.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");value+=String(repeating:"=",count:(4-value.count%4)%4);self.init(base64Encoded:value) }
}
