import AppKit
import YNXBrowserCore

/// A separate window with no WebKit instance until a route AND platform isolation are admitted.
/// No address, restore state, Wallet session, native download or AI context enters the ordinary controller.
@MainActor final class PrivacyRouteWindowController: NSWindowController, NSWindowDelegate {
    let mode: PrivacyRouteMode
    private let session: PrivacyRouteSession
    private let statusLabel = NSTextField(labelWithString: "")
    init(mode: PrivacyRouteMode) {
        self.mode = mode
        self.session = PrivacyRouteSession(provider: mode == .tor ? TorRouteProvider() : NymRouteAdapter())
        let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 640, height: 320), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "\(mode.rawValue) · 已阻断"
        window.appearance = NSAppearance(named: .aqua)
        window.isRestorable = false; window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        let status = statusLabel
        status.stringValue = "\(mode.rawValue) · 已阻断 / Blocked"
        status.font = .systemFont(ofSize: 22, weight: .semibold)
        let reason = NSTextField(wrappingLabelWithString: "此安装版尚未通过整窗流量与断路防泄漏验收，未启动路线、未创建网页视图。\n\n无痕浏览管理本地记录；隐私路由改变访问路线。此功能不保证完全匿名，也不等同于 Tor Browser。\n\n要继续普通浏览，请返回原 Standard 窗口。隐私网址不会转交普通窗口。")
        let stack = NSStackView(views: [status, reason]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 28)])
        Task { @MainActor [weak self] in
            guard let self else { return }
            await session.start()
            switch await session.status() {
            case .connecting: statusLabel.stringValue = "\(mode.rawValue) · 连接中"
            case .connected: statusLabel.stringValue = "\(mode.rawValue) · 已连接"
            case .blocked: statusLabel.stringValue = "\(mode.rawValue) · 已阻断 / Blocked"
            }
        }
    }
    override func close() { Task { await session.stop() }; super.close() }
    func windowWillClose(_ notification: Notification) { Task { await session.stop() } }
    required init?(coder: NSCoder) { nil }
}
