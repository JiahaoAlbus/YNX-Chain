import Foundation
import Security
import CryptoKit
import Darwin

public enum RoutedQualificationFailure: String, Error, Sendable {
    case signingNotConfigured, wrongMode, invalidSignature, installationChanged
    case helperNotBound, qualificationIssuerNotSupplied, expired, revoked, closed
    public var explanation: String {
        switch self {
        case .signingNotConfigured: "RootBlocked: reviewed Apple Team signing is not configured; no IPC, backend or WebKit may start"
        case .wrongMode: "RootBlocked: qualification belongs to a different routed application/mode"
        case .invalidSignature: "RootBlocked: actual application or owned helper signature does not match the reviewed Team and identifier"
        case .installationChanged: "RootBlocked: installation/build/OS binding changed; requalification is required"
        case .helperNotBound: "RootBlocked: exact owned start-helper artifact is not bound to this installation"
        case .qualificationIssuerNotSupplied: "RootBlocked: original release owner has not supplied its authenticated full-window qualification, build binding and revocation contract; this is a normal-composition CODE/contract gap"
        case .expired: "RootBlocked: the original qualification observation expired; no renewal or old result reuse is permitted"
        case .revoked: "RootBlocked: qualification was revoked; this owner cannot resume"
        case .closed: "RootBlocked: qualification owner is closed"
        }
    }
}

// DATA binding only. It is not an issuer, approval record, decoded ready flag,
// or an externally constructible qualification capability.
struct RoutedQualificationInstallation: Equatable, Sendable {
    let mode: PrivacyRouteMode
    let team: String, bundleID: String, browserSHA256: String, browserCodeHash: String
    let helperSHA256: String, osBuild: String
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.mode == rhs.mode && zip(
            [lhs.team, lhs.bundleID, lhs.browserSHA256, lhs.browserCodeHash, lhs.helperSHA256, lhs.osBuild],
            [rhs.team, rhs.bundleID, rhs.browserSHA256, rhs.browserCodeHash, rhs.helperSHA256, rhs.osBuild]
        ).allSatisfy { $0.utf8.elementsEqual($1.utf8) }
    }
}
struct RoutedQualificationContinuity {
    let installation: RoutedQualificationInstallation
    // Private normal-composition time, never a decoded issuer/QA field. Keep
    // creation, checks and the expiry sleeper in the same sleep-inclusive domain.
    let deadline: ContinuousClock.Instant
    private(set) var failure: RoutedQualificationFailure?
    private(set) var notificationDelivered = false
    mutating func requireUnexpired(now: ContinuousClock.Instant) throws {
        if let failure { throw failure }
        guard now < deadline else { failure = .expired; throw RoutedQualificationFailure.expired }
    }
    mutating func check(_ current: RoutedQualificationInstallation, now: ContinuousClock.Instant) throws {
        try requireUnexpired(now: now)
        guard current == installation else { failure = .installationChanged; throw RoutedQualificationFailure.installationChanged }
    }
    mutating func revoke(_ reason: RoutedQualificationFailure) { if failure == nil { failure = reason } }
    mutating func signalRevocation(_ reason: RoutedQualificationFailure) -> Bool {
        revoke(reason)
        guard !notificationDelivered else { return false }
        notificationDelivered = true; return true
    }
}

/// An opaque normal-production owner, distinct from compile-only synthetic QA.
/// No public initializer, decoding, provider setter, Boolean or caller artifact
/// can construct one. Original A's authenticated qualification supplier is the
/// missing factory boundary; code signing, RootDeny and a health lease are not it.
@MainActor public final class RoutedProductionQualification {
    private static let captureCustody=NormalCaptureAcquisitionCustody<RoutedNormalArtifactCapture>()
    private var continuity: RoutedQualificationContinuity
    private let reviewedAdmission: RoutedPlatformIsolationAdmission
    private var revocations: [@MainActor () -> Void] = []
    private var expiry: Task<Void, Never>?
    private init(continuity: RoutedQualificationContinuity, admission: RoutedPlatformIsolationAdmission) throws {
        var original = continuity
        try original.requireUnexpired(now: .now)
        self.continuity = original; reviewedAdmission = admission
        // This initializer is reachable only when the original supplier is
        // actually integrated here. No caller DATA path reaches it today.
    }
    public static func acquireCurrent(mode: PrivacyRouteMode) throws -> RoutedProductionQualification {
        let installation:RoutedQualificationInstallation
        do {installation=try RoutedQualificationIdentity.inspect(mode:mode)}
        catch {captureCustody.held?.rejectPostAcquire(error);throw error}
        // A read-only captured artifact can withdraw/expire, but it cannot supply
        // approval. Consume its real current failure before the missing issuer boundary.
        if let captured = captureCustody.held {
            do { try captured.requireLocalCurrent(installation: installation) }
            catch {
                switch captured.firstFailure {
                case .expired: throw RoutedQualificationFailure.expired
                case .retired: throw RoutedQualificationFailure.closed
                case .wrongArtifact, .qaArtifactRejected: throw RoutedQualificationFailure.installationChanged
                default: throw RoutedQualificationFailure.revoked
                }
            }
        }
        // Actual identity intake above is implemented. Existing release sources
        // provide no original issuer selector/format/current/revocation owner.
        // Do not interpret a sealed JSON file, QA canary, NE enabled bit or
        // signing success as that absent permission. The original release owner
        // must add its genuine authenticated callee at THIS composition boundary.
        throw RoutedQualificationFailure.qualificationIssuerNotSupplied
    }
    /// Zero caller DATA; a signed-channel artifact observation, never permission.
    public static func captureCurrentArtifact(mode: PrivacyRouteMode) async throws -> RoutedNormalArtifactCapture {
        // Actual caller/mode intake precedes even joining an existing owner.
        do {_=try RoutedQualificationIdentity.inspect(mode:mode)}
        catch {captureCustody.held?.rejectPostAcquire(error);throw error}
        return try await captureCustody.acquire(canReplace:{value in
            if case .observedRetired? = value.retirementResult {return value.localChannelDisposed}
            return false
        },validate:{try $0.requireActualCurrent()},refresh:{value in _=try await value.requireCurrent()},create:{adopt in
            try await RoutedNormalArtifactCapture.begin(mode:mode,adopt:adopt)
        })
    }
    public nonisolated static func currentFailure(mode: PrivacyRouteMode? = nil) -> RoutedQualificationFailure {
        do { _ = try RoutedQualificationIdentity.inspect(mode: mode) }
        catch { return (error as? RoutedQualificationFailure) ?? .invalidSignature }
        return .qualificationIssuerNotSupplied
    }
    public var admission: RoutedPlatformIsolationAdmission { reviewedAdmission }
    public var failure: RoutedQualificationFailure? { continuity.failure }
    public func requireCurrent(mode: PrivacyRouteMode, configuration: RoutedIsolationConfiguration? = nil) throws {
        do {
            // Expired/revoked owners reject before new identity/file inspection.
            try continuity.requireUnexpired(now: .now)
            guard mode == continuity.installation.mode else { throw RoutedQualificationFailure.wrongMode }
            let current = try RoutedQualificationIdentity.inspect(mode: mode)
            if let configuration {
                guard configuration.mode.rawValue == (mode == .tor ? "tor" : "nym"),
                      configuration.teamIdentifier.utf8.elementsEqual(current.team.utf8),
                      configuration.expectedBrowserSHA256.utf8.elementsEqual(current.browserSHA256.utf8) else { throw RoutedQualificationFailure.installationChanged }
            }
            // Identity inspection is synchronous but may take time. A late result
            // cannot return a live owner after its original continuous deadline.
            try continuity.check(current, now: .now)
        } catch {
            revoke((error as? RoutedQualificationFailure) ?? .invalidSignature)
            throw continuity.failure ?? .revoked
        }
    }
    public func installRevocationHandler(_ callback: @escaping @MainActor () -> Void) throws {
        if let failure = continuity.failure { callback(); throw failure }
        do { try requireCurrent(mode: continuity.installation.mode) }
        catch { callback(); throw error }
        revocations.append(callback)
        // A finite original observation must expire independently of a later
        // request. This does not manufacture an original issuer revocation feed.
        if expiry == nil {
            let deadline = continuity.deadline
            expiry = Task { @MainActor [weak self] in
                do { try await ContinuousClock().sleep(until: deadline, tolerance: .zero) }
                catch { return }
                guard !Task.isCancelled else { return }
                self?.revoke(.expired)
            }
        }
    }
    public func revoke(_ reason: RoutedQualificationFailure = .revoked) {
        guard continuity.signalRevocation(reason) else { return }
        expiry?.cancel(); expiry = nil
        let callbacks = revocations; revocations.removeAll()
        for callback in callbacks { callback() } // Synchronous owner teardown before any await.
    }
    deinit { expiry?.cancel() }
}

private enum RoutedQualificationIdentity {
    static func inspect(mode requested: PrivacyRouteMode?) throws -> RoutedQualificationInstallation {
        // Reviewed Team is read only from the actual application. Reject before
        // executable/helper/resource reads, provider IPC, backend or WebKit.
        let bundle = Bundle.main
        let team = bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? ""
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw RoutedQualificationFailure.signingNotConfigured }
        let mode: PrivacyRouteMode
        switch bundle.bundleIdentifier {
        case RoutedIsolationMode.tor.bundleIdentifier: mode = .tor
        case RoutedIsolationMode.nym.bundleIdentifier: mode = .nym
        default: throw RoutedQualificationFailure.wrongMode
        }
        guard requested == nil || requested == mode, let identifier = bundle.bundleIdentifier,
              let executable = bundle.executableURL else { throw RoutedQualificationFailure.wrongMode }
        var own: SecCode?, staticOwn: SecStaticCode?, requirement: SecRequirement?, signing: CFDictionary?
        let rule = RoutedIsolationConfiguration.requirement(team: team, identifier: identifier)
        guard SecCodeCopySelf([], &own) == errSecSuccess, let own,
              SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess, let requirement,
              SecCodeCheckValidity(own, [], requirement) == errSecSuccess,
              SecCodeCopyStaticCode(own, [], &staticOwn) == errSecSuccess, let staticOwn,
              SecCodeCopySigningInformation(staticOwn, SecCSFlags(rawValue: kSecCSSigningInformation), &signing) == errSecSuccess,
              let information = signing as? [String: Any],
              information[kSecCodeInfoTeamIdentifier as String] as? String == team,
              information[kSecCodeInfoIdentifier as String] as? String == identifier,
              let actualExecutable = information[kSecCodeInfoMainExecutable as String] as? URL,
              actualExecutable.standardizedFileURL == executable.standardizedFileURL,
              let cdhash = information[kSecCodeInfoUnique as String] as? Data, !cdhash.isEmpty else { throw RoutedQualificationFailure.invalidSignature }
        try checkSeal(bundle.bundleURL, requirement: requirement)
        let browserHash = try digestFile(executable)
        guard try NormalCaptureArtifactReader.codeHash(bundle.bundleURL) == cdhash.map({String(format:"%02x",$0)}).joined() else {throw RoutedQualificationFailure.installationChanged}
        let helper = bundle.bundleURL.appendingPathComponent("Contents/Helpers/YNXBackendStartGate")
        guard let expectedHelper = bundle.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String,
              expectedHelper.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw RoutedQualificationFailure.helperNotBound }
        var helperRequirement: SecRequirement?
        let helperRule = RoutedIsolationConfiguration.requirement(team: team, identifier: "com.ynxweb4.browser.route-start-gate")
        guard SecRequirementCreateWithString(helperRule as CFString, [], &helperRequirement) == errSecSuccess, let helperRequirement else { throw RoutedQualificationFailure.invalidSignature }
        try checkSeal(helper, requirement: helperRequirement)
        let helperHash = try digestFile(helper)
        guard helperHash.utf8.elementsEqual(expectedHelper.utf8) else { throw RoutedQualificationFailure.helperNotBound }
        try checkSeal(bundle.bundleURL, requirement: requirement)
        guard SecCodeCheckValidity(own, [], requirement) == errSecSuccess else { throw RoutedQualificationFailure.invalidSignature }
        return .init(mode: mode, team: team, bundleID: identifier, browserSHA256: browserHash,
                     browserCodeHash: cdhash.map { String(format: "%02x", $0) }.joined(), helperSHA256: helperHash,
                     osBuild: ProcessInfo.processInfo.operatingSystemVersionString)
    }
    static func checkSeal(_ path: URL, requirement: SecRequirement) throws {
        guard path.isFileURL, path.standardizedFileURL == path, path.resolvingSymlinksInPath() == path else { throw RoutedQualificationFailure.installationChanged }
        var code: SecStaticCode?
        let flags = SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures)
        guard SecStaticCodeCreateWithPath(path as CFURL, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, flags, requirement) == errSecSuccess else { throw RoutedQualificationFailure.invalidSignature }
    }
    static func digestFile(_ path: URL) throws -> String {
        do { return try NormalCaptureArtifactReader.digest(path) }
        catch { throw RoutedQualificationFailure.installationChanged }
    }
}


enum NormalCaptureCustodyFailure:Error {case invalidAdoption, staleAcquisition}
/// Internal ownership scheduling only. It cannot construct a capture, authenticate
/// an issuer, or grant permission. Partial/UNKNOWN owners remain strongly held.
@MainActor final class NormalCaptureAcquisitionCustody<Value:AnyObject & Sendable> {
    private(set) var held:Value?
    private var worker:Task<Value,Error>?
    private(set) var firstFailure:Error?
    private var generation:UInt64=0
    func acquire(canReplace:@escaping @MainActor (Value)->Bool,
                 validate:@escaping @MainActor (Value)throws->Void,
                 refresh:@escaping @MainActor (Value)async throws->Void,
                 create:@escaping @MainActor (@escaping @MainActor (Value)throws->Void)async throws->Value) async throws->Value {
        if let worker {
            let value=try await worker.value
            try Task.checkCancellation();try validate(value);return value
        }
        if let held,canReplace(held) {self.held=nil;generation &+= 1}
        let original=held,expected=generation
        let work=Task { @MainActor [self] ()throws->Value in
            do {
                let value:Value
                if let original {
                    try validate(original);try await refresh(original);value=original
                } else {
                    value=try await create { [self] partial in
                        guard generation==expected,held==nil else {throw NormalCaptureCustodyFailure.invalidAdoption}
                        held=partial // Before the first resource/IPC effect in the real factory.
                    }
                }
                guard generation==expected,held===value else {throw NormalCaptureCustodyFailure.staleAcquisition}
                try validate(value);return value
            } catch {if firstFailure==nil {firstFailure=error};throw error}
        }
        worker=work
        defer {worker=nil}
        let value=try await work.value
        try Task.checkCancellation();try validate(value);return value
    }
}
public enum RoutedNormalCaptureRetirement: Sendable { case observedRetired, unknown }
/// An opaque owner of non-authority artifact DATA, with no qualification accessor.
@MainActor public final class RoutedNormalArtifactCapture {
    public private(set) var observation: RoutedNormalArtifactObservation?
    public private(set) var firstFailure: RoutedNormalCaptureFailure?
    public private(set) var retirementResult:RoutedNormalCaptureRetirement?
    public var localChannelDisposed: Bool { !transport.isOpen }
    private let mode: PrivacyRouteMode, installation: RoutedQualificationInstallation
    private let binding: NormalArtifactBinding, token: Data
    private let captureID=UUID().uuidString, captureEpoch=UUID().uuidString
    private let deadline=ContinuousClock.now.advanced(by:.seconds(5))
    private let transport: NormalCaptureTransport
    private var sequence:UInt64=0, revision:UInt64=0
    private var providerGeneration=NormalCaptureProviderGeneration()
    private var expiry:Task<Void,Never>?, refresh:Task<RoutedNormalArtifactObservation,Error>?
    private var retiring:Task<RoutedNormalCaptureRetirement,Never>?
    private var callbacks:[@MainActor ()->Void]=[]
    private init(mode:PrivacyRouteMode,installation:RoutedQualificationInstallation,binding:NormalArtifactBinding,token:Data) {
        self.mode=mode;self.installation=installation;self.binding=binding;self.token=token
        transport=NormalCaptureTransport(team:binding.team)
        transport.onLost={ [weak self] reason in self?.withdraw(reason) }
        let until=deadline
        expiry=Task { @MainActor [weak self] in
            do { try await ContinuousClock().sleep(until:until,tolerance:.zero) } catch { return }
            self?.withdraw(.expired)
        }
    }
    fileprivate static func begin(mode:PrivacyRouteMode,adopt:@MainActor (RoutedNormalArtifactCapture)throws->Void) async throws -> RoutedNormalArtifactCapture {
        let identity=try RoutedQualificationIdentity.inspect(mode:mode) // NoTeam first; no files/IPC first.
        try NormalCaptureRolePolicy.requireNormal(role:Bundle.main.object(forInfoDictionaryKey:"YNXNormalArtifactCaptureRole"),bundleIdentifier:Bundle.main.bundleIdentifier,mode:mode == .tor ? .tor:.nym)
        guard let provider=Bundle.main.object(forInfoDictionaryKey:"YNXRouteFilterProviderSHA256") as? String,
              provider.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else { throw RoutedNormalCaptureFailure.missingProviderPin }
        let binding=NormalArtifactBinding(mode:mode == .tor ? .tor : .nym,team:identity.team,bundleID:identity.bundleID,
            browserSHA256:identity.browserSHA256,browserCodeHash:identity.browserCodeHash,helperSHA256:identity.helperSHA256,
            providerSHA256:provider,osBuild:identity.osBuild)
        let owner=RoutedNormalArtifactCapture(mode:mode,installation:identity,binding:binding,token:try RoutedOwnAuditToken.copy())
        do {
            try adopt(owner) // Custody precedes open and any asynchronous callback.
            try owner.transport.open()
            _=try await owner.request("capture")
            return owner
        } catch {
            // Channel ownership was adopted before its first asynchronous request.
            owner.rejectPostAcquire(error)
            throw owner.firstFailure ?? error
        }
    }
    fileprivate func requireLocalCurrent(installation current:RoutedQualificationInstallation) throws {
        if let firstFailure { throw firstFailure }
        guard ContinuousClock.now<deadline else { withdraw(.expired);throw RoutedNormalCaptureFailure.expired }
        guard current==installation,
              Bundle.main.object(forInfoDictionaryKey:"YNXNormalArtifactCaptureRole") as? String == "normal-artifact-observation-v1",
              (Bundle.main.object(forInfoDictionaryKey:"YNXRouteFilterProviderSHA256") as? String)?.utf8.elementsEqual(binding.providerSHA256.utf8)==true else {
            withdraw(.wrongArtifact);throw RoutedNormalCaptureFailure.wrongArtifact
        }
    }
    fileprivate func requireActualCurrent() throws {
        do {try requireLocalCurrent(installation:RoutedQualificationIdentity.inspect(mode:mode))}
        catch {rejectPostAcquire(error);throw firstFailure ?? error}
    }
    fileprivate func rejectPostAcquire(_ error:Error) {
        withdraw((error as? RoutedNormalCaptureFailure) ?? (error is CancellationError ? .cancelled:.wrongArtifact))
    }
    public func requireCurrent() async throws -> RoutedNormalArtifactObservation {
        if let refresh {
            let result=try await refresh.value
            try Task.checkCancellation();try requireActualCurrent();return result
        }
        let work=Task { @MainActor [self] in try await request("current") };refresh=work
        defer { refresh=nil }
        let result=try await work.value
        try Task.checkCancellation();try requireActualCurrent();return result
    }
    /// Observers withdraw only. There is no public supplier/setter/ready switch.
    public func installRevocationHandler(_ callback:@escaping @MainActor ()->Void) throws {
        do { try requireActualCurrent() }
        catch { callback();throw error }
        callbacks.append(callback)
    }
    public func retire() async -> RoutedNormalCaptureRetirement {
        if let retiring {let result=await retiring.value;retirementResult=result;return result}
        let pending=refresh
        // Revoke future reads before awaiting any remote retire acknowledgement.
        revision &+= 1;if firstFailure==nil {firstFailure = .retired};observation=nil
        expiry?.cancel();expiry=nil;pending?.cancel()
        let handlers=callbacks;callbacks.removeAll();for handler in handlers {handler()}
        let work=Task { @MainActor [self] ()->RoutedNormalCaptureRetirement in
            if let pending { _=await pending.result }
            defer {transport.close()}
            do {
                guard transport.isOpen else {return .unknown}
                sequence += 1
                let q=makeRequest("retire")
                let bytes=try await transport.call(q)
                let reply=try consume(bytes,request:q,retiring:true)
                return reply.state=="retired" ? .observedRetired : .unknown
            } catch {return .unknown}
        }
        retiring=work
        let result=await work.value;retirementResult=result;return result
    }
    private func makeRequest(_ operation:String)->NormalArtifactRequest {
        .init(schema:"P05_NORMAL_ARTIFACT_REQUEST_V1",captureID:captureID,captureEpoch:captureEpoch,nonce:UUID().uuidString,
            sequence:sequence,operation:operation,auditTokenHex:token.map({String(format:"%02x",$0)}).joined(),binding:binding)
    }
    private func request(_ operation:String) async throws -> RoutedNormalArtifactObservation {
        do {
            try Task.checkCancellation()
            try requireActualCurrent()
            let expected=revision;sequence += 1;let q=makeRequest(operation)
            let bytes=try await transport.call(q)
            try Task.checkCancellation()
            try requireActualCurrent()
            guard expected==revision else {throw RoutedNormalCaptureFailure.retired}
            let result=try consume(bytes,request:q,retiring:false);observation=result;return result
        } catch {rejectPostAcquire(error);throw firstFailure ?? error}
    }
    private func consume(_ bytes:Data,request q:NormalArtifactRequest,retiring:Bool) throws -> RoutedNormalArtifactObservation {
        let result=try NormalCaptureReplyBinding(artifact:binding,ownerToken:token,captureID:captureID,captureEpoch:captureEpoch)
            .consume(bytes,request:q,retiring:retiring,knownProviderGeneration:providerGeneration.value)
        try providerGeneration.accept(result.providerGeneration)
        return result
    }
    private func withdraw(_ reason:RoutedNormalCaptureFailure) {
        guard firstFailure==nil else {return}
        firstFailure=reason;revision &+= 1;observation=nil;expiry?.cancel();expiry=nil
        transport.close()
        let handlers=callbacks;callbacks.removeAll();for handler in handlers {handler()}
    }
    deinit {expiry?.cancel()}
}

// A nonactor box owns NSXPC lifetime for Swift6.0-compatible physical invalidation.
private final class NormalCaptureConnectionLifetime {
    let connection:NSXPCConnection
    init(_ connection:NSXPCConnection){self.connection=connection}
    deinit {connection.invalidate()}
}
@MainActor private final class NormalCaptureTransport {
    let team:String
    private var lifetime:NormalCaptureConnectionLifetime?,proxy:ScopedNormalCaptureControl?
    private var pending:NormalCapturePending?
    var onLost:(@MainActor (RoutedNormalCaptureFailure)->Void)?
    private(set) var isOpen=false
    init(team:String){self.team=team}
    func open() throws {
        let connection=NSXPCConnection(machServiceName:"\(team).com.ynxweb4.browser.routefilter.provider",options:.privileged)
        connection.setCodeSigningRequirement(RoutedIsolationConfiguration.requirement(team:team,identifier:"com.ynxweb4.browser.routefilter.provider"))
        connection.remoteObjectInterface=NSXPCInterface(with:ScopedNormalCaptureControl.self)
        let lost:@Sendable ()->Void={ [weak self] in Task { @MainActor in guard let self,self.isOpen else{return};self.close();self.onLost?(.transportLost) } }
        connection.invalidationHandler=lost;connection.interruptionHandler=lost
        lifetime=NormalCaptureConnectionLifetime(connection);isOpen=true
        guard let proxy=connection.remoteObjectProxyWithErrorHandler({_ in lost()}) as? ScopedNormalCaptureControl else {close();throw RoutedNormalCaptureFailure.transportLost}
        self.proxy=proxy;connection.resume()
    }
    func close(_ reason:RoutedNormalCaptureFailure = .transportLost){isOpen=false;pending?.finish(.failure(reason));pending=nil;proxy=nil;lifetime?.connection.invalidate();lifetime=nil}
    func call(_ q:NormalArtifactRequest) async throws -> Data {
        guard isOpen,let proxy,pending==nil else{throw RoutedNormalCaptureFailure.transportLost}
        let data=try NormalCaptureWire.encode(q)
        return try await withTaskCancellationHandler(operation:{
            try await withCheckedThrowingContinuation { continuation in
                let item=NormalCapturePending(continuation);pending=item
                item.timeout=Task { @MainActor [weak self,weak item] in
                    do {try await Task.sleep(for:.seconds(1))}catch{return}
                    item?.finish(.failure(RoutedNormalCaptureFailure.replyTimeout));self?.close(.replyTimeout);self?.onLost?(.replyTimeout)
                }
                let reply:(Data?,String?)->Void={ [weak self] bytes,error in Task { @MainActor in
                    guard let self,self.isOpen,self.pending===item else {item.finish(.failure(RoutedNormalCaptureFailure.transportLost));return}
                    self.pending=nil
                    if let error {
                        let reason=RoutedNormalCaptureFailure(rawValue:error) ?? .invalidReply
                        item.finish(.failure(reason));self.close(reason);self.onLost?(reason);return
                    }
                    guard let bytes,!bytes.isEmpty,bytes.count<=8192 else{item.finish(.failure(RoutedNormalCaptureFailure.invalidReply));self.close(.invalidReply);self.onLost?(.invalidReply);return}
                    item.finish(.success(bytes))
                } }
                switch q.operation {
                case "capture":proxy.captureNormalArtifact(data,withReply:reply)
                case "current":proxy.currentNormalArtifact(data,withReply:reply)
                case "retire":proxy.retireNormalArtifact(data,withReply:reply)
                default:pending=nil;item.finish(.failure(RoutedNormalCaptureFailure.invalidRequest))
                }
            }
        },onCancel:{ [weak self] in Task { @MainActor in self?.close(.cancelled);self?.onLost?(.cancelled) } })
    }
}
@MainActor private final class NormalCapturePending {
    private var continuation:CheckedContinuation<Data,Error>?
    var timeout:Task<Void,Never>?
    init(_ value:CheckedContinuation<Data,Error>){continuation=value}
    func finish(_ result:Result<Data,Error>){guard let value=continuation else{return};continuation=nil;timeout?.cancel();timeout=nil;value.resume(with:result)}
}
