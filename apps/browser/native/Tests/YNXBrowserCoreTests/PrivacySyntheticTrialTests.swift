import Foundation
import Testing
@testable import YNXBrowserCore

@MainActor private final class SyntheticBoundaryProvider: PrivacyRouteProvider {
    let mode: PrivacyRouteMode = .nym
    var starts = 0, stops = 0
    func start() async throws -> PrivacyRouteEndpoint { starts += 1; return try .init(port: 19160) }
    func status() async -> PrivacyRouteStatus { .connected }
    func stop() async { stops += 1 }
}
@Suite @MainActor struct PrivacyRouteRequestAuthorizingTests {
    @Test func sharedInterfaceDoesNotWeakenNormalAdmission() async throws {
        let backend = SyntheticBoundaryProvider(), normal = PrivacyRouteSession(provider: backend)
        let boundary: any PrivacyRouteRequestAuthorizing = normal
        await normal.start()
        #expect(backend.starts == 0 && boundary.endpoint == nil)
        #expect(throws: PrivacyRouteError.blocked) { try boundary.confirmBrowserRouteBinding() }
        #expect(throws: PrivacyRouteError.blocked) { try boundary.authorize(URL(string: "https://duckduckgo.com/")!) }
        #expect(boundary.readiness.releaseApproved.state == .notRun)
        #expect(boundary.readiness.transportReady.state == .notRun)
        await boundary.block("Explicit interface shutdown")
        #expect(backend.stops == 1 && boundary.endpoint == nil)
    }
}

#if YNX_PRIVACY_ACCEPTANCE
@Suite @MainActor struct PrivacySyntheticTrialIdentityTests {
    @Test func actualUnsignedTestHostCannotPassSigningPreflight() throws {
        // This fixture checks the real host before any manifest, socket or XPC operation.
        #expect(Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") == nil)
        #expect(throws: ProtectionLeaseFailure.signingNotConfigured) { try SyntheticTrialAuthority.signingPreflight() }
    }
    @Test func configurationDataCannotGrantActualApplicationIdentity() throws {
        for mode in [RoutedIsolationMode.tor, .nym] {
            let proposed = try RoutedIsolationConfiguration(teamIdentifier: "ABCDEFGHIJ", mode: mode,
                runID: "trial-negative", epoch: UUID(), expectedBrowserSHA256: String(repeating: "a", count: 64))
            #expect(throws: ProtectionLeaseFailure.signingNotConfigured) { try SyntheticTrialAuthority.preflight(configuration: proposed) }
        }
    }
}
/// These positive tests validate only proposed URL syntax, never an NE qualification/authority.
/// No fake SyntheticCanaryQualification, authority constructor or canary-positive receipt exists.
@Suite struct PrivacySyntheticTrialScopeTests {
    private func policy() throws -> SyntheticTrialURLPolicy {
        try .init(runID: "trial-nonce", origins: [URL(string: "https://fixture-one.example.org")!, URL(string: "https://fixture-two.example.org")!], noncePrefix: "/ynx-route-probe/trial-nonce/")
    }
    private func request(_ text: String) -> URLRequest { URLRequest(url: URL(string: text)!) }
    @Test func scopedDataChecksAcceptOnlyExactNonceHTTPSAndCorrespondingWSS() throws {
        let p = try policy()
        for origin in ["https://fixture-one.example.org", "https://fixture-two.example.org", "wss://fixture-one.example.org", "wss://fixture-two.example.org"] {
            try p.validate(request(origin + "/ynx-route-probe/trial-nonce/proof"))
            try p.validate(request(origin + "/ynx-route-probe/trial-nonce/long-wss?probe=baseline-long-wss"))
        }
    }
    @Test func scopeRequiresExactlyTwoCanonicalHTTPSOriginsAndTheExactNonce() throws {
        let a = URL(string: "https://fixture-one.example.org")!, b = URL(string: "https://fixture-two.example.org")!
        for origins in [[], [a], [a,a], [a,b,a], [URL(string:"http://fixture-one.example.org")!,b], [URL(string:"https://u:p@fixture-one.example.org")!,b], [URL(string:"https://fixture-one.example.org:8443")!,b], [URL(string:"https://fixture-one.example.org/")!,b], [URL(string:"https://fixture-one.example.org/path")!,b], [URL(string:"https://fixture-one.example.org?q=x")!,b], [URL(string:"https://127.0.0.1")!,b]] {
            #expect(throws: PrivacySyntheticTrialFailure.invalidScope) { _ = try SyntheticTrialURLPolicy(runID:"trial-nonce",origins:origins,noncePrefix:"/ynx-route-probe/trial-nonce/") }
        }
        #expect(throws: PrivacySyntheticTrialFailure.invalidScope) { _ = try SyntheticTrialURLPolicy(runID:"trial-nonce",origins:[a,b],noncePrefix:"/ynx-route-probe/other/") }
    }
    @Test func ordinaryInputCrossOriginSchemesAndWrongNonceAreRejected() throws {
        let p = try policy()
        for value in ["https://duckduckgo.com/?q=private", "https://fixture-one.example.org/", "https://fixture-one.example.org/account", "https://fixture-one.example.org/ynx-route-probe/other/proof", "https://fixture-one.example.org.evil.org/ynx-route-probe/trial-nonce/proof", "http://fixture-one.example.org/ynx-route-probe/trial-nonce/proof", "ws://fixture-one.example.org/ynx-route-probe/trial-nonce/wss", "https://fixture-one.example.org:8443/ynx-route-probe/trial-nonce/proof", "https://user:pass@fixture-one.example.org/ynx-route-probe/trial-nonce/proof", "file:///tmp/profile", "data:text/html,private", "ynxwallet://authorize"] {
            #expect(throws: PrivacySyntheticTrialFailure.unsafeTarget) { try p.validate(request(value)) }
        }
    }
    @Test func encodedTraversalAlternateSeparatorsAndFragmentsCannotEscapeScope() throws {
        let p = try policy(), prefix = "https://fixture-one.example.org/ynx-route-probe/trial-nonce/"
        for suffix in ["../secret", "%2e%2e/secret", "%2Fsecret", "%5csecret", "x//y", "x/./y", "proof#private", "%70roof", "proof%00", "proof;user=value", ""] {
            #expect(throws: PrivacySyntheticTrialFailure.unsafeTarget) { try p.validate(request(prefix + suffix)) }
        }
    }
    @Test func queryIsOneKnownSyntheticProbeRatherThanAnArbitraryUserPayload() throws {
        let p = try policy(), prefix = "https://fixture-one.example.org/ynx-route-probe/trial-nonce/proof?"
        for query in ["probe=baseline-https", "probe=fault-retry-long-wss", "probe=user-retry-cross-origin", "probe=baseline-redirect-http"] { try p.validate(request(prefix+query)) }
        for query in ["q=private-query", "probe=baseline-https&url=https://duckduckgo.com", "probe=baseline-https&probe=baseline-https", "probe=%62aseline-https", "probe=unknown", "probe=baseline-user-url", "", "token=secret"] {
            #expect(throws: PrivacySyntheticTrialFailure.unsafeTarget) { try p.validate(request(prefix+query)) }
        }
    }
    @Test func methodAndBodyCannotTurnTrialScopeIntoWalletOrOtherWrites() throws {
        let p = try policy(); var r = request("https://fixture-one.example.org/ynx-route-probe/trial-nonce/proof")
        r.httpMethod = "HEAD"; try p.validate(r)
        for method in ["POST", "PUT", "DELETE", "CONNECT", "PATCH"] { r.httpMethod=method; #expect(throws: PrivacySyntheticTrialFailure.unsafeTarget) { try p.validate(r) } }
        r.httpMethod="GET";r.httpBody=Data("private payload".utf8)
        #expect(throws: PrivacySyntheticTrialFailure.unsafeTarget) { try p.validate(r) }
    }
}
#endif
