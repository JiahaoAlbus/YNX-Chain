#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import CryptoKit
import Darwin

@main struct SnowflakeBrowserAdapterDeltaProbe {
    static func expect(_ good: Bool, _ label: String) throws {
        if !good { throw NSError(domain: "P05SnowflakeBrowserDelta", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
    }
    @MainActor static func main() async throws {
        guard CommandLine.arguments.count == 3 else { throw TorPlatformError.invalidPin }
        let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let fixture = URL(fileURLWithPath: CommandLine.arguments[2])
        let now = UInt64(Date().timeIntervalSince1970 * 1e9)
        var value: [String: Any] = ["schema": "P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1", "runID": UUID().uuidString.lowercased(),
            "profile": "/PUBLIC-SYNTHETIC/YNX Browser Route State/Tor", "scratch": "/PUBLIC-SYNTHETIC",
            "profileDevice": 1, "profileInode": 2, "scratchDevice": 1, "scratchInode": 3,
            "scopeSHA256": String(repeating: "0", count: 64), "helperSHA256": TorSnowflakePublicBrowserBackend.helperSHA256,
            "sourceInputsSHA256": TorSnowflakePublicBrowserBackend.sourceInputsSHA256,
            "reviewedSourceSHA256": BundledTorBackend.bridgesSHA256, "selectedBridgeLineSHA256": TorSnowflakePublicBrowserBackend.firstLineSHA256,
            "deadlineUnixNano": now + 650_000_000_000, "fixedTarget": TorPublicSearchDiagnosticPolicy.target]
        func bytes(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) }
        let valid = try bytes(value); _ = try TorSnowflakePublicBrowserBackend.decodeDescriptor(valid)
        var checks = 1
        for name in ["unknown", "target", "helper", "source", "duplicate", "missing", "newline"] {
            var bad = value; var input: Data
            switch name {
            case "unknown": bad["surprise"] = true; input = try bytes(bad)
            case "target": bad["fixedTarget"] = "https://synthetic.invalid/"; input = try bytes(bad)
            case "helper": bad["helperSHA256"] = String(repeating: "0", count: 64); input = try bytes(bad)
            case "source": bad["sourceInputsSHA256"] = String(repeating: "0", count: 64); input = try bytes(bad)
            case "missing": bad.removeValue(forKey: "runID"); input = try bytes(bad)
            case "newline": input = valid + Data([10])
            default: input = Data(("{\"schema\":\"P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1\"," + String(decoding: valid.dropFirst(), as: UTF8.self)).utf8)
            }
            var accepted = false
            do { _ = try TorSnowflakePublicBrowserBackend.decodeDescriptor(input); accepted = true } catch {}
            try expect(!accepted, "invalid descriptor rejected before effects"); checks += 1
        }
        for number in [NSNumber(value: true), NSNumber(value: -1), NSNumber(value: 1.5)] {
            var accepted = false
            do { _ = try TorSnowflakePublicBrowserBackend.integer(number); accepted = true } catch {}
            try expect(!accepted, "non integer identity rejected"); checks += 1
        }
        let owned = out.appendingPathComponent("owned-fixture", isDirectory: true)
        try FileManager.default.createDirectory(at: owned, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var info = stat(); try expect(lstat(owned.path, &info) == 0, "own directory")
        _ = try TorSnowflakePublicBrowserBackend.directory(owned.path, device: UInt64(info.st_dev), inode: info.st_ino)
        var rejected = false
        do { _ = try TorSnowflakePublicBrowserBackend.directory(owned.path, device: UInt64(info.st_dev), inode: info.st_ino + 1) } catch { rejected = true }
        try expect(rejected, "wrong incarnation rejected"); checks += 1
        let alias = out.appendingPathComponent("owned-link", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: owned)
        rejected = false
        do { _ = try TorSnowflakePublicBrowserBackend.directory(alias.path, device: UInt64(info.st_dev), inode: info.st_ino) } catch { rejected = true }
        try expect(rejected, "nofollow ancestry"); checks += 1
        let file = owned.appendingPathComponent("synthetic-data")
        try Data("PUBLIC SYNTHETIC".utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        _ = try TorSnowflakePublicBrowserBackend.readRegular(file, limit: 64, privateFile: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
        rejected = false
        do { _ = try TorSnowflakePublicBrowserBackend.readRegular(file, limit: 64, privateFile: true) } catch { rejected = true }
        try expect(rejected, "private scope mode required"); checks += 1
        // A no-writer FIFO must be rejected before read; the open itself must
        // never block MainActor while waiting for an attacker-controlled writer.
        let fifo = owned.appendingPathComponent("owned-no-writer-fifo")
        try expect(mkfifo(fifo.path, 0o600) == 0, "own synthetic FIFO")
        rejected = false
        do { _ = try TorSnowflakePublicBrowserBackend.readRegular(fifo, limit: 64, privateFile: true) } catch { rejected = true }
        try expect(rejected, "nonregular FIFO rejected without blocking"); checks += 1
        // The probe is deliberately not the sealed app role. No loader/profile effects.
        try expect(!TorSnowflakePublicBrowserBackend.claims(), "wrong role cannot claim new backend")
        rejected = false
        do { _ = try TorSnowflakePublicBrowserBackend.load() } catch { rejected = true }
        try expect(rejected, "actual loader refuses non-role before effect"); checks += 1

        // Actual shared Process/flock/stop callee, with an explicitly synthetic
        // harmless fixture. This pin DATA is NOT an Arti/source or Root assertion.
        let pin = ArtiProcessAdapter.BinaryPin(executable: fixture,
            binarySHA256: TorSnowflakePublicBrowserBackend.hash(try Data(contentsOf: fixture)),
            sourceArchiveSHA256: BundledTorBackend.sourceSHA256, version: "2.7.0")
        let session = out.appendingPathComponent("synthetic-session", isDirectory: true)
        let first = ArtiProcessAdapter(), second = ArtiProcessAdapter()
        var original: Int32 = 0, replacement: Int32 = 0
        do {
        try first.start(pin: pin, port: 63784, sessionDirectory: session, deferBootstrap: true)
        guard let capturedOriginal = first.processIdentifier else { throw TorPlatformError.invalidPin }
        original = capturedOriginal
        rejected = false
        do { try second.start(pin: pin, port: 63784, sessionDirectory: session, deferBootstrap: true) } catch TorPlatformError.alreadyRunning { rejected = true }
        try expect(rejected, "second owner cannot acquire original flock"); checks += 1
        try expect(first.pollProcess() != .bootstrapReady, "running synthetic child is not ready")
        first.stop(reason: "explicit-stop")
        let end = ContinuousClock.now.advanced(by: .seconds(16))
        while first.processIdentifier != nil && ContinuousClock.now < end { _ = first.pollProcess(); try await Task.sleep(for: .milliseconds(20)) }
        try expect(first.processIdentifier == nil, "original harmless child exited; lock released"); checks += 1
        try second.start(pin: pin, port: 63784, sessionDirectory: session, deferBootstrap: true)
        guard let capturedReplacement = second.processIdentifier else { throw TorPlatformError.invalidPin }
        replacement = capturedReplacement
        second.stop(reason: "explicit-stop")
        let stopEnd = ContinuousClock.now.advanced(by: .seconds(16))
        while second.processIdentifier != nil && ContinuousClock.now < stopEnd { _ = second.pollProcess(); try await Task.sleep(for: .milliseconds(20)) }
        try expect(second.processIdentifier == nil, "fresh owner only after original cleanup"); checks += 1
        } catch {
            // Preserve the first assertion failure while closing/joining only our
            // two actual synthetic handles; no failure path abandons a child.
            first.stop(reason: "explicit-stop"); second.stop(reason: "explicit-stop")
            let cleanupEnd = ContinuousClock.now.advanced(by: .seconds(16))
            while (first.processIdentifier != nil || second.processIdentifier != nil), ContinuousClock.now < cleanupEnd {
                _ = first.pollProcess(); _ = second.pollProcess()
                try? await Task.sleep(for: .milliseconds(20))
            }
            throw error
        }
        let result: [String: Any] = ["status": "PASS", "checks": checks, "syntheticOriginalPID": original,
            "syntheticSuccessorPID": replacement, "bothExactHandlesExited": true, "network": "NOT_RUN",
            "GUI": "NOT_RUN", "actualArti": "NOT_RUN", "normalPrivacyAdmission": "UNCHANGED_BLOCKED"]
        print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
        value.removeAll()
    }
}
#endif
