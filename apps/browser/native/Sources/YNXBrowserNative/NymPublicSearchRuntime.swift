#if YNX_PRIVACY_ACCEPTANCE
import AppKit
import CoreFoundation
import CryptoKit
import Darwin
import Foundation
import Network
import Security
import YNXBrowserCore

/// A sealed fixed PUBLIC role. This never supplies normal route qualification.
enum NymPublicSearchRole {
    static let identifier = "com.ynxweb4.browser.qa.nym.public-search"
    static let port: UInt16 = 63780
    static func matches(identifier: String?, marker: Any?) -> Bool {
        guard identifier == self.identifier, let marker = marker as? NSNumber,
              CFGetTypeID(marker) == CFBooleanGetTypeID() else { return false }
        return marker.boolValue
    }
    static func claims(_ bundle: Bundle) -> Bool {
        guard matches(identifier: bundle.bundleIdentifier, marker: bundle.object(forInfoDictionaryKey: "YNXPublicSearchDiagnostic")),
              let nymMarker = bundle.object(forInfoDictionaryKey: "YNXPublicNymSearchDiagnostic") as? NSNumber,
              CFGetTypeID(nymMarker) == CFBooleanGetTypeID(), nymMarker.boolValue else { return false }
        let forbidden = ["YNXPrivacyRouteMode", "CFBundleURLTypes", "YNXNymProofHelper",
                         "YNXPublicSnowflakeSearchDiagnostic", "YNXPublicSnowflakeLaunchSHA256",
                         "YNXPublicArtiChannelTimeoutExperiment", "YNXInteractiveRouteExperiment"]
        return forbidden.allSatisfy { bundle.object(forInfoDictionaryKey: $0) == nil }
    }
    static func require(_ bundle: Bundle) throws {
        guard bundle.bundleURL == Bundle.main.bundleURL, claims(bundle) else {
            throw NymPublicRuntimeFailure.wrongRole
        }
    }
}

/// Explicit interactive QA bundle role. Admission here is limited to the isolated runtime.
enum NymInteractiveRouteRole {
    static let identifier = "com.ynxweb4.browser.qa.nym.interactive"
    static let marker = "YNXInteractiveRouteExperiment"
    static func claims(_ bundle: Bundle) -> Bool {
        guard bundle.bundleIdentifier == identifier,
              let enabled = bundle.object(forInfoDictionaryKey: marker) as? NSNumber,
              CFGetTypeID(enabled) == CFBooleanGetTypeID(), enabled.boolValue else { return false }
        let forbidden = ["YNXPrivacyRouteMode", "CFBundleURLTypes", "YNXNymProofHelper", "YNXNymProofHelperSHA256",
                         "YNXPublicSearchDiagnostic", "YNXPublicNymSearchDiagnostic",
                         "YNXPublicSnowflakeSearchDiagnostic", "YNXPublicSnowflakeLaunchSHA256",
                         "YNXPublicArtiChannelTimeoutExperiment", "YNXNormalArtifactCaptureRole",
                         "YNXRouteFilterProviderSHA256"]
        return forbidden.allSatisfy { bundle.object(forInfoDictionaryKey: $0) == nil }
    }
    static func require(_ bundle: Bundle) throws {
        guard bundle.bundleURL == Bundle.main.bundleURL, claims(bundle) else {
            throw NymPublicRuntimeFailure.wrongRole
        }
    }
}

enum NymPublicRuntimeFailure: String, Error, Sendable {
    case wrongRole, alreadyAttempted, supplyRejected, unsafeScratch, unsafeProfile
    case directoryFailed, staleDirectory, invalidNumericPlan, initializationUnknown, gatewayMismatch
    case childLaunchFailed, childExited, outputIncomplete, outputLimit, timedOut, cancelled
    case bootstrapFailed, cleanupUnknown, identityChanged
    case networkUnavailable, networkChanged, systemSleep, systemWake
}

/// Local PUBLIC diagnostic observations, separate from Core's protected helper receipt.
struct NymPublicObservedExit: Sendable {
    let pid: Int32
    let code: Int32
    let signal: Int32?
    let childReaped: Bool
}

/// Own private vnode paths; never normalize /private/var through Foundation's /var alias.
/// No method searches, copies or adopts any existing user's profile.
final class NymPublicScratch {
    let url: URL
    private let descriptor: Int32
    private let device: dev_t, inode: ino_t
    private init(url: URL, descriptor: Int32, information: stat) {
        self.url = url; self.descriptor = descriptor; device = information.st_dev; inode = information.st_ino
    }
    static func create(parent: URL = FileManager.default.temporaryDirectory) throws -> NymPublicScratch {
        var template = Array(parent.appendingPathComponent("ynx-nym-public-XXXXXXXX").path.utf8CString)
        let fd: Int32 = try template.withUnsafeMutableBufferPointer { buffer in
            guard let path = mkdtemp(buffer.baseAddress) else { throw NymPublicRuntimeFailure.unsafeScratch }
            let fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { throw NymPublicRuntimeFailure.unsafeScratch }; return fd
        }
        do {
            var info = stat(), path = [CChar](repeating: 0, count: Int(PATH_MAX))
            guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
                  info.st_mode & 0o7777 == 0o700, fcntl(fd, F_GETPATH, &path) == 0 else { throw NymPublicRuntimeFailure.unsafeScratch }
            let value = path.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
            let url = value.withCString { URL(fileURLWithFileSystemRepresentation: $0, isDirectory: true, relativeTo: nil) }
            guard url.path == value else { throw NymPublicRuntimeFailure.unsafeScratch }
            return .init(url: url, descriptor: fd, information: info)
        } catch { Darwin.close(fd); throw error }
    }
    private func components(_ relative: String) throws -> [String] {
        let pieces = relative.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !pieces.isEmpty, pieces.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("\0") }) else { throw NymPublicRuntimeFailure.unsafeScratch }
        return pieces
    }
    private func directory(_ pieces: [String], create: Bool) throws -> Int32 {
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_dev == device, info.st_ino == inode,
              info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700 else { throw NymPublicRuntimeFailure.unsafeScratch }
        var fd = dup(descriptor); guard fd >= 0 else { throw NymPublicRuntimeFailure.unsafeScratch }
        do {
            for piece in pieces {
                if create, mkdirat(fd, piece, 0o700) != 0, errno != EEXIST { throw NymPublicRuntimeFailure.unsafeScratch }
                let next = openat(fd, piece, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard next >= 0 else { throw NymPublicRuntimeFailure.unsafeScratch }
                Darwin.close(fd); fd = next
                guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
                      info.st_mode & 0o7777 == 0o700 else { throw NymPublicRuntimeFailure.unsafeScratch }
            }
            return fd
        } catch { Darwin.close(fd); throw error }
    }
    func makeDirectory(_ relative: String) throws {
        let fd = try directory(components(relative), create: true); Darwin.close(fd)
    }
    func writeNew(_ bytes: Data, relative: String) throws {
        guard bytes.count <= 1_048_576 else { throw NymPublicRuntimeFailure.unsafeScratch }
        let pieces = try components(relative), dir = try directory(Array(pieces.dropLast()), create: false)
        defer { Darwin.close(dir) }
        let fd = openat(dir, pieces.last!, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw NymPublicRuntimeFailure.unsafeScratch }; defer { Darwin.close(fd) }
        try bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw NymPublicRuntimeFailure.unsafeScratch }; offset += count
            }
        }
        guard fsync(fd) == 0, fsync(dir) == 0 else { throw NymPublicRuntimeFailure.unsafeScratch }
    }
    func read(_ relative: String, limit: Int) throws -> Data {
        let pieces = try components(relative), dir = try directory(Array(pieces.dropLast()), create: false)
        defer { Darwin.close(dir) }
        guard ["config.toml", "public_identity.pem"].contains(pieces.last!) else { throw NymPublicRuntimeFailure.unsafeProfile }
        let fd = openat(dir, pieces.last!, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw NymPublicRuntimeFailure.unsafeProfile }; defer { Darwin.close(fd) }
        var before = stat(), after = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG, before.st_uid == getuid(),
              before.st_nlink == 1, before.st_mode & 0o777 == 0o600, before.st_size >= 0, before.st_size <= limit else { throw NymPublicRuntimeFailure.unsafeProfile }
        let bytes = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).read(upToCount: limit + 1) ?? Data()
        guard bytes.count == before.st_size, fstat(fd, &after) == 0, before.st_dev == after.st_dev,
              before.st_ino == after.st_ino, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else { throw NymPublicRuntimeFailure.unsafeProfile }
        return bytes
    }
    /// Metadata only: never opens or hashes private/ack key contents.
    func metadata(_ relative: String) throws -> String {
        let pieces = try components(relative), dir = try directory(Array(pieces.dropLast()), create: false)
        defer { Darwin.close(dir) }
        var info = stat()
        guard fstatat(dir, pieces.last!, &info, AT_SYMLINK_NOFOLLOW) == 0,
              info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(), info.st_nlink == 1,
              info.st_mode & 0o7777 == 0o600, info.st_size > 0 else { throw NymPublicRuntimeFailure.unsafeProfile }
        return "\(info.st_dev):\(info.st_ino):\(info.st_uid):\(info.st_gid):\(info.st_mode):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec)"
    }
    func path(_ relative: String) -> URL { url.appendingPathComponent(relative) }
    deinit { Darwin.close(descriptor) } // Retain profile/UNKNOWN records; never delete them on stop.
}

/// Fixed 331 final-config observations from the original owned process. This is
/// bootstrap evidence only: no remote connection, HTTPS, or route qualification.
final class NymPublicRuntimeConfiguration {
    private let providerSHA256: String
    private let port: UInt16
    private var partial = [Data(), Data()]
    private var overlong = [false, false]
    private var consumed = false, listener = false, appliedProvider = false
    private(set) var rejected = false
    init(provider: String, port: UInt16) {
        providerSHA256 = SHA256.hash(data: Data(provider.utf8)).map { String(format: "%02x", $0) }.joined()
        self.port = port
    }
    var observed: Bool { !rejected && consumed && listener && appliedProvider }
    func append(_ bytes: Data, stdout: Bool) {
        let index = stdout ? 0 : 1
        for byte in bytes {
            if byte == 10 {
                if !overlong[index] { line(String(decoding: partial[index], as: UTF8.self)) }
                partial[index].removeAll(keepingCapacity: true); overlong[index] = false
            } else if partial[index].count < 4096 && !overlong[index] { partial[index].append(byte) }
            else { partial[index].removeAll(keepingCapacity: true); overlong[index] = true; rejected = true }
        }
    }
    private func line(_ raw: String) {
        let text = raw.replacingOccurrences(of: "\u{001B}\\[[0-9;]*m", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // The pinned logger emits timestamp/level/source:line. Reject arbitrary
        // messages from a different callee rather than suffix-matching them.
        guard let boundary = text.range(of: #"^\S+\s+INFO\s+(?:common|clients)/[A-Za-z0-9_./-]+\.rs:[0-9]+: "#, options: .regularExpression) else { return }
        let prefix = String(text[..<boundary.upperBound]), message = String(text[boundary.upperBound...])
        if prefix.contains("clients/socks5/src/commands/run.rs:") && message.hasPrefix("YNX runtime contract ") {
            let label = "YNX runtime contract ynx-mixnet-v1 applied; provider="
            if message.hasPrefix(label) {
                let actual = Data(message.dropFirst(label.count).utf8)
                let digest = SHA256.hash(data: actual).map { String(format: "%02x", $0) }.joined()
                if digest == providerSHA256 { appliedProvider = true } else { rejected = true }
            } else { rejected = true }
        }
        guard prefix.contains("common/socks5-client-core/src/lib.rs:") else { return }
        if message.hasPrefix("YNX_CONSUMED_CONFIG ") {
            if message == "YNX_CONSUMED_CONFIG anon=true credentials_enabled=false dkg_client_created=false bind=127.0.0.1:\(port) packet=Mix poisson_disabled=false loop_cover_disabled=false per_hop_ms=15 send_ms=20 cover_ms=200" { consumed = true }
            else { rejected = true }
        }
        if message.hasPrefix("YNX_LISTENER_CONFIG ") {
            if message == "YNX_LISTENER_CONFIG anon=true bind=127.0.0.1:\(port) connection_start_surbs=20 per_request_surbs=3 packet=Mix provider_interface={\"type\":\"Versioned\",\"version\":3} socks_protocol={\"type\":\"Versioned\",\"version\":3}" { listener = true }
            else { rejected = true }
        }
    }
}

/// Bounded stdout and independently observed EOF/termination. Runtime logs are discarded
/// after the original official marker; no identity/address/packet bytes are persisted.
final class NymPublicProcessOutput: @unchecked Sendable {
    private let lock = NSLock()
    private let limit: Int
    private let captureDirectoryStderr: Bool
    private var directoryStderr = Data()
    private var bytes = Data(), overflowed = false, outEOF = false, errEOF = false
    private var exit: (pid: Int32, code: Int32, signal: Int32?)?
    private var markers: [NymObservedStartupLine] = []
    private var configuration: NymPublicRuntimeConfiguration?
    private var bootstrapCaptureBytes = 0
    init(limit: Int, gateway: String? = nil, provider: String? = nil, captureDirectoryStderr: Bool = false) {
        self.limit = limit; self.captureDirectoryStderr = captureDirectoryStderr
        if let gateway { markers = [NymObservedStartupLine(expectedGatewayIdentity: gateway), NymObservedStartupLine(expectedGatewayIdentity: gateway)] }
        configuration = provider.map { NymPublicRuntimeConfiguration(provider: $0, port: NymPublicSearchRole.port) }
    }
    func append(_ data: Data, stdout: Bool) {
        lock.lock(); defer { lock.unlock() }
        if data.isEmpty { if stdout { outEOF = true } else { errEOF = true }; return }
        if !markers.isEmpty {
            let previouslyObserved = markers.contains { $0.observedLineSHA256 != nil } && configuration?.observed == true
            if !previouslyObserved {
                guard data.count <= limit - bootstrapCaptureBytes else { overflowed = true; return }
                bootstrapCaptureBytes += data.count
            }
            configuration?.append(data, stdout: stdout)
            markers[stdout ? 0 : 1].append(data)
            if markers.contains(where: { $0.observedLineSHA256 != nil }) && configuration?.observed == true { bytes.removeAll(keepingCapacity: false); return }
        }
        guard stdout else {
            if captureDirectoryStderr {
                guard directoryStderr.count + data.count <= 524_288 else { overflowed = true; return }
                directoryStderr.append(data)
            }
            return
        }
        if bytes.count + data.count > limit { overflowed = true; return }
        bytes.append(data)
    }
    func terminated(pid: Int32, code: Int32, signal: Int32?) {
        lock.lock(); exit = (pid, code, signal); lock.unlock()
    }
    var exceeded: Bool { lock.lock(); defer { lock.unlock() }; return overflowed }
    var configurationRejected: Bool { lock.lock(); defer { lock.unlock() }; return configuration?.rejected == true }
    var bootstrapObserved: Bool { lock.lock(); defer { lock.unlock() }; return markers.contains { $0.observedLineSHA256 != nil } && configuration?.observed == true && !overflowed }
    func receipt(expectedPID: Int32) -> NymPublicObservedExit? {
        lock.lock(); defer { lock.unlock() }
        guard let exit, exit.pid == expectedPID, outEOF, errEOF else { return nil }
        return .init(pid: exit.pid, code: exit.code, signal: exit.signal, childReaped: true)
    }
    func completedBytes(expectedPID: Int32) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        guard let exit, exit.pid == expectedPID, outEOF, errEOF else { throw NymPublicRuntimeFailure.outputIncomplete }
        guard !overflowed else { throw NymPublicRuntimeFailure.outputLimit }
        guard exit.code == 0, exit.signal == nil else { throw NymPublicRuntimeFailure.childExited }; return bytes
    }
    func completedDirectoryCapture(expectedPID: Int32) throws -> (Data, Data) {
        let stdout = try completedBytes(expectedPID: expectedPID)
        lock.lock(); defer { lock.unlock() }
        guard captureDirectoryStderr, !overflowed else { throw NymPublicRuntimeFailure.outputIncomplete }
        return (stdout, directoryStderr)
    }
}

/// Original direct Foundation child only. This conveys no NE/Root permission.
@MainActor final class NymPublicOwnedProcess {
    let process = Process()
    let output: NymPublicProcessOutput
    private let stdout = Pipe(), stderr = Pipe()
    private(set) var originalPID: Int32?
    private(set) var descriptorsClosed = false
    private(set) var forcedStop = false
    init(limit: Int, gateway: String? = nil, provider: String? = nil, captureDirectoryStderr: Bool = false) {
        output = .init(limit: limit, gateway: gateway, provider: provider, captureDirectoryStderr: captureDirectoryStderr)
    }
    func launch(executable: URL, arguments: [String], environment: [String: String],
                onTermination: (@Sendable () -> Void)? = nil) throws {
        guard originalPID == nil, !descriptorsClosed else { throw NymPublicRuntimeFailure.alreadyAttempted }
        process.executableURL = executable; process.arguments = arguments; process.environment = environment
        process.standardInput = FileHandle.nullDevice; process.standardOutput = stdout; process.standardError = stderr
        let collector = output
        process.terminationHandler = { child in
            collector.terminated(pid: child.processIdentifier, code: child.terminationStatus,
                signal: child.terminationReason == .uncaughtSignal ? child.terminationStatus : nil)
            onTermination?()
        }
        stdout.fileHandleForReading.readabilityHandler = { handle in collector.append(handle.availableData, stdout: true) }
        stderr.fileHandleForReading.readabilityHandler = { handle in collector.append(handle.availableData, stdout: false) }
        do { try process.run(); originalPID = process.processIdentifier }
        catch { try? closeDescriptors(); throw error }
        // The child owns duplicates. The original parent writer ends must not keep EOF alive.
        try stdout.fileHandleForWriting.close(); try stderr.fileHandleForWriting.close()
    }
    var isRunning: Bool { originalPID != nil && process.isRunning }
    var receipt: NymPublicObservedExit? {
        guard let originalPID, !process.isRunning else { return nil }; return output.receipt(expectedPID: originalPID)
    }
    func closeDescriptors() throws {
        guard !descriptorsClosed else { return }
        stdout.fileHandleForReading.readabilityHandler = nil; stderr.fileHandleForReading.readabilityHandler = nil
        try stdout.fileHandleForReading.close(); try stderr.fileHandleForReading.close()
        descriptorsClosed = true
    }
    func stop() async -> Bool {
        if process.isRunning { process.interrupt() }
        let grace = ContinuousClock.now.advanced(by: .seconds(12))
        while process.isRunning, ContinuousClock.now < grace { await Self.pause() }
        if process.isRunning { forcedStop = true; Darwin.kill(process.processIdentifier, SIGKILL) }
        let end = ContinuousClock.now.advanced(by: .seconds(3))
        while originalPID != nil, receipt == nil, ContinuousClock.now < end { await Self.pause() }
        guard originalPID == nil || receipt != nil else { return false }
        do { try closeDescriptors(); return descriptorsClosed } catch { return false }
    }
    private static func pause() async { await Task.detached { try? await Task.sleep(for: .milliseconds(25)) }.value }
}

/// Path updates and process termination may arrive before the MainActor can
/// retire the page. Record the first failure before scheduling that callback.
final class NymPublicRouteFence: @unchecked Sendable {
    private let lock = NSLock()
    private var initialPath = false
    private var closed = false
    private var recorded: NymPublicRuntimeFailure?
    @MainActor private var delivered = false
    private let onLoss: @MainActor (NymPublicRuntimeFailure) -> Void

    @MainActor init(onLoss: @escaping @MainActor (NymPublicRuntimeFailure) -> Void) {
        self.onLoss = onLoss
    }
    var failure: NymPublicRuntimeFailure? {
        lock.withLock { recorded }
    }
    var hasUsablePath: Bool {
        lock.withLock { initialPath && recorded == nil && !closed }
    }
    func observePath(available: Bool) {
        let changed = lock.withLock {
            guard !closed, recorded == nil else { return false }
            if available && !initialPath {
                initialPath = true
                return false
            }
            recorded = available ? .networkChanged : .networkUnavailable
            return true
        }
        if changed { scheduleDelivery() }
    }
    func revoke(_ failure: NymPublicRuntimeFailure) {
        let changed = lock.withLock {
            guard !closed, recorded == nil else { return false }
            recorded = failure
            return true
        }
        if changed { scheduleDelivery() }
    }
    func close() { lock.withLock { closed = true } }
    private func scheduleDelivery() {
        Task { @MainActor [weak self] in self?.deliverIfNeeded() }
    }
    @MainActor func deliverIfNeeded() {
        guard !delivered, let failure = lock.withLock({ closed ? nil : recorded }) else { return }
        delivered = true
        onLoss(failure)
    }
}

/// A once-only fresh PUBLIC vendor operation. Pinned 6dce directory DATA and 331
/// official-overlay runtime are separate; no normal qualification is adopted.
@MainActor final class NymPublicSearchRuntime {
    private enum Role {
        case fixedPublic, interactive

        var cohort: NymPublicExecutableSupply.Cohort {
            switch self {
            case .fixedPublic: .fixedPublic
            case .interactive: .interactive
            }
        }

        var signingIdentifier: String {
            switch self {
            case .fixedPublic: NymPublicSearchRole.identifier
            case .interactive: NymInteractiveRouteRole.identifier
            }
        }

        func require(_ bundle: Bundle) throws {
            switch self {
            case .fixedPublic: try NymPublicSearchRole.require(bundle)
            case .interactive: try NymInteractiveRouteRole.require(bundle)
            }
        }
    }

    enum Stage: String { case idle, supply, scratch, directory, initialize, gatewayReadback, bootstrap, running, stopping, stopped, unknown }
    private(set) var stage: Stage = .idle
    private(set) var firstFailure: NymPublicRuntimeFailure?
    private(set) var firstStage: Stage?
    private(set) var diagnosticDirectory: URL?
    private(set) var originalBackendPID: Int32?
    /// Observation only; no admission or liveness permit is derived from a PID.
    var processIdentifier: Int32? { runtime?.originalPID }
    private(set) var selectionEpoch: UInt64?
    private(set) var storageOutcomeUnknown = false
    private(set) var forcedStop = false
    private let bundle: Bundle
    private let role: Role
    private let onRouteLoss: (@MainActor (NymPublicRuntimeFailure) -> Void)?
    private lazy var routeFence = NymPublicRouteFence { [weak self] in self?.deliverRouteLoss($0) }
    private var pathMonitor: NWPathMonitor?
    private var powerObservers: [NSObjectProtocol] = []
    private var deadlineWatchdog: Task<Void, Never>?
    private let worker = NymStartupOperation()
    private var children: [NymPublicOwnedProcess] = []
    private var runtime: NymPublicOwnedProcess?
    private var scratch: NymPublicScratch?
    private var lease: NymProfileLease?
    private var supply: NymPublicExecutableSupply?
    private var initializedPins: [String: String]?
    private var profileID: String?
    private var validUntil: Date?
    private var networkDeadline: Date?
    private var networkMonotonicDeadline: ContinuousClock.Instant?
    private var attempted = false, stopping = false
    private var generation = UUID()
    private var shutdownTask: Task<Bool, Never>?
    init(bundle: Bundle = .main, onRouteLoss: (@MainActor (NymPublicRuntimeFailure) -> Void)? = nil) {
        self.bundle = bundle; self.role = .fixedPublic; self.onRouteLoss = onRouteLoss
    }
    init(interactiveBundle: Bundle, onRouteLoss: (@MainActor (NymPublicRuntimeFailure) -> Void)? = nil) {
        self.bundle = interactiveBundle; self.role = .interactive; self.onRouteLoss = onRouteLoss
    }
    var cleanupConfirmed: Bool {
        !worker.isRunning && shutdownTask == nil && lease == nil && children.isEmpty && runtime == nil
    }
    func start() async throws -> PrivacyRouteEndpoint {
        try role.require(bundle)
        guard !attempted, !stopping, children.isEmpty else { throw NymPublicRuntimeFailure.alreadyAttempted }
        attempted = true; let expected = generation
        do { return try await worker.run { [self] in try await performStart(expected) } }
        catch {
            let fallback: NymPublicRuntimeFailure
            switch stage {
            case .supply: fallback = .supplyRejected
            case .directory: fallback = .directoryFailed
            case .initialize: fallback = .initializationUnknown
            case .gatewayReadback: fallback = .gatewayMismatch
            default: fallback = .bootstrapFailed
            }
            record(error as? NymPublicRuntimeFailure ?? fallback)
            _ = await stop(); throw error
        }
    }
    private func require(_ expected: UUID) throws {
        if let failure = routeFence.failure {
            routeFence.deliverIfNeeded()
            throw failure
        }
        try Task.checkCancellation()
        guard !stopping, generation == expected else { throw NymPublicRuntimeFailure.cancelled }
        if let validUntil, Date().timeIntervalSince(validUntil) >= 0 { throw NymPublicRuntimeFailure.staleDirectory }
        if let networkDeadline, Date().timeIntervalSince(networkDeadline) >= 0 { throw NymPublicRuntimeFailure.timedOut }
        if let networkMonotonicDeadline, ContinuousClock.now >= networkMonotonicDeadline { throw NymPublicRuntimeFailure.timedOut }
    }
    private func performStart(_ expected: UUID) async throws -> PrivacyRouteEndpoint {
        try require(expected); stage = .supply
        _ = try Self.packageIdentity(bundle, role: role) // Strict role-specific package identity before supply I/O.
        let supply = try NymPublicExecutableSupply.load(bundle: bundle, cohort: role.cohort)
        self.supply = supply
        installRouteMonitor()
        let pathDeadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !routeFence.hasUsablePath {
            try require(expected)
            guard ContinuousClock.now < pathDeadline else { try loseRoute(.networkUnavailable) }
            try await Task.sleep(for: .milliseconds(25))
        }
        try require(expected)
        stage = .scratch
        let scratch = try NymPublicScratch.create(); self.scratch = scratch; diagnosticDirectory = scratch.url
        try scratch.makeDirectory("Home")
        lease = try NymProfileLease(url: scratch.path(".public-operation.lock"))
        stage = .directory
        let captured = try await directory(scratch: scratch, expected: expected)
        let latest = captured.latest, selection = try captured.select()
        selectionEpoch = selection.epoch; validUntil = selection.validUntil
        let endpoint = try Self.gatewayEndpoint(latest: latest, selection: selection)
        let endpoints = Self.bootstrapEndpoints + [endpoint]
        try require(expected)
        let id = "ynx-route-bundled-" + UUID().uuidString.lowercased(); profileID = id
        let root = Self.relativeProfile(id)
        try scratch.makeDirectory(root + "/config"); try scratch.makeDirectory(root + "/data")
        stage = .initialize
        // Fsynced immutable UNKNOWN precedes the first possible registration effect. No retry,
        // recovery flag, key copy or second init is available on this operation object.
        try scratch.writeNew(try JSONSerialization.data(withJSONObject: ["purpose": "fixed-public-nym-search", "profileID": id,
            "operation": UUID().uuidString.lowercased(), "state": "UNKNOWN"], options: [.sortedKeys]), relative: "init-unknown.json")
        storageOutcomeUnknown = true
        let initialized = try await auxiliary(scratch: scratch, arguments: ["init", "--id", id, "--provider", selection.requester,
            "--gateway", selection.entryIdentity, "--host", "127.0.0.1", "--port", String(NymPublicSearchRole.port),
            "--force-tls-gateway", "--enabled-credentials-mode", "false", "--use-reply-surbs", "true", "--output", "json"],
            selection: selection, endpoints: endpoints, limit: 65_536, seconds: 100, expected: expected)
        guard let result = try JSONSerialization.jsonObject(with: initialized) as? [String: Any],
              result["id"] as? String == id, result["gateway_id"] as? String == selection.entryIdentity,
              result["version"] as? String == NymRouteDependency.clientVersion, result["fallback_listener"] is NSNull else { throw NymPublicRuntimeFailure.initializationUnknown }
        let pins = try Self.profilePins(scratch: scratch, id: id)
        try Self.validateConfig(try scratch.read(root + "/config/config.toml", limit: 1_048_576), id: id, root: scratch.path(root))
        try scratch.writeNew(try JSONSerialization.data(withJSONObject: ["profileID": id, "pins": pins,
            "officialInitExited": true, "originalChildReaped": true], options: [.sortedKeys]), relative: "init-complete.json")
        initializedPins = pins; storageOutcomeUnknown = false
        stage = .gatewayReadback
        let registered = try await auxiliary(scratch: scratch, arguments: ["list-gateways", "--id", id, "--output", "json"],
            selection: selection, endpoints: endpoints, limit: 1_048_576, seconds: 30, expected: expected)
        let gateway = try NymModeGatewayState.decode(registered, expectedIdentity: selection.entryIdentity)
        try gateway.validateEndpoint(host: endpoint.host, port: endpoint.port)
        guard gateway.active else { throw NymPublicRuntimeFailure.gatewayMismatch }
        // Exactly the first current pair remains fixed. No add/switch/exit rotation is needed
        // or exposed for a fresh profile, regardless of a later website response.
        try require(expected)
        guard try Self.profilePins(scratch: scratch, id: id) == pins else { throw NymPublicRuntimeFailure.identityChanged }
        stage = .bootstrap
        let flags = try policyFlags(scratch: scratch, selection: selection, endpoints: endpoints)
        let child = NymPublicOwnedProcess(limit: 131_072, gateway: selection.entryIdentity, provider: selection.requester)
        runtime = child; children.append(child) // Adopt before launch or suspension.
        let fence = routeFence
        try child.launch(executable: supply.executable, arguments: flags + ["run", "--ynx-runtime-contract", "ynx-protected-numeric-v2",
            "--id", id, "--provider", selection.requester, "--host", "127.0.0.1", "--port", String(NymPublicSearchRole.port),
            "--use-anonymous-replies", "true", "--enabled-credentials-mode", "false"], environment: environment(scratch),
            onTermination: { fence.revoke(.childExited) })
        originalBackendPID = child.originalPID
        if let expiry = networkMonotonicDeadline {
            deadlineWatchdog = Task {
                do { try await ContinuousClock().sleep(until: expiry) } catch { return }
                if !Task.isCancelled { fence.revoke(.timedOut) }
            }
        }
        let end = ContinuousClock.now.advanced(by: .seconds(110))
        while !child.output.bootstrapObserved {
            try require(expected)
            guard child.isRunning else { throw NymPublicRuntimeFailure.childExited }
            guard !child.output.configurationRejected else { throw NymPublicRuntimeFailure.bootstrapFailed }
            guard !child.output.exceeded else { throw NymPublicRuntimeFailure.outputLimit }
            guard ContinuousClock.now < end else { throw NymPublicRuntimeFailure.timedOut }
            try await Task.sleep(for: .milliseconds(50))
        }
        try require(expected)
        guard child.isRunning else { try loseRoute(.childExited) }
        stage = .running
        try requireBootstrapLive()
        return try PrivacyRouteEndpoint(port: NymPublicSearchRole.port)
    }
    func requireBootstrapLive() throws {
        if let failure = routeFence.failure {
            routeFence.deliverIfNeeded()
            throw failure
        }
        guard !stopping, stage == .running, let runtime else { throw NymPublicRuntimeFailure.childExited }
        guard runtime.isRunning else { try loseRoute(.childExited) }
        guard !runtime.output.configurationRejected, runtime.output.bootstrapObserved else { try loseRoute(.bootstrapFailed) }
        guard let validUntil, Date().timeIntervalSince(validUntil) < 0 else { try loseRoute(.staleDirectory) }
        guard let networkDeadline, Date().timeIntervalSince(networkDeadline) < 0,
              let networkMonotonicDeadline, ContinuousClock.now < networkMonotonicDeadline else { try loseRoute(.timedOut) }
        if let failure = routeFence.failure {
            routeFence.deliverIfNeeded()
            throw failure
        }
    }
    private func installRouteMonitor() {
        let fence = routeFence
        let monitor = NWPathMonitor(); pathMonitor = monitor
        monitor.pathUpdateHandler = { path in fence.observePath(available: path.status == .satisfied) }
        monitor.start(queue: DispatchQueue(label: "com.ynx.browser.nym-public-path"))
        let notifications: [(Notification.Name, NymPublicRuntimeFailure)] = [
            (NSWorkspace.willSleepNotification, .systemSleep), (NSWorkspace.didWakeNotification, .systemWake)
        ]
        for (name, failure) in notifications {
            powerObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: nil) { _ in
                fence.revoke(failure)
            })
        }
    }
    private func loseRoute(_ failure: NymPublicRuntimeFailure) throws -> Never {
        routeFence.revoke(failure)
        routeFence.deliverIfNeeded()
        throw routeFence.failure ?? failure
    }
    private func deliverRouteLoss(_ failure: NymPublicRuntimeFailure) {
        guard !stopping else { return }
        record(failure)
        fenceRoute()
        onRouteLoss?(failure) // The controller synchronously retires its page before stop/reap.
        Task { @MainActor [self] in _ = await stop() }
    }
    private func fenceRoute() {
        stopping = true; generation = UUID(); worker.cancel()
        routeFence.close()
        pathMonitor?.cancel(); pathMonitor = nil
        deadlineWatchdog?.cancel(); deadlineWatchdog = nil
        for observer in powerObservers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        powerObservers.removeAll()
    }
    func stop() async -> Bool {
        if let shutdownTask { return await shutdownTask.value }
        if stopping && cleanupConfirmed { return true }
        fenceRoute()
        let task = Task { @MainActor [self] () -> Bool in
            defer { shutdownTask = nil }
            // Terminate a slow official operation before joining its worker, which is waiting
            // for that same original child. Never self-join inside performStart.
            for child in children.reversed() { _ = await child.stop() }
            await worker.join()
            for child in children.reversed() {
                guard await child.stop(), child.originalPID == nil || child.receipt != nil else {
                    stage = .unknown; record(.cleanupUnknown); return false
                }
                forcedStop = forcedStop || child.forcedStop
            }
            if let scratch, let id = profileID, let initializedPins {
                guard (try? Self.profilePins(scratch: scratch, id: id)) == initializedPins else {
                    stage = .unknown; storageOutcomeUnknown = true; record(.identityChanged); return false
                }
            }
            // No profile/database deletion or implicit resumption after forced stop/UNKNOWN.
            children.removeAll(); runtime = nil; lease?.release(); lease = nil; stage = .stopped
            return true
        }
        shutdownTask = task
        return await task.value
    }
    private func directory(scratch: NymPublicScratch, expected: UUID) async throws -> NymPublicDirectorySnapshot {
        try require(expected)
        guard let supply else { throw NymPublicRuntimeFailure.supplyRejected }
        let run = "qa-dir-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let issued = UInt64(Date().timeIntervalSince1970), expires = issued + 120
        let plan = try JSONSerialization.data(withJSONObject: ["schema": "YNX_NYM_QA_CDN_DIRECTORY_V1",
            "purpose": "fresh-complete-directory-only", "runID": run, "issuedAt": issued, "expiresAt": expires,
            "networkDefaultsSHA256": Self.bootstrapSourceSHA256, "origin": "https://cdn1.media-platform.net",
            "addresses": ["172.104.178.252"]], options: [.sortedKeys])
        let name = "directory-" + run + ".json"; try scratch.writeNew(plan, relative: name)
        try setNetworkDeadline(Date(timeIntervalSince1970: Double(expires)))
        let child = NymPublicOwnedProcess(limit: 16_777_217, captureDirectoryStderr: true)
        children.append(child)
        try child.launch(executable: supply.directory, arguments: ["--no-banner", "ynx-qa-cdn-directory",
            "--plan", scratch.path(name).path, "--plan-sha256", Self.hash(plan), "--run-id", run], environment: environment(scratch))
        let end = ContinuousClock.now.advanced(by: .seconds(120))
        while child.receipt == nil {
            try require(expected)
            guard !child.output.exceeded else { throw NymPublicRuntimeFailure.outputLimit }
            guard ContinuousClock.now < end else { throw NymPublicRuntimeFailure.timedOut }
            try await Task.sleep(for: .milliseconds(25))
        }
        guard let pid = child.originalPID else { throw NymPublicRuntimeFailure.childExited }
        let (stdout, stderr) = try child.output.completedDirectoryCapture(expectedPID: pid)
        guard await child.stop() else { throw NymPublicRuntimeFailure.cleanupUnknown }
        try require(expected)
        let value = try NymPublicDirectorySnapshot.decode(stdout: stdout, stderr: stderr, runID: run,
            expires: Date(timeIntervalSince1970: Double(expires)))
        networkDeadline = nil; networkMonotonicDeadline = nil
        return value
    }
    private func auxiliary(scratch: NymPublicScratch, arguments: [String], selection: NymPublicDirectorySelection?,
                           endpoints: [NymReviewedNetworkPolicy.Endpoint], limit: Int, seconds: Double, expected: UUID) async throws -> Data {
        try require(expected)
        guard let supply else { throw NymPublicRuntimeFailure.supplyRejected }
        let flags = try policyFlags(scratch: scratch, selection: selection, endpoints: endpoints)
        let child = NymPublicOwnedProcess(limit: limit); children.append(child)
        try child.launch(executable: supply.executable, arguments: flags + arguments, environment: environment(scratch))
        let end = ContinuousClock.now.advanced(by: .milliseconds(Int64(seconds * 1000)))
        while child.receipt == nil {
            try require(expected)
            guard !child.output.exceeded else { throw NymPublicRuntimeFailure.outputLimit }
            guard ContinuousClock.now < end else { throw NymPublicRuntimeFailure.timedOut }
            try await Task.sleep(for: .milliseconds(25))
        }
        guard let pid = child.originalPID else { throw NymPublicRuntimeFailure.childExited }
        let bytes = try child.output.completedBytes(expectedPID: pid)
        guard await child.stop() else { throw NymPublicRuntimeFailure.cleanupUnknown }
        try require(expected); return bytes
    }
    private func policyFlags(scratch: NymPublicScratch, selection: NymPublicDirectorySelection?, endpoints: [NymReviewedNetworkPolicy.Endpoint]) throws -> [String] {
        let runID = UUID().uuidString.lowercased(), now = UInt64(Date().timeIntervalSince1970)
        let policy = NymReviewedNetworkPolicy(runID: runID, stage: selection == nil ? "directory-bootstrap" : "route-runtime",
            issuedAt: now, expiresAt: selection.map { min(now + 110, UInt64($0.validUntil.timeIntervalSince1970)) } ?? now + 110,
            directoryEpoch: selection?.epoch, directorySHA256: selection.map { [$0.basicSHA256, $0.describedSHA256, $0.epochSHA256] },
            entryIdentity: selection?.entryIdentity, bootstrapSourceSHA256: selection == nil ? Self.bootstrapSourceSHA256 : nil, endpoints: endpoints)
        let bytes = try policy.bytes(), name = "network-" + runID + ".json"
        try scratch.writeNew(bytes, relative: name)
        try setNetworkDeadline(Date(timeIntervalSince1970: Double(policy.expiresAt)))
        return ["--no-banner", "--ynx-reviewed-network", scratch.path(name).path,
                "--ynx-reviewed-network-sha256", Self.hash(bytes), "--ynx-reviewed-run-id", runID]
    }
    private func environment(_ scratch: NymPublicScratch) -> [String: String] {
        var result = ["PATH": "/usr/bin:/bin", "NYM_HOME_DIR": scratch.path("Home").path, "RUST_LOG": "info", "NO_COLOR": "1"]
        if let home = ProcessInfo.processInfo.environment["HOME"] { result["HOME"] = home }
        return result
    }
    private func setNetworkDeadline(_ expiry: Date) throws {
        let started = ContinuousClock.now
        let remaining = expiry.timeIntervalSinceNow
        guard remaining > 0, remaining <= 120 else { throw NymPublicRuntimeFailure.timedOut }
        networkDeadline = expiry
        networkMonotonicDeadline = started.advanced(by: .nanoseconds(Int64(remaining * 1_000_000_000)))
    }
    private func record(_ failure: NymPublicRuntimeFailure) {
        if firstFailure == nil { firstFailure = failure; firstStage = stage }
    }
    static let bootstrapSourceSHA256 = "596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b"
    static var bootstrapEndpoints: [NymReviewedNetworkPolicy.Endpoint] {
        [.init(purpose: "directoryHTTPS", scheme: "https", host: "validator.nymtech.net", port: 443, addresses: ["92.39.63.14"]),
         .init(purpose: "chainRPC", scheme: "https", host: "rpc.nymtech.net", port: 443,
               addresses: ["194.182.169.49", "91.92.200.116", "2a04:c43:e00:6f28:400:d8ff:fe00:1483", "2a04:c46:e00:6f28:4b3:68ff:fe00:460"])]
    }
    static func gatewayEndpoint(latest: NymLatestDirectoryInput, selection: NymPublicDirectorySelection) throws -> NymReviewedNetworkPolicy.Endpoint {
        guard let basic = try JSONSerialization.jsonObject(with: latest.basic) as? [String: Any], let page = basic["nodes"] as? [String: Any],
              let rows = page["data"] as? [[String: Any]], let described = try JSONSerialization.jsonObject(with: latest.described) as? [String: Any],
              let details = described["data"] as? [[String: Any]] else { throw NymPublicRuntimeFailure.invalidNumericPlan }
        let entries = rows.filter { $0["ed25519_identity_pubkey"] as? String == selection.entryIdentity }
        guard entries.count == 1, let node = entries.first, let id = node["node_id"] as? UInt32,
              let roles = node["supported_roles"] as? [String: Bool], roles["entry"] == true,
              let entry = node["entry"] as? [String: Any], let host = entry["hostname"] as? String, let port = entry["wss_port"] as? UInt16,
              let ips = node["ip_addresses"] as? [String], !ips.isEmpty, ips.allSatisfy(NymNumericBootstrapPlan.numeric) else { throw NymPublicRuntimeFailure.invalidNumericPlan }
        let matches = details.filter { $0["node_id"] as? UInt32 == id }
        guard matches.count == 1, let d = matches[0]["description"] as? [String: Any], let h = d["host_information"] as? [String: Any],
              let keys = h["keys"] as? [String: Any], keys["ed25519"] as? String == selection.entryIdentity,
              h["hostname"] as? String == host, let describedIPs = h["ip_address"] as? [String], Set(ips) == Set(describedIPs),
              let sockets = d["mixnet_websockets"] as? [String: Any], sockets["wss_port"] as? UInt16 == port,
              sockets["ws_port"] as? UInt16 == entry["ws_port"] as? UInt16 else { throw NymPublicRuntimeFailure.invalidNumericPlan }
        return .init(purpose: "gatewayWSS", scheme: "wss", host: host, port: port, addresses: ips)
    }
    static func relativeProfile(_ id: String) -> String { "Home/.nym/socks5-clients/" + id }
    static func profilePins(scratch: NymPublicScratch, id: String) throws -> [String: String] {
        let root = relativeProfile(id)
        let files = ["config/config.toml", "data/private_identity.pem", "data/public_identity.pem", "data/private_encryption.pem", "data/public_encryption.pem", "data/ack_key.pem"]
        return try Dictionary(uniqueKeysWithValues: files.map { name in
            let metadata = try scratch.metadata(root + "/" + name)
            if name == "config/config.toml" || name == "data/public_identity.pem" {
                return (name, metadata + ":public-sha256:" + hash(try scratch.read(root + "/" + name, limit: 1_048_576)))
            }
            return (name, metadata) // Private/ack material is never opened or hashed here.
        })
    }
    static func validateConfig(_ bytes: Data, id: String, root: URL) throws {
        guard let text = String(data: bytes, encoding: .utf8), !text.contains("'''"), !text.contains("\"\"\"") else { throw NymPublicRuntimeFailure.unsafeProfile }
        let names = ["keys.private_identity_key_file": "private_identity.pem", "keys.public_identity_key_file": "public_identity.pem",
            "keys.private_encryption_key_file": "private_encryption.pem", "keys.public_encryption_key_file": "public_encryption.pem", "keys.ack_key_file": "ack_key.pem",
            "credentials_database": "credentials_database.db", "credential_requests_database": "credential_requests.db", "reply_surb_database": "persistent_reply_store.sqlite",
            "gateway_registrations": "gateways_registrations.sqlite"]
        var section = "", found = Set<String>(), matchedID = false
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("[") { section = line; continue }
            guard let split = line.firstIndex(of: "=") else { continue }
            let key = line[..<split].trimmingCharacters(in: .whitespaces), value = line[line.index(after: split)...].trimmingCharacters(in: .whitespaces)
            if section == "[storage_paths]" {
                guard let name = names[key], found.insert(key).inserted,
                      value == "'" + root.appendingPathComponent("data/" + name).path + "'" || value == "\"" + root.appendingPathComponent("data/" + name).path + "\"" else { throw NymPublicRuntimeFailure.unsafeProfile }
            } else if section == "[core.client]", key == "id" {
                guard !matchedID, value == "'" + id + "'" || value == "\"" + id + "\"" else { throw NymPublicRuntimeFailure.unsafeProfile }; matchedID = true
            }
        }
        guard matchedID, found == Set(names.keys) else { throw NymPublicRuntimeFailure.unsafeProfile }
    }
    private static func packageIdentity(_ bundle: Bundle, role: Role) throws -> NymCodeSignatureIdentity {
        var code: SecStaticCode?, information: CFDictionary?
        guard SecStaticCodeCreateWithPath(bundle.bundleURL as CFURL, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), nil) == errSecSuccess,
              SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let info = information as? [String: Any], let id = info[kSecCodeInfoIdentifier as String] as? String,
              let hash = info[kSecCodeInfoUnique as String] as? Data, id == role.signingIdentifier else { throw NymPublicRuntimeFailure.supplyRejected }
        return try .init(identifier: id, codeDirectoryHash: hash.map { String(format: "%02x", $0) }.joined(), teamIdentifier: info[kSecCodeInfoTeamIdentifier as String] as? String)
    }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}
#endif
