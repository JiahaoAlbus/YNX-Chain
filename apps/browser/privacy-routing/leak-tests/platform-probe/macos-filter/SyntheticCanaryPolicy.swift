#if YNX_PRIVACY_ACCEPTANCE
import Foundation

/// Records only a real filter callback's exact owned target. It never changes an allow rule.
/// A missing flow (including Lockdown-disabled RTC) cannot enter this accumulator.
struct SyntheticCanaryObservation {
    let request: SyntheticCanaryRequest
    let session: UUID
    let armedAt: UInt64
    private(set) var drops: [String: SyntheticCanaryDrop] = [:]
    init(request: SyntheticCanaryRequest, session: UUID, now: UInt64) throws {
        guard request.schema == "P05_SYNTHETIC_CANARY_ARM_V1", UUID(uuidString: request.nonce) != nil,
              ["self", "webkit"].contains(request.stage), request.targets.count == 4,
              Set(request.targets.map(\.id)).count == 4,
              Set(request.targets.map { "\($0.host):\($0.transport)" }) == ["127.0.0.1:6", "127.0.0.1:17", "::1:6", "::1:17"],
              request.targets.allSatisfy({ UUID(uuidString: $0.id) != nil && $0.port >= 1024 }) else { throw SyntheticTrialFailure.invalidScope }
        self.request = request; self.session = session; armedAt = now
    }
    mutating func observedDrop(host: String, port: UInt16, transport: Int32, flowID: UUID,
                               sourceApp: Data, sourceProcess: Data, trustedWebKit: (Data) -> Bool, now: UInt64) -> Bool {
        guard now >= armedAt, now - armedAt < 15_000_000_000,
              ProtectionLease.hash(sourceApp) == request.binding.rootAuditTokenSHA256,
              sourceProcess.count == 32,
              let target = request.targets.first(where: { $0.host == host && $0.port == port && $0.transport == transport }) else { return false }
        let isSelf = sourceProcess == sourceApp
        guard request.stage == "self" ? isSelf : (!isSelf && trustedWebKit(sourceProcess)) else { return false }
        if drops[target.id] == nil {
            drops[target.id] = .init(targetID: target.id, flowID: flowID.uuidString,
                sourceAppSHA256: ProtectionLease.hash(sourceApp), sourceProcessSHA256: ProtectionLease.hash(sourceProcess),
                sourceKind: request.stage, verdict: "drop")
        }
        return true
    }
}
#endif
