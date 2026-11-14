import AppKit

@MainActor final class BrowserHomeView: NSView {
    enum Section { case home, search, spaces, downloads, history, settings }
    enum RouteMode: String { case standard = "Standard", tor = "Tor", nym = "Nym" }
    enum RouteStatus { case connecting, connected, blocked }
    struct RouteState {
        let mode: RouteMode
        let status: RouteStatus
        let detail: String
        init(mode: RouteMode, status: RouteStatus, detail: String) { self.mode = mode; self.status = status; self.detail = detail }
    }
    struct RecentItem {
        let title: String
        let url: String
        let visitedAt: Date
        init(title: String, url: String, visitedAt: Date) { self.title = title; self.url = url; self.visitedAt = visitedAt }
    }
    struct QuickApp {
        let id: String
        let title: String
        let symbol: String
        let available: Bool
        init(id: String, title: String, symbol: String, available: Bool) { self.id = id; self.title = title; self.symbol = symbol; self.available = available }
    }
    struct Actions {
        let navigate: (String) -> Void
        let openSection: (Section) -> Void
        let chooseRoute: (RouteMode) -> Void
        let newPrivateWindow: () -> Void
        let newOrdinaryWindow: () -> Void
        let searchSettings: () -> Void
        let clearBrowsingData: () -> Void
        let openQuickApp: (String) -> Void
        let clearRecent: () -> Void
    }

    private let actions: Actions
    private let search: BrowserChromeSearchField
    private let recentRows = NSStackView()
    private let recentSection = NSStackView()
    private let quickAppsRow = NSStackView()
    private let routeRows = NSStackView()
    private let routeStatusTitle = BrowserChromeTheme.label("Direct connection", size: 12, weight: .medium)
    private let routeStatusDetail = BrowserChromeTheme.label("Your IP address is not hidden.", size: 11, color: BrowserChromeTheme.secondary)
    private let routeHealth = BrowserChromeTheme.label("Direct", size: 12, color: BrowserChromeTheme.muted)
    private let privateNote = BrowserChromeTheme.label("Private browsing does not save local history. It does not hide your IP address.", size: 12, color: BrowserChromeTheme.secondary)
    private let feedback = BrowserChromeSurface(cornerRadius: 10)
    private let feedbackTitle = BrowserChromeTheme.label("", size: 13, weight: .medium)
    private let feedbackDetail = BrowserChromeTheme.label("", size: 12, color: BrowserChromeTheme.secondary)
    private let progress = NSProgressIndicator()
    private let providerDisclosure = BrowserChromeTheme.label("", size: 10, color: BrowserChromeTheme.muted)
    private var recent: [RecentItem] = []
    private var apps: [QuickApp] = []
    private var isPrivate = false
    private var route = RouteState(mode: .standard, status: .connected, detail: "Direct connection. Your IP address is not hidden.")

    init(actions: Actions) {
        self.actions = actions
        search = BrowserChromeSearchField(onSubmit: actions.navigate)
        super.init(frame: .zero)
        wantsLayer = true
        BrowserChromeTheme.paint(self, background: BrowserChromeTheme.background)
        build()
        renderRecent()
        renderQuickApps()
        renderRoutes()
    }
    required init?(coder: NSCoder) { nil }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance(); BrowserChromeTheme.refreshAll()
    }
    func updateSearchProvider(name: String, host: String) {
        search.updateProvider(name)
        providerDisclosure.stringValue = "Search destination: \(host). Search is sent only when you submit."
    }

    func focusSearch() { search.focusInput() }
    func updateRecent(_ items: [RecentItem]) { recent = items; renderRecent() }
    func updateQuickApps(_ items: [QuickApp]) { apps = items; renderQuickApps() }
    func updateRouteState(_ state: RouteState) { route = state; renderRoutes() }
    func updatePrivateMode(_ value: Bool) {
        isPrivate = value
        privateNote.isHidden = !value
        recentSection.isHidden = value
        quickAppsRow.isHidden = value
        renderRecent()
    }
    func updateNavigationFeedback(title: String, detail: String, isLoading: Bool) {
        feedbackTitle.stringValue = title
        feedbackDetail.stringValue = detail
        feedback.isHidden = false
        progress.isHidden = !isLoading
        if isLoading { progress.startAnimation(nil) } else { progress.stopAnimation(nil) }
    }
    func clearNavigationFeedback() {
        feedback.isHidden = true
        feedbackTitle.stringValue = ""
        feedbackDetail.stringValue = ""
        progress.stopAnimation(nil)
    }

    private func build() {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let document = NSView()
        document.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = document
        addSubview(scroll)
        NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: leadingAnchor), scroll.trailingAnchor.constraint(equalTo: trailingAnchor), scroll.topAnchor.constraint(equalTo: topAnchor), scroll.bottomAnchor.constraint(equalTo: bottomAnchor), document.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor), document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor), document.topAnchor.constraint(equalTo: scroll.contentView.topAnchor), document.heightAnchor.constraint(greaterThanOrEqualTo: scroll.contentView.heightAnchor)])

        let columns = NSView()
        columns.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(columns)
        NSLayoutConstraint.activate([columns.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 26), columns.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -20), columns.topAnchor.constraint(equalTo: document.topAnchor, constant: 22), columns.bottomAnchor.constraint(lessThanOrEqualTo: document.bottomAnchor, constant: -24)])

        let main = NSStackView()
        main.orientation = .vertical
        main.alignment = .width
        main.spacing = 22
        main.translatesAutoresizingMaskIntoConstraints = false
        main.setContentHuggingPriority(.defaultLow, for: .horizontal)
        main.setContentHuggingPriority(.required, for: .vertical)
        columns.addSubview(main)
        main.widthAnchor.constraint(greaterThanOrEqualToConstant: 320).isActive = true

        let topSpace = NSView()
        topSpace.heightAnchor.constraint(equalToConstant: 29).isActive = true
        main.addArrangedSubview(topSpace)
        let brand = BrowserChromeTheme.label("YNX", size: 36, weight: .bold)
        let subtitle = BrowserChromeTheme.label("Browser + Search", size: 19, weight: .medium)
        let tagline = BrowserChromeTheme.label("Browse, search and explore.", size: 15, color: BrowserChromeTheme.secondary)
        for label in [brand, subtitle, tagline] { label.alignment = .center }
        let heading = NSStackView(views: [brand, subtitle, tagline])
        heading.orientation = .vertical
        heading.alignment = .centerX
        heading.spacing = 5
        heading.setCustomSpacing(15, after: subtitle)
        heading.setContentHuggingPriority(.required, for: .vertical)
        main.addArrangedSubview(heading)
        main.setCustomSpacing(31, after: heading)
        main.addArrangedSubview(search)
        let defaultProvider = providerDisclosure
        defaultProvider.alignment = .center
        defaultProvider.maximumNumberOfLines = 2
        defaultProvider.lineBreakMode = .byWordWrapping
        main.addArrangedSubview(defaultProvider)
        main.setCustomSpacing(12, after: search)
        privateNote.maximumNumberOfLines = 2
        privateNote.lineBreakMode = .byWordWrapping
        privateNote.isHidden = true
        main.addArrangedSubview(privateNote)
        buildFeedback()
        main.addArrangedSubview(feedback)

        quickAppsRow.orientation = .horizontal
        quickAppsRow.distribution = .fillEqually
        quickAppsRow.spacing = 10
        main.addArrangedSubview(quickAppsRow)
        main.setCustomSpacing(28, after: quickAppsRow)
        buildRecentSection()
        main.addArrangedSubview(recentSection)

        let aside = NSStackView(views: [buildRoutePanel(), buildQuickTools()])
        aside.orientation = .vertical
        aside.alignment = .width
        aside.spacing = 16
        aside.translatesAutoresizingMaskIntoConstraints = false
        aside.setContentHuggingPriority(.required, for: .vertical)
        aside.widthAnchor.constraint(equalToConstant: 280).isActive = true
        columns.addSubview(aside)
        NSLayoutConstraint.activate([
            main.leadingAnchor.constraint(equalTo: columns.leadingAnchor), main.topAnchor.constraint(equalTo: columns.topAnchor),
            main.bottomAnchor.constraint(lessThanOrEqualTo: columns.bottomAnchor),
            aside.leadingAnchor.constraint(equalTo: main.trailingAnchor, constant: 26), aside.trailingAnchor.constraint(equalTo: columns.trailingAnchor),
            aside.topAnchor.constraint(equalTo: columns.topAnchor), aside.bottomAnchor.constraint(lessThanOrEqualTo: columns.bottomAnchor)
        ])
        main.fillColumnWidth()
        aside.fillColumnWidth()
    }

    private func buildFeedback() {
        feedback.isHidden = true
        progress.style = .spinning
        progress.controlSize = .small
        progress.isDisplayedWhenStopped = false
        feedbackDetail.maximumNumberOfLines = 3
        feedbackDetail.lineBreakMode = .byWordWrapping
        let texts = NSStackView(views: [feedbackTitle, feedbackDetail])
        texts.orientation = .vertical
        texts.alignment = .leading
        texts.spacing = 5
        let content = NSStackView(views: [progress, texts])
        content.orientation = .horizontal
        content.alignment = .centerY
        content.spacing = 12
        pin(content, in: feedback, inset: 15)
    }

    private func buildRecentSection() {
        recentSection.orientation = .vertical
        recentSection.alignment = .width
        recentSection.spacing = 12
        let recentTab = BrowserChromeTheme.label("Recent", size: 12, weight: .medium)
        let suggestions = BrowserChromeTextButton("Suggestions") {}
        suggestions.isEnabled = false
        suggestions.toolTip = "Suggestions are not configured"
        let spaces = BrowserChromeTextButton("From your spaces") { [weak self] in self?.actions.openSection(.spaces) }
        spaces.isEnabled = false
        spaces.toolTip = "Spaces are not available"
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let clear = BrowserChromeTextButton("Clear all") { [weak self] in self?.actions.clearRecent() }
        let tabs = NSStackView(views: [recentTab, suggestions, spaces, spacer, clear])
        tabs.orientation = .horizontal
        tabs.spacing = 16
        tabs.alignment = .centerY
        recentSection.addArrangedSubview(tabs)
        let underline = NSView()
        underline.wantsLayer = true
        BrowserChromeTheme.paint(underline, background: BrowserChromeTheme.blue)
        underline.layer?.cornerRadius = 2
        underline.heightAnchor.constraint(equalToConstant: 3).isActive = true
        underline.widthAnchor.constraint(equalToConstant: 44).isActive = true
        let lineRow = NSStackView(views: [underline, NSView()])
        lineRow.orientation = .horizontal
        recentSection.addArrangedSubview(lineRow)
        let list = BrowserChromeSurface()
        recentRows.orientation = .vertical
        recentRows.alignment = .width
        recentRows.spacing = 0
        pin(recentRows, in: list, inset: 0)
        recentSection.addArrangedSubview(list)
        recentSection.fillColumnWidth()
    }

    private func renderRecent() {
        removeArrangedSubviews(recentRows)
        guard !isPrivate else { return }
        if recent.isEmpty {
            let empty = BrowserChromeTheme.label("Your recent pages will appear here.", size: 13, color: BrowserChromeTheme.muted)
            empty.alignment = .center
            let holder = NSView()
            pin(empty, in: holder, inset: 24)
            recentRows.addArrangedSubview(holder)
            recentRows.fillColumnWidth()
            return
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        for (index, item) in recent.prefix(8).enumerated() {
            if index > 0 { recentRows.addArrangedSubview(separator()) }
            let row = BrowserHomeRecentRow(title: item.title.isEmpty ? item.url : item.title, url: item.url, age: formatter.localizedString(for: item.visitedAt, relativeTo: Date())) { [weak self] in self?.actions.navigate(item.url) }
            recentRows.addArrangedSubview(row)
        }
        recentRows.fillColumnWidth()
    }

    private func renderQuickApps() {
        removeArrangedSubviews(quickAppsRow)
        if apps.isEmpty {
            let unavailable = BrowserChromeTheme.label("Applications appear here when connected.", size: 12, color: BrowserChromeTheme.muted)
            unavailable.alignment = .center
            quickAppsRow.addArrangedSubview(unavailable)
            return
        }
        let colors: [NSColor] = [BrowserChromeTheme.blue, .systemPurple, .systemCyan, .systemMint, .systemOrange, .systemPurple]
        for (index, app) in apps.prefix(6).enumerated() {
            let tile = BrowserChromeSurface(cornerRadius: 11)
            tile.heightAnchor.constraint(equalToConstant: 90).isActive = true
            let icon = NSImageView(image: BrowserChromeTheme.symbol(app.symbol, size: 27, weight: .medium))
            icon.contentTintColor = app.available ? colors[index % colors.count] : BrowserChromeTheme.muted
            let title = BrowserChromeTheme.label(app.title, size: 12, color: app.available ? BrowserChromeTheme.text : BrowserChromeTheme.muted)
            title.alignment = .center
            let content = NSStackView(views: [icon, title])
            content.orientation = .vertical
            content.alignment = .centerX
            content.spacing = 10
            content.translatesAutoresizingMaskIntoConstraints = false
            tile.addSubview(content)
            NSLayoutConstraint.activate([content.centerXAnchor.constraint(equalTo: tile.centerXAnchor), content.centerYAnchor.constraint(equalTo: tile.centerYAnchor), content.leadingAnchor.constraint(greaterThanOrEqualTo: tile.leadingAnchor, constant: 4), content.trailingAnchor.constraint(lessThanOrEqualTo: tile.trailingAnchor, constant: -4)])
            addClickTarget(to: tile, label: app.available ? "Open \(app.title)" : "\(app.title) unavailable", enabled: app.available) { [weak self] in self?.actions.openQuickApp(app.id) }
            quickAppsRow.addArrangedSubview(tile)
        }
    }

    private func buildRoutePanel() -> NSView {
        let panel = BrowserChromeSurface()
        let title = BrowserChromeTheme.label("Privacy & Network Route", size: 13, weight: .semibold)
        routeRows.orientation = .vertical
        routeRows.alignment = .width
        routeRows.spacing = 11
        routeStatusDetail.maximumNumberOfLines = 3
        routeStatusDetail.lineBreakMode = .byWordWrapping
        let connection = NSStackView(views: [routeStatusTitle, routeStatusDetail])
        connection.orientation = .vertical
        connection.alignment = .leading
        connection.spacing = 6
        let healthTitle = BrowserChromeTheme.label("Route status", size: 12)
        let spacer = NSView()
        let health = NSStackView(views: [healthTitle, spacer, routeHealth])
        health.orientation = .horizontal
        health.alignment = .centerY
        let stack = NSStackView(views: [title, routeRows, separator(), connection, separator(), health])
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 17
        pin(stack, in: panel, inset: 15)
        stack.fillColumnWidth()
        return panel
    }

    private func renderRoutes() {
        removeArrangedSubviews(routeRows)
        let definitions: [(RouteMode, String, String)] = [(.standard, "shield.fill", "Direct connection"), (.tor, "network", "Route through Tor network"), (.nym, "circle.hexagongrid", "Route through Nym mixnet")]
        for (mode, symbol, description) in definitions {
            let selected = route.mode == mode
            let row = BrowserChromeSurface(cornerRadius: 11)
            row.heightAnchor.constraint(equalToConstant: 94).isActive = true
            if selected { BrowserChromeTheme.paint(row, background: BrowserChromeTheme.elevated, border: BrowserChromeTheme.blue) }
            let icon = NSImageView(image: BrowserChromeTheme.symbol(symbol, size: 25))
            icon.contentTintColor = selected ? BrowserChromeTheme.blue : BrowserChromeTheme.secondary
            let title = BrowserChromeTheme.label(mode.rawValue, size: 13, weight: .medium)
            let description = BrowserChromeTheme.label(description, size: 10, color: BrowserChromeTheme.secondary)
            let detail: String
            if mode == .standard { detail = "Your source IP is not hidden." }
            else if !selected { detail = "Not connected" }
            else { switch route.status { case .connecting: detail = "Connecting…"; case .connected: detail = "Connected to this route"; case .blocked: detail = "Blocked · no direct fallback" } }
            let state = BrowserChromeTheme.label(detail, size: 10, color: BrowserChromeTheme.muted)
            let labels = NSStackView(views: [title, description, state])
            labels.orientation = .vertical
            labels.alignment = .leading
            labels.spacing = 6
            let radio = NSImageView(image: BrowserChromeTheme.symbol(selected ? "largecircle.fill.circle" : "circle", size: 18))
            radio.contentTintColor = selected ? BrowserChromeTheme.blue : BrowserChromeTheme.muted
            let content = NSStackView(views: [icon, labels, radio])
            content.orientation = .horizontal
            content.alignment = .centerY
            content.spacing = 11
            pin(content, in: row, inset: 13)
            icon.widthAnchor.constraint(equalToConstant: 26).isActive = true
            radio.widthAnchor.constraint(equalToConstant: 19).isActive = true
            addClickTarget(to: row, label: "Open \(mode.rawValue) window") { [weak self] in self?.actions.chooseRoute(mode) }
            routeRows.addArrangedSubview(row)
        }
        routeRows.fillColumnWidth()
        if route.mode == .standard {
            routeStatusTitle.stringValue = "Standard connection"
            routeStatusDetail.stringValue = "Direct connection. Your IP address is not hidden."
            routeHealth.stringValue = "Direct"
            routeHealth.textColor = BrowserChromeTheme.muted
        } else {
            switch route.status {
            case .connecting: routeStatusTitle.stringValue = "Connecting to \(route.mode.rawValue)"; routeHealth.stringValue = "Connecting"; routeHealth.textColor = BrowserChromeTheme.secondary
            case .connected: routeStatusTitle.stringValue = "\(route.mode.rawValue) route connected"; routeHealth.stringValue = "Connected"; routeHealth.textColor = .systemGreen
            case .blocked: routeStatusTitle.stringValue = "\(route.mode.rawValue) is blocked"; routeHealth.stringValue = "Blocked"; routeHealth.textColor = .systemOrange
            }
            routeStatusDetail.stringValue = route.detail
        }
    }

    private func buildQuickTools() -> NSView {
        let panel = BrowserChromeSurface()
        let title = BrowserChromeTheme.label("Quick tools", size: 13, weight: .semibold)
        let searchSettings = BrowserChromeTextButton("Search settings", symbol: "magnifyingglass") { [weak self] in self?.actions.searchSettings() }
        let clear = BrowserChromeTextButton("Clear browsing data", symbol: "lock") { [weak self] in self?.actions.clearBrowsingData() }
        let window = BrowserChromeTextButton("Open ordinary window", symbol: "macwindow") { [weak self] in self?.actions.newOrdinaryWindow() }
        let privateWindow = BrowserChromeTextButton("New private window", symbol: "eye.slash") { [weak self] in self?.actions.newPrivateWindow() }
        let stack = NSStackView(views: [title, searchSettings, clear, window, privateWindow])
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 18
        pin(stack, in: panel, inset: 17)
        stack.fillColumnWidth()
        return panel
    }

    private func separator() -> NSView {
        let view = NSView()
        view.wantsLayer = true
        BrowserChromeTheme.paint(view, background: BrowserChromeTheme.border)
        view.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return view
    }
    private func removeArrangedSubviews(_ stack: NSStackView) {
        for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
    }
    private func pin(_ content: NSView, in host: NSView, inset: CGFloat) {
        content.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(content)
        NSLayoutConstraint.activate([content.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: inset), content.trailingAnchor.constraint(equalTo: host.trailingAnchor, constant: -inset), content.topAnchor.constraint(equalTo: host.topAnchor, constant: inset), content.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -inset)])
    }
    private func addClickTarget(to host: NSView, label: String, enabled: Bool = true, action: @escaping () -> Void) {
        let button = BrowserChromeTextButton("") { action() }
        button.isEnabled = enabled
        button.setAccessibilityLabel(label)
        button.toolTip = label
        button.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(button)
        NSLayoutConstraint.activate([button.leadingAnchor.constraint(equalTo: host.leadingAnchor), button.trailingAnchor.constraint(equalTo: host.trailingAnchor), button.topAnchor.constraint(equalTo: host.topAnchor), button.bottomAnchor.constraint(equalTo: host.bottomAnchor)])
    }
}

@MainActor private final class BrowserHomeRecentRow: NSView {
    private let labels: NSStackView
    private var titleWidth: NSLayoutConstraint!
    private var compact = true
    init(title: String, url: String, age: String, onOpen: @escaping () -> Void) {
        let titleField = BrowserChromeTheme.label(title, size: 13, weight: .medium)
        let urlField = BrowserChromeTheme.label(url, size: 11, color: BrowserChromeTheme.secondary)
        labels = NSStackView(views: [titleField, urlField])
        super.init(frame: .zero)
        heightAnchor.constraint(equalToConstant: 60).isActive = true
        let icon = NSImageView(image: BrowserChromeTheme.symbol("globe", size: 23))
        icon.contentTintColor = BrowserChromeTheme.secondary
        labels.orientation = .vertical
        labels.alignment = .leading
        labels.spacing = 4
        titleWidth = titleField.widthAnchor.constraint(equalToConstant: 110)
        let timestamp = BrowserChromeTheme.label(age, size: 10, color: BrowserChromeTheme.muted)
        timestamp.setContentCompressionResistancePriority(.required, for: .horizontal)
        let details = NSStackView(views: [icon, labels, timestamp])
        details.orientation = .horizontal
        details.alignment = .centerY
        details.spacing = 13
        details.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 24).isActive = true
        addSubview(details)
        NSLayoutConstraint.activate([details.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 17), details.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -15), details.centerYAnchor.constraint(equalTo: centerYAnchor)])
        let button = BrowserChromeTextButton("") { onOpen() }
        button.setAccessibilityLabel("Open \(title)")
        button.toolTip = url
        button.translatesAutoresizingMaskIntoConstraints = false
        addSubview(button)
        NSLayoutConstraint.activate([button.leadingAnchor.constraint(equalTo: leadingAnchor), button.trailingAnchor.constraint(equalTo: trailingAnchor), button.topAnchor.constraint(equalTo: topAnchor), button.bottomAnchor.constraint(equalTo: bottomAnchor)])
    }
    required init?(coder: NSCoder) { nil }
    override func layout() {
        super.layout()
        let nextCompact = bounds.width < 530
        guard nextCompact != compact else { return }
        compact = nextCompact
        titleWidth.isActive = !compact
        labels.orientation = compact ? .vertical : .horizontal
        labels.alignment = compact ? .leading : .centerY
        labels.spacing = compact ? 4 : 14
    }
}
