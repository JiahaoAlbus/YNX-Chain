#if YNX_PRIVACY_ACCEPTANCE
import AppKit
import WebKit
import YNXBrowserCore

struct ProtectedAcceptanceTrialInputs {
    let manifestURL: URL
    let expectedManifestSHA256: String
    let bootstrapURL: URL
    let expectedBootstrapSHA256: String
}

/// Actual WK source attribution/drop experiment, separate from the ordinary page factory.
/// It grants no ordinary browsing, production admission, search, history or Wallet capability.
@MainActor enum ProtectedSyntheticCanary {
    static func run(authority: SyntheticTrialAuthority) async throws -> SyntheticCanaryQualification {
        try authority.authorizeCanaryConstruction()
        let requests = try await authority.prepareWebKitCanary()
        guard requests.count == 2, let baseURL = requests.first?.url else { throw SyntheticTrialFailure.canaryNotVerified }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.isLockdownModeEnabled = true
        let delegate = CanaryNavigation(allowed: Set(requests.compactMap { $0.url?.absoluteString }))
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), configuration: configuration)
        web.navigationDelegate = delegate
        defer { web.stopLoading(); web.navigationDelegate = nil; web.uiDelegate = nil; web.removeFromSuperview() }
        do {
            let html = try authority.webKitCanaryHTML
            web.loadHTMLString(html, baseURL: baseURL)
            let qualification = try await authority.completeWebKitCanary()
            try qualification.verify()
            return qualification
        } catch { authority.revoke(); throw error }
    }
    private final class CanaryNavigation: NSObject, WKNavigationDelegate {
        let allowed: Set<String>
        init(allowed: Set<String>) { self.allowed = allowed }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.request.httpBody == nil, navigationAction.request.httpBodyStream == nil,
                  ["GET", "HEAD"].contains(navigationAction.request.httpMethod ?? "GET"),
                  let url = navigationAction.request.url,
                  url.absoluteString == "about:blank" || allowed.contains(url.absoluteString) else { decisionHandler(.cancel); return }
            decisionHandler(.allow)
        }
        // No authentication challenge override: the system normal TLS policy remains in force.
    }
}
#endif
