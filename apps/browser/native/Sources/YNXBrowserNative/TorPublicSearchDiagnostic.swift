#if YNX_PRIVACY_ACCEPTANCE
import AppKit
import CoreFoundation
import Darwin
import Foundation
import WebKit

/// Fixed PUBLIC diagnostic DATA only. This is not an authority, admission or URL input API.
enum TorPublicSearchDiagnosticPolicy {
    static let bundleIdentifier = "com.ynxweb4.browser.qa.tor.public-search"
    static let target = "https://html.duckduckgo.com/html/?q=YNX%20browser"
    static let socksPort: UInt16 = 63779
    static func matchesRole(identifier: String?, marker: Any?) -> Bool {
        guard identifier == bundleIdentifier, let marker = marker as? NSNumber,
              CFGetTypeID(marker) == CFBooleanGetTypeID() else { return false }
        return marker.boolValue
    }
    static func hasIsolatedRoleMetadata(bundle: Bundle, snowflake: Bool) -> Bool {
        let forbidden = ["CFBundleURLTypes", "YNXPrivacyRouteMode", "YNXNymProofHelper"]
            + (snowflake ? [] : ["YNXPublicSnowflakeSearchDiagnostic", "YNXPublicSnowflakeLaunchSHA256", "YNXPublicArtiChannelTimeoutExperiment"])
            + ["YNXPublicNymSearchDiagnostic"]
        return forbidden.allSatisfy { bundle.object(forInfoDictionaryKey: $0) == nil }
    }
    static func accepts(_ request: URLRequest) -> Bool {
        request.url?.absoluteString == target && request.httpMethod == "GET" &&
            request.httpBody == nil && request.httpBodyStream == nil &&
            ["Authorization", "Proxy-Authorization", "Cookie"].allSatisfy { request.value(forHTTPHeaderField: $0) == nil }
    }
    static func acceptsDocument(url: URL?, mime: String?, mainFrame: Bool, attachment: String?) -> Bool {
        mainFrame && url?.absoluteString == target && mime?.lowercased() == "text/html" &&
            !(attachment?.lowercased().contains("attachment") ?? false)
    }
    enum WebsiteResponse: String {
        case htmlCandidate, acceptedNeedsReview, accessRefused, rateLimited, otherHTTP

        init(status: Int) {
            switch status {
            case 200: self = .htmlCandidate
            case 202: self = .acceptedNeedsReview
            case 401, 403: self = .accessRefused
            case 429: self = .rateLimited
            default: self = .otherHTTP
            }
        }

        var detail: String {
            switch self {
            case .htmlCandidate: "已收到 HTML，请人工核对是否包含真实搜索结果。"
            case .acceptedNeedsReview: "网站返回已接受响应，页面内容仍需人工核对。"
            case .accessRefused: "网站拒绝访问。"
            case .rateLimited: "网站限制了请求频率。"
            case .otherHTTP: "请人工核对网站返回的内容。"
            }
        }
    }
    static func contentRules() throws -> String {
        // Native navigation policy separately refuses ALL iframe navigations; WebKit's
        // document resource type does not distinguish main documents from subframes.
        let exact = "^https://html\\.duckduckgo\\.com/html/\\?q=YNX%20browser$"
        let rules: [[String: Any]] = [
            ["trigger": ["url-filter": ".*"], "action": ["type": "block"]],
            ["trigger": ["url-filter": exact, "url-filter-is-case-sensitive": true, "resource-type": ["document"]], "action": ["type": "ignore-previous-rules"]],
            ["trigger": ["url-filter": ".*"], "action": ["type": "block-cookies"]]
        ]
        return String(decoding: try JSONSerialization.data(withJSONObject: rules), as: UTF8.self)
    }
}

/// A rendered diagnostic document, not an interactive browser. Native navigation
/// policy still rejects every follow-on request, including accessibility actions.
@MainActor private final class TorPublicSearchReadOnlyWebView: WKWebView {
    override var acceptsFirstResponder: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { super.hitTest(point) == nil ? nil : self }
    override func mouseDown(with event: NSEvent) {}
    override func mouseUp(with event: NSEvent) {}
    override func rightMouseDown(with event: NSEvent) {}
    override func otherMouseDown(with event: NSEvent) {}
    override func keyDown(with event: NSEvent) {}
    override func menu(for event: NSEvent) -> NSMenu? { nil }
}

/// One button, one fixed PUBLIC query, no ordinary profile/credential/qualification.
/// SOCKS/Lockdown here are diagnostic settings, not evidence of all-flow isolation.
@MainActor final class TorPublicSearchDiagnosticApplicationDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    enum Failure: String, Error { case wrongRole, supplyRejected, scratchRejected, profileRejected, backendLaunchRejected, backendExited, backendPolicyRejected, diagnosticCoverageIncomplete, bootstrapFailed, bootstrapTimedOut, backendLost, ruleListRejected, targetRejected, TLSOrNetworkFailed, tlsFailed, networkFailed, documentTimedOut, cancelled, cleanupUnknown }
    private(set) var firstFailure: Failure?
    private(set) var startupStage = "notStarted" {
        didSet { adapter.publicRuntimeTrace?.record("controllerStage", ["stage": startupStage]) }
    }
    private(set) var firstErrorSummary: String?
    private(set) var firstErrorDomain: String?
    private(set) var firstErrorCode: Int?
    private(set) var firstTypedFailure: String?
    private(set) var backendExitStatus: Int32?
    private(set) var responseStatus: Int?
    private(set) var originalBackendPID: Int32?
    private(set) var launchFailure: (domain: String, code: Int)?
    private(set) var diagnosticDirectory: URL?
    private(set) var resourceDirectory: URL?
    // Managed PT is owned by Arti, not a waitpid child of this app. Never claim its reap.
    var managedTransportExitObservation: String {
        if Self.claimsNym() { return "NYM_DIRECT_CHILD_ONLY; no managed Tor PT" }
        guard snowflakeLaunch != nil else { return "NOT_INDIVIDUALLY_OBSERVED; original Arti managed-PT shutdown only" }
        switch adapter.publicKnownManagedTransportAbsence {
        case true?: return "KNOWN_ORIGINAL_PT_ABSENCE_OBSERVED_NOT_WAITPID; unobserved descendants UNKNOWN"
        case false?: return "KNOWN_ORIGINAL_PT_STILL_PRESENT_NOT_REAPED"
        case nil: return "MANAGED_PT_ABSENCE_UNKNOWN_NOT_WAITPID"
        }
    }
    private let adapter = ArtiProcessAdapter()
    private var nymRuntime: NymPublicSearchRuntime?
    private var firstNymLivenessFailure: NymPublicRuntimeFailure?
    private var snowflakeLaunch: TorSnowflakePublicBrowserBackend.VerifiedLaunch?
    private var diagnosticPort: UInt16 {
        if Self.claimsNym() { return NymPublicSearchRole.port }
        return Self.claimsSnowflake() ? TorSnowflakePublicBrowserBackend.port : TorPublicSearchDiagnosticPolicy.socksPort
    }
    private var backendScopeCurrent: Bool {
        if Self.claimsNym() {
            guard let nymRuntime else { return false }
            do { try nymRuntime.requireBootstrapLive(); return true }
            catch {
                if firstNymLivenessFailure == nil {
                    firstNymLivenessFailure = (error as? NymPublicRuntimeFailure) ?? .bootstrapFailed
                }
                return false
            }
        }
        guard backendDiagnosticFailure == nil else { return false }
        guard let launch = snowflakeLaunch else { return !Self.claimsSnowflake() }
        do { try launch.requireCurrent(); return true } catch { return false }
    }
    private var routedBackendReady: Bool {
        backendScopeCurrent && (Self.claimsNym() || adapter.pollProcess() == .bootstrapReady)
    }
    private let worker = TorStartupOwnership<Void>()
    private var outerStart: Task<Void, Never>?
    private var shutdownTask: Task<Bool, Never>?
    private var watchdog: Task<Void, Never>?
    private var documentTimer: Task<Void, Never>?
    private var lifetime: Task<Void, Never>?
    private var closingTask: Task<Void, Never>?
    private var terminationTask: Task<Void, Never>?
    private var closing = false, attempted = false, allowWindowClose = false, cleanupUnknown = false
    private var pendingStart = false
    private var generation = UUID()
    private var claimedNavigation = false
    private var documentFinished = false
    private var navigation: WKNavigation?
    private var window: NSWindow?
    private var web: WKWebView?
    private var ruleStore: WKContentRuleListStore?
    private var compiledRules: Result<WKContentRuleList, Failure>?
    private var cancelledDownloads: [ObjectIdentifier: WKDownload] = [:]
    private let status = NSTextField(wrappingLabelWithString: "尚未联网。点击按钮仅执行一次固定公开查询。")
    private var beginButton: NSButton?
    var cleanupConfirmed: Bool {
        !pendingStart && !worker.inFlight && !worker.stopping && !cleanupUnknown && web == nil &&
            adapter.processIdentifier == nil && (nymRuntime?.cleanupConfirmed ?? true) && cancelledDownloads.isEmpty
    }
    static func claims(bundle: Bundle = .main) -> Bool {
        let directTor = TorPublicSearchDiagnosticPolicy.matchesRole(identifier: bundle.bundleIdentifier,
            marker: bundle.object(forInfoDictionaryKey: "YNXPublicSearchDiagnostic"))
            && TorPublicSearchDiagnosticPolicy.hasIsolatedRoleMetadata(bundle: bundle, snowflake: false)
        return directTor || claimsSnowflake(bundle: bundle) || claimsNym(bundle: bundle)
    }
    static func claimsSnowflake(bundle: Bundle = .main) -> Bool {
        TorSnowflakePublicBrowserBackend.claims(bundle: bundle)
    }
    static func claimsNym(bundle: Bundle = .main) -> Bool {
        NymPublicSearchRole.claims(bundle)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard Self.claims() else { firstFailure = .wrongRole; NSApp.terminate(nil); return }
        let menu = NSMenu(), appItem = NSMenuItem(), submenu = NSMenu(title: "公开诊断")
        let quit = NSMenuItem(title: "退出诊断", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp; submenu.addItem(quit); appItem.submenu = submenu; menu.addItem(appItem); NSApp.mainMenu = menu
        let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 900, height: 650), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        self.window = window; window.delegate = self; window.isRestorable = false; window.isReleasedWhenClosed = false
        window.title = "YNX · 固定公开搜索网络诊断 · 非匿名浏览"
        window.appearance = NSAppearance(named: .aqua)
        let notice = NSTextField(wrappingLabelWithString: "仅查询 YNX browser。不是匿名浏览或 LeakSafe 验收；系统辅助流量等尚未验证。普通 Tor/Nym 入口仍为 Blocked。不得在此输入或提交个人信息。")
        let target = NSTextField(wrappingLabelWithString: TorPublicSearchDiagnosticPolicy.target)
        let begin = NSButton(title: "执行一次公开查询", target: self, action: #selector(beginOnce)); beginButton = begin
        let close = NSButton(title: "关闭诊断", target: self, action: #selector(closeDiagnostic))
        let buttons = NSStackView(views: [begin, close]); buttons.spacing = 12
        let root = NSStackView(views: [notice, target, buttons, status]); root.orientation = .vertical; root.alignment = .leading; root.spacing = 12
        root.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        for item in [notice, target, status] {
            item.translatesAutoresizingMaskIntoConstraints = false
            item.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
        }
        window.contentView = root; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: false)
    }
    @objc private func beginOnce() {
        guard Self.claims(), !attempted, !closing else { return }
        attempted = true; pendingStart = true; beginButton?.isEnabled = false
        let expected = generation
        status.stringValue = Self.claimsNym()
            ? "连接固定供应的 Nym 后端；尚未提交搜索。此为公开网络诊断。"
            : "连接固定供应的 Tor 后端；尚未提交搜索。此为公开网络诊断。"
        lifetime = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Self.claimsNym() ? 360 : (Self.claimsSnowflake() ? 650 : 690)))
            guard !Task.isCancelled, let self, self.generation == expected else { return }
            self.record(.documentTimedOut); _ = await self.shutdown()
        }
        outerStart = Task { @MainActor [self] in
            do {
                try await worker.start(operation: { [self] in try await startFixedDiagnostic(expected: expected) },
                    cancellationFence: { [weak self] in self?.fence() })
            } catch {
                adapter.publicRuntimeTrace?.record("controllerFailure", ["stage": startupStage,
                    "typedDiagnosticFailure": (error as? Failure)?.rawValue ?? "nonDiagnosticFailure"])
                if !closing { recordObservedError(error) }
                // Outer waiter only; worker.stop must never join itself.
                _ = await shutdown()
            }
        }
    }
    private func requireStarting(_ expected: UUID) throws {
        try requireNoBackendDiagnosticFailure()
        try Task.checkCancellation()
        guard Self.claims(), !closing, expected == generation else { throw Failure.cancelled }
        try snowflakeLaunch?.requireCurrent()
    }
    private func startFixedDiagnostic(expected: UUID) async throws {
        pendingStart = false // This exact owned worker is now inFlight; no wrapper gap.
        try requireStarting(expected)
        let scratch: URL
        if Self.claimsNym() {
            startupStage = "nymStartup"
            let runtime = NymPublicSearchRuntime(onRouteLoss: { [weak self] failure in
                guard let self, !self.closing, self.generation == expected else { return }
                if self.firstNymLivenessFailure == nil { self.firstNymLivenessFailure = failure }
                self.originalBackendPID = self.nymRuntime?.originalBackendPID
                self.diagnosticDirectory = self.nymRuntime?.diagnosticDirectory
                self.fence()
                self.recordObservedError(failure)
                Task { @MainActor [self] in _ = await self.shutdown() }
            })
            nymRuntime = runtime // Adopt before its first child, suspension or cancellation.
            do {
                let endpoint = try await runtime.start()
                guard endpoint.host == "127.0.0.1", endpoint.port == NymPublicSearchRole.port else { throw Failure.backendLaunchRejected }
            } catch {
                originalBackendPID = runtime.originalBackendPID
                diagnosticDirectory = runtime.diagnosticDirectory
                throw error
            }
            originalBackendPID = runtime.originalBackendPID
            guard let directory = runtime.diagnosticDirectory else { throw Failure.scratchRejected }
            scratch = directory; diagnosticDirectory = directory
            resourceDirectory = Bundle.main.resourceURL?.appendingPathComponent("NymPublicRuntime", isDirectory: true)
            try runtime.requireBootstrapLive()
        } else if Self.claimsSnowflake() {
            startupStage = "scopeDescriptorLoad"
            let launch = try TorSnowflakePublicBrowserBackend.load()
            snowflakeLaunch = launch // Adopt before any child/spawn or await.
            scratch = launch.scratch; diagnosticDirectory = scratch
            resourceDirectory = launch.helper.deletingLastPathComponent()
            try adapter.enablePublicRuntimeTrace(directory: scratch, execution: .installedSnowflakePublic)
            try requireStarting(expected)
            startupStage = "backendLaunch"
            try adapter.startPublicSnowflake(launch)
        } else {
        startupStage = "supplyLoad"
        let supply: BundledTorBackend.VerifiedSupply
        supply = try BundledTorBackend.load()
        resourceDirectory = supply.resourceDirectory
        // No profile lookup/copy. Only this freshly-created, owner-only temporary subtree.
        startupStage = "scratchCreate"
        scratch = try Self.freshScratch(); diagnosticDirectory = scratch
        // Only the sealed fixed PUBLIC role can reach this point; normal routes never attach a trace.
        try adapter.enablePublicRuntimeTrace(directory: scratch, execution: .installedPublic)
        startupStage = "profilePrepare"
        let backend = try supply.prepareProfile(applicationSupport: scratch, bridgeSource: .bundledPublic)
        try requireStarting(expected)
        startupStage = "backendLaunch"
        do {
            try adapter.start(pin: backend.pin, port: TorPublicSearchDiagnosticPolicy.socksPort,
                sessionDirectory: backend.directory, deferBootstrap: false, bridge: backend.bridge)
        } catch {
            let value = error as NSError
            let domain = [NSCocoaErrorDomain, NSPOSIXErrorDomain].contains(value.domain) ? value.domain : "OtherBackendLaunchError"
            if launchFailure == nil { launchFailure = (domain, value.code) }
            // Preserve actual platform rejection without raw paths, bridge/config or stderr.
            FileHandle.standardError.write(Data("PUBLIC_SEARCH_BACKEND_LAUNCH_FAILED \(domain) \(value.code)\n".utf8))
            throw error
        }
        }
        if !Self.claimsNym() { originalBackendPID = adapter.processIdentifier }
        startupStage = "bootstrap"
        let bootstrapLimit = ContinuousClock.now.advanced(by: .seconds(600))
        // Scope lifetime is never extended by UI/rule compilation. Reserve original
        // rule30 + fixed-document45 + cleanup25 within the reviewed 650s envelope.
        let end = snowflakeLaunch.map { min(bootstrapLimit, $0.deadline.advanced(by: .seconds(-100))) } ?? bootstrapLimit
        while !routedBackendReady {
            try requireNoBackendDiagnosticFailure()
            try requireStarting(expected)
            if Self.claimsNym() { throw Failure.backendLost }
            switch adapter.pollProcess() {
            case .exited(let code): backendExitStatus = code; throw Failure.backendExited
            case .stopped, .stopping: throw Failure.bootstrapFailed
            default: break
            }
            guard ContinuousClock.now < end else { throw Failure.bootstrapTimedOut }
            try await Task.sleep(for: .milliseconds(100))
        }
        try requireNoBackendDiagnosticFailure()
        startupStage = "contentRules"
        let rulesRoot = scratch.appendingPathComponent("Rules", isDirectory: true)
        try FileManager.default.createDirectory(at: rulesRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        guard let store = WKContentRuleListStore(url: rulesRoot) else { throw Failure.ruleListRejected }
        ruleStore = store
        let encoded = try TorPublicSearchDiagnosticPolicy.contentRules()
        compiledRules = nil
        store.compileContentRuleList(forIdentifier: "fixed-public-search", encodedContentRuleList: encoded) { [weak self] list, error in
            guard let self, !self.closing, self.generation == expected else { return }
            if let list, error == nil { self.compiledRules = .success(list) }
            else { self.compiledRules = .failure(.ruleListRejected) }
        }
        let ruleDeadline = ContinuousClock.now.advanced(by: .seconds(30))
        while compiledRules == nil {
            try requireStarting(expected)
            guard ContinuousClock.now < ruleDeadline else { throw Failure.ruleListRejected }
            try await Task.sleep(for: .milliseconds(25))
        }
        guard let compiledRules else { throw Failure.ruleListRejected }
        let rules = try compiledRules.get(); self.compiledRules = nil
        try requireStarting(expected)
        guard routedBackendReady, snowflakeLaunch?.documentBudgetAvailable != false else { throw Failure.backendLost }
        startupStage = "webViewCreate"
        let configuration = try TorRoutedWebViewFactory.configurationForControlledProbe(port: diagnosticPort)
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.defaultWebpagePreferences.isLockdownModeEnabled = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.userContentController.add(rules)
        // All controls are installed before WK creation. Never use a production factory.
        let view = TorPublicSearchReadOnlyWebView(frame: .zero, configuration: configuration)
        web = view; view.navigationDelegate = self; view.uiDelegate = self; view.allowsBackForwardNavigationGestures = false
        guard let root = window?.contentView as? NSStackView else { throw Failure.cancelled }
        root.addArrangedSubview(view); view.translatesAutoresizingMaskIntoConstraints = false
        view.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
        view.heightAnchor.constraint(greaterThanOrEqualToConstant: 390).isActive = true
        var request = URLRequest(url: URL(string: TorPublicSearchDiagnosticPolicy.target)!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45)
        request.httpMethod = "GET"; request.httpShouldHandleCookies = false
        guard TorPublicSearchDiagnosticPolicy.accepts(request) else { throw Failure.targetRejected }
        try requireStarting(expected)
        guard routedBackendReady, web === view else { throw Failure.backendLost }
        status.stringValue = "已提交一次固定公开查询。网站 JS、子资源、框架、下载和后续导航均被禁用。"
        startupStage = "fixedDocumentLoad"
        navigation = view.load(request)
        guard navigation != nil else { throw Failure.TLSOrNetworkFailed }
        watchdog = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled, let self, !self.closing, self.generation == expected else { return }
                if self.adapter.publicBackendFatal != nil {
                    self.recordObservedError(self.backendDiagnosticFailure ?? .backendPolicyRejected); _ = await self.shutdown(); return
                }
                if !self.routedBackendReady {
                    if !Self.claimsNym(), case .exited(let code) = self.adapter.pollProcess() { self.backendExitStatus = code }
                    self.recordObservedError(Failure.backendLost); _ = await self.shutdown(); return
                }
            }
        }
        documentTimer = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(45))
            guard !Task.isCancelled, let self, !self.closing, !self.documentFinished, self.generation == expected else { return }
            self.record(.documentTimedOut); _ = await self.shutdown()
        }
    }
    private var backendDiagnosticFailure: Failure? {
        guard let fatal = adapter.publicBackendFatal else { return nil }
        return fatal.kind == "diagnosticCoverageIncomplete" ? .diagnosticCoverageIncomplete : .backendPolicyRejected
    }
    private func requireNoBackendDiagnosticFailure() throws {
        if Self.claimsNym(), let failure = nymRuntime?.firstFailure { throw failure }
        if let failure = backendDiagnosticFailure { throw failure }
    }
    private static func freshScratch() throws -> URL {
        let parent = FileManager.default.temporaryDirectory
        var template = Array(parent.appendingPathComponent("ynx-public-search-XXXXXXXX").path.utf8CString)
        let descriptor: Int32 = try template.withUnsafeMutableBufferPointer { buffer in
            guard let created = mkdtemp(buffer.baseAddress) else { throw Failure.scratchRejected }
            let fd = open(created, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { throw Failure.scratchRejected }
            return fd
        }
        defer { close(descriptor) }
        var path = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard fcntl(descriptor, F_GETPATH, &path) == 0 else { throw Failure.scratchRejected }
        let canonical = path.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
        return try validatedScratchURL(descriptor: descriptor, canonicalPath: canonical)
    }
    private static func validatedScratchURL(descriptor: Int32, canonicalPath: String) throws -> URL {
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
              info.st_mode & 0o7777 == 0o700, canonicalPath.hasPrefix("/") else { throw Failure.scratchRejected }
        // Foundation resolvingSymlinksInPath may abbreviate /private/var back to /var.
        // F_GETPATH binds the real vnode path; never re-normalize it through that API.
        let url = canonicalPath.withCString { URL(fileURLWithFileSystemRepresentation: $0, isDirectory: true, relativeTo: nil) }
        guard url.path == canonicalPath else { throw Failure.scratchRejected }
        var walked = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard walked >= 0 else { throw Failure.scratchRejected }
        defer { close(walked) }
        for component in url.pathComponents.dropFirst() {
            let next = openat(walked, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else { throw Failure.scratchRejected }
            close(walked); walked = next
        }
        var reopened = stat()
        guard fstat(walked, &reopened) == 0, reopened.st_dev == info.st_dev, reopened.st_ino == info.st_ino,
              reopened.st_uid == getuid(), reopened.st_mode & 0o7777 == 0o700 else { throw Failure.scratchRejected }
        return url
    }
    private func recordObservedError(_ observedError: Error) {
        let error: Error = firstNymLivenessFailure.map { $0 as Error }
            ?? backendDiagnosticFailure.map { $0 as Error } ?? observedError
        if firstErrorSummary == nil {
            let value = error as NSError
            let domain = value.domain.range(of: "^[A-Za-z0-9_.-]{1,160}$", options: .regularExpression) != nil ? value.domain : "OtherNSErrorDomain"
            let typed: String
            if let failure = error as? BundledTorBackend.Failure { typed = "BundledTorBackend." + failure.rawValue }
            else if let failure = error as? NymPublicRuntimeFailure { typed = "NymPublicRuntimeFailure." + failure.rawValue }
            else if let failure = error as? TorPlatformError { typed = "TorPlatformError." + String(describing: failure) }
            else if let failure = error as? Failure { typed = "Diagnostic." + failure.rawValue }
            else { typed = "NSError" }
            firstErrorDomain = domain; firstErrorCode = value.code; firstTypedFailure = typed
            var summary = "stage=\(startupStage) \(typed) \(domain):\(value.code)"
            if Self.claimsNym(), let stage = nymRuntime?.firstStage { summary += " nymStage=" + stage.rawValue }
            if let originalBackendPID { summary += " pid=\(originalBackendPID)" }
            if let backendExitStatus { summary += " exitStatus=\(backendExitStatus)" }
            let knownStops = ["explicit-stop", "network-path-changed", "network-unavailable", "system-sleep", "system-wake", "fixed-public-diagnostic-stop"]
            if let reason = adapter.lastStopReason { summary += " stop=" + (knownStops.contains(reason) ? reason : "other") }
            if let fatal = adapter.publicBackendFatal { summary += " backendDiagnostic=" + fatal.summary }
            firstErrorSummary = summary
        }
        let failure: Failure
        if let exact = error as? Failure { failure = exact }
        else if startupStage == "supplyLoad" { failure = .supplyRejected }
        else if startupStage == "scopeDescriptorLoad" { failure = .profileRejected }
        else if startupStage == "scratchCreate" { failure = .scratchRejected }
        else if startupStage == "profilePrepare" { failure = .profileRejected }
        else if startupStage == "backendLaunch" { failure = .backendLaunchRejected }
        else if startupStage == "contentRules" { failure = .ruleListRejected }
        else if (error as NSError).domain == NSURLErrorDomain {
            failure = [-1200, -1201, -1202, -1203, -1204, -1205, -1206].contains((error as NSError).code) ? .tlsFailed : .networkFailed
        } else if startupStage == "fixedDocumentLoad" { failure = .TLSOrNetworkFailed }
        else { failure = .bootstrapFailed }
        record(failure)
    }
    private func record(_ observedFailure: Failure) {
        let failure = backendDiagnosticFailure ?? observedFailure
        if firstFailure == nil { firstFailure = failure }
        if firstFailure == .diagnosticCoverageIncomplete {
            status.stringValue = "观察预算已耗尽，本次公开诊断停止；后续网络阶段未确认。不会重试、直连或轮换出口。隐私资格未改变。"
            if let firstErrorSummary { status.stringValue += " " + firstErrorSummary }
            return
        }
        status.stringValue = "公开诊断未完成：\(firstFailure!.rawValue)。不会重试、直连或轮换出口。隐私资格未改变。"
        if let firstErrorSummary { status.stringValue += " \(firstErrorSummary)" }
    }
    private func fence() {
        closing = true; generation = UUID(); beginButton?.isEnabled = false
        watchdog?.cancel(); watchdog = nil; documentTimer?.cancel(); documentTimer = nil; lifetime?.cancel(); lifetime = nil
        let retiring = web; web = nil; navigation = nil
        retiring?.stopLoading(); retiring?.navigationDelegate = nil; retiring?.uiDelegate = nil
        if let retiring, let root = window?.contentView as? NSStackView { root.removeArrangedSubview(retiring) }
        retiring?.removeFromSuperview()
        compiledRules = nil
    }
    func shutdown() async -> Bool {
        if let shutdownTask { return await shutdownTask.value }
        outerStart?.cancel()
        fence() // Revoke requests synchronously, before joining the owned worker.
        let task = Task { @MainActor [self] () -> Bool in
            await worker.stop(fence: { [self] in fence() }, reap: { [self] in
                if let nymRuntime {
                    let end = ContinuousClock.now.advanced(by: .seconds(45))
                    let stopped = await nymRuntime.stop()
                    while !cancelledDownloads.isEmpty, ContinuousClock.now < end {
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                    cleanupUnknown = !stopped || !nymRuntime.cleanupConfirmed || !cancelledDownloads.isEmpty
                    return
                }
                adapter.stop(reason: "fixed-public-diagnostic-stop")
                // New fixed helper may need its original 25s cleanup deadline +
                // bounded flush. Keep this Root alive to observe known PT absence.
                let end = ContinuousClock.now.advanced(by: .seconds(snowflakeLaunch == nil ? 20 : 30))
                @MainActor func managedPending() -> Bool {
                    snowflakeLaunch != nil && originalBackendPID != nil && adapter.publicKnownManagedTransportAbsence != true
                }
                while (adapter.processIdentifier != nil || !cancelledDownloads.isEmpty || managedPending()), ContinuousClock.now < end {
                    _ = adapter.pollProcess()
                    try? await Task.sleep(for: .milliseconds(100))
                }
                _ = adapter.pollProcess()
                cleanupUnknown = adapter.processIdentifier != nil || !cancelledDownloads.isEmpty || managedPending()
                adapter.publicRuntimeTrace?.record("controllerManagedTransportStopObservation", [
                    "observation": managedTransportExitObservation, "notWaitpid": true,
                    "directArtiExitObserved": adapter.processIdentifier == nil, "cleanupUnknown": cleanupUnknown])
            })
            pendingStart = false // Closed worker prevents even a late outer wrapper from starting.
            // Never delete the profile or claim individual managed-PT waitpid/reaping.
            ruleStore = nil
            adapter.publicRuntimeTrace?.checkpoint("controllerShutdownCheckpoint")
            if cleanupUnknown { record(.cleanupUnknown) }
            return cleanupConfirmed
        }
        shutdownTask = task
        let result = await task.value
        shutdownTask = nil; outerStart = nil
        return result
    }
    @objc private func closeDiagnostic() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if cleanupConfirmed { return .terminateNow }
        guard terminationTask == nil else { return .terminateLater }
        terminationTask = Task { @MainActor [self] in
            let confirmed = await shutdown(); sender.reply(toApplicationShouldTerminate: confirmed); terminationTask = nil
        }
        return .terminateLater
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowWindowClose || cleanupConfirmed { return true }
        if closingTask == nil {
            closingTask = Task { @MainActor [self] in
                if await shutdown() { allowWindowClose = true; sender.close() }
                closingTask = nil
            }
        }
        return false
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        preferences.allowsContentJavaScript = false; preferences.isLockdownModeEnabled = true
        guard !closing, web === webView, !claimedNavigation, action.targetFrame?.isMainFrame == true,
              !action.shouldPerformDownload, TorPublicSearchDiagnosticPolicy.accepts(action.request), routedBackendReady else {
            decisionHandler(.cancel, preferences); return
        }
        claimedNavigation = true; decisionHandler(.allow, preferences)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        guard !closing, web === webView, let http = response.response as? HTTPURLResponse,
            TorPublicSearchDiagnosticPolicy.acceptsDocument(url: http.url, mime: http.mimeType,
            mainFrame: response.isForMainFrame, attachment: http.value(forHTTPHeaderField: "Content-Disposition")), response.canShowMIMEType,
            routedBackendReady else {
            decisionHandler(.cancel)
            if !closing, web === webView, response.isForMainFrame { record(.targetRejected); Task { _ = await shutdown() } }
            return
        }
        responseStatus = http.statusCode
        let observation = TorPublicSearchDiagnosticPolicy.WebsiteResponse(status: http.statusCode)
        adapter.publicRuntimeTrace?.record("publicSearchHTTPResponse", ["httpStatus": http.statusCode, "observation": observation.rawValue])
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        guard web === webView, !closing else { return }
        webView.stopLoading(); documentTimer?.cancel(); record(.targetRejected); Task { _ = await shutdown() }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !closing, web === webView, self.navigation === navigation, webView.url?.absoluteString == TorPublicSearchDiagnosticPolicy.target,
              routedBackendReady else { return }
        guard let code = responseStatus else { record(.targetRejected); Task { _ = await shutdown() }; return }
        documentFinished = true; documentTimer?.cancel(); documentTimer = nil
        let observation = TorPublicSearchDiagnosticPolicy.WebsiteResponse(status: code)
        adapter.publicRuntimeTrace?.record("publicSearchDocumentFinished", ["httpStatus": code, "observation": observation.rawValue])
        status.stringValue = "公开诊断返回 HTTP \(code)。\(observation.detail)"
        // No app-side JS observer is injected and no verification is automated.
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(webView, error: error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(webView, error: error) }
    private func navigationFailed(_ view: WKWebView, error: Error) {
        guard !closing, web === view else { return }
        documentTimer?.cancel(); recordObservedError(error); Task { _ = await shutdown() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard web === webView else { return }; record(.TLSOrNetworkFailed); Task { _ = await shutdown() }
    }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard !closing, web === webView, challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == "html.duckduckgo.com", challenge.protectionSpace.port == 443,
              routedBackendReady else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.performDefaultHandling, nil) // Normal system TLS only, no trust override or account prompt.
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    private func refuseDownload(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        guard cancelledDownloads[key] == nil else { return }
        cancelledDownloads[key] = download
        download.cancel { [weak self, download] _ in
            guard let self, self.cancelledDownloads[key] === download else { return }
            self.cancelledDownloads.removeValue(forKey: key)
        }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { refuseDownload(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { refuseDownload(download) }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) { completionHandler(nil) }
}
#endif
