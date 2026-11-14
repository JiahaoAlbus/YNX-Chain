import Foundation
import CoreFoundation
import Darwin

enum TorCoordinatorFailure: Error { case ownershipConflict, cancelled }
@MainActor final class FixtureStatus { var stringValue = "" }
@MainActor final class FixtureAdapter {
    enum State { case bootstrapReady, stopped }
    var processIdentifier: Int32?
    var ready = true, releaseOnPoll = true
    var stops = 0
    func stop(reason: String) { stops += 1 }
    func pollProcess() -> State {
        if stops > 0 && releaseOnPoll { processIdentifier = nil }
        return ready ? .bootstrapReady : .stopped
    }
}
@MainActor final class WKWebView {}
@MainActor final class WKWebpagePreferences { var allowsContentJavaScript = true; var isLockdownModeEnabled = false }
struct WKFrameInfo { let isMainFrame: Bool }
struct WKNavigationAction { let targetFrame: WKFrameInfo?; let shouldPerformDownload: Bool; let request: URLRequest }
enum WKNavigationActionPolicy { case allow, cancel }

@main struct PublicSearchDiagnosticDeltaProbe {
    @MainActor static func main() async {
        do {
            var checks = 0
            func check(_ value: Bool, _ label: String) throws {
                guard value else { throw NSError(domain: "PublicSearchDiagnosticDelta." + label, code: checks) }
                checks += 1
            }
            let policy = TorPublicSearchDiagnosticPolicy.self
            let role = policy.bundleIdentifier
            try check(policy.matchesRole(identifier: role, marker: true), "exact-role-true-bool")
            for marker: Any? in [nil, false, 1, "true"] { try check(!policy.matchesRole(identifier: role, marker: marker), "non-boolean-or-disabled-marker") }
            try check(!policy.matchesRole(identifier: "com.ynxweb4.browser.route.tor", marker: true), "canonical-tor-is-not-diagnostic-role")
            var request = URLRequest(url: URL(string: policy.target)!); request.httpMethod = "GET"
            try check(policy.accepts(request), "one-exact-public-query")
            for text in ["http://html.duckduckgo.com/html/?q=YNX%20browser", "https://html.duckduckgo.com.evil.test/html/?q=YNX%20browser", "https://duckduckgo.com/?q=YNX%20browser", "https://html.duckduckgo.com/html?q=YNX%20browser", "https://html.duckduckgo.com/html/?q=YNX+browser", "https://html.duckduckgo.com/html/?q=personal", "https://html.duckduckgo.com/html/?q=YNX%20browser&extra=1", "https://html.duckduckgo.com/html/?q=YNX%20browser#other", "https://user@html.duckduckgo.com/html/?q=YNX%20browser", "https://html.duckduckgo.com:443/html/?q=YNX%20browser"] {
                try check(!policy.accepts(URLRequest(url: URL(string: text)!)), "non-exact-target-refused")
            }
            for method in ["POST", "HEAD", "PUT"] { var other = request; other.httpMethod = method; try check(!policy.accepts(other), "non-get-refused") }
            var body = request; body.httpBody = Data("PUBLIC".utf8); try check(!policy.accepts(body), "body-refused")
            var stream = request; stream.httpBodyStream = InputStream(data: Data()); try check(!policy.accepts(stream), "body-stream-refused")
            for header in ["Authorization", "Proxy-Authorization", "Cookie"] { var other = request; other.setValue("PUBLIC", forHTTPHeaderField: header); try check(!policy.accepts(other), "credential-header-refused") }
            try check(policy.acceptsDocument(url: request.url, mime: "text/html", mainFrame: true, attachment: nil), "refusal-html-can-remain-visible")
            try check(!policy.acceptsDocument(url: request.url, mime: "text/html", mainFrame: false, attachment: nil), "iframe-document-refused")
            try check(!policy.acceptsDocument(url: request.url, mime: "application/octet-stream", mainFrame: true, attachment: nil), "binary-refused")
            try check(!policy.acceptsDocument(url: request.url, mime: "text/html", mainFrame: true, attachment: "attachment; filename=PUBLIC"), "attachment-refused")
            let rules = try JSONSerialization.jsonObject(with: Data(policy.contentRules().utf8)) as! [[String: Any]]
            try check(rules.count == 3 && (rules[0]["action"] as? [String: String])?["type"] == "block", "native-block-all-first")
            let exception = rules[1]["trigger"] as! [String: Any]
            try check(exception["resource-type"] as? [String] == ["document"] && exception["url-filter-is-case-sensitive"] as? Bool == true, "document-only-exception")
            try check((rules[2]["action"] as? [String: String])?["type"] == "block-cookies", "cookies-blocked-last")
            let actionOwner = ActualPublicDiagnostic()
            let preferences = WKWebpagePreferences()
            var decisions: [WKNavigationActionPolicy] = []
            let action = WKNavigationAction(targetFrame: .init(isMainFrame: true), shouldPerformDownload: false, request: request)
            actionOwner.webView(actionOwner.web!, decidePolicyFor: action, preferences: preferences) { decisions.append($0); _ = $1 }
            actionOwner.webView(actionOwner.web!, decidePolicyFor: action, preferences: preferences) { decisions.append($0); _ = $1 }
            try check(decisions == [.allow, .cancel], "follow-on-same-url-cannot-create-second-navigation")
            try check(!preferences.allowsContentJavaScript && preferences.isLockdownModeEnabled, "preferences-reassert-native-js-off-lockdown")
            for (main, download, ready) in [(false, false, true), (true, true, true), (true, false, false)] {
                let owner = ActualPublicDiagnostic(); owner.adapter.ready = ready; var result: WKNavigationActionPolicy?
                owner.webView(owner.web!, decidePolicyFor: .init(targetFrame: .init(isMainFrame: main), shouldPerformDownload: download, request: request), preferences: WKWebpagePreferences()) { result = $0; _ = $1 }
                try check(result == .cancel && !owner.claimedNavigation, "frame-download-or-backend-refusal")
            }
            // Actual shutdown consumer + original ownership helper, with memory-only child doubles.
            let late = ActualPublicDiagnostic(); late.pendingStart = true
            var adopt: CheckedContinuation<Void, Never>?
            late.outerStart = Task { @MainActor in
                do { try await late.worker.start(operation: {
                    late.pendingStart = false
                    await withCheckedContinuation { adopt = $0 }
                    late.adapter.processIdentifier = 12345 // PUBLIC incarnation label, never a real PID operation.
                }, cancellationFence: { late.fence() }) } catch {}
            }
            while adopt == nil { await Task.yield() }
            var firstReturned = false, secondReturned = false
            let first = Task { @MainActor in let value = await late.shutdown(); firstReturned = true; return value }
            let second = Task { @MainActor in let value = await late.shutdown(); secondReturned = true; return value }
            await Task.yield(); first.cancel()
            try check(!firstReturned && !secondReturned && !late.cleanupConfirmed, "concurrent-cancelled-callers-cannot-return-before-worker")
            adopt!.resume(); adopt = nil
            let one = await first.value, two = await second.value
            try check(one && two && late.adapter.stops == 1 && late.cleanupConfirmed, "late-adopted-original-handle-stopped-once-and-joined")
            let unstarted = ActualPublicDiagnostic(); unstarted.pendingStart = true
            try check(!unstarted.cleanupConfirmed, "scheduled-wrapper-not-yet-confirmed")
            let unstartedResult = await unstarted.shutdown()
            try check(unstartedResult && unstarted.worker.closed, "late-wrapper-fenced-before-resource-creation")
            let unknown = ActualPublicDiagnostic(); unknown.adapter.processIdentifier = 12346; unknown.adapter.releaseOnPoll = false
            unknown.observeFailure(.bootstrapFailed)
            let start = ContinuousClock.now
            let unknownResult = await unknown.shutdown()
            try check(!unknownResult && unknown.cleanupUnknown && unknown.adapter.processIdentifier == 12346, "unknown-original-handle-retained")
            try check(ContinuousClock.now - start >= .seconds(20) && unknown.firstFailure == .bootstrapFailed, "actual-stop-deadline-first-cause-retained")
            unknown.adapter.releaseOnPoll = true
            let recovered = await unknown.shutdown()
            try check(recovered && unknown.adapter.stops == 2 && unknown.firstFailure == .bootstrapFailed, "retry-only-original-cleanup-no-new-attempt")
            print("PUBLIC_SEARCH_DIAGNOSTIC_DELTA \(checks) checks PASS; exact policy/native-action/shutdown declarations with PUBLIC doubles; real WK/Arti/managedPT/DDG/network NOT_RUN")
        } catch { FileHandle.standardError.write(Data("PUBLIC_SEARCH_DIAGNOSTIC_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
