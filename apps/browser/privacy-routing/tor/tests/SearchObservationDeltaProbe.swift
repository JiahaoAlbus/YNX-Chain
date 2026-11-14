import Foundation
import CoreFoundation
import Darwin

// PUBLIC local callback/route doubles. No WK instance, page request or qualification.
struct PrivacyRouteReadiness {
    enum State { case notRun, checking, ready, blocked, failed }
    struct Check { let state: State; let reason: String }
}
enum FixtureFailure: Error { case revoked }
@MainActor final class FixtureStatus { var stringValue = "" }
final class WKNavigation {}
@MainActor final class WKWebView {
    var url: URL?
    var callbacks: [(Any?, Error?) -> Void] = []
    var automatic: [String: Any]?
    init(url: URL) { self.url = url }
    func evaluateJavaScript(_ source: String, completionHandler: @escaping (Any?, Error?) -> Void) {
        if let automatic { completionHandler(automatic, nil) }
        else { callbacks.append(completionHandler) }
    }
}

@main struct SearchObservationDeltaProbe {
    @MainActor static func main() async {
        do {
            var checks = 0
            func check(_ value: Bool, _ label: String) throws {
                guard value else { throw NSError(domain: "SearchObservationDelta." + label, code: checks) }
                checks += 1
            }
            let url = URL(string: "https://duckduckgo.com/?q=PUBLIC-offline-fixture")!
            let navigation = WKNavigation()
            let legacy = CommandLine.arguments.contains("--legacy-counterexample")
            let old = ActualSearchObservation(url: url)
            old.inspectFixture(url)
            let callback = old.web!.callbacks.removeFirst()
            old.webView(old.web!, didStartProvisionalNavigation: navigation)
            callback(["challenge": false, "results": 1], nil)
            if legacy {
                try check(old.checks.last?.state == .ready, "same-url-old-document-callback-accepted")
                let revoked = ActualSearchObservation(url: url)
                revoked.inspectFixture(url); revoked.allowed = false
                revoked.web!.callbacks.removeFirst()(["challenge": false, "results": 1], nil)
                try check(revoked.checks.last?.state == .ready && revoked.authorizations == 0, "revoked-route-callback-accepted")
                let exhausted = ActualSearchObservation(url: url)
                exhausted.web!.automatic = ["challenge": false, "results": 0]
                exhausted.observeFixture(url)
                try await Task.sleep(for: .milliseconds(5400))
                try check(exhausted.checks.last?.state == .checking, "five-attempts-never-finalize")
                print("SEARCH_OBSERVATION_BUG_REPRODUCED \(checks) checks; actual old callbacks/loop; no WK/route/network")
                return
            }
            try check(old.checks.isEmpty, "same-url-old-document-callback-discarded")
            let revoked = ActualSearchObservation(url: url)
            revoked.inspectFixture(url); revoked.allowed = false
            revoked.web!.callbacks.removeFirst()(["challenge": false, "results": 1], nil)
            try check(revoked.checks.isEmpty && revoked.blocked && revoked.authorizations >= 2, "post-evaluate-live-route-required")
            let before = ActualSearchObservation(url: url); before.allowed = false
            before.inspectFixture(url)
            try check(before.web!.callbacks.isEmpty && before.blocked && before.checks.isEmpty, "pre-evaluate-live-route-required")
            let lastCheck = ActualSearchObservation(url: url); lastCheck.failAtAuthorization = 3
            lastCheck.inspectFixture(url)
            lastCheck.web!.callbacks.removeFirst()(["challenge": false, "results": 1], nil)
            try check(lastCheck.checks.isEmpty && lastCheck.blocked && lastCheck.authorizations == 3, "immediate-pre-publish-live-route-required")
            let changed = ActualSearchObservation(url: url)
            changed.inspectFixture(url); let oldURL = changed.web!.callbacks.removeFirst()
            changed.web!.url = URL(string: "https://duckduckgo.com/?q=PUBLIC-new")!
            oldURL(["challenge": false, "results": 2], nil)
            try check(changed.checks.isEmpty, "different-current-url-discarded")
            let closed = ActualSearchObservation(url: url)
            closed.inspectFixture(url); let closedCallback = closed.web!.callbacks.removeFirst()
            closed.blocked = true; closedCallback(["challenge": false, "results": 1], nil)
            try check(closed.checks.isEmpty, "closed-window-no-late-search-ready")
            let ready = ActualSearchObservation(url: url)
            ready.inspectFixture(url); ready.inspectFixture(url)
            let first = ready.web!.callbacks.removeFirst(), late = ready.web!.callbacks.removeFirst()
            first(["challenge": false, "results": 2], nil)
            late(["challenge": true, "results": 0], nil)
            try check(ready.checks.count == 1 && ready.checks[0].state == .ready, "one-terminal-observation-per-generation")
            let challenge = ActualSearchObservation(url: url)
            challenge.inspectFixture(url); challenge.web!.callbacks.removeFirst()(["challenge": true, "results": 0], nil)
            try check(challenge.checks.last?.state == .blocked && !challenge.blocked, "website-challenge-independent-of-route")
            let home = ActualSearchObservation(url: URL(string: "https://duckduckgo.com/")!)
            home.observeFixture(home.web!.url!)
            try check(home.checks.last?.state == .notRun && home.web!.callbacks.isEmpty, "home-without-query-not-permanent-checking")
            let exhausted = ActualSearchObservation(url: url)
            exhausted.web!.automatic = ["challenge": false, "results": 0]
            exhausted.observeFixture(url)
            let pending = ActualSearchObservation(url: url)
            pending.observeFixture(url)
            try await Task.sleep(for: .milliseconds(5400))
            try check(exhausted.checks.last?.state == .failed && !exhausted.blocked, "bounded-no-visible-results-website-only")
            try check(pending.checks.last?.state == .failed && !pending.blocked, "unanswered-js-also-bounded")
            let latePending = pending.web!.callbacks
            for callback in latePending { callback(["challenge": false, "results": 4], nil) }
            try check(pending.checks.last?.state == .failed, "deadline-withdraws-late-completions")
            print("SEARCH_OBSERVATION_DELTA \(checks) checks PASS; actual callbacks/loop with PUBLIC doubles; installedDDG/LeakSafe/route/network NOT_RUN")
        } catch {
            FileHandle.standardError.write(Data("SEARCH_OBSERVATION_DELTA FAIL \(error)\n".utf8)); exit(1)
        }
    }
}
