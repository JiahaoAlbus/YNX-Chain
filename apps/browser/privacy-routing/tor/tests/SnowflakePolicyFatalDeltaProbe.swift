#if YNX_PRIVACY_ACCEPTANCE
import Foundation
@main struct SnowflakePolicyFatalDeltaProbe {
    static func require(_ condition: Bool, _ label: String) throws {
        if !condition { throw NSError(domain: "P05PolicyFatalDelta", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
    }
    @MainActor static func main() async throws {
        guard [3, 4].contains(CommandLine.arguments.count) else { throw TorPlatformError.invalidPin }
        let old = UUID(), current = UUID()
        var latch = TorPublicBackendFatalLatch(); latch.begin(current)
        func event(_ line: String) throws -> [String: Any] {
            guard let e = SnowflakeSafePhaseRecorder.classify(Data(line.utf8)) else { throw TorPlatformError.invalidPin }
            return e
        }
        var checks = 0
        for line in ["YNX_PUBLIC_PHASE_V1 OWNER_CLOSED", "WebRTC: Closing", "WebRTC: fixed QA entry attempt incomplete", "YNX_PUBLIC_PHASE_V1 CLEANUP_UNKNOWN"] {
            try require(!latch.observe(try event(line), generation: current), "ordinary/cleanup-unknown is not policy fatal"); checks += 1
        }
        let detail = try event("YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC")
        try require(!latch.observe(detail, generation: old), "old generation ignored"); checks += 1
        try require(latch.observe(detail, generation: current), "detail itself confirms current policy failure"); checks += 1
        _ = latch.observe(try event("YNX_PUBLIC_REJECTION_V1 NET_RESOLVE EXPIRED"), generation: current)
        try require(latch.first?.summary == "policyRejected:UDP_SEND_TARGET:NON_PUBLIC", "first cause sticky"); checks += 1
        latch.fence(); latch.begin(old)
        _ = latch.observe(try event("YNX_PUBLIC_PHASE_V1 POLICY_REJECTED"), generation: old)
        try require(latch.first?.summary == "policyRejected", "generic marker never borrows old detail"); checks += 1
        latch.begin(current); latch.fence()
        try require(!latch.observe(detail, generation: current) && latch.first == nil, "close fences late callback"); checks += 1
        for bad in ["YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC secret", "YNX_PUBLIC_REJECTION_V1 BAD_SITE NON_PUBLIC", "YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC\u{1b}[0m"] {
            try require(SnowflakeSafePhaseRecorder.classify(Data(bad.utf8)) == nil, "unverified dynamic event rejected"); checks += 1
        }
        var actualGoUnknown = false
        if CommandLine.arguments.count == 4 {
            let capture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
            try require(capture.count <= 65536, "bounded actual Go test capture")
            var recorder = SnowflakeSafePhaseRecorder(began: 0)
            let events = recorder.consume(capture, at: 1)
            try require(events.filter { $0["phase"] as? String == "entryCleanupUnknown" }.count == 1,
                "real same-failstop child emits exactly one parsed cleanup UNKNOWN marker")
            actualGoUnknown = true
        }
        let adapter = ArtiProcessAdapter()
        let pid = try await adapter.exercisePublicPolicyFatal(fixture: URL(fileURLWithPath: CommandLine.arguments[2]),
            session: URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("one-harmless-child"))
        print("{\"status\":\"PASS\",\"newValueChecks\":\(checks),\"actualOriginalChildPID\":\(pid),\"originalProcessExitObserved\":true,\"actualGoUnknownMarkerParsed\":\(actualGoUnknown),\"managedPTWaitpid\":false,\"network\":\"NOT_RUN\",\"normalPrivacyAdmission\":\"UNCHANGED_BLOCKED\"}")
    }
}
#endif
