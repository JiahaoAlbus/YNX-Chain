import Foundation
import CryptoKit

/// Actual sealed Arti, deferred bootstrap only: no CONNECT, DNS or external target request.
@main enum OwnershipProbe {
    @MainActor static func main() async throws {
        guard CommandLine.arguments.count == 3 else { throw TorPlatformError.invalidPin }
        let binary = URL(fileURLWithPath: CommandLine.arguments[1])
        let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        guard !FileManager.default.fileExists(atPath: root.path) else { throw PrivacyRouteError.stale }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let marker = root.appendingPathComponent("preserved-marker")
        try Data("original state".utf8).write(to: marker)
        let digest = SHA256.hash(data: try Data(contentsOf: binary)).map { String(format: "%02x", $0) }.joined()
        guard digest == "fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a" else { throw TorPlatformError.binaryMismatch }
        let pin = ArtiProcessAdapter.BinaryPin(executable: binary, binarySHA256: digest, sourceArchiveSHA256: "a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813", version: "2.7.0")
        let adapter = ArtiProcessAdapter(), contender = ArtiProcessAdapter()
        func waitForDeferred(_ value: ArtiProcessAdapter) async throws {
            let end = ContinuousClock.now.advanced(by: .seconds(10))
            while value.pollProcess() != .bootstrapDeferred && ContinuousClock.now < end { try await Task.sleep(for: .milliseconds(50)) }
            guard value.pollProcess() == .bootstrapDeferred else { throw PrivacyRouteError.blocked }
        }
        func reap(_ value: ArtiProcessAdapter) async throws {
            value.stop(reason: "ownership-regression")
            let end = ContinuousClock.now.advanced(by: .seconds(14))
            while value.processIdentifier != nil && ContinuousClock.now < end { _ = value.pollProcess(); try await Task.sleep(for: .milliseconds(50)) }
            guard value.processIdentifier == nil else { throw PrivacyRouteError.blocked }
        }
        try adapter.start(pin: pin, port: 63879, sessionDirectory: root)
        do {
            try await waitForDeferred(adapter)
            let config = try Data(contentsOf: root.appendingPathComponent("arti.toml"))
            do { try contender.start(pin: pin, port: 63880, sessionDirectory: root); throw PrivacyRouteError.stale }
            catch TorPlatformError.alreadyRunning { }
            guard contender.processIdentifier == nil,
                  try Data(contentsOf: root.appendingPathComponent("arti.toml")) == config else { throw PrivacyRouteError.stale }
            try await reap(adapter)
            guard adapter.lastStopReason == "ownership-regression" else { throw PrivacyRouteError.stale }
            try adapter.start(pin: pin, port: 63879, sessionDirectory: root)
            guard adapter.lastStopReason == nil else { throw PrivacyRouteError.stale }
            try await waitForDeferred(adapter); try await reap(adapter)
            guard try Data(contentsOf: marker) == Data("original state".utf8) else { throw PrivacyRouteError.stale }
        } catch { try await reap(adapter); try await reap(contender); throw error }
        print("PASS real Arti existing private profile reuse; exclusive live lease rejects competing start before config write; SIGINT/reap; stop reason reset; original marker preserved. No target request.")
    }
}
