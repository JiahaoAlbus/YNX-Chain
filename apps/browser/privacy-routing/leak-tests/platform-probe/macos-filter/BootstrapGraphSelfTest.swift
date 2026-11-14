import Foundation

@main enum BootstrapGraphSelfTest {
    static func main() throws {
        var checks: [String] = []
        func check(_ label: String, _ value: Bool) { precondition(value, label); checks.append(label) }
        func pin(_ byte: UInt8) -> ProcessPin { .init(auditTokenHex: Data(repeating: byte, count: 32).hex, pid: Int32(byte) + 100, pidVersion: 1, path: "/fixture-only/\(byte)", sha256: String(repeating: "a", count: 64), requirement: "identifier \"fixture-only\"") }
        let root = pin(1), arti = pin(2), pt = pin(3), other = pin(4)
        let socks = FilterEndpoint(host: "127.0.0.1", port: 19050, transport: 6)
        let ptEntry = FilterEndpoint(host: "127.0.0.1", port: 19051, transport: 6)
        let peer = FilterEndpoint(host: "192.0.2.1", port: 443, transport: 6)
        let another = FilterEndpoint(host: "2001:db8::1", port: 443, transport: 6)
        let old = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "graph-reducer-only", epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120, browser: root, entryOwner: arti, entries: [socks], backends: [.init(role: "arti", process: arti, responsibleAppTokens: [root.auditTokenHex], destinations: []), .init(role: "obfs4", process: pt, responsibleAppTokens: [root.auditTokenHex], destinations: [peer])])
        let initial = RoutedBackendReview(entryOwner: arti, entries: [socks], backends: old.backends)
        let proposed = RoutedBackendReview(entryOwner: arti, entries: [socks], backends: [.init(role: "arti", process: arti, responsibleAppTokens: [root.auditTokenHex], destinations: [ptEntry]), .init(role: "obfs4", process: pt, responsibleAppTokens: [root.auditTokenHex], destinations: [peer], listeningEntries: [ptEntry])])
        let live: (ProcessPin) -> Bool = { [root, arti, pt].contains($0) }
        let listening: (ProcessPin, FilterEndpoint) -> Bool = { $0 == pt && $1 == ptEntry }
        func validate(_ value: RoutedBackendReview, connected: Bool = false, alive: ((ProcessPin) -> Bool)? = nil, listener: ((ProcessPin, FilterEndpoint) -> Bool)? = nil) throws -> ReviewedFilterRun { try BootstrapGraphPolicy.validate(current: old, proposed: value, connected: connected, live: alive ?? live, listener: listener ?? listening) }
        _ = try validate(initial, listener: { _, _ in false }); checks.append("initial-suspended-empty-loopback-graph")
        let next = try validate(proposed); checks.append("same-pins-actual-pt-loopback-update")
        check("root-and-run-scope-preserved", next.browser == old.browser && next.epoch == old.epoch && next.runID == old.runID && next.expiresAt == old.expiresAt)
        func reject(_ label: String, _ operation: () throws -> Void) { do { try operation(); preconditionFailure(label) } catch { checks.append(label) } }
        reject("connected-update-denied") { _ = try validate(proposed, connected: true) }
        reject("dead-backend-denied") { _ = try validate(proposed, alive: { $0 != pt }) }
        reject("claimed-listener-without-owner-denied") { _ = try validate(proposed, listener: { _, _ in false }) }
        var altered = proposed.backends
        altered[0] = .init(role: "arti", process: arti, responsibleAppTokens: [root.auditTokenHex], destinations: [another])
        reject("new-remote-peer-denied") { _ = try validate(.init(entryOwner: arti, entries: [socks], backends: altered)) }
        altered = proposed.backends; altered[0] = .init(role: "nym", process: arti, responsibleAppTokens: [root.auditTokenHex], destinations: [ptEntry])
        reject("role-change-denied") { _ = try validate(.init(entryOwner: arti, entries: [socks], backends: altered)) }
        altered = proposed.backends; altered[0] = .init(role: "arti", process: other, responsibleAppTokens: [root.auditTokenHex], destinations: [ptEntry])
        reject("replacement-token-denied") { _ = try validate(.init(entryOwner: arti, entries: [socks], backends: altered)) }
        altered = proposed.backends; altered[1] = .init(role: "obfs4", process: pt, responsibleAppTokens: [other.auditTokenHex], destinations: [peer], listeningEntries: [ptEntry])
        reject("responsible-app-change-denied") { _ = try validate(.init(entryOwner: arti, entries: [socks], backends: altered)) }
        altered = proposed.backends; altered[0] = .init(role: "arti", process: arti, responsibleAppTokens: [root.auditTokenHex], destinations: [.init(host: ptEntry.host, port: ptEntry.port, transport: 17)])
        reject("udp-loopback-edge-denied") { _ = try validate(.init(entryOwner: arti, entries: [socks], backends: altered)) }
        var rules = ScopedRunRules(review: next, mode: .tor)
        check("blocked-browser-stays-denied", rules.decision(sourceApp: root.token, sourceProcess: root.token, endpoint: socks, live: live, webKit: { _ in false }) == .ownedDrop)
        check("blocked-pt-outbound-exact-peer", rules.decision(sourceApp: root.token, sourceProcess: pt.token, endpoint: peer, live: live, webKit: { _ in false }) == .backendExactEndpointAllow)
        check("blocked-registered-pt-inbound-loopback", rules.decision(sourceApp: root.token, sourceProcess: pt.token, endpoint: .init(host: "127.0.0.1", port: 30000, transport: 6), localEndpoint: ptEntry, direction: .inbound, live: live, webKit: { _ in false }) == .backendListenerAllow)
        check("blocked-pt-inbound-external-denied", rules.decision(sourceApp: root.token, sourceProcess: pt.token, endpoint: peer, localEndpoint: ptEntry, direction: .inbound, live: live, webKit: { _ in false }) == .ownedDrop)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString, live: live, listenerGeneration: { $0 == arti && $1 == socks ? 1 : nil })
        reject("connected-reducer-replacement-denied") { try rules.replaceBlockedGraph(old) }
        print(String(data: try JSONSerialization.data(withJSONObject: ["schema": "P05_BLOCKED_BOOTSTRAP_GRAPH_REDUCER_V1", "checks": checks, "fixtureIdentitiesOnly": true, "actualNEEnforcement": "NOT_RUN", "productionRouteAdmission": false], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
