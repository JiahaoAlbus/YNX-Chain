import Darwin
import Foundation

// This shell supplies only DATA status replies and schedules real traffic to
// this process's own listeners. It never opens XPC, qualifies a route or runs NE.
@MainActor final class CanaryStatusFixture {
    var beforeReturning: () async throws -> Void = {}
    func status(_ request: SyntheticCanaryRequest) async throws -> SyntheticCanaryReply {
        await Task.yield()
        try await beforeReturning()
        return SyntheticCanaryReply(
            schema: "P05_SYNTHETIC_CANARY_OBSERVED_V1", nonce: request.nonce, stage: request.stage,
            binding: request.binding, providerSHA256: String(repeating: "b", count: 64),
            drops: request.targets.map { target in
                SyntheticCanaryDrop(targetID: target.id, flowID: UUID().uuidString,
                    sourceAppSHA256: request.binding.rootAuditTokenSHA256,
                    sourceProcessSHA256: request.binding.rootAuditTokenSHA256, sourceKind: request.stage, verdict: "drop")
            }, routePort: nil, routeSequence: nil, routeConnected: false)
    }
}

@main @MainActor struct SyntheticCanaryLateIngressProbe {
    static func main() async throws {
        let cases: [(String, String?, Bool, String)] = [
            ("clean DATA status with no local ingress", nil, false, "local-observation-complete"),
            ("actual IPv4 datagram while awaiting status", "127.0.0.1", false, "canaryObservedLeak"),
            ("actual IPv6 datagram while awaiting status", "::1", false, "canaryObservedLeak"),
            ("status after verification deadline", nil, true, "canaryTimeout"),
        ]
        var observations: [[String: String]] = []
        for (name, host, late, expected) in cases {
            let canary = try CanaryObservationFixture()
            defer { canary.close() }
            canary.schedule(host: host, afterDeadline: late)
            let outcome: String
            do {
                try await canary.check()
                outcome = "local-observation-complete"
            } catch let failure as SyntheticTrialFailure { outcome = failure.rawValue }
            observations.append(["case": name, "expected": expected, "observed": outcome])
        }
        let failures = observations.filter { $0["observed"] != $0["expected"] }.count
        let output: [String: Any] = ["schema": "P05_SYNTHETIC_CANARY_AWAIT_BOUNDARY_V1", "checks": observations,
                                    "failures": failures, "actualNE": "NOT_RUN", "signedXPC": "NOT_RUN",
                                    "productionRouteAdmission": false]
        print(String(decoding: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), as: UTF8.self))
        if failures != 0 { exit(1) }
    }
}
