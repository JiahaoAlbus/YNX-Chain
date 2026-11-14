import Foundation
import Security
import Darwin

/// A normal parent retains its original production qualifier and Root epoch. This
/// registration only scopes one proof child; it supplies no release qualification.
@MainActor public final class RoutedNormalProofParentRegistration {
    public let binding: RoutedNormalProofBinding
    private let qualification: RoutedProductionQualification
    private let preparation: RoutedRootPreparation, client: RoutedIsolationClient
    private let rpc: NormalProofRPC
    private let helperHash: String, providerHash: String
    private let scope: RoutedNormalProofScope
    private let graphRevision: UInt64
    private var sequence: UInt64 = 1, busy = false, closed = false
    private init(binding: RoutedNormalProofBinding, qualification: RoutedProductionQualification,
                 preparation: RoutedRootPreparation, client: RoutedIsolationClient, rpc: NormalProofRPC,
                 helper: String, provider: String, reply: RoutedNormalProofReply) {
        self.binding = binding; self.qualification = qualification; self.preparation = preparation
        self.client = client; self.rpc = rpc; helperHash = helper; providerHash = provider
        scope = reply.scope; graphRevision = reply.graphRevision
    }
    public static func makeBinding(qualification: RoutedProductionQualification, preparation: RoutedRootPreparation,
                                  client: RoutedIsolationClient, profileID: String, profileSHA256: String,
                                  proofRunID: String) throws -> RoutedNormalProofBinding {
        try qualification.requireCurrent(mode: .nym, configuration: preparation.configuration)
        _ = try NormalProofWire.providerPin() // Missing sealed supply fails before any child preparation.
        guard qualification.admission.staticQualificationComplete, qualification.admission.releaseApproved.state == .ready,
              preparation.configuration.mode == .nym else { throw RoutedNormalProofFailure.revoked }
        try preparation.requireValidPreparation()
        let c = preparation.configuration
        // Before the proof child is prepared the full graph cannot yet exist.
        // Binding is DATA only: an idle client with the real deny-only preparation
        // may describe it. register() below independently requires blocked/live.
        guard let receipt = preparation.receipt, [.idle, .blocked].contains(client.current.phase),
              client.configuration.mode == c.mode, client.configuration.runID.utf8.elementsEqual(c.runID.utf8),
              client.configuration.epoch == c.epoch, client.configuration.expectedBrowserSHA256 == c.expectedBrowserSHA256,
              ProtectionLease.hash(try RoutedOwnAuditToken.copy()) == receipt.rootAuditTokenSHA256 else { throw RoutedNormalProofFailure.invalidBinding }
        return try .init(configuration: c, receipt: receipt, profileID: profileID, profileSHA256: profileSHA256, proofRunID: proofRunID)
    }
    public static func register(qualification: RoutedProductionQualification, preparation: RoutedRootPreparation,
                                client: RoutedIsolationClient, binding: RoutedNormalProofBinding, proofURL: URL,
                                responseSHA256: String, helper: PreparedBackendIdentity,
                                readyBackend: OwnedBackendStartGate) async throws -> RoutedNormalProofParentRegistration {
        let expected = try makeBinding(qualification: qualification, preparation: preparation, client: client,
            profileID: binding.profileID, profileSHA256: binding.profileSHA256, proofRunID: binding.proofRunID)
        let live = try client.requireLiveControlLease()
        guard binding == expected, live.phase == .blocked, live.providerGeneration == binding.providerGeneration,
              readyBackend.isRunning, let prepared = readyBackend.prepared,
              let ack = readyBackend.outputDiscardAcknowledgement, ack.runID == binding.rootRunID,
              ack.epoch == binding.epoch, ack.providerGeneration == binding.providerGeneration, ack.pid == prepared.pid,
              RoutedNormalProofBinding.isHash(ack.markerSHA256), ack.backendTokenSHA256 == (try NormalProofWire.pinTokenHash(prepared)) else { throw RoutedNormalProofFailure.invalidBinding }
        let helperHash = try NormalProofWire.pinTokenHash(helper), providerHash = try NormalProofWire.providerPin()
        guard let host = proofURL.host, let origin = URL(string: "https://" + host) else { throw RoutedNormalProofFailure.invalidScope }
        // The port is read from the acknowledged graph by the Provider. A caller
        // cannot turn an arbitrary localhost port into a granted endpoint.
        let proposed = RoutedNormalProofTarget(proofURL: proofURL, reviewedOrigin: origin, responseSHA256: responseSHA256)
        try proposed.validate(binding: binding)
        let rpc = try NormalProofRPC(team: preparation.configuration.teamIdentifier)
        let request = RoutedNormalProofRequest(schema: "P05_NORMAL_PROOF_REQUEST_V1", operation: "register", nonce: UUID().uuidString,
            sequence: 1, binding: binding, ownAuditToken: try RoutedOwnAuditToken.copy(), helperAuditTokenSHA256: helperHash,
            readyBackendAuditTokenSHA256: ack.backendTokenSHA256, readyMarkerSHA256: ack.markerSHA256,
            scope: proposed, requestURL: nil, requestMethod: nil)
        do {
            let started = DispatchTime.now().uptimeNanoseconds, bytes = try JSONEncoder().encode(request)
            let response = try await Task.detached { try rpc.call(bytes, register: true) }.value
            let reply = try NormalProofWire.reply(response, request: request, providerSHA256: providerHash)
            guard DispatchTime.now().uptimeNanoseconds < started + UInt64(reply.leaseMilliseconds) * 1_000_000,
                  reply.scope.proofURL == proposed.proofURL, reply.scope.reviewedOrigin == proposed.reviewedOrigin,
                  reply.scope.responseSHA256 == proposed.responseSHA256 else { throw RoutedNormalProofFailure.revoked }
            _ = try makeBinding(qualification: qualification, preparation: preparation, client: client,
                profileID: binding.profileID, profileSHA256: binding.profileSHA256, proofRunID: binding.proofRunID)
            let fresh = try client.requireLiveControlLease()
            guard fresh.phase == .blocked, fresh.providerGeneration == binding.providerGeneration else { throw RoutedNormalProofFailure.revoked }
            let registration = RoutedNormalProofParentRegistration(binding: binding, qualification: qualification,
                preparation: preparation, client: client, rpc: rpc, helper: helperHash, provider: providerHash, reply: reply)
            rpc.installLostHandler { [weak registration] in Task { @MainActor in registration?.close() } }
            try qualification.installRevocationHandler { [weak registration] in registration?.close() }
            try registration.requireParentCurrent()
            return registration
        } catch { rpc.close(); throw error }
    }
    public func requireLive() async throws {
        guard !closed, !busy else { throw RoutedNormalProofFailure.revoked }; busy = true; defer { busy = false }
        do {
            try requireParentCurrent()
            sequence += 1
            let request = RoutedNormalProofRequest(schema: "P05_NORMAL_PROOF_REQUEST_V1", operation: "parent-status", nonce: UUID().uuidString,
                sequence: sequence, binding: binding, ownAuditToken: try RoutedOwnAuditToken.copy(), helperAuditTokenSHA256: helperHash,
                readyBackendAuditTokenSHA256: nil, readyMarkerSHA256: nil, scope: nil, requestURL: nil, requestMethod: nil)
            let started = DispatchTime.now().uptimeNanoseconds, channel = rpc, data = try JSONEncoder().encode(request)
            let reply = try NormalProofWire.reply(try await Task.detached { try channel.call(data, register: true) }.value,
                request: request, providerSHA256: providerHash)
            guard reply.scope == scope, reply.graphRevision == graphRevision,
                  DispatchTime.now().uptimeNanoseconds < started + UInt64(reply.leaseMilliseconds) * 1_000_000 else { throw RoutedNormalProofFailure.revoked }
            try requireParentCurrent()
        } catch { close(); throw error }
    }
    private func requireParentCurrent() throws {
        guard !closed else { throw RoutedNormalProofFailure.revoked }
        try rpc.requireLive()
        try qualification.requireCurrent(mode: .nym, configuration: preparation.configuration)
        try preparation.requireValidPreparation()
        let live = try client.requireLiveControlLease()
        guard [.blocked, .routeEntryConnected].contains(live.phase), live.providerGeneration == binding.providerGeneration,
              preparation.receipt?.rootAuditTokenSHA256 == binding.rootAuditTokenSHA256 else { throw RoutedNormalProofFailure.revoked }
    }
    public func close() { closed = true; rpc.close() }
    deinit { rpc.close() }
}

/// Only a matching signed Provider, observing this exact child/full audit token in
/// the registered live graph, can return its scope. Informational argv is not it.
public final class RoutedNormalProofChildAuthority: @unchecked Sendable {
    public let binding: RoutedNormalProofBinding, scope: RoutedNormalProofScope
    private let rpc: NormalProofRPC, ownToken: Data
    private let providerHash: String, helperHash: String, graphRevision: UInt64
    private let state = NSLock(), operations = NSLock()
    private var revoked = false, sequence: UInt64 = 1, deadline: UInt64
    private var timer: DispatchSourceTimer?, handlers: [@Sendable () -> Void] = []
    private init(binding: RoutedNormalProofBinding, reply: RoutedNormalProofReply, token: Data, rpc: NormalProofRPC, provider: String, started: UInt64) {
        self.binding = binding; scope = reply.scope; self.rpc = rpc; ownToken = token
        providerHash = provider; helperHash = ProtectionLease.hash(token); graphRevision = reply.graphRevision
        deadline = started + UInt64(reply.leaseMilliseconds) * 1_000_000
    }
    public static func preflight() throws {
        let team = try NormalProofWire.selfTeam() // Before caller binding, IPC or target bytes.
        guard Bundle.main.bundleIdentifier == "com.ynxweb4.browser.route.nym.probe",
              Bundle.main.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool == true,
              Bundle.main.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") == nil,
              Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil,
              Bundle.main.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool == true else { throw RoutedNormalProofFailure.invalidSignature }
        try NormalProofWire.verifySelf(team: team)
        _ = try NormalProofWire.providerPin()
    }
    public static func begin(binding: RoutedNormalProofBinding) throws -> RoutedNormalProofChildAuthority {
        try preflight(); try binding.validate()
        let team = try NormalProofWire.selfTeam(), token = try RoutedOwnAuditToken.copy(), provider = try NormalProofWire.providerPin()
        let rpc = try NormalProofRPC(team: team)
        let request = RoutedNormalProofRequest(schema: "P05_NORMAL_PROOF_REQUEST_V1", operation: "begin", nonce: UUID().uuidString,
            sequence: 1, binding: binding, ownAuditToken: token, helperAuditTokenSHA256: ProtectionLease.hash(token),
            readyBackendAuditTokenSHA256: nil, readyMarkerSHA256: nil, scope: nil, requestURL: nil, requestMethod: nil)
        do {
            let started = DispatchTime.now().uptimeNanoseconds
            let reply = try NormalProofWire.reply(rpc.call(try JSONEncoder().encode(request), register: false), request: request, providerSHA256: provider)
            let authority = RoutedNormalProofChildAuthority(binding: binding, reply: reply, token: token, rpc: rpc, provider: provider, started: started)
            rpc.installLostHandler { [weak authority] in authority?.revoke() }
            try authority.requireLive()
            let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
            timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
            timer.setEventHandler { [weak authority] in do { try authority?.refresh(operation: "heartbeat", request: nil) } catch { authority?.revoke() } }
            authority.state.lock(); authority.timer = timer; let lost = authority.revoked; authority.state.unlock()
            timer.resume(); if lost { timer.cancel() }
            try authority.requireLive(); return authority
        } catch { rpc.close(); throw error }
    }
    public func requireLive() throws {
        state.lock(); let live = !revoked && DispatchTime.now().uptimeNanoseconds < deadline; state.unlock()
        guard live else { revoke(); throw RoutedNormalProofFailure.revoked }
    }
    public func authorize(request: URLRequest) throws {
        try scope.validate(request, binding: binding); try refresh(operation: "authorize", request: request)
    }
    public func installRevocationHandler(_ callback: @escaping @Sendable () -> Void) {
        state.lock(); let lost = revoked; if !lost { handlers.append(callback) }; state.unlock(); if lost { callback() }
    }
    private func refresh(operation: String, request: URLRequest?) throws {
        operations.lock(); defer { operations.unlock() }
        do {
            try requireLive(); state.lock(); let next = sequence + 1; state.unlock()
            let query = RoutedNormalProofRequest(schema: "P05_NORMAL_PROOF_REQUEST_V1", operation: operation, nonce: UUID().uuidString,
                sequence: next, binding: binding, ownAuditToken: ownToken, helperAuditTokenSHA256: helperHash,
                readyBackendAuditTokenSHA256: nil, readyMarkerSHA256: nil, scope: nil,
                requestURL: request?.url, requestMethod: request == nil ? nil : "GET")
            let started = DispatchTime.now().uptimeNanoseconds
            let reply = try NormalProofWire.reply(rpc.call(try JSONEncoder().encode(query), register: false), request: query, providerSHA256: providerHash)
            guard reply.scope == scope, reply.graphRevision == graphRevision else { throw RoutedNormalProofFailure.invalidBinding }
            state.lock(); if !revoked { sequence = next; deadline = started + UInt64(reply.leaseMilliseconds) * 1_000_000 }
            let live = !revoked && DispatchTime.now().uptimeNanoseconds < deadline; state.unlock()
            guard live else { throw RoutedNormalProofFailure.revoked }
        } catch { revoke(); throw error }
    }
    public func revoke() {
        state.lock(); guard !revoked else { state.unlock(); return }; revoked = true
        let callbacks = handlers; handlers.removeAll(); let oldTimer = timer; timer = nil; state.unlock()
        oldTimer?.cancel(); rpc.close(); for callback in callbacks { callback() }
    }
    deinit { timer?.cancel(); rpc.close() }
}

private enum NormalProofWire {
    static func selfTeam() throws -> String {
        let team = Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? ""
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.signingNotConfigured }; return team
    }
    static func verifySelf(team: String) throws {
        var own: SecCode?, rule: SecRequirement?, code: SecStaticCode?
        let requirement = RoutedIsolationConfiguration.requirement(team: team, identifier: "com.ynxweb4.browser.route.nym.probe")
        guard SecCodeCopySelf([], &own) == errSecSuccess, let own,
              SecRequirementCreateWithString(requirement as CFString, [], &rule) == errSecSuccess, let rule,
              SecCodeCheckValidity(own, [], rule) == errSecSuccess,
              SecCodeCopyStaticCode(own, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), rule) == errSecSuccess else { throw RoutedNormalProofFailure.invalidSignature }
    }
    static func providerPin() throws -> String {
        guard let pin = Bundle.main.object(forInfoDictionaryKey: "YNXRouteFilterProviderSHA256") as? String,
              RoutedNormalProofBinding.isHash(pin) else { throw RoutedNormalProofFailure.missingProviderPin }; return pin
    }
    static func pinTokenHash(_ prepared: PreparedBackendIdentity) throws -> String {
        guard let pin = try JSONSerialization.jsonObject(with: prepared.processPinJSON) as? [String: Any],
              let pid = pin["pid"] as? Int32, pid == prepared.pid, let hex = pin["auditTokenHex"] as? String,
              hex.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw RoutedNormalProofFailure.invalidBinding }
        var token = Data(); var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            guard let byte = UInt8(hex[i..<j], radix: 16) else { throw RoutedNormalProofFailure.invalidBinding }
            token.append(byte); i = j
        }
        return ProtectionLease.hash(token)
    }
    static func reply(_ bytes: Data, request q: RoutedNormalProofRequest, providerSHA256: String) throws -> RoutedNormalProofReply {
        let r = try JSONDecoder().decode(RoutedNormalProofReply.self, from: bytes)
        guard r.schema == "P05_NORMAL_PROOF_LEASE_V1", r.nonce == q.nonce, r.sequence == q.sequence,
              r.binding == q.binding, r.helperAuditTokenSHA256 == q.helperAuditTokenSHA256,
              r.providerSHA256 == providerSHA256, r.graphRevision > 0, (1...750).contains(r.leaseMilliseconds) else { throw RoutedNormalProofFailure.invalidBinding }
        try r.scope.validate(binding: r.binding); return r
    }
}

/// The existing signed Provider is the sole channel peer. Reply bytes without this
/// transport and its exact same-Team code requirement cannot construct a capability.
private final class NormalProofRPC: @unchecked Sendable {
    private let lock = NSLock()
    private var connection: NSXPCConnection?, remote: ScopedNormalProofControl?, valid = true
    private var onLost: (@Sendable () -> Void)?
    init(team: String) throws {
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.signingNotConfigured }
        let xpc = NSXPCConnection(machServiceName: team + ".com.ynxweb4.browser.routefilter.provider", options: .privileged)
        xpc.setCodeSigningRequirement(RoutedIsolationConfiguration.requirement(team: team, identifier: "com.ynxweb4.browser.routefilter.provider"))
        xpc.remoteObjectInterface = NSXPCInterface(with: ScopedNormalProofControl.self)
        connection = xpc
        xpc.invalidationHandler = { [weak self] in self?.lose() }; xpc.interruptionHandler = { [weak self] in self?.lose() }
        guard let proxy = xpc.remoteObjectProxyWithErrorHandler({ [weak self] _ in self?.lose() }) as? ScopedNormalProofControl else { close(); throw RoutedNormalProofFailure.transportLost }
        remote = proxy; xpc.resume()
    }
    func installLostHandler(_ callback: @escaping @Sendable () -> Void) {
        lock.lock(); onLost = callback; let lost = !valid; lock.unlock(); if lost { callback() }
    }
    func requireLive() throws {
        lock.lock(); let live = valid && remote != nil && connection != nil; lock.unlock()
        guard live else { throw RoutedNormalProofFailure.revoked }
    }
    func call(_ data: Data, register: Bool) throws -> Data {
        lock.lock(); let proxy = valid ? remote : nil; lock.unlock()
        guard data.count <= 16384, let proxy else { throw RoutedNormalProofFailure.revoked }
        let pending = NormalProofPending()
        let reply: @Sendable (Data?, String?) -> Void = { data, error in pending.finish(data, error: error) }
        if register { proxy.registerNormalProof(data, withReply: reply) } else { proxy.authorizeNormalProof(data, withReply: reply) }
        guard pending.completed.wait(timeout: .now() + 1) == .success else { lose(); throw RoutedNormalProofFailure.timeout }
        return try pending.result()
    }
    private func lose() { lock.lock(); let notify = valid; valid = false; let callback = onLost; lock.unlock(); if notify { callback?() } }
    func close() { lock.lock(); valid = false; remote = nil; let old = connection; connection = nil; lock.unlock(); old?.invalidate() }
}
private final class NormalProofPending: @unchecked Sendable {
    let completed = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var response: Data?, failed = false, finished = false
    func finish(_ data: Data?, error: String?) {
        lock.lock(); guard !finished else { lock.unlock(); return }; finished = true
        response = data; failed = error != nil || data == nil || (data?.count ?? 0) > 16384
        lock.unlock(); completed.signal()
    }
    func result() throws -> Data { lock.lock(); defer { lock.unlock() }; guard !failed, let response else { throw RoutedNormalProofFailure.revoked }; return response }
}
