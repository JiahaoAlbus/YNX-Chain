import AppKit
import WebKit
import CryptoKit
import Security
import OSLog
import YNXBrowserCore

typealias TabRecord = BrowserSessionTab
typealias VisitRecord = BrowserVisitRecord
struct PermissionRecord: Codable { let origin: String; let permission: String; let decision: String; let decidedAt: Date }

final class TabButton: NSButton { var tabID: UUID? }
final class TabCloseButton: NSButton { var tabID: UUID? }
final class LibraryPageButton: NSButton { var pageURL: String = "" }

/// Keep navigation content inset while the native button's background and hit area
/// span the sidebar. Drawing only the interior preserves normal NSButton actions.
final class SidebarNavigationButtonCell: NSButtonCell {
    override func drawInterior(withFrame cellFrame: NSRect, in controlView: NSView) {
        super.drawInterior(withFrame: cellFrame.insetBy(dx: 14, dy: 0), in: controlView)
    }
}

/// A library's scroll origin is its first row, including when the content is shorter
/// than the viewport. The inner stack keeps its natural content height.
final class LibraryDocumentView: NSView {
    override var isFlipped: Bool { true }
}

@MainActor final class BrowserController: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSTextFieldDelegate {
    private var window: NSWindow!
    private var ownedWindows: [BrowserController] = []
    private weak var coordinator: BrowserController?
    private let isPrivateWindow: Bool
    private var privateStore: WKWebsiteDataStore?
    private var closedWindow = false
    private var terminatingApp = false
    private var launchCompleted = false
    private var queuedExternalNavigations: [URL] = []
    private var sessionPersistence = BrowserSessionPersistenceSelection()
    private(set) var originalPagesProducer: BrowserNativePageReadoutProducer?

    init(privateWindow: Bool = false, coordinator: BrowserController? = nil) {
        isPrivateWindow = privateWindow; self.coordinator = coordinator
        super.init()
    }
    private let address = NSTextField()
    private let security = NSTextField(labelWithString: "Search the web or enter an HTTP(S) address")
    private let tabStrip = NSStackView()
    private let libraryList = NSStackView()
    private let pageHost = NSView()
    private var libraryPanel: NSView!
    private var sidebarButtons: [String: NSButton] = [:]
    private var homeTabIDs = Set<UUID>()
    private var pendingTargets: [UUID: URL] = [:]
    private var failedTargets: [UUID: String] = [:]
    private var activeNavigationIDs: [UUID: ObjectIdentifier] = [:]
    private var downloadNavigationIDs: [UUID: ObjectIdentifier] = [:]
    private var pageResponses: [UUID: (url: URL, status: Int)] = [:]
    private var showingLibrary = false
    private var homeViews: [UUID: BrowserHomeView] = [:]
    private var homeView: BrowserHomeView {
        guard let id = activeID else { return makeHomeView() }
        if let existing = homeViews[id] { return existing }
        let view = makeHomeView(); homeViews[id] = view; return view
    }
    private let libraryTitle = NSTextField(labelWithString: "History")
    private let libraryBoundary = NSTextField(wrappingLabelWithString: "History is stored on this Mac. Private tabs never appear here.")
    private var webViews: [UUID: WKWebView] = [:]
    private var documentURLObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
    private var documentTitleObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
    private var observedDocumentURLs: [UUID: String] = [:]
    private let downloadDecisions = BrowserDownloadDecisionLedger()
    private let pendingSaveQuitShortcut = BrowserPendingSaveQuitShortcut()
    private let windowEvidenceWriter = BrowserEvidenceFileWriter()
    private var savePanelEvidence: [[String: Any]] = []
    private lazy var savePanelStateObservation = BrowserSavePanelStateObservation(owner: window, application: NSApp) { [weak self] event, state in
        self?.recordSavePanelEvidence(event, state: state)
    }
    private lazy var savePanelValidationObservation = BrowserSavePanelValidationObservation { [weak self] event, panel in
        guard let self, self.downloadPanels.values.contains(where: { $0.panel === panel }) else { return }
        self.recordSavePanelEvidence(event, panel: panel)
    }
    private var activeDownloads: [ObjectIdentifier: (download: WKDownload, activity: BrowserDownloadActivity)] = [:]
    private var downloadActivities: [BrowserDownloadActivity] = []
    private var downloadProgressObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
    private var downloadPanels: [ObjectIdentifier: (ticket: BrowserDownloadDecision, panel: NSSavePanel)] = [:]
    private var downloadRecoveryPanels: [UUID: NSSavePanel] = [:]
    private var downloadFiles: [ObjectIdentifier: (staging: URL, destination: URL)] = [:]
    private var backButton: NSButton?
    private var forwardButton: NSButton?
    private var tabs: [TabRecord] = []
    private var activeID: UUID?
    private var selectedLibrary = "history"
    private lazy var defaults = environment["YNX_BROWSER_PROFILE_SUITE"].flatMap(UserDefaults.init(suiteName:)) ?? .standard
    private var documentGenerations: [UUID: UInt64] = [:]
    private let pageSelections = BrowserPageSelectionStore()
    private let localPageSetID = "browser-local:\(UUID().uuidString)"
    private var selectedPageTaskID: String?
    private var pageSelectionTaskID: String { selectedPageTaskID ?? localPageSetID }
    private var selectedSources: [BrowserPageSource] = []
    private var selectionReviewGeneration: UInt64 = 0
    private var searchProvider: BrowserSearchProvider {
        guard let data = defaults.data(forKey: "ordinarySearchProvider"),
              let saved = try? JSONDecoder().decode(BrowserSearchProvider.self, from: data),
              let checked = try? BrowserSearchProvider(name: saved.name, template: saved.template) else { return .duckDuckGo }
        return checked
    }
    private var providerDisplayName: String { searchProvider.destinationHost == "duckduckgo.com" ? "DuckDuckGo" : searchProvider.destinationHost }
    private var appearanceMode: String { environment["YNX_BROWSER_APPEARANCE"] ?? defaults.string(forKey: "appearanceMode") ?? "light" }
    private let defaultWindowSize = NSSize(width: 1440, height: 900)
    private let minimumWindowSize = NSSize(width: 1000, height: 700)
    private var enforcingWindowFrame = false
    private var launchFrameGuard: Timer?
    private let auditLogger = Logger(subsystem: "com.ynxweb4.browser.macos", category: "security-boundary")
    private let environment = ProcessInfo.processInfo.environment
    private lazy var phishingOrigins = Set(environment["YNX_BROWSER_BLOCKED_ORIGINS"]?.split(separator: ",").map(String.init) ?? [])

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if coordinator == nil && !isPrivateWindow { clearLegacyWindowFrames() }
        window = NSWindow(contentRect: NSRect(origin: .zero, size: defaultWindowSize), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "YNX Browser"
        window.isRestorable = false
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("")
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = minimumWindowSize
        window.contentMinSize = NSSize(width: minimumWindowSize.width, height: minimumWindowSize.height - 28)
        window.delegate = self
        window.appearance = NSAppearance(named: appearanceMode == "dark" ? .darkAqua : .aqua)
        NSApp.appearance = window.appearance
        buildChrome()
        buildMenu()
        window.makeKeyAndOrderFront(nil)
        enforceUsableWindowFrame(useDefaultSize: true)
        NSApp.activate(ignoringOtherApps: true)
        if coordinator == nil && !isPrivateWindow { restoreTabs() }
        if tabs.isEmpty { openHomeTab(isPrivate: isPrivateWindow) } else { activate(tabs.last!.id) }
        if coordinator == nil { applyEvidenceState() }
        if !isPrivateWindow {
            originalPagesProducer = BrowserNativePageReadoutProducer(
                profileID: environment["YNX_BROWSER_PROFILE_SUITE"] ?? "ordinary", store: pageSelections,
                taskID: { [weak self] in self?.pageSelectionTaskID },
                windowCurrent: { [weak self] in
                    guard let self, !self.closedWindow, !self.isPrivateWindow else { throw BrowserPageSelectionError.unavailable }
                },
                currentDocument: { [weak self] id in self?.pageDocument(for: id) },
                extract: { [weak self] source in
                    guard let self, !self.closedWindow, !self.isPrivateWindow,
                          let view = self.webViews[source.document.tabID],
                          self.pageDocument(for: source.document.tabID) == source.document else { throw BrowserPageSelectionError.unavailable }
                    return try await self.extractPage(view, fields: source.fields)
                })
        }
        BrowserChromeTheme.refreshAll()
        beginLaunchFrameGuard()
        launchCompleted = true
        let externalTargets = queuedExternalNavigations
        queuedExternalNavigations.removeAll()
        for target in externalTargets { openExternalNavigation(target) }
    }

    private func clearLegacyWindowFrames() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("NSWindow Frame com.ynxweb4.browser") {
            defaults.removeObject(forKey: key)
        }
        defaults.synchronize()
    }

    private func beginLaunchFrameGuard() {
        let startedAt = Date()
        launchFrameGuard?.invalidate()
        launchFrameGuard = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.enforceUsableWindowFrame(useDefaultSize: true)
                if Date().timeIntervalSince(startedAt) >= 3 {
                    self.launchFrameGuard?.invalidate()
                    self.launchFrameGuard = nil
                    self.writeWindowEvidenceIfRequested()
                }
            }
        }
    }

    private func enforceUsableWindowFrame(useDefaultSize: Bool = false) {
        guard !enforcingWindowFrame, let screen = window.screen ?? NSScreen.main else { return }
        enforcingWindowFrame = true
        defer { enforcingWindowFrame = false }
        let visible = screen.visibleFrame
        let requested = useDefaultSize ? defaultWindowSize : window.frame.size
        let width = min(visible.width, max(minimumWindowSize.width, requested.width))
        let height = min(visible.height, max(minimumWindowSize.height, requested.height))
        let origin = NSPoint(
            x: visible.midX - width / 2,
            y: visible.midY - height / 2
        )
        window.setFrame(NSRect(origin: origin, size: NSSize(width: width, height: height)), display: true, animate: false)
    }

    private func writeWindowEvidenceIfRequested() {
        guard coordinator == nil, !isPrivateWindow, let path = environment["YNX_BROWSER_WINDOW_EVIDENCE_FILE"] else { return }
        let frame = window.frame
        let payload: [String: Any] = [
            "schemaVersion": "ynx-browser-window-evidence-v1",
            "width": Int(frame.width.rounded()),
            "height": Int(frame.height.rounded()),
            "minimumWidth": Int(minimumWindowSize.width),
            "minimumHeight": Int(minimumWindowSize.height),
            "usable": frame.width >= minimumWindowSize.width && frame.height >= minimumWindowSize.height,
            "appearance": appearanceMode,
            "appActive": NSApp.isActive,
            "ownerKey": window.isKeyWindow,
            "ownerMain": window.isMainWindow,
            "savePanelEvents": savePanelEvidence
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else { return }
        windowEvidenceWriter.submit(data, to: URL(fileURLWithPath: path))
    }

    private func recordSavePanelEvidence(_ phase: BrowserSavePanelStateObservation.Event, state: BrowserSavePanelStateObservation.State? = nil, panel: NSSavePanel? = nil) {
        guard environment["YNX_BROWSER_WINDOW_EVIDENCE_FILE"] != nil else { return }
        let snapshot = state ?? .init(appActive: NSApp.isActive, ownerKey: window.isKeyWindow,
            ownerMain: window.isMainWindow, ownerVisible: window.isVisible,
            ownerMiniaturized: window.isMiniaturized, attachedSheet: window.attachedSheet != nil)
        var event: [String: Any] = snapshot.evidence
        event["phase"] = phase.rawValue
        event["pid"] = ProcessInfo.processInfo.processIdentifier
        if let panel {
            // Public host-proxy properties do not establish the remote process's key window.
            event["hostPanelVisible"] = panel.isVisible
            event["hostPanelKey"] = panel.isKeyWindow
            event["hostPanelAttachedToOwner"] = panel.sheetParent === window
            event["panelHasURL"] = panel.url != nil
            event["panelHasDirectory"] = panel.directoryURL != nil
            event["panelNameEmpty"] = panel.nameFieldStringValue.isEmpty
            event["panelAllowsAllContentTypes"] = panel.allowedContentTypes.isEmpty
        }
        savePanelEvidence.append(event)
        if savePanelEvidence.count > 48 { savePanelEvidence.removeFirst(savePanelEvidence.count - 48) }
        writeWindowEvidenceIfRequested()
    }

    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        NSSize(width: max(minimumWindowSize.width, frameSize.width), height: max(minimumWindowSize.height, frameSize.height))
    }

    func windowDidBecomeKey(_ notification: Notification) {
        closedWindow = false
        buildMenu()
        if window.frame.width < minimumWindowSize.width || window.frame.height < minimumWindowSize.height {
            enforceUsableWindowFrame()
        }
    }

    func windowDidResize(_ notification: Notification) {
        guard !enforcingWindowFrame else { return }
        if window.frame.width < minimumWindowSize.width || window.frame.height < minimumWindowSize.height {
            DispatchQueue.main.async { [weak self] in self?.enforceUsableWindowFrame() }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func startURL() -> URL {
        var parts = URLComponents(string: searchProvider.template)!
        parts.query = nil
        return parts.url!
    }

    private func buildMenu() {
        let menu = NSMenu()
        let app = NSMenuItem(); menu.addItem(app)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About YNX Browser", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(withTitle: "Search Provider…", action: #selector(setSearchProvider), keyEquivalent: "")
        let appearanceItem = NSMenuItem(title: "Appearance", action: nil, keyEquivalent: "")
        let appearanceMenu = NSMenu(title: "Appearance")
        let light = appearanceMenu.addItem(withTitle: "Light", action: #selector(useLightTheme), keyEquivalent: "")
        let dark = appearanceMenu.addItem(withTitle: "Dark", action: #selector(useDarkTheme), keyEquivalent: "")
        light.state = appearanceMode == "dark" ? .off : .on; dark.state = appearanceMode == "dark" ? .on : .off
        appearanceItem.submenu = appearanceMenu; appMenu.addItem(appearanceItem)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Clear Browsing Data…", action: #selector(clearData), keyEquivalent: "")
        appMenu.addItem(withTitle: "Check for Signed Updates…", action: #selector(checkUpdates), keyEquivalent: "")
        appMenu.addItem(.separator())
        let quitItem = appMenu.addItem(withTitle: "Quit YNX Browser", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        BrowserPendingSaveQuitShortcut.configureQuitItem(quitItem, application: NSApp)
        app.submenu = appMenu
        let file = NSMenuItem(); menu.addItem(file)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Open Ordinary Window", action: #selector(showOrdinaryWindow), keyEquivalent: "")
        fileMenu.addItem(withTitle: "New Ordinary Window", action: #selector(newOrdinaryWindow), keyEquivalent: "n")
        let routeItem = NSMenuItem(title: "新建隐私路由窗口", action: nil, keyEquivalent: "")
        let routeMenu = NSMenu(title: "新建隐私路由窗口")
        routeMenu.addItem(withTitle: "Tor", action: #selector(newTorRouteWindow), keyEquivalent: "")
        routeMenu.addItem(withTitle: "Nym Mixnet", action: #selector(newNymRouteWindow), keyEquivalent: "")
        routeItem.submenu = routeMenu; fileMenu.addItem(routeItem)
        fileMenu.addItem(withTitle: "New Tab", action: #selector(newTabAction), keyEquivalent: "t")
        let privateItem = fileMenu.addItem(withTitle: "New Private Window", action: #selector(privateTabAction), keyEquivalent: "n"); privateItem.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Close Tab", action: #selector(closeTabAction), keyEquivalent: "w")
        let closeWindow = fileMenu.addItem(withTitle: "Close Window", action: #selector(closeWindowAction), keyEquivalent: "w"); closeWindow.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Save Current URL…", action: #selector(saveDownload), keyEquivalent: "s")
        file.submenu = fileMenu
        let edit = NSMenuItem(); menu.addItem(edit)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu
        let navigation = NSMenuItem(); menu.addItem(navigation)
        let navigationMenu = NSMenu(title: "Navigate")
        navigationMenu.addItem(withTitle: "Open Address", action: #selector(focusAddress), keyEquivalent: "l")
        navigationMenu.addItem(withTitle: "Back", action: #selector(goBack), keyEquivalent: "[")
        navigationMenu.addItem(withTitle: "Forward", action: #selector(goForward), keyEquivalent: "]")
        navigationMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        navigationMenu.addItem(withTitle: "Search Home", action: #selector(showSearchAction), keyEquivalent: "k")
        navigationMenu.addItem(withTitle: "Bookmark Page", action: #selector(bookmarkAction), keyEquivalent: "d")
        navigationMenu.addItem(withTitle: "Review Selected Pages…", action: #selector(reviewSelectedPages), keyEquivalent: "")
        navigationMenu.addItem(withTitle: "Clear Selected Pages", action: #selector(clearSelectedPages), keyEquivalent: "")
        navigation.submenu = navigationMenu
        func bindWindowActions(_ menu: NSMenu) {
            for item in menu.items {
                if let submenu = item.submenu { bindWindowActions(submenu) }
                if let action = item.action, responds(to: action) { item.target = self }
            }
        }
        bindWindowActions(menu)
        NSApp.mainMenu = menu
    }

    private func buildChrome() {
        guard let root = window.contentView else { return }
        BrowserChromeTheme.paint(root, background: BrowserChromeTheme.background)
        let sidebar = buildSidebar(); sidebar.translatesAutoresizingMaskIntoConstraints = false
        let tabBackground = BrowserChromeSurface(cornerRadius: 0)
        BrowserChromeTheme.paint(tabBackground, background: BrowserChromeTheme.surface)
        tabBackground.translatesAutoresizingMaskIntoConstraints = false
        tabStrip.orientation = .horizontal; tabStrip.alignment = .centerY; tabStrip.spacing = 2; tabStrip.translatesAutoresizingMaskIntoConstraints = false
        let tabsScroll = NSScrollView(); tabsScroll.drawsBackground = false; tabsScroll.hasHorizontalScroller = true; tabsScroll.autohidesScrollers = true; tabsScroll.documentView = tabStrip; tabsScroll.translatesAutoresizingMaskIntoConstraints = false
        let addTab = symbolButton("plus", #selector(newTabAction), "New tab"); addTab.translatesAutoresizingMaskIntoConstraints = false
        tabBackground.addSubview(tabsScroll); tabBackground.addSubview(addTab)
        let back = symbolButton("arrow.left", #selector(goBack), "Go back")
        let forward = symbolButton("arrow.right", #selector(goForward), "Go forward")
        backButton = back; forwardButton = forward
        let reload = symbolButton("arrow.clockwise", #selector(reload), "Reload")
        let siteInfo = symbolButton("lock", #selector(showSecurity), "Site information")
        let bookmark = symbolButton("star", #selector(bookmarkAction), "Bookmark page")
        let account = symbolButton("person.crop.circle", #selector(startWalletSignIn), "Wallet connection")
        let more = symbolButton("ellipsis", #selector(showBrowserActions(_:)), "Browser actions")
        address.placeholderAttributedString = NSAttributedString(string: "Search DuckDuckGo or enter URL", attributes: [.foregroundColor: BrowserChromeTheme.muted])
        address.delegate = self; address.target = self; address.action = #selector(submitAddress)
        address.isBordered = false; address.isBezeled = false; address.drawsBackground = false
        address.textColor = BrowserChromeTheme.text; address.font = .systemFont(ofSize: 14); address.focusRingType = .none
        address.setAccessibilityLabel("Address or DuckDuckGo search query")
        let searchIcon = NSImageView(image: BrowserChromeTheme.symbol("magnifyingglass", size: 17)); searchIcon.contentTintColor = BrowserChromeTheme.secondary
        let addressBox = BrowserChromeSurface(cornerRadius: 21); BrowserChromeTheme.paint(addressBox, background: BrowserChromeTheme.elevated)
        for child in [searchIcon, address, siteInfo] { child.translatesAutoresizingMaskIntoConstraints = false; addressBox.addSubview(child) }
        NSLayoutConstraint.activate([addressBox.heightAnchor.constraint(equalToConstant: 42), searchIcon.leadingAnchor.constraint(equalTo: addressBox.leadingAnchor, constant: 16), searchIcon.centerYAnchor.constraint(equalTo: addressBox.centerYAnchor), searchIcon.widthAnchor.constraint(equalToConstant: 18), address.leadingAnchor.constraint(equalTo: searchIcon.trailingAnchor, constant: 12), address.centerYAnchor.constraint(equalTo: addressBox.centerYAnchor), address.trailingAnchor.constraint(equalTo: siteInfo.leadingAnchor, constant: -8), siteInfo.trailingAnchor.constraint(equalTo: addressBox.trailingAnchor, constant: -9), siteInfo.centerYAnchor.constraint(equalTo: addressBox.centerYAnchor)])
        let route = NSPopUpButton(frame: .zero, pullsDown: true); route.addItem(withTitle: "Standard"); route.isBordered = false; route.font = .systemFont(ofSize: 13, weight: .medium)
        for (title, action) in [("Standard · Direct", #selector(showOrdinaryWindow)), ("Tor · Blocked", #selector(newTorRouteWindow)), ("Nym · Blocked", #selector(newNymRouteWindow))] { let item = NSMenuItem(title: title, action: action, keyEquivalent: ""); item.target = self; route.menu?.addItem(item) }
        route.widthAnchor.constraint(equalToConstant: 122).isActive = true
        let bar = NSStackView(views: [back, forward, reload, addressBox, route, bookmark, account, more]); bar.orientation = .horizontal; bar.spacing = 11; bar.translatesAutoresizingMaskIntoConstraints = false
        addressBox.setContentHuggingPriority(.defaultLow, for: .horizontal)
        security.font = .systemFont(ofSize: 10); security.textColor = BrowserChromeTheme.muted; security.lineBreakMode = .byTruncatingTail; security.translatesAutoresizingMaskIntoConstraints = false
        pageHost.translatesAutoresizingMaskIntoConstraints = false; BrowserChromeTheme.paint(pageHost, background: BrowserChromeTheme.background)
        libraryPanel = buildLibraryPanel()
        for child in [sidebar, tabBackground, bar, security, pageHost] { root.addSubview(child) }
        NSLayoutConstraint.activate([
            sidebar.leadingAnchor.constraint(equalTo: root.leadingAnchor), sidebar.topAnchor.constraint(equalTo: root.topAnchor), sidebar.bottomAnchor.constraint(equalTo: root.bottomAnchor), sidebar.widthAnchor.constraint(equalToConstant: 220),
            tabBackground.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor), tabBackground.trailingAnchor.constraint(equalTo: root.trailingAnchor), tabBackground.topAnchor.constraint(equalTo: root.topAnchor), tabBackground.heightAnchor.constraint(equalToConstant: 52),
            tabsScroll.leadingAnchor.constraint(equalTo: tabBackground.leadingAnchor, constant: 20), tabsScroll.trailingAnchor.constraint(equalTo: addTab.leadingAnchor, constant: -10), tabsScroll.topAnchor.constraint(equalTo: tabBackground.topAnchor, constant: 8), tabsScroll.bottomAnchor.constraint(equalTo: tabBackground.bottomAnchor, constant: -4), addTab.trailingAnchor.constraint(equalTo: tabBackground.trailingAnchor, constant: -18), addTab.centerYAnchor.constraint(equalTo: tabsScroll.centerYAnchor),
            bar.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: 22), bar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18), bar.topAnchor.constraint(equalTo: tabBackground.bottomAnchor, constant: 9), addressBox.widthAnchor.constraint(greaterThanOrEqualToConstant: 230),
            security.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 4), security.trailingAnchor.constraint(equalTo: bar.trailingAnchor), security.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 4),
            pageHost.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor), pageHost.trailingAnchor.constraint(equalTo: root.trailingAnchor), pageHost.topAnchor.constraint(equalTo: security.bottomAnchor, constant: 7), pageHost.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
    }

    private func buildSidebar() -> NSView {
        let sidebar = BrowserChromeSurface(cornerRadius: 0); BrowserChromeTheme.paint(sidebar, background: BrowserChromeTheme.surface)
        let brand = BrowserChromeTheme.label("YNX", size: 25, weight: .bold)
        let subtitle = BrowserChromeTheme.label("Browser + Search", size: 13)
        let heading = NSStackView(views: [brand, subtitle]); heading.orientation = .vertical; heading.alignment = .leading; heading.spacing = 1; heading.translatesAutoresizingMaskIntoConstraints = false
        let nav = NSStackView(); nav.orientation = .vertical; nav.alignment = .width; nav.spacing = 8; nav.translatesAutoresizingMaskIntoConstraints = false
        let entries: [(String, String, String, Selector)] = [("home", "Home", "house.fill", #selector(showHomeAction)), ("search", "Search", "magnifyingglass", #selector(showSearchAction)), ("spaces", "Spaces", "square.grid.2x2", #selector(showSpaces)), ("downloads", "Downloads", "arrow.down.to.line", #selector(showDownloads)), ("history", "History", "clock", #selector(showHistory)), ("bookmarks", "Bookmarks", "star", #selector(showBookmarks)), ("settings", "Settings", "gearshape", #selector(showSettings))]
        for (id, title, symbol, action) in entries {
            let item = libraryButton(title, symbol, action); item.heightAnchor.constraint(equalToConstant: 44).isActive = true; item.wantsLayer = true; item.layer?.cornerRadius = 0
            sidebarButtons[id] = item; nav.addArrangedSubview(item)
        }
        nav.fillColumnWidth()
        sidebar.addSubview(heading); sidebar.addSubview(nav)
        NSLayoutConstraint.activate([heading.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 27), heading.topAnchor.constraint(equalTo: sidebar.topAnchor, constant: 62), nav.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor), nav.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor), nav.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 30)])
        return sidebar
    }
    private func buildLibraryPanel() -> NSView {
        let panel = NSView(); BrowserChromeTheme.paint(panel, background: BrowserChromeTheme.background)
        libraryTitle.font = .systemFont(ofSize: 26, weight: .semibold); libraryTitle.textColor = BrowserChromeTheme.text
        libraryBoundary.font = .systemFont(ofSize: 12); libraryBoundary.textColor = BrowserChromeTheme.secondary
        libraryList.orientation = .vertical; libraryList.alignment = .leading; libraryList.spacing = 16; libraryList.translatesAutoresizingMaskIntoConstraints = false
        let scroll = NSScrollView(); scroll.drawsBackground = false; scroll.hasVerticalScroller = true; scroll.autohidesScrollers = true
        let document = LibraryDocumentView(); document.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(libraryList); scroll.documentView = document
        let viewportHeight = document.heightAnchor.constraint(equalTo: scroll.contentView.heightAnchor)
        viewportHeight.priority = .defaultLow
        for child in [libraryTitle, libraryBoundary, scroll] { child.translatesAutoresizingMaskIntoConstraints = false; panel.addSubview(child) }
        NSLayoutConstraint.activate([
            libraryTitle.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 36), libraryTitle.topAnchor.constraint(equalTo: panel.topAnchor, constant: 32),
            libraryBoundary.leadingAnchor.constraint(equalTo: libraryTitle.leadingAnchor), libraryBoundary.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -36), libraryBoundary.topAnchor.constraint(equalTo: libraryTitle.bottomAnchor, constant: 14),
            scroll.leadingAnchor.constraint(equalTo: libraryTitle.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -36), scroll.topAnchor.constraint(equalTo: libraryBoundary.bottomAnchor, constant: 24), scroll.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -24),
            document.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor), document.topAnchor.constraint(equalTo: scroll.contentView.topAnchor), document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            document.heightAnchor.constraint(greaterThanOrEqualTo: scroll.contentView.heightAnchor), viewportHeight,
            libraryList.leadingAnchor.constraint(equalTo: document.leadingAnchor), libraryList.topAnchor.constraint(equalTo: document.topAnchor), libraryList.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -12), libraryList.bottomAnchor.constraint(lessThanOrEqualTo: document.bottomAnchor)
        ])
        return panel
    }
    private func selectSidebar(_ section: String) {
        for (id, button) in sidebarButtons {
            BrowserChromeTheme.paint(button, background: id == section ? BrowserChromeTheme.blue : .clear)
            button.contentTintColor = id == section ? .white : BrowserChromeTheme.text
        }
    }
    private func makeHomeView() -> BrowserHomeView {
        BrowserHomeView(actions: .init(
            navigate: { [weak self] in self?.navigate($0) },
            openSection: { [weak self] section in
                switch section {
                case .home: self?.showHomeAction()
                case .search: self?.showSearchAction()
                case .spaces: self?.showSpaces()
                case .downloads: self?.showDownloads()
                case .history: self?.showHistory()
                case .settings: self?.showSettings()
                }
            },
            chooseRoute: { [weak self] mode in
                switch mode {
                case .standard: self?.showOrdinaryWindow()
                case .tor: self?.openRoutedWindow(mode: .tor)
                case .nym: self?.openRoutedWindow(mode: .nym)
                }
            },
            newPrivateWindow: { [weak self] in self?.createWindow(privateMode: true) },
            newOrdinaryWindow: { [weak self] in self?.newOrdinaryWindow() },
            searchSettings: { [weak self] in self?.setSearchProvider() },
            clearBrowsingData: { [weak self] in self?.clearData() },
            openQuickApp: { [weak self] _ in self?.showBoundary(title: "App not connected", message: "This app is not connected to Browser yet.") },
            clearRecent: { [weak self] in self?.clearRecentRecords() }
        ))
    }
    private func updateHomeData() {
        let isPrivate = activeID.flatMap { id in tabs.first(where: { $0.id == id }) }?.isPrivate ?? isPrivateWindow
        homeView.updatePrivateMode(isPrivate)
        homeView.updateSearchProvider(name: providerDisplayName, host: searchProvider.destinationHost)
        let visits: [VisitRecord] = isPrivate ? [] : ((try? JSONDecoder().decode([VisitRecord].self, from: defaults.data(forKey: "history") ?? Data())) ?? [])
        homeView.updateRecent(isPrivate ? [] : Array(visits.prefix(10)).map { .init(title: $0.title, url: $0.url, visitedAt: $0.visitedAt) })
        homeView.updateQuickApps([("wallet", "Wallet", "wallet.pass"), ("social", "Social", "person.2.fill"), ("cloud", "Cloud", "cloud.fill"), ("pay", "Pay", "creditcard.fill"), ("shop", "Shop", "bag.fill"), ("ai", "AI", "sparkles")].map { .init(id: $0.0, title: $0.1, symbol: $0.2, available: false) })
        homeView.updateRouteState(.init(mode: .standard, status: .connected, detail: "Direct connection. Your IP address is not hidden."))
    }
    @objc private func showHomeAction() {
        guard window.isKeyWindow else { return }
        if let id = activeID, homeTabIDs.contains(id) { showingLibrary = false; renderActivePage() }
        else { openHomeTab(isPrivate: isPrivateWindow) }
    }
    @objc private func showSearchAction() { showHomeAction(); homeView.focusSearch() }
    @objc private func showSpaces() { showBoundary(title: "Spaces unavailable", message: "No shared spaces service is connected. Your browsing history and selected pages have not been sent anywhere.") }
    @objc private func showSettings() {
        let alert = NSAlert(); alert.messageText = "Browser Settings"
        alert.informativeText = "Search: \(searchProvider.name)\nCurrent connection: Standard direct\nPrivate browsing changes local records; it does not hide your IP address."
        alert.addButton(withTitle: "Search Settings"); alert.addButton(withTitle: "Cancel"); alert.addButton(withTitle: "Clear Browsing Data")
        switch alert.runModal() { case .alertFirstButtonReturn: setSearchProvider(); case .alertThirdButtonReturn: clearData(); default: break }
    }
    private func clearRecentRecords() {
        let alert = NSAlert(); alert.messageText = "Clear local recent history?"; alert.informativeText = "This removes local visited-page records. Bookmarks and downloaded files remain."
        alert.addButton(withTitle: "Clear"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        defaults.removeObject(forKey: "history"); refreshLibrary(); updateHomeData()
    }
    @objc private func showBrowserActions(_ sender: NSButton) {
        let menu = NSMenu()
        for (title, action) in [("Select Current Page", #selector(aiPageAction)), ("Review Selected Pages", #selector(reviewSelectedPages)), ("Clear Selected Pages", #selector(clearSelectedPages)), ("New Private Window", #selector(privateTabAction)), ("New Ordinary Window", #selector(newOrdinaryWindow)), ("Site Permissions", #selector(showPermissions)), ("Settings", #selector(showSettings))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: ""); item.target = self; menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.minY), in: sender)
    }

    private func button(_ title: String, _ action: Selector, _ label: String) -> NSButton { let value = NSButton(title: title, target: self, action: action); value.isBordered = false; value.font = .systemFont(ofSize: 13, weight: .medium); value.contentTintColor = BrowserChromeTheme.text; value.setAccessibilityLabel(label); return value }
    private func symbolButton(_ symbol: String, _ action: Selector, _ label: String) -> NSButton {
        let value = NSButton(image: BrowserChromeTheme.symbol(symbol, size: 18), target: self, action: action)
        value.isBordered = false; value.contentTintColor = BrowserChromeTheme.text; value.setAccessibilityLabel(label)
        value.widthAnchor.constraint(equalToConstant: 30).isActive = true; value.heightAnchor.constraint(equalToConstant: 32).isActive = true
        return value
    }
    private func accent() -> NSColor { BrowserChromeTheme.blue }
    private func libraryButton(_ title: String, _ symbol: String, _ action: Selector) -> NSButton {
        let value = NSButton(frame: .zero)
        value.cell = SidebarNavigationButtonCell(textCell: "  " + title)
        value.image = BrowserChromeTheme.symbol(symbol, size: 18); value.target = self; value.action = action
        value.isBordered = false; value.imagePosition = .imageLeading; value.alignment = .left; value.font = .systemFont(ofSize: 14, weight: .medium); value.contentTintColor = BrowserChromeTheme.text
        return value
    }


    private func makeWebView(isPrivate: Bool) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        if isPrivate { if privateStore == nil { privateStore = .nonPersistent() }; configuration.websiteDataStore = privateStore! }
        else { configuration.websiteDataStore = .default() }
        configuration.preferences.isElementFullscreenEnabled = true
        return makeWebView(configuration: configuration)
    }
    private func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self; view.uiDelegate = self; view.allowsBackForwardNavigationGestures = true; view.translatesAutoresizingMaskIntoConstraints = false
        documentURLObservers[ObjectIdentifier(view)] = view.observe(\.url, options: [.new]) { [weak self] view, _ in
            Task { @MainActor [weak self, weak view] in
                guard let self, let view, let i = self.index(for: view) else { return }
                let id = self.tabs[i].id, value = view.url?.absoluteString ?? ""
                guard self.observedDocumentURLs[id] != value else { return }
                self.observedDocumentURLs[id] = value
                self.documentGenerations[id] = (self.documentGenerations[id] ?? 0) + 1
                // Same-document pushState/fragment changes do not necessarily start a navigation.
                // They still revoke the selected document, even when URL was not a selected field.
                self.pageSelections.invalidate(tabID: id)
                if self.pendingTargets[id] == nil, !view.isLoading,
                   let url = view.url, BrowserOmnibox.isNavigable(url) {
                    self.tabs[i].url = value; self.persistTabs(); self.refreshChrome()
                }
            }
        }
        documentTitleObservers[ObjectIdentifier(view)] = view.observe(\.title, options: [.new]) { [weak self] view, _ in
            Task { @MainActor [weak self, weak view] in
                guard let self, let view, let i = self.index(for: view),
                      let url = view.url, let rawTitle = view.title else { return }
                let id = self.tabs[i].id, title = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !title.isEmpty, self.tabs[i].url == url.absoluteString,
                      self.pendingTargets[id] == nil, self.failedTargets[id] == nil,
                      !self.homeTabIDs.contains(id), self.tabs[i].title != title else { return }
                self.tabs[i].title = title
                if (self.coordinator ?? self).sessionPersistence.allowsRecording {
                    BrowserLocalProfile.refreshLatestVisitTitle(self.tabs[i], defaults: self.defaults)
                }
                self.persistTabs(); self.refreshChrome(); self.refreshLibrary(); self.updateHomeData()
            }
        }
        return view
    }
    private func openTab(url: URL, isPrivate: Bool) {
        guard BrowserOmnibox.isNavigable(url) else { return }
        let view = makeWebView(isPrivate: isPrivate)
        attachTab(view, pendingURL: url, isPrivate: isPrivate)
        view.load(URLRequest(url: url))
    }
    private func attachTab(_ view: WKWebView, pendingURL url: URL, isPrivate: Bool) {
        if !isPrivate { beginOrdinarySessionActivity() }
        let id = UUID()
        documentGenerations[id] = 0; pendingTargets[id] = url; webViews[id] = view
        tabs.append(TabRecord(id: id, url: url.absoluteString, title: url.host ?? "New Tab", isPrivate: isPrivate, crashed: false))
        persistTabs(); activate(id)
    }
    private func openHomeTab(isPrivate: Bool) {
        if !isPrivate { beginOrdinarySessionActivity() }
        let id = UUID(); homeTabIDs.insert(id); documentGenerations[id] = 0
        tabs.append(TabRecord(id: id, url: BrowserLocalProfile.homeURL, title: isPrivate ? "Private Window" : "New Tab", isPrivate: isPrivate, crashed: false))
        activate(id); persistTabs()
    }
    private func attachToPageHost(_ view: NSView) {
        for current in pageHost.subviews { current.removeFromSuperview() }
        view.translatesAutoresizingMaskIntoConstraints = false; pageHost.addSubview(view)
        NSLayoutConstraint.activate([view.leadingAnchor.constraint(equalTo: pageHost.leadingAnchor), view.trailingAnchor.constraint(equalTo: pageHost.trailingAnchor), view.topAnchor.constraint(equalTo: pageHost.topAnchor), view.bottomAnchor.constraint(equalTo: pageHost.bottomAnchor)])
    }
    private func activate(_ id: UUID) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        activeID = id; showingLibrary = false; renderActivePage(); refreshChrome()
    }
    private func renderActivePage() {
        guard let id = activeID, let tab = tabs.first(where: { $0.id == id }) else { return }
        if showingLibrary { attachToPageHost(libraryPanel); return }
        if homeTabIDs.contains(id) || pendingTargets[id] != nil || failedTargets[id] != nil {
            updateHomeData(); attachToPageHost(homeView); selectSidebar("home")
            if let failure = failedTargets[id] {
                homeView.updateNavigationFeedback(title: "Unable to connect", detail: failure + " No other search engine or network was used.", isLoading: false)
            } else if let pending = pendingTargets[id] {
                homeView.updateNavigationFeedback(title: "Connecting to " + (pending.host ?? "page"), detail: pending.absoluteString, isLoading: true)
            } else { homeView.clearNavigationFeedback() }
        } else if let view = webViews[id] { attachToPageHost(view); selectSidebar("") }
        if let failure = failedTargets[id] { security.stringValue = failure }
        else if tab.isPrivate { security.stringValue = "Private · local records are not saved · direct IP is not hidden" }
        else if let pending = pendingTargets[id] { security.stringValue = "Connecting to \(pending.host ?? "page")…" }
        else if !homeTabIDs.contains(id), let view = webViews[id], let url = view.url {
            security.stringValue = view.isLoading ? "Loading \(url.host ?? "page")…" : connectionDescription(for: id, url: url)
        } else { security.stringValue = "\(providerDisplayName) search · Standard direct connection" }
    }
    private func refreshChrome() {
        refreshSearchPresentation()
        guard let id = activeID, let tab = tabs.first(where: { $0.id == id }) else { return }
        address.stringValue = pendingTargets[id]?.absoluteString ?? (homeTabIDs.contains(id) ? "" : tab.url)
        backButton?.isEnabled = webViews[id]?.canGoBack ?? false
        forwardButton?.isEnabled = webViews[id]?.canGoForward ?? false
        for view in tabStrip.arrangedSubviews { tabStrip.removeArrangedSubview(view); view.removeFromSuperview() }
        for item in tabs {
            let title = pendingTargets[item.id].map { (failedTargets[item.id] == nil ? "Connecting · " : "Connection failed · ") + ($0.host ?? "page") } ?? item.title
            let value = TabButton(title: (item.isPrivate ? "Private · " : "") + String(title.prefix(28)), target: self, action: #selector(selectTab(_:)))
            value.tabID = item.id; value.isBordered = false; value.alignment = .left; value.font = .systemFont(ofSize: 12, weight: .medium); value.contentTintColor = BrowserChromeTheme.text
            value.setAccessibilityLabel("\(item.isPrivate ? "Private " : "")tab \(title)")
            let close = TabCloseButton(image: BrowserChromeTheme.symbol("xmark", size: 11), target: self, action: #selector(closeSpecifiedTab(_:))); close.tabID = item.id; close.isBordered = false; close.contentTintColor = BrowserChromeTheme.secondary; close.setAccessibilityLabel("Close tab \(title)")
            let pill = NSStackView(views: [value, close]); pill.orientation = .horizontal; pill.spacing = 8; pill.edgeInsets = NSEdgeInsets(top: 7, left: 12, bottom: 7, right: 10); pill.wantsLayer = true
            BrowserChromeTheme.paint(pill, background: item.id == id ? BrowserChromeTheme.elevated : BrowserChromeTheme.surface); pill.layer?.cornerRadius = 10
            pill.widthAnchor.constraint(equalToConstant: 205).isActive = true; close.widthAnchor.constraint(equalToConstant: 18).isActive = true; tabStrip.addArrangedSubview(pill)
        }
    }
    private func openOrdinarySessionWindows() -> [[TabRecord]] {
        let root = coordinator ?? self
        return ([root] + root.ownedWindows).filter { !$0.isPrivateWindow && !$0.closedWindow }.map { $0.tabs }
    }
    private func beginOrdinarySessionActivity() {
        guard !isPrivateWindow else { return }
        let root = coordinator ?? self
        root.sessionPersistence.beginOrdinarySession()
    }
    private func persistTabs() {
        guard !isPrivateWindow else { return }
        let root = coordinator ?? self
        if let records = root.sessionPersistence.update(openOrdinaryWindows: openOrdinarySessionWindows()) {
            BrowserLocalProfile.persistTabs(records, defaults: root.defaults)
        }
    }
    private func restoreTabs() {
        for tab in BrowserLocalProfile.restoreBrowserSession(defaults: defaults) {
            if tab.url == BrowserLocalProfile.homeURL {
                homeTabIDs.insert(tab.id); documentGenerations[tab.id] = 0; tabs.append(tab); continue
            }
            guard let url = URL(string: tab.url), BrowserOmnibox.isNavigable(url) else { continue }
            let view = makeWebView(isPrivate: false)
            webViews[tab.id] = view; documentGenerations[tab.id] = 0; pendingTargets[tab.id] = url; tabs.append(tab); view.load(URLRequest(url: url))
        }
    }
    private func activeWebView() -> WKWebView? { guard let id = activeID else { return nil }; return webViews[id] }
    private func index(for view: WKWebView) -> Int? { guard let id = webViews.first(where: { $0.value === view })?.key else { return nil }; return tabs.firstIndex(where: { $0.id == id }) }
    private func markDownloadNavigation(_ view: WKWebView) {
        guard let i = index(for: view), let navigation = activeNavigationIDs[tabs[i].id] else { return }
        downloadNavigationIDs[tabs[i].id] = navigation
    }
    private func restorePageAfterDownloadConversion(_ view: WKWebView) {
        guard let i = index(for: view) else { return }
        let id = tabs[i].id
        guard let expected = downloadNavigationIDs[id], activeNavigationIDs[id] == expected else { return }
        pendingTargets.removeValue(forKey: id); failedTargets.removeValue(forKey: id)
        if let current = view.backForwardList.currentItem?.url, BrowserOmnibox.isNavigable(current) {
            tabs[i].url = current.absoluteString; homeTabIDs.remove(id)
        } else {
            tabs[i].url = BrowserLocalProfile.homeURL; tabs[i].title = "New Tab"; homeTabIDs.insert(id)
        }
        persistTabs()
        if activeID == id { renderActivePage(); refreshChrome() }
    }
    private func navigate(_ input: String) {
        do {
            let target = try BrowserOmnibox.resolveOmnibox(input, provider: searchProvider)
            if target.host == searchProvider.destinationHost { security.stringValue = "Search terms are sent to \(searchProvider.destinationHost). Change provider in YNX Browser menu." }
            beginOrdinarySessionActivity(); navigateTab(target)
        } catch { security.stringValue = "Address rejected. Enter a valid HTTP(S) URL or ordinary search words." }
    }
    private func navigateTab(_ target: URL) {
        guard window.isKeyWindow else { return }
        guard BrowserOmnibox.isNavigable(target) else { return }
        security.stringValue = "Loading \(target.host ?? "page")…"
        guard let id = activeID, let i = tabs.firstIndex(where: { $0.id == id }) else { return }
        let view = webViews[id] ?? makeWebView(isPrivate: tabs[i].isPrivate)
        webViews[id] = view; homeTabIDs.remove(id); pendingTargets[id] = target; failedTargets.removeValue(forKey: id); showingLibrary = false
        address.stringValue = target.absoluteString; renderActivePage(); refreshChrome()
        view.load(URLRequest(url: target))
    }
    @objc private func submitAddress() {
        navigate(address.stringValue)
        if let view = activeWebView(), view.window === window { window.makeFirstResponder(view) }
        else { window.makeFirstResponder(nil) }
    }
    @objc private func focusAddress() { guard window.isKeyWindow else { return }; window.makeFirstResponder(address); address.selectText(nil) }
    @objc private func showOrdinaryWindow() {
        let root = coordinator ?? self
        if !root.closedWindow { root.window.makeKeyAndOrderFront(nil) }
        else if let visible = root.ownedWindows.first(where: { !$0.isPrivateWindow && !$0.closedWindow }) { visible.window.makeKeyAndOrderFront(nil) }
        else { root.newOrdinaryWindow() }
    }
    @objc private func newOrdinaryWindow() { createWindow(privateMode: false) }
    private func createWindow(privateMode: Bool) {
        let root = coordinator ?? self
        let child = BrowserController(privateWindow: privateMode, coordinator: root)
        root.ownedWindows.append(child)
        child.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
    }
    private func retireWindowWebContent() {
        launchFrameGuard?.invalidate(); launchFrameGuard = nil
        documentURLObservers.removeAll(); documentTitleObservers.removeAll(); observedDocumentURLs.removeAll()
        for view in webViews.values {
            view.navigationDelegate = nil; view.uiDelegate = nil
            view.stopLoading(); view.removeFromSuperview()
        }
        // The controller retains its closed NSWindow; leaving a WKWebView in pageHost would
        // retain its document/network tasks even after the tab dictionary was cleared.
        for child in pageHost.subviews { child.removeFromSuperview() }
        webViews.removeAll(); homeViews.removeAll(); privateStore = nil; pageResponses.removeAll()
    }
    func windowWillClose(_ notification: Notification) {
        let root = coordinator ?? self
        guard !root.terminatingApp else { return }
        closedWindow = true; closeOwnedDownloads(); selectionReviewGeneration &+= 1; pageSelections.removeAll(); selectedSources.removeAll()
        originalPagesProducer?.close(); originalPagesProducer = nil
        retireWindowWebContent()
        if !isPrivateWindow, let records = root.sessionPersistence.windowClosed(
            tabs: tabs, isPrivate: false, survivingOrdinaryWindows: openOrdinarySessionWindows()) {
            BrowserLocalProfile.persistTabs(records, defaults: root.defaults)
        }
        if coordinator != nil { root.ownedWindows.removeAll { $0 === self } }
    }
    @objc private func newTorRouteWindow() { openRoutedWindow(mode: .tor) }
    @objc private func newNymRouteWindow() { openRoutedWindow(mode: .nym) }
    private func openRoutedWindow(mode: PrivacyRouteMode) {
        Task { @MainActor [weak self] in
            do { try await BrowserRoutedApplicationLauncher.launch(mode) }
            catch {
                self?.auditLogger.error("routed_launch_rejected error=\(String(describing: error), privacy: .public)")
                self?.showBoundary(title: "\(mode.rawValue) · 已阻断", message: "独立路由应用尚未通过安装校验。未启动路线，也未转交网址。")
            }
        }
    }
    @objc private func setSearchProvider() {
        let alert = NSAlert(); alert.messageText = "Search Provider"
        alert.informativeText = "Ordinary searches send your words to this HTTPS provider. Use one {query} query value. Bookmarks and history are never added to searches."
        let field = NSTextField(string: searchProvider.template); field.frame = NSRect(x: 0, y: 0, width: 480, height: 24); alert.accessoryView = field
        alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel"); alert.addButton(withTitle: "Use DuckDuckGo")
        let result = alert.runModal(); guard result != .alertSecondButtonReturn else { return }
        do {
            let provider = result == .alertThirdButtonReturn ? BrowserSearchProvider.duckDuckGo : try BrowserSearchProvider(name: "Custom", template: field.stringValue)
            defaults.set(try JSONEncoder().encode(provider), forKey: "ordinarySearchProvider")
            let root = coordinator ?? self
            for controller in [root] + root.ownedWindows { controller.refreshSearchPresentation() }
            security.stringValue = "Search destination: \(provider.destinationHost)"
        } catch { showBoundary(title: "Invalid search provider", message: "Use an HTTPS URL with exactly one query parameter whose full value is {query}. Credentials and fragments are not allowed.") }
    }
    private func refreshSearchPresentation() {
        let label = "Search \(providerDisplayName) or enter URL"
        address.placeholderAttributedString = NSAttributedString(string: label, attributes: [.foregroundColor: BrowserChromeTheme.muted])
        address.setAccessibilityLabel("Address or \(providerDisplayName) search query")
        for view in homeViews.values { view.updateSearchProvider(name: providerDisplayName, host: searchProvider.destinationHost) }
    }
    @objc private func useLightTheme() { setAppearance("light") }
    @objc private func useDarkTheme() { setAppearance("dark") }
    private func setAppearance(_ value: String) {
        let root = coordinator ?? self
        root.defaults.set(value, forKey: "appearanceMode")
        let appearance = NSAppearance(named: value == "dark" ? .darkAqua : .aqua)
        NSApp.appearance = appearance
        for controller in [root] + root.ownedWindows { controller.window?.appearance = appearance }
        BrowserChromeTheme.refreshAll(); buildMenu()
    }

    private func refreshLibrary() {
        for view in libraryList.arrangedSubviews { libraryList.removeArrangedSubview(view); view.removeFromSuperview() }
        if selectedLibrary == "downloads" { refreshDownloadsList(); return }
        let values: [(String,String)]
        if isPrivateWindow && selectedLibrary != "bookmarks" {
            let empty = BrowserChromeTheme.label("Private window records are not saved.", size: 13, color: BrowserChromeTheme.secondary)
            libraryList.addArrangedSubview(empty); return
        }
        switch selectedLibrary {
        case "bookmarks": values = (defaults.array(forKey: "bookmarks") as? [[String:String]] ?? []).prefix(30).map { ($0["title"] ?? "Untitled", $0["url"] ?? "") }
        case "permissions": values = ((try? JSONDecoder().decode([PermissionRecord].self, from: defaults.data(forKey: "permissions") ?? Data())) ?? []).prefix(30).map { ("\($0.permission) · \($0.decision)", $0.origin) }
        default: values = ((try? JSONDecoder().decode([VisitRecord].self, from: defaults.data(forKey: "history") ?? Data())) ?? []).prefix(30).map { ($0.title, $0.url) }
        }
        if values.isEmpty { let empty = NSTextField(wrappingLabelWithString: "Nothing here yet."); empty.textColor = .tertiaryLabelColor; empty.font = .systemFont(ofSize: 12); libraryList.addArrangedSubview(empty) }
        for (title, detail) in values {
            let titleView: NSView
            if ["bookmarks", "history"].contains(selectedLibrary) {
                let link = LibraryPageButton(title: String(title.prefix(30)), target: self, action: #selector(openLibraryPage(_:)))
                link.pageURL = detail; link.bezelStyle = .recessed; link.alignment = .left
                link.setAccessibilityLabel("Open \(title)"); titleView = link
            } else { titleView = NSTextField(labelWithString: String(title.prefix(30))) }
            let detailField = NSTextField(labelWithString: String(detail.prefix(40))); detailField.font = .systemFont(ofSize: 10); detailField.textColor = .secondaryLabelColor
            let item = NSStackView(views: [titleView, detailField]); item.orientation = .vertical; item.alignment = .leading; item.spacing = 1; libraryList.addArrangedSubview(item)
        }
    }
    private func refreshDownloadsList() {
        let activities = downloadActivities.filter { activity in
            activity.isPrivate == isPrivateWindow && (isPrivateWindow || activity.phase != .completed)
        }
        for activity in activities {
            let name = BrowserChromeTheme.label(String(activity.title.prefix(80)), size: 13, weight: .medium)
            let status = BrowserChromeTheme.label(activity.status, size: 12, color: BrowserChromeTheme.secondary)
            let text = NSStackView(views: [name, status]); text.orientation = .vertical; text.alignment = .leading; text.spacing = 3
            let row = NSStackView(views: [text]); row.orientation = .horizontal; row.alignment = .centerY; row.spacing = 16
            if activity.canCancel {
                let exactID = activity.id
                let cancel = BrowserChromeTextButton("Cancel", symbol: "xmark") { [weak self] in
                    guard let self, let key = self.activeDownloads.first(where: { $0.value.activity.id == exactID })?.key else { return }
                    self.cancelOwnedDownload(key, exactActivityID: exactID)
                }
                cancel.setAccessibilityLabel("Cancel download \(activity.title)")
                row.addArrangedSubview(cancel)
            } else if activity.canSaveAgain {
                let save = BrowserChromeTextButton("Save As…", symbol: "square.and.arrow.down") { [weak self, weak activity] in
                    guard let activity else { return }
                    self?.saveDownloadAgain(activity)
                }
                save.setAccessibilityLabel("Save download \(activity.title) again")
                row.addArrangedSubview(save)
            }
            libraryList.addArrangedSubview(row)
        }
        // Private activities are transient, confined to this window and never backed by
        // the ordinary profile's completed-download records.
        let records = isPrivateWindow ? [] : Array(BrowserDownloadPersistence.decodeRecords(
            from: defaults.data(forKey: BrowserDownloadPersistence.defaultsKey)).prefix(30))
        for record in records {
            let name = BrowserChromeTheme.label(String(record.filename.prefix(80)), size: 13, weight: .medium)
            let status = BrowserChromeTheme.label("Completed", size: 12, color: BrowserChromeTheme.secondary)
            let source = BrowserChromeTheme.label(String(record.source.prefix(90)), size: 11, color: BrowserChromeTheme.secondary)
            let row = NSStackView(views: [name, status, source]); row.orientation = .vertical; row.alignment = .leading; row.spacing = 3
            libraryList.addArrangedSubview(row)
        }
        if activities.isEmpty && records.isEmpty {
            libraryList.addArrangedSubview(BrowserChromeTheme.label(isPrivateWindow
                ? "Downloads in this private window appear here temporarily. No download history is saved."
                : "No downloads yet.", size: 13, color: BrowserChromeTheme.secondary))
        }
    }
    private func refreshDownloadActivityList() {
        guard !closedWindow, !terminatingApp else { return }
        // Retain all in-flight activities and only the latest 30 terminal rows.
        var terminalCount = 0
        downloadActivities = downloadActivities.filter { activity in
            if !activity.isTerminal { return true }
            terminalCount += 1
            if terminalCount > 30, downloadRecoveryPanels[activity.id] == nil {
                activity.discardSaveRecovery()
                return false
            }
            return true
        }
        if showingLibrary && selectedLibrary == "downloads" { refreshLibrary() }
    }
    @objc private func openLibraryPage(_ sender: LibraryPageButton) { navigate(sender.pageURL) }
    private func selectLibrary(_ value: String, title: String, boundary: String) { selectedLibrary = value; libraryTitle.stringValue = title; libraryBoundary.stringValue = boundary; showingLibrary = true; refreshLibrary(); selectSidebar(value); if libraryPanel != nil { attachToPageHost(libraryPanel) } }

    func controlTextDidEndEditing(_ obj: Notification) { /* Only Return submits; leaving the address field does not navigate. */ }
    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField, field === address else { return }
        if field.stringValue.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) == nil {
            security.stringValue = "Search sends your words to \(searchProvider.destinationHost). Change provider in YNX Browser menu."
        }
    }
    @objc private func goBack() { guard window.isKeyWindow, activeWebView()?.canGoBack == true else { return }; beginOrdinarySessionActivity(); activeWebView()?.goBack() }
    @objc private func goForward() { guard window.isKeyWindow, activeWebView()?.canGoForward == true else { return }; beginOrdinarySessionActivity(); activeWebView()?.goForward() }
    @objc private func reload() {
        guard window.isKeyWindow, let id = activeID else { return }
        if let target = pendingTargets[id] { beginOrdinarySessionActivity(); navigateTab(target) }
        else if let url = webViews[id]?.url { beginOrdinarySessionActivity(); navigateTab(url) }
        else { homeView.focusSearch() }
    }
    @objc private func saveDownload() {
        guard window.isKeyWindow else { return }
        guard let id = activeID, pageDocument(for: id) != nil else {
            showBoundary(title: "Page unavailable", message: "Wait for the page to finish loading before saving it."); return
        }
        guard let view = activeWebView(), let url = view.url, BrowserOmnibox.isNavigable(url), let i = index(for: view) else { return }
        let context = BrowserDownloadContext(source: url.absoluteString, isPrivate: tabs[i].isPrivate)
        view.startDownload(using: URLRequest(url: url)) { [weak self] download in
            guard let self, !self.closedWindow, !self.terminatingApp else { download.cancel { _ in }; return }
            self.registerDownload(download, context: context)
        }
    }
    private func saveDownloadAgain(_ activity: BrowserDownloadActivity) {
        guard !closedWindow, !terminatingApp, !isPrivateWindow, activity.canSaveAgain,
              downloadRecoveryPanels[activity.id] == nil else { return }
        let panel = NSSavePanel()
        panel.preventsApplicationTerminationWhenModal = false
        panel.nameFieldStringValue = activity.title
        downloadRecoveryPanels[activity.id] = panel
        panel.beginSheetModal(for: window) { [weak self, weak activity] result in
            guard let self, let activity, !self.closedWindow, !self.terminatingApp,
                  self.downloadRecoveryPanels[activity.id] === panel else { return }
            self.downloadRecoveryPanels.removeValue(forKey: activity.id)
            if result == .OK, let destination = panel.url {
                let saved = activity.saveAgain(to: destination, defaults: self.defaults)
                self.security.stringValue = saved ? "Download completed to the user-selected file." : "Could not save the download to that location."
            }
            self.refreshDownloadActivityList()
        }
    }
    @objc private func newTabAction() { guard window.isKeyWindow else { return }; openHomeTab(isPrivate: isPrivateWindow) }
    @objc private func privateTabAction() { guard window.isKeyWindow else { return }; createWindow(privateMode: true) }
    @objc private func selectTab(_ sender: TabButton) { if let id = sender.tabID { activate(id) } }
    @objc private func closeSpecifiedTab(_ sender: TabCloseButton) { if let id = sender.tabID { closeTab(id) } }
    @objc private func closeTabAction() { guard window.isKeyWindow, let id = activeID else { return }; closeTab(id) }
    @objc private func closeWindowAction() { guard window.isKeyWindow, !closedWindow else { return }; window.performClose(nil) }
    private func closeTab(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let wasActive = activeID == id
        pageResponses.removeValue(forKey: id)
        pageSelections.invalidate(tabID: id); documentGenerations.removeValue(forKey: id); pendingTargets.removeValue(forKey: id); failedTargets.removeValue(forKey: id); activeNavigationIDs.removeValue(forKey: id); downloadNavigationIDs.removeValue(forKey: id); homeTabIDs.remove(id)
        if let view = webViews[id] {
            documentURLObservers.removeValue(forKey: ObjectIdentifier(view))
            documentTitleObservers.removeValue(forKey: ObjectIdentifier(view))
        }
        observedDocumentURLs.removeValue(forKey: id)
        webViews[id]?.stopLoading(); webViews[id]?.removeFromSuperview(); webViews.removeValue(forKey: id); tabs.remove(at: index)
        homeViews.removeValue(forKey: id)
        persistTabs()
        if wasActive {
            if tabs.isEmpty { openHomeTab(isPrivate: isPrivateWindow) }
            else { activate(tabs[min(index, tabs.count - 1)].id) }
        } else { refreshChrome() }
    }
    @objc private func bookmarkAction() {
        guard window.isKeyWindow else { return }
        guard let id = activeID, pageDocument(for: id) != nil else {
            showBoundary(title: "Page unavailable", message: "Wait for the page to finish loading before bookmarking it."); return
        }
        guard let tab = activeID.flatMap({ id in tabs.first(where: { $0.id == id }) }), let canonical = BrowserLocalProfile.canonicalBookmarkURL(tab.url) else { return }
        if tab.isPrivate {
            let alert = NSAlert(); alert.messageText = "Save this private page as a bookmark?"
            alert.informativeText = "This explicitly saves the page title and URL in your ordinary profile, where they remain after the private tab is closed."
            alert.addButton(withTitle: "Save Bookmark"); alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        let values = defaults.array(forKey: "bookmarks") as? [[String: String]] ?? []
        let exists = values.contains { BrowserLocalProfile.canonicalBookmarkURL($0["url"] ?? "") == canonical }
        BrowserLocalProfile.updateBookmark(defaults: defaults, url: canonical, title: tab.title, remove: exists && !tab.isPrivate)
        selectLibrary("bookmarks", title: "Bookmarks", boundary: "Bookmarks remain on this Mac. Click the star again to remove the current bookmark.")
    }
    @objc private func showHistory() { selectLibrary("history", title: "History", boundary: "History is stored on this Mac. Private tabs never appear here.") }
    @objc private func showBookmarks() { selectLibrary("bookmarks", title: "Bookmarks", boundary: "Bookmarks sync is not configured; records remain on this Mac.") }
    @objc private func showDownloads() { selectLibrary("downloads", title: "Downloads", boundary: "Downloaded files may remain outside YNX even after browser data is cleared.") }
    @objc private func showPermissions() { selectLibrary("permissions", title: "Site permissions", boundary: "Decisions are bound to an exact origin. Private decisions are never saved.") }
    @objc private func showSecurity() {
        let target = activeID.flatMap { pendingTargets[$0] }
        let url = target ?? activeWebView()?.url
        let origin = url.flatMap { BrowserPageSelectionStore.canonicalOrigin($0.absoluteString) } ?? "No origin"
        let transport = target != nil ? "This connection has not completed. No verified page identity is shown." : url?.scheme == "https" ? "HTTPS transport; WebKit applies system certificate trust." : "Not HTTPS; transport is not encrypted."
        showBoundary(title: origin, message: "\(transport)\n\nThe requested host and the currently verified page are kept separate while loading.")
    }
    private func pageDocument(for id: UUID) -> BrowserPageDocument? {
        guard !homeTabIDs.contains(id), pendingTargets[id] == nil, failedTargets[id] == nil else { return nil }
        guard let tab = tabs.first(where: { $0.id == id }), let url = webViews[id]?.url,
              !tab.crashed, BrowserOmnibox.isNavigable(url), !webViews[id]!.isLoading else { return nil }
        let origin = BrowserPageSelectionStore.canonicalOrigin(url.absoluteString) ?? ""
        return BrowserPageDocument(tabID: id, profileID: environment["YNX_BROWSER_PROFILE_SUITE"] ?? "ordinary", generation: documentGenerations[id] ?? 0, origin: origin, isPrivate: tab.isPrivate)
    }
    private func extractPage(_ view: WKWebView, fields: [String]) async throws -> BrowserPageContent {
        let fieldData = try JSONSerialization.data(withJSONObject: fields)
        let fieldJSON = String(decoding: fieldData, as: UTF8.self)
        return try await withCheckedThrowingContinuation { continuation in
            view.evaluateJavaScript("(\(BrowserPageSelectionStore.extractionScript))(\(fieldJSON))", in: nil, in: .defaultClient) { result in
                switch result {
                case .failure(let error): continuation.resume(throwing: error)
                case .success(let value):
                    guard let data = value as? [String: String], let url = data["url"], let title = data["title"], let text = data["text"] else { continuation.resume(throwing: BrowserOmniboxError.invalidURL); return }
                    continuation.resume(returning: BrowserPageContent(url: url, title: title, text: text))
                }
            }
        }
    }
    @objc private func aiPageAction() {
        guard window.isKeyWindow else { return }
        guard let id = activeID, let document = pageDocument(for: id), let view = webViews[id] else {
            showBoundary(title: "Page unavailable", message: "Open a page and wait for it to finish loading before selecting it."); return
        }
        guard !document.isPrivate else { showBoundary(title: "Private page", message: "Private pages cannot be selected for a task. Ordinary browsing remains available."); return }
        let alert = NSAlert(); alert.messageText = "Select this page"
        alert.informativeText = "Page: \(view.title ?? document.origin)\nOrigin: \(document.origin)\n\nChoose fields for a local snapshot. Nothing is sent to a provider. Hidden content, forms and subframes are excluded. Navigation requires a new selection.\n\nTo prepare pages for an existing AI task, enter its task reference before selecting. Changing the reference clears the previous selections. Access is checked separately by AI."
        let title = NSButton(checkboxWithTitle: "Page title", target: nil, action: nil); title.state = .on
        let url = NSButton(checkboxWithTitle: "Page URL (including query)", target: nil, action: nil); url.state = .on
        let text = NSButton(checkboxWithTitle: "Visible page text", target: nil, action: nil); text.state = .on
        let taskReference = NSTextField(string: selectedPageTaskID ?? "")
        taskReference.placeholderString = "Task reference (optional; blank keeps pages local)"
        taskReference.setAccessibilityLabel("Selected pages task reference")
        taskReference.widthAnchor.constraint(equalToConstant: 440).isActive = true
        let choices = NSStackView(views: [title, url, text, taskReference]); choices.orientation = .vertical; choices.alignment = .leading; choices.frame = NSRect(x: 0, y: 0, width: 440, height: 114); alert.accessoryView = choices
        alert.addButton(withTitle: "Select Page"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let fields = [("title", title), ("url", url), ("text", text)].filter { $0.1.state == .on }.map { $0.0 }
        guard !fields.isEmpty else { return }
        let requestedReference = taskReference.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard requestedReference.utf8.count <= 1024, !requestedReference.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            showBoundary(title: "Invalid task reference", message: "Use the reference shown by the existing AI task, or leave it blank to keep pages local."); return
        }
        let requestedTask = requestedReference.isEmpty ? localPageSetID : requestedReference
        selectionReviewGeneration &+= 1
        let selectionOperation = selectionReviewGeneration
        Task { @MainActor in
            do {
                let content = try await extractPage(view, fields: fields)
                guard !closedWindow, selectionReviewGeneration == selectionOperation else { return }
                guard pageDocument(for: id) == document else { security.stringValue = "Page changed. Select it again."; return }
                if !requestedTask.utf8.elementsEqual(pageSelectionTaskID.utf8) {
                    pageSelections.removeAll(); selectedSources.removeAll()
                    selectedPageTaskID = requestedReference.isEmpty ? nil : requestedReference
                }
                pageSelections.invalidate(tabID: id)
                let sources = try pageSelections.selectPages([BrowserPageConfirmation(document: document, taskID: requestedTask, allowedFields: fields, content: content, confirmed: true)])
                selectedSources.removeAll { $0.document.tabID == id }; selectedSources.append(contentsOf: sources)
                security.stringValue = "\(selectedSources.count) page(s) selected locally. Review in Navigate menu. No content has been sent."
            } catch { security.stringValue = "Page selection failed: \(error.localizedDescription)" }
        }
    }
    /// Local producer read port. The original task authority must independently authorize
    /// the AI task/profile and disclosure before it can consume this detached readout.
    private func readSelectedPageBatch(_ sources: [BrowserPageSource]) async throws -> BrowserPageReadBatch {
        guard !closedWindow, !isPrivateWindow else { throw BrowserPageSelectionError.denied }
        let selectedTask = pageSelectionTaskID
        let batch = try await pageSelections.readSelectedPageBatch(sources,
            taskID: selectedTask, profileID: environment["YNX_BROWSER_PROFILE_SUITE"] ?? "ordinary",
            currentDocument: { [self] id in pageDocument(for: id) },
            extract: { [self] source in
                guard !closedWindow, let view = webViews[source.document.tabID],
                      pageDocument(for: source.document.tabID) == source.document else { throw BrowserPageSelectionError.unavailable }
                return try await extractPage(view, fields: source.fields)
            })
        guard !closedWindow, !isPrivateWindow, pageSelectionTaskID.utf8.elementsEqual(selectedTask.utf8) else { throw BrowserPageSelectionError.denied }
        return batch
    }
    @objc private func reviewSelectedPages() {
        guard window.isKeyWindow else { return }
        guard !selectedSources.isEmpty else { showBoundary(title: "Selected pages", message: "No pages selected."); return }
        selectionReviewGeneration &+= 1; let expected = selectionReviewGeneration
        Task { @MainActor in
            var results: [String] = []
            do {
                let batch = try await readSelectedPageBatch(selectedSources)
                guard !closedWindow, selectionReviewGeneration == expected else { return }
                for result in batch.pages {
                    let source = result.source
                    if let bytes = result.snapshotBytes {
                        let values = try BrowserPageSelectionStore.previewFields(bytes, source: source)
                        let labels = ["url": "Page URL", "title": "Page title", "text": "Visible page text"]
                        let fields = source.fields.map { "\(labels[$0] ?? $0):\n\(values[$0] ?? "")" }.joined(separator: "\n\n")
                        results.append("\(source.document.origin) · AVAILABLE · \(bytes.count) bytes\n\(fields)")
                    } else {
                        results.append("\(source.document.origin) · \(result.state.rawValue) · select this page again")
                    }
                }
            } catch let error as BrowserPageSelectionError {
                results = ["Selected pages · \(error.rawValue) · no page content was released"]
            } catch {
                results = ["Selected pages · UNAVAILABLE · no page content was released"]
            }
            guard !closedWindow, selectionReviewGeneration == expected else { return }
            let alert = NSAlert(); alert.messageText = "Selected pages · human review"
            alert.informativeText = "Only the fields you selected are shown. These frozen snapshots stay on this Mac. No provider or Agent has received them."
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 720, height: 420))
            scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = false; scroll.borderType = .bezelBorder
            let text = NSTextView(frame: scroll.bounds); text.isEditable = false; text.isSelectable = true
            text.font = .systemFont(ofSize: 13); text.textContainerInset = NSSize(width: 12, height: 12)
            text.isHorizontallyResizable = false; text.isVerticallyResizable = true; text.autoresizingMask = [.width]
            text.textContainer?.widthTracksTextView = true
            text.string = results.isEmpty ? "No pages selected." : results.joined(separator: "\n\n────────────────────────\n\n")
            text.setAccessibilityLabel("Selected page snapshots"); scroll.documentView = text; alert.accessoryView = scroll
            alert.addButton(withTitle: "Close"); alert.runModal()
        }
    }
    @objc private func clearSelectedPages() {
        guard window.isKeyWindow else { return }
        selectionReviewGeneration &+= 1; pageSelections.removeAll(); selectedSources.removeAll(); selectedPageTaskID = nil
        security.stringValue = "Local page selections cleared. Browsing, bookmarks and downloaded files remain."
    }
    @objc private func startWalletSignIn() {
        guard window.isKeyWindow else { return }
        guard let tab = activeID.flatMap({ id in tabs.first(where: { $0.id == id }) }), !tab.isPrivate else {
            showBoundary(title: "Wallet unavailable in Private", message: "A separate private-session Wallet contract is not configured. Ordinary private browsing can continue.")
            return
        }
        do {
            let issued = Date()
            let expires = issued.addingTimeInterval(300)
            let nonce = try randomToken(32)
            let signingKey = try deviceSigningKey()
            let publicKey = try devicePublicKey(signingKey)
            let bindings = BrowserWalletCallbackBindings.macOS
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let request: [String: Any] = [
                "version": "1",
                "nonce": nonce,
                "chainId": bindings.chainId,
                "requestingProduct": bindings.requestingProduct,
                "productClientId": bindings.productClientId,
                "bundleId": bindings.bundleId,
                "productDeviceAlgorithm": bindings.productDeviceAlgorithm,
                "productDeviceKey": publicKey,
                "callback": bindings.callback,
                "scopes": bindings.orderedScopes,
                "purpose": "Sign in to YNX Browser",
                "issuedAt": formatter.string(from: issued),
                "expiresAt": formatter.string(from: expires)
            ]
            let data = try JSONSerialization.data(withJSONObject: request)
            var components = URLComponents()
            components.scheme = "ynxwallet"
            components.host = "authorize"
            components.queryItems = [URLQueryItem(name: "request", value: data.base64URLEncodedString())]
            guard let link = components.url else {
                throw NSError(domain: "YNXBrowser", code: 1, userInfo: [NSLocalizedDescriptionKey: "Wallet link creation failed"])
            }
            try BrowserWalletCallbackPolicy.persistPending(
                nonce: nonce,
                expiresAt: expires,
                defaults: defaults,
                signingKey: signingKey,
                bindings: bindings
            )
            auditLogger.notice("wallet_request_pending code=BR-WALLET-REQUEST-PENDING")
            if !NSWorkspace.shared.open(link) {
                BrowserWalletCallbackPolicy.clearPending(defaults: defaults)
                auditLogger.error("wallet_request_open_failed code=BR-WALLET-REQUEST-APP-UNAVAILABLE")
                security.stringValue = "YNX Wallet is unavailable. No session was created."
            }
        } catch {
            BrowserWalletCallbackPolicy.clearPending(defaults: defaults)
            auditLogger.error("wallet_request_failed code=BR-WALLET-REQUEST-INTERNAL")
            security.stringValue = "Wallet request failed. No session was created."
        }
    }
    @objc private func showAbout() { showBoundary(title: "YNX Browser · Testnet Preview", message: "Engine: Apple WebKit (WKWebView)\nOrdinary search: \(searchProvider.name) (\(searchProvider.destinationHost))\nPrivacy: no claim of perfect privacy\nSigning: the browser never signs; YNX Wallet performs final review.") }
    @objc private func clearData() {
        let alert = NSAlert()
        alert.messageText = "Clear browsing data?"
        alert.informativeText = isPrivateWindow ? "Only this private window's temporary cookies and pages are cleared. Ordinary history, accounts and downloads remain." : "Cookies, cache, history, permissions, recovery state and any pending Wallet review are cleared. Bookmarks and downloaded files remain."
        alert.addButton(withTitle: "Clear")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        selectionReviewGeneration &+= 1; pageSelections.removeAll(); selectedSources.removeAll()
        if isPrivateWindow {
            privateStore?.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
            retireWindowWebContent()
            tabs.removeAll(); homeTabIDs.removeAll(); pendingTargets.removeAll(); failedTargets.removeAll()
            openHomeTab(isPrivate: true); return
        }
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        defaults.removeObject(forKey: "history")
        defaults.removeObject(forKey: "permissions")
        let root = coordinator ?? self
        _ = root.sessionPersistence.clear()
        defaults.removeObject(forKey: "tabs")
        BrowserWalletCallbackPolicy.clearPending(defaults: defaults)
        auditLogger.notice("local_data_cleared code=BR-DATA-CLEAR")
        security.stringValue = "Local browsing data and pending Wallet review cleared. Bookmarks and downloaded files remain."
        refreshLibrary(); updateHomeData()
    }
    @objc private func checkUpdates() { showBoundary(title:"Signed update boundary",message:"No signed update feed is configured. Web pages and AI output cannot replace this app. Install only a signed and notarized application bundle from the reviewed release channel.") }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if ["ynxwallet", "ynx-wallet"].contains(url.scheme?.lowercased() ?? "") { decisionHandler(.cancel); reviewWalletURL(url, initiatingOrigin: navigationAction.sourceFrame.securityOrigin); return }
        if navigationAction.shouldPerformDownload, navigationAction.sourceFrame.isMainFrame,
           BrowserOmnibox.isSameOriginBlobDownload(url, documentURL: webView.url) { markDownloadNavigation(webView); decisionHandler(.download); return }
        let sandboxedSubframe = navigationAction.targetFrame?.isMainFrame == false && ["about", "data", "blob"].contains(url.scheme?.lowercased() ?? "")
        guard BrowserOmnibox.isNavigable(url) || sandboxedSubframe else {
            decisionHandler(.cancel); security.stringValue = "Navigation rejected. Only HTTP(S) pages are supported."; return
        }
        let origin = "\(url.scheme ?? "")://\(url.host ?? "")"
        if phishingOrigins.contains(origin) { decisionHandler(.cancel); showBoundary(title: "Known-list warning", message: "This origin matches the configured operator blocklist. Navigation stopped. This list does not guarantee protection from other phishing sites."); return }
        if navigationAction.shouldPerformDownload {
            if navigationAction.targetFrame?.isMainFrame == true { markDownloadNavigation(webView) }
            decisionHandler(.download); return
        }
        if navigationAction.targetFrame?.isMainFrame == true, let i = index(for: webView) {
            let id = tabs[i].id; pageSelections.invalidate(tabID: id)
            pendingTargets[id] = url; failedTargets.removeValue(forKey: id); homeTabIDs.remove(id)
            if activeID == id { renderActivePage(); refreshChrome() }
        }
        if navigationAction.navigationType != .other { beginOrdinarySessionActivity() }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse,
           let url = response.url, let i = index(for: webView) { pageResponses[tabs[i].id] = (url, response.statusCode) }
        if !navigationResponse.canShowMIMEType, navigationResponse.isForMainFrame { markDownloadNavigation(webView) }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard let i = index(for: webView) else { return }
        let id = tabs[i].id
        downloadNavigationIDs.removeValue(forKey: id); pageResponses.removeValue(forKey: id)
        if let navigation { activeNavigationIDs[id] = ObjectIdentifier(navigation) }
        documentGenerations[id] = (documentGenerations[id] ?? 0) + 1
        pageSelections.invalidate(tabID: id)
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard let i = index(for: webView), let url = webView.url else { return }
        let id = tabs[i].id
        if let navigation, let expected = activeNavigationIDs[id], expected != ObjectIdentifier(navigation) { return }
        tabs[i].url = url.absoluteString; pendingTargets.removeValue(forKey: id); failedTargets.removeValue(forKey: id); homeTabIDs.remove(id)
        if activeID == id { renderActivePage(); refreshChrome() }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard !closedWindow, !terminatingApp, navigationAction.targetFrame == nil,
              let url = navigationAction.request.url, BrowserOmnibox.isNavigable(url),
              let i = index(for: webView),
              configuration.websiteDataStore === webView.configuration.websiteDataStore else { return nil }
        let view = makeWebView(configuration: configuration)
        attachTab(view, pendingURL: url, isPrivate: tabs[i].isPrivate)
        // WebKit loads the original navigation, including form method and body.
        return view
    }
    private func reviewWalletURL(_ url: URL, initiatingOrigin: WKSecurityOrigin) {
        do {
            let fields = try BrowserWalletReviewQuery.parse(url)
            let origin = "\(initiatingOrigin.protocol)://\(initiatingOrigin.host):\(initiatingOrigin.port)"
            let detail = ["Initiating frame origin: \(origin)",
                          "Claimed requester (unverified): \(fields["requestingProduct"] ?? "not supplied")",
                          "Claimed callback (unverified): \(fields["callback"] ?? "not supplied")",
                          "Scopes: \(fields["scopes"] ?? "must be reviewed in Wallet")",
                          "Recipient: \(fields["recipient"] ?? "not supplied")",
                          "YNXT amount: \(fields["amount"] ?? "not supplied")",
                          "Fee: \(fields["fee"] ?? "not supplied")",
                          "Contract data: \(fields["data"] ?? "not supplied")",
                          "Network: ynx_6423-1",
                          "Expiry: \(fields["expiresAt"] ?? "must be reviewed in Wallet")"].joined(separator: "\n")
            showBoundary(title: "Wallet signing review", message: "\(detail)\n\nThese URL fields are untrusted review data. Continue only after YNX Wallet verifies exact bindings. This browser never signs or reports a completed transaction.")
        } catch {
            showBoundary(title: "Wallet review rejected", message: "The request URL contains ambiguous, unsupported or unsafe review fields. Nothing was sent to Wallet.")
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let i = index(for: webView) else { return }
        let id = tabs[i].id
        if let navigation, let expected = activeNavigationIDs[id], expected != ObjectIdentifier(navigation) { return }
        pendingTargets.removeValue(forKey: id); failedTargets.removeValue(forKey: id); homeTabIDs.remove(id)
        tabs[i].url = webView.url?.absoluteString ?? tabs[i].url
        let title = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        tabs[i].title = title.isEmpty ? (webView.url?.host ?? "Untitled") : title; tabs[i].crashed = false
        if (coordinator ?? self).sessionPersistence.allowsRecording { BrowserLocalProfile.recordVisit(tabs[i], defaults: defaults) }
        persistTabs(); refreshChrome(); refreshLibrary(); updateHomeData()
        if activeID == id { renderActivePage() }
        if activeID == tabs[i].id { security.stringValue = tabs[i].isPrivate ? "Private · no YNX history, recovery, permission persistence or AI context" : webView.url.map { connectionDescription(for: id, url: $0) } ?? "Connection status unavailable" }
    }
    private func connectionDescription(for id: UUID, url: URL) -> String {
        let transport = url.scheme == "https" ? "HTTPS · WebKit system trust · certificate validity does not prove site identity" : "Not HTTPS · connection is not encrypted"
        if let response = pageResponses[id], response.url.absoluteString == url.absoluteString, response.status >= 400 {
            return "HTTP \(response.status) · \(url.host ?? "Site") refused this request. \(transport). No other search engine or route was used."
        }
        return transport
    }
    private func reportNavigationFailure(_ error: Error, from webView: WKWebView, navigation: WKNavigation?) {
        guard let i = index(for: webView) else { return }
        let id = tabs[i].id
        if let navigation, let expected = activeNavigationIDs[id], expected != ObjectIdentifier(navigation) { return }
        let failure = error as NSError
        // Only a conversion already acknowledged by this exact navigation can consume this
        // WebKit policy interruption. Genuine transport errors and other navigations still fail.
        if failure.domain == "WebKitErrorDomain", failure.code == 102,
           let navigation, downloadNavigationIDs[id] == ObjectIdentifier(navigation) { return }
        if failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled { return }
        if pendingTargets[id] == nil { pendingTargets[id] = webView.url }
        failedTargets[id] = error.localizedDescription
        pageSelections.invalidate(tabID: id)
        if activeID == id { showingLibrary = false; renderActivePage(); refreshChrome() }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { reportNavigationFailure(error, from: webView, navigation: navigation) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { reportNavigationFailure(error, from: webView, navigation: navigation) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let i = index(for: webView) else { return }
        let id = tabs[i].id
        pageSelections.invalidate(tabID: id); tabs[i].crashed = true
        pendingTargets[id] = pendingTargets[id] ?? webView.url
        failedTargets[id] = "The page process stopped. Press Reload to try again."
        persistTabs(); refreshChrome()
        if activeID == id { renderActivePage() }
    }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if let i = index(for: webView), tabs[i].id == activeID, !tabs[i].isPrivate {
            security.stringValue = challenge.protectionSpace.serverTrust == nil ? "Certificate trust unavailable" : "TLS certificate received · WebKit system trust evaluation applies"
        }
        completionHandler(.performDefaultHandling,nil)
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { let permission=type == .camera ? "camera" : type == .microphone ? "microphone" : "camera and microphone";let exactOrigin="\(origin.protocol)://\(origin.host):\(origin.port)";let alert=NSAlert();alert.messageText="Site permission";alert.informativeText="Allow \(permission) once for exact origin \(exactOrigin)? Persistent allow is not offered in this preview.";alert.addButton(withTitle:"Allow once");alert.addButton(withTitle:"Deny");let granted=alert.runModal() == .alertFirstButtonReturn;if let i=index(for:webView),!tabs[i].isPrivate{var values=(try? JSONDecoder().decode([PermissionRecord].self,from:defaults.data(forKey:"permissions") ?? Data())) ?? [];values.insert(PermissionRecord(origin:exactOrigin,permission:permission,decision:granted ? "allow-once" : "deny",decidedAt:Date()),at:0);if let data=try? JSONEncoder().encode(Array(values.prefix(500))){defaults.set(data,forKey:"permissions")};refreshLibrary()};decisionHandler(granted ? .grant : .deny) }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) { let panel=NSOpenPanel();panel.canChooseFiles=true;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.beginSheetModal(for:window){completionHandler($0 == .OK ? panel.urls : nil)} }
    private func registerDownload(_ download: WKDownload, context: BrowserDownloadContext) {
        let key = ObjectIdentifier(download)
        guard !closedWindow, !terminatingApp else { download.cancel { _ in }; return }
        let activity = BrowserDownloadActivity(context: context) { [weak self] in self?.refreshDownloadActivityList() }
        activeDownloads[key] = (download, activity)
        downloadActivities.insert(activity, at: 0)
        let exactID = activity.id
        downloadProgressObservers[key] = download.progress.observe(\.fractionCompleted, options: [.initial, .new]) { [weak self] progress, _ in
            let completed = progress.completedUnitCount, total = progress.totalUnitCount, indeterminate = progress.isIndeterminate
            Task { @MainActor [weak self] in
                guard let current = self?.activeDownloads[key]?.activity, current.id == exactID else { return }
                current.updateProgress(completed: completed, total: total, indeterminate: indeterminate)
            }
        }
        download.delegate = self
        refreshDownloadActivityList()
    }
    private func endOwnedDownloadPanel(_ key: ObjectIdentifier) {
        guard let item = downloadPanels.removeValue(forKey: key) else { return }
        savePanelStateObservation.end(item.ticket); pendingSaveQuitShortcut.end(item.ticket)
        item.ticket.cancel()
        if let parent = item.panel.sheetParent { parent.endSheet(item.panel, returnCode: .cancel) }
        item.panel.orderOut(nil)
    }
    private func cancelOwnedDownload(_ key: ObjectIdentifier, exactActivityID: UUID? = nil) {
        guard let (download, activity) = activeDownloads[key], exactActivityID == nil || activity.id == exactActivityID else { return }
        let staging = downloadFiles.removeValue(forKey: key)?.staging
        let cleanup: @MainActor () -> Void = { if let staging { BrowserDownloadFile.discardOrdinaryStaging(staging) } }
        let cancelled = activity.cancel(revokePanel: { self.endOwnedDownloadPanel(key) }, cancelTransport: { completion in
            self.activeDownloads.removeValue(forKey: key)
            self.downloadProgressObservers.removeValue(forKey: key)
            download.cancel { _ in completion() } // Opaque resume data is neither retained nor logged.
        }, cleanupOwnPartial: cleanup)
        if cancelled, !closedWindow, !terminatingApp { security.stringValue = "Download cancelled. No completion was recorded." }
        refreshDownloadActivityList()
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        let tab = index(for: webView).map { tabs[$0] }
        let context = BrowserDownloadContext(
            source: navigationResponse.response.url?.absoluteString ?? webView.url?.absoluteString ?? "unknown",
            isPrivate: tab?.isPrivate ?? true,
            destinationFilename: nil
        )
        restorePageAfterDownloadConversion(webView)
        registerDownload(download, context: context)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        let tab = index(for: webView).map { tabs[$0] }
        let context = BrowserDownloadContext(source: navigationAction.request.url?.absoluteString ?? "unknown", isPrivate: tab?.isPrivate ?? true)
        restorePageAfterDownloadConversion(webView)
        registerDownload(download, context: context)
    }
    private func closeOwnedDownloads() {
        // Revoke before ending sheets/cancelling WebKit: either can reenter callbacks.
        for activity in downloadActivities { activity.prepareCancellation() }
        downloadDecisions.close()
        let recoveryPanels = Array(downloadRecoveryPanels.values); downloadRecoveryPanels.removeAll()
        for panel in recoveryPanels { if let parent = panel.sheetParent { parent.endSheet(panel, returnCode: .cancel) }; panel.orderOut(nil) }
        for activity in downloadActivities { activity.discardSaveRecovery() }
        savePanelStateObservation.stop()
        pendingSaveQuitShortcut.stop()
        let panels = Array(downloadPanels.values); downloadPanels.removeAll()
        for item in panels { if let parent = item.panel.sheetParent { parent.endSheet(item.panel, returnCode: .cancel) }; item.panel.orderOut(nil) }
        for key in Array(activeDownloads.keys) { cancelOwnedDownload(key) }
        activeDownloads.removeAll(); downloadProgressObservers.removeAll()
        for files in downloadFiles.values { BrowserDownloadFile.discardOrdinaryStaging(files.staging) }
        downloadFiles.removeAll()
        downloadActivities.removeAll()
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let identifier = ObjectIdentifier(download)
        guard let active = activeDownloads[identifier], active.download === download else { completionHandler(nil); return }
        let activity = active.activity
        let ticket = downloadDecisions.begin(downloadID: identifier, completion: completionHandler)
        guard ticket.isPending, !closedWindow, !terminatingApp else { ticket.cancel(); return }
        guard activity.attachDecision(ticket,
            suggestedFilename: BrowserDownloadFile.safeFilename(suggestedFilename)) else { ticket.cancel(); return }
        if let previous = downloadPanels.removeValue(forKey: identifier) {
            savePanelStateObservation.end(previous.ticket)
            pendingSaveQuitShortcut.end(previous.ticket)
            if let parent = previous.panel.sheetParent { parent.endSheet(previous.panel, returnCode: .cancel) }
        }
        let panel = NSSavePanel()
        // A pending new download has no unsaved user document. Permit normal Quit;
        // the existing owner revokes its destination and cancels the sheet first.
        panel.preventsApplicationTerminationWhenModal = false
        panel.nameFieldStringValue = BrowserDownloadFile.safeFilename(suggestedFilename)
        panel.delegate = savePanelValidationObservation
        downloadPanels[identifier] = (ticket, panel)
        savePanelStateObservation.begin(ticket)
        pendingSaveQuitShortcut.begin(ticket)
        panel.beginSheetModal(for: window) { [weak self, ticket] result in
            self?.recordSavePanelEvidence(result == .OK ? .panelAccepted : .panelCancelled, panel: panel)
            self?.savePanelStateObservation.end(ticket)
            self?.pendingSaveQuitShortcut.end(ticket)
            guard let self, ticket.isPending, !self.closedWindow, !self.terminatingApp else { ticket.cancel(); return }
            if self.downloadPanels[identifier]?.ticket === ticket { self.downloadPanels.removeValue(forKey: identifier) }
            guard result == .OK, let destination = panel.url else {
                self.cancelOwnedDownload(identifier, exactActivityID: activity.id)
                return
            }
            guard activity.destinationChosen(filename: destination.lastPathComponent) else { ticket.cancel(); return }
            let staging: URL
            do { staging = try BrowserDownloadFile.makeOrdinaryStagingURL() }
            catch {
                activity.fail("Could not prepare the download destination")
                self.activeDownloads.removeValue(forKey: identifier)
                self.downloadProgressObservers.removeValue(forKey: identifier)
                ticket.cancel()
                return
            }
            self.downloadFiles[identifier] = (staging, destination)
            // Leave ViewBridge before WebKit requests its sandbox extension, retaining the
            // exact revocable decision so a queued callback cannot outlive this window.
            DispatchQueue.main.async { [weak self, ticket] in
                guard let self, !self.closedWindow, !self.terminatingApp, activity.canFinish else { ticket.cancel(); return }
                ticket.resolve(staging)
            }
        }
        recordSavePanelEvidence(.sheetBeginReturned, panel: panel)
        DispatchQueue.main.async { [weak self, weak panel] in
            guard let panel, ticket.isPending else { return }
            self?.recordSavePanelEvidence(.sheetNextMainTurn, panel: panel)
        }
    }
    func downloadDidFinish(_ download: WKDownload) {
        let identifier = ObjectIdentifier(download)
        guard let active = activeDownloads[identifier], active.download === download else { return }
        activeDownloads.removeValue(forKey: identifier)
        downloadProgressObservers.removeValue(forKey: identifier)
        let activity = active.activity
        guard !closedWindow, !terminatingApp, activity.canFinish else {
            if let files = downloadFiles.removeValue(forKey: identifier) { BrowserDownloadFile.discardOrdinaryStaging(files.staging) }
            return
        }
        guard let files = downloadFiles.removeValue(forKey: identifier) else {
            security.stringValue = "Download destination unavailable. No completion was recorded."
            activity.fail("Failed · destination unavailable, no completion recorded"); return
        }
        guard activity.finishSave(staging: files.staging, destination: files.destination, defaults: defaults) else {
            security.stringValue = activity.canSaveAgain ? "Could not save. Choose Save As in Downloads to try another location." : activity.status
            return
        }
        if activity.isPrivate {
            security.stringValue = "Private download completed. The selected file remains on disk; no YNX Downloads record was written."
            refreshDownloadActivityList()
            return
        }
        security.stringValue = "Download completed to the user-selected file."
        refreshLibrary()
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let identifier = ObjectIdentifier(download)
        guard let active = activeDownloads[identifier], active.download === download else { return }
        activeDownloads.removeValue(forKey: identifier)
        downloadProgressObservers.removeValue(forKey: identifier)
        let activity = active.activity
        activity.fail("Failed · no completion recorded")
        endOwnedDownloadPanel(identifier)
        if let files = downloadFiles.removeValue(forKey: identifier) { BrowserDownloadFile.discardOrdinaryStaging(files.staging) }
        guard !closedWindow, !terminatingApp else { return }
        if activity.phase == .cancelling || activity.phase == .cancelled {
            security.stringValue = "Download cancelled. No completion was recorded."; refreshDownloadActivityList(); return
        }
        guard activity.phase == .failed else { return } // Ignore late failure after a terminal completion.
        security.stringValue = activity.isPrivate ? "Private download failed. No YNX Downloads record was written." : "Download failed: \(error.localizedDescription)"
        refreshDownloadActivityList()
    }
    private func showBoundary(title: String, message: String) { let alert=NSAlert();alert.messageText=title;alert.informativeText=message;alert.alertStyle = .informational;alert.addButton(withTitle:"Close");alert.runModal() }

    private func applyEvidenceState() { guard let state = environment["YNX_BROWSER_EVIDENCE_STATE"] else { return }; if state == "private" { privateTabAction() }; if state == "crash", let id=activeID, let i=tabs.firstIndex(where:{$0.id==id}){tabs[i].crashed=true;refreshChrome();security.stringValue="Web content process crashed · session recovery preserved · press Reload to continue"}; if state == "permissions" { showPermissions() }; if state == "downloads" { showDownloads() } }
    func application(_ application: NSApplication, open urls: [URL]) {
        // LaunchServices may deliver several links in one event. Bound the batch without
        // silently dropping every ordinary link after the first. Wallet callbacks retain
        // their original single-callback boundary and never consume a mixed URL batch.
        if urls.contains(where: { $0.scheme?.lowercased() == BrowserWalletCallbackBindings.macOS.scheme }) {
            guard urls.count == 1, let value = urls.first else {
                auditLogger.error("external_link_rejected code=BR-DEEPLINK-MIXED-CALLBACK")
                return
            }
            handleWalletCallback(value)
            return
        }
        for value in urls.prefix(16) {
            guard let scheme = value.scheme?.lowercased(), ["http", "https"].contains(scheme),
                  BrowserOmnibox.isNavigable(value) else {
                auditLogger.error("external_link_rejected code=BR-DEEPLINK-TARGET")
                continue
            }
            // No restore, home-tab or closed-window dependency on an existing WKWebView.
            if !launchCompleted {
                if queuedExternalNavigations.count < 16 { queuedExternalNavigations.append(value) }
            } else { openExternalNavigation(value) }
        }
    }
    private func ordinaryNavigationController() -> BrowserController? {
        let root = coordinator ?? self
        if !root.closedWindow { return root }
        if let existing = root.ownedWindows.last(where: { !$0.isPrivateWindow && !$0.closedWindow }) { return existing }
        root.createWindow(privateMode: false)
        return root.ownedWindows.last(where: { !$0.isPrivateWindow && !$0.closedWindow })
    }
    private func openExternalNavigation(_ url: URL) {
        guard BrowserOmnibox.isNavigable(url), let target = ordinaryNavigationController() else { return }
        if target.window.isMiniaturized { target.window.deminiaturize(nil) }
        target.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        target.openTab(url: url, isPrivate: false)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if launchCompleted, !hasVisibleWindows, let target = ordinaryNavigationController() {
            if target.window.isMiniaturized { target.window.deminiaturize(nil) }
            target.window.makeKeyAndOrderFront(nil)
        }
        return true
    }
    private func handleWalletCallback(_ url: URL) {
        do {
            let key = try deviceSigningKey()
            let message = try BrowserWalletCallbackPolicy.validateAndConsume(
                url: url,
                defaults: defaults,
                verificationKey: key.publicKey,
                bindings: .macOS
            )
            auditLogger.notice("wallet_callback_preliminary_valid code=BR-WALLET-CALLBACK-PRELIMINARY")
            security.stringValue = message
        } catch let error as BrowserWalletCallbackError {
            auditLogger.error("wallet_callback_rejected code=\(error.code, privacy: .public)")
            security.stringValue = "Wallet callback rejected [\(error.code)]: \(error.localizedDescription). No session was created."
        } catch {
            auditLogger.error("wallet_callback_rejected code=BR-WALLET-CALLBACK-INTERNAL")
            security.stringValue = "Wallet callback rejected [BR-WALLET-CALLBACK-INTERNAL]. No session was created."
        }
    }
    private func randomToken(_ count: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw NSError(domain: "YNXBrowser", code: 6, userInfo: [NSLocalizedDescriptionKey: "secure random generation failed"])
        }
        return Data(bytes).base64URLEncodedString()
    }
    private func deviceSigningKey() throws -> P256.Signing.PrivateKey {
        let service = "com.ynxweb4.browser.macos"
        let account = "wallet-product-device-p256"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: data)
        }
        let key = P256.Signing.PrivateKey()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: key.rawRepresentation
        ]
        SecItemDelete(query as CFDictionary)
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else {
            throw NSError(domain: "YNXBrowser", code: 4, userInfo: [NSLocalizedDescriptionKey: "device key storage failed"])
        }
        return key
    }
    private func devicePublicKey(_ key: P256.Signing.PrivateKey) throws -> String {
        guard let compact = key.publicKey.compactRepresentation else {
            throw NSError(domain: "YNXBrowser", code: 5, userInfo: [NSLocalizedDescriptionKey: "device key encoding failed"])
        }
        return compact.base64URLEncodedString()
    }
    func applicationWillTerminate(_ notification: Notification) {
        terminatingApp = true
        closeOwnedDownloads()
        originalPagesProducer?.close(); originalPagesProducer = nil
        if !isPrivateWindow {
            if let records = sessionPersistence.willQuit(openOrdinaryWindows: openOrdinarySessionWindows()) {
                BrowserLocalProfile.persistTabs(records, defaults: defaults)
            }
            defaults.synchronize()
        }
        pageSelections.removeAll(); retireWindowWebContent()
        for controller in ownedWindows { controller.closeOwnedDownloads(); controller.originalPagesProducer?.close(); controller.originalPagesProducer = nil; controller.pageSelections.removeAll(); controller.retireWindowWebContent() }
    }
}

// Immutable, headless proof-helper role is handled before AppKit startup, ordinary profile
// restoration or Wallet callbacks. A marker on another role is rejected by the helper preflight.
let publicDiagnosticArgumentRequested = ProcessInfo.processInfo.arguments.dropFirst().contains {
    $0.hasPrefix("--public-nym") || $0.hasPrefix("--public-snowflake")
        || $0.hasPrefix("--check-public-nym") || $0.hasPrefix("--check-public-snowflake")
}
let publicDiagnosticRoleRequested = Bundle.main.bundleIdentifier == "com.ynxweb4.browser.qa.tor.public-search"
    || Bundle.main.bundleIdentifier == "com.ynxweb4.browser.qa.tor.public-search.snowflake"
    || Bundle.main.bundleIdentifier == "com.ynxweb4.browser.qa.nym.public-search"
    || ["YNXPublicSearchDiagnostic", "YNXPublicSnowflakeSearchDiagnostic", "YNXPublicNymSearchDiagnostic",
        "YNXPublicSnowflakeLaunchSHA256", "YNXPublicArtiChannelTimeoutExperiment"].contains {
        Bundle.main.object(forInfoDictionaryKey: $0) != nil
    }
// Experimental browser roles are separately bundled QA applications. Merely
// attaching their identifier or marker must never fall through to normal startup.
let interactiveExperimentRoleRequested = ["com.ynxweb4.browser.qa.interactive",
                                          "com.ynxweb4.browser.qa.tor.interactive",
                                          "com.ynxweb4.browser.qa.nym.interactive"].contains(Bundle.main.bundleIdentifier ?? "")
    || Bundle.main.object(forInfoDictionaryKey: "YNXInteractiveRouteExperiment") != nil
#if !YNX_PRIVACY_ACCEPTANCE
if publicDiagnosticRoleRequested || publicDiagnosticArgumentRequested {
    FileHandle.standardError.write(Data("Public-search diagnostics are unavailable in this production build.\n".utf8))
    exit(78)
}
if interactiveExperimentRoleRequested {
    FileHandle.standardError.write(Data("Interactive route experiments are unavailable in this production build.\n".utf8))
    exit(78)
}
if let code = NymProofHelper.runIfRequested() { exit(code) }
#endif
#if YNX_PRIVACY_ACCEPTANCE
let interactiveExperiment = BrowserInteractiveRouteExperimentApplicationDelegate.claims()
if interactiveExperimentRoleRequested && !interactiveExperiment {
    FileHandle.standardError.write(Data("Interactive route experiment role rejected before ordinary startup.\n".utf8))
    exit(78)
}
let publicSearchDiagnostic = TorPublicSearchDiagnosticApplicationDelegate.claims()
if interactiveExperiment && (publicDiagnosticRoleRequested || publicDiagnosticArgumentRequested || publicSearchDiagnostic) {
    FileHandle.standardError.write(Data("Mixed route experiment roles rejected before ordinary startup.\n".utf8))
    exit(78)
}
if interactiveExperiment && ProcessInfo.processInfo.arguments.dropFirst().contains(where: { $0.hasPrefix("--") }) {
    FileHandle.standardError.write(Data("Interactive route experiment options are unavailable.\n".utf8))
    exit(78)
}
if !publicSearchDiagnostic && (publicDiagnosticRoleRequested || publicDiagnosticArgumentRequested) {
    FileHandle.standardError.write(Data("Public-search diagnostic role rejected before ordinary startup.\n".utf8))
    exit(78)
}
if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--public-snowflake-check-only") }) {
    guard ProcessInfo.processInfo.arguments.count == 2,
          ProcessInfo.processInfo.arguments[1] == "--public-snowflake-check-only",
          TorPublicSearchDiagnosticApplicationDelegate.claimsSnowflake() else {
        FileHandle.standardError.write(Data("Snowflake input check rejected before ordinary startup.\n".utf8))
        exit(78)
    }
    do {
        let launch = try TorSnowflakePublicBrowserBackend.load()
        try launch.requireLaunchBudget()
        let result: [String: Any] = [
            "status": "FIXED_PUBLIC_INPUTS_VERIFIED_NO_NETWORK",
            "runID": launch.runID,
            "helperSHA256": TorSnowflakePublicBrowserBackend.helperSHA256,
            "sourceInputsSHA256": TorSnowflakePublicBrowserBackend.sourceInputsSHA256,
            "scopeSHA256": launch.scopeSHA256,
            "attemptClaimed": false, "normalPrivacyAdmission": false
        ]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("Snowflake input check failed; no backend or window created.\n".utf8))
        exit(78)
    }
}
if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--public-nym-check-only") }) {
    guard ProcessInfo.processInfo.arguments.count == 2,
          ProcessInfo.processInfo.arguments[1] == "--public-nym-check-only",
          TorPublicSearchDiagnosticApplicationDelegate.claimsNym() else {
        FileHandle.standardError.write(Data("Nym input check rejected before ordinary startup.\n".utf8))
        exit(78)
    }
    do {
        try NymPublicSearchRole.require(.main)
        _ = try NymPublicExecutableSupply.load(bundle: .main)
        let result: [String: Any] = [
            "status": "FIXED_PUBLIC_NYM_SUPPLY_VERIFIED_NO_NETWORK",
            "directorySHA256": NymPublicExecutableSupply.directorySHA256,
            "runtimeSHA256": NymPublicExecutableSupply.runtimeSHA256,
            "profileCreated": false, "normalPrivacyAdmission": false
        ]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("Nym input check failed; no backend or window created.\n".utf8))
        exit(78)
    }
}
if publicSearchDiagnostic && ProcessInfo.processInfo.arguments.dropFirst().contains(where: { $0.hasPrefix("--") }) {
    // Recognized checks have already exited above. A mistyped check must not
    // silently open a window and wait for input.
    FileHandle.standardError.write(Data("Unknown public diagnostic argument rejected before AppKit startup.\n".utf8))
    exit(78)
}
if !publicSearchDiagnostic && !interactiveExperiment, let code = NymProofHelper.runIfRequested() { exit(code) }
let protectedAcceptanceLaunch: ProtectedAcceptanceDispatcher.Launch?
do { protectedAcceptanceLaunch = try ProtectedAcceptanceDispatcher.parse(ProcessInfo.processInfo.arguments) }
catch {
    FileHandle.standardError.write(Data("Protected acceptance rejected before ordinary startup, input or WebKit admission: \(String(describing: type(of: error))).\n".utf8))
    exit(78)
}
#else
if ProcessInfo.processInfo.arguments.contains(where: {
    $0.hasPrefix("--p05-synthetic-run") || $0.hasPrefix("--p05-probe-manifest") ||
    $0.hasPrefix("--p05-protected-acceptance") || $0.hasPrefix("--ynx-nym-synthetic-proof")
}) {
    FileHandle.standardError.write(Data("Synthetic acceptance is unavailable in this production build.\n".utf8))
    exit(78)
}
#endif
let app = NSApplication.shared
let delegate: any NSApplicationDelegate
let role: BrowserProcessRole
do {
    #if YNX_PRIVACY_ACCEPTANCE
    if publicSearchDiagnostic || interactiveExperiment { role = .ordinary }
    else if let protectedAcceptanceLaunch { role = .routed(protectedAcceptanceLaunch.mode) }
    else {
        role = try BrowserProcessRole.resolve(arguments: ProcessInfo.processInfo.arguments,
            bundleMode: Bundle.main.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") as? String,
            bundleProofRole: Bundle.main.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool ?? false)
    }
    #else
    role = try BrowserProcessRole.resolve(arguments: ProcessInfo.processInfo.arguments,
    bundleMode: Bundle.main.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") as? String,
    bundleProofRole: Bundle.main.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool ?? false)
    #endif
}
catch { FileHandle.standardError.write(Data("Routed launch rejected before ordinary startup.\n".utf8)); exit(78) }
if case .routed(let mode) = role {
    #if YNX_PRIVACY_ACCEPTANCE
    if let protectedAcceptanceLaunch { delegate = RoutedBrowserApplicationDelegate(acceptanceLaunch: protectedAcceptanceLaunch) }
    else { delegate = RoutedBrowserApplicationDelegate(mode: mode) }
    #else
    delegate = RoutedBrowserApplicationDelegate(mode: mode)
    #endif
} else {
    #if YNX_PRIVACY_ACCEPTANCE
    if interactiveExperiment {
        delegate = BrowserInteractiveRouteExperimentApplicationDelegate()
    } else if publicSearchDiagnostic {
        delegate = TorPublicSearchDiagnosticApplicationDelegate()
    } else if BrowserSyntheticProbe.requested(ProcessInfo.processInfo.arguments) {
        do { delegate = try BrowserSyntheticProbe(arguments: ProcessInfo.processInfo.arguments) }
        catch { FileHandle.standardError.write(Data("Synthetic probe rejected before ordinary startup.\n".utf8)); exit(78) }
    } else { delegate = BrowserController() }
    #else
    delegate = BrowserController()
    #endif
}
app.delegate = delegate
app.run()

extension Data {
    func base64URLEncodedString() -> String { base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
    init?(base64URLEncoded:String) { var value=base64URLEncoded.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");value+=String(repeating:"=",count:(4-value.count%4)%4);self.init(base64Encoded:value) }
}
