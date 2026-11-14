#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import CryptoKit
import Darwin

@objc protocol ScopedSyntheticProviderFaultControl: ScopedSyntheticCanaryControl {
    func armSyntheticProviderSelfFault(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
    // A valid commit exits this provider itself and therefore has no success
    // reply. A refusal may reply; connection loss is observed independently.
    func commitSyntheticProviderSelfFault(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
}

public enum SyntheticProviderFaultFailure: String, Error, Sendable {
    case notConfigured, invalidRequest, invalidBinding, refused, expired, consumed, revoked, transportLost, timeout, localClosed
}
public enum SyntheticProviderSelfFaultOutcome: String, Sendable {
    case transportClosedAfterCommit, refused, unknown
}

struct SyntheticProviderFaultRequest: Codable, Equatable, Sendable {
    let schema: String, operation: String, nonce: String
    let binding: SyntheticTrialBinding
    let routeSequence: UInt64
    let expectedProviderSHA256: String
    let ticketID: String?
}
struct SyntheticProviderFaultArmReply: Codable, Sendable {
    let schema: String, nonce: String, ticketID: String
    let binding: SyntheticTrialBinding
    let routeSequence: UInt64
    let providerSHA256: String
    let providerPID: Int32
    let state: String // Only "armed-no-fault"; never an applied/ready permission.
}

enum SyntheticProviderFaultWire {
    static let marker = "YNXSyntheticProviderSelfFaultTesting"
    static let exitStatus: Int32 = 86
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }
    static func decode<T: Codable>(_ type: T.Type, from data: Data) throws -> T {
        guard !data.isEmpty, data.count <= 8192 else { throw SyntheticProviderFaultFailure.invalidRequest }
        let value = try JSONDecoder().decode(type, from: data)
        // The closed internal QA wire is canonical. Unknown/duplicate fields,
        // alternate encodings or caller-added ready flags cannot survive it.
        guard try encode(value) == data else { throw SyntheticProviderFaultFailure.invalidRequest }
        return value
    }
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func isUUID(_ value: String) -> Bool { UUID(uuidString: value)?.uuidString.lowercased() == value }
    static func requireRequest(_ request: SyntheticProviderFaultRequest, operation: String) throws {
        guard request.schema == "P05_SYNTHETIC_PROVIDER_SELF_FAULT_V1", request.operation == operation,
              isUUID(request.nonce), request.routeSequence > 0,
              request.expectedProviderSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              (operation == "arm" ? request.ticketID == nil : request.ticketID.map(isUUID) == true) else {
            throw SyntheticProviderFaultFailure.invalidRequest
        }
        let b = request.binding
        guard b.runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              UUID(uuidString: b.epoch)?.uuidString == b.epoch,
              UUID(uuidString: b.providerGeneration)?.uuidString == b.providerGeneration,
              b.profileID == "synthetic-" + b.runID,
              b.profileSHA256 == hash(Data(b.profileID.utf8)),
              [b.rootAuditTokenSHA256, b.manifestSHA256, b.bootstrapSHA256, b.executableSHA256].allSatisfy({
                  $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
              }) else { throw SyntheticProviderFaultFailure.invalidBinding }
    }
    static func markerEnabled(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID() && number.boolValue
    }
}

/// One-shot custody DATA only. It authenticates nobody and is not a permit.
/// The provider calls this only after its actual peer/canary/current/exclusive
/// checks. Tests of this reducer do not construct an opaque client authority.
struct SyntheticProviderFaultFence {
    private struct Pending {
        let request: SyntheticProviderFaultRequest, session: UUID, ticket: String
        let deadline: ContinuousClock.Instant
    }
    private var pending: Pending?
    private(set) var used = false
    private(set) var committed = false
    mutating func arm(_ request: SyntheticProviderFaultRequest, session: UUID, now: ContinuousClock.Instant) throws -> String {
        try SyntheticProviderFaultWire.requireRequest(request, operation: "arm")
        guard !used else { throw SyntheticProviderFaultFailure.consumed }
        used = true
        let ticket = UUID().uuidString.lowercased()
        pending = Pending(request: request, session: session, ticket: ticket, deadline: now.advanced(by: .seconds(2)))
        return ticket
    }
    mutating func consume(_ request: SyntheticProviderFaultRequest, session: UUID, now: ContinuousClock.Instant) throws {
        try SyntheticProviderFaultWire.requireRequest(request, operation: "commit")
        guard !committed, let original = pending else { throw SyntheticProviderFaultFailure.consumed }
        guard now < original.deadline else { pending = nil; throw SyntheticProviderFaultFailure.expired }
        guard original.session == session, request.ticketID == original.ticket,
              request.nonce == original.request.nonce, request.binding == original.request.binding,
              request.routeSequence == original.request.routeSequence,
              request.expectedProviderSHA256 == original.request.expectedProviderSHA256 else {
            throw SyntheticProviderFaultFailure.invalidBinding
        }
        committed = true; pending = nil
    }
    mutating func connectionLost(_ session: UUID) {
        if pending?.session == session { pending = nil } // used remains sticky; no renewal.
    }
    mutating func invalidate() { pending = nil } // Never resets used/committed.
}

enum SyntheticProviderFaultExit {
    // No PID argument, signal search, stopFilter cleanup or fallback. This is an
    // unexpected exit of only the process executing this function. Actual NE
    // consequences remain an OS experiment; a harmless child test is not that.
    static func terminateSelf() -> Never { Darwin._exit(SyntheticProviderFaultWire.exitStatus) }
}

/// Durable local replay fence DATA. Writing this never applies a fault or
/// authenticates a provider. Both destructive dispatcher paths use one run key.
public enum SyntheticFaultCommitIntentJournal {
    public static func record(in directory: URL, binding: SyntheticTrialBinding, fault: String,
                              commandSHA256: String, armReceiptSHA256: String? = nil) throws -> String {
        guard ["route-loss", "provider-crash"].contains(fault),
              binding.runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              [commandSHA256] .allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              armReceiptSHA256 == nil || armReceiptSHA256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              directory.isFileURL, directory.standardizedFileURL == directory,
              directory.resolvingSymlinksInPath() == directory else { throw SyntheticProviderFaultFailure.invalidRequest }
        let fd = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw SyntheticProviderFaultFailure.localClosed }; defer { Darwin.close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0, before.st_uid == getuid(), before.st_mode & 0o777 == 0o700 else {
            throw SyntheticProviderFaultFailure.localClosed
        }
        let encodedBinding = try SyntheticProviderFaultWire.encode(binding)
        var value: [String: Any] = ["schema": "P05_PROTECTED_FAULT_COMMIT_INTENT_V1", "state": "commit-intent-not-applied",
            "fault": fault, "binding": try JSONSerialization.jsonObject(with: encodedBinding), "commandSHA256": commandSHA256]
        if let armReceiptSHA256 { value["armReceiptSHA256"] = armReceiptSHA256 }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        let output = openat(fd, "p05-protected-fault-\(binding.runID).intent", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard output >= 0 else { throw SyntheticProviderFaultFailure.consumed }; defer { Darwin.close(output) }
        // No remove on failure: partial intent remains a replay fence, never an applied receipt.
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(output, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw SyntheticProviderFaultFailure.localClosed }; offset += count
            }
        }
        var after = stat(), path = stat(), file = stat()
        guard fsync(output) == 0, fsync(fd) == 0, fstat(output, &file) == 0,
              file.st_mode & S_IFMT == S_IFREG, file.st_uid == getuid(), file.st_nlink == 1,
              file.st_mode & 0o777 == 0o600, file.st_size == data.count,
              fstat(fd, &after) == 0, lstat(directory.path, &path) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_dev == path.st_dev, before.st_ino == path.st_ino else { throw SyntheticProviderFaultFailure.localClosed }
        return SyntheticProviderFaultWire.hash(data)
    }
}
#endif
