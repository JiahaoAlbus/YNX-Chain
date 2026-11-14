import Foundation
import Darwin
import CoreFoundation

public enum BackendOutputStream: String, Codable, Sendable { case standardOutput, standardError, merged }
public enum BackendOutputPolicy: String, Codable, Sendable { case boundedCapture, discardAfterBootstrap }
public struct BackendStartSpecification: Sendable {
    public let executable: URL
    public let executableSHA256: String
    public let codeRequirement: String
    public let arguments: [String]
    public let environment: [String: String]
    public let keepStandardInputOpen: Bool
    public let output: BackendOutputStream
    public let outputPolicy: BackendOutputPolicy
    public let outputCaptureLimit: Int
    public init(executable: URL, executableSHA256: String, codeRequirement: String, arguments: [String], environment: [String: String], keepStandardInputOpen: Bool = true, output: BackendOutputStream = .standardOutput, outputPolicy: BackendOutputPolicy = .boundedCapture, outputCaptureLimit: Int = 131_072) {
        self.executable = executable; self.executableSHA256 = executableSHA256; self.codeRequirement = codeRequirement; self.arguments = arguments; self.environment = environment; self.keepStandardInputOpen = keepStandardInputOpen; self.output = output
        self.outputPolicy = outputPolicy
        self.outputCaptureLimit = outputCaptureLimit
    }
    func validateOutputCaptureLimit() throws {
        guard (1...16_777_216).contains(outputCaptureLimit),
              outputPolicy == .boundedCapture || outputCaptureLimit == 131_072 else {
            throw BackendStartGateFailure(operation: "output-capture-limit", detail: "Invalid bounded output policy")
        }
    }
    func requireCaptureAcknowledgement(_ value: Any?) throws {
        try validateOutputCaptureLimit()
        if value == nil, outputCaptureLimit == 131_072 { return } // Legacy default only.
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue == Double(outputCaptureLimit) else {
            throw BackendStartGateFailure(operation: "output-capture-ack", detail: "Helper did not acknowledge the exact output bound")
        }
    }
}
public struct PreparedBackendIdentity: Sendable { public let pid: Int32; public let processPinJSON: Data }
public struct BackendProcessExit: Sendable {
    public let pid: Int32
    public let code: Int32?
    public let signal: Int32?
    public let childReaped: Bool
}
public struct BackendStartGateFailure: Error, Sendable { public let operation: String; public let detail: String }
public struct BackendOutputDiscardAcknowledgement: Sendable {
    public let pid: Int32
    public let runID: String, epoch: String, providerGeneration: String
    public let backendTokenSHA256: String, markerSHA256: String, requestNonce: String
    public let capturedBytes: UInt64, discardedBytes: UInt64
}

@MainActor public final class OwnedBackendStartGate {
    public static let helperRelativePath = "Contents/Helpers/YNXBackendStartGate"
    public private(set) var prepared: PreparedBackendIdentity?
    public private(set) var observedExit: BackendProcessExit?
    public private(set) var outputDiscardAcknowledgement: BackendOutputDiscardAcknowledgement?
    public private(set) var outputCaptureComplete = false
    public private(set) var cleanupChildPID: Int32? // Receipt binding ONLY, never resume/graph authority.
    public private(set) var cleanupConfirmed = false
    public private(set) var stopFailure: BackendStartGateFailure?
    public var isRunning: Bool { helper?.isRunning == true && observedExit == nil && !stopped }
    public var backendOutput: FileHandle { outputReader! }
    private let helperURL: URL, directory: URL
    private let preparation: RoutedRootPreparation
    private var helper: Process?
    private var controlWriter: FileHandle?
    private var outputReader: FileHandle?
    private var controlReader: FileHandle?
    private var pending = Data()
    private var events: [[String: Any]] = []
    private var stopped = false
    private let stopWork = OwnedBackendStopTask()
    private var helperLaunched = false
    private var cleanupChild: OwnedBackendCleanupChild?
    private var cleanupChildConflict = false
    private var cleanupTargetPath = "", cleanupTargetSHA256 = "", cleanupRequirement = ""
    private var stopCommandSelected = false, terminationSelected = false
    private enum CloseState { case open, closed, unknown }
    private var writerClose: CloseState = .open, readerClose: CloseState = .open, outputClose: CloseState = .open
    private var resumed = false
    private var preparing = false
    private var tokenHash = ""
    private var ownsDirectory = false
    private var outputPolicy: BackendOutputPolicy = .boundedCapture
    private var expectedOutputCaptureLimit = 131_072
    private var changingOutputPolicy = false

    public init(helperExecutable: URL, helperSHA256: String, preparation: RoutedRootPreparation, directory: URL) throws {
        try preparation.requireValidPreparation()
        let expected = Bundle.main.bundleURL.appendingPathComponent(Self.helperRelativePath).standardizedFileURL
        guard helperExecutable.standardizedFileURL == expected, helperExecutable.resolvingSymlinksInPath() == expected, helperSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, ProtectionLease.hash(try Data(contentsOf: helperExecutable)) == helperSHA256, directory.isFileURL, directory.path.hasPrefix("/"), directory.resolvingSymlinksInPath() == directory else { throw BackendStartGateFailure(operation: "own-bundle-helper", detail: "Exact current mode bundle helper and private run directory required") }
        helperURL = helperExecutable; self.preparation = preparation; self.directory = directory
    }
    public func prepare(specification: BackendStartSpecification) async throws -> PreparedBackendIdentity {
        try preparation.requireValidPreparation()
        guard !stopped, !preparing, helper == nil, prepared == nil else { throw ProtectionLeaseFailure.cancelled }; preparing = true
        do {
            try specification.validateOutputCaptureLimit()
            guard specification.executable.isFileURL, specification.executable.resolvingSymlinksInPath() == specification.executable, specification.executableSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, !specification.codeRequirement.isEmpty, specification.arguments.count <= 64 else { throw ProtectionLeaseFailure.invalidConfiguration }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            ownsDirectory = true
            let spool = directory.appendingPathComponent("backend.output"), manifest = directory.appendingPathComponent("start.json")
            outputPolicy = specification.outputPolicy
            expectedOutputCaptureLimit = specification.outputCaptureLimit
            cleanupTargetPath = specification.executable.path; cleanupTargetSHA256 = specification.executableSHA256; cleanupRequirement = specification.codeRequirement
            let config: [String: Any] = ["schema": "P05_BACKEND_START_GATE_V1", "runID": preparation.configuration.runID, "epoch": preparation.configuration.epoch.uuidString, "target": specification.executable.path, "sha256": specification.executableSHA256, "requirement": specification.codeRequirement, "arguments": specification.arguments, "environment": specification.environment, "keepStandardInputOpen": specification.keepStandardInputOpen, "output": specification.output.rawValue, "outputPolicy": specification.outputPolicy.rawValue, "outputCaptureLimit": specification.outputCaptureLimit, "spool": spool.path]
            try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys]).write(to: manifest, options: [.withoutOverwriting]); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: manifest.path)
            try preparation.requireValidPreparation() // Same Actor, immediately before Process.run.
            let process = Process(), input = Pipe(), output = Pipe(); process.executableURL = helperURL; process.arguments = [manifest.path]; process.environment = ["PATH": "/usr/bin:/bin"]
            process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
            helper = process; controlWriter = input.fileHandleForWriting; controlReader = output.fileHandleForReading
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in let bytes = handle.availableData; Task { @MainActor in self?.consume(bytes) } }
            try Task.checkCancellation()
            guard !stopped else { throw ProtectionLeaseFailure.cancelled }
            try process.run(); helperLaunched = true
            let event = try await waitFor("prepared")
            try specification.requireCaptureAcknowledgement(event["outputCaptureLimit"])
            try Task.checkCancellation()
            guard !stopped else { throw ProtectionLeaseFailure.cancelled }
            guard let pid = event["pid"] as? Int32, pid > 1, let pin = event["processPin"] as? [String: Any], let hex = pin["auditTokenHex"] as? String, hex.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, event["state"] as? String == "post-exec-suspended" else { throw ProtectionLeaseFailure.malformedReply }
            let bytes = stride(from: 0, to: hex.count, by: 2).map { index -> UInt8 in let begin = hex.index(hex.startIndex, offsetBy: index); return UInt8(hex[begin..<hex.index(begin, offsetBy: 2)], radix: 16)! }
            tokenHash = ProtectionLease.hash(Data(bytes)); let identity = PreparedBackendIdentity(pid: pid, processPinJSON: try JSONSerialization.data(withJSONObject: pin, options: [.sortedKeys]))
            try preparation.requireValidPreparation()
            outputReader = try FileHandle(forReadingFrom: spool)
            // The helper keeps its original exclusive write FD; it never reopens this name.
            // Unlink while the child is still suspended, before any target log can be written.
            try FileManager.default.removeItem(at: spool)
            if FileManager.default.fileExists(atPath: manifest.path) { try FileManager.default.removeItem(at: manifest) }
            prepared = identity; return identity
        } catch { await stop(); throw error }
    }
    public func resume(after acknowledgement: BackendGraphAcknowledgement, lease: ProtectionLeaseView) async throws {
        do {
            guard !stopped, !resumed, prepared != nil else { throw ProtectionLeaseFailure.cancelled }
            try preparation.requireValidPreparation(); try preparation.validate(acknowledgement, lease: lease, backendTokenHash: tokenHash)
            try send("RESUME") // No await between live lease/ACK validation and sending the command.
            _ = try await waitFor("resumed")
            try Task.checkCancellation()
            guard !stopped else { throw ProtectionLeaseFailure.cancelled }
            resumed = true
        } catch { await stop(); throw error }
    }
    public func poll() async throws -> BackendProcessExit? {
        if let observedExit { return observedExit }
        guard let helper, helperLaunched else { return nil }
        if !helper.isRunning { return .init(pid: prepared?.pid ?? 0, code: helper.terminationReason == .exit ? helper.terminationStatus : nil, signal: helper.terminationReason == .uncaughtSignal ? helper.terminationStatus : nil, childReaped: false) }
        try send("STATUS"); _ = try await waitFor("status", checkPreparation: false); return observedExit
    }
    /// Bounded auxiliary output, not process health or route authority. The child can
    /// exit successfully while its last pipe bytes are still pending or were refused.
    public func requireCompleteOutputCapture() throws {
        guard outputPolicy == .boundedCapture, observedExit?.childReaped == true, outputCaptureComplete else {
            throw BackendStartGateFailure(operation: "output-capture-incomplete", detail: "Owned auxiliary output did not reach verified EOF within its exact bound")
        }
    }
    /// The caller first validates its official bootstrap marker, then supplies the SHA256 of
    /// that exact complete raw output line, excluding LF and one optional preceding CR. The
    /// helper verifies membership in its own bounded anonymous capture before acknowledging.
    /// This is NOT readiness/NE admission; only a fresh blocked lease and latest graph may call.
    public func discardOutput(afterBootstrapMarkerSHA256 marker: String, acknowledgement: BackendGraphAcknowledgement, lease: ProtectionLeaseView) async throws -> BackendOutputDiscardAcknowledgement {
        guard !changingOutputPolicy else { throw ProtectionLeaseFailure.cancelled }
        changingOutputPolicy = true; defer { changingOutputPolicy = false }
        do {
            guard !stopped, resumed, let prepared, outputDiscardAcknowledgement == nil,
                  outputPolicy == .discardAfterBootstrap,
                  marker.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  lease.phase == .blocked, let providerGeneration = lease.providerGeneration else { throw ProtectionLeaseFailure.cancelled }
            try preparation.requireValidPreparation()
            try preparation.validate(acknowledgement, lease: lease, backendTokenHash: tokenHash)
            let nonce = UUID().uuidString.lowercased()
            try send("DROP_OUTPUT \(tokenHash) \(nonce) \(marker)") // No await after fresh authority check.
            let event = try await waitFor("output-discarding")
            try Task.checkCancellation()
            guard !stopped else { throw ProtectionLeaseFailure.cancelled }
            try preparation.validate(acknowledgement, lease: lease, backendTokenHash: tokenHash)
            guard event["state"] as? String == "discarding", event["pid"] as? Int32 == prepared.pid,
                  event["runID"] as? String == preparation.configuration.runID,
                  event["epoch"] as? String == preparation.configuration.epoch.uuidString,
                  event["requestNonce"] as? String == nonce, event["backendTokenSHA256"] as? String == tokenHash,
                  event["markerSHA256"] as? String == marker,
                  let captured = event["capturedBytes"] as? UInt64, captured <= 131072,
                  let discarded = event["discardedBytes"] as? UInt64 else { throw ProtectionLeaseFailure.malformedReply }
            let receipt = BackendOutputDiscardAcknowledgement(pid: prepared.pid, runID: preparation.configuration.runID,
                epoch: preparation.configuration.epoch.uuidString, providerGeneration: providerGeneration,
                backendTokenSHA256: tokenHash, markerSHA256: marker, requestNonce: nonce,
                capturedBytes: captured, discardedBytes: discarded)
            outputDiscardAcknowledgement = receipt
            closeOutputReader() // Prefix consumed; record physical closure instead of swallowing UNKNOWN.
            return receipt
        } catch { await stop(); throw error }
    }
    public func stop() async {
        stopped = true // Fence prepare/resume synchronously, before joining any async cleanup.
        await stopWork.join { [self] in await performStop() }
    }
    // Only the independently owned stop task calls this worker. It never calls
    // public stop(), preparation callbacks, or another stop task: no self-join.
    private func performStop() async {
        guard !cleanupConfirmed else { return }
        if let helper, helperLaunched, helper.isRunning {
            if !stopCommandSelected {
                stopCommandSelected = true // Do not replay an ambiguously written STOP.
                do { try send("STOP") } catch { rememberStopFailure("stop-command", "Owned helper stop command failed") }
            }
            closeControlWriter() // EOF independently triggers the helper's SAME child-reaping path.
            let deadline = DispatchTime.now().uptimeNanoseconds + 6_000_000_000
            while helper.isRunning && DispatchTime.now().uptimeNanoseconds < deadline {
                guard await stopPause(20_000_000) else { return }
            }
            if helper.isRunning {
                if !terminationSelected {
                    terminationSelected = true
                    helper.terminate() // Same helper SIGTERM; never SIGKILL its child-owning wrapper.
                }
                let final = DispatchTime.now().uptimeNanoseconds + 6_000_000_000
                while helper.isRunning && DispatchTime.now().uptimeNanoseconds < final {
                    guard await stopPause(20_000_000) else { return }
                }
            }
            guard !helper.isRunning else {
                rememberStopFailure("stop-helper", "Owned helper exit remains unobserved")
                return // Keep SAME helper, receipt reader, output FD and run files on UNKNOWN.
            }
        }
        closeControlWriter()
        if helperLaunched {
            let finalReceipt = DispatchTime.now().uptimeNanoseconds + 300_000_000
            while observedExit == nil && DispatchTime.now().uptimeNanoseconds < finalReceipt {
                guard await stopPause(10_000_000) else { return }
            }
            guard helper?.isRunning != true, !cleanupChildConflict, let cleanupChildPID, let exit = observedExit,
                  exit.pid == cleanupChildPID, prepared == nil || prepared?.pid == cleanupChildPID, exit.childReaped else {
                rememberStopFailure("stop-reap", "Exact prepared child reap remains unconfirmed")
                return // Late consume may still supply a receipt; explicit stop rejoins SAME ownership.
            }
        }
        closeControlReader(); closeOutputReader()
        guard writerClose == .closed, readerClose == .closed, outputClose == .closed else { return }
        if ownsDirectory {
            for name in ["backend.output", "start.json"] {
                let path = directory.appendingPathComponent(name)
                if FileManager.default.fileExists(atPath: path.path) {
                    do { try FileManager.default.removeItem(at: path) }
                    catch { rememberStopFailure("stop-run-files", "Owned run file removal failed"); return }
                }
            }
        }
        cleanupConfirmed = true // Physical closure only; never route/NE readiness or a no-child receipt.
    }
    private func stopPause(_ nanoseconds: UInt64) async -> Bool {
        do { try await Task.sleep(nanoseconds: nanoseconds); return true }
        catch { rememberStopFailure("stop-worker", "Owned cleanup task unexpectedly cancelled"); return false }
    }
    private func rememberStopFailure(_ operation: String, _ detail: String) {
        if stopFailure == nil { stopFailure = .init(operation: operation, detail: detail) }
    }
    private func closeControlWriter() {
        guard writerClose == .open else { return }; writerClose = .unknown
        do { try controlWriter?.close(); writerClose = .closed }
        catch { rememberStopFailure("stop-control-input", "Owned control input close remains unknown") }
    }
    private func closeControlReader() {
        guard readerClose == .open else { return }; readerClose = .unknown
        controlReader?.readabilityHandler = nil
        do { try controlReader?.close(); readerClose = .closed }
        catch { rememberStopFailure("stop-control-output", "Owned control output close remains unknown") }
    }
    private func closeOutputReader() {
        guard outputClose == .open else { return }; outputClose = .unknown
        do { try outputReader?.close(); outputClose = .closed }
        catch { rememberStopFailure("stop-backend-output", "Owned backend output close remains unknown") }
    }
    private func send(_ command: String) throws { guard let controlWriter, helper?.isRunning == true else { throw BackendStartGateFailure(operation: "owned-gate", detail: "Helper is not running") }; try controlWriter.write(contentsOf: Data((command + "\n").utf8)) }
    private func consume(_ data: Data) {
        pending.append(data); guard pending.count <= 65536 else { events.append(["kind": "refused"]); return }
        while let newline = pending.firstIndex(of: 10) {
            let line = pending.prefix(upTo: newline); pending.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let kind = value["kind"] as? String else { continue }
            if kind == "prepared" {
                if let identity = OwnedBackendCleanupChild(event: value, runID: preparation.configuration.runID,
                    epoch: preparation.configuration.epoch.uuidString, path: cleanupTargetPath,
                    sha256: cleanupTargetSHA256, requirement: cleanupRequirement) {
                    if let original = cleanupChild, original != identity {
                        cleanupChildConflict = true
                        rememberStopFailure("stop-child-binding", "Conflicting owned helper child identity")
                    } else { cleanupChild = identity; cleanupChildPID = identity.pid }
                } else {
                    cleanupChildConflict = true
                    rememberStopFailure("stop-child-binding", "Owned helper prepared identity rejected")
                }
            }
            if kind == "exit" {
                outputCaptureComplete = false
                observedExit = .init(pid: (value["pid"] as? Int32) ?? 0, code: value["code"] as? Int32, signal: value["signal"] as? Int32, childReaped: value["childReaped"] as? Bool == true)
                if let complete = value["outputCaptureComplete"] as? NSNumber, CFGetTypeID(complete) == CFBooleanGetTypeID(), complete.boolValue,
                   let limit = value["outputCaptureLimit"] as? NSNumber, CFGetTypeID(limit) != CFBooleanGetTypeID(), limit.doubleValue == Double(expectedOutputCaptureLimit),
                   let count = value["capturedBytes"] as? NSNumber, CFGetTypeID(count) != CFBooleanGetTypeID(),
                   count.doubleValue >= 0, count.doubleValue <= Double(expectedOutputCaptureLimit), count.doubleValue == Double(count.int64Value) {
                    outputCaptureComplete = true
                }
            }
            if !stopped || kind == "exit" { events.append(value) }
        }
    }
    private func waitFor(_ kind: String, checkPreparation: Bool = true) async throws -> [String: Any] {
        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        while DispatchTime.now().uptimeNanoseconds < deadline {
            try Task.checkCancellation()
            if stopped && checkPreparation { throw ProtectionLeaseFailure.cancelled }
            if checkPreparation { try preparation.requireValidPreparation() }
            if let index = events.firstIndex(where: { $0["kind"] as? String == kind }) { return events.remove(at: index) }
            if events.contains(where: { $0["kind"] as? String == "refused" }) || observedExit != nil || helper?.isRunning != true || (stopped && checkPreparation) { throw BackendStartGateFailure(operation: kind, detail: "Owned helper/child refused or exited") }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        throw ProtectionLeaseFailure.replyTimeout
    }
}

// Cleanup scheduling only: no Source, NE, process-start or lease authority. The
// Gate supplies its existing worker and resources. Kept internal so a PUBLIC
// fixture can exercise the actual cancellation/join primitive without forging
// a RoutedRootPreparation, signed provider or backend graph acknowledgement.
@MainActor final class OwnedBackendStopTask {
    private var owned: Task<Void, Never>?
    private var running = false
    func join(_ operation: @escaping @MainActor () async -> Void) async {
        if running, let owned { await owned.value; return }
        running = true
        // Unstructured Task intentionally does not inherit caller cancellation.
        // Retain the completed task too; an explicit later observation replaces
        // it only after completion, retaining the SAME Gate/resources on UNKNOWN.
        let worker = Task { @MainActor in await operation(); self.running = false }
        owned = worker
        await worker.value
    }
}

// Parses ONLY frames from this Gate's private original helper pipe. This is a
// cleanup identity, not a Source/canary/graph acknowledgement or resume token.
// Public prepared is intentionally NOT populated by a late/cancelled frame.
struct OwnedBackendCleanupChild: Equatable {
    let pid: Int32
    let auditTokenHex: String
    init?(event: [String: Any], runID: String, epoch: String, path: String, sha256: String, requirement: String) {
        guard event["kind"] as? String == "prepared", event["state"] as? String == "post-exec-suspended",
              let eventRun = event["runID"] as? String, eventRun.utf8.elementsEqual(runID.utf8),
              let eventEpoch = event["epoch"] as? String, eventEpoch.utf8.elementsEqual(epoch.utf8),
              let pid = event["pid"] as? Int32, pid > 1,
              let pin = event["processPin"] as? [String: Any], pin["pid"] as? Int32 == pid,
              let actualPath = pin["path"] as? String, !path.isEmpty, actualPath.utf8.elementsEqual(path.utf8),
              let actualSHA = pin["sha256"] as? String, actualSHA.utf8.elementsEqual(sha256.utf8),
              sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let actualRequirement = pin["requirement"] as? String, !requirement.isEmpty,
              actualRequirement.utf8.elementsEqual(requirement.utf8),
              let token = pin["auditTokenHex"] as? String,
              token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        self.pid = pid; auditTokenHex = token
    }
}
