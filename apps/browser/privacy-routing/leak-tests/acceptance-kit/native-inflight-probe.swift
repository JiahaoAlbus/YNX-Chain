import Foundation

@main struct ProtectedAcceptanceInFlightProbe {
    static func main() throws {
        let hash = String(repeating: "a", count: 64)
        let binding = ["consumer": "BrowserRouteProtection", "mode": "tor", "runID": "inflight-probe",
                       "epoch": "10000000-0000-0000-0000-000000000001",
                       "providerGeneration": "10000000-0000-0000-0000-000000000002",
                       "rootAuditTokenSHA256": hash, "executableSHA256": hash, "rootPID": "500",
                       "manifestSHA256": hash, "bootstrapSHA256": hash]
        let id = "10000000-0000-0000-0000-000000000003"
        let other = "10000000-0000-0000-0000-000000000004"
        func row(_ kind: String, _ at: UInt64, _ fields: [String: String] = [:]) -> [String: String] {
            binding.merging(["schema": "P05_PROTECTED_ACCEPTANCE_EVENT_V1", "kind": kind, "atMonotonicNanoseconds": String(at)]) { _, next in next }
                .merging(fields) { _, next in next }
        }
        func frame(_ sequence: Int, _ at: UInt64, _ fields: [String: String] = [:]) -> [String: String] {
            row("instrument", at, ["messageKind": "wss", "phase": "baseline", "probeID": "baseline-long-wss",
                                   "frameSequence": String(sequence), "status": "body-match", "sha256": hash]
                .merging(fields) { _, next in next })
        }
        let start = row("instrument", 11, ["messageKind": "phase-started", "phase": "baseline"])
        let accept = row("download-accepted", 14, ["downloadID": id, "committed": "false"])
        let destination = row("download-destination", 15, ["downloadID": id, "committed": "false", "generation": "0"])
        let progress = row("download-progress", 16, ["downloadID": id, "committed": "false", "bytes": "16384"])
        let frames = [frame(2, 12), frame(1, 13)]
        let valid = [start] + frames + [accept, destination, progress]
        let cases: [(String, [[String: String]], Set<String>, Bool)] = [
            ("out-of-order completions for two distinct matching frames", valid, [id], true),
            ("WSS already closed", valid + [frame(2, 17, ["status": "closed"])], [id], false),
            ("WSS mismatched payload", [start, frame(1, 12), frame(2, 13, ["status": "body-mismatch"]), accept, destination, progress], [id], false),
            ("duplicate frame number", [start, frame(2, 12), frame(2, 13), accept, destination, progress], [id], false),
            ("foreign epoch", [start, frame(1, 12), frame(2, 13, ["epoch": other]), accept, destination, progress], [id], false),
            ("frames before live phase", [start, frame(1, 8), frame(2, 9), accept, destination, progress], [id], false),
            ("no phase start", frames + [accept, destination, progress], [id], false),
            ("wrong consumer schema", [start, frame(1, 12), frame(2, 13, ["schema": "P05_PROTECTED_DISPATCH_EVENT_V1"]), accept, destination, progress], [id], false),
            ("no resolved destination", [start] + frames + [accept, progress], [id], false),
            ("progress before destination", [start] + frames + [accept, progress, destination], [id], false),
            ("different download destination", [start] + frames + [accept, row("download-destination", 15, ["downloadID": other, "committed": "false", "generation": "0"]), progress], [id], false),
            ("progress already committed", [start] + frames + [accept, destination, row("download-progress", 16, ["downloadID": id, "committed": "true", "bytes": "16384"])], [id], false),
            ("owner no longer holds transfer", valid, [], false),
            ("window blocked", valid + [row("blocked", 17)], [id], false),
            ("terminal download failure", valid + [row("download-failed", 17, ["downloadID": id, "committed": "false"])], [id], false),
        ]
        let results = cases.map { name, rows, active, expected in
            ["case": name, "observed": ProtectedAcceptanceInFlightEvidence.confirms(rows[...], binding: binding, baselineAt: 10, activeDownloadIDs: active),
             "expected": expected] as [String: Any]
        }
        let failures = results.filter { ($0["observed"] as? Bool) != ($0["expected"] as? Bool) }.count
        let output: [String: Any] = ["schema": "P05_SWIFT_INFLIGHT_EVIDENCE_DELTA_V1", "cases": results, "failures": failures,
                                     "actualWebKitRoute": "NOT_RUN", "productionRouteAdmission": false]
        print(String(decoding: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), as: UTF8.self))
        if failures != 0 { exit(1) }
    }
}
