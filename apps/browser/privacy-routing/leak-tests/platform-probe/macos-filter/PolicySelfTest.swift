import Foundation
import Darwin
import CryptoKit

@main enum PolicySelfTest {
    static func main() throws {
        // Real, unprivileged public API checks against THIS test process only.
        let ownIdentifier = URL(fileURLWithPath: CommandLine.arguments[0]).lastPathComponent
        let actual = try PublicIdentity.pinSelf(requirement: "identifier \"\(ownIdentifier)\"")
        _ = try actual.verifyLive()
        let wrongVersion = ProcessPin(auditTokenHex: actual.auditTokenHex, pid: actual.pid, pidVersion: actual.pidVersion + 1, path: actual.path, sha256: actual.sha256, requirement: actual.requirement)
        precondition((try? wrongVersion.verifyLive()) == nil)
        let wrongHash = ProcessPin(auditTokenHex: actual.auditTokenHex, pid: actual.pid, pidVersion: actual.pidVersion, path: actual.path, sha256: String(repeating: "0", count: 64), requirement: actual.requirement)
        precondition((try? wrongHash.verifyLive()) == nil)
        precondition((try? PublicIdentity.inspect(token: actual.token, requirement: "identifier \"not-this-test-process\"")) == nil)
        var changedToken = actual.token; changedToken[31] ^= 0x80
        precondition((try? PublicIdentity.inspect(token: changedToken, requirement: actual.requirement)) == nil)
        let descriptor = socket(AF_INET, SOCK_STREAM, 0); precondition(descriptor >= 0); defer { close(descriptor) }
        var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET); address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }; precondition(bound == 0 && listen(descriptor, 1) == 0)
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        precondition(withUnsafeMutablePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(descriptor, $0, &length) } } == 0)
        let ownEntry = FilterEndpoint(host: "127.0.0.1", port: UInt16(bigEndian: address.sin_port), transport: 6)
        precondition(PublicIdentity.ownsListener(actual, endpoint: ownEntry))
        precondition(!PublicIdentity.ownsListener(actual, endpoint: .init(host: "::1", port: ownEntry.port, transport: 6)))

        // Reducer-only fixtures. These tokens are NEVER passed to a provider, used for live process
        // attribution or advertised as installed NE enforcement. Real cohort tuples follow below.
        let root = Data(repeating: 1, count: 32), wk = Data(repeating: 2, count: 32), backend = Data(repeating: 3, count: 32), other = Data(repeating: 4, count: 32)
        func pin(_ token: Data, _ pid: Int32) -> ProcessPin { .init(auditTokenHex: token.hex, pid: pid, pidVersion: 1, path: "/fixture/\(pid)", sha256: String(repeating: "a", count: 64), requirement: "identifier \"fixture\"") }
        let entry = FilterEndpoint(host: "127.0.0.1", port: 19050, transport: 6), peer = FilterEndpoint(host: "192.0.2.23", port: 443, transport: 6), mix = FilterEndpoint(host: "2001:db8::23", port: 1789, transport: 17)
        let backendPin = BackendPin(role: "reviewed-route", process: pin(backend, 103), responsibleAppTokens: [root.hex, backend.hex], destinations: [peer, mix])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "filter-policy-test", epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120, browser: pin(root, 101), entryOwner: backendPin.process, entries: [entry], backends: [backendPin]); try review.validate()
        var rules = ScopedRunRules(review: review)
        let live: (ProcessPin) -> Bool = { _ in true }, webKit: (Data) -> Bool = { $0 == wk }
        func verdict(_ rules: ScopedRunRules, app: Data?, process: Data?, endpoint: FilterEndpoint?) -> ScopedRunRules.Verdict { rules.decision(sourceApp: app, sourceProcess: process, endpoint: endpoint, live: live, webKit: webKit) }
        precondition(verdict(rules, app: root, process: wk, endpoint: entry) == .ownedDrop)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString, live: live, listener: { _, _ in true })
        precondition(verdict(rules, app: root, process: wk, endpoint: entry) == .browserProxyAllow)
        precondition(verdict(rules, app: root, process: root, endpoint: entry) == .browserProxyAllow)
        precondition(verdict(rules, app: root, process: nil, endpoint: entry) == .ownedDrop)
        precondition(verdict(rules, app: root, process: other, endpoint: entry) == .ownedDrop)
        precondition(verdict(rules, app: root, process: wk, endpoint: .init(host: entry.host, port: entry.port, transport: 17)) == .ownedDrop)
        precondition(verdict(rules, app: root, process: wk, endpoint: .init(host: "::1", port: 13478, transport: 17)) == .ownedDrop)
        precondition(verdict(rules, app: root, process: wk, endpoint: peer) == .ownedDrop)
        precondition(verdict(rules, app: root, process: backend, endpoint: peer) == .backendExactEndpointAllow)
        precondition(verdict(rules, app: backend, process: backend, endpoint: mix) == .backendExactEndpointAllow)
        precondition(verdict(rules, app: other, process: backend, endpoint: peer) == .ownedDrop)
        precondition(verdict(rules, app: root, process: backend, endpoint: .init(host: peer.host, port: 444, transport: 6)) == .ownedDrop)
        precondition(verdict(rules, app: root, process: backend, endpoint: .init(host: peer.host, port: 443, transport: 17)) == .ownedDrop)
        precondition(rules.decision(sourceApp: root, sourceProcess: backend, endpoint: .init(host: "127.0.0.1", port: 30000, transport: 6), localEndpoint: entry, direction: .inbound, live: live, webKit: webKit) == .backendEntryAcceptAllow)
        var unownedResolverCalled = false
        precondition(rules.decision(sourceApp: other, sourceProcess: other, endpoint: nil, live: { _ in unownedResolverCalled = true; return false }, webKit: { _ in unownedResolverCalled = true; return false }) == .unownedAllow && !unownedResolverCalled)
        // A Standard LS instance can share product identity or an Apple XPC executable with the
        // routed instance; only the exact responsible-app audit token enrolls it.
        precondition(rules.decision(sourceApp: other, sourceProcess: wk, endpoint: peer, live: { _ in unownedResolverCalled = true; return false }, webKit: { _ in unownedResolverCalled = true; return false }) == .unownedAllow && !unownedResolverCalled)
        precondition(rules.decision(sourceApp: root, sourceProcess: wk, endpoint: entry, now: review.expiresAt + 1, live: live, webKit: webKit) == .ownedDrop)
        try rules.disconnected(sequence: 2)
        precondition(verdict(rules, app: root, process: wk, endpoint: entry) == .ownedDrop)
        precondition(verdict(rules, app: root, process: backend, endpoint: peer) == .backendExactEndpointAllow) // Backend can reconnect only to its explicit transport peers.
        do { try rules.setConnected(sequence: 3, userActionReference: UUID().uuidString, live: { $0 != review.entryOwner }, listener: { _, _ in true }); preconditionFailure("Dead route owner must not reconnect") } catch {}
        precondition(!rules.connected)
        try rules.setConnected(sequence: 3, userActionReference: UUID().uuidString, live: live, listener: { _, _ in true })
        do { try rules.disconnected(sequence: 2); preconditionFailure("Old generation accepted") } catch {}
        rules.block(); precondition(!rules.connected)

        var cohort: [String: Any] = [:]
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--cohort" {
            let bytes = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])), value = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            let scenario = value["localRouted"] as! [String: Any], records = scenario["realStunReceipts"] as! [[String: Any]]
            let capture = scenario["administratorCaptureReview"] as! [String: Any]
            let planBytes = try Data(contentsOf: URL(fileURLWithPath: capture["directory"] as! String).appendingPathComponent("capture-plan.json"))
            precondition(digest(planBytes) == capture["planSHA256"] as! String)
            let listeners = (try JSONSerialization.jsonObject(with: planBytes) as! [String: Any])["listeners"] as! [[String: Any]]
            var baselineRules = ScopedRunRules(review: review)
            try baselineRules.setConnected(sequence: 1, userActionReference: UUID().uuidString, live: live, listener: { _, _ in true })
            var dropped = 0
            for record in records {
                let family = record["addressFamily"] as! String
                let host = family == "ipv6" ? "::1" : "127.0.0.1"
                let listener = listeners.first { $0["host"] as? String == host && $0["transport"] as? String == "udp" }!
                let endpoint = FilterEndpoint(host: host, port: UInt16(listener["port"] as! Int), transport: 17)
                let phaseRules = (record["at"] as! Double) <= (scenario["faultAt"] as! Double) ? baselineRules : rules
                if verdict(phaseRules, app: root, process: wk, endpoint: endpoint) == .ownedDrop { dropped += 1 }
            }
            precondition(!records.isEmpty && dropped == records.count)
            cohort = ["receiptSHA256": digest(bytes), "capturePlanSHA256": digest(planBytes), "recordedStunUDPCount": records.count, "reducerWouldDrop": dropped, "realRecordedTupleAndPhase": true, "fixtureAuditTokensOnly": true, "originalLiveVerdict": value["targetVerdict"] ?? "UNKNOWN", "actualNewSystemExtensionEnforcement": "NOT_RUN"]
        }
        let output: [String: Any] = ["schema": "P05_FILTER_POLICY_SELFTEST_V1", "realOwnProcessAuditTokenSecCodePathHash": "PASS", "realOwnLoopbackListenerOwnership": "PASS", "reducerRegression": "PASS", "cohortTupleReplay": cohort, "networkExtensionInstalled": false, "networkExtensionAcceptance": "NOT_RUN", "productionRouteAdmission": false]
        print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), encoding: .utf8)!)
    }
    private static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}
