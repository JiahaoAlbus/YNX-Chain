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
    init(permitsWebContent: Bool, reason: String) { self.permitsWebContent = permitsWebContent; self.reason = reason }
    public static let current = RoutedPlatformIsolationAdmission(permitsWebContent: false, reason: "Full-window DNS, WebRTC/STUN, UDP, download and failure isolation has not been verified for this installation. Privacy routes remain disabled.")
}

/// Window-scoped fence. No target URL, cookie, Wallet session or history is persisted here.
@MainActor public final class PrivacyRouteSession {
    public let mode: PrivacyRouteMode
    public private(set) var state: PrivacyRouteStatus = .blocked("Route not started")
    public private(set) var endpoint: PrivacyRouteEndpoint?
    private let provider: any PrivacyRouteProvider
    private let admission: RoutedPlatformIsolationAdmission
    private var generation: UInt64 = 0
    public init(provider: any PrivacyRouteProvider) {
        self.provider = provider; mode = provider.mode; admission = .current
    }
    init(provider: any PrivacyRouteProvider, admission: RoutedPlatformIsolationAdmission) {
        self.provider = provider; mode = provider.mode; self.admission = admission
    }
    public func start() async {
        generation &+= 1; let expected = generation; endpoint = nil
        guard admission.permitsWebContent else { state = .blocked(admission.reason); return }
        state = .connecting
        do {
            let candidate = try await provider.start()
            guard generation == expected else { await block("Late route startup was cancelled"); return }
            guard await provider.status() == .connected, generation == expected else { await block("Route not ready"); return }
            endpoint = candidate; state = .connected
        } catch { if generation == expected { await block("Route failed; direct fallback is disabled") } }
    }
    public func status() async -> PrivacyRouteStatus {
        let expected = generation
        if state == .connected {
            let current = await provider.status()
            if generation == expected && current != .connected { await block("Route disconnected; direct fallback is disabled") }
        }
        return state
    }
    public func stop() async { await block("Route stopped") }
    public func block(_ reason: String) async {
        generation &+= 1; endpoint = nil; state = .blocked(reason)
        await provider.stop()
    }
    public func authorize(_ url: URL) throws {
        guard admission.permitsWebContent, state == .connected, endpoint != nil else { throw PrivacyRouteError.blocked }
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["https", "wss"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host?.lowercased(), !host.isEmpty,
              host != "localhost", !host.hasSuffix(".localhost"), host != "127.0.0.1", host != "[::1]",
              parts.user == nil, parts.password == nil else { throw PrivacyRouteError.unsafeTarget }
    }
    public func resolveOmnibox(_ input: String, provider: BrowserSearchProvider = .duckDuckGo) throws -> URL {
        let url = try BrowserOmnibox.resolveOmnibox(input, provider: provider)
        try authorize(url); return url
    }
    public func restoreBrowserSession() -> [BrowserSessionTab] { [] }
}
