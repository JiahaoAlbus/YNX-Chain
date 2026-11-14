#if YNX_PRIVACY_ACCEPTANCE
import AppKit
import CoreFoundation
import Darwin
import Network
import Security
import WebKit
import YNXBrowserCore

enum BrowserInteractiveRouteExperimentRole: String, CaseIterable {
    case launcher = "com.ynxweb4.browser.qa.interactive"
    case tor = "com.ynxweb4.browser.qa.tor.interactive"
    case nym = "com.ynxweb4.browser.qa.nym.interactive"

    static let marker = "YNXInteractiveRouteExperiment"
    private static let conflictingKeys = [
        "CFBundleURLTypes", "YNXPrivacyRouteMode", "YNXNymProofHelper", "YNXNymProofHelperSHA256", "YNXPublicSearchDiagnostic",
        "YNXPublicSnowflakeSearchDiagnostic", "YNXPublicNymSearchDiagnostic",
        "YNXPublicSnowflakeLaunchSHA256", "YNXPublicArtiChannelTimeoutExperiment",
        "YNXNormalArtifactCaptureRole", "YNXRouteFilterProviderSHA256"
    ]

    static func requested(identifier: String?, metadata: [String: Any]) -> Bool {
        identifier.flatMap(Self.init(rawValue:)) != nil || metadata[marker] != nil
    }

    static func claim(identifier: String?, metadata: [String: Any]) -> Self? {
        guard let role = identifier.flatMap(Self.init(rawValue:)),
              let marker = metadata[marker] as? NSNumber,
              CFGetTypeID(marker) == CFBooleanGetTypeID(), marker.boolValue,
              conflictingKeys.allSatisfy({ metadata[$0] == nil }) else { return nil }
        return role
    }

    static func claim(_ bundle: Bundle) -> Self? {
        claim(identifier: bundle.bundleIdentifier, metadata: bundle.infoDictionary ?? [:])
    }

    var name: String {
        switch self { case .launcher: "Tor / Nym"; case .tor: "Tor"; case .nym: "Nym" }
    }

    var childName: String? {
        switch self { case .launcher: nil; case .tor: "Tor Interactive QA.app"; case .nym: "Nym Interactive QA.app" }
    }
}

enum BrowserInteractiveRouteExperimentFailure: String, Error {
    case wrongRole, bundleUnavailable, bundleIdentityMismatch, bundleSignatureInvalid
    case startupTimedOut, backendExited, listenerUnavailable, routeLost, routeExpired
}

struct BrowserInteractiveTorFailure: Error {
    enum Interruption: String {
        case networkPathChanged = "network-path-changed"
        case networkUnavailable = "network-unavailable"
        case systemSleep = "system-sleep"
        case systemWake = "system-wake"
    }
    let exitCode: Int32?
    let interruption: Interruption?

    init(exitCode: Int32?, stopReason: String?) {
        self.exitCode = exitCode
        interruption = stopReason.flatMap(Interruption.init(rawValue:))
    }

    var display: String {
        [interruption.map { "Tor 路由中断（\($0.rawValue)）。" },
         exitCode.map { "Tor 后端已退出（状态 \($0)）。" }].compactMap { $0 }.joined(separator: " ")
    }
}

enum BrowserInteractiveRouteExperimentPolicy {
    static func destination(_ url: URL?, mode: PrivacyRouteMode) -> URL? {
        guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = components.host?.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")),
              !host.isEmpty, !host.contains("%"), host != "localhost", !host.hasSuffix(".localhost"), !host.hasSuffix(".local"),
              components.user == nil, components.password == nil,
              components.port.map({ (1...65_535).contains($0) }) ?? true else { return nil }
        if (host == "onion" || host.hasSuffix(".onion")), !PrivacyRouteWebTarget.allows(url, mode: mode) { return nil }
        // Reject literal loopback/LAN targets before handing them to WebKit.
        // Hostnames are neither resolved nor classified locally.
        if host.withCString({ address in
            var v4 = in_addr(), v6 = in6_addr()
            if inet_aton(address, &v4) != 0 {
                let number = UInt32(bigEndian: v4.s_addr), first = number >> 24, pair = number >> 16
                return [0, 10, 127].contains(first) || first >= 224
                    || (pair >= 0x6440 && pair <= 0x647f) || pair == 0xa9fe || (pair >= 0xac10 && pair <= 0xac1f) || pair == 0xc0a8
            }
            let bare = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            guard bare.withCString({ inet_pton(AF_INET6, $0, &v6) }) == 1 else { return false }
            return withUnsafeBytes(of: v6) { bytes in
                // The first public IPv6 experiment covers global unicast, including
                // neither IPv4-mapped loopback nor interface-local IPv6.
                bytes[0] & 0xe0 != 0x20
            }
        }) { return nil }
        return url
    }

    static func address(_ value: String, mode: PrivacyRouteMode) -> URL? {
        let input = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty, !input.hasPrefix("//"),
              input.rangeOfCharacter(from: .controlCharacters) == nil,
              !input.contains("\\") else { return nil }
        let hostPattern = #"^(?:\[[0-9A-Fa-f:.]+\]|[^\s/?#:@\[\]]+\.[^\s/?#:@\[\]]*|localhost)(?::[0-9]+)?(?:[/?#][^\s]*)?$"#
        // Recognize host/port before the existing keyword resolver. Qualified
        // .onion input goes through the existing Tor-specific validation.
        if input.range(of: hostPattern, options: [.caseInsensitive, .regularExpression]) != nil,
           let url = URL(string: "https://" + input),
           let host = URLComponents(url: url, resolvingAgainstBaseURL: false)?.host?.lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: ".")),
           host != "onion", !host.hasSuffix(".onion") {
            return destination(url, mode: mode)
        }
        return destination(try? BrowserOmnibox.resolveOmnibox(input, allowTorOnion: mode == .tor), mode: mode)
    }

    @MainActor static func configurePreferences(_ preferences: WKWebpagePreferences) {
        preferences.allowsContentJavaScript = true
        preferences.isLockdownModeEnabled = true
    }

    static func installedChild(_ role: BrowserInteractiveRouteExperimentRole, in launcher: URL) throws -> URL {
        guard let name = role.childName else { throw BrowserInteractiveRouteExperimentFailure.wrongRole }
        let child = launcher.appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true).appendingPathComponent(name, isDirectory: true)
        guard child.resolvingSymlinksInPath().path == child.path,
              let bundle = Bundle(url: child) else { throw BrowserInteractiveRouteExperimentFailure.bundleUnavailable }
        guard BrowserInteractiveRouteExperimentRole.claim(bundle) == role else {
            throw BrowserInteractiveRouteExperimentFailure.bundleIdentityMismatch
        }
        try requireSealedBundle(child)
        return child
    }

    static func requireSealedBundle(_ url: URL) throws {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode),
                nil) == errSecSuccess else { throw BrowserInteractiveRouteExperimentFailure.bundleSignatureInvalid }
    }
}

/// Darwin's current process tuple plus the generation of its exact IPv4 TCP
/// listener. A fixed port or a readiness log alone cannot bind an owned proxy.
struct BrowserInteractiveRouteListener: Equatable {
    let pid: Int32
    let startedSeconds: UInt64
    let startedMicroseconds: UInt64
    let generation: UInt64

    private static func ownedChild(_ pid: Int32) -> proc_bsdinfo? {
        guard pid > 1 else { return nil }
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_ppid == UInt32(getpid()), info.pbi_uid == getuid() else { return nil }
        return info
    }

    static func observe(pid: Int32, port: UInt16) -> Self? {
        guard let first = ownedChild(pid) else { return nil }
        let itemSize = Int32(MemoryLayout<proc_fdinfo>.stride)
        let size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
        guard size > 0, size <= 4096 * itemSize, size % itemSize == 0 else { return nil }
        var fds = [proc_fdinfo](repeating: .init(), count: Int(size / itemSize))
        let resultSize = fds.withUnsafeMutableBytes { proc_pidinfo(pid, PROC_PIDLISTFDS, 0, $0.baseAddress, size) }
        guard resultSize > 0, resultSize <= size, resultSize % itemSize == 0 else { return nil }
        var generation: UInt64?
        for fd in fds.prefix(Int(resultSize / itemSize)) where fd.proc_fdtype == PROX_FDTYPE_SOCKET {
            var socket = socket_fdinfo()
            let length = Int32(MemoryLayout<socket_fdinfo>.size)
            guard proc_pidfdinfo(pid, fd.proc_fd, PROC_PIDFDSOCKETINFO, &socket, length) == length,
                  socket.psi.soi_kind == SOCKINFO_TCP, socket.psi.soi_protocol == IPPROTO_TCP,
                  socket.psi.soi_proto.pri_tcp.tcpsi_state == TSI_S_LISTEN else { continue }
            let address = socket.psi.soi_proto.pri_tcp.tcpsi_ini
            guard UInt16(truncatingIfNeeded: address.insi_lport).bigEndian == port,
                  address.insi_vflag & UInt8(INI_IPV4) != 0,
                  address.insi_laddr.ina_46.i46a_addr4.s_addr == UInt32(INADDR_LOOPBACK).bigEndian else { continue }
            let value = address.insi_gencnt
            guard value != 0, generation.map({ $0 == value }) ?? true else { return nil }
            generation = value
        }
        guard let generation, let last = ownedChild(pid),
              first.pbi_start_tvsec == last.pbi_start_tvsec, first.pbi_start_tvusec == last.pbi_start_tvusec else { return nil }
        return .init(pid: pid, startedSeconds: last.pbi_start_tvsec, startedMicroseconds: last.pbi_start_tvusec,
                     generation: generation)
    }
}

@MainActor final class BrowserInteractiveRouteExperimentApplicationDelegate: NSObject,
    NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    typealias Role = BrowserInteractiveRouteExperimentRole
    typealias Failure = BrowserInteractiveRouteExperimentFailure

    static func roleRequested(bundle: Bundle = .main) -> Bool {
        Role.requested(identifier: bundle.bundleIdentifier, metadata: bundle.infoDictionary ?? [:])
    }

    static func claims(bundle: Bundle = .main) -> Bool { Role.claim(bundle) != nil }

    private var role: Role?
    private var window: NSWindow?
    private var webContainer: NSView?
    private var web: WKWebView?
    private let status = NSTextField(wrappingLabelWithString: "")
    private let address = NSTextField()
    private var navigationControls: [NSControl] = []
    private var connectButton: NSButton?
    private var torConnection: NSPopUpButton?
    private let tor = ArtiProcessAdapter()
    private var torScratch: NymPublicScratch?
    private var torTransport: URL?
    private var observedTransportChildren: [Int32: (seconds: UInt64, microseconds: UInt64)] = [:]
    private var nym: NymPublicSearchRuntime?
    private var listener: BrowserInteractiveRouteListener?
    private var startupDeadline: ContinuousClock.Instant?
    private var startup: Task<Void, Never>?
    private var watcher: Task<Void, Never>?
    private var expiration: Task<Void, Never>?
    private var cleanup: Task<Bool, Never>?
    private var firstError: String?
    private var attempted = false
    private var fenced = false
    private var cleaned = false
    private var quitting = false
    private var launching = Set<Role>()

    private static let torPort: UInt16 = 63781
    private var routePort: UInt16 { role == .nym ? NymPublicSearchRole.port : Self.torPort }
    private var routeMode: PrivacyRouteMode { role == .nym ? .nym : .tor }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let role = Role.claim(.main) else { NSApp.terminate(nil); return }
        do { try BrowserInteractiveRouteExperimentPolicy.requireSealedBundle(Bundle.main.bundleURL) }
        catch { NSApp.presentError(error); NSApp.terminate(nil); return }
        self.role = role
        let menu = NSMenu()
        let appMenu = NSMenuItem()
        appMenu.submenu = NSMenu()
        let quit = NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        appMenu.submenu?.addItem(quit)
        menu.addItem(appMenu)
        NSApp.mainMenu = menu

        let title = "YNX · \(role.name) 试验 · 防泄漏未验收"
        let notice = NSTextField(wrappingLabelWithString: "仅用于测试公开网页。整窗防泄漏尚未验收，请勿登录账户或输入敏感信息。连接失效会关闭页面。")
        let root = NSStackView(views: [notice])
        root.orientation = .vertical; root.alignment = .leading; root.spacing = 10
        root.edgeInsets = NSEdgeInsets(top: 14, left: 16, bottom: 14, right: 16)
        if role == .launcher {
            root.addArrangedSubview(NSStackView(views: [
                button("打开 Tor 测试窗口", #selector(openTor)), button("打开 Nym 测试窗口", #selector(openNym))
            ]))
            status.stringValue = "请选择要连接的路由。"
        } else {
            buildRouteControls(in: root)
        }
        root.addArrangedSubview(status)
        for text in [notice, status] {
            text.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
        }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: role == .launcher ? 230 : 690),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = title; window.delegate = self; window.isRestorable = false; window.isReleasedWhenClosed = false
        window.contentView = root
        self.window = window
        window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: false)
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        NSButton(title: title, target: self, action: action)
    }

    private func buildRouteControls(in root: NSStackView) {
        let connect = button("连接", #selector(begin)); connectButton = connect
        let goButton = button("前往", #selector(go)), backButton = button("后退", #selector(back))
        let forwardButton = button("前进", #selector(forward)), reloadButton = button("刷新", #selector(reload))
        navigationControls = [address, goButton, backButton, forwardButton, reloadButton]
        address.placeholderString = "输入地址或搜索关键词"; address.target = self; address.action = #selector(go)
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let bar = NSStackView(views: [connect, backButton, forwardButton, reloadButton, address, goButton])
        if role == .tor {
            let connection = NSPopUpButton(frame: .zero, pullsDown: false)
            connection.addItems(withTitles: ["Tor 直连中继", "已核验的 obfs4 网桥"])
            torConnection = connection
            bar.insertArrangedSubview(connection, at: 0)
        }
        root.addArrangedSubview(bar)
        bar.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
        setNavigationEnabled(false)
        let pane = NSView()
        root.addArrangedSubview(pane)
        pane.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
        pane.heightAnchor.constraint(greaterThanOrEqualToConstant: 440).isActive = true
        pane.setContentHuggingPriority(.defaultLow, for: .vertical)
        webContainer = pane
        status.stringValue = "尚未连接。"
    }

    @objc private func openTor() { launch(.tor) }
    @objc private func openNym() { launch(.nym) }

    private func launch(_ requested: Role) {
        guard role == .launcher, !launching.contains(requested) else { return }
        do {
            let url = try BrowserInteractiveRouteExperimentPolicy.installedChild(requested, in: Bundle.main.bundleURL)
            launching.insert(requested)
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            configuration.createsNewApplicationInstance = false
            NSWorkspace.shared.openApplication(at: url, configuration: configuration) { [weak self] app, error in
                let accepted = error == nil && app?.bundleIdentifier == requested.rawValue && app?.bundleURL == url
                let failure = error.map { ($0 as NSError).domain + " " + String(($0 as NSError).code) }
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.launching.remove(requested)
                    self.status.stringValue = accepted ? "已打开 \(requested.name) 测试窗口。" :
                        "未能打开 \(requested.name) 测试窗口。\(failure ?? "应用身份不符")"
                }
            }
        } catch { status.stringValue = "未能打开 \(requested.name) 测试窗口。\(Self.summary(error))" }
    }

    @objc private func begin() {
        guard let role, role != .launcher, !attempted, !fenced else { return }
        attempted = true; connectButton?.isEnabled = false
        torConnection?.isEnabled = false
        let useTorBridge = role == .tor && torConnection?.indexOfSelectedItem == 1
        status.stringValue = "正在连接 \(role.name)…"
        let end = ContinuousClock.now.advanced(by: .seconds(role == .nym ? 360 : 690))
        startupDeadline = end
        expiration = Task { @MainActor [weak self] in
            do { try await ContinuousClock().sleep(until: end) } catch { return }
            self?.fail(Failure.routeExpired)
        }
        startup = Task { @MainActor [self] in
            do {
                let pid = try await startBackend(role, useTorBridge: useTorBridge)
                try requireStartup()
                guard let original = BrowserInteractiveRouteListener.observe(pid: pid, port: routePort) else {
                    throw Failure.listenerUnavailable
                }
                listener = original
                try requireRoute()
                try mountWebView()
                startupDeadline = nil
                expiration?.cancel(); expiration = nil
                status.stringValue = "已连接 \(role.name)。请输入公开网页地址或搜索关键词。"
                setNavigationEnabled(true)
                monitor()
            } catch {
                if !fenced { fail(error) }
            }
        }
    }

    private func startBackend(_ role: Role, useTorBridge: Bool) async throws -> Int32 {
        try requireStartup()
        if role == .nym {
            let runtime = NymPublicSearchRuntime(interactiveBundle: .main, onRouteLoss: { [weak self] failure in
                self?.fail(failure)
            })
            nym = runtime
            let endpoint = try await runtime.start()
            try requireStartup()
            guard endpoint.host == "127.0.0.1", endpoint.port == routePort, let pid = runtime.processIdentifier else {
                throw Failure.listenerUnavailable
            }
            return pid
        }
        let scratch = try NymPublicScratch.create(); torScratch = scratch
        let prepared = try BundledTorBackend.load().prepareProfile(applicationSupport: scratch.url)
        try requireStartup()
        // The selected transport is fixed for this fresh attempt. Both options
        // use Tor for web requests; a failed bootstrap never changes transport.
        let bridge = useTorBridge ? prepared.bridge : nil
        torTransport = bridge?.transport
        try tor.start(pin: prepared.pin, port: routePort, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: bridge)
        let end = ContinuousClock.now.advanced(by: .seconds(600))
        while true {
            observeTorTransport()
            if try torIsReady() { break }
            try requireStartup()
            guard tor.processIdentifier != nil else { throw Failure.backendExited }
            guard ContinuousClock.now < end else { throw Failure.startupTimedOut }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard let pid = tor.processIdentifier else { throw Failure.backendExited }
        return pid
    }

    private func requireStartup() throws {
        try Task.checkCancellation()
        guard !fenced else { throw Failure.routeLost }
        if let startupDeadline, ContinuousClock.now >= startupDeadline { throw Failure.startupTimedOut }
    }

    private func requireRoute() throws {
        try requireStartup()
        let pid: Int32?
        if let nym {
            try nym.requireBootstrapLive()
            pid = nym.processIdentifier
        } else {
            observeTorTransport()
            guard try torIsReady() else { throw Failure.backendExited }
            pid = tor.processIdentifier
        }
        guard let pid, let listener, BrowserInteractiveRouteListener.observe(pid: pid, port: routePort) == listener else {
            throw Failure.listenerUnavailable
        }
    }

    private func torIsReady() throws -> Bool {
        let state = tor.pollProcess()
        if case .exited(let code) = state {
            throw BrowserInteractiveTorFailure(exitCode: code, stopReason: tor.lastStopReason)
        }
        let interruption = BrowserInteractiveTorFailure(exitCode: nil, stopReason: tor.lastStopReason)
        if interruption.interruption != nil { throw interruption }
        return state == .bootstrapReady
    }

    private func observeTorTransport() {
        guard let executable = torTransport?.path, let parent = tor.processIdentifier else { return }
        for child in TorPublicRuntimeTrace.observedChildPIDs(parent: parent) {
            var info = proc_bsdinfo(), path = [CChar](repeating: 0, count: 4096)
            guard proc_pidinfo(child, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
                    == MemoryLayout<proc_bsdinfo>.size,
                  info.pbi_ppid == UInt32(parent), info.pbi_uid == getuid(),
                  proc_pidpath(child, &path, UInt32(path.count)) > 0,
                  path.withUnsafeBufferPointer({ String(cString: $0.baseAddress!) }) == executable else { continue }
            observedTransportChildren[child] = (info.pbi_start_tvsec, info.pbi_start_tvusec)
        }
    }

    private var knownTorTransportStillPresent: Bool {
        observedTransportChildren.contains { pid, expected in
            var info = proc_bsdinfo()
            errno = 0
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            let result = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size)
            if result == size {
                return info.pbi_start_tvsec == expected.seconds && info.pbi_start_tvusec == expected.microseconds
            }
            return errno != ESRCH
        }
    }

    private func mountWebView() throws {
        guard let webContainer else { throw Failure.routeLost }
        let configuration = try TorRoutedWebViewFactory.configurationForControlledProbe(port: routePort)
        BrowserInteractiveRouteExperimentPolicy.configurePreferences(configuration.defaultWebpagePreferences)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        try requireRoute()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self; view.uiDelegate = self
        view.translatesAutoresizingMaskIntoConstraints = false
        webContainer.addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: webContainer.leadingAnchor), view.trailingAnchor.constraint(equalTo: webContainer.trailingAnchor),
            view.topAnchor.constraint(equalTo: webContainer.topAnchor), view.bottomAnchor.constraint(equalTo: webContainer.bottomAnchor)
        ])
        web = view
    }

    private func monitor() {
        watcher = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
                guard let self, !self.fenced else { return }
                do { try self.requireRoute() } catch { self.fail(error); return }
            }
        }
    }

    private func withRoute(_ action: (WKWebView) -> Void) {
        guard let web, !fenced else { return }
        do { try requireRoute(); action(web) } catch { fail(error) }
    }

    @objc private func go() {
        guard let url = BrowserInteractiveRouteExperimentPolicy.address(address.stringValue, mode: routeMode) else {
            status.stringValue = "无法打开此地址。请输入 HTTP、HTTPS 地址或搜索关键词。"; return
        }
        withRoute { $0.load(URLRequest(url: url, timeoutInterval: 60)) }
    }
    @objc private func back() { withRoute { _ = $0.goBack() } }
    @objc private func forward() { withRoute { _ = $0.goForward() } }
    @objc private func reload() { withRoute { _ = $0.reload() } }

    private func setNavigationEnabled(_ enabled: Bool) {
        for control in navigationControls { control.isEnabled = enabled }
    }

    private static func summary(_ error: Error) -> String {
        if let value = error as? BrowserInteractiveTorFailure { return value.display }
        if let value = error as? Failure { return value.rawValue }
        if let value = error as? NymPublicRuntimeFailure { return value.rawValue }
        let value = error as NSError
        return "\(value.domain) \(value.code)"
    }

    private func fail(_ error: Error) {
        guard !fenced else { return }
        firstError = firstError ?? Self.summary(error)
        fence()
        status.stringValue = "路由已停止。\(firstError ?? Failure.routeLost.rawValue)"
        if let failure = error as? NymPublicRuntimeFailure, failure == .timedOut || failure == .staleDirectory {
            status.stringValue += " 当前窗口的 Nym 路由已到期。请关闭此窗口，再从启动器打开新的 Nym 测试窗口。"
        }
        Task { @MainActor [self] in _ = await stop() }
    }

    private func fence() {
        fenced = true; listener = nil
        setNavigationEnabled(false); connectButton?.isEnabled = false
        watcher?.cancel(); watcher = nil; expiration?.cancel(); expiration = nil
        startup?.cancel()
        let previous = web; web = nil
        previous?.stopLoading(); previous?.navigationDelegate = nil; previous?.uiDelegate = nil
        previous?.removeFromSuperview()
    }

    private func stop() async -> Bool {
        if cleaned { return true }
        if let cleanup { return await cleanup.value }
        fence()
        let original = startup
        // Stop the exact backend first to release a blocked startup, then join it.
        let task = Task { @MainActor [self] in
            let finished: Bool
            if let nym {
                finished = await nym.stop()
            } else {
                observeTorTransport()
                tor.stop()
                let end = ContinuousClock.now.advanced(by: .seconds(torTransport == nil ? 20 : 30))
                while (tor.processIdentifier != nil || knownTorTransportStillPresent), ContinuousClock.now < end {
                    observeTorTransport()
                    _ = tor.pollProcess()
                    try? await Task.sleep(for: .milliseconds(100))
                }
                _ = tor.pollProcess()
                finished = tor.processIdentifier == nil && !knownTorTransportStillPresent
            }
            await original?.value
            return finished
        }
        cleanup = task
        let result = await task.value
        cleanup = nil; startup = nil; cleaned = result
        if !result { status.stringValue += " 后端清理未确认。" }
        return result
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard role != .launcher, attempted, !cleaned else { return true }
        NSApp.terminate(nil)
        return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard attempted, !cleaned else { return .terminateNow }
        if quitting { return .terminateLater }
        quitting = true
        Task { @MainActor [self] in
            let canExit = await stop()
            quitting = false
            sender.reply(toApplicationShouldTerminate: canExit)
        }
        return .terminateLater
    }

    func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        BrowserInteractiveRouteExperimentPolicy.configurePreferences(preferences)
        guard !fenced, web === view, action.targetFrame != nil, !action.shouldPerformDownload,
              BrowserInteractiveRouteExperimentPolicy.destination(action.request.url, mode: routeMode) != nil else {
            decisionHandler(.cancel, preferences); return
        }
        do { try requireRoute(); decisionHandler(.allow, preferences) }
        catch { decisionHandler(.cancel, preferences); fail(error) }
    }

    func webView(_ view: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        guard !fenced, web === view, response.canShowMIMEType, let http = response.response as? HTTPURLResponse,
              BrowserInteractiveRouteExperimentPolicy.destination(http.url, mode: routeMode) != nil,
              http.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") != true else {
            decisionHandler(.cancel); return
        }
        do { try requireRoute(); decisionHandler(.allow) }
        catch { decisionHandler(.cancel); fail(error) }
    }

    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        guard web === view else { return }
        withRoute { current in
            address.stringValue = current.url?.absoluteString ?? ""
            status.stringValue = "页面已载入。整窗防泄漏尚未验收。"
        }
    }

    func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { pageFailed(view, error) }
    func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { pageFailed(view, error) }
    private func pageFailed(_ view: WKWebView, _ error: Error) {
        guard web === view, !fenced else { return }
        withRoute { _ in
            let result = error as NSError
            if result.domain != NSURLErrorDomain || result.code != NSURLErrorCancelled {
                status.stringValue = "网页载入失败。\(Self.summary(error))"
            }
        }
    }

    func webView(_ view: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard !fenced, web === view, challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        do { try requireRoute(); completionHandler(.performDefaultHandling, nil) }
        catch { completionHandler(.cancelAuthenticationChallenge, nil); fail(error) }
    }

    func webViewWebContentProcessDidTerminate(_ view: WKWebView) {
        if web === view { fail(Failure.routeLost) }
    }
    func webView(_ view: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ view: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.cancel { _ in } }
    func webView(_ view: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.cancel { _ in } }
    func webView(_ view: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) { completionHandler(nil) }
    func webView(_ view: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
}
#endif
