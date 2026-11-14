import AppKit
import WebKit

@MainActor final class BlankTabNavigationFixture: NSObject, WKNavigationDelegate, WKUIDelegate {
    struct Tab { let isPrivate: Bool }

    let view: WKWebView
    var opened: WKWebView?
    let tabs = [Tab(isPrivate: true)]
    var closedWindow = false
    let terminatingApp = false
    private var finished: CheckedContinuation<Void, any Error>?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        view = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        view.navigationDelegate = self
        view.uiDelegate = self
    }

    func work(_ action: () -> Void) async throws {
        try await withCheckedThrowingContinuation { continuation in
            finished = continuation
            action()
        }
    }

    private func complete(_ error: (any Error)? = nil) {
        let active = finished
        finished = nil
        if let error { active?.resume(throwing: error) }
        else { active?.resume() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { complete() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        complete(error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        complete(error)
    }
    func index(for view: WKWebView) -> Int? { view === self.view ? 0 : nil }

    func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.navigationDelegate = self
        return child
    }

    func attachTab(_ child: WKWebView, pendingURL: URL, isPrivate: Bool) {
        precondition(isPrivate && !child.configuration.websiteDataStore.isPersistent)
        opened = child
    }

    // A pre-fix source snapshot used for reproduction calls this URL-only path.
    func openTab(url: URL, isPrivate: Bool) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = view.configuration.websiteDataStore
        let child = makeWebView(configuration: configuration)
        attachTab(child, pendingURL: url, isPrivate: isPrivate)
        child.load(URLRequest(url: url))
    }
}

@main @MainActor struct BlankTabNavigationProbe {
    static func main() async throws {
        guard let base = URL(string: CommandLine.arguments[1]), base.host == "127.0.0.1", base.scheme == "http",
              base.port != nil else { throw CocoaError(.fileReadInvalidFileName) }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let fixture = BlankTabNavigationFixture()
        for (page, script, target) in [
            ("form", "document.forms[0].requestSubmit()", "/submit"),
            ("link", "document.querySelector('a').click()", "/follow"),
        ] {
            try await fixture.work { fixture.view.load(URLRequest(url: base.appendingPathComponent(page))) }
            try await fixture.work { fixture.view.evaluateJavaScript(script, completionHandler: nil) }
            guard fixture.opened?.url?.path == target,
                  fixture.view.url?.path == "/" + page else { throw CocoaError(.fileReadCorruptFile) }
            print("Opened child \(target); original tab remained on /\(page)")
        }
        guard !fixture.view.configuration.websiteDataStore.isPersistent else { throw CocoaError(.fileReadCorruptFile) }
        guard let child = fixture.opened, child.configuration.websiteDataStore === fixture.view.configuration.websiteDataStore else {
            throw CocoaError(.fileReadCorruptFile)
        }
    }
}
