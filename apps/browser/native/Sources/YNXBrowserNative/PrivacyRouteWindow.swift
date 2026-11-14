import AppKit
import YNXBrowserCore

/// A separate window with no WebKit instance until a route AND platform isolation are admitted.
/// No address, restore state, Wallet session, native download or AI context enters the ordinary controller.
@MainActor final class PrivacyRouteWindowController: NSWindowController, NSWindowDelegate {
    let mode: PrivacyRouteMode
    private var session: PrivacyRouteSession?
    private let statusLabel = NSTextField(labelWithString: "")
    private var protection: BrowserRouteProtection?
    private var page: RoutedBrowserPage?
    private var closing = false
    private var startupRefused = false
    private var startupTask: Task<Void, Never>?
    private var shutdownTask: Task<Bool, Never>?
    private var cleanup: @MainActor () async -> Bool = { true }
    private var backendFailureDetail: @MainActor () -> String? = { nil }
    private var refreshReadiness: @MainActor () -> Void = {}
    init(mode: PrivacyRouteMode) {
        self.mode = mode
        let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 720, height: 520), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "\(mode.rawValue) · 已阻断"
        window.appearance = NSAppearance(named: .aqua)
        window.isRestorable = false; window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        var protectionDetail = ""
        do {
            let lost: @MainActor (ProtectionLeaseFailure) -> Void = { [weak self] failure in
                guard let self, !self.closing else { return }
                self.setStatus("已阻断")
                self.page?.block("保护连接已失效。")
                Task { await self.session?.block("Protection lease lost: \(failure.rawValue)"); self.refreshReadiness() }
            }
            protection = try BrowserRouteProtection(mode: mode, onLeaseLost: lost)
        } catch ProtectionLeaseFailure.signingNotConfigured {
            recordRefusal(.signingNotConfigured)
            protectionDetail = "\n\n系统过滤组件尚未配置开发者签名，保护控制通道未启动。"
        } catch let failure as RoutedQualificationFailure {
            recordRefusal(failure)
            switch failure {
            case .signingNotConfigured:
                protectionDetail = "\n\n尚未配置经核准的 Apple 开发者团队签名，保护控制通道未启动。"
            case .qualificationIssuerNotSupplied:
                protectionDetail = "\n\n签名身份检查通过后，仍需原发行负责人的整窗安全资格供应接口；当前尚未接通，未启动路线。"
            default:
                protectionDetail = "\n\n安装版安全资格已拒绝或失效：\(failure.rawValue)。保护控制通道未启动。"
            }
        } catch {
            recordRefusal(.invalidSignature)
            protectionDetail = "\n\n保护组件身份校验未通过，保护控制通道未启动。"
        }
        if let protection {
            do {
                if mode == .tor {
                    let provider = TorProtectedRouteProvider(protection: protection,
                        helperSHA256: Bundle.main.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String ?? "",
                        explicitUserAction: UUID())
                    session = try protection.makeSession(provider: provider)
                    cleanup = { await provider.awaitCleanupConfirmation() }
                    backendFailureDetail = { provider.firstFailure.map { Self.failureMessage($0.rawValue, mode: .tor) } }
                } else {
                    let provider = try NymModeRouteFactory.make(protection: protection, explicitUserAction: UUID())
                    session = try protection.makeSession(provider: provider)
                    cleanup = { await provider.awaitCleanupConfirmation() }
                    backendFailureDetail = { provider.firstFailure.map { Self.failureMessage($0.rawValue, mode: .nym) } }
                }
            } catch {
                startupRefused = true; protection.close()
                recordRefusal((error as? RoutedQualificationFailure) ?? .closed)
                protectionDetail = "\n\n专属身份、受保护 DNS 或已核启动资料尚未就绪，未启动客户端。"
            }
        }
        let status = statusLabel
        status.stringValue = "\(mode.rawValue) · 已阻断 / Blocked"
        status.font = .systemFont(ofSize: 22, weight: .semibold)
        let reason = NSTextField(wrappingLabelWithString: "正在检查此安装版的安全资格。\(protectionDetail)\n\n\(readinessDescription())\n\n搜索网站的验证码、地区限制或出口拒绝不作为路由安全判定。普通浏览可在原 Standard 窗口继续；隐私网址不会转交普通窗口。")
        let detail = protectionDetail
        refreshReadiness = { [weak self, weak reason] in
            guard let self, let reason else { return }
            let outcome = self.backendFailureDetail() ?? "当前隐私窗口未获准加载网页。"
            reason.stringValue = "\(outcome)\(detail)\n\n\(self.readinessDescription())\n\n搜索网站的验证码、地区限制或出口拒绝不作为路由安全判定。普通浏览可在原 Standard 窗口继续；隐私网址不会转交普通窗口。"
        }
        let stack = NSStackView(views: [status, reason]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 28)])
        refreshReadiness()
        startupTask = Task { @MainActor [weak self] in
            guard let self, let session, !startupRefused, !closing, !Task.isCancelled else { return }
            await session.start {
                setStatus("连接中")
                reason.stringValue = self.mode == .tor ? "正在等待 Tor 网桥和出口就绪。" : "正在检查目录、网关和 Mixnet 出口。"
            }
            guard !closing, !Task.isCancelled else { return }
            let status = await session.status()
            guard !closing, !Task.isCancelled else { return }
            switch status {
            case .connected:
                do { try showConnectedPage(session: session); return }
                catch {
                    protection?.close()
                    await session.block("Protected page creation was refused")
                    guard !closing, !Task.isCancelled else { return }
                }
            case .blocked, .connecting: break
            }
            setStatus("已阻断")
            refreshReadiness()
        }
    }
    private func recordRefusal(_ failure: RoutedQualificationFailure) {
        session = PrivacyRouteSession(provider: mode == .tor ? TorRouteProvider() : NymRouteAdapter(), qualification: .failure(failure))
    }
    private func showConnectedPage(session: PrivacyRouteSession) throws {
        guard !closing, let protection, let window,
              session.readiness.releaseApproved.state == .ready else { throw PrivacyRouteError.blocked }
        let protectedPage = try RoutedBrowserPage(mode: mode, window: window, session: session, protection: protection)
        page = protectedPage; window.contentView = protectedPage.view
        window.styleMask.insert(.resizable); window.minSize = NSSize(width: 760, height: 520)
        window.setContentSize(NSSize(width: 1000, height: 700))
        setStatus("已连接")
        protectedPage.openHome()
    }
    private func setStatus(_ status: String) {
        let title = "\(mode.rawValue) · \(status)"
        statusLabel.stringValue = title
        window?.title = title
    }
    private static func failureMessage(_ reason: String, mode: PrivacyRouteMode) -> String {
        switch (mode, reason) {
        case (.tor, TorCoordinatorFailure.bootstrapTimedOut.rawValue), (.tor, TorCoordinatorFailure.transportStartupTimedOut.rawValue):
            "Tor 网桥或引导超时。关闭窗口后可以重新选择 Tor。"
        case (.nym, NymProtectedFailure.directoryFailed.rawValue):
            "Nym 目录读取失败。关闭窗口后可以重新选择 Nym。"
        case (.nym, NymProtectedFailure.gatewayFailed.rawValue):
            "Nym 网关连接失败。关闭窗口后可以重新选择 Nym。"
        case (.nym, NymProtectedFailure.proofNotSupplied.rawValue), (.nym, NymProtectedFailure.proofScopeNotSupplied.rawValue):
            "此安装版缺少 Nym 出口验证所需的资料。"
        case (.tor, TorCoordinatorFailure.helperPinMissing.rawValue), (.tor, TorCoordinatorFailure.codeRejected.rawValue),
             (.nym, NymProtectedFailure.helperPinMissing.rawValue), (.nym, NymProtectedFailure.supplyRejected.rawValue):
            "路由组件缺失或校验失败。"
        default:
            "\(mode.rawValue) 路线未就绪（\(reason)）。"
        }
    }
    private func readinessDescription() -> String {
        guard let state = session?.readiness else { return "" }
        func line(_ name: String, _ check: PrivacyRouteReadiness.Check) -> String {
            "\(name): \(check.state) — \(check.reason)"
        }
        let failed = PrivacyRouteReadiness.LeakSurface.allCases.filter { state.leakSafe.check($0).state == .failed }.map(\.rawValue)
        let remaining = PrivacyRouteReadiness.LeakSurface.allCases.filter { state.leakSafe.check($0).state != .ready && state.leakSafe.check($0).state != .failed }.map(\.rawValue)
        let leakDetail = failed.isEmpty && remaining.isEmpty ? state.leakSafe.currentRoute.reason
            : "failed: \(failed.joined(separator: ", ")); unverified: \(remaining.joined(separator: ", "))"
        return [line("TransportReady", state.transportReady), line("BrowserRouteReady", state.browserRouteReady),
                "LeakSafe: \(state.leakSafe.state) — \(leakDetail)", line("SearchAvailable", state.searchAvailable),
                line("ReleaseApproved", state.releaseApproved)].joined(separator: "\n")
    }
    func shutdown() async -> Bool {
        if let shutdownTask { return await shutdownTask.value }
        closing = true; protection?.close(); startupTask?.cancel(); startupTask = nil; page?.block("隐私窗口已关闭。")
        let task = Task { @MainActor [self] in
            await session?.stop()
            let backendClosed = await cleanup()
            let downloadsClosed = await page?.awaitDownloadRetirement() ?? true
            return backendClosed && downloadsClosed
        }
        shutdownTask = task
        let confirmed = await task.value
        shutdownTask = nil
        return confirmed
    }
    func presentCleanupBlocked() {
        closing = true; statusLabel.stringValue = "\(mode.rawValue) · 已阻断；后台退出尚未确认"
        page?.block("后台退出尚未确认，请重试退出。")
        window?.title = "\(mode.rawValue) · 已阻断"
        showWindow(nil); window?.makeKeyAndOrderFront(nil)
    }
    override func close() { closing = true; protection?.close(); Task { _ = await shutdown() }; super.close() }
    func windowWillClose(_ notification: Notification) { closing = true; protection?.close(); Task { _ = await shutdown() } }
    required init?(coder: NSCoder) { nil }
}
