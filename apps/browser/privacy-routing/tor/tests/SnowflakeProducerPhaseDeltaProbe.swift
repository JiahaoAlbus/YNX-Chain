#if YNX_PRIVACY_ACCEPTANCE
import Foundation
@main struct SnowflakeProducerPhaseDeltaProbe {
    static func expect(_ value: Bool, _ label: String) throws {
        if !value { throw NSError(domain: "P05PhaseProducerDelta", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
    }
    static func main() throws {
        guard (2...3).contains(CommandLine.arguments.count) else { throw NSError(domain: "P05PhaseProducerDelta", code: 64) }
        let bytes = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        try expect(bytes.count <= 65_536, "bounded real Go canonical capture")
        var expected = ["backendPhaseSinkInstalled", "brokerHTTPAttempt", "brokerHTTPResponse", "brokerHTTPAttempt", "brokerTLSRejected"]
        if CommandLine.arguments.count == 3 { try expect(CommandLine.arguments[2] == "--process-control", "exact process-control selector"); expected.append("entryOwnerClosed") }
        var checks = 0
        for chunk in [1, 3, 17, 4096] {
            var recorder = SnowflakeSafePhaseRecorder(began: 0)
            var events: [[String: Any]] = []
            var cursor = 0
            while cursor < bytes.count {
                let end = min(bytes.count, cursor + chunk)
                events += recorder.consume(bytes.subdata(in: cursor..<end), at: 1)
                cursor = end
            }
            try expect(events.compactMap { $0["phase"] as? String } == expected, "real Go logger→sink→actual Swift classifier")
            try expect(events[2]["statusCode"] as? Int == 403, "typed HTTP status")
            checks += 1
        }
        var limited = SnowflakeSafePhaseRecorder(began: 0)
        let cap = limited.consume(Data("YNX_PUBLIC_PHASE_V1 LIMIT_REACHED\nWebRTC: DataChannel.OnOpen\n".utf8), at: 1)
        try expect(cap.count == 1 && cap[0]["producerCoverageTruncated"] as? Bool == true && limited.summary["coverageTruncated"] as? Bool == true, "producer cap propagates UNKNOWN coverage")
        checks += 1
        for unsafe in ["YNX_PUBLIC_PHASE_V1 SINK_INSTALLED extra", "YNX_PUBLIC_PHASE_V1 ROOT_CURRENT_READY", "HTTP rendezvous transport failure: TLSRejected private=secret", "WebRTC: DataChannel.OnOpen\u{1b}[0m"] {
            try expect(SnowflakeSafePhaseRecorder.classify(Data(unsafe.utf8)) == nil, "unknown or dynamic marker rejected")
            checks += 1
        }
        let result: [String: Any] = ["status": "PASS", "newChecks": checks, "actualGoCaptureConsumed": true, "network": "NOT_RUN", "RootQualification": "NOT_SUPPLIED", "normalPrivacyAdmission": "UNCHANGED_BLOCKED"]
        print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
    }
}
#endif
