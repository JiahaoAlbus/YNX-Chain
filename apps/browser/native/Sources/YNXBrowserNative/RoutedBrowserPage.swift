import AppKit
import WebKit
import YNXBrowserCore
import CryptoKit

/// Dedicated routed-process UI. It has no ordinary profile, restore/history, Wallet callback,
/// AI context or provider preference. Construction requires both live controls and OS admission.
@MainActor final class RoutedBrowserPage: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let view: NSView
    private var web: WKWebView?
    private let protection: BrowserRouteProtection
    private let session: any PrivacyRouteRequestAuthorizing
    private weak var window: NSWindow?
    private let mode: PrivacyRouteMode
    private let address = NSTextField()
    private let status = NSTextField(labelWithString: "")
    private var blocked = false
    private var activeNavigation: ObjectIdentifier?
    private var downloadNavigation: ObjectIdentifier?
    private let destinationDecisions = BrowserDownloadDecisionLedger()
    private var destinationTickets: [ObjectIdentifier: BrowserDownloadDecision] = [:]
    private var tickets: [ObjectIdentifier: UInt64] = [:]
    private var files: [ObjectIdentifier: RoutedDownloadFileLease] = [:]
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var panels: [ObjectIdentifier: NSSavePanel] = [:]
    private let downloadRetirement = RoutedDownloadRetirement()
    private var siteResponseStatus: Int?
    private var searchObservation: Task<Void, Never>?
    private var searchGeneration = UUID()
    private var searchObservationFinished = false
    private var requestedURL: URL?
    #if YNX_PRIVACY_ACCEPTANCE
    var acceptanceRecord: ((String, [String: String]) -> Void)?
    private var acceptanceAttached = false
    private var acceptanceDownloads: [ObjectIdentifier: UUID] = [:]
    private var acceptanceProgress: [ObjectIdentifier: NSKeyValueObservation] = [:]
    func installAcceptanceBootstrap(html: String, baseURL: URL, handler: any WKScriptMessageHandler) throws {
        guard !acceptanceAttached, !blocked, let web, web.url == nil else { throw PrivacyRouteError.stale }
        try authorize(baseURL)
        acceptanceAttached = true
        web.configuration.userContentController.removeScriptMessageHandler(forName: "p05Acceptance")
        web.configuration.userContentController.add(handler, name: "p05Acceptance")
        web.loadHTMLString(html, baseURL: baseURL)
    }
    func performAcceptancePhase(_ phase: String) async throws {
        guard acceptanceAttached, !blocked, let web, ["baseline", "fault-retry", "user-retry"].contains(phase) else { throw PrivacyRouteError.unsafeTarget }
        try authorizeProtection()
        _ = try await web.evaluateJavaScript("window.__p05Acceptance.begin('\(phase)')")
    }
    func removeAcceptanceHandler() {
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "p05Acceptance")
        acceptanceRecord = nil; acceptanceProgress.removeAll(); acceptanceDownloads.removeAll()
    }
    func acceptanceCloseSnapshot() -> [String: String] {
        ["blocked": String(blocked), "webViewRetained": String(web != nil),
         "pendingDownloads": String(tickets.count), "pendingDestinationDecisions": String(destinationDecisions.pendingCount),
         "pendingDownloadRetirements": String(downloadRetirement.pendingCount), "savePanels": String(panels.count)]
    }
    func acceptanceInFlightDownloadIDs() -> Set<String> {
        guard acceptanceAttached, !blocked, web != nil else { return [] }
        return Set(acceptanceDownloads.compactMap { id, evidenceID in
            guard let download = downloads[id], download.progress.completedUnitCount >= 16384,
                  tickets[id] != nil, files[id]?.state == .pending,
                  panels[id] == nil, destinationTickets[id] == nil else { return nil }
            return evidenceID.uuidString.lowercased()
        })
    }
    private func recordAcceptance(_ kind: String, id: ObjectIdentifier, fields: [String: String] = [:]) {
        guard let observer = acceptanceRecord, let key = acceptanceDownloads[id] else { return }
        observer(kind, fields.merging(["downloadID": key.uuidString.lowercased()]) { first, _ in first })
    }
    private func recordAcceptanceDownloadFailure(_ id: ObjectIdentifier) {
        let evidenceID = acceptanceDownloads.removeValue(forKey: id)
        acceptanceProgress.removeValue(forKey: id)
        guard let evidenceID else { return }
        acceptanceRecord?("download-failed", ["downloadID": evidenceID.uuidString.lowercased(), "committed": "false"])
    }
    #endif

    init(mode: PrivacyRouteMode, window: NSWindow, session: any PrivacyRouteRequestAuthorizing, protection: BrowserRouteProtection) throws {
        guard let endpoint = session.endpoint else { throw PrivacyRouteError.blocked }
        self.mode = mode; self.window = window; self.session = session; self.protection = protection
        let web: WKWebView
        #if YNX_PRIVACY_ACCEPTANCE
        if session is PrivacySyntheticTrialSession { web = try protection.makeSyntheticWebView(endpoint: endpoint) }
        else { web = try protection.makeWebView(endpoint: endpoint) }
        #else
        web = try protection.makeWebView(endpoint: endpoint)
        #endif
        self.web = web
        let root = NSStackView(); root.orientation = .vertical; root.spacing = 0
        self.view = root
        super.init()
        address.placeholderString = "DuckDuckGo 搜索或 HTTPS 网址"; address.font = .systemFont(ofSize: 14)
        address.target = self; address.action = #selector(go)
        // Synthetic qualification has only its reviewed bootstrap, never an ordinary URL input.
        address.isEnabled = session is PrivacyRouteSession
        address.setAccessibilityLabel("\(mode.rawValue) 地址或 DuckDuckGo 查询")
        let bar = NSStackView(views: [button("chevron.left", "后退", #selector(back)), button("chevron.right", "前进", #selector(forward)), button("arrow.clockwise", "重新载入", #selector(reload)), address])
        bar.spacing = 10; bar.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        let separator = NSBox(); separator.boxType = .separator
        status.font = .systemFont(ofSize: 12); status.maximumNumberOfLines = 2
        status.stringValue = session is PrivacyRouteSession
            ? "\(mode.rawValue) · 不写入 YNX 浏览历史；保存的文件仍保留在所选文件夹。"
            : "\(mode.rawValue) · 合成流量安全验收，尚未获准用于隐私浏览。"
        let footer = NSStackView(views: [status]); footer.edgeInsets = NSEdgeInsets(top: 7, left: 12, bottom: 7, right: 12)
        let contentViews: [NSView] = [bar, separator, web, footer]
        for item in contentViews { root.addArrangedSubview(item); item.translatesAutoresizingMaskIntoConstraints = false; item.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true }
        address.widthAnchor.constraint(greaterThanOrEqualToConstant: 350).isActive = true
        web.heightAnchor.constraint(greaterThanOrEqualToConstant: 320).isActive = true
        web.navigationDelegate = self; web.uiDelegate = self
        try session.confirmBrowserRouteBinding()
        try protection.observePageInvalidation { [weak self] in self?.block("保护连接已失效。") }
    }
    private func button(_ symbol: String, _ label: String, _ action: Selector) -> NSButton {
        let item = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: label)!, target: self, action: action)
        item.bezelStyle = .texturedRounded; item.setAccessibilityLabel(label); return item
    }
    func openHome() { load("https://duckduckgo.com/") }
    func block(_ reason: String) {
        guard !blocked else { return }; blocked = true
        protection.close()
        // Resolve pending destinations before cancelling panels or WebKit can reenter.
        destinationDecisions.close(); destinationTickets.removeAll()
        let retiringWeb = web
        web = nil // Release this owner's strong reference; a hidden WKWebView is not a closed view.
        invalidateSearchObservation()
        // Own cancellation before removing the WK view or triggering any terminal delegate.
        for download in Array(downloads.values) { cancelDownload(download) }
        for file in files.values { file.revoke() }
        files.removeAll()
        retiringWeb?.stopLoading(); retiringWeb?.navigationDelegate = nil; retiringWeb?.uiDelegate = nil
        retiringWeb?.removeFromSuperview()
        if let retiringWeb, let root = view as? NSStackView { root.removeArrangedSubview(retiringWeb) }
        activeNavigation = nil; downloadNavigation = nil
        #if YNX_PRIVACY_ACCEPTANCE
        retiringWeb?.configuration.userContentController.removeScriptMessageHandler(forName: "p05Acceptance")
        acceptanceRecord?("blocked", ["nativeWebViewRemoved": "true"])
        removeAcceptanceHandler()
        #endif
        if let root = view as? NSStackView {
            let heading = NSTextField(labelWithString: "\(mode.rawValue) · 已阻断")
            heading.font = .systemFont(ofSize: 18, weight: .semibold)
            let explanation = NSTextField(wrappingLabelWithString: "保护路由不可用。请关闭此窗口，再重新选择路线；网址不会交给普通窗口。")
            let notice = NSStackView(views: [heading, explanation]); notice.orientation = .vertical; notice.alignment = .leading; notice.spacing = 12
            notice.edgeInsets = NSEdgeInsets(top: 32, left: 24, bottom: 32, right: 24)
            root.insertArrangedSubview(notice, at: min(2, root.arrangedSubviews.count))
            notice.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true
            notice.heightAnchor.constraint(greaterThanOrEqualToConstant: 300).isActive = true
        }
        address.isEnabled = false
        let pendingPanels = Array(panels.values); panels.removeAll()
        tickets.removeAll()
        for panel in pendingPanels {
            if let parent = panel.sheetParent { parent.endSheet(panel, returnCode: .cancel) }
            panel.orderOut(nil)
        }
        status.stringValue = "\(mode.rawValue) · 已阻断。\(reason) 不会转为直连。"
        window?.title = "\(mode.rawValue) · 已阻断"
    }
    func awaitDownloadRetirement() async -> Bool { await downloadRetirement.awaitClosure() }
    private func authorizeProtection() throws {
        #if YNX_PRIVACY_ACCEPTANCE
        if session is PrivacySyntheticTrialSession { try protection.authorizeSyntheticRequest(); return }
        #endif
        try protection.authorizeNewRequest()
    }
    private func authorize(_ url: URL) throws {
        guard !blocked else { throw PrivacyRouteError.blocked }
        try authorizeProtection(); try session.authorize(url)
    }
    private func authorize(_ request: URLRequest) throws {
        guard !blocked, let url = request.url else { throw PrivacyRouteError.blocked }
        try authorizeProtection()
        #if YNX_PRIVACY_ACCEPTANCE
        if let trial = session as? PrivacySyntheticTrialSession {
            try trial.authorize(request: request)
            return
        }
        #endif
        try session.authorize(url)
    }
    private func load(_ input: String) {
        do {
            guard session is PrivacyRouteSession, let web, !blocked else { throw PrivacyRouteError.blocked }
            let url = try BrowserOmnibox.resolveOmnibox(input, provider: .duckDuckGo, allowTorOnion: mode == .tor)
            try authorize(url); address.stringValue = url.absoluteString
            invalidateSearchObservation()
            requestedURL = url
            if isSearchWebsite(url) { recordSearchAvailability(.init(state: .checking, reason: "Search website requested through the current route; results not yet verified")) }
            web.load(URLRequest(url: url)); status.stringValue = "\(mode.rawValue) · 正在载入"
        } catch {
            let protocols = mode == .tor ? "仅支持 HTTPS 和有效的 Tor v3 .onion 地址。" : "请使用 HTTPS。"
            status.stringValue = "当前隐私路线不可用，或网址不受支持。\(protocols)不会直连。"
        }
    }
    @objc private func go() { load(address.stringValue) }
    @objc private func back() { do { guard !blocked, let web, let url = web.backForwardList.backItem?.url else { return }; try authorize(url); invalidateSearchObservation(); web.goBack() } catch { block("保护状态已失效。") } }
    @objc private func forward() { do { guard !blocked, let web, let url = web.backForwardList.forwardItem?.url else { return }; try authorize(url); invalidateSearchObservation(); web.goForward() } catch { block("保护状态已失效。") } }
    @objc private func reload() { guard !blocked, let web, let url = web.url else { return }; do { try authorize(url); invalidateSearchObservation(); web.reload() } catch { block("保护状态已失效。") } }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard !blocked, let web, web === webView else { decisionHandler(.cancel); return }
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        do {
            if url.scheme == "about", action.targetFrame?.isMainFrame == false,
               ["about:blank", "about:srcdoc"].contains(url.absoluteString), let document = web.url { try authorize(document) }
            else if action.shouldPerformDownload,
                    BrowserOmnibox.isSameOriginBlobDownload(url, documentURL: web.url, allowTorOnion: mode == .tor),
                    let document = web.url { try authorize(document) }
            else { try authorize(action.request) }
            if action.targetFrame?.isMainFrame == true { invalidateSearchObservation(); requestedURL = url }
            if action.shouldPerformDownload, action.sourceFrame.isMainFrame { downloadNavigation = activeNavigation }
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } catch { status.stringValue = "已阻止当前路线不允许的导航。"; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        guard !blocked, let web, web === webView else { decisionHandler(.cancel); return }
        do {
            guard let url = response.response.url else { throw PrivacyRouteError.unsafeTarget }
            if !response.isForMainFrame, ["about:blank", "about:srcdoc"].contains(url.absoluteString), let document = web.url { try authorize(document) }
            else if BrowserOmnibox.isSameOriginBlobDownload(url, documentURL: web.url), let document = web.url { try authorize(document) }
            else { try authorize(url) }
            if response.isForMainFrame, let http = response.response as? HTTPURLResponse {
                siteResponseStatus = http.statusCode
                if isSearchWebsite(url), http.statusCode >= 400 {
                    recordSearchAvailability(.init(state: .failed, reason: "Search website returned HTTP \(http.statusCode); route safety is unchanged"))
                }
            }
            if !response.canShowMIMEType, response.isForMainFrame { downloadNavigation = activeNavigation }
            decisionHandler(response.canShowMIMEType ? .allow : .download)
        }
        catch { decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard !blocked, web === webView else { return }
        invalidateSearchObservation(); siteResponseStatus = nil
        activeNavigation = navigation.map(ObjectIdentifier.init); downloadNavigation = nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !blocked, let web, web === webView else { return }
        if let navigation, let activeNavigation, ObjectIdentifier(navigation) != activeNavigation { return }
        if let url = web.url { address.stringValue = url.absoluteString }
        window?.title = "\(mode.rawValue) · \(web.title ?? web.url?.host ?? "YNX Browser")"
        if let code = siteResponseStatus, code >= 400 {
            status.stringValue = "网站返回 HTTP \(code)。此为网站访问结果；不会直连或更换路线。"
        } else {
            status.stringValue = "\(mode.rawValue) · 已载入网页。不写入 YNX 历史。"
            if let url = web.url, isSearchWebsite(url) { observeSearchWebsite(url) }
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error, navigation: navigation) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error, navigation: navigation) }
    private func navigationFailed(_ error: Error, navigation: WKNavigation?) {
        guard !blocked else { return }
        if let navigation, let activeNavigation, ObjectIdentifier(navigation) != activeNavigation { return }
        let value = error as NSError
        // Reuse ordinary navigation's exact conversion boundary; never suppress a transport
        // error merely because another download exists in this window.
        if value.domain == "WebKitErrorDomain", value.code == 102,
           let navigation, downloadNavigation == ObjectIdentifier(navigation) { return }
        if value.domain == NSURLErrorDomain && value.code == NSURLErrorCancelled { return }
        invalidateSearchObservation()
        if let url = requestedURL ?? web?.url, isSearchWebsite(url) {
            recordSearchAvailability(.init(state: .failed, reason: "Search website navigation failed; no alternative route or provider was selected"))
        }
        status.stringValue = "网页未能载入。可在本隐私窗口重新载入；不会直连或切换搜索引擎。"
    }
    private func isSearchWebsite(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "duckduckgo.com" || host.hasSuffix(".duckduckgo.com")
    }
    private func recordSearchAvailability(_ check: PrivacyRouteReadiness.Check) {
        (session as? PrivacyRouteSession)?.recordSearchAvailability(check)
    }
    private func invalidateSearchObservation() {
        searchGeneration = UUID(); searchObservationFinished = false
        searchObservation?.cancel(); searchObservation = nil
    }
    private func searchObservationIsCurrent(_ url: URL, generation: UUID, navigation: ObjectIdentifier?) -> Bool {
        !blocked && !searchObservationFinished && searchGeneration == generation &&
            activeNavigation == navigation && web?.url == url
    }
    private func observeSearchWebsite(_ url: URL) {
        invalidateSearchObservation()
        guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "q" && !($0.value ?? "").isEmpty }) == true else {
            recordSearchAvailability(.init(state: .notRun, reason: "Search home loaded; no query was submitted"))
            return
        }
        do { try authorizeProtection() }
        catch { block("搜索观测前保护状态已失效。"); return }
        let expected = searchGeneration, navigation = activeNavigation
        recordSearchAvailability(.init(state: .checking, reason: "Search page loaded; actual results are not yet verified"))
        searchObservation = Task { @MainActor [weak self] in
            for attempt in 0..<5 {
                if attempt > 0 { try? await Task.sleep(for: .seconds(1)) }
                guard !Task.isCancelled, let self,
                      self.searchObservationIsCurrent(url, generation: expected, navigation: navigation) else { return }
                self.inspectSearchDocument(url, generation: expected, navigation: navigation)
            }
            // Give the last callback one interval, then withdraw all pending completions.
            // A stalled/empty/unsupported page is a website observation, never LeakSafe.
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let self else { return }
            self.completeSearchObservation(.init(state: .failed, reason: "Visible search-result links were not verified within the bounded page observation; route safety is unchanged"),
                status: "未在限定时间内观察到可见搜索结果。不会自动重试、直连或更换搜索引擎。", url: url, generation: expected, navigation: navigation)
        }
    }
    private func completeSearchObservation(_ check: PrivacyRouteReadiness.Check, status message: String?, url: URL, generation: UUID, navigation: ObjectIdentifier?) {
        guard searchObservationIsCurrent(url, generation: generation, navigation: navigation) else { return }
        do { try authorizeProtection() }
        catch { block("搜索观测完成前保护状态已失效。"); return }
        searchObservationFinished = true
        searchObservation?.cancel(); searchObservation = nil
        recordSearchAvailability(check)
        // Recording can synchronously revoke the session and remove the view.
        guard !blocked, searchGeneration == generation, activeNavigation == navigation, web?.url == url else { return }
        if let message { status.stringValue = message }
    }
    /// Local, bounded result observation only. No content/URL leaves this window, and neither
    /// a result nor a CAPTCHA changes route, leak qualification or release admission.
    private func inspectSearchDocument(_ url: URL, generation: UUID, navigation: ObjectIdentifier?) {
        guard searchObservationIsCurrent(url, generation: generation, navigation: navigation), let web else { return }
        do { try authorizeProtection() }
        catch { block("搜索观测前保护状态已失效。"); return }
        let script = """
        (() => {
          const challenge = !!document.querySelector('form#challenge-form,form[action*="anomaly"],iframe[src*="captcha"]');
          const links = Array.from(document.querySelectorAll('a.result__a,a[data-testid="result-title-a"]'));
          const results = Math.min(100, links.filter(a => a.getClientRects().length > 0).length);
          return {challenge, results};
        })()
        """
        web.evaluateJavaScript(script) { [weak self, weak web] value, error in
            guard let self, let web, self.web === web,
                  self.searchObservationIsCurrent(url, generation: generation, navigation: navigation) else { return }
            do { try self.authorizeProtection() }
            catch { self.block("搜索回调返回时保护状态已失效。"); return }
            guard error == nil, let data = value as? [String: Any], let challenge = data["challenge"] as? Bool,
                  let count = data["results"] as? NSNumber, CFGetTypeID(count) != CFBooleanGetTypeID(),
                  count.doubleValue == Double(count.intValue), (0...100).contains(count.intValue) else { return }
            if challenge {
                self.completeSearchObservation(.init(state: .blocked, reason: "Search website requires manual verification; this is not a route-safety failure"),
                    status: "搜索网站需要手动验证，当前页面不算搜索结果。路线安全状态独立。", url: url, generation: generation, navigation: navigation)
            } else if count.intValue > 0,
                      URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "q" && !($0.value ?? "").isEmpty }) == true {
                self.completeSearchObservation(.init(state: .ready, reason: "Actual visible search-result links observed in this routed window"),
                    status: nil, url: url, generation: generation, navigation: navigation)
            }
        }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { protection.close(); block("网页进程已停止。") }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url { load(url.absoluteString) }
        return nil
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        status.stringValue = "此隐私窗口未启用摄像头或麦克风。"; decisionHandler(.deny)
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { accept(download) }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { accept(download) }
    private func accept(_ download: WKDownload) {
        download.delegate = self
        guard !blocked else {
            downloadRetirement.begin(download, file: nil)
            downloadRetirement.cancel(download)
            return
        }
        do {
            let id = ObjectIdentifier(download)
            tickets[id] = try protection.registerDownload(download)
            downloads[id] = download
        }
        catch {
            downloadRetirement.begin(download, file: nil)
            downloadRetirement.cancel(download)
            block("下载前保护状态已失效。")
        }
        #if YNX_PRIVACY_ACCEPTANCE
        let id = ObjectIdentifier(download)
        if tickets[id] != nil, acceptanceRecord != nil {
            acceptanceDownloads[id] = UUID()
            recordAcceptance("download-accepted", id: id, fields: ["committed": "false"])
            acceptanceProgress[id] = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self] progress, _ in
                Task { @MainActor [weak self] in
                    guard let self, !self.blocked, self.tickets[id] != nil else { return }
                    self.recordAcceptance("download-progress", id: id, fields: ["bytes": String(progress.completedUnitCount), "committed": "false"])
                }
            }
        }
        #endif
    }
    private func cancelDownload(_ download: WKDownload) {
        retireDownload(download, terminal: false)
    }
    private func retireDownload(_ download: WKDownload, terminal: Bool) {
        let id = ObjectIdentifier(download)
        guard downloads[id] === download else { return }
        downloads.removeValue(forKey: id)
        tickets.removeValue(forKey: id) // Fence commit before any reentrant callback.
        let file = files.removeValue(forKey: id)
        // Adopt cleanup before WebKit, the panel or evidence callbacks can reenter.
        downloadRetirement.begin(download, file: file)
        #if YNX_PRIVACY_ACCEPTANCE
        recordAcceptanceDownloadFailure(id)
        #endif
        file?.revoke()
        destinationTickets.removeValue(forKey: id)?.cancel()
        if let panel = panels.removeValue(forKey: id) {
            if let parent = panel.sheetParent { parent.endSheet(panel, returnCode: .cancel) }
            panel.orderOut(nil)
        }
        protection.forgetDownload(download)
        if terminal { downloadRetirement.didTerminate(download) }
        else { downloadRetirement.cancel(download) }
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let id = ObjectIdentifier(download)
        let decision = destinationDecisions.begin(downloadID: id, completion: completionHandler)
        guard decision.isPending, !blocked, let ticket = tickets[id], let window else {
            cancelDownload(download); decision.cancel(); return
        }
        destinationTickets[id] = decision
        let panel = NSSavePanel()
        // A pending new download has no unsaved user document. Permit normal Quit;
        // the existing owner revokes its destination and cancels the sheet first.
        panel.preventsApplicationTerminationWhenModal = false
        panel.nameFieldStringValue = BrowserDownloadFile.safeFilename(suggestedFilename); panels[id] = panel
        panel.beginSheetModal(for: window) { [weak self, decision] result in
            guard let self, decision.isPending else { decision.cancel(); return }
            self.panels.removeValue(forKey: id)
            guard !self.blocked, self.tickets[id] == ticket, result == .OK, let destination = panel.url else { self.cancelDownload(download); decision.cancel(); return }
            let file: RoutedDownloadFileLease
            do {
                try self.authorizeProtection()
                file = try RoutedDownloadFileLease(destination: destination)
            }
            catch { self.cancelDownload(download); decision.cancel(); return }
            self.files[id] = file
            DispatchQueue.main.async { [weak self, decision] in
                guard let self, decision.isPending, !self.blocked, self.tickets[id] == ticket,
                      (try? self.authorizeProtection()) != nil else {
                    self?.cancelDownload(download); file.revoke(); decision.cancel(); return
                }
                #if YNX_PRIVACY_ACCEPTANCE
                self.recordAcceptance("download-destination", id: id, fields: ["generation": String(ticket), "committed": "false"])
                #endif
                self.destinationTickets.removeValue(forKey: id)
                decision.resolve(file.staging)
            }
        }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping @MainActor (WKDownload.RedirectPolicy) -> Void) {
        let id = ObjectIdentifier(download)
        do {
            guard !blocked, tickets[id] != nil, let url = request.url,
                  PrivacyRouteWebTarget.allowsDownloadRedirect(from: response.url, to: url, mode: mode) else {
                throw PrivacyRouteError.unsafeTarget
            }
            try authorize(request)
            #if YNX_PRIVACY_ACCEPTANCE
            recordAcceptance("download-redirect", id: id, fields: ["policy": "allow", "scheme": url.scheme?.lowercased() ?? "other", "crossOrigin": String(url.host != response.url?.host)])
            #endif
            decisionHandler(.allow)
        } catch {
            #if YNX_PRIVACY_ACCEPTANCE
            recordAcceptance("download-redirect", id: id, fields: ["policy": "cancel", "scheme": request.url?.scheme?.lowercased() == "http" ? "http" : "other"])
            #endif
            status.stringValue = "已阻止下载重定向。不会直连或降低 TLS 保护。"
            decisionHandler(.cancel)
        }
    }
    func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard !blocked, tickets[ObjectIdentifier(download)] != nil,
              (try? authorizeProtection()) != nil else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.performDefaultHandling, nil)
    }
    func downloadDidFinish(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        downloadRetirement.didTerminate(download) // A late completion cannot publish after withdrawal.
        #if YNX_PRIVACY_ACCEPTANCE
        defer { acceptanceProgress.removeValue(forKey: id); acceptanceDownloads.removeValue(forKey: id) }
        #endif
        guard !blocked, downloads[id] === download,
              let ticket = tickets.removeValue(forKey: id), let file = files.removeValue(forKey: id) else {
            retireDownload(download, terminal: true); return
        }
        downloads.removeValue(forKey: id)
        do {
            #if YNX_PRIVACY_ACCEPTANCE
            var hash: String?
            if acceptanceRecord != nil, let size = try FileManager.default.attributesOfItem(atPath: file.staging.path)[.size] as? NSNumber, size.int64Value <= 8_388_608 {
                hash = SHA256.hash(data: try Data(contentsOf: file.staging)).map { String(format: "%02x", $0) }.joined()
            }
            #endif
            try file.commit(authorize: {
                try authorizeProtection()
            }, beforePublish: {
                try protection.finishDownload(download, generation: ticket)
                try authorizeProtection()
            })
            #if YNX_PRIVACY_ACCEPTANCE
            recordAcceptance("download-committed", id: id, fields: ["generation": String(ticket), "committed": "true", "sha256": hash ?? "not-observed"])
            #endif
            status.stringValue = "下载已保存。文件保留在所选文件夹；不写入 YNX 下载历史。"
        }
        catch {
            file.revoke(); protection.forgetDownload(download)
            downloadRetirement.begin(download, file: file)
            downloadRetirement.didTerminate(download)
            #if YNX_PRIVACY_ACCEPTANCE
            recordAcceptanceDownloadFailure(id)
            #endif
            status.stringValue = file.cleanupFailure == nil
                ? "下载未记为完成；已撤销临时文件，不会自动重试或直连。"
                : "下载未记为完成；未能移除应用的临时文件。"
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let id = ObjectIdentifier(download)
        let file = files[id]
        downloadRetirement.didTerminate(download)
        retireDownload(download, terminal: true)
        if !blocked {
            status.stringValue = file?.cleanupFailure == nil
                ? "下载已取消或中断，未记为完成；不会自动重试或直连。"
                : "下载已取消或中断；未能移除应用的临时文件。"
        }
    }
}

/// Keeps each exact download until WebKit reports a terminal event and its staging path is removed.
@MainActor final class RoutedDownloadRetirement {
    private struct Entry {
        let download: WKDownload
        let file: RoutedDownloadFileLease?
        var cancellationRequested = false
        var terminal = false
    }
    private var pending: [ObjectIdentifier: Entry] = [:]
    var pendingCount: Int { pending.count }

    func begin(_ download: WKDownload, file: RoutedDownloadFileLease?) {
        let id = ObjectIdentifier(download)
        guard pending[id] == nil else { return }
        pending[id] = Entry(download: download, file: file)
    }
    func cancel(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        guard let entry = pending[id], !entry.cancellationRequested, !entry.terminal else { return }
        pending[id]?.cancellationRequested = true
        let complete: @MainActor @Sendable () -> Void = { [self, download] in didCancel(download) }
        if let file = entry.file {
            file.cancelTransport { cleaned in download.cancel { _ in cleaned(); complete() } }
        } else { download.cancel { _ in complete() } }
    }
    func didTerminate(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        guard let entry = pending[id], entry.download === download, !entry.cancellationRequested else { return }
        pending[id]?.terminal = true
        removeTerminalEntry(id)
    }
    private func didCancel(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        guard pending[id]?.download === download else { return }
        pending[id]?.terminal = true
        removeTerminalEntry(id)
    }
    private func removeTerminalEntry(_ id: ObjectIdentifier) {
        guard let entry = pending[id], entry.terminal else { return }
        entry.file?.revoke() // Re-check the exact staging path after the terminal notification.
        if entry.file?.cleanupFailure == nil { pending.removeValue(forKey: id) }
    }
    func awaitClosure(timeout: Duration = .seconds(2)) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        for id in Array(pending.keys) { removeTerminalEntry(id) }
        while !pending.isEmpty, ContinuousClock.now < deadline {
            do { try await Task.sleep(for: .milliseconds(20)) }
            catch { return false }
        }
        return pending.isEmpty
    }
}

/// Exact local file lifetime only. This object grants no route, Source or release authority.
/// Retain it through WKDownload.cancel's callback so a late writer cannot leave an orphan.
@MainActor final class RoutedDownloadFileLease {
    enum State { case pending, revoked, committed }
    let staging: URL
    let destination: URL
    private(set) var state: State = .pending
    private(set) var cleanupFailure: NSError?
    private var cancellationRequested = false

    init(destination: URL) throws {
        self.destination = destination
        staging = try BrowserDownloadFile.makeOrdinaryStagingURL()
    }
    func revoke() {
        guard state != .committed else { return }
        state = .revoked // Fence before I/O or arbitrary completion code.
        cleanOwnPartial()
    }
    func cancelTransport(_ cancel: (@escaping @MainActor () -> Void) -> Void) {
        guard state != .committed else { return }
        revoke()
        guard !cancellationRequested else { return }
        cancellationRequested = true
        cancel { [self] in cleanOwnPartial() } // Independent of the retired window's lifetime.
    }
    func commit(authorize: () throws -> Void, beforePublish: () throws -> Void = {}) throws {
        guard state == .pending else { throw CocoaError(.userCancelled) }
        do {
            try authorize()
            guard state == .pending else { throw CocoaError(.userCancelled) }
            try BrowserDownloadFile.commitOrdinary(staging: staging, destination: destination) {
                try beforePublish()
                guard state == .pending else { throw CocoaError(.userCancelled) }
            }
            state = .committed
        } catch { revoke(); throw error }
    }
    private func cleanOwnPartial() {
        guard state == .revoked else { return }
        do { try FileManager.default.removeItem(at: staging.deletingLastPathComponent()); cleanupFailure = nil }
        catch {
            let value = error as NSError
            if value.domain == NSCocoaErrorDomain,
               [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(value.code) { cleanupFailure = nil }
            else { cleanupFailure = value }
        }
    }
}
