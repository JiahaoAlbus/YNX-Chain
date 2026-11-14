import Foundation

@main enum FenceSelfTest {
    static func main() throws {
        let root = Data(repeating: 1, count: 32), xpc = Data(repeating: 2, count: 32), route = Data(repeating: 3, count: 32), differentIncarnation = Data(repeating: 4, count: 32)
        let entry = AuditFlowFence.Endpoint(host: "127.0.0.1", port: 19050, transport: 6)
        let routePeer = AuditFlowFence.Endpoint(host: "192.0.2.10", port: 443, transport: 6)
        var fence = try AuditFlowFence(appAuditToken: root, routeProcessAuditTokens: [route], entries: [entry], routeDestinations: [routePeer])
        precondition(fence.decide(sourceApp: root, sourceProcess: xpc, endpoint: entry) == .dropOwned)
        fence.setConnected(true)
        precondition(fence.decide(sourceApp: root, sourceProcess: xpc, endpoint: entry) == .allowRouteEntry)
        precondition(fence.decide(sourceApp: differentIncarnation, sourceProcess: xpc, endpoint: entry) == .unownedAllowWithoutReading)
        precondition(fence.decide(sourceApp: root, sourceProcess: nil, endpoint: entry) == .dropOwned)
        precondition(fence.decide(sourceApp: root, sourceProcess: xpc, endpoint: .init(host: "127.0.0.1", port: 19050, transport: 17)) == .dropOwned)
        precondition(fence.decide(sourceApp: root, sourceProcess: xpc, endpoint: .init(host: "::1", port: 19443, transport: 6)) == .dropOwned)
        precondition(fence.decide(sourceApp: root, sourceProcess: route, endpoint: nil) == .dropOwned)
        precondition(fence.decide(sourceApp: root, sourceProcess: route, endpoint: routePeer) == .allowApprovedRouteTransport)
        precondition(fence.decide(sourceApp: root, sourceProcess: route, endpoint: .init(host: "192.0.2.10", port: 443, transport: 17)) == .dropOwned)
        fence.setConnected(false)
        precondition(fence.decide(sourceApp: root, sourceProcess: xpc, endpoint: entry) == .dropOwned)
        print("{\"policySelfTest\":\"PASS\",\"evidenceClass\":\"fixture\",\"networkExtensionInstalled\":false,\"targetVerdict\":\"INCOMPLETE\"}")
    }
}
