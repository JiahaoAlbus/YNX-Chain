import Foundation

private enum ProbeFailure: Error { case failed(String) }
private func require(_ condition: Bool, _ name: String) throws { if !condition { throw ProbeFailure.failed(name) } }
private func expect(_ wanted: RoutedQualificationFailure, _ body: () throws -> Void) throws {
    do { try body(); throw ProbeFailure.failed("unexpected-success") }
    catch let actual as RoutedQualificationFailure { try require(actual == wanted, "wrong-first-cause") }
}

@main private struct ContinuousExpiryDeltaProbe {
    static func main() throws {
        let installation = RoutedQualificationInstallation(mode: .tor, team: "PUBLIC00001",
            bundleID: "com.ynxweb4.browser.route.tor", browserSHA256: String(repeating: "a", count: 64),
            browserCodeHash: String(repeating: "b", count: 40), helperSHA256: String(repeating: "c", count: 64), osBuild: "PUBLIC")
        let origin = ContinuousClock.now
        func at(_ n: Int64) -> ContinuousClock.Instant { origin.advanced(by: .seconds(n)) }
        var checks: [String] = []
        #if P05_LEGACY_SLEEP_CONTROL
        // Verbatim old DATA reducer, not a manufactured normal qualification.
        // Model suspended uptime at99 while continuous elapsed time reaches120.
        var legacy = LegacyQualificationContinuity(installation: installation, deadline: 100)
        try legacy.check(installation, now: 99)
        checks.append("actual-old-uptime-reducer-accepts-held-uptime-counterexample")
        #endif
        var sleep = RoutedQualificationContinuity(installation: installation, deadline: at(100))
        try sleep.check(installation, now: at(99))
        try expect(.expired) { try sleep.check(installation, now: at(120)) }
        checks.append("deterministic-sleep-inclusive-expiry-DATA-only")
        var boundary = RoutedQualificationContinuity(installation: installation, deadline: at(100))
        try expect(.expired) { try boundary.requireUnexpired(now: at(100)) }
        checks.append("exact-deadline-rejects-before-identity-work")
        var late = RoutedQualificationContinuity(installation: installation, deadline: at(100))
        try late.requireUnexpired(now: at(99))
        try expect(.expired) { try late.check(installation, now: at(101)) }
        checks.append("late-matching-identity-result-cannot-extend-expiry")
        try require(late.signalRevocation(.revoked), "first-expiry-notification")
        try require(late.failure == .expired && !late.signalRevocation(.closed), "first-expiry-overwritten")
        try expect(.expired) { try late.requireUnexpired(now: at(1)) }
        checks.append("late-revocation-preserves-expiry-and-notifies-once")
        var revoked = RoutedQualificationContinuity(installation: installation, deadline: at(100))
        try require(revoked.signalRevocation(.revoked), "revoke-not-delivered")
        try expect(.revoked) { try revoked.check(installation, now: at(101)) }
        try require(!revoked.signalRevocation(.expired), "duplicate-revocation")
        checks.append("earlier-revocation-survives-later-expiry")
        print(String(decoding: try JSONSerialization.data(withJSONObject: [
            "schema": "P05_NORMAL_CONTINUOUS_EXPIRY_DELTA_V1", "checks": checks,
            "qualificationConstructed": false, "systemSleepPerformed": false,
            "actualIssuerOrNE": "NOT_RUN", "networkOrGUI": false
        ], options: [.sortedKeys]), as: UTF8.self))
    }
}
