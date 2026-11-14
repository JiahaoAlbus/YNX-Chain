import Foundation

private enum Failure: Error { case failed(String) }
private func require(_ value: Bool, _ label: String) throws { if !value { throw Failure.failed(label) } }
@MainActor private final class NeverStartedProvider: PrivacyRouteProvider {
    let mode: PrivacyRouteMode
    var starts = 0, stops = 0, statuses = 0
    init(_ mode: PrivacyRouteMode) { self.mode = mode }
    func start() async throws -> PrivacyRouteEndpoint { starts += 1; throw PrivacyRouteError.blocked }
    func status() async -> PrivacyRouteStatus { statuses += 1; return .blocked("PUBLIC no-transport fixture") }
    func stop() async { stops += 1 }
}
@MainActor private final class DelayedStatusProvider: PrivacyRouteProvider {
    let mode: PrivacyRouteMode = .tor
    var starts = 0, stops = 0
    var pending: CheckedContinuation<PrivacyRouteStatus, Never>?
    var delayStatus = true
    func start() async throws -> PrivacyRouteEndpoint {
        starts += 1
        return try PrivacyRouteEndpoint(port: 19150)
    }
    func status() async -> PrivacyRouteStatus {
        guard delayStatus else { return .connected }
        return await withCheckedContinuation { pending = $0 }
    }
    func stop() async { stops += 1 }
}
@main private struct ProductionQualificationProbe {
    @MainActor static func main() async {
        do {
            var checks: [String] = []
            // Only the actual production factory is used, not a caller injection
            // of code-signing results or a fake qualification/canary/health ACK.
            for mode in PrivacyRouteMode.allCases {
                do { _ = try RoutedProductionQualification.acquireCurrent(mode: mode); throw Failure.failed("qualification-unexpectedly-created") }
                catch RoutedQualificationFailure.signingNotConfigured { checks.append("\(mode)-NoTeam-before-any-control") }
                let provider = NeverStartedProvider(mode)
                let session = PrivacyRouteSession(provider: provider) // Actual normal initializer.
                var beganConnecting = false
                await session.start { beganConnecting = true }; _ = await session.status()
                try require(provider.starts == 0 && provider.statuses == 0 && session.endpoint == nil, "no-provider-calls-on-missing-qualification")
                try require(!beganConnecting, "no-connecting-notification-on-missing-qualification")
                try require(session.qualificationFailure == .signingNotConfigured, "exact-first-intake-failure")
                let before = session.readiness
                try require(before.transportReady.state == .notRun && before.browserRouteReady.state == .blocked &&
                    before.leakSafe.state == .failed && before.searchAvailable.state == .notRun && before.releaseApproved.state == .blocked,
                    "five-states-do-not-alias-signing-or-search")
                session.recordSearchAvailability(.init(state: .ready, reason: "PUBLIC website observation cannot grant route permission"))
                do { try session.authorize(URL(string: "https://example.test/")!); throw Failure.failed("search-observation-granted-permission") }
                catch PrivacyRouteError.blocked { }
                try require(session.readiness.browserRouteReady.state == .blocked && !RoutedPlatformIsolationAdmission.current.permitsWebContent,
                    "public-diagnostics-never-become-admission")
                checks.append("\(mode)-normal-session-zero-provider-IO-and-five-states")
                let refused = PrivacyRouteSession(provider: provider, qualification: .failure(.qualificationIssuerNotSupplied))
                await refused.start(); _ = await refused.status()
                try require(provider.starts == 0 && provider.statuses == 0 && refused.endpoint == nil,
                    "shared-refusal-must-not-reacquire-or-start")
                try require(refused.qualificationFailure == .qualificationIssuerNotSupplied,
                    "shared-refusal-preserves-the-original-failure")
                checks.append("\(mode)-shared-window-intake-preserves-first-refusal")
            }
            let delayed = DelayedStatusProvider()
            let ready = PrivacyRouteReadiness.Check(state: .ready, reason: "State-machine fixture")
            let admission = RoutedPlatformIsolationAdmission(permitsWebContent: true, reason: "State-machine fixture",
                leakSafety: .init(checks: Dictionary(uniqueKeysWithValues: PrivacyRouteReadiness.LeakSurface.allCases.map { ($0, ready) })),
                releaseApproved: ready)
            let racingSession = PrivacyRouteSession(provider: delayed, admission: admission)
            let startup = Task { await racingSession.start() }
            while delayed.pending == nil { await Task.yield() }
            await racingSession.block("First route loss")
            delayed.delayStatus = false
            await racingSession.start()
            let startsBeforeRetirement = delayed.starts
            delayed.pending?.resume(returning: .connected)
            delayed.pending = nil
            await startup.value
            try require(startsBeforeRetirement == 1 && delayed.stops == 1 && racingSession.endpoint == nil &&
                racingSession.state == .blocked("First route loss"), "late-status-reply-must-not-restart-or-overwrite-first-block")
            await racingSession.start()
            try require(racingSession.state == .connected && delayed.starts == 2 && racingSession.endpoint != nil,
                "explicit-start-after-original-retirement")
            try require(racingSession.readiness.browserRouteReady.state == .notRun, "new-generation-requires-web-view-binding")
            checks.append("DATA-only-stale-status-cannot-overwrite-block-or-race-recovery")
            // Pure DATA continuity tests only. A successful comparison here does
            // not construct the private original qualification capability.
            func installation(_ browser: String = "a", _ helper: String = "b", _ os: String = "PUBLIC-OS") -> RoutedQualificationInstallation {
                .init(mode: .tor, team: "PUBLIC00001", bundleID: "com.ynxweb4.browser.route.tor", browserSHA256: String(repeating: browser, count: 64), browserCodeHash: String(repeating: "c", count: 40), helperSHA256: String(repeating: helper, count: 64), osBuild: os)
            }
            let original = installation()
            let origin = ContinuousClock.now
            func instant(_ nanoseconds: Int64) -> ContinuousClock.Instant { origin.advanced(by: .nanoseconds(nanoseconds)) }
            var exact = RoutedQualificationContinuity(installation: original, deadline: instant(100))
            try exact.check(original, now: instant(99))
            do { try exact.check(original, now: instant(100)); throw Failure.failed("deadline-boundary-accepted") }
            catch RoutedQualificationFailure.expired { }
            try require(exact.signalRevocation(.revoked) && exact.failure == .expired && !exact.signalRevocation(.closed), "expiry-before-callback-delivers-once-and-preserves-first-cause")
            do { try exact.check(original, now: instant(1)); throw Failure.failed("expired-observation-revived-on-clock-rewind") }
            catch RoutedQualificationFailure.expired { }
            checks.append("DATA-only-exact-expiry-no-revival-and-revocation-delivery")
            for changed in [installation("d"), installation("a", "e"), installation("a", "b", "PUBLIC-OTHER-OS")] {
                var state = RoutedQualificationContinuity(installation: original, deadline: instant(100))
                do { try state.check(changed, now: instant(1)); throw Failure.failed("wrong-installation-accepted") }
                catch RoutedQualificationFailure.installationChanged { }
                try require(state.signalRevocation(.closed) && state.failure == .installationChanged, "wrong-build-cause-not-overwritten")
            }
            checks.append("DATA-only-browser-helper-OS-mismatch-sticky")
            var revoked = RoutedQualificationContinuity(installation: original, deadline: instant(100))
            try require(revoked.signalRevocation(.revoked), "first-revocation-not-delivered")
            do { try revoked.check(original, now: instant(1)); throw Failure.failed("revoked-observation-revived") }
            catch RoutedQualificationFailure.revoked { }
            checks.append("DATA-only-explicit-revocation-no-revival")
            try require(installation("a", "b", "Caf\u{00E9}") != installation("a", "b", "Cafe\u{0301}"), "UTF8-build-binding-alias")
            checks.append("DATA-only-byte-exact-installation-identity")
            let value: [String: Any] = ["schema": "P05_NORMAL_QUALIFICATION_INTAKE_DELTA_V1", "checks": checks,
                "actualProductionFactory": "NoTeam rejected", "actualQualifiedPositive": "NOT_RUN_ORIGINAL_SUPPLIER_NOT_PROVIDED",
                "continuityTestsAreDataOnly": true, "actualNE": "NOT_RUN", "GUIOrNetworkUsed": false]
            print(String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self))
        } catch { print("NORMAL_QUALIFICATION_DELTA_FAILED: \(error)"); exit(1) }
    }
}
