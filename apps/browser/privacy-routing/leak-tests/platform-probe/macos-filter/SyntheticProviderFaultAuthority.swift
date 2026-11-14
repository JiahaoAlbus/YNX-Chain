#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import Darwin

/// Opaque destructive-test custody, not a privacy qualification. Only a real
/// same-root synthetic authority can arm it over the signed provider channel.
@MainActor public final class SyntheticProviderSelfFaultAttempt {
    public let binding: SyntheticTrialBinding
    public private(set) var firstFailure: SyntheticProviderFaultFailure?
    public private(set) var commitSent = false
    public private(set) var commitIntentSHA256: String?
    public private(set) var armReceiptSHA256 = ""
    public private(set) var providerPID: Int32?
    private let authority: SyntheticTrialAuthority
    private let providerPin: String
    private let nonce = UUID().uuidString.lowercased()
    private let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    private var request: SyntheticProviderFaultRequest?
    private var ticket: String?
    private var connection: NSXPCConnection?
    private var connectionLifetime: SyntheticProviderFaultConnectionLifetime?
    private var proxy: ScopedSyntheticProviderFaultControl?
    private var armPending: SyntheticProviderFaultPending?
    private var terminal: SyntheticProviderSelfFaultOutcome?
    private var worker: Task<SyntheticProviderSelfFaultOutcome, Never>?
    private var localClosing = false
    private var intentAttempted = false
    private init(authority: SyntheticTrialAuthority, providerPin: String) {
        self.authority = authority; binding = authority.binding; self.providerPin = providerPin
    }
    public static func preflight() throws { try SyntheticTrialAuthority.signingPreflight() }
    public static func arm(authority: SyntheticTrialAuthority) async throws -> SyntheticProviderSelfFaultAttempt {
        try preflight() // NoTeam before files/IPC; no caller ready flag exists.
        try Task.checkCancellation() // A cancelled caller cannot consume even the arm-only slot.
        _ = try authority.requireQualification(); let live = try authority.requireLive()
        guard let pin = Bundle.main.object(forInfoDictionaryKey: "YNXAcceptanceProviderSHA256") as? String,
              pin.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw SyntheticProviderFaultFailure.notConfigured }
        let owner = SyntheticProviderSelfFaultAttempt(authority: authority, providerPin: pin)
        do {
            try authority.installRevocationHandler { [weak owner] in owner?.authorityLost() }
            try owner.open()
            let q = SyntheticProviderFaultRequest(schema: "P05_SYNTHETIC_PROVIDER_SELF_FAULT_V1", operation: "arm",
                nonce: owner.nonce, binding: owner.binding, routeSequence: live.routeSequence,
                expectedProviderSHA256: pin, ticketID: nil)
            owner.request = q
            let bytes = try await owner.armRequest(q)
            try Task.checkCancellation(); _ = try authority.requireLive()
            guard ContinuousClock.now < owner.deadline else { throw SyntheticProviderFaultFailure.expired }
            let reply = try SyntheticProviderFaultWire.decode(SyntheticProviderFaultArmReply.self, from: bytes)
            guard reply.schema == "P05_SYNTHETIC_PROVIDER_SELF_FAULT_ARMED_V1", reply.nonce == owner.nonce,
                  reply.binding == owner.binding, reply.routeSequence == live.routeSequence,
                  reply.providerSHA256 == pin, reply.providerPID > 1, reply.state == "armed-no-fault",
                  SyntheticProviderFaultWire.isUUID(reply.ticketID) else { throw SyntheticProviderFaultFailure.invalidBinding }
            owner.ticket = reply.ticketID; owner.providerPID = reply.providerPID
            owner.armReceiptSHA256 = SyntheticProviderFaultWire.hash(bytes)
            return owner
        } catch { owner.fail((error as? SyntheticProviderFaultFailure) ?? .revoked); owner.close(); throw error }
    }

    /// Durable local intent only, never an applied-fault/ready receipt. The
    /// existing dispatcher supplies its canonical private command directory.
    /// A partial/failed exclusive write remains on disk and poisons this owner.
    public func recordCommitIntent(in directory: URL, commandSHA256: String) throws {
        try requireArmed()
        guard !intentAttempted else { throw SyntheticProviderFaultFailure.consumed }
        intentAttempted = true
        do {
            commitIntentSHA256 = try SyntheticFaultCommitIntentJournal.record(in: directory, binding: binding,
                fault: "provider-crash", commandSHA256: commandSHA256, armReceiptSHA256: armReceiptSHA256)
        } catch { fail((error as? SyntheticProviderFaultFailure) ?? .localClosed); close(); throw error }
    }

    /// All callers join one uncancelled bounded observer. Waiter cancellation
    /// does not replay the destructive RPC or discard an UNKNOWN operation.
    public func commitAndObserve() async -> SyntheticProviderSelfFaultOutcome {
        if let worker { return await worker.value }
        if let terminal { return terminal }
        do { try Task.checkCancellation(); try requireArmed() }
        catch { fail((error as? SyntheticProviderFaultFailure) ?? .revoked); close(); return .refused }
        guard commitIntentSHA256 != nil, let q = request, let ticket, let proxy else { fail(.invalidRequest); close(); return .refused }
        let work = Task { @MainActor [self] () -> SyntheticProviderSelfFaultOutcome in
            let commit = SyntheticProviderFaultRequest(schema: q.schema, operation: "commit", nonce: q.nonce,
                binding: q.binding, routeSequence: q.routeSequence, expectedProviderSHA256: q.expectedProviderSHA256, ticketID: ticket)
            do {
                let data = try SyntheticProviderFaultWire.encode(commit)
                commitSent = true // Intent has been fsynced; this is not faultApplied.
                proxy.commitSyntheticProviderSelfFault(data) { [weak self] _, _ in
                    Task { @MainActor in
                        guard let self, self.terminal == nil else { return }
                        self.fail(.refused); self.terminal = .refused // Valid commit has no success reply.
                    }
                }
                let until = ContinuousClock.now.advanced(by: .seconds(2))
                while terminal == nil && ContinuousClock.now < until {
                    try await Task.sleep(for: .milliseconds(10))
                }
                if terminal == nil { fail(.timeout); terminal = .unknown }
            } catch { fail(.invalidRequest); terminal = .unknown }
            let result = terminal ?? .unknown
            authority.revoke() // No target may resume after any commit attempt.
            disposeLocalChannel()
            return result
        }
        worker = work
        return await work.value
    }
    public func close() {
        if commitSent && terminal == nil { return } // Keep only the bounded original observer, no new permissions.
        disposeLocalChannel()
    }
    public func closeAndJoin() async {
        if let worker { _ = await worker.value }
        close()
    }
    private func requireArmed() throws {
        if let firstFailure { throw firstFailure }
        guard !localClosing, !commitSent, ticket != nil, ContinuousClock.now < deadline else { throw SyntheticProviderFaultFailure.expired }
        try authority.verify(binding: binding); _ = try authority.requireLive()
    }
    private func fail(_ reason: SyntheticProviderFaultFailure) { if firstFailure == nil { firstFailure = reason } }
    private func authorityLost() {
        // Existing authority/Native observers already synchronously withdraw
        // network surfaces. During commit retain only this read-only loss wait.
        guard !commitSent else { return }
        fail(.revoked); disposeLocalChannel()
    }
    private func open() throws {
        let xpc = NSXPCConnection(machServiceName: authority.configuration.providerService, options: .privileged)
        xpc.setCodeSigningRequirement(authority.configuration.providerRequirement)
        xpc.remoteObjectInterface = NSXPCInterface(with: ScopedSyntheticProviderFaultControl.self)
        let lost: @Sendable () -> Void = { [weak self] in Task { @MainActor in self?.remoteChannelClosed() } }
        xpc.interruptionHandler = lost; xpc.invalidationHandler = lost; connection = xpc
        connectionLifetime = SyntheticProviderFaultConnectionLifetime(xpc)
        guard let remote = xpc.remoteObjectProxyWithErrorHandler({ [weak self] _ in
            Task { @MainActor in self?.rpcError() } // Error alone is not an observed channel close.
        }) as? ScopedSyntheticProviderFaultControl else { throw SyntheticProviderFaultFailure.transportLost }
        proxy = remote; xpc.resume()
    }
    private func armRequest(_ q: SyntheticProviderFaultRequest) async throws -> Data {
        guard let proxy else { throw SyntheticProviderFaultFailure.transportLost }
        let data = try SyntheticProviderFaultWire.encode(q)
        return try await withCheckedThrowingContinuation { continuation in
            let pending = SyntheticProviderFaultPending(continuation); armPending = pending
            pending.startTimeout(until: deadline)
            proxy.armSyntheticProviderSelfFault(data) { bytes, error in Task { @MainActor in
                if let bytes, error == nil { pending.finish(.success(bytes)) }
                else { pending.finish(.failure(SyntheticProviderFaultFailure.refused)) }
            } }
        }
    }
    private func rpcError() {
        if !commitSent { armPending?.finish(.failure(SyntheticProviderFaultFailure.transportLost)) }
        // A post-commit proxy error waits for an actual interruption/invalidation
        // or the original deadline; it cannot manufacture applied/closed evidence.
    }
    private func remoteChannelClosed() {
        guard !localClosing else { return }
        if commitSent && terminal == nil { terminal = .transportClosedAfterCommit }
        else if !commitSent { fail(.transportLost); armPending?.finish(.failure(SyntheticProviderFaultFailure.transportLost)) }
    }
    private func disposeLocalChannel() {
        guard !localClosing else { return }; localClosing = true
        armPending?.finish(.failure(SyntheticProviderFaultFailure.localClosed)); armPending = nil
        proxy = nil; let old = connection; connection = nil
        old?.interruptionHandler = nil; old?.invalidationHandler = nil; old?.invalidate()
        connectionLifetime = nil
    }
}

// No Sendable/unsafe declaration or isolated-deinit syntax. The nonactor box
// owns only Foundation's thread-safe connection invalidation on final release.
private final class SyntheticProviderFaultConnectionLifetime {
    let connection: NSXPCConnection
    init(_ connection: NSXPCConnection) { self.connection = connection }
    deinit { connection.invalidate() }
}
@MainActor private final class SyntheticProviderFaultPending {
    private var continuation: CheckedContinuation<Data, Error>?
    private var timeout: Task<Void, Never>?
    init(_ continuation: CheckedContinuation<Data, Error>) { self.continuation = continuation }
    func startTimeout(until deadline: ContinuousClock.Instant) {
        timeout = Task { @MainActor [weak self] in
            do { try await ContinuousClock().sleep(until: deadline, tolerance: .zero) } catch { return }
            self?.finish(.failure(SyntheticProviderFaultFailure.timeout))
        }
    }
    func finish(_ value: Result<Data, Error>) {
        guard let original = continuation else { return }; continuation = nil
        timeout?.cancel(); timeout = nil; original.resume(with: value)
    }
    deinit { timeout?.cancel() }
}
#endif
