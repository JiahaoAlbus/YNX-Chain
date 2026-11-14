import Foundation
import YNXBrowserCore

/// Synthetic private journal data only. No gateway, profile keys, backend or authority exists.
@MainActor enum NymGatewayRecoveryDeltaChecks {
    static func run() throws -> Int {
        let output = URL(fileURLWithPath: ProcessInfo.processInfo.environment["YNX_NYM_TEST_OUTPUT"]!)
        let root = output.appendingPathComponent("gateway-recovery-" + UUID().uuidString.lowercased(), isDirectory: true)
        try NymModeProfileReceipt.ensurePrivateDirectory(root)
        var checks = 0
        let profile = "ynx-route-bundled-11111111-2222-3333-4444-555555555555"
        let gateway = String(repeating: "1", count: 32), host = "gateway.example.org"
        let exit = BackendProcessExit(pid: 4242, code: 0, signal: nil, childReaped: true)
        func reject(_ action: () throws -> Void) {
            do { try action(); fatalError("Unresolved gateway action was accepted") } catch { checks += 1 }
        }
        func journal(_ name: String) throws -> NymGatewayActionJournal {
            let path = root.appendingPathComponent(name, isDirectory: true)
            try NymModeProfileReceipt.ensurePrivateDirectory(path)
            return try .init(directory: path, profileID: profile, gatewayIdentity: gateway)
        }
        func readback(active: Bool = true, endpoint: String? = nil) throws -> (NymModeGatewayState, Data) {
            let row: [String: Any] = ["identity": [Int](repeating: 0, count: 32), "active": active, "typ": "remote",
                "endpoint": endpoint ?? "wss://gateway.example.org:9001/", "fallback_endpoint": NSNull()]
            let bytes = try JSONSerialization.data(withJSONObject: [row])
            return (try NymModeGatewayState.decode(bytes, expectedIdentity: gateway), bytes)
        }
        func reconcile(_ j: NymGatewayActionJournal, active: Bool = true) throws {
            let (state, bytes) = try readback(active: active)
            try j.reconcileActive(state, readback: bytes, exit: exit, host: host, port: 9001)
        }
        func files(_ j: NymGatewayActionJournal) throws -> [String: Data] {
            try Dictionary(uniqueKeysWithValues: FileManager.default.contentsOfDirectory(atPath: j.directory.path).map {
                ($0, try Data(contentsOf: j.directory.appendingPathComponent($0)))
            })
        }

        let first = try journal("completed-revisit"), action = UUID()
        try first.claim(operation: action)
        let original = try files(first)
        // This is the old callee's exact no-replay branch: one gateway intent exists forever.
        // Without a completed record, it cannot tell a successful action from an unknown one.
        precondition(original.count == 1); checks += 1
        reject { try first.requireResolved() }
        try first.recordEffectExit(operation: action, exit: exit)
        let exitedBytes = try files(first)
        try first.recordEffectExit(operation: action, exit: exit)
        let repeatedExit = try files(first); precondition(repeatedExit == exitedBytes); checks += 1
        reject { try first.recordEffectExit(operation: action, exit: .init(pid: 4243, code: 0, signal: nil, childReaped: true)) }
        reject { try first.requireResolved() } // Process success alone is not official readback.
        try reconcile(first)
        try first.requireResolved(); checks += 1
        let completed = try files(first)
        for (name, bytes) in original { precondition(completed[name] == bytes) }; checks += 1
        try reconcile(first); let repeated = try files(first); precondition(repeated == completed); checks += 1
        reject { try first.claim(operation: action) } // Same user action must never replay.
        try first.claim(operation: UUID()); checks += 1 // New explicit action may revisit A.
        reject { try first.requireResolved() }
        for (name, bytes) in original { let saved = try Data(contentsOf: first.directory.appendingPathComponent(name)); precondition(saved == bytes) }; checks += 1

        let unknown = try journal("unresolved-original"), unknownAction = UUID()
        try unknown.claim(operation: unknownAction)
        let before = try files(unknown)
        try reconcile(unknown) // Even active readback cannot invent the missing old exit receipt.
        let preserved = try files(unknown); precondition(preserved == before); checks += 1
        reject { try unknown.requireResolved() }
        reject { try unknown.claim(operation: UUID()) }
        reject { try unknown.recordEffectExit(operation: unknownAction, exit: .init(pid: 4242, code: 0, signal: nil, childReaped: false)) }
        reject { try unknown.recordEffectExit(operation: unknownAction, exit: .init(pid: 4242, code: 1, signal: nil, childReaped: true)) }
        try unknown.recordEffectExit(operation: unknownAction, exit: exit)
        reject { try reconcile(unknown, active: false) }
        let (validState, bytes) = try readback()
        reject { try unknown.reconcileActive(validState, readback: Data("[]".utf8), exit: exit, host: host, port: 9001) }
        reject { try unknown.reconcileActive(validState, readback: bytes, exit: exit, host: "different.example.org", port: 9001) }
        try reconcile(unknown); try unknown.requireResolved(); checks += 1 // Resume reconciliation only, no mutation replay.

        let legacy = try journal("legacy-unknown")
        let legacyURL = legacy.directory.appendingPathComponent("gateway-" + legacy.gatewaySHA256 + "-unknown.json")
        try NymProvisioningIntent.claimBeforeResume(at: legacyURL, profileID: profile, operation: UUID())
        let oldBytes = try Data(contentsOf: legacyURL)
        try reconcile(legacy)
        let stillOld = try Data(contentsOf: legacyURL); precondition(stillOld == oldBytes); checks += 1
        reject { try legacy.requireResolved() } // No speculative legacy "done" migration.

        let corrupt = try journal("corrupt-receipt"), corruptAction = UUID()
        try corrupt.claim(operation: corruptAction); try corrupt.recordEffectExit(operation: corruptAction, exit: exit)
        try reconcile(corrupt)
        let reconciledPath = try FileManager.default.contentsOfDirectory(atPath: corrupt.directory.path).first { $0.hasSuffix("-reconciled.json") }!
        let target = corrupt.directory.appendingPathComponent(reconciledPath)
        var object = try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as! [String: Any]
        object["externalReady"] = true
        try JSONSerialization.data(withJSONObject: object).write(to: target)
        reject { try corrupt.requireResolved() }
        let foreign = try NymGatewayActionJournal(directory: unknown.directory,
            profileID: "ynx-route-bundled-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", gatewayIdentity: gateway)
        reject { try foreign.requireResolved() }
        return checks
    }
}
