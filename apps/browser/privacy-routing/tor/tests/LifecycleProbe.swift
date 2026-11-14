import Foundation
import CryptoKit
import Darwin

@main enum LifecycleProbe {
    @MainActor static func main() async {
        do { try await run() }
        catch {
            FileHandle.standardError.write(Data("LIFECYCLE_NOT_VERIFIED: \(error)\n".utf8))
            exit(1)
        }
    }
    @MainActor static func run() async throws {
        guard [4, 5].contains(CommandLine.arguments.count), let port = UInt16(CommandLine.arguments[3]) else { throw TorPlatformError.invalidPort }
        let deferred = CommandLine.arguments.count == 4
        let binary = URL(fileURLWithPath: CommandLine.arguments[1])
        let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true).appendingPathComponent("manual-\(UUID().uuidString)")
        let digest = SHA256.hash(data: try Data(contentsOf: binary)).map { String(format: "%02x", $0) }.joined()
        let pin = ArtiProcessAdapter.BinaryPin(executable: binary, binarySHA256: digest, sourceArchiveSHA256: "a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813", version: "2.7.0")
        let adapter = ArtiProcessAdapter()
        try adapter.start(pin: pin, port: port, sessionDirectory: directory, deferBootstrap: deferred)
        defer { adapter.stop() }
        let deadline = ContinuousClock.now.advanced(by: .seconds(deferred ? 10 : 90))
        while ContinuousClock.now < deadline, adapter.pollProcess() == .processRunningOnly { try await Task.sleep(for: .milliseconds(50)) }
        let expected: ArtiProcessAdapter.State = deferred ? .bootstrapDeferred : .bootstrapReady
        guard adapter.pollProcess() == expected else {
            let observed = adapter.pollProcess(); adapter.stop()
            for _ in 0..<50 { if case .exited = adapter.pollProcess() { break }; try await Task.sleep(for: .milliseconds(100)) }
            throw NSError(domain: "ArtiLifecycle", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected official \(expected) signal, got \(observed); owned process stopped; no target request sent"])
        }
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw POSIXError(.EIO) }
        defer { close(descriptor) }
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        guard setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0 else { throw POSIXError(.EIO) }
        var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET); address.sin_port = port.bigEndian
        _ = inet_pton(AF_INET, "127.0.0.1", &address.sin_addr)
        let connected = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard connected == 0 else { throw POSIXError(.ECONNREFUSED) }
        let greeting: [UInt8] = [5, 1, 0]
        guard greeting.withUnsafeBytes({ send(descriptor, $0.baseAddress!, $0.count, 0) }) == 3 else { throw POSIXError(.EIO) }
        var response = [UInt8](repeating: 0, count: 2)
        guard recv(descriptor, &response, 2, MSG_WAITALL) == 2, response == [5, 0] else { throw POSIXError(.EIO) }
        // No CONNECT command or target hostname/address is ever sent.
        adapter.stop()
        guard adapter.pollProcess() != .bootstrapReady else { throw PrivacyRouteError.blocked }
        let stopped = ContinuousClock.now.advanced(by: .seconds(5))
        var exitObserved = false
        while ContinuousClock.now < stopped {
            if case .exited = adapter.pollProcess() { exitObserved = true; break }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard exitObserved else { throw NSError(domain: "ArtiLifecycle", code: 2, userInfo: [NSLocalizedDescriptionKey: "Owned Arti process did not exit in 5 seconds"]) }
        let killed = ArtiProcessAdapter()
        let killDirectory = directory.deletingLastPathComponent().appendingPathComponent("kill-\(UUID().uuidString)")
        try killed.start(pin: pin, port: port, sessionDirectory: killDirectory, deferBootstrap: true)
        defer { killed.stop() }
        let readyDeadline = ContinuousClock.now.advanced(by: .seconds(10))
        while ContinuousClock.now < readyDeadline, killed.pollProcess() == .processRunningOnly { try await Task.sleep(for: .milliseconds(50)) }
        guard killed.pollProcess() == .bootstrapDeferred, let pid = killed.processIdentifier else { throw PrivacyRouteError.blocked }
        guard kill(pid, SIGKILL) == 0 else { throw POSIXError(.EIO) }
        let killDeadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < killDeadline {
            if case .exited(let code) = killed.pollProcess() {
                guard code == SIGKILL else { throw PrivacyRouteError.blocked }
                print("PASS official Arti \(expected) startup, loopback-only SOCKS greeting (no target), cancel/shutdown exit, forced SIGKILL exit9 observed; binarySHA256=\(digest)")
                return
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "ArtiLifecycle", code: 3, userInfo: [NSLocalizedDescriptionKey: "Owned forced-kill process exit not observed"])
    }
}
