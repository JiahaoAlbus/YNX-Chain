#if YNX_PRIVACY_ACCEPTANCE
import Foundation

/// Reducer-only negative/attribution checks. These values are not actual OS callbacks or authority.
@main struct SyntheticCanarySelfTest {
    static func main() throws {
        let root = Data(repeating: 1, count: 32), wk = Data(repeating: 2, count: 32), other = Data(repeating: 3, count: 32)
        let binding = SyntheticTrialBinding(mode: .tor, runID: "synthetic-fixture", epoch: UUID().uuidString, profileID: "synthetic-synthetic-fixture", profileSHA256: String(repeating: "a", count: 64), providerGeneration: UUID().uuidString, rootAuditTokenSHA256: ProtectionLease.hash(root), manifestSHA256: String(repeating: "b", count: 64), bootstrapSHA256: String(repeating: "c", count: 64), executableSHA256: String(repeating: "d", count: 64))
        let targets = ["127.0.0.1", "::1"].flatMap { host in [Int32(6),17].map { SyntheticCanaryTarget(id: UUID().uuidString, host: host, port: 25432, transport: $0) } }
        func request(_ stage: String) -> SyntheticCanaryRequest { .init(schema: "P05_SYNTHETIC_CANARY_ARM_V1", nonce: UUID().uuidString, stage: stage, binding: binding, targets: targets) }
        var observed = try SyntheticCanaryObservation(request: request("self"), session: UUID(), now: 100)
        func drop(_ item: inout SyntheticCanaryObservation, app: Data, process: Data, trusted: Bool, host: String = "127.0.0.1", port: UInt16 = 25432, protocol_: Int32 = 6, now: UInt64 = 101) -> Bool {
            item.observedDrop(host: host, port: port, transport: protocol_, flowID: UUID(), sourceApp: app, sourceProcess: process, trustedWebKit: { _ in trusted }, now: now)
        }
        precondition(!drop(&observed, app: other, process: root, trusted: false))
        precondition(!drop(&observed, app: root, process: wk, trusted: true))
        precondition(!drop(&observed, app: root, process: root, trusted: false, host: "192.0.2.1"))
        precondition(!drop(&observed, app: root, process: root, trusted: false, port: 25433))
        precondition(!drop(&observed, app: root, process: root, trusted: false, protocol_: 1))
        precondition(!drop(&observed, app: root, process: root, trusted: false, now: 15_000_000_100))
        precondition(observed.drops.isEmpty)
        precondition(drop(&observed, app: root, process: root, trusted: false))
        precondition(drop(&observed, app: root, process: root, trusted: false))
        precondition(observed.drops.count == 1) // Duplicate callback cannot manufacture another target.
        var webkit = try SyntheticCanaryObservation(request: request("webkit"), session: UUID(), now: 100)
        precondition(!drop(&webkit, app: root, process: root, trusted: true))
        precondition(!drop(&webkit, app: root, process: wk, trusted: false))
        precondition(drop(&webkit, app: root, process: wk, trusted: true))
        precondition(webkit.drops.values.allSatisfy { $0.sourceKind == "webkit" && $0.sourceProcessSHA256 == ProtectionLease.hash(wk) })
        precondition(webkit.drops.values.count == 1) // No RTC flow is never synthesized as UDP drop.
        var malformed = request("self")
        malformed = .init(schema: malformed.schema, nonce: malformed.nonce, stage: malformed.stage, binding: binding, targets: [targets[0],targets[0],targets[2],targets[3]])
        do { _ = try SyntheticCanaryObservation(request: malformed, session: UUID(), now: 100); preconditionFailure("Duplicate target accepted") } catch SyntheticTrialFailure.invalidScope { }
        let result: [String: Any] = ["schema":"P05_SYNTHETIC_CANARY_POLICY_DELTA_V1", "checks":12, "status":"PASS", "scope":"pure callback reducer; not actual OS/network qualification", "actualNECanary":"NOT_RUN", "productionRouteAdmission":false]
        print(String(decoding:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),as:UTF8.self))
    }
}
#endif
