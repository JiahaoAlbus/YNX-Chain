#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import Security
import Darwin

/// Keeps the actual Root registration connection alive. It is not a child capability or ready value.
@MainActor public final class SyntheticProofParentRegistration {
    public let binding: SyntheticTrialBinding
    public let helperAuditTokenSHA256: String
    private let rpc: SyntheticProofRPC
    private weak var authority: SyntheticTrialAuthority?
    private var sequence: UInt64 = 1, busy = false
    private init(binding: SyntheticTrialBinding, helper: String, rpc: SyntheticProofRPC) {
        self.binding = binding; helperAuditTokenSHA256 = helper; self.rpc = rpc
    }
    public static func register(authority: SyntheticTrialAuthority, manifestURL: URL, helperAuditTokenSHA256: String,
                                readyBackend: OwnedBackendStartGate) async throws -> SyntheticProofParentRegistration {
        _ = try authority.requireQualification(); try authority.verify(binding: authority.binding)
        let b = authority.binding, lease = try authority.controlClient.requireLiveControlLease()
        guard b.mode == .nym, lease.phase == .blocked, lease.providerGeneration == b.providerGeneration,
              helperAuditTokenSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              readyBackend.isRunning, let prepared = readyBackend.prepared, let ack = readyBackend.outputDiscardAcknowledgement,
              ack.runID == b.runID, ack.epoch == b.epoch, ack.providerGeneration == b.providerGeneration,
              ack.pid == prepared.pid, let pin = try JSONSerialization.jsonObject(with: prepared.processPinJSON) as? [String: Any],
              let hex = pin["auditTokenHex"] as? String, let token = SyntheticProofWire.token(hex),
              ack.backendTokenSHA256 == ProtectionLease.hash(token), ack.markerSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw SyntheticTrialFailure.bindingMismatch }
        let manifest = try SyntheticProofWire.privateManifest(manifestURL, expectedSHA256: b.manifestSHA256)
        let verifiedScope = try SyntheticTrialScope.read(manifest, runID: b.runID, bootstrapSHA256: b.bootstrapSHA256)
        guard verifiedScope.origins == authority.scope.origins, verifiedScope.responseSHA256 == authority.scope.responseSHA256 else { throw SyntheticTrialFailure.invalidScope }
        let rpc = try SyntheticProofRPC(team: authority.configuration.teamIdentifier)
        let request = SyntheticProofRequest(schema: "P05_SYNTHETIC_PROOF_REQUEST_V1", operation: "register", nonce: UUID().uuidString, sequence: 1,
            binding: b, ownAuditToken: try RoutedOwnAuditToken.copy(), helperAuditTokenSHA256: helperAuditTokenSHA256,
            readyBackendAuditTokenSHA256: ack.backendTokenSHA256, readyMarkerSHA256: ack.markerSHA256,
            manifest: manifest, requestURL: nil, requestMethod: nil)
        do {
            let bytes = try JSONEncoder().encode(request)
            let response = try await Task.detached { try rpc.call(bytes, register: true) }.value
            let reply = try SyntheticProofWire.reply(response, request: request, providerSHA256: try SyntheticProofWire.providerPin())
            try authority.verify(binding: b)
            let fresh = try authority.controlClient.requireLiveControlLease()
            guard fresh.phase == .blocked, fresh.providerGeneration == b.providerGeneration,
                  reply.scope.origins == authority.scope.origins, reply.scope.responseSHA256 == authority.scope.responseSHA256 else { throw SyntheticTrialFailure.bindingMismatch }
            let registration = SyntheticProofParentRegistration(binding: b, helper: helperAuditTokenSHA256, rpc: rpc)
            registration.authority = authority
            try authority.installRevocationHandler { [weak registration] in registration?.close() }
            return registration
        } catch { rpc.close(); throw error }
    }
    /// Call after the actual helper response has been verified, before changing Root to connected.
    public func requireLive() async throws {
        guard !busy, let authority else { throw SyntheticTrialFailure.revoked }; busy = true; defer { busy = false }
        do {
            try authority.verify(binding: binding)
            let live = try authority.controlClient.requireLiveControlLease()
            guard [.blocked, .routeEntryConnected].contains(live.phase), live.providerGeneration == binding.providerGeneration else { throw SyntheticTrialFailure.revoked }
            sequence += 1
            let q = SyntheticProofRequest(schema: "P05_SYNTHETIC_PROOF_REQUEST_V1", operation: "parent-status", nonce: UUID().uuidString, sequence: sequence,
                binding: binding, ownAuditToken: try RoutedOwnAuditToken.copy(), helperAuditTokenSHA256: helperAuditTokenSHA256,
                readyBackendAuditTokenSHA256: nil, readyMarkerSHA256: nil, manifest: nil, requestURL: nil, requestMethod: nil)
            let data = try JSONEncoder().encode(q), channel = rpc
            let started = DispatchTime.now().uptimeNanoseconds
            let bytes = try await Task.detached { try channel.call(data, register: true) }.value
            let reply = try SyntheticProofWire.reply(bytes, request: q, providerSHA256: try SyntheticProofWire.providerPin())
            guard DispatchTime.now().uptimeNanoseconds < started + UInt64(reply.leaseMilliseconds) * 1_000_000 else { throw SyntheticTrialFailure.revoked }
            try authority.verify(binding: binding)
        } catch { close(); throw error }
    }
    public func close() { authority = nil; rpc.close() }
    deinit { rpc.close() }
}

/// Non-UI helper authority obtained only from the real signed Provider channel and real self token.
/// A decoded binding is a lookup constraint, never sufficient to construct this opaque value.
public final class SyntheticProofChildAuthority: @unchecked Sendable {
    public let binding: SyntheticTrialBinding
    public let scope: SyntheticProofChildScope
    private let rpc: SyntheticProofRPC
    private let ownToken: Data, ownHash: String, providerSHA256: String, graphRevision: UInt64
    private let state = NSLock(), operations = NSLock()
    private var sequence: UInt64 = 1, deadline: UInt64
    private var revoked = false, timer: DispatchSourceTimer?
    private var handlers: [@Sendable () -> Void] = []
    private init(binding: SyntheticTrialBinding, reply: SyntheticProofReply, token: Data, rpc: SyntheticProofRPC, provider: String, started: UInt64) {
        self.binding = binding; scope = reply.scope; self.rpc = rpc; ownToken = token; ownHash = ProtectionLease.hash(token)
        providerSHA256 = provider; graphRevision = reply.graphRevision
        deadline = started + UInt64(reply.leaseMilliseconds) * 1_000_000
    }
    /// Checks actual self identity before any supplied binding can lead to IPC or a network request.
    public static func preflight() throws {
        let team = try SyntheticProofWire.selfTeam()
        guard Bundle.main.bundleIdentifier == "com.ynxweb4.browser.route.nym.probe",
              Bundle.main.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool == true,
              Bundle.main.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") == nil,
              Bundle.main.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool == true else { throw SyntheticTrialFailure.invalidSignature }
        try SyntheticProofWire.verifySelf(team: team)
    }
    public static func begin(binding: SyntheticTrialBinding) throws -> SyntheticProofChildAuthority {
        try preflight()
        guard binding.mode == .nym, UUID(uuidString: binding.epoch) != nil, UUID(uuidString: binding.providerGeneration) != nil,
              binding.profileID == "synthetic-" + binding.runID else { throw SyntheticTrialFailure.bindingMismatch }
        let team = try SyntheticProofWire.selfTeam(), token = try RoutedOwnAuditToken.copy(), provider = try SyntheticProofWire.providerPin()
        let rpc = try SyntheticProofRPC(team: team)
        let request = SyntheticProofRequest(schema: "P05_SYNTHETIC_PROOF_REQUEST_V1", operation: "begin", nonce: UUID().uuidString, sequence: 1,
            binding: binding, ownAuditToken: token, helperAuditTokenSHA256: ProtectionLease.hash(token), readyBackendAuditTokenSHA256: nil,
            readyMarkerSHA256: nil, manifest: nil, requestURL: nil, requestMethod: nil)
        do {
            let started = DispatchTime.now().uptimeNanoseconds
            let reply = try SyntheticProofWire.reply(rpc.call(try JSONEncoder().encode(request), register: false), request: request, providerSHA256: provider)
            let authority = SyntheticProofChildAuthority(binding: binding, reply: reply, token: token, rpc: rpc, provider: provider, started: started)
            rpc.installLostHandler { [weak authority] in authority?.revoke() }
            try authority.requireLive()
            let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
            timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
            timer.setEventHandler { [weak authority] in do { try authority?.refresh(operation: "heartbeat", request: nil) } catch { authority?.revoke() } }
            authority.state.lock(); authority.timer = timer; let alreadyLost = authority.revoked; authority.state.unlock(); timer.resume()
            if alreadyLost { timer.cancel() }
            try authority.requireLive()
            return authority
        } catch { rpc.close(); throw error }
    }
    public func installRevocationHandler(_ handler: @escaping @Sendable () -> Void) {
        state.lock(); let lost = revoked; if !lost { handlers.append(handler) }; state.unlock(); if lost { handler() }
    }
    public func requireLive() throws {
        state.lock(); let valid = !revoked && DispatchTime.now().uptimeNanoseconds < deadline; state.unlock()
        guard valid else { revoke(); throw SyntheticTrialFailure.revoked }
    }
    public func authorize(request: URLRequest) throws {
        try scope.validate(request); try refresh(operation: "authorize", request: request)
    }
    private func refresh(operation: String, request: URLRequest?) throws {
        operations.lock(); defer { operations.unlock() }
        do {
            try requireLive()
            state.lock(); let next = sequence + 1; state.unlock()
            let started = DispatchTime.now().uptimeNanoseconds
            let query = SyntheticProofRequest(schema: "P05_SYNTHETIC_PROOF_REQUEST_V1", operation: operation, nonce: UUID().uuidString, sequence: next,
                binding: binding, ownAuditToken: ownToken, helperAuditTokenSHA256: ownHash, readyBackendAuditTokenSHA256: nil,
                readyMarkerSHA256: nil, manifest: nil, requestURL: request?.url, requestMethod: request == nil ? nil : "GET")
            let reply = try SyntheticProofWire.reply(rpc.call(try JSONEncoder().encode(query), register: false), request: query, providerSHA256: providerSHA256)
            guard reply.scope == scope, reply.graphRevision == graphRevision else { throw SyntheticTrialFailure.bindingMismatch }
            let end = started + UInt64(reply.leaseMilliseconds) * 1_000_000
            state.lock(); if !revoked { sequence = next; deadline = end }; let valid = !revoked && DispatchTime.now().uptimeNanoseconds < deadline; state.unlock()
            guard valid else { throw SyntheticTrialFailure.revoked }
        } catch { revoke(); throw error }
    }
    public func revoke() {
        state.lock(); guard !revoked else { state.unlock(); return }; revoked = true
        let callbacks = handlers; handlers.removeAll(); let oldTimer = timer; timer = nil; state.unlock()
        oldTimer?.cancel(); rpc.close(); for callback in callbacks { callback() }
    }
    deinit { timer?.cancel(); rpc.close() }
}

private enum SyntheticProofWire {
    static func selfTeam() throws -> String {
        let team = Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? ""
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.signingNotConfigured }; return team
    }
    static func verifySelf(team: String) throws {
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString("anchor apple generic and certificate leaf[subject.OU] = \"\(team)\" and identifier \"com.ynxweb4.browser.route.nym.probe\"" as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else { throw SyntheticTrialFailure.invalidSignature }
    }
    static func providerPin() throws -> String {
        guard let pin = Bundle.main.object(forInfoDictionaryKey: "YNXAcceptanceProviderSHA256") as? String,
              pin.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw SyntheticTrialFailure.missingPins }; return pin
    }
    static func token(_ text: String) -> Data? {
        guard text.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        var bytes = [UInt8](); var i = text.startIndex
        while i < text.endIndex { let j = text.index(i, offsetBy: 2); guard let byte = UInt8(text[i..<j], radix: 16) else { return nil }; bytes.append(byte); i = j }; return Data(bytes)
    }
    static func reply(_ bytes: Data, request: SyntheticProofRequest, providerSHA256: String) throws -> SyntheticProofReply {
        let r = try JSONDecoder().decode(SyntheticProofReply.self, from: bytes)
        guard r.schema == "P05_SYNTHETIC_PROOF_LEASE_V1", r.nonce == request.nonce, r.sequence == request.sequence,
              r.binding == request.binding, r.helperAuditTokenSHA256 == request.helperAuditTokenSHA256,
              r.providerSHA256 == providerSHA256, r.graphRevision > 0, (1...750).contains(r.leaseMilliseconds),
              r.scope.routePort >= 1024, r.scope.origins.count == 2, r.scope.origins.first?.host == r.scope.proofURL.host,
              r.scope.proofURL.scheme == "https", r.scope.proofURL.path.hasPrefix("/ynx-route-probe/" + r.binding.runID + "/"),
              r.scope.proofURL.query == "probe=baseline-https", r.scope.responseSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw SyntheticTrialFailure.bindingMismatch }
        return r
    }
    static func privateManifest(_ url: URL, expectedSHA256: String) throws -> Data {
        guard url.isFileURL, url.standardizedFileURL == url, url.resolvingSymlinksInPath() == url else { throw SyntheticTrialFailure.invalidScope }
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw SyntheticTrialFailure.invalidScope }; defer { Darwin.close(fd) }
        var st = stat(), dir = stat()
        guard fstat(fd, &st) == 0, st.st_mode & S_IFMT == S_IFREG, st.st_mode & 0o777 == 0o600, st.st_uid == getuid(), st.st_nlink == 1, st.st_size > 0, st.st_size <= 65536,
              lstat(url.deletingLastPathComponent().path, &dir) == 0, dir.st_mode & S_IFMT == S_IFDIR, dir.st_mode & 0o777 == 0o700, dir.st_uid == getuid() else { throw SyntheticTrialFailure.invalidScope }
        let data = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data()
        guard data.count <= 65536, ProtectionLease.hash(data) == expectedSHA256 else { throw SyntheticTrialFailure.invalidScope }; return data
    }
}

/// Thread-safe, bounded public NSXPC transport; no private auditToken/KVC or synchronous proxy.
private final class SyntheticProofRPC: @unchecked Sendable {
    private let lock = NSLock()
    private var connection: NSXPCConnection?, remote: ScopedSyntheticProofControl?, valid = true
    private var onLost: (@Sendable () -> Void)?
    func installLostHandler(_ handler: @escaping @Sendable () -> Void) {
        lock.lock(); onLost = handler; let lost = !valid; lock.unlock(); if lost { handler() }
    }
    init(team: String) throws {
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.signingNotConfigured }
        let id = "com.ynxweb4.browser.routefilter.provider", xpc = NSXPCConnection(machServiceName: team + "." + id, options: .privileged)
        xpc.setCodeSigningRequirement("anchor apple generic and identifier \"\(id)\" and certificate leaf[subject.OU] = \"\(team)\"")
        xpc.remoteObjectInterface = NSXPCInterface(with: ScopedSyntheticProofControl.self)
        connection = xpc
        let lost: @Sendable () -> Void = { [weak self] in self?.lose() }
        xpc.invalidationHandler = lost; xpc.interruptionHandler = lost
        guard let proxy = xpc.remoteObjectProxyWithErrorHandler({ _ in lost() }) as? ScopedSyntheticProofControl else { xpc.invalidate(); throw ProtectionLeaseFailure.transportLost }
        remote = proxy; xpc.resume()
    }
    func call(_ data: Data, register: Bool) throws -> Data {
        lock.lock(); let proxy = valid ? remote : nil; lock.unlock()
        guard let proxy else { throw ProtectionLeaseFailure.transportLost }
        let pending = SyntheticProofPending()
        let reply: @Sendable (Data?, String?) -> Void = { bytes, error in pending.finish(bytes, error: error) }
        if register { proxy.registerSyntheticProof(data, withReply: reply) } else { proxy.authorizeSyntheticProof(data, withReply: reply) }
        guard pending.completed.wait(timeout: .now() + 1) == .success else { lose(); throw ProtectionLeaseFailure.replyTimeout }
        return try pending.result()
    }
    private func lose() { lock.lock(); let notify = valid; valid = false; let callback = onLost; lock.unlock(); if notify { callback?() } }
    func close() { lock.lock(); valid = false; remote = nil; let old = connection; connection = nil; lock.unlock(); old?.invalidate() }
}
private final class SyntheticProofPending: @unchecked Sendable {
    let completed = DispatchSemaphore(value: 0)
    private let lock = NSLock(); private var response: Data?, failed = false
    func finish(_ data: Data?, error: String?) { lock.lock(); response = data; failed = error != nil || data == nil || (data?.count ?? 0) > 16384; lock.unlock(); completed.signal() }
    func result() throws -> Data { lock.lock(); defer { lock.unlock() }; guard !failed, let response else { throw ProtectionLeaseFailure.providerBlocked }; return response }
}
#endif
