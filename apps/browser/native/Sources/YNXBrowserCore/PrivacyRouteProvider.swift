import Foundation

public enum PrivacyRouteMode: String, CaseIterable, Sendable { case tor = "Tor", nym = "Nym Mixnet" }
public enum PrivacyRouteStatus: Equatable, Sendable {
    case connecting
    case connected
    case blocked(String)
}
public struct PrivacyRouteEndpoint: Equatable, Sendable {
    public let port: UInt16
    public init(port: UInt16) throws {
        guard port > 0 else { throw PrivacyRouteError.invalidEndpoint }
        self.port = port
    }
    public var host: String { "127.0.0.1" }
}
public enum PrivacyRouteError: Error, Equatable { case invalidEndpoint, blocked, stale, unsafeTarget }

/// URL syntax only. The caller must separately hold a current route admission.
public enum PrivacyRouteWebTarget {
    public static func allows(_ url: URL, mode: PrivacyRouteMode) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme?.lowercased(),
              let host = parts.host?.lowercased(), !host.isEmpty,
              host != "localhost", !host.hasSuffix(".localhost"), host != "127.0.0.1", host != "[::1]",
              parts.user == nil, parts.password == nil else { return false }
        if BrowserOmnibox.isOnionHost(host) {
            return mode == .tor && ["http", "https", "ws", "wss"].contains(scheme)
                && (parts.port.map { (1...65535).contains($0) } ?? true)
                && parts.percentEncodedHost?.lowercased() == host && isValidOnionV3(host)
        }
        return ["https", "wss"].contains(scheme)
    }

    public static func allowsDownloadRedirect(from source: URL?, to target: URL, mode: PrivacyRouteMode) -> Bool {
        if target.scheme?.lowercased() == "https" { return allows(target, mode: mode) }
        guard mode == .tor, target.scheme?.lowercased() == "http",
              let source, source.scheme?.lowercased() == "http",
              source.host?.lowercased() == target.host?.lowercased(),
              (source.port ?? 80) == (target.port ?? 80) else { return false }
        return allows(source, mode: mode) && allows(target, mode: mode)
    }

    private static func isValidOnionV3(_ host: String) -> Bool {
        // Tor rend-spec: base32(PUBKEY || CHECKSUM || VERSION).
        guard host.hasSuffix(".onion"), host.utf8.count == 62 else { return false }
        var decoded: [UInt8] = []
        var buffer: UInt16 = 0
        var bits = 0
        for byte in host.utf8.prefix(56) {
            let digit: UInt8
            switch byte {
            case 97...122: digit = byte - 97
            case 50...55: digit = byte - 24
            default: return false
            }
            buffer = (buffer << 5) | UInt16(digit)
            bits += 5
            if bits >= 8 {
                bits -= 8
                decoded.append(UInt8(truncatingIfNeeded: buffer >> bits))
            }
        }
        guard decoded.count == 35, decoded[34] == 3 else { return false }
        var checksumInput = Data(".onion checksum".utf8)
        checksumInput.append(contentsOf: decoded.prefix(32))
        checksumInput.append(3)
        let checksum = BrowserSHA3.hash256(checksumInput)
        return checksum[0] == decoded[32] && checksum[1] == decoded[33]
    }
}

/// A local adapter's lifecycle is not proof that all WebKit traffic follows the route.
@MainActor public protocol PrivacyRouteProvider: AnyObject {
    var mode: PrivacyRouteMode { get }
    func start() async throws -> PrivacyRouteEndpoint
    func status() async -> PrivacyRouteStatus
    func stop() async
}

/// No public initializer or runtime switch can turn missing isolation evidence into admission.
public struct RoutedPlatformIsolationAdmission: Sendable {
    public let permitsWebContent: Bool
    public let reason: String
    public let leakSafety: PrivacyRouteReadiness.LeakSafety
    public let releaseApproved: PrivacyRouteReadiness.Check
    // Internal fixtures must supply each required qualification explicitly. No diagnostic
    // snapshot, public Boolean, environment value or historical backend result is consumed.
    init(permitsWebContent: Bool, reason: String,
         leakSafety: PrivacyRouteReadiness.LeakSafety = .init(checks: [:]),
         releaseApproved: PrivacyRouteReadiness.Check = .init(state: .notRun, reason: "Release approval not supplied")) {
        self.permitsWebContent = permitsWebContent; self.reason = reason
        self.leakSafety = leakSafety; self.releaseApproved = releaseApproved
    }
    public static var current: RoutedPlatformIsolationAdmission {
        denied(RoutedProductionQualification.currentFailure())
    }
    static func denied(_ failure: RoutedQualificationFailure) -> RoutedPlatformIsolationAdmission {
        RoutedPlatformIsolationAdmission(
        permitsWebContent: false,
        reason: failure.explanation,
        leakSafety: .init(checks: [
            .dns: .init(state: .notRun, reason: "Current-installation remote DNS and resolver attribution not qualified"),
            .webRTCIPv4: .init(state: .failed, reason: "Prior qualification observed STUN IPv4 escape; current installation has not passed requalification"),
            .webRTCIPv6: .init(state: .failed, reason: "Prior qualification observed STUN IPv6 escape; current installation has not passed requalification"),
            .webSocket: .init(state: .notRun, reason: "Current-installation WebSocket/WSS isolation not qualified"),
            .downloads: .init(state: .notRun, reason: "Protected download and redirect isolation not qualified"),
            .ipv6: .init(state: .notRun, reason: "Current-installation IPv6 flow attribution not qualified"),
            .routeLoss: .init(state: .notRun, reason: "Current-installation route-loss direct-connect denial not qualified"),
            .quic: .init(state: .notRun, reason: "Current-installation QUIC/UDP handling not qualified"),
            .resources: .init(state: .notRun, reason: "Full-window subresource/auxiliary-process isolation not qualified")
        ]),
        releaseApproved: .init(state: failure == .qualificationIssuerNotSupplied ? .notRun : .blocked, reason: failure.explanation))
    }

    var staticQualificationComplete: Bool { permitsWebContent && leakSafety.qualificationComplete }
    var staticBlockReason: String {
        permitsWebContent ? "Required leak qualification is incomplete: " + leakSafety.reason : reason
    }
}

/// Window-scoped fence. No target URL, cookie, Wallet session or history is persisted here.
@MainActor public final class PrivacyRouteSession {
    public let mode: PrivacyRouteMode
    public private(set) var state: PrivacyRouteStatus = .blocked("Route not started")
    public private(set) var endpoint: PrivacyRouteEndpoint?
    private let provider: any PrivacyRouteProvider
    private var admission: RoutedPlatformIsolationAdmission
    private var productionQualification: RoutedProductionQualification?
    private let requiresProductionQualification: Bool
    private var qualificationStop: Task<Void, Never>?
    private var startupInFlight = false
    public private(set) var qualificationFailure: RoutedQualificationFailure?
    private var generation: UInt64 = 0
    private var browserBindingGeneration: UInt64?
    private var transport: PrivacyRouteReadiness.Check = .init(state: .notRun, reason: "Current protected transport has not run; historical backend evidence is not current readiness")
    private var browser: PrivacyRouteReadiness.Check = .init(state: .notRun, reason: "No actual proxy-configured WebKit view is bound")
    private var search: PrivacyRouteReadiness.Check = .init(state: .notRun, reason: "No current search-site outcome observed")

    public convenience init(provider: any PrivacyRouteProvider) {
        let qualification: Result<RoutedProductionQualification, RoutedQualificationFailure>
        do { qualification = .success(try RoutedProductionQualification.acquireCurrent(mode: provider.mode)) }
        catch { qualification = .failure((error as? RoutedQualificationFailure) ?? .invalidSignature) }
        self.init(provider: provider, qualification: qualification)
    }
    /// A normal window can share the protection owner's opaque qualification.
    /// A failure only records refusal and cannot start a provider.
    public init(provider: any PrivacyRouteProvider, qualification: Result<RoutedProductionQualification, RoutedQualificationFailure>) {
        self.provider = provider; mode = provider.mode; requiresProductionQualification = true
        do {
            let qualified = try qualification.get()
            try qualified.requireCurrent(mode: provider.mode)
            productionQualification = qualified; admission = qualified.admission
            try qualified.installRevocationHandler { [weak self, weak qualified] in self?.invalidateQualification(qualified?.failure ?? .revoked) }
        } catch {
            let failure = (error as? RoutedQualificationFailure) ?? .invalidSignature
            productionQualification = nil
            qualificationFailure = failure; admission = .denied(failure)
            state = .blocked(failure.explanation)
            transport = .init(state: .notRun, reason: failure.explanation)
            browser = .init(state: .blocked, reason: failure.explanation)
        }
    }
    init(provider: any PrivacyRouteProvider, admission: RoutedPlatformIsolationAdmission) {
        self.provider = provider; mode = provider.mode; self.admission = admission
        requiresProductionQualification = false // Existing INTERNAL state-machine fixtures only.
    }
    public var readiness: PrivacyRouteReadiness {
        if productionQualification != nil { _ = refreshQualification() }
        let health: PrivacyRouteReadiness.Check
        if state == .connected, endpoint != nil, transport.state == .ready, browserBindingGeneration == generation {
            health = .init(state: .ready, reason: "Current transport and WK binding are live in this generation; all installation checks are separately required")
        } else if state == .connected, endpoint != nil, transport.state == .ready {
            health = .init(state: .notRun, reason: "Transport is connected but current protected WK binding is not yet confirmed")
        } else {
            health = .init(state: transport.state == .ready ? .blocked : transport.state, reason: transport.reason)
        }
        return .init(mode: mode, transportReady: transport, browserRouteReady: browser,
                     leakSafe: .init(checks: admission.leakSafety.checks, currentRoute: health),
                     searchAvailable: search, releaseApproved: admission.releaseApproved)
    }
    public func start(onConnecting: () -> Void = {}) async {
        // Static bootstrap qualification does not depend on a transport or WK view that has
        // not yet been created. Repeated starts cannot create a second provider operation.
        guard !startupInFlight, state != .connecting, state != .connected else { return }
        generation &+= 1; let expected = generation; endpoint = nil; browserBindingGeneration = nil
        guard refreshQualification(), admission.staticQualificationComplete else {
            state = .blocked(admission.staticBlockReason)
            transport = .init(state: .notRun, reason: admission.staticBlockReason)
            browser = .init(state: .blocked, reason: admission.staticBlockReason)
            return
        }
        transport = .init(state: .checking, reason: "Current protected backend is starting")
        browser = .init(state: .notRun, reason: "Waiting for actual proxy-configured WebKit binding after transport startup")
        state = .connecting
        startupInFlight = true
        defer { startupInFlight = false }
        onConnecting()
        do {
            let candidate = try await provider.start()
            guard generation == expected else {
                if let qualificationStop { await qualificationStop.value } else { await provider.stop() }
                return
            }
            guard refreshQualification() else { return }
            let providerStatus = await provider.status()
            guard generation == expected, refreshQualification() else { return }
            guard providerStatus == .connected else {
                transport = .init(state: .failed, reason: "Current backend did not confirm connected transport")
                await block("Route not ready"); return
            }
            endpoint = candidate; state = .connected
            transport = .init(state: .ready, reason: "Current generation backend confirmed connected; WebKit binding is still required")
        } catch {
            if generation == expected {
                transport = .init(state: .failed, reason: "Current protected backend startup failed; direct fallback is disabled")
                await block("Route failed; direct fallback is disabled")
            }
        }
    }
    public func status() async -> PrivacyRouteStatus {
        if !refreshQualification() { if let qualificationStop { await qualificationStop.value }; return state }
        let expected = generation
        if state == .connected {
            let current = await provider.status()
            guard refreshQualification() else { if let qualificationStop { await qualificationStop.value }; return state }
            if generation == expected && current != .connected {
                transport = .init(state: .failed, reason: "Current backend disconnected; earlier qualification is not live route health")
                await block("Route disconnected; direct fallback is disabled")
            }
        }
        return state
    }
    /// Native calls only after creating the actual proxy-configured WK view and passing its
    /// fresh protection lease gate. This records a generation-bound binding, not NE authority.
    public func confirmBrowserRouteBinding() throws {
        guard refreshQualification(), admission.staticQualificationComplete, state == .connected, endpoint != nil,
              transport.state == .ready else { throw PrivacyRouteError.blocked }
        browserBindingGeneration = generation
        browser = .init(state: .ready, reason: "Actual proxy-configured WebKit binding confirmed for the current transport generation")
    }
    /// Website outcome only: HTTP403, CAPTCHA, geography, exit reputation and timeouts never
    /// change transport, installation safety, browser binding, release or target admission.
    public func recordSearchAvailability(_ observation: PrivacyRouteReadiness.Check) { search = observation }
    public func stop() async { await block("Route stopped") }
    public func block(_ reason: String) async {
        generation &+= 1; endpoint = nil; browserBindingGeneration = nil; state = .blocked(reason)
        if transport.state == .ready || transport.state == .checking { transport = .init(state: .blocked, reason: reason) }
        browser = .init(state: .blocked, reason: reason)
        if let qualificationStop { await qualificationStop.value } else { await provider.stop() }
    }
    private func refreshQualification() -> Bool {
        guard requiresProductionQualification else { return true }
        guard let qualification = productionQualification else { return false }
        do { try qualification.requireCurrent(mode: mode); return true }
        catch { invalidateQualification((error as? RoutedQualificationFailure) ?? .invalidSignature); return false }
    }
    private func invalidateQualification(_ failure: RoutedQualificationFailure) {
        if qualificationFailure == nil { qualificationFailure = failure }
        generation &+= 1; endpoint = nil; browserBindingGeneration = nil
        state = .blocked(failure.explanation); admission = .denied(failure)
        if transport.state == .ready || transport.state == .checking { transport = .init(state: .blocked, reason: failure.explanation) }
        browser = .init(state: .blocked, reason: failure.explanation)
        if qualificationStop == nil { let owned = provider; qualificationStop = Task { @MainActor in await owned.stop() } }
    }
    public func authorize(_ url: URL) throws {
        // Use only owned immutable qualification and current dynamic state. The public
        // readiness snapshot and search-site diagnostics are never authority inputs.
        guard refreshQualification(), admission.staticQualificationComplete, admission.releaseApproved.state == .ready,
              state == .connected, endpoint != nil, transport.state == .ready,
              browserBindingGeneration == generation else { throw PrivacyRouteError.blocked }
        guard PrivacyRouteWebTarget.allows(url, mode: mode) else { throw PrivacyRouteError.unsafeTarget }
    }
    public func resolveOmnibox(_ input: String, provider: BrowserSearchProvider = .duckDuckGo) throws -> URL {
        let url = try BrowserOmnibox.resolveOmnibox(input, provider: provider, allowTorOnion: mode == .tor)
        try authorize(url); return url
    }
    public func restoreBrowserSession() -> [BrowserSessionTab] { [] }
}
