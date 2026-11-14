import Testing
import Foundation
@testable import YNXBrowserCore

@MainActor private final class TestRoute: PrivacyRouteProvider {
    let mode: PrivacyRouteMode = .tor
    var current: PrivacyRouteStatus = .connected
    var starts = 0
    var delayStart = false
    var pending: CheckedContinuation<PrivacyRouteEndpoint, any Error>?
    func start() async throws -> PrivacyRouteEndpoint {
        starts += 1
        if delayStart { return try await withCheckedThrowingContinuation { pending = $0 } }
        return try PrivacyRouteEndpoint(port: 9150)
    }
    func status() async -> PrivacyRouteStatus { current }
    func stop() async { current = .blocked("stopped") }
}
@Suite @MainActor struct PrivacyRouteProviderTests {
    private func qualifiedFixture() -> RoutedPlatformIsolationAdmission {
        let ready = PrivacyRouteReadiness.Check(state: .ready, reason: "Synthetic qualification fixture; no actual NE admission")
        return .init(permitsWebContent: true, reason: "Isolated state-machine fixture only",
                     leakSafety: .init(checks: Dictionary(uniqueKeysWithValues: PrivacyRouteReadiness.LeakSurface.allCases.map { ($0, ready) })),
                     releaseApproved: ready)
    }
    @Test func unverifiedPlatformNeverStartsOrLoads() async throws {
        let backend = TestRoute(); let session = PrivacyRouteSession(provider: backend)
        await session.start()
        #expect(backend.starts == 0)
        #expect(throws: PrivacyRouteError.blocked) { try session.resolveOmnibox("https://example.org/") }
        #expect(session.restoreBrowserSession().isEmpty)
    }
    @Test func routeDropStopsAndNeverFallsBack() async throws {
        let backend = TestRoute()
        let session = PrivacyRouteSession(provider: backend, admission: qualifiedFixture())
        await session.start(); #expect(session.state == .connected)
        try session.confirmBrowserRouteBinding()
        try session.authorize(URL(string: "https://example.org/")!)
        #expect(throws: PrivacyRouteError.unsafeTarget) { try session.authorize(URL(string: "http://example.org/")!) }
        backend.current = .blocked("process exited")
        _ = await session.status()
        #expect(session.endpoint == nil)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(URL(string: "https://example.org/")!) }
        #expect(backend.starts == 1)
    }
    @Test func stopCancelsAuthorityWithoutChangingMode() async throws {
        let session = PrivacyRouteSession(provider: TestRoute(), admission: qualifiedFixture())
        await session.start(); await session.stop()
        #expect(session.mode == .tor); #expect(session.endpoint == nil)
        #expect(throws: PrivacyRouteError.blocked) { try session.resolveOmnibox("synthetic query") }
    }
    @Test func cancelledLateStartupCannotReopenRoute() async throws {
        let backend = TestRoute(); backend.delayStart = true
        let session = PrivacyRouteSession(provider: backend, admission: qualifiedFixture())
        let operation = Task { await session.start() }
        while backend.pending == nil { await Task.yield() }
        await session.stop()
        backend.pending?.resume(returning: try PrivacyRouteEndpoint(port: 9150))
        await operation.value
        #expect(session.endpoint == nil)
        #expect(throws: PrivacyRouteError.blocked) { try session.authorize(URL(string: "https://example.org/")!) }
    }
}
