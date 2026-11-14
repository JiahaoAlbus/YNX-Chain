import Foundation
import CryptoKit
import Security
import Darwin

// Independent additive selectors. These only observe normal artifact identity;
// they do not enroll a Root, touch route rules, approve leaks, or sign a release.
@objc protocol ScopedNormalCaptureControl {
    func captureNormalArtifact(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func currentNormalArtifact(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func retireNormalArtifact(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void)
}
@objc protocol ScopedNormalCaptureRoutedControl: ScopedNormalRoutedControl, ScopedNormalCaptureControl {}

public enum RoutedNormalCaptureFailure: String, Error, Sendable {
    case invalidRequest, qaArtifactRejected, wrongArtifact, missingProviderPin
    case notCurrent, expired, retired, cancelled, transportLost, replyTimeout, invalidReply, originalApprovalNotSupplied
}
/// A generation pin survives clearing historical observation DATA during retire.
/// It is not a permission, and it can never accept a replacement provider.
struct NormalCaptureProviderGeneration {
    private(set) var value:String?
    mutating func accept(_ next:String) throws {
        guard UUID(uuidString:next) != nil, value==nil || value==next else {throw RoutedNormalCaptureFailure.invalidReply}
        value=next
    }
}
/// Read-only observation sessions, independent of Root/network permissions.
/// Slow artifact checks must revalidate this fence before committing a row.
struct NormalCaptureSessionFence {
    private var sessions:Set<UUID>=[]
    mutating func open(_ session:UUID) {if sessions.count<256 {sessions.insert(session)}}
    func contains(_ session:UUID)->Bool {sessions.contains(session)}
    func requireCurrent(_ session:UUID) throws {guard contains(session) else {throw RoutedNormalCaptureFailure.notCurrent}}
    mutating func close(_ session:UUID) {sessions.remove(session)}
    mutating func closeAll() {sessions.removeAll()}
}
enum NormalCaptureRolePolicy {
    static func requireNormal(role:Any?, bundleIdentifier:String?, mode:RoutedIsolationMode) throws {
        #if YNX_PRIVACY_ACCEPTANCE
        throw RoutedNormalCaptureFailure.qaArtifactRejected
        #else
        guard role as? String == "normal-artifact-observation-v1", bundleIdentifier == mode.bundleIdentifier else {throw RoutedNormalCaptureFailure.qaArtifactRejected}
        #endif
    }
}
struct NormalArtifactBinding: Codable, Equatable, Sendable {
    let mode: RoutedIsolationMode
    let team: String, bundleID: String, browserSHA256: String, browserCodeHash: String
    let helperSHA256: String, providerSHA256: String, osBuild: String
    func validate() throws {
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil,
              bundleID.utf8.elementsEqual(mode.bundleIdentifier.utf8), !osBuild.isEmpty, osBuild.utf8.count <= 256,
              [browserSHA256,helperSHA256,providerSHA256].allSatisfy({ $0.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil }),
              browserCodeHash.range(of:"^(?:[a-f0-9]{40}|[a-f0-9]{64})$",options:.regularExpression) != nil else { throw RoutedNormalCaptureFailure.wrongArtifact }
    }
    static func == (a: Self, b: Self) -> Bool {
        a.mode == b.mode && zip([a.team,a.bundleID,a.browserSHA256,a.browserCodeHash,a.helperSHA256,a.providerSHA256,a.osBuild],
                               [b.team,b.bundleID,b.browserSHA256,b.browserCodeHash,b.helperSHA256,b.providerSHA256,b.osBuild]).allSatisfy { $0.utf8.elementsEqual($1.utf8) }
    }
}
struct NormalArtifactRequest: Codable {
    let schema: String, captureID: String, captureEpoch: String, nonce: String
    let sequence: UInt64, operation: String, auditTokenHex: String
    let binding: NormalArtifactBinding
    func validate(operation expected: String) throws {
        guard schema == "P05_NORMAL_ARTIFACT_REQUEST_V1", operation == expected, ["capture","current","retire"].contains(operation),
              [captureID,captureEpoch,nonce].allSatisfy({ UUID(uuidString:$0) != nil }), sequence > 0,
              auditTokenHex.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else { throw RoutedNormalCaptureFailure.invalidRequest }
        try binding.validate()
    }
}
/// Anonymous artifact DATA, NEVER a qualification or release approval capability.
public struct RoutedNormalArtifactObservation: Codable, Sendable {
    public let schema: String, captureID: String, captureEpoch: String, nonce: String
    public let sequence: UInt64
    public let providerGeneration: String, ownerAuditTokenSHA256: String
    public let browserSHA256: String, providerSHA256: String
    public let state: String, originalApprovalState: String
    public let remainingMilliseconds: UInt32
}
struct NormalCaptureReplyBinding {
    let artifact:NormalArtifactBinding, ownerToken:Data
    let captureID:String, captureEpoch:String
    func consume(_ bytes:Data, request q:NormalArtifactRequest, retiring:Bool,
                 knownProviderGeneration:String?) throws -> RoutedNormalArtifactObservation {
        let r=try NormalCaptureWire.decode(RoutedNormalArtifactObservation.self,bytes)
        guard r.schema=="P05_NORMAL_ARTIFACT_OBSERVATION_V1",r.captureID==captureID,r.captureEpoch==captureEpoch,
              r.nonce==q.nonce,r.sequence==q.sequence,UUID(uuidString:r.providerGeneration) != nil,
              r.ownerAuditTokenSHA256==SHA256.hash(data:ownerToken).map({String(format:"%02x",$0)}).joined(),
              r.browserSHA256==artifact.browserSHA256,r.providerSHA256==artifact.providerSHA256,
              r.originalApprovalState=="not-supplied",r.state==(retiring ? "retired":"observed"),
              retiring ? r.remainingMilliseconds==0 : (1...5000).contains(r.remainingMilliseconds),
              knownProviderGeneration==nil || knownProviderGeneration==r.providerGeneration else {throw RoutedNormalCaptureFailure.invalidReply}
        return r
    }
}
enum NormalCaptureWire {
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder=JSONEncoder(); encoder.outputFormatting=[.sortedKeys,.withoutEscapingSlashes]
        return try encoder.encode(value)
    }
    static func decode<T: Codable>(_ type:T.Type, _ data:Data) throws -> T {
        guard !data.isEmpty, data.count<=8192 else { throw RoutedNormalCaptureFailure.invalidRequest }
        let value=try JSONDecoder().decode(type,from:data)
        // Both actual endpoints emit canonical bytes. This also rejects duplicate,
        // unknown and alternate-type fields rather than letting last-key win.
        guard try encode(value)==data else { throw RoutedNormalCaptureFailure.invalidRequest };return value
    }
}
/// Provider-local observation ledger. Call only AFTER genuine peer/artifact verification.
/// No field/state in this ledger is consulted by network rules or normal approval.
struct NormalCaptureLedger {
    struct Row {
        let owner: Data, session: UUID, request: NormalArtifactRequest, deadline: UInt64
        var sequence: UInt64
    }
    private(set) var rows: [String:Row]=[:]
    private var retired: Set<String>=[]
    mutating func handle(_ request:NormalArtifactRequest, operation:String, owner:Data, session:UUID,
                         generation:String, now:UInt64) throws -> RoutedNormalArtifactObservation {
        try request.validate(operation:operation)
        guard owner.count==32, request.auditTokenHex==owner.map({String(format:"%02x",$0)}).joined() else { throw RoutedNormalCaptureFailure.wrongArtifact }
        if operation=="capture" {
            guard request.sequence==1, rows[request.captureID]==nil, !retired.contains(request.captureID), retired.count<4096, rows.count<64,
                  !rows.values.contains(where:{$0.session==session}) else { throw RoutedNormalCaptureFailure.notCurrent }
            rows[request.captureID]=Row(owner:owner,session:session,request:request,deadline:now+5_000_000_000,sequence:1)
        } else {
            guard var row=rows[request.captureID], row.owner==owner, row.session==session,
                  row.request.captureEpoch==request.captureEpoch, row.request.binding==request.binding,
                  request.sequence==row.sequence+1 else { throw RoutedNormalCaptureFailure.notCurrent }
            guard now<row.deadline else { remove(request.captureID);throw RoutedNormalCaptureFailure.expired }
            row.sequence=request.sequence;rows[request.captureID]=row
        }
        guard let row=rows[request.captureID] else { throw RoutedNormalCaptureFailure.notCurrent }
        let remaining=UInt32(min(5000,(row.deadline-now)/1_000_000))
        if operation=="retire" { remove(request.captureID) }
        return .init(schema:"P05_NORMAL_ARTIFACT_OBSERVATION_V1",captureID:request.captureID,captureEpoch:request.captureEpoch,
            nonce:request.nonce,sequence:request.sequence,providerGeneration:generation,
            ownerAuditTokenSHA256:SHA256.hash(data:owner).map({String(format:"%02x",$0)}).joined(),
            browserSHA256:request.binding.browserSHA256,providerSHA256:request.binding.providerSHA256,
            state:operation=="retire" ? "retired" : "observed",originalApprovalState:"not-supplied",
            remainingMilliseconds:operation=="retire" ? 0 : remaining)
    }
    mutating func remove(_ id:String) { rows.removeValue(forKey:id);if retired.count<4096 { retired.insert(id) } }
    mutating func close(session:UUID) { for (id,row) in rows where row.session==session { remove(id) } }
    mutating func expire(now:UInt64) { for (id,row) in rows where now>=row.deadline { remove(id) } }
    mutating func closeAll() { for id in rows.keys { remove(id) } }
}
/// Shared strict artifact reader; caller inputs are comparison DATA, not authority.
enum NormalCaptureArtifactReader {
    static func codeHash(_ url:URL) throws -> String {
        var code:SecStaticCode?, info:CFDictionary?
        guard SecStaticCodeCreateWithPath(url as CFURL,[],&code)==errSecSuccess,let code,
              SecCodeCopySigningInformation(code,SecCSFlags(rawValue:kSecCSSigningInformation),&info)==errSecSuccess,
              let fields=info as? [String:Any],let bytes=fields[kSecCodeInfoUnique as String] as? Data else {throw RoutedNormalCaptureFailure.wrongArtifact}
        return bytes.map({String(format:"%02x",$0)}).joined()
    }
    static func seal(_ url:URL, requirement:String) throws {
        var code:SecStaticCode?, rule:SecRequirement?
        guard SecStaticCodeCreateWithPath(url as CFURL,[],&code)==errSecSuccess,let code,
              SecRequirementCreateWithString(requirement as CFString,[],&rule)==errSecSuccess,let rule,
              SecStaticCodeCheckValidity(code,SecCSFlags(rawValue:kSecCSStrictValidate|kSecCSCheckAllArchitectures),rule)==errSecSuccess else { throw RoutedNormalCaptureFailure.wrongArtifact }
    }
    static func digest(_ url:URL) throws -> String {
        // A pathname can change after signature validation. Open a substituted
        // FIFO without waiting, then reject it before any read.
        let fd = Darwin.open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw RoutedNormalCaptureFailure.wrongArtifact }
        defer { Darwin.close(fd) }
        var before = stat(), after = stat(), atPath = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_size > 0, before.st_size <= 268_435_456 else {
            throw RoutedNormalCaptureFailure.wrongArtifact
        }
        let file = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        var remaining = Int(before.st_size)
        var hasher = SHA256()
        while remaining > 0 {
            let count = min(remaining, 65_536)
            guard let chunk = try file.read(upToCount: count), !chunk.isEmpty,
                  chunk.count <= count else { throw RoutedNormalCaptureFailure.wrongArtifact }
            hasher.update(data: chunk)
            remaining -= chunk.count
        }
        let extra = try file.read(upToCount: 1)
        guard extra?.isEmpty != false, fstat(fd, &after) == 0, lstat(url.path, &atPath) == 0,
              sameArtifact(before, after), sameArtifact(before, atPath) else {
            throw RoutedNormalCaptureFailure.wrongArtifact
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func sameArtifact(_ before: stat, _ after: stat) -> Bool {
        before.st_dev == after.st_dev && before.st_ino == after.st_ino &&
            before.st_mode == after.st_mode && before.st_size == after.st_size &&
            before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec &&
            before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec &&
            before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec &&
            before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
    }
}
