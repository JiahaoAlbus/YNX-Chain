import Foundation

// Complete audit tokens are opaque process-incarnation identities, not bearer authorizations.
// These must come from public kernel/NE APIs for an exact reviewed dedicated launch.
public struct AuditFlowFence {
    public enum ConfigurationError: Error { case invalidRunBinding }
    public enum Verdict: Equatable { case unownedAllowWithoutReading, allowRouteEntry, allowApprovedRouteTransport, dropOwned }
    public struct Endpoint: Equatable { public let host: String; public let port: UInt16; public let transport: Int32
        public init(host: String, port: UInt16, transport: Int32) { self.host = host; self.port = port; self.transport = transport }
    }
    public let appAuditToken: Data
    public let routeProcessAuditTokens: Set<Data>
    public let entries: [Endpoint]
    public let routeDestinations: [Endpoint]
    public private(set) var connected = false
    public init(appAuditToken: Data, routeProcessAuditTokens: Set<Data>, entries: [Endpoint], routeDestinations: [Endpoint] = []) throws {
        guard appAuditToken.count == 32, routeProcessAuditTokens.allSatisfy({ $0.count == 32 }),
              !entries.isEmpty, entries.allSatisfy({ ["127.0.0.1", "::1"].contains($0.host) && $0.port > 0 && $0.transport == 6 }), routeDestinations.allSatisfy({ !$0.host.isEmpty && !["*", "0.0.0.0", "::"].contains($0.host) && $0.port > 0 && [6,17].contains($0.transport) }) else { throw ConfigurationError.invalidRunBinding }
        self.appAuditToken = appAuditToken; self.routeProcessAuditTokens = routeProcessAuditTokens; self.entries = entries; self.routeDestinations = routeDestinations
    }
    public mutating func setConnected(_ value: Bool) { connected = value }
    public func decide(sourceApp: Data?, sourceProcess: Data?, endpoint: Endpoint?) -> Verdict {
        guard sourceApp == appAuditToken else { return .unownedAllowWithoutReading }
        // A matched responsible app plus absent/invalid actual-process token fails closed.
        guard let sourceProcess, sourceProcess.count == 32 else { return .dropOwned }
        // Exact separate approved Tor/Nym process incarnation, never all children or a bundle name.
        if routeProcessAuditTokens.contains(sourceProcess) { guard let endpoint, routeDestinations.contains(endpoint) else { return .dropOwned }; return .allowApprovedRouteTransport }
        guard connected, let endpoint, entries.contains(endpoint) else { return .dropOwned }
        return .allowRouteEntry
    }
}
