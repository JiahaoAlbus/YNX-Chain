#if YNX_PRIVACY_ACCEPTANCE
import Foundation

enum ProtectedSyntheticWindowFailure: Error { case alreadyStarted, closing, cleanupUnconfirmed }

/// Actual startup ownership shared by the window and the headless delta probe. The
/// work Task never calls shutdown itself: errors return to start's OUTER waiter,
/// which may safely join that already-completed Task before partial cleanup.
@MainActor final class ProtectedSyntheticLifecycle<Value: Sendable> {
    private var startup: Task<Value, Error>?
    private var shutdownTask: Task<Bool, Never>?
    private var started = false
    private(set) var closing = false
    private(set) var cleanupConfirmed = true
    private(set) var firstFailure: Error?
    func requireStarting() throws {
        try Task.checkCancellation()
        guard started, !closing else { throw ProtectedSyntheticWindowFailure.closing }
    }
    func start(operation: @escaping @MainActor () async throws -> Value,
               fence: @escaping @MainActor () -> Void,
               cleanup: @escaping @MainActor () async -> Bool) async throws -> Value {
        guard !started, !closing else { throw ProtectedSyntheticWindowFailure.alreadyStarted }
        started = true; cleanupConfirmed = false
        let work = Task { @MainActor [self] in
            do {
                let value = try await operation()
                try requireStarting()
                return value
            } catch {
                if firstFailure == nil { firstFailure = error }
                throw error
            }
        }
        startup = work
        do {
            let value = try await work.value
            try requireStarting()
            return value
        } catch {
            if firstFailure == nil { firstFailure = error }
            _ = await shutdown(fence: fence, cleanup: cleanup)
            throw firstFailure ?? error
        }
    }
    func shutdown(fence: @escaping @MainActor () -> Void,
                  cleanup: @escaping @MainActor () async -> Bool) async -> Bool {
        if let shutdownTask { return await shutdownTask.value }
        closing = true; cleanupConfirmed = false
        startup?.cancel()
        fence() // Synchronous Root/authority/page withdrawal BEFORE either await.
        let originalStartup = startup
        let work = Task { @MainActor [self] in
            // Partial owners are adopted by operation before each requireStarting check.
            // Join actual startup before observing provider state or claiming cleanup.
            if let originalStartup { _ = await originalStartup.result }
            let confirmed = await cleanup()
            cleanupConfirmed = confirmed
            if confirmed { startup = nil }
            else if firstFailure == nil { firstFailure = ProtectedSyntheticWindowFailure.cleanupUnconfirmed }
            return confirmed
        }
        shutdownTask = work
        let confirmed = await work.value
        if !confirmed { shutdownTask = nil } // Retain exact partials; a later explicit close may rejoin.
        return confirmed
    }
}

#if !YNX_SYNTHETIC_LIFECYCLE_PROBE
import AppKit
import YNXBrowserCore

/// A separate compile-time QA window. It has no omnibox, homepage, restore or production grant.
@MainActor final class ProtectedSyntheticWindowController: NSWindowController, NSWindowDelegate {
    private let mode: PrivacyRouteMode
    private var protection: BrowserRouteProtection?
    private var authority: SyntheticTrialAuthority?
    private var provider: (any PrivacyRouteProvider)?
    private var cleanup: @MainActor () async -> Bool = { true }
    private var session: PrivacySyntheticTrialSession?
    private var page: RoutedBrowserPage?
    private let lifecycle = ProtectedSyntheticLifecycle<ProtectedAcceptanceAttachment>()
    private let label = NSTextField(wrappingLabelWithString: "合成流量安全验收 · Connecting。尚未获准用于隐私浏览。")
    init(mode: PrivacyRouteMode) {
        self.mode = mode
        let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 760, height: 520),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "\(mode.rawValue) · Synthetic QA · Not approved"
        window.appearance = NSAppearance(named: .aqua)
        window.isRestorable = false; window.isReleasedWhenClosed = false
        super.init(window: window); window.delegate = self
        label.frame = NSRect(x: 28, y: 360, width: 700, height: 120)
        window.contentView?.addSubview(label)
    }
    func start(runID: String, inputs: ProtectedAcceptanceTrialInputs) async throws -> ProtectedAcceptanceAttachment {
        try SyntheticTrialAuthority.signingPreflight()
        do {
            return try await lifecycle.start(operation: { [self] in try await performStart(runID: runID, inputs: inputs) },
                fence: { [self] in fenceStartup() }, cleanup: { [self] in await cleanupOriginalOwners() })
        } catch {
            label.stringValue = "Blocked · 合成验收未就绪；未授予正式隐私浏览权限。"
            throw error
        }
    }
    private func performStart(runID: String, inputs: ProtectedAcceptanceTrialInputs) async throws -> ProtectedAcceptanceAttachment {
        try lifecycle.requireStarting()
        do {
            let owner: BrowserRouteProtection
            let authority: SyntheticTrialAuthority
            let endpoint: PrivacyRouteEndpoint
            if mode == .tor {
                let prepared = try await BrowserRouteProtection.prepareAcceptance(mode: mode, runID: runID, inputs: inputs) { [weak self] _ in
                    self?.page?.block("合成验收保护连接已失效。")
                }
                owner = prepared.0; authority = prepared.1
                protection = owner; self.authority = authority // Adopt partials before the cancellation fence.
                try lifecycle.requireStarting()
                let tor = try TorProtectedRouteProvider(acceptanceAuthority: authority, protection: owner,
                    helperSHA256: Bundle.main.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String ?? "",
                    explicitUserAction: UUID())
                provider = tor; cleanup = { await tor.awaitCleanupConfirmation() }
                endpoint = try await tor.start()
                try lifecycle.requireStarting()
            } else {
                let nym = try NymModeRouteFactory.makeSynthetic(runID: runID, explicitUserAction: UUID(), epochFactory: { [weak self] purpose in
                    let prepared = try await BrowserRouteProtection.prepareAcceptance(mode: .nym, runID: runID, inputs: inputs) { [weak self] _ in
                        if case .runtime = purpose { self?.page?.block("合成验收保护连接已失效。") }
                    }
                    // This epoch can arrive after window close; retire it before throwing.
                    do {
                        guard let self else { throw PrivacyRouteError.stale }
                        try self.lifecycle.requireStarting()
                        return try NymSyntheticEpoch(protection: prepared.0, authority: prepared.1, manifestURL: inputs.manifestURL)
                    } catch { prepared.1.revoke(); prepared.0.close(); throw error }
                })
                provider = nym; cleanup = { await nym.awaitCleanupConfirmation() }
                endpoint = try await nym.start()
                try lifecycle.requireStarting()
                guard let epoch = nym.syntheticEpoch else { throw PrivacyRouteError.blocked }
                owner = epoch.protection; authority = epoch.authority
                protection = owner; self.authority = authority
            }
            try lifecycle.requireStarting()
            guard let provider else { throw PrivacyRouteError.blocked }
            let trial = try PrivacySyntheticTrialSession(authority: authority, provider: provider, endpoint: endpoint)
            session = trial
            try trial.installRevocationHandler { [weak self] in self?.page?.block("合成验收权限已撤销。") }
            try await trial.start()
            try lifecycle.requireStarting()
            guard let window else { throw PrivacyRouteError.blocked }
            let page = try RoutedBrowserPage(mode: mode, window: window, session: trial, protection: owner)
            self.page = page; window.contentView = page.view
            window.styleMask.insert(.resizable); window.setContentSize(NSSize(width: 1000, height: 700))
            return ProtectedAcceptanceAttachment(protection: owner, page: page, authority: authority)
        } catch {
            page?.block("合成验收未就绪。")
            // The lifecycle's outer waiter joins this completed work before partial cleanup.
            // Never await shutdown here: that would join this very startup Task.
            throw error
        }
    }
    private func fenceStartup() {
        page?.block("合成验收窗口已关闭。")
        authority?.revoke(); protection?.close()
    }
    private func cleanupOriginalOwners() async -> Bool {
        // A preparation that returned during cancellation may have been adopted after
        // the first synchronous fence. Withdraw it again before stopping actual owners.
        fenceStartup()
        if let session { await session.stop() }
        else { await provider?.stop() }
        let backendClosed = await cleanup()
        let downloadsClosed = await page?.awaitDownloadRetirement() ?? true
        return backendClosed && downloadsClosed
    }
    func shutdown() async -> Bool {
        await lifecycle.shutdown(fence: { [self] in fenceStartup() }, cleanup: { [self] in await cleanupOriginalOwners() })
    }
    func presentCleanupBlocked() {
        label.stringValue = "Blocked · 后台退出尚未确认，保留原控制对象。"
        window?.title = "\(mode.rawValue) · Synthetic QA · Cleanup unknown"
        showWindow(nil)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if await self.shutdown() { sender.orderOut(nil) }
            else { self.presentCleanupBlocked() }
        }
        return false
    }
    required init?(coder: NSCoder) { nil }
}
#endif // !YNX_SYNTHETIC_LIFECYCLE_PROBE
#endif
