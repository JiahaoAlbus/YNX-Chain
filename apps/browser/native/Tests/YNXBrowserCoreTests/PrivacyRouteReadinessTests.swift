import Foundation
import Testing
@testable import YNXBrowserCore

@MainActor private final class ReadinessRoute: PrivacyRouteProvider {
    let mode: PrivacyRouteMode
    var state: PrivacyRouteStatus = .connected
    var starts = 0, stops = 0
    var delayStop = false
    var pendingStop: CheckedContinuation<Void, Never>?
    init(_ mode: PrivacyRouteMode = .tor) { self.mode = mode }
    func start() async throws -> PrivacyRouteEndpoint { starts += 1; return try .init(port: mode == .tor ? 9150 : 19160) }
    func status() async -> PrivacyRouteStatus { state }
    func stop() async {
        stops += 1
        if delayStop { await withCheckedContinuation { pendingStop = $0 } }
    }
}

@Suite @MainActor struct PrivacyRouteReadinessTests {
    private let url = URL(string: "https://example.org/")!
    private var passed: PrivacyRouteReadiness.Check { .init(state: .ready, reason: "Synthetic fixture only; not real platform evidence") }
    private func checks() -> [PrivacyRouteReadiness.LeakSurface: PrivacyRouteReadiness.Check] {
        Dictionary(uniqueKeysWithValues: PrivacyRouteReadiness.LeakSurface.allCases.map { ($0, passed) })
    }
    private func qualification(leaks: [PrivacyRouteReadiness.LeakSurface: PrivacyRouteReadiness.Check]? = nil,
                               release: PrivacyRouteReadiness.Check? = nil) -> RoutedPlatformIsolationAdmission {
        .init(permitsWebContent: true, reason: "Internal reducer fixture only", leakSafety: .init(checks: leaks ?? checks()), releaseApproved: release ?? passed)
    }
    @Test func legacyInitializerAloneCannotGrant() async throws {
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend,
            admission: .init(permitsWebContent: true, reason: "No qualification fixtures supplied"))
        session.recordSearchAvailability(passed)
        await session.start()
        #expect(backend.starts == 0 && session.endpoint == nil)
        #expect(session.readiness.leakSafe.state == .notRun)
        #expect(session.readiness.releaseApproved.state == .notRun)
        #expect(throws: PrivacyRouteError.blocked) { try session.confirmBrowserRouteBinding() }
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
    }
    @Test func routeBlockRevokesBindingBeforeAsynchronousProviderStopCompletes() async throws {
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend, admission: qualification())
        await session.start(); try session.confirmBrowserRouteBinding()
        backend.delayStop = true
        let shutdown = Task { await session.block("Protection lease lost") }
        while backend.pendingStop == nil { await Task.yield() }
        #expect(session.endpoint == nil)
        #expect(session.readiness.browserRouteReady.state == .blocked)
        #expect(session.readiness.transportReady.state == .blocked)
        #expect(session.readiness.leakSafe.currentRoute.state == .blocked)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
        backend.pendingStop?.resume(); backend.pendingStop = nil
        await shutdown.value
    }
    @Test func currentHardGateIsAuditableAndDoesNotClaimHistoricalTransport() async throws {
        let backend = ReadinessRoute(.nym), session = PrivacyRouteSession(provider: backend)
        #expect(!RoutedPlatformIsolationAdmission.current.permitsWebContent)
        #expect(session.readiness.transportReady.state == .notRun)
        #expect(session.readiness.browserRouteReady.state == .notRun)
        #expect(session.readiness.searchAvailable.state == .notRun)
        #expect(session.readiness.releaseApproved.state == .notRun)
        #expect(session.readiness.leakSafe.check(.webRTCIPv4).state == .failed)
        #expect(session.readiness.leakSafe.check(.webRTCIPv6).state == .failed)
        for surface in PrivacyRouteReadiness.LeakSurface.allCases where ![.webRTCIPv4, .webRTCIPv6].contains(surface) {
            #expect(session.readiness.leakSafe.check(surface).state == .notRun)
        }
        await session.start()
        #expect(backend.starts == 0)
        #expect(session.readiness.transportReady.state == .notRun)
        #expect(session.readiness.browserRouteReady.state == .blocked)
        #expect(session.readiness.transportReady.reason.contains("RootBlocked"))
        #expect(throws: PrivacyRouteError.blocked) { try session.confirmBrowserRouteBinding() }
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
    }
    @Test func bootstrapDoesNotDependOnAnUncreatedWebView() async throws {
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend, admission: qualification())
        #expect(throws: PrivacyRouteError.blocked) { try session.confirmBrowserRouteBinding() }
        await session.start()
        #expect(backend.starts == 1)
        #expect(session.state == .connected)
        #expect(session.readiness.transportReady.state == .ready)
        #expect(session.readiness.browserRouteReady.state == .notRun)
        #expect(session.readiness.leakSafe.state == .notRun)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
        try session.confirmBrowserRouteBinding()
        #expect(session.readiness.browserRouteReady.state == .ready)
        #expect(session.readiness.leakSafe.state == .ready)
        try session.authorize(url)
        await session.start()
        #expect(backend.starts == 1)
    }
    @Test func site403CaptchaGeographyExitAndTimeoutDoNotRevokeASafeRoute() async throws {
        let backend = ReadinessRoute(.nym), session = PrivacyRouteSession(provider: backend, admission: qualification())
        await session.start(); try session.confirmBrowserRouteBinding()
        let qualified = session.readiness
        for (state, reason) in [(PrivacyRouteReadiness.State.blocked, "HTTP403"), (.blocked, "CAPTCHA"), (.failed, "Regional restriction"), (.blocked, "Exit reputation refusal"), (.failed, "Website timeout")] {
            session.recordSearchAvailability(.init(state: state, reason: reason))
            #expect(session.readiness.searchAvailable == .init(state: state, reason: reason))
            #expect(session.readiness.transportReady == qualified.transportReady)
            #expect(session.readiness.browserRouteReady == qualified.browserRouteReady)
            #expect(session.readiness.leakSafe == qualified.leakSafe)
            #expect(session.readiness.releaseApproved == qualified.releaseApproved)
            #expect(session.endpoint != nil && session.state == .connected)
            try session.authorize(url)
        }
        #expect(backend.starts == 1 && backend.stops == 0)
    }
    @Test func everyMissingQualificationSurfaceDeniesEvenWithSearchResults() async throws {
        for missing in PrivacyRouteReadiness.LeakSurface.allCases {
            var evidence = checks(); evidence.removeValue(forKey: missing)
            let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend, admission: qualification(leaks: evidence))
            session.recordSearchAvailability(.init(state: .ready, reason: "Actual-site diagnostic fixture, not authority"))
            await session.start()
            #expect(backend.starts == 0)
            #expect(session.readiness.searchAvailable.state == .ready)
            #expect(session.readiness.leakSafe.check(missing).state == .notRun)
            #expect(throws: PrivacyRouteError.blocked) { try session.confirmBrowserRouteBinding() }
            #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
        }
    }
    @Test func knownRTCFailureCannotBeOverriddenBySearchOrCopiedReadySnapshot() async throws {
        var evidence = checks(); evidence[.webRTCIPv6] = .init(state: .failed, reason: "Known STUN IPv6 escape")
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend, admission: qualification(leaks: evidence))
        let diagnostic = PrivacyRouteReadiness(mode: .tor, transportReady: passed, browserRouteReady: passed,
            leakSafe: .init(checks: checks(), currentRoute: passed), searchAvailable: passed, releaseApproved: passed)
        #expect(diagnostic.transportReady.state == .ready) // Public construction has no apply/admit path.
        session.recordSearchAvailability(diagnostic.searchAvailable)
        await session.start()
        #expect(backend.starts == 0 && session.endpoint == nil)
        #expect(session.readiness.leakSafe.state == .failed)
        #expect(session.readiness.transportReady.state == .notRun)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
    }
    @Test func releaseUnapprovedIsSeparateFromSuccessfulTransportAndBinding() async throws {
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend,
            admission: qualification(release: .init(state: .notRun, reason: "Unsigned/unapproved candidate")))
        await session.start(); try session.confirmBrowserRouteBinding()
        #expect(session.readiness.transportReady.state == .ready)
        #expect(session.readiness.browserRouteReady.state == .ready)
        #expect(session.readiness.releaseApproved.state == .notRun)
        session.recordSearchAvailability(passed)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
        #expect(backend.starts == 1 && backend.stops == 0)
    }
    @Test func routeLossRevokesCurrentBindingWhileRetainingQualificationAsHistoricalEvidence() async throws {
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend, admission: qualification())
        await session.start(); try session.confirmBrowserRouteBinding()
        let before = session.readiness
        backend.state = .blocked("Actual backend loss fixture")
        _ = await session.status()
        #expect(session.endpoint == nil)
        #expect(session.readiness.transportReady.state == .failed)
        #expect(session.readiness.browserRouteReady.state == .blocked)
        #expect(session.readiness.leakSafe.state == .failed)
        #expect(session.readiness.leakSafe.checks == before.leakSafe.checks)
        #expect(session.readiness.leakSafe.currentRoute.state != .ready)
        session.recordSearchAvailability(passed)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
        #expect(throws: PrivacyRouteError.blocked) { try session.confirmBrowserRouteBinding() }
        #expect(backend.stops == 1)
    }
    @Test func torAndNymDiagnosticsAndBindingsRemainIndependent() async throws {
        let torBackend = ReadinessRoute(.tor), nymBackend = ReadinessRoute(.nym)
        let tor = PrivacyRouteSession(provider: torBackend, admission: qualification())
        let nym = PrivacyRouteSession(provider: nymBackend, admission: qualification())
        await tor.start(); await nym.start(); try tor.confirmBrowserRouteBinding()
        tor.recordSearchAvailability(.init(state: .blocked, reason: "DDG CAPTCHA in Tor"))
        #expect(tor.readiness.mode == .tor && nym.readiness.mode == .nym)
        #expect(nym.readiness.searchAvailable.state == .notRun)
        #expect(nym.readiness.browserRouteReady.state == .notRun)
        #expect(throws: PrivacyRouteError.blocked) { try nym.authorize(url) }
        try tor.authorize(url); try nym.confirmBrowserRouteBinding(); try nym.authorize(url)
        await tor.stop()
        #expect(tor.endpoint == nil && nym.endpoint != nil)
        try nym.authorize(url)
        #expect(nymBackend.stops == 0)
    }
    @Test func recoveringTransportRequiresANewCurrentWebViewBinding() async throws {
        let backend = ReadinessRoute(), session = PrivacyRouteSession(provider: backend, admission: qualification())
        await session.start(); try session.confirmBrowserRouteBinding(); try session.authorize(url)
        await session.stop(); await session.start()
        #expect(session.readiness.transportReady.state == .ready)
        #expect(session.readiness.browserRouteReady.state == .notRun)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(url) }
        try session.confirmBrowserRouteBinding(); try session.authorize(url)
        #expect(backend.starts == 2)
    }
}
