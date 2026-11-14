import Foundation
import CryptoKit
import YNXBrowserCore

/// New production-consumer input deltas only. Synthetic receipts, never real Nym identities.
@MainActor enum NymProductionLifecycleChecks {
    static func run() throws -> Int {
        var checks = 0
        func rejected(_ action: () throws -> Void) {
            do { try action(); fatalError("Invalid lifecycle input accepted") }
            catch { checks += 1 }
        }
        let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["YNX_NYM_TEST_OUTPUT"]!)
            .appendingPathComponent("production-receipt-" + UUID().uuidString.lowercased(), isDirectory: true)
        try NymModeProfileReceipt.ensurePrivateDirectory(root)
        defer { try? FileManager.default.removeItem(at: root) }
        let plan = try NymModeProfileReceipt.planned(in: root)
        let path = root.appendingPathComponent("profile-planned.json")
        let original = try Data(contentsOf: path)
        let config = root.appendingPathComponent("synthetic-config")
        try NymModeProfileReceipt.writeNew(Data("synthetic non-key config".utf8), to: config)
        let exit = BackendProcessExit(pid: 123, code: 0, signal: nil, childReaped: true)
        let otherID = "ynx-route-bundled-" + UUID().uuidString.lowercased()
        let originalObject = try JSONSerialization.jsonObject(with: original) as! [String: Any]
        for changed in [["profileID": otherID], ["schema": "unrecognized"], ["operation": UUID().uuidString.lowercased()], ["futureAuthority": "not accepted"]] {
            var object = originalObject
            changed.forEach { object[$0.key] = $0.value }
            let changedBytes = try JSONSerialization.data(withJSONObject: object)
            try changedBytes.write(to: path)
            rejected { _ = try NymModeProfileReceipt.publishCompletion(in: root, plan: plan, config: config, exit: exit) }
            precondition(!FileManager.default.fileExists(atPath: root.appendingPathComponent("profile-complete.json").path)); checks += 1
            let unchanged = try Data(contentsOf: path)
            precondition(unchanged == changedBytes); checks += 1
            try original.write(to: path)
        }
        let completed = try NymModeProfileReceipt.publishCompletion(in: root, plan: plan, config: config, exit: exit)
        precondition(completed.id == plan.profileID); checks += 1
        let foreign = NymModeProfileReceipt.Plan(schema: plan.schema, profileID: otherID, operation: plan.operation)
        rejected { _ = try NymModeProfileReceipt.completed(in: root, plan: foreign) }
        let completePath = root.appendingPathComponent("profile-complete.json")
        let completeBytes = try Data(contentsOf: completePath)
        var completeObject = try JSONSerialization.jsonObject(with: completeBytes) as! [String: Any]
        completeObject["externalAdmission"] = true
        try JSONSerialization.data(withJSONObject: completeObject).write(to: completePath)
        rejected { _ = try NymModeProfileReceipt.completed(in: root, plan: plan) }
        try completeBytes.write(to: completePath)
        let restored = try NymModeProfileReceipt.completed(in: root, plan: plan)
        precondition(restored?.id == plan.profileID); checks += 1

        let identity = String(repeating: "1", count: 32)
        let valid: [String: Any] = ["identity": [Int](repeating: 0, count: 32), "active": true, "typ": "remote",
                                    "endpoint": "wss://gateway.example.com:9001/", "fallback_endpoint": NSNull()]
        func decode(_ row: [String: Any]) throws -> NymModeGatewayState {
            try NymModeGatewayState.decode(JSONSerialization.data(withJSONObject: [row]), expectedIdentity: identity)
        }
        let observed = try decode(valid)
        try observed.validateEndpoint(host: "gateway.example.com", port: 9001); precondition(observed.active); checks += 1
        for invalid in [42, false, [String: String](), [Int]()] as [Any] {
            var row = valid; row["fallback_endpoint"] = invalid
            rejected { _ = try decode(row) }
        }
        var missing = valid; missing.removeValue(forKey: "fallback_endpoint")
        rejected { _ = try decode(missing) }
        for invalid in [0, 1, "true"] as [Any] {
            var row = valid; row["active"] = invalid
            rejected { _ = try decode(row) }
        }
        for invalid in [true, -1, 256, 0.5, "0"] as [Any] {
            var row = valid; var values = [Any](repeating: 0, count: 32); values[0] = invalid; row["identity"] = values
            rejected { _ = try decode(row) }
        }
        var fallback = valid; fallback["fallback_endpoint"] = "ws://gateway.example.com:9000/"
        let withFallback = try decode(fallback)
        rejected { try withFallback.validateEndpoint(host: "gateway.example.com", port: 9001) }
        // Real complete line bytes, not a digest of a locally reconstructed expected message.
        let rawLine = Data("\u{001B}[32m2030-01-01T00:00:00Z INFO common/socks5-client-core/src/lib.rs:261: Client startup finished!\u{001B}[0m".utf8)
        let lineHash = SHA256.hash(data: rawLine).map { String(format: "%02x", $0) }.joined()
        let gatewayLine = Data(("The address of this client is: synthetic.sender@" + identity + "\n").utf8)
        let marker = NymObservedStartupLine(expectedGatewayIdentity: identity)
        marker.append(rawLine + Data([13,10])); precondition(marker.observedLineSHA256 == nil); checks += 1
        marker.append(gatewayLine); precondition(marker.observedLineSHA256 == lineHash); checks += 1
        let split = NymObservedStartupLine(expectedGatewayIdentity: identity)
        split.append(gatewayLine); split.append(rawLine.prefix(17)); split.append(rawLine.dropFirst(17))
        precondition(split.observedLineSHA256 == nil); checks += 1
        split.append(Data([10])); precondition(split.observedLineSHA256 == lineHash); checks += 1
        let wrong = NymObservedStartupLine(expectedGatewayIdentity: identity)
        wrong.append(Data("The address of this client is: synthetic.sender@other\n".utf8) + rawLine + Data([10]))
        precondition(wrong.observedLineSHA256 == nil); checks += 1
        let long = NymObservedStartupLine(expectedGatewayIdentity: identity)
        long.append(gatewayLine); long.append(Data(repeating: 120, count: 5000) + rawLine + Data([10]))
        precondition(long.observedLineSHA256 == nil); checks += 1
        long.append(rawLine + Data([10])); precondition(long.observedLineSHA256 == lineHash); checks += 1
        let changed = NymObservedStartupLine(expectedGatewayIdentity: identity)
        let otherLine = Data("different-prefix Client startup finished!".utf8)
        changed.append(gatewayLine + otherLine + Data([10]))
        let otherHash = SHA256.hash(data: otherLine).map { String(format: "%02x", $0) }.joined()
        precondition(changed.observedLineSHA256 == otherHash && otherHash != lineHash); checks += 1
        print("production-lifecycle-delta checks=\(checks) real_profile=NOT_READ vendor=NOT_RUN network=NOT_RUN")
        return checks
    }
}
