import AppKit
import WebKit
import CryptoKit
import Darwin
import YNXBrowserCore

/// Same executable, explicit headless synthetic test launch. No ordinary window, restore, Wallet,
/// user profile or default search request is created. Normal TLS handling is deliberately retained.
@MainActor final class BrowserSyntheticProbe: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    let plan: BrowserSyntheticProbePlan
    let directory: URL
    private let manifestSHA256: String
    private let ruleStore: WKContentRuleListStore
    private var view: WKWebView?
    private var events: [[String: String]] = []
    private var timer: Timer?
    private var files: [ObjectIdentifier: URL] = [:]
    private let coordinationDirectory: URL
    private let bootstrapHTML: String?
    private var phaseTimer: Timer?
    private var instrumentReady = false
    private var bootstrapCommitted = false
    private var phaseSequence = 0
    private var phases = Set<String>()

    static func requested(_ args: [String]) -> Bool {
        args.contains { $0.hasPrefix("--p05-synthetic-run") || $0.hasPrefix("--p05-probe-manifest") }
    }
    init(arguments: [String]) throws {
        func one(_ prefix: String) throws -> String {
            let items = arguments.filter { $0.hasPrefix(prefix) }
            guard items.count == 1 else { throw PrivacyRouteError.unsafeTarget }
            return String(items[0].dropFirst(prefix.count))
        }
        let runID = try one("--p05-synthetic-run=")
        let path = try one("--p05-probe-manifest=")
        let manifest = URL(fileURLWithPath: path)
        guard path.hasPrefix("/"), (try manifest.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else { throw PrivacyRouteError.unsafeTarget }
        let bytes = try Data(contentsOf: manifest)
        guard bytes.count < 16384 else { throw PrivacyRouteError.unsafeTarget }
        plan = try JSONDecoder().decode(BrowserSyntheticProbePlan.self, from: bytes)
        try plan.validate(expectedRunID: runID)
        coordinationDirectory = manifest.deletingLastPathComponent().resolvingSymlinksInPath()
        if let bootstrap = plan.bootstrap {
            let bytes = try Self.readRunFile(bootstrap.path, under: coordinationDirectory, limit: 131072)
            guard SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == bootstrap.sha256,
                  let html = String(data: bytes, encoding: .utf8) else { throw PrivacyRouteError.unsafeTarget }
            bootstrapHTML = html
        } else { bootstrapHTML = nil }
        for name in [plan.readinessFile, plan.phaseControlFile].compactMap({ $0 }) {
            guard URL(fileURLWithPath: name).resolvingSymlinksInPath().deletingLastPathComponent() == coordinationDirectory else { throw PrivacyRouteError.unsafeTarget }
        }
        manifestSHA256 = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("ynx-p05-probe-\(runID)", isDirectory: true)
        // Existing run state is reconciled, never overwritten or silently replayed.
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw PrivacyRouteError.stale }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let rulesDirectory = directory.appendingPathComponent("content-rules", isDirectory: true)
        try FileManager.default.createDirectory(at: rulesDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        ruleStore = WKContentRuleListStore(url: rulesDirectory)
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.prohibited)
        record("started", "synthetic-only; normal TLS; production admission unchanged")
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await self.waitForCollector()
                self.startWebKit()
            } catch { self.record("blocked", "collector gate rejected or timed out"); NSApp.terminate(nil) }
        }
    }
    private static func readRunFile(_ path: String, under root: URL, limit: Int) throws -> Data {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.deletingLastPathComponent().resolvingSymlinksInPath() == root,
              (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else { throw PrivacyRouteError.unsafeTarget }
        let attributes = try FileManager.default.attributesOfItem(atPath: path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0,
              (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= limit else { throw PrivacyRouteError.unsafeTarget }
        let data = try Data(contentsOf: url)
        guard data.count <= limit else { throw PrivacyRouteError.unsafeTarget }; return data
    }
    private func coordinationJSON(_ path: String) throws -> [String: Any]? {
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        let data = try Self.readRunFile(path, under: coordinationDirectory, limit: 4096)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw PrivacyRouteError.unsafeTarget }; return value
    }
    private func waitForCollector() async throws {
        guard let path = plan.readinessFile else { return }
        record("waitingForCollector", "No WebKit instance or network request created")
        let deadline = ContinuousClock.now.advanced(by: .seconds(30))
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            if let value = try coordinationJSON(path) {
                guard Set(value.keys) == Set(["runID", "manifestSHA256", "ready"]),
                      value["runID"] as? String == plan.runID,
                      value["manifestSHA256"] as? String == manifestSHA256,
                      value["ready"] as? Bool == true else { throw PrivacyRouteError.unsafeTarget }
                record("collectorReady", "Run and manifest bound fixture coordination; not production isolation admission"); return
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw PrivacyRouteError.blocked
    }
    private func startWebKit() {
        do {
            let configuration: WKWebViewConfiguration
            if plan.transport == "direct-negative-control" {
                configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
                configuration.allowsAirPlayForMediaPlayback = false
                record("negativeControl", "Explicit synthetic-only WebKit without product proxy; not protected browsing")
            } else { configuration = try TorRoutedWebViewFactory.configurationForControlledProbe(port: plan.routePort) }
            let rules: [[String: Any]] = [["trigger": ["url-filter": ".*"], "action": ["type": "block"]]] + plan.allowedHosts.flatMap { host in
                ["https", "wss"].map { scheme in
                    let isPublic = self.plan.publicFixture?.origins.contains(where: { $0.host == host }) == true
                    let prefix = isPublic ? "ynx-route-probe/\(self.plan.runID)/" : ""
                    let port = isPublic ? "(:443)?" : "(:[0-9]+)?"
                    return ["trigger": ["url-filter": "^" + scheme + "://" + NSRegularExpression.escapedPattern(for: host) + port + "/" + prefix], "action": ["type": "ignore-previous-rules"]]
                }
            }
            let data = try JSONSerialization.data(withJSONObject: rules)
            ruleStore.compileContentRuleList(forIdentifier: "p05-synthetic-\(plan.runID)", encodedContentRuleList: String(decoding: data, as: UTF8.self)) { [weak self] list, error in
                Task { @MainActor in
                    guard let self else { return }
                    guard let list, error == nil else { self.record("blocked", "content-rule compilation failed"); NSApp.terminate(nil); return }
                    configuration.userContentController.add(list)
                    if self.bootstrapHTML != nil { configuration.userContentController.add(self, name: "p05Probe") }
                    let web = WKWebView(frame: .zero, configuration: configuration)
                    web.navigationDelegate = self; web.uiDelegate = self; self.view = web
                    self.record("loading", self.plan.initialURL.absoluteString)
                    if let html = self.bootstrapHTML, let bootstrap = self.plan.bootstrap {
                        self.record("localInstrumentLoading", "Hash-verified local HTML; not remote TLS page success")
                        web.loadHTMLString(html, baseURL: bootstrap.baseURL)
                        self.startPhaseControl()
                    } else { web.load(URLRequest(url: self.plan.initialURL)) }
                }
            }
            timer = Timer.scheduledTimer(withTimeInterval: Double(plan.durationSeconds), repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in self?.record("stopped", "bounded synthetic observation ended"); NSApp.terminate(nil) }
            }
        } catch { record("blocked", "proxy configuration unavailable"); NSApp.terminate(nil) }
    }
    private func record(_ kind: String, _ detail: String) {
        events.append(["kind": kind, "detail": detail, "at": String(Date().timeIntervalSince1970)])
        let record: [String: Any] = ["schema": "p05-synthetic-browser-probe-v1", "pid": ProcessInfo.processInfo.processIdentifier, "runID": plan.runID,
            "manifestSHA256": manifestSHA256, "evidenceClass": "fixture", "productionRouteAdmission": false, "events": events]
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .prettyPrinted]) { try? data.write(to: directory.appendingPathComponent("browser-events.json"), options: .atomic) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if bootstrapHTML != nil, !bootstrapCommitted, action.targetFrame?.isMainFrame == true,
           (action.request.url?.absoluteString == "about:blank" || action.request.url == plan.bootstrap?.baseURL) { decisionHandler(.allow); return }
        guard let url = action.request.url, plan.allows(url) else { record("blocked", "navigation outside synthetic allowlist"); decisionHandler(.cancel); return }
        decisionHandler(action.shouldPerformDownload ? .download : .allow)
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { bootstrapCommitted = true }
    private func startPhaseControl() {
        phaseTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.instrumentReady, let path = self.plan.phaseControlFile else { return }
                do {
                    guard let value = try self.coordinationJSON(path), value["runID"] as? String == self.plan.runID,
                          let sequence = value["sequence"] as? Int, sequence > self.phaseSequence else { return }
                    guard Set(value.keys) == Set(["runID", "sequence", "phase"]), sequence == self.phaseSequence + 1,
                          let phase = value["phase"] as? String, ["baseline", "after-fault"].contains(phase),
                          !self.phases.contains(phase), (phase == "baseline" ? self.phases.isEmpty : self.phases.contains("baseline")) else { throw PrivacyRouteError.unsafeTarget }
                    self.phaseSequence = sequence; self.phases.insert(phase)
                    self.record("phaseRequested", "\(sequence):\(phase)")
                    self.view?.evaluateJavaScript("window.__p05RunPhase('\(phase)')") { [weak self] _, error in
                        if error != nil { self?.record("blocked", "Local instrument phase execution failed") }
                    }
                } catch { self.record("blocked", "Invalid phase control"); self.phaseTimer?.invalidate(); self.view?.stopLoading() }
            }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === view, message.frameInfo.isMainFrame, let base = plan.bootstrap?.baseURL,
              message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == base.host,
              (message.frameInfo.securityOrigin.port == 0 ? 443 : message.frameInfo.securityOrigin.port) == (base.port ?? 443),
              let value = message.body as? [String: Any], value["runID"] as? String == plan.runID,
              Set(value.keys).isSubset(of: Set(["runID", "phase", "probeID", "kind", "status", "candidateType", "addressFamily"])),
              let phase = value["phase"] as? String, ["startup", "baseline", "after-fault"].contains(phase),
              let kind = value["kind"] as? String, ["bootstrap-ready", "phase-started", "https", "wss", "download", "frame", "rtc", "ice"].contains(kind) else { return }
        if let id = value["probeID"] {
            guard let id = id as? String, id.range(of: "^(baseline|after-fault)-(https|wss|download|cross-origin|rtc)$", options: .regularExpression) != nil else { return }
        }
        if let status = value["status"] {
            let strings = ["rejected", "open", "body-match", "body-mismatch", "http-error", "requested-not-completion", "load-event-not-content-proof", "unavailable-not-no-leak-proof", "offer-created"]
            guard (status as? String).map(strings.contains) == true || (status as? Int).map({ (100...599).contains($0) }) == true else { return }
        }
        if let type = value["candidateType"] {
            guard let type = type as? String, ["host", "srflx", "prflx", "relay", "unknown"].contains(type) else { return }
        }
        if let family = value["addressFamily"] {
            guard let family = family as? String, ["mdns", "ipv4", "ipv6", "unknown"].contains(family) else { return }
        }
        guard let bytes = try? JSONSerialization.data(withJSONObject: value, options: .sortedKeys) else { return }
        if kind == "bootstrap-ready", phase == "startup" { instrumentReady = true }
        record("instrument", String(decoding: bytes, as: UTF8.self))
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) { decisionHandler(response.canShowMIMEType ? .allow : .download) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { record("navigationFinished", "synthetic page loaded; not a route acceptance verdict") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { record("blocked", "TLS/navigation error \((error as NSError).domain):\((error as NSError).code)") }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { record("blocked", "navigation failed \((error as NSError).code)") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { record("blocked", "WebContent terminated"); view?.stopLoading() }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        guard let url = response.url, plan.allows(url) else { completionHandler(nil); return }
        let target = directory.appendingPathComponent("download-\(UUID().uuidString)-\(BrowserDownloadFile.safeFilename(suggestedFilename))")
        files[ObjectIdentifier(download)] = target; completionHandler(target)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let file = files.removeValue(forKey: ObjectIdentifier(download)), let data = try? Data(contentsOf: file) else { record("blocked", "missing synthetic download"); return }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        if let expected = plan.publicFixture?.downloadSHA256, expected != digest { record("blocked", "Synthetic download body mismatch"); return }
        record("downloadFinished", "\(data.count) bytes SHA256:" + digest)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { record("blocked", "synthetic download failed") }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate(); phaseTimer?.invalidate(); view?.configuration.userContentController.removeScriptMessageHandler(forName: "p05Probe"); view?.stopLoading(); record("exited", "no ordinary profile/history/session writes")
        ruleStore.removeContentRuleList(forIdentifier: "p05-synthetic-\(plan.runID)") { _ in }
    }
}
