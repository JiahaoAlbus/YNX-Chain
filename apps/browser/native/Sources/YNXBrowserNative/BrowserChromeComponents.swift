import AppKit

@MainActor extension NSStackView {
    func fillColumnWidth() {
        orientation = .vertical
        alignment = .leading
        distribution = .fill
        for view in arrangedSubviews { view.widthAnchor.constraint(equalTo: widthAnchor).isActive = true }
    }
}

@MainActor enum BrowserChromeTheme {
    static let background = adaptive("background", light: 0xFFFFFF, dark: 0x101216)
    static let surface = adaptive("surface", light: 0xF6F7F9, dark: 0x171A20)
    static let elevated = adaptive("elevated", light: 0xFFFFFF, dark: 0x20252D)
    static let border = adaptive("border", light: 0xDFE3E9, dark: 0x323A46)
    static let blue = color(0x002FA7)
    static let text = adaptive("text", light: 0x18212F, dark: 0xF2F4F8)
    static let secondary = adaptive("secondary", light: 0x4F5B6E, dark: 0xB9C3D0)
    static let muted = adaptive("muted", light: 0x687487, dark: 0x97A3B5)

    private final class Paint {
        weak var view: NSView?
        var background: NSColor?
        var border: NSColor?
        init(_ view: NSView) { self.view = view }
    }
    private static var paints: [ObjectIdentifier: Paint] = [:]
    private static func adaptive(_ name: String, light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: NSColor.Name("YNX.\(name)")) { appearance in
            color(appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light)
        }
    }
    static func paint(_ view: NSView, background: NSColor? = nil, border: NSColor? = nil) {
        paints = paints.filter { $0.value.view != nil }
        let key = ObjectIdentifier(view), value = paints[ObjectIdentifier(view)] ?? Paint(view)
        if let background { value.background = background }
        if let border { value.border = border }
        paints[key] = value; view.wantsLayer = true; refresh(view)
    }
    static func refresh(_ view: NSView) {
        guard let value = paints[ObjectIdentifier(view)] else { return }
        view.effectiveAppearance.performAsCurrentDrawingAppearance {
            if let color = value.background { view.layer?.backgroundColor = color.cgColor }
            if let color = value.border { view.layer?.borderColor = color.cgColor }
        }
        view.needsDisplay = true
    }
    static func refreshAll() {
        paints = paints.filter { $0.value.view != nil }
        for value in paints.values { if let view = value.view { refresh(view) } }
    }

    nonisolated static func color(_ hex: UInt32) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
    static func label(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular, color: NSColor? = nil) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = color ?? self.text
        field.lineBreakMode = .byTruncatingTail
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }
    static func symbol(_ name: String, size: CGFloat = 18, weight: NSFont.Weight = .regular) -> NSImage {
        (NSImage(systemSymbolName: name, accessibilityDescription: nil) ?? NSImage()).withSymbolConfiguration(.init(pointSize: size, weight: weight)) ?? NSImage()
    }
}

@MainActor class BrowserChromeSurface: NSView {
    init(cornerRadius: CGFloat = 12) {
        super.init(frame: .zero)
        wantsLayer = true
        BrowserChromeTheme.paint(self, background: BrowserChromeTheme.surface, border: BrowserChromeTheme.border)
        layer?.borderWidth = 1
        layer?.cornerRadius = cornerRadius
    }
    required init?(coder: NSCoder) { nil }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance(); BrowserChromeTheme.refresh(self)
    }
}

@MainActor final class BrowserChromeIconButton: NSButton {
    private let callback: () -> Void
    init(symbol: String, accessibilityLabel: String, tint: NSColor? = nil, action: @escaping () -> Void) {
        callback = action
        super.init(frame: .zero)
        image = BrowserChromeTheme.symbol(symbol)
        imagePosition = .imageOnly
        isBordered = false
        bezelStyle = .regularSquare
        contentTintColor = tint ?? BrowserChromeTheme.secondary
        setAccessibilityLabel(accessibilityLabel)
        toolTip = accessibilityLabel
        target = self
        self.action = #selector(activate)
    }
    required init?(coder: NSCoder) { nil }
    @objc private func activate() { callback() }
}

@MainActor final class BrowserChromeSearchField: BrowserChromeSurface {
    private let field = NSTextField()
    private let submit: (String) -> Void
    var textValue: String { field.stringValue }
    init(onSubmit: @escaping (String) -> Void) {
        submit = onSubmit
        super.init(cornerRadius: 27)
        BrowserChromeTheme.paint(self, border: BrowserChromeTheme.blue)
        layer?.borderWidth = 1
        let searchIcon = NSImageView(image: BrowserChromeTheme.symbol("magnifyingglass", size: 23))
        searchIcon.contentTintColor = BrowserChromeTheme.secondary
        field.isBezeled = false
        field.drawsBackground = false
        field.textColor = BrowserChromeTheme.text
        field.font = .systemFont(ofSize: 17)
        field.placeholderAttributedString = NSAttributedString(string: "Search DuckDuckGo or enter URL", attributes: [.foregroundColor: BrowserChromeTheme.secondary])
        field.focusRingType = .none
        field.setAccessibilityLabel("Search DuckDuckGo or enter URL")
        field.target = self
        field.action = #selector(submitInput)
        let key = BrowserChromeTheme.label("⌘ K", size: 11, color: BrowserChromeTheme.muted)
        key.alignment = .center
        key.wantsLayer = true
        BrowserChromeTheme.paint(key, background: BrowserChromeTheme.elevated)
        key.layer?.cornerRadius = 5
        let go = BrowserChromeIconButton(symbol: "arrow.right", accessibilityLabel: "Search or navigate", tint: .white) { [weak self] in self?.submitInput() }
        go.wantsLayer = true
        BrowserChromeTheme.paint(go, background: BrowserChromeTheme.blue)
        go.layer?.cornerRadius = 20
        for view in [searchIcon, field, key, go] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 54),
            searchIcon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 22), searchIcon.centerYAnchor.constraint(equalTo: centerYAnchor), searchIcon.widthAnchor.constraint(equalToConstant: 24), searchIcon.heightAnchor.constraint(equalToConstant: 24),
            field.leadingAnchor.constraint(equalTo: searchIcon.trailingAnchor, constant: 15), field.centerYAnchor.constraint(equalTo: centerYAnchor), field.trailingAnchor.constraint(equalTo: key.leadingAnchor, constant: -12),
            key.widthAnchor.constraint(equalToConstant: 39), key.heightAnchor.constraint(equalToConstant: 22), key.centerYAnchor.constraint(equalTo: centerYAnchor), key.trailingAnchor.constraint(equalTo: go.leadingAnchor, constant: -12),
            go.widthAnchor.constraint(equalToConstant: 40), go.heightAnchor.constraint(equalToConstant: 40), go.centerYAnchor.constraint(equalTo: centerYAnchor), go.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7)
        ])
    }
    required init?(coder: NSCoder) { nil }
    func focusInput() { window?.makeFirstResponder(field) }
    func setText(_ value: String) { field.stringValue = value }
    func updateProvider(_ name: String) {
        let label = "Search \(name) or enter URL"
        field.placeholderAttributedString = NSAttributedString(string: label, attributes: [.foregroundColor: BrowserChromeTheme.secondary])
        field.setAccessibilityLabel(label)
    }
    @objc private func submitInput() {
        let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { focusInput(); return }
        submit(value)
    }
}

@MainActor final class BrowserChromeTextButton: NSButton {
    private let callback: () -> Void
    init(_ title: String, symbol: String? = nil, action: @escaping () -> Void) {
        callback = action
        super.init(frame: .zero)
        self.title = title
        font = .systemFont(ofSize: 12)
        isBordered = false
        contentTintColor = BrowserChromeTheme.secondary
        alignment = .left
        if let symbol { image = BrowserChromeTheme.symbol(symbol, size: 16); imagePosition = .imageLeading }
        target = self
        self.action = #selector(activate)
        setAccessibilityLabel(title)
    }
    required init?(coder: NSCoder) { nil }
    @objc private func activate() { callback() }
}
