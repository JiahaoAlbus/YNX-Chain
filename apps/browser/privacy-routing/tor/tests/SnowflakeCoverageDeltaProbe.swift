#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import Darwin
@main struct SnowflakeCoverageDeltaProbe {
    @MainActor static func main() async throws {
        guard CommandLine.arguments.count == 3 else { throw TorPlatformError.invalidPin }
        let out = URL(fileURLWithPath: CommandLine.arguments[1]), fixture = URL(fileURLWithPath: CommandLine.arguments[2])
        #if P05_LEGACY_COVERAGE_RED
        let pid = try await ArtiProcessAdapter().exerciseCoverageBoundary(fixture: fixture, session: out.appendingPathComponent("legacy-one-child"), producerLimit: false)
        print("{\"status\":\"EXPECTED_RED\",\"actualCounterexample\":\"phase_cap_suppressed_late_fatal\",\"originalChildPID\":\(pid),\"originalChildExitObserved\":true,\"network\":\"NOT_RUN\"}")
        exit(1)
        #else
        var ids: [Int32] = []
        for limited in [false, true] {
            ids.append(try await ArtiProcessAdapter().exerciseCoverageBoundary(fixture: fixture,
                session: out.appendingPathComponent(limited ? "producer-limit-child" : "event-budget-child"), producerLimit: limited))
        }
        // Earlier verified policy cause wins over later coverage exhaustion;
        // the first failure survives fence, and an old-generation late failure
        // cannot poison a new attempt. These are new mixed-cause boundaries.
        var latch = TorPublicBackendFatalLatch(); let old = UUID(), next = UUID(); latch.begin(old)
        let policy = SnowflakeSafePhaseRecorder.classify(Data("YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC".utf8))!
        _ = latch.observe(policy, generation: old)
        guard !latch.coverageIncomplete(reason: "EVENT_BUDGET", generation: old, observedAt: 1, processedAt: 2), latch.first?.kind == "policyRejected" else { throw TorPlatformError.invalidPin }
        latch.fence(); guard latch.first?.generation == old else { throw TorPlatformError.invalidPin }
        latch.begin(next)
        guard !latch.coverageIncomplete(reason: "EVENT_BUDGET", generation: old, observedAt: 1, processedAt: 2), latch.first == nil else { throw TorPlatformError.invalidPin }
        print("{\"status\":\"PASS\",\"newActualSDKCases\":2,\"actualOriginalChildPIDs\":\(ids),\"allOriginalChildExitsObserved\":true,\"policyCausePreserved\":true,\"coverageFailureIndependentOfEventEmission\":true,\"normalPrivacyAdmission\":\"UNCHANGED_BLOCKED\",\"network\":\"NOT_RUN\",\"GUI\":\"NOT_RUN\"}")
        #endif
    }
}
#endif
