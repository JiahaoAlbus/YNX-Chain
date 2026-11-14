import Foundation
import CryptoKit
import Darwin
import YNXBrowserCore

enum TorTransportFailure: String, Error { case invalidBridgePeer, protocolRejected, outputLimit, unsafeState, alreadyRunning, protectionUnavailable, processExited, startupTimedOut }

/// Official PT startup protocol only. A listener/partial CMETHOD is never a Tor circuit-ready signal.
struct TorTransportProtocolParser {
    private enum Phase { case version, method, done, complete, failed }
    private var phase: Phase = .version
    private var pending = Data()
    private var total = 0
    private var endpointPort: UInt16?
    private(set) var completionMarkerSHA256: String?
    mutating func consume(_ bytes: Data) throws {
        guard phase != .failed else { throw TorTransportFailure.protocolRejected }
        total += bytes.count
        guard total <= 1_048_576, pending.count + bytes.count <= 65_536 else { phase = .failed; throw TorTransportFailure.outputLimit }
        pending.append(bytes)
        while let end = pending.firstIndex(of: 10) {
            var line = Data(pending[..<end]); pending.removeSubrange(...end)
            if line.last == 13 { line.removeLast() }
            guard line.count <= 4096, line.allSatisfy({ (32...126).contains($0) }) else { phase = .failed; throw TorTransportFailure.protocolRejected }
            let text = String(decoding: line, as: UTF8.self)
            if text.hasPrefix("LOG ") || text.hasPrefix("STATUS ") { continue }
            let fields = text.split(separator: " ", omittingEmptySubsequences: false)
            switch phase {
            case .version:
                guard text == "VERSION 1" else { phase = .failed; throw TorTransportFailure.protocolRejected }
                phase = .method
            case .method:
                guard fields.count == 4, fields[0] == "CMETHOD", fields[1] == "obfs4", fields[2] == "socks5", fields[3].hasPrefix("127.0.0.1:"),
                      fields[3].dropFirst("127.0.0.1:".count).allSatisfy({ $0.isASCII && $0.isNumber }),
                      let port = UInt16(fields[3].dropFirst("127.0.0.1:".count)), port > 0 else { phase = .failed; throw TorTransportFailure.protocolRejected }
                endpointPort = port; phase = .done
            case .done:
                guard text == "CMETHODS DONE" else { phase = .failed; endpointPort = nil; throw TorTransportFailure.protocolRejected }
                // Exact complete raw line, excluding LF and its optional single preceding CR.
                completionMarkerSHA256 = SHA256.hash(data: line).map { String(format: "%02x", $0) }.joined()
                phase = .complete
            case .complete, .failed:
                phase = .failed; endpointPort = nil; throw TorTransportFailure.protocolRejected
            }
        }
        guard pending.count <= 4096 else { phase = .failed; endpointPort = nil; throw TorTransportFailure.outputLimit }
    }
    var completedPort: UInt16? { phase == .complete && pending.isEmpty ? endpointPort : nil }
}

/// Exact numeric entry peers for the trusted protection owner, never a hostname/DNS approximation.
struct TorBridgeEntryPeer: Equatable, Hashable {
    let address: String
    let port: UInt16
    static func parse(_ lines: [String]) throws -> [Self] {
        guard !lines.isEmpty, lines.count <= 32 else { throw TorTransportFailure.invalidBridgePeer }
        var seen = Set<Self>(), result: [Self] = []
        for line in lines {
            guard line.utf8.count <= 4096, line.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw TorTransportFailure.invalidBridgePeer }
            let fields = line.split(separator: " ", omittingEmptySubsequences: true)
            guard fields.count >= 4, fields[0] == "obfs4", fields[2].count == 40,
                  fields[2].allSatisfy({ $0.isHexDigit }) else { throw TorTransportFailure.invalidBridgePeer }
            let endpoint = String(fields[1]), host: String, portText: String
            if endpoint.hasPrefix("["), let end = endpoint.firstIndex(of: "]"), endpoint.index(after: end) < endpoint.endIndex, endpoint[endpoint.index(after: end)] == ":" {
                host = String(endpoint[endpoint.index(after: endpoint.startIndex)..<end]); portText = String(endpoint[endpoint.index(end, offsetBy: 2)...])
            } else {
                let parts = endpoint.split(separator: ":", omittingEmptySubsequences: false)
                guard parts.count == 2 else { throw TorTransportFailure.invalidBridgePeer }
                host = String(parts[0]); portText = String(parts[1])
            }
            guard !portText.isEmpty, portText.allSatisfy({ $0.isASCII && $0.isNumber }), let port = UInt16(portText), port > 0 else { throw TorTransportFailure.invalidBridgePeer }
            var ipv4 = in_addr(), ipv6 = in6_addr(), normalized = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            if inet_pton(AF_INET, host, &ipv4) == 1 { guard inet_ntop(AF_INET, &ipv4, &normalized, socklen_t(normalized.count)) != nil else { throw TorTransportFailure.invalidBridgePeer } }
            else if inet_pton(AF_INET6, host, &ipv6) == 1 { guard inet_ntop(AF_INET6, &ipv6, &normalized, socklen_t(normalized.count)) != nil else { throw TorTransportFailure.invalidBridgePeer } }
            else { throw TorTransportFailure.invalidBridgePeer }
            let peer = Self(address: String(decoding: normalized.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self), port: port)
            if seen.insert(peer).inserted { result.append(peer) }
        }
        return result
    }
}

/// Native owns this PT separately from Arti. Protocol availability is never Tor route readiness.
/// The security gate owns the real suspended process and enforces the Root/epoch/graph ACK.
@MainActor final class TorExternalTransport {
    // Match fixed tor-ptmgr0.47.0 ipc.rs PT_START_TIMEOUT. This bounds only the
    // PT VERSION/CMETHOD/CMETHODS DONE handshake, not bridge/circuit bootstrap.
    static let protocolStartupTimeout: Duration = .seconds(30)
    enum State: Equatable { case stopped, suspended, starting, protocolAvailable(UInt16), stopping, failed }
    enum CleanupStatus { case notStarted, reaped, unconfirmed }
    private(set) var state: State = .stopped
    private(set) var cleanupStatus: CleanupStatus = .notStarted
    private(set) var entryPeers: [TorBridgeEntryPeer] = []
    private(set) var outputDiscardAcknowledgement: BackendOutputDiscardAcknowledgement?
    private var bootstrapMarkerSHA256: String?
    private var gate: OwnedBackendStartGate?
    private var identity: PreparedBackendIdentity?
    private var sourceBridge: ArtiProcessAdapter.BridgeConfiguration?
    private var generation = UUID()
    private var ownershipFD: Int32 = -1
    private var freshControlLease: (@MainActor () throws -> ProtectionLeaseView)?

    /// Must follow actual Root deny preparation. Returns this independently suspended incarnation
    /// for the parent's complete initial backend graph; it never registers Arti implicitly.
    func prepare(backend: BundledTorBackend.PreparedBackend, preparation: RoutedRootPreparation,
                 helperExecutable: URL, helperSHA256: String, codeRequirement: String,
                 onGateCreated: @MainActor (OwnedBackendStartGate) -> Void) async throws -> PreparedBackendIdentity {
        try Task.checkCancellation()
        guard gate == nil, state == .stopped else { throw TorTransportFailure.alreadyRunning }
        guard preparation.receipt != nil else { throw TorTransportFailure.protectionUnavailable }
        try backend.bridge.validateExecutable()
        let peers = try TorBridgeEntryPeer.parse(backend.bridge.lines)
        let directory = try privateTransportDirectory(backend.directory)
        // PT state persists; the gate requires a new per-launch private spool/control directory.
        let gateDirectory = directory.appendingPathComponent("gate-" + UUID().uuidString.lowercased(), isDirectory: true)
        let owned: OwnedBackendStartGate
        do { owned = try OwnedBackendStartGate(helperExecutable: helperExecutable, helperSHA256: helperSHA256, preparation: preparation, directory: gateDirectory) }
        catch { releaseOwnership(); state = .failed; throw error }
        gate = owned; generation = UUID(); let expected = generation
        // Parent tracks the exact gate before any helper/child launch, so synchronous Native
        // content/lease invalidation can close preparation and then stop every owned backend.
        onGateCreated(owned)
        do {
            cleanupStatus = .unconfirmed
            let specification = BackendStartSpecification(executable: backend.bridge.transport, executableSHA256: backend.bridge.transportSHA256,
                codeRequirement: codeRequirement, arguments: [], environment: Self.environment(directory: directory), keepStandardInputOpen: true, output: .standardOutput, outputPolicy: .discardAfterBootstrap)
            let prepared = try await owned.prepare(specification: specification)
            guard generation == expected, gate === owned else { throw TorTransportFailure.processExited }
            identity = prepared; sourceBridge = backend.bridge; entryPeers = peers; state = .suspended
            return prepared
        } catch {
            if gate === owned { await stop(); if gate == nil && state == .stopped { state = .failed } }
            else { await owned.stop() }
            throw error
        }
    }

    /// Parent must first enroll the complete Arti+Lyrebird graph in blocked state. The typed
    /// ACK is checked by the gate against this PT's actual audit token before it can resume.
    /// The returned configuration still needs a second graph ACK before Arti may resume.
    func resume(after acknowledgement: BackendGraphAcknowledgement, lease: @escaping @MainActor () throws -> ProtectionLeaseView) async throws -> ArtiProcessAdapter.BridgeConfiguration {
        guard state == .suspended, let gate, identity != nil, let bridge = sourceBridge else { throw TorTransportFailure.protectionUnavailable }
        let expected = generation
        do {
            // A snapshot has no deadline. Fetch through the parent's live client at actual use.
            try await gate.resume(after: acknowledgement, lease: try lease())
            try Task.checkCancellation()
            guard generation == expected, self.gate === gate, state == .suspended else { throw TorTransportFailure.processExited }
            freshControlLease = lease
            state = .starting
            var parser = TorTransportProtocolParser()
            let output = gate.backendOutput
            let descriptor = output.fileDescriptor
            let flags = fcntl(descriptor, F_GETFL)
            guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else { throw TorTransportFailure.protocolRejected }
            let deadline = ContinuousClock.now.advanced(by: Self.protocolStartupTimeout)
            while ContinuousClock.now < deadline {
                try Task.checkCancellation()
                guard generation == expected else { throw TorTransportFailure.processExited }
                guard try lease().phase == .blocked else { throw TorTransportFailure.protectionUnavailable }
                if try await gate.poll() != nil { throw TorTransportFailure.processExited }
                // poll() suspends; stop can invalidate and close output in the meantime.
                try Task.checkCancellation()
                guard generation == expected, self.gate === gate, state == .starting else { throw TorTransportFailure.processExited }
                guard try lease().phase == .blocked else { throw TorTransportFailure.protectionUnavailable }
                var buffer = [UInt8](repeating: 0, count: 4096)
                let count = read(descriptor, &buffer, buffer.count)
                if count > 0 { try parser.consume(Data(buffer.prefix(count))) }
                else if count < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { throw TorTransportFailure.protocolRejected }
                if let port = parser.completedPort, let marker = parser.completionMarkerSHA256 {
                    bootstrapMarkerSHA256 = marker
                    state = .protocolAvailable(port)
                    var external = bridge; external.externalProxyPort = port
                    return external
                }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw TorTransportFailure.startupTimedOut
        } catch {
            if generation == expected { await stop(); if self.gate == nil && state == .stopped { state = .failed } }
            else { await gate.stop() }
            throw error
        }
    }

    /// Full official PT protocol has completed. The final graph ACK must still be BLOCKED;
    /// only the helper's actual marker-bound ACK makes the long-lived output policy usable.
    func discardOutput(after acknowledgement: BackendGraphAcknowledgement,
                       lease: @MainActor () throws -> ProtectionLeaseView) async throws {
        guard case .protocolAvailable = state, let gate, let identity,
              let marker = bootstrapMarkerSHA256, outputDiscardAcknowledgement == nil else { throw TorTransportFailure.protectionUnavailable }
        let expected = generation
        do {
            let receipt = try await gate.discardOutput(afterBootstrapMarkerSHA256: marker, acknowledgement: acknowledgement, lease: try lease())
            guard generation == expected, self.gate === gate, receipt.pid == identity.pid,
                  receipt.markerSHA256 == marker else { throw TorTransportFailure.processExited }
            outputDiscardAcknowledgement = receipt
            // Gate closed backendOutput after its real ACK. No later read of that FD occurs.
        } catch { if generation == expected { await stop() }; throw error }
    }

    func stop() async {
        generation = UUID(); state = .stopping
        freshControlLease = nil // Withdraw the old callback before the first suspension.
        let stopping = gate
        if let stopping { await stopping.stop() }
        // A second stop waiter may resume after a newly prepared generation; never clear it.
        guard gate === stopping else { return }
        freshControlLease = nil
        if let stopping {
            let exit = try? await stopping.poll()
            guard gate === stopping else { return }
            guard exit?.childReaped == true, exit?.pid == stopping.cleanupChildPID,
                  stopping.cleanupConfirmed else {
                // Helper disappearance/stop return alone cannot prove the vendor child was reaped.
                // A child receipt alone also does not prove capture/control pipes are closed.
                // Preserve the original gate and profile lease; no replacement is allowed.
                cleanupStatus = .unconfirmed; state = .failed; return
            }
            cleanupStatus = .reaped
        }
        gate = nil; identity = nil; sourceBridge = nil; entryPeers = []; freshControlLease = nil
        bootstrapMarkerSHA256 = nil; outputDiscardAcknowledgement = nil; releaseOwnership(); state = .stopped
    }

    /// The protection owner also fences lease/path loss; this observes this original PT's waitpid.
    func poll(onFailure: @MainActor (Error) -> Void) async throws -> State {
        guard let gate else { return state }
        let expected = generation
        do {
            if state != .suspended, let freshControlLease { _ = try freshControlLease() }
            if try await gate.poll() != nil { throw TorTransportFailure.processExited }
            // An old STATUS waiter must not report a replacement generation's
            // protocolAvailable state, nor reuse a lease that expired during await.
            guard generation == expected, self.gate === gate else { throw TorTransportFailure.processExited }
            if state != .suspended, let freshControlLease { _ = try freshControlLease() }
            return state
        } catch {
            // Tell the exact current route owner before waiting for process cleanup.
            // The callback only fences synchronously; it must not join this poll.
            if generation == expected, self.gate === gate { onFailure(error) }
            if self.gate === gate { await stop(); if self.gate == nil && state == .stopped { state = .failed } }
            else { await gate.stop() }
            throw error
        }
    }

    static func environment(directory: URL) -> [String: String] {
        ["PATH": "/usr/bin:/bin", "HOME": directory.path, "TOR_PT_MANAGED_TRANSPORT_VER": "1",
         "TOR_PT_STATE_LOCATION": directory.path, "TOR_PT_CLIENT_TRANSPORTS": "obfs4", "TOR_PT_EXIT_ON_STDIN_CLOSE": "1"]
    }

    private func privateTransportDirectory(_ profile: URL) throws -> URL {
        guard profile.isFileURL else { throw TorTransportFailure.unsafeState }
        let root = open(profile.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else { throw TorTransportFailure.unsafeState }
        defer { close(root) }
        var info = stat()
        guard fstat(root, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700 else { throw TorTransportFailure.unsafeState }
        if mkdirat(root, "lyrebird-external", 0o700) != 0 && errno != EEXIST { throw TorTransportFailure.unsafeState }
        let directory = openat(root, "lyrebird-external", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw TorTransportFailure.unsafeState }
        defer { close(directory) }
        guard fstat(directory, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700 else { throw TorTransportFailure.unsafeState }
        let descriptor = openat(directory, ".ynx-pt-owner.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw TorTransportFailure.unsafeState }
        guard fstat(descriptor, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1,
              info.st_mode & 0o077 == 0, flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { close(descriptor); throw TorTransportFailure.alreadyRunning }
        ownershipFD = descriptor
        return profile.appendingPathComponent("lyrebird-external", isDirectory: true)
    }
    private func releaseOwnership() {
        if ownershipFD >= 0 { _ = flock(ownershipFD, LOCK_UN); close(ownershipFD); ownershipFD = -1 }
    }
}
