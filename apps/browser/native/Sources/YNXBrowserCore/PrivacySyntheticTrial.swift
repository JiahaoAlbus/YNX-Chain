#if YNX_PRIVACY_ACCEPTANCE
import Foundation

public enum PrivacySyntheticTrialFailure: Error, Equatable {
    case invalidScope, unsafeTarget, bindingChanged, transportNotReady, browserNotBound, revoked
}

/// Syntax/scope checking only. This value is not a canary result, NE permission, release
/// approval or a public way to construct SyntheticTrialAuthority/Qualification.
struct SyntheticTrialURLPolicy {
    let runID: String
    let originStrings: Set<String>
    let noncePrefix: String
    init(runID: String, origins: [URL], noncePrefix: String) throws {
        guard runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              origins.count == 2, noncePrefix == "/ynx-route-probe/\(runID)/" else { throw PrivacySyntheticTrialFailure.invalidScope }
        var exact: Set<String> = []
        for origin in origins {
            guard let parts = URLComponents(url: origin, resolvingAgainstBaseURL: false), parts.scheme == "https",
                  parts.port == nil, parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
                  parts.percentEncodedPath.isEmpty, let host = parts.host,
                  host.range(of: "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", options: .regularExpression) != nil,
                  !host.hasSuffix(".local"), !host.hasSuffix(".localhost"),
                  origin.absoluteString == "https://" + host, exact.insert(origin.absoluteString).inserted else { throw PrivacySyntheticTrialFailure.invalidScope }
        }
        self.runID = runID; originStrings = exact; self.noncePrefix = noncePrefix
    }
    func validate(_ request: URLRequest) throws {
        guard ["GET", "HEAD"].contains(request.httpMethod ?? "GET"), request.httpBody == nil, request.httpBodyStream == nil,
              let url = request.url, url.absoluteString.utf8.count < 4096,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["https", "wss"].contains(parts.scheme ?? ""), let host = parts.host,
              originStrings.contains("https://" + host), parts.port == nil || parts.port == 443,
              parts.user == nil, parts.password == nil, parts.fragment == nil else { throw PrivacySyntheticTrialFailure.unsafeTarget }
        // Never decode and re-encode a path that could cross the nonce boundary. The original
        // fixture uses ASCII names and has no encoded path, dot-segment or alternate separator.
        let path = parts.percentEncodedPath
        guard path.hasPrefix(noncePrefix), path.utf8.count <= 256,
              path.range(of: "^[a-zA-Z0-9/_-]+$", options: .regularExpression) != nil,
              !path.contains("//"), !path.dropFirst(noncePrefix.count).isEmpty else { throw PrivacySyntheticTrialFailure.unsafeTarget }
        if let query = parts.percentEncodedQuery {
            guard query.range(of: "^probe=(?:baseline|fault-retry|user-retry)-(?:https|long-wss|stream-download|redirect-same|redirect-cross|redirect-http|cross-origin|plain-ws)$", options: .regularExpression) != nil else { throw PrivacySyntheticTrialFailure.unsafeTarget }
        }
    }
}

/// Separate compile-time-only synthetic consumer. It cannot be initialized from a Boolean,
/// ordinary JSON, a RootDenyReceipt, historical backend success or a diagnostic snapshot.
/// Only C's opaque authority after the *actual WebKit* NE canary may construct this session.
@MainActor public final class PrivacySyntheticTrialSession: PrivacyRouteRequestAuthorizing {
    public let binding: SyntheticTrialBinding
    public let mode: PrivacyRouteMode
    public private(set) var endpoint: PrivacyRouteEndpoint?
    public private(set) var state: PrivacyRouteStatus = .blocked("Synthetic trial transport not started")
    private let authority: SyntheticTrialAuthority
    private let provider: any PrivacyRouteProvider
    private let candidate: PrivacyRouteEndpoint
    private let policy: SyntheticTrialURLPolicy
    private var revoked = false, browserBound = false, starting = false
    private var shutdown: Task<Void, Never>?
    private var revocationHandlers: [@MainActor () -> Void] = []
    private var transport: PrivacyRouteReadiness.Check = .init(state: .notRun, reason: "Current synthetic transport has not been confirmed; canary is not backend readiness")

    public init(authority: SyntheticTrialAuthority, provider: any PrivacyRouteProvider, endpoint: PrivacyRouteEndpoint) throws {
        let qualification = try authority.requireQualification() // Root-only/self-only canary is insufficient.
        let bound = authority.binding
        try authority.verify(binding: bound)
        let lease = try authority.requireLive()
        guard lease.phase == .routeEntryConnected, lease.providerGeneration == bound.providerGeneration else { throw PrivacySyntheticTrialFailure.transportNotReady }
        guard qualification.binding == bound, provider.mode == (bound.mode == .tor ? .tor : .nym) else { throw PrivacySyntheticTrialFailure.bindingChanged }
        let policy = try SyntheticTrialURLPolicy(runID: bound.runID, origins: authority.scope.origins, noncePrefix: authority.scope.noncePrefix)
        try authority.validateEndpoint(endpoint, binding: bound)
        self.authority = authority; self.provider = provider; candidate = endpoint
        binding = bound; mode = provider.mode; self.policy = policy
        try authority.installRevocationHandler { [weak self] in
            self?.revokeNow("Synthetic authenticated authority revoked")
        }
    }
    /// Native removes its WK view and cancels downloads synchronously from this callback.
    /// Observers can only withdraw access; registering one never grants a request.
    public func installRevocationHandler(_ handler: @escaping @MainActor () -> Void) throws {
        guard !revoked else { throw PrivacySyntheticTrialFailure.revoked }
        revocationHandlers.append(handler)
    }
    public var readiness: PrivacyRouteReadiness {
        let pending = PrivacyRouteReadiness.Check(state: .checking, reason: "Scoped synthetic qualification in progress; canary does not prove full DNS/RTC/WS/download/IPv6/route-loss/QUIC/resource isolation")
        return .init(mode: mode, transportReady: transport,
            browserRouteReady: .init(state: browserBound && !revoked ? .ready : (revoked ? .blocked : .notRun),
                reason: browserBound && !revoked ? "Synthetic WK binding only; no ordinary privacy-page authority" : "Synthetic WK binding absent or revoked"),
            leakSafe: .init(checks: Dictionary(uniqueKeysWithValues: PrivacyRouteReadiness.LeakSurface.allCases.map { ($0, pending) }),
                currentRoute: .init(state: revoked ? .blocked : .checking, reason: "Synthetic experiment only; production qualification stays unchanged")),
            searchAvailable: .init(state: .notRun, reason: "Search/DDG/user input is outside this synthetic role"),
            releaseApproved: .init(state: .notRun, reason: "Synthetic canary/baseline is not release approval"))
    }
    /// The independent Native owner starts its authentic scoped backend. This method does not
    /// call the production provider's guarded start() or import a historical TransportReady.
    public func start() async throws {
        guard !revoked, !starting, endpoint == nil else { throw PrivacySyntheticTrialFailure.revoked }
        starting = true; defer { starting = false }
        do {
            try requireCurrent()
            guard await provider.status() == .connected else { throw PrivacySyntheticTrialFailure.transportNotReady }
            try requireCurrent()
            endpoint = candidate; state = .connected
            transport = .init(state: .ready, reason: "Current owned synthetic backend reports connected under the same authenticated trial binding")
        } catch { revokeNow("Synthetic transport or authority not ready"); throw error }
    }
    public func confirmBrowserRouteBinding() throws {
        do {
            try requireCurrent()
            guard state == .connected, endpoint == candidate else { throw PrivacySyntheticTrialFailure.transportNotReady }
            browserBound = true
        } catch { revokeNow("Synthetic WK binding refused"); throw error }
    }
    public func authorize(_ url: URL) throws { try authorize(request: URLRequest(url: url)) }
    /// Native delegates should pass the actual request, including its method/body. Both this
    /// local narrowing and the authentic authority's real live-lease check are required.
    public func authorize(request: URLRequest) throws {
        do {
            guard !revoked, state == .connected, browserBound, endpoint == candidate else { throw PrivacySyntheticTrialFailure.browserNotBound }
            try policy.validate(request)
            try authority.authorize(request: request, binding: binding)
            try requireCurrent()
        } catch let error as PrivacySyntheticTrialFailure where error == .unsafeTarget {
            // An out-of-scope request is refused, never converted to a search or direct fallback.
            throw error
        } catch { revokeNow("Synthetic binding/control lease lost"); throw error }
    }
    public func status() async -> PrivacyRouteStatus {
        guard !revoked, endpoint != nil else { return state }
        do {
            try requireCurrent()
            guard await provider.status() == .connected else { throw PrivacySyntheticTrialFailure.transportNotReady }
            try requireCurrent()
        } catch { await block("Synthetic route/control lost") }
        return state
    }
    public func stop() async { await block("Synthetic trial stopped") }
    public func block(_ reason: String) async {
        revokeNow(reason) // Synchronous endpoint/binding/authority revocation precedes async cleanup.
        if let shutdown { await shutdown.value }
    }
    private func requireCurrent() throws {
        guard !revoked, authority.binding == binding, try authority.requireQualification().binding == binding else { throw PrivacySyntheticTrialFailure.bindingChanged }
        try authority.verify(binding: binding)
        let lease = try authority.requireLive()
        guard lease.phase == .routeEntryConnected, lease.providerGeneration == binding.providerGeneration else { throw PrivacySyntheticTrialFailure.bindingChanged }
        try authority.validateEndpoint(candidate, binding: binding)
    }
    private func revokeNow(_ reason: String) {
        guard !revoked else { return }
        revoked = true; browserBound = false; endpoint = nil; state = .blocked(reason)
        transport = .init(state: transport.state == .notRun ? .notRun : .blocked, reason: reason)
        authority.revoke()
        let handlers = revocationHandlers; revocationHandlers.removeAll()
        for handler in handlers { handler() }
        if shutdown == nil { shutdown = Task { @MainActor [provider] in await provider.stop() } }
    }
}
#endif
