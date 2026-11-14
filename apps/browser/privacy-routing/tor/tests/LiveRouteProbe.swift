import Foundation
import CryptoKit

/// Uses the actual Native adapter; keeps its original handle available for a bounded acceptance run.
@main enum LiveRouteProbe {
    @MainActor static func main() async {
        do { try await run() }
        catch { FileHandle.standardError.write(Data("TOR_ROUTE_NOT_VERIFIED: \(error)\n".utf8)); exit(1) }
    }
    @MainActor static func run() async throws {
        guard [6, 7].contains(CommandLine.arguments.count) else { throw TorPlatformError.invalidPin }
        let onion = CommandLine.arguments.count == 7 && CommandLine.arguments[6] == "onion"
        let binary = URL(fileURLWithPath: CommandLine.arguments[1])
        let transport = URL(fileURLWithPath: CommandLine.arguments[2])
        let published = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))) as? [String: Any]
        guard let lists = published?["bridges"] as? [String: Any], let lines = lists["obfs4"] as? [String] else { throw TorPlatformError.invalidPin }
        let profile = URL(fileURLWithPath: CommandLine.arguments[4], isDirectory: true)
        let output = URL(fileURLWithPath: CommandLine.arguments[5], isDirectory: true)
        guard !FileManager.default.fileExists(atPath: output.path) else { throw PrivacyRouteError.stale }
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let original = profile.appendingPathComponent("arti.toml")
        try FileManager.default.copyItem(at: original, to: output.appendingPathComponent("original-arti.toml"))
        let pin = ArtiProcessAdapter.BinaryPin(executable: binary, binarySHA256: "fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a", sourceArchiveSHA256: "a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813", version: "2.7.0")
        let bridge = ArtiProcessAdapter.BridgeConfiguration(lines: lines, transport: transport, transportSHA256: "7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d")
        let adapter = ArtiProcessAdapter()
        try adapter.start(pin: pin, port: 63778, sessionDirectory: profile, deferBootstrap: false, bridge: bridge)
        func write(_ value: [String: Any]) throws {
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .prettyPrinted])
            try data.write(to: output.appendingPathComponent("live-route.json"), options: .atomic)
        }
        guard let pid = adapter.processIdentifier else { throw PrivacyRouteError.blocked }
        var receipt: [String: Any] = ["pid": pid, "port": 63778, "mode": "Tor", "nativeAdapter": true, "bootstrapReady": false, "productionAdmission": false, "startedAt": Date().timeIntervalSince1970]
        try write(receipt); print("Tor native adapter PID \(pid)")
        defer { adapter.stop() }
        let start = ContinuousClock.now
        let deadline = start.advanced(by: .seconds(600))
        while ContinuousClock.now < deadline {
            let state = adapter.pollProcess()
            if state == .bootstrapReady { break }
            if case .exited = state { throw PrivacyRouteError.blocked }
            if state == .stopped || state == .stopping { throw PrivacyRouteError.blocked }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard adapter.pollProcess() == .bootstrapReady else { throw PrivacyRouteError.blocked }
        receipt["bootstrapReady"] = true; receipt["readyAt"] = Date().timeIntervalSince1970
        try write(receipt); print("READY actual native adapter; public HTTPS route probes follow")
        let search = onion ? "https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=YNX%20browser%20privacy" : "https://duckduckgo.com/?q=YNX%20browser%20privacy"
        for (name, target) in [(onion ? "ddg-onion" : "ddg", search), ("tor-ip", "https://check.torproject.org/api/ip")] {
            let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
            task.arguments = ["--silent", "--show-error", "--noproxy", "", "--proxy", "socks5h://127.0.0.1:63778", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "5", "--connect-timeout", "30", "--max-time", "120", "--output", output.appendingPathComponent(name + ".body").path, "--dump-header", output.appendingPathComponent(name + ".headers").path, "--write-out", "%{json}", target]
            task.environment = ["PATH": "/usr/bin:/bin"]
            func outputFile(_ suffix: String) throws -> FileHandle {
                let path = output.appendingPathComponent(name + suffix)
                guard FileManager.default.createFile(atPath: path.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw PrivacyRouteError.blocked }
                return try FileHandle(forWritingTo: path)
            }
            let metrics = try outputFile(".curl.json"), errors = try outputFile(".stderr")
            task.standardOutput = metrics; task.standardError = errors; task.standardInput = FileHandle.nullDevice
            try task.run()
            while task.isRunning {
                if adapter.pollProcess() != .bootstrapReady { task.interrupt() }
                try await Task.sleep(for: .milliseconds(100))
            }
            try metrics.close(); try errors.close()
            receipt[name + "Exit"] = task.terminationStatus; try write(receipt)
        }
        receipt["holdUntil"] = Date().addingTimeInterval(900).timeIntervalSince1970; try write(receipt)
        print("Public requests finished; original route held for controlled acceptance, <=900 seconds")
        let heldUntil = ContinuousClock.now.advanced(by: .seconds(900))
        while ContinuousClock.now < heldUntil && !FileManager.default.fileExists(atPath: output.appendingPathComponent("release").path) && adapter.pollProcess() == .bootstrapReady { try await Task.sleep(for: .milliseconds(200)) }
        adapter.stop()
        while adapter.processIdentifier != nil { _ = adapter.pollProcess(); try await Task.sleep(for: .milliseconds(100)) }
        receipt["stoppedAt"] = Date().timeIntervalSince1970; receipt["state"] = "stopped"; receipt["stopReason"] = adapter.lastStopReason ?? "process-exited"; try write(receipt)
    }
}
