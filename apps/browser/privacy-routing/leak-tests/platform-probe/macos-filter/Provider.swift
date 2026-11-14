import Foundation
import Network
import NetworkExtension
import Darwin

final class PerConnectionControl: NSObject, ScopedNormalCaptureRoutedControl {
    weak var provider: DataProvider?
    let uid: uid_t, pid: Int32, role: FilterCaller
    let sessionID = UUID()
    weak var normalProofConnection: NSXPCConnection?
    #if YNX_PRIVACY_ACCEPTANCE
    weak var canaryConnection: NSXPCConnection?
    #endif
    init(provider: DataProvider, uid: uid_t, pid: Int32, role: FilterCaller) { self.provider = provider; self.uid = uid; self.pid = pid; self.role = role }
    func enroll(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { reply(nil, "Legacy file enrollment is not authority") }
    func routeState(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { reply(nil, "Legacy ready/state file is not authority") }
    func status(_ run: String, epoch: String, withReply reply: @escaping (Data?, String?) -> Void) { provider?.status(run: run, epoch: epoch, caller: self, reply: reply) }
    func enrollRouted(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.enroll(data, caller: self, reply: reply) }
    func heartbeat(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.heartbeat(data, caller: self, reply: reply) }
    func changeRoute(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.change(data, caller: self, reply: reply) }
    func preEnrollRootDeny(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.preEnroll(data, caller: self, reply: reply) }
    func reviewBootstrapBackendGraph(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.reviewGraph(data, caller: self, reply: reply) }
    func registerNormalProof(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.normalProof(data, register: true, caller: self, reply: reply) }
    func authorizeNormalProof(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.normalProof(data, register: false, caller: self, reply: reply) }
    func captureNormalArtifact(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.normalCapture(data, operation: "capture", caller: self, reply: reply) }
    func currentNormalArtifact(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.normalCapture(data, operation: "current", caller: self, reply: reply) }
    func retireNormalArtifact(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.normalCapture(data, operation: "retire", caller: self, reply: reply) }
}

#if YNX_PRIVACY_ACCEPTANCE
#if YNX_SYNTHETIC_PROVIDER_SELF_FAULT
@objc protocol ScopedAllRoutedProofControl: ScopedSyntheticAcceptanceControl, ScopedNormalProofControl, ScopedNormalCaptureControl, ScopedSyntheticProviderFaultControl {}
#else
@objc protocol ScopedAllRoutedProofControl: ScopedSyntheticAcceptanceControl, ScopedNormalProofControl, ScopedNormalCaptureControl {}
#endif
extension PerConnectionControl: ScopedAllRoutedProofControl {
    #if YNX_SYNTHETIC_PROVIDER_SELF_FAULT
    func armSyntheticProviderSelfFault(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.syntheticProviderSelfFault(data, operation: "arm", caller: self, reply: reply) }
    func commitSyntheticProviderSelfFault(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.syntheticProviderSelfFault(data, operation: "commit", caller: self, reply: reply) }
    #endif
    func registerSyntheticProof(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.syntheticProof(data, register: true, caller: self, reply: reply) }
    func authorizeSyntheticProof(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.syntheticProof(data, register: false, caller: self, reply: reply) }
    func armSyntheticCanary(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.syntheticCanary(data, arm: true, caller: self, reply: reply) }
    func syntheticCanaryStatus(_ data: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.syntheticCanary(data, arm: false, caller: self, reply: reply) }
}
#endif

@objc(DataProvider) final class DataProvider: NEFilterDataProvider, NSXPCListenerDelegate {
    private let lock = NSRecursiveLock()
    private let generation = UUID().uuidString
    // Exact routed app incarnation, not product bundle ID. Tor/Nym contexts never replace one
    // another; unowned Standard app flows return allow before endpoint/payload access.
    private var contexts: [Data: FilterRunContext] = [:]
    private var backendOwners: [Data: Data] = [:]
    private var backendDenies = KnownBackendDenyLedger()
    private struct NormalProofGrant {
        let root: Data, child: ProcessPin
        var lease: RoutedNormalProofLeaseState
        var parentSequence: UInt64 = 1
    }
    private var normalProofGrants: [Data: NormalProofGrant] = [:]
    private var normalProofKnownTokens: Set<Data> = []
    private var normalProofConnections: [UUID: NSXPCConnection] = [:]
    private var normalProofFilterActive = false
    private var normalCaptureLedger = NormalCaptureLedger()
    private var normalCaptureSessions = NormalCaptureSessionFence()
    #if YNX_PRIVACY_ACCEPTANCE
    private var canaries: [Data: SyntheticCanaryObservation] = [:]
    private var canaryFilterActive = false
    private var canaryConnections: [UUID: NSXPCConnection] = [:]
    private struct ProofGrant { let root: Data, child: ProcessPin; var lease: SyntheticProofLeaseState; var parentSequence: UInt64 = 1 }
    private var proofGrants: [Data: ProofGrant] = [:]
    private var proofKnownTokens: Set<Data> = []
    #if YNX_SYNTHETIC_PROVIDER_SELF_FAULT
    private var providerFaultFence = SyntheticProviderFaultFence()
    #endif
    #endif
    private var listener: NSXPCListener?
    private var watchdog: DispatchSourceTimer?
    private static var now: UInt64 { DispatchTime.now().uptimeNanoseconds }
    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        guard FilterBuild.configured else { completionHandler(FilterFailure.rejected("Signing team unconfigured")); return }
        let rules = [("127.0.0.1", 8), ("::1", 128)].map { host, prefix in NEFilterRule(networkRule: NENetworkRule(remoteNetworkEndpoint: Network.NWEndpoint.hostPort(host: .init(host), port: .any), remotePrefix: prefix, localNetworkEndpoint: nil, localPrefix: 0, protocol: .any, direction: .any), action: .filterData) }
        apply(NEFilterSettings(rules: rules, defaultAction: .filterData)) { [weak self] error in
            guard let self, error == nil else { completionHandler(error); return }
            self.lock.lock(); self.normalProofFilterActive = true; self.lock.unlock()
            #if YNX_PRIVACY_ACCEPTANCE
            self.lock.lock(); self.canaries.removeAll(); self.canaryFilterActive = true; self.lock.unlock()
            #endif
            let service = NSXPCListener(machServiceName: FilterBuild.service); service.delegate = self; self.listener = service; service.resume()
            let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated)); timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100)); timer.setEventHandler { [weak self] in self?.checkLiveness() }; self.watchdog = timer; timer.resume(); completionHandler(nil)
        }
    }
    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        lock.lock(); normalCaptureLedger.closeAll(); normalCaptureSessions.closeAll(); lock.unlock()
        invalidateNormalProofs(disable: true)
        #if YNX_PRIVACY_ACCEPTANCE
        invalidateCanaryObservation()
        #endif
        lock.lock(); for c in contexts.values { block(c, all: true) }; lock.unlock(); watchdog?.cancel(); listener?.invalidate(); completionHandler() }
    override func sleep(completionHandler: @escaping () -> Void) {
        lock.lock(); normalCaptureLedger.closeAll(); normalCaptureSessions.closeAll(); lock.unlock()
        invalidateNormalProofs()
        #if YNX_PRIVACY_ACCEPTANCE
        invalidateCanaryObservation()
        #endif
        blockEveryBrowser(); completionHandler()
    }
    override func wake() {
        lock.lock(); normalCaptureLedger.closeAll(); normalCaptureSessions.closeAll(); lock.unlock()
        invalidateNormalProofs() // No automatic proof-scope restoration after sleep.
        #if YNX_PRIVACY_ACCEPTANCE
        invalidateCanaryObservation() // No automatic restoration of a pre-sleep qualification.
        #endif
        blockEveryBrowser()
    }
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard FilterBuild.configured, connection.effectiveUserIdentifier != 0, let role = FilterCaller.verifiedRole(pid: connection.processIdentifier) else { return false }
        // Public per-message XPC code requirement. PID only selects the role to bind; it is not
        // authorization and no private auditToken/KVC is used.
        connection.setCodeSigningRequirement(role.requirement)
        #if YNX_PRIVACY_ACCEPTANCE
        connection.exportedInterface = NSXPCInterface(with: ScopedAllRoutedProofControl.self)
        #else
        connection.exportedInterface = NSXPCInterface(with: ScopedNormalCaptureRoutedControl.self)
        #endif
        let control = PerConnectionControl(provider: self, uid: connection.effectiveUserIdentifier, pid: connection.processIdentifier, role: role)
        lock.lock(); normalCaptureSessions.open(control.sessionID); lock.unlock()
        connection.exportedObject = control
        control.normalProofConnection = connection
        #if YNX_PRIVACY_ACCEPTANCE
        control.canaryConnection = connection
        #endif
        connection.invalidationHandler = { [weak self] in self?.connectionLost(control.sessionID) }; connection.interruptionHandler = { [weak self] in self?.connectionLost(control.sessionID) }
        connection.resume(); return true
    }
    func preEnroll(_ data: Data, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard data.count <= 16384 else { throw FilterFailure.rejected("Root request too large") }
            let request = try JSONDecoder().decode(RootPreparationRequest.self, from: data), root = try request.materialize(caller: caller)
            guard request.providerGeneration == nil else { throw FilterFailure.rejected("Initial preparation may not reuse an old provider generation") }
            if let old = contexts[root.token] {
                guard RootEpochReplacement.controlsClosed(owner: old.ownerSession, preparation: old.preparationSession) else { throw FilterFailure.rejected("Both prior owner and preparation controls must be observed closed before a new epoch") }
                block(old, all: true)
                #if YNX_PRIVACY_ACCEPTANCE
                canaries.removeValue(forKey: root.token) // Old epoch evidence never transfers to a successor.
                #endif
            }
            guard contexts[root.token] != nil || contexts.count < 64 else { throw FilterFailure.rejected("Root scope quota reached; no implicit unprotect") }
            let context = try FilterRunContext(root: root, request: request); context.preparationSession = caller.sessionID; contexts[root.token] = context; rebuildBackendIndex()
            reply(try JSONEncoder().encode(RootDenyReceipt(schema: "P05_ROOT_DENY_ACK_V1", runID: request.runID, epoch: request.epoch, mode: request.mode, requestNonce: request.requestNonce, requestSequence: request.requestSequence, providerGeneration: generation, rootAuditTokenSHA256: ProtectionLease.hash(root.token))), nil)
        } catch { reply(nil, String(describing: error)) }
    }
    func enroll(_ data: Data, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard data.count <= 131072, case .routed(let mode) = caller.role else { throw FilterFailure.rejected("Routed self enrollment required") }
            let message = try JSONDecoder().decode(RoutedEnrollment.self, from: data), review = try message.materialize(callerMode: mode, callerPID: caller.pid, callerUID: caller.uid, requirement: caller.role.requirement)
            guard let c = contexts[review.browser.token], c.root == review.browser, c.mode == mode, c.runID == review.runID, c.epoch == review.epoch, c.preparationSession != nil, c.ownerSession == nil else { throw FilterFailure.rejected("A matching prior root-only deny fence is mandatory") }
            for b in review.backends { guard backendOwners[b.process.token] == nil else { throw FilterFailure.rejected("Backend process already belongs to another context") } }
            let cache = try VerifiedPinCache(pins: [review.browser] + review.backends.map { $0.process })
            _ = try BootstrapGraphPolicy.validate(current: review, proposed: message.backendReview, connected: false, live: cache.isCurrent, listener: cache.ownsListener)
            // Quota/reuse is checked atomically before replacing current policy. Previously known
            // tokens can never become an unrelated allow or be recycled into a new epoch.
            try backendDenies.rememberNew(review.backends.map { $0.process.token })
            block(c, all: true)
            c.cache = cache; c.rules = ScopedRunRules(review: review, mode: mode); c.ownerSession = caller.sessionID; c.requestSequence = message.lease.requestSequence; c.lastHeartbeat = Self.now; c.graphRevision = 1; c.graphAuthorityValid = true; rebuildBackendIndex()
            reply(try snapshot(c, message.lease), nil) // Always blocked; never WebKit admission.
        } catch { reply(nil, String(describing: error)) }
    }
    private func context(_ request: ProtectionLeaseRequest, caller: PerConnectionControl) throws -> FilterRunContext {
        guard case .routed(let mode) = caller.role, let c = contexts.values.first(where: { $0.ownerSession == caller.sessionID }), c.preparationSession != nil, c.graphAuthorityValid, c.root.pid == caller.pid, c.mode == mode, request.mode == mode, request.runID == c.runID, request.epoch == c.epoch, request.providerGeneration == generation, UUID(uuidString: request.requestNonce) != nil, request.requestSequence > c.requestSequence, let active = c.rules, Date().timeIntervalSince1970 < active.review.expiresAt, c.cache.isCurrent(c.root) else { throw FilterFailure.rejected("Stale/mismatched/revoked routed lease") }
        c.requestSequence = request.requestSequence; c.lastHeartbeat = Self.now; return c
    }
    private func snapshot(_ c: FilterRunContext, _ request: ProtectionLeaseRequest) throws -> Data {
        refreshEntryFence(c)
        return try JSONEncoder().encode(ProtectionLeaseSnapshot(schema: "P05_PROTECTION_LEASE_V2", runID: c.runID, epoch: c.epoch, mode: c.mode, requestNonce: request.requestNonce, requestSequence: request.requestSequence, providerGeneration: generation, rootAuditTokenSHA256: ProtectionLease.hash(c.root.token), routeSequence: c.rules?.sequence ?? 0, state: c.rules?.connected == true ? "connected" : "blocked", leaseMilliseconds: 750, kernelSourceAppMatches: c.counts["kernelSourceAppExactTokenMatches", default: 0], verifiedWebKitProcessCount: c.webKitTokens.count))
    }
    func heartbeat(_ data: Data, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do { guard data.count <= 4096 else { throw FilterFailure.rejected("Heartbeat too large") }; let request = try JSONDecoder().decode(ProtectionLeaseRequest.self, from: data), c = try context(request, caller: caller); reply(try snapshot(c, request), nil) }
        catch { blockCaller(caller); reply(nil, String(describing: error)) }
    }
    func change(_ data: Data, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard data.count <= 4096 else { throw FilterFailure.rejected("Route request too large") }; let change = try JSONDecoder().decode(ProtectionRouteRequest.self, from: data), c = try context(change.lease, caller: caller)
            guard var active = c.rules else { throw FilterFailure.rejected("No backend review") }
            switch change.state {
            case "connected":
                do {
                    try active.setConnected(sequence: change.routeSequence, userActionReference: change.userActionReference ?? "",
                                            live: c.cache.isCurrent,
                                            listenerGeneration: c.cache.listenerGeneration)
                } catch {
                    c.rules = active
                    if active.entryLossFenced { block(c, all: false) }
                    throw error
                }
            case "blocked": try active.disconnected(sequence: change.routeSequence)
            default: throw FilterFailure.rejected("Invalid route state")
            }
            c.rules = active
            if !active.connected { block(c, all: false) }
            reply(try snapshot(c, change.lease), nil)
        } catch { blockCaller(caller); reply(nil, String(describing: error)) }
    }
    func reviewGraph(_ data: Data, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        var selected: FilterRunContext?
        do {
            guard data.count <= 131072 else { throw FilterFailure.rejected("Graph too large") }; let request = try JSONDecoder().decode(BackendGraphReviewRequest.self, from: data), q = request.context, root = try q.materialize(caller: caller)
            guard let c = contexts[root.token], c.preparationSession == caller.sessionID, c.ownerSession != nil, c.root == root, q.mode == c.mode, q.runID == c.runID, q.epoch == c.epoch, q.providerGeneration == generation, q.requestSequence > c.preparationSequence, Self.now < c.lastHeartbeat + 1_000_000_000 else { throw FilterFailure.rejected("Graph context/lease revoked or stale") }
            selected = c; c.preparationSequence = q.requestSequence; c.graphAuthorityValid = false
            revokeRouteProofs(c)
            try c.replaceBootstrapGraph(request.backendReview)
            drop(c, scope: .entry)
            c.graphAuthorityValid = true
            let eligible = c.rules!.review.backends.filter { !$0.destinations.isEmpty }.map { ProtectionLease.hash($0.process.token) }.sorted()
            reply(try JSONEncoder().encode(BackendGraphAcknowledgement(schema: "P05_BACKEND_GRAPH_ACK_V1", runID: c.runID, epoch: c.epoch, mode: c.mode, requestNonce: q.requestNonce, requestSequence: q.requestSequence, providerGeneration: generation, rootAuditTokenSHA256: ProtectionLease.hash(c.root.token), graphRevision: c.graphRevision, backendAuditTokenSHA256: eligible)), nil)
        } catch {
            // Malformed/replayed requests on this authenticated preparation connection also
            // revoke its last graph, even when decoding failed before selecting a context.
            for c in contexts.values where c === selected || c.preparationSession == caller.sessionID { c.graphAuthorityValid = false; block(c, all: true) }
            reply(nil, String(describing: error))
        }
    }
    func status(run: String, epoch: String, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard case .routed(let mode) = caller.role, let c = contexts.values.first(where: { $0.runID == run && $0.epoch == epoch && $0.root.pid == caller.pid && $0.mode == mode }), c.cache.isCurrent(c.root) else { reply(nil, "No live caller-owned root context"); return }
        refreshEntryFence(c)
        do {
            let ownerClosed = c.ownerSession == nil, prepClosed = c.preparationSession == nil
            let closed = RootEpochReplacement.controlsClosed(owner: c.ownerSession, preparation: c.preparationSession)
            let state: RootControlClosureState = !closed ? .controlsOpen : (!c.graphAuthorityValid && c.rules?.connected != true && c.retained.isEmpty ? .closedDenyOnly : .unknown)
            let closure = RootControlClosureReceipt(schema: "P05_OBSERVED_CONTROL_CLOSURE_V1", runID: run, epoch: epoch, mode: c.mode, providerGeneration: generation, rootAuditTokenSHA256: ProtectionLease.hash(c.root.token), ownerControlClosed: ownerClosed, preparationControlClosed: prepClosed, state: state)
            let closureJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(closure))
            reply(try JSONSerialization.data(withJSONObject: ["schema": "P05_FILTER_RUNTIME_STATUS_V3", "runID": run, "epoch": epoch, "providerGeneration": generation, "graphRevision": c.graphRevision, "state": c.rules?.connected == true ? "connected" : "blocked", "controlClosure": closureJSON, "ownFlowCounts": c.counts, "verifiedWebKitAuditTokens": c.webKitTokens.sorted(), "sourceAppResponsibilityAcceptance": "UNKNOWN_UNTIL_REAL_LS_CANARY", "productionRouteAdmission": false, "osIsolationAcceptance": "NOT_RUN"], options: [.sortedKeys]), nil)
        } catch { reply(nil, String(describing: error)) }
    }
    /// Read-only normal artifact observation. No Root or graph is needed and no
    /// observation in this ledger is consulted by any networking decision.
    func normalCapture(_ data: Data, operation: String, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        do {
            #if YNX_PRIVACY_ACCEPTANCE
            throw RoutedNormalCaptureFailure.qaArtifactRejected
            #else
            lock.lock(); let eligible = normalProofFilterActive && normalCaptureSessions.contains(caller.sessionID); lock.unlock()
            guard eligible, case .routed(let mode) = caller.role else { throw RoutedNormalCaptureFailure.notCurrent }
            let q = try NormalCaptureWire.decode(NormalArtifactRequest.self, data)
            try q.validate(operation: operation)
            guard q.binding.mode == mode else { throw RoutedNormalCaptureFailure.wrongArtifact }
            let token = try Data(strictHex: q.auditTokenHex), live = try PublicIdentity.inspect(token: token, requirement: caller.role.requirement)
            guard live.pid == caller.pid, live.euid == caller.uid else { throw RoutedNormalCaptureFailure.wrongArtifact }
            let path = withUnsafePointer(to: live.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
            let code = withUnsafePointer(to: live.codeDirectoryHash) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
            let executable = URL(fileURLWithPath: path), root = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            guard let bundle = Bundle(url: root), bundle.bundleIdentifier == mode.bundleIdentifier,
                  bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String == FilterBuild.team,
                  bundle.object(forInfoDictionaryKey: "YNXNormalArtifactCaptureRole") as? String == "normal-artifact-observation-v1",
                  bundle.executableURL?.standardizedFileURL == executable.standardizedFileURL else { throw RoutedNormalCaptureFailure.qaArtifactRejected }
            try NormalCaptureRolePolicy.requireNormal(role:bundle.object(forInfoDictionaryKey:"YNXNormalArtifactCaptureRole"),bundleIdentifier:bundle.bundleIdentifier,mode:mode)
            try NormalCaptureArtifactReader.seal(root, requirement: caller.role.requirement)
            let helper = root.appendingPathComponent("Contents/Helpers/YNXBackendStartGate")
            try NormalCaptureArtifactReader.seal(helper, requirement: FilterBuild.requirement(identifier: "com.ynxweb4.browser.route-start-gate"))
            let helperHash = try NormalCaptureArtifactReader.digest(helper)
            guard bundle.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String == helperHash,
                  let providerExecutable = Bundle.main.executableURL else { throw RoutedNormalCaptureFailure.wrongArtifact }
            try NormalCaptureArtifactReader.seal(Bundle.main.bundleURL, requirement: FilterBuild.requirement(identifier: FilterBuild.providerIdentifier))
            let providerHash = try NormalCaptureArtifactReader.digest(providerExecutable)
            guard bundle.object(forInfoDictionaryKey: "YNXRouteFilterProviderSHA256") as? String == providerHash else { throw RoutedNormalCaptureFailure.wrongArtifact }
            let actual = NormalArtifactBinding(mode: mode, team: FilterBuild.team, bundleID: mode.bundleIdentifier,
                browserSHA256: try NormalCaptureArtifactReader.digest(executable), browserCodeHash: code,
                helperSHA256: helperHash, providerSHA256: providerHash, osBuild: ProcessInfo.processInfo.operatingSystemVersionString)
            guard actual == q.binding else { throw RoutedNormalCaptureFailure.wrongArtifact }
            guard try NormalCaptureArtifactReader.codeHash(root) == code else {throw RoutedNormalCaptureFailure.wrongArtifact}
            // Recheck actual post-exec identity and sealed resources after file reads.
            let after = try PublicIdentity.inspect(token: token, requirement: caller.role.requirement)
            guard after.pid == live.pid, after.pidVersion == live.pidVersion,
                  after.startSeconds == live.startSeconds, after.startMicroseconds == live.startMicroseconds else { throw RoutedNormalCaptureFailure.wrongArtifact }
            let afterHash = withUnsafePointer(to: after.sha256) {String(cString:UnsafeRawPointer($0).assumingMemoryBound(to:CChar.self))}
            let afterCode = withUnsafePointer(to: after.codeDirectoryHash) {String(cString:UnsafeRawPointer($0).assumingMemoryBound(to:CChar.self))}
            guard afterHash == actual.browserSHA256, afterCode == code else {throw RoutedNormalCaptureFailure.wrongArtifact}
            try NormalCaptureArtifactReader.seal(root, requirement: caller.role.requirement)
            // No signature/file IO holds the global flow lock. A connection lost
            // during those checks cannot repopulate its retired observation.
            let value:RoutedNormalArtifactObservation
            lock.lock()
            do {
                guard normalProofFilterActive else {throw RoutedNormalCaptureFailure.notCurrent}
                try normalCaptureSessions.requireCurrent(caller.sessionID)
                value = try normalCaptureLedger.handle(q, operation: operation, owner: token, session: caller.sessionID, generation: generation, now: Self.now)
            } catch {lock.unlock();throw error}
            lock.unlock()
            reply(try NormalCaptureWire.encode(value), nil)
            #endif
        } catch { reply(nil, (error as? RoutedNormalCaptureFailure)?.rawValue ?? RoutedNormalCaptureFailure.invalidReply.rawValue) }
    }
    private func revokeNormalProofs(root: Data? = nil, session: UUID? = nil) {
        for (token, grant) in normalProofGrants where (root != nil && grant.root == root) ||
            (session != nil && (grant.lease.parentSession == session || grant.lease.childSession == session)) {
            revokeNormalProof(token)
        }
    }
    private func revokeNormalProof(_ token: Data) {
        guard let grant = normalProofGrants.removeValue(forKey: token) else { return }
        if let c = contexts[grant.root] { drop(c, scope: .process(token)) }
        // These are dedicated scope channels, never the Root owner/preparation
        // channel. Their real loss callback withdraws the child's in-flight I/O.
        var sessions = [grant.lease.parentSession]
        if let child = grant.lease.childSession { sessions.append(child) }
        for session in sessions { normalProofConnections.removeValue(forKey: session)?.invalidate() }
    }
    private func invalidateNormalProofs(disable: Bool = false) {
        lock.lock(); if disable { normalProofFilterActive = false }
        for token in normalProofGrants.keys { revokeNormalProof(token) }
        let connections = Array(normalProofConnections.values); normalProofConnections.removeAll(); lock.unlock()
        for connection in connections { connection.invalidate() }
    }
    func normalProof(_ data: Data, register: Bool, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard normalProofFilterActive, data.count <= 16384 else { throw RoutedNormalProofFailure.revoked }
            let q = try JSONDecoder().decode(RoutedNormalProofRequest.self, from: data), b = q.binding
            try b.validate()
            guard q.schema == "P05_NORMAL_PROOF_REQUEST_V1", b.providerGeneration == generation,
                  let c = contexts.values.first(where: { $0.runID.utf8.elementsEqual(b.rootRunID.utf8) && $0.epoch == b.epoch && $0.mode == b.mode }),
                  c.preparationSession != nil, c.ownerSession != nil, c.graphAuthorityValid, c.cache.isCurrent(c.root),
                  Self.now < c.lastHeartbeat + 1_000_000_000, let active = c.rules, Date().timeIntervalSince1970 < active.review.expiresAt,
                  b.rootAuditTokenSHA256 == ProtectionLease.hash(c.root.token), b.executableSHA256 == c.root.sha256,
                  let helper = active.review.backends.first(where: { $0.role == "nym-helper" && ProtectionLease.hash($0.process.token) == q.helperAuditTokenSHA256 }),
                  c.cache.isCurrent(helper.process), (try? PublicIdentity.inspectCode(token: helper.process.token, requirement: FilterCaller.nymProof.requirement)) != nil,
                  active.review.entries.count == 1, let entry = active.review.entries.first,
                  entry.host == "127.0.0.1", entry.transport == 6,
                  helper.destinations == [entry], let executable = Bundle.main.executableURL else { throw RoutedNormalProofFailure.invalidBinding }
            let sender = try PublicIdentity.inspect(token: q.ownAuditToken, requirement: caller.role.requirement)
            guard sender.pid == caller.pid, sender.euid == caller.uid, UUID(uuidString: q.nonce) != nil else { throw RoutedNormalProofFailure.invalidBinding }
            refreshEntryFence(c)
            guard c.rules?.entryLossFenced == false else { throw RoutedNormalProofFailure.revoked }
            if register && q.operation == "register" {
                guard case .routed(.nym) = caller.role, q.ownAuditToken == c.root.token, !active.proofBootstrapClosed,
                      caller.sessionID != c.ownerSession, caller.sessionID != c.preparationSession,
                      q.sequence == 1, q.requestURL == nil, q.requestMethod == nil,
                      normalProofGrants[helper.process.token] == nil, !normalProofKnownTokens.contains(helper.process.token), normalProofKnownTokens.count < 256,
                      q.readyBackendAuditTokenSHA256 == ProtectionLease.hash(active.review.entryOwner.token),
                      q.readyMarkerSHA256.map(RoutedNormalProofBinding.isHash) == true,
                      let target = q.scope else { throw RoutedNormalProofFailure.invalidBinding }
                try target.validate(binding: b)
                let scope = RoutedNormalProofScope(proofURL: target.proofURL, reviewedOrigin: target.reviewedOrigin,
                    responseSHA256: target.responseSHA256, routePort: entry.port)
                try scope.validate(binding: b)
                guard pinProofEntry(c, entry) else { throw RoutedNormalProofFailure.revoked }
                normalProofKnownTokens.insert(helper.process.token)
                normalProofGrants[helper.process.token] = .init(root: c.root.token, child: helper.process,
                    lease: .init(binding: b, scope: scope, graphRevision: c.graphRevision, parentSession: caller.sessionID))
            } else if register && q.operation == "parent-status" {
                guard case .routed(.nym) = caller.role, q.ownAuditToken == c.root.token,
                      q.scope == nil, q.readyBackendAuditTokenSHA256 == nil, q.readyMarkerSHA256 == nil,
                      q.requestURL == nil, q.requestMethod == nil,
                      var grant = normalProofGrants[helper.process.token], grant.root == c.root.token,
                      grant.lease.binding == b, grant.lease.parentSession == caller.sessionID,
                      grant.parentSequence + 1 == q.sequence, grant.lease.graphRevision == c.graphRevision,
                      grant.lease.authorized, grant.lease.live(now: Self.now) else { throw RoutedNormalProofFailure.revoked }
                grant.parentSequence = q.sequence; normalProofGrants[helper.process.token] = grant
            } else if !register {
                guard case .nymProof = caller.role, q.ownAuditToken == helper.process.token,
                      var grant = normalProofGrants[helper.process.token], grant.root == c.root.token,
                      grant.child == helper.process, grant.lease.graphRevision == c.graphRevision else { throw RoutedNormalProofFailure.invalidBinding }
                try grant.lease.accept(q, session: caller.sessionID, now: Self.now); normalProofGrants[helper.process.token] = grant
            } else { throw RoutedNormalProofFailure.invalidScope }
            guard let grant = normalProofGrants[helper.process.token], grant.lease.binding == b,
                  let connection = caller.normalProofConnection else { throw RoutedNormalProofFailure.revoked }
            normalProofConnections[caller.sessionID] = connection
            let providerSHA256 = ProtectionLease.hash(try Data(contentsOf: executable))
            refreshEntryFence(c)
            guard c.rules?.entryLossFenced == false else { throw RoutedNormalProofFailure.revoked }
            reply(try JSONEncoder().encode(RoutedNormalProofReply(schema: "P05_NORMAL_PROOF_LEASE_V1", nonce: q.nonce, sequence: q.sequence,
                binding: b, helperAuditTokenSHA256: q.helperAuditTokenSHA256, providerSHA256: providerSHA256,
                graphRevision: c.graphRevision, scope: grant.lease.scope, leaseMilliseconds: 750)), nil)
        } catch {
            revokeNormalProofs(session: caller.sessionID)
            if case .nymProof = caller.role {
                for (token, grant) in normalProofGrants where grant.child.pid == caller.pid {
                    revokeNormalProof(token)
                }
            }
            reply(nil, String(describing: error))
        }
    }
    #if YNX_PRIVACY_ACCEPTANCE
    private func revokeSyntheticProof(_ token: Data) {
        guard let grant = proofGrants.removeValue(forKey: token) else { return }
        if let c = contexts[grant.root] { drop(c, scope: .process(token)) }
        // A routed parent can also use this XPC interface for canary observation.
        // Withdraw its grant without closing that channel. The dedicated child loses transport.
        if let session = grant.lease.childSession { canaryConnections.removeValue(forKey: session)?.invalidate() }
    }
    func syntheticProof(_ data: Data, register: Bool, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard canaryFilterActive, data.count <= (register ? 131072 : 8192) else { throw SyntheticTrialFailure.revoked }
            let q = try JSONDecoder().decode(SyntheticProofRequest.self, from: data), b = q.binding
            guard q.schema == "P05_SYNTHETIC_PROOF_REQUEST_V1", b.mode == .nym, b.providerGeneration == generation, b.profileID == "synthetic-" + b.runID,
                  let c = contexts.values.first(where: { $0.runID == b.runID && $0.epoch == b.epoch && $0.mode == b.mode }),
                  c.preparationSession != nil, c.ownerSession != nil, c.graphAuthorityValid, c.cache.isCurrent(c.root),
                  Self.now < c.lastHeartbeat + 1_000_000_000, let active = c.rules, Date().timeIntervalSince1970 < active.review.expiresAt,
                  b.rootAuditTokenSHA256 == ProtectionLease.hash(c.root.token), b.executableSHA256 == c.root.sha256,
                  let observed = canaries[c.root.token], observed.request.binding == b, observed.request.stage == "webkit",
                  Set(observed.drops.values.filter { item in observed.request.targets.contains(where: { $0.id == item.targetID && $0.transport == 6 }) }.map(\.targetID)).count == 2,
                  let helper = active.review.backends.first(where: { $0.role == "nym-helper" && ProtectionLease.hash($0.process.token) == q.helperAuditTokenSHA256 }),
                  c.cache.isCurrent(helper.process), (try? PublicIdentity.inspectCode(token: helper.process.token, requirement: FilterCaller.nymProof.requirement)) != nil,
                  active.review.entries.count == 1, let entry = active.review.entries.first,
                  entry.host == "127.0.0.1", entry.transport == 6,
                  helper.destinations == [entry], let executable = Bundle.main.executableURL else { throw SyntheticTrialFailure.bindingMismatch }
            let sender = try PublicIdentity.inspect(token: q.ownAuditToken, requirement: caller.role.requirement)
            guard sender.pid == caller.pid, sender.euid == caller.uid else { throw SyntheticTrialFailure.bindingMismatch }
            refreshEntryFence(c)
            guard c.rules?.entryLossFenced == false else { throw SyntheticTrialFailure.revoked }
            if register && q.operation == "parent-status" {
                guard case .routed(.nym) = caller.role, q.ownAuditToken == c.root.token,
                      q.schema == "P05_SYNTHETIC_PROOF_REQUEST_V1", UUID(uuidString: q.nonce) != nil,
                      q.manifest == nil, q.requestURL == nil, q.requestMethod == nil,
                      q.readyBackendAuditTokenSHA256 == nil, q.readyMarkerSHA256 == nil,
                      var grant = proofGrants[helper.process.token], grant.root == c.root.token, grant.lease.binding == b,
                      grant.lease.parentSession == caller.sessionID, grant.parentSequence + 1 == q.sequence,
                      grant.lease.graphRevision == c.graphRevision, grant.lease.authorized, grant.lease.live(now: Self.now) else { throw SyntheticTrialFailure.revoked }
                grant.parentSequence = q.sequence; proofGrants[helper.process.token] = grant
            } else if register {
                guard case .routed(.nym) = caller.role, q.ownAuditToken == c.root.token, !active.proofBootstrapClosed,
                      q.operation == "register", q.sequence == 1, UUID(uuidString: q.nonce) != nil,
                      q.requestURL == nil, q.requestMethod == nil, proofGrants[helper.process.token] == nil, !proofKnownTokens.contains(helper.process.token), proofKnownTokens.count < 256,
                      q.readyBackendAuditTokenSHA256 == ProtectionLease.hash(active.review.entryOwner.token),
                      q.readyMarkerSHA256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                      let manifest = q.manifest, manifest.count <= 65536, ProtectionLease.hash(manifest) == b.manifestSHA256,
                      let dictionary = try JSONSerialization.jsonObject(with: manifest) as? [String: Any],
                      let paths = dictionary["paths"] as? [String:String], let path = paths["proof"] else { throw SyntheticTrialFailure.bindingMismatch }
                let scope = try SyntheticTrialScope.read(manifest, runID: b.runID, bootstrapSHA256: b.bootstrapSHA256)
                guard path.hasPrefix(scope.noncePrefix), !path.contains(".."), !path.contains("%"), !path.contains("?"), !path.contains("#"),
                      let url = URL(string: scope.origins[0].absoluteString + path + "?probe=baseline-https") else { throw SyntheticTrialFailure.invalidScope }
                try scope.validate(URLRequest(url: url))
                guard pinProofEntry(c, entry) else { throw SyntheticTrialFailure.revoked }
                let childScope = SyntheticProofChildScope(proofURL: url, responseSHA256: scope.responseSHA256, routePort: entry.port, origins: scope.origins)
                let lease = SyntheticProofLeaseState(binding: b, scope: childScope, graphRevision: c.graphRevision, parentSession: caller.sessionID)
                proofKnownTokens.insert(helper.process.token); proofGrants[helper.process.token] = .init(root: c.root.token, child: helper.process, lease: lease)
                guard let connection = caller.canaryConnection else { throw SyntheticTrialFailure.revoked }; canaryConnections[caller.sessionID] = connection
            } else {
                guard case .nymProof = caller.role, q.ownAuditToken == helper.process.token,
                      var grant = proofGrants[helper.process.token], grant.root == c.root.token, grant.child == helper.process,
                      grant.lease.graphRevision == c.graphRevision else { throw SyntheticTrialFailure.bindingMismatch }
                try grant.lease.accept(q, session: caller.sessionID, now: Self.now); proofGrants[helper.process.token] = grant
                guard let connection = caller.canaryConnection else { throw SyntheticTrialFailure.revoked }; canaryConnections[caller.sessionID] = connection
            }
            guard let grant = proofGrants[helper.process.token], grant.lease.binding == b else { throw SyntheticTrialFailure.revoked }
            let providerSHA256 = ProtectionLease.hash(try Data(contentsOf: executable))
            refreshEntryFence(c)
            guard c.rules?.entryLossFenced == false else { throw SyntheticTrialFailure.revoked }
            reply(try JSONEncoder().encode(SyntheticProofReply(schema: "P05_SYNTHETIC_PROOF_LEASE_V1", nonce: q.nonce, sequence: q.sequence,
                binding: b, helperAuditTokenSHA256: q.helperAuditTokenSHA256, providerSHA256: providerSHA256,
                graphRevision: c.graphRevision, scope: grant.lease.scope, leaseMilliseconds: 750)), nil)
        } catch {
            // Rejected child calls cannot keep a prior child lease alive.
            if case .nymProof = caller.role {
                for (token, grant) in proofGrants where grant.child.pid == caller.pid { revokeSyntheticProof(token) }
            }
            reply(nil, String(describing: error))
        }
    }
    private func invalidateCanaryObservation() {
        lock.lock(); canaryFilterActive = false; canaries.removeAll()
        #if YNX_SYNTHETIC_PROVIDER_SELF_FAULT
        providerFaultFence.invalidate()
        #endif
        for token in proofGrants.keys { revokeSyntheticProof(token) }
        let owned = Array(canaryConnections.values); canaryConnections.removeAll(); lock.unlock()
        for connection in owned { connection.invalidate() } // Real transport loss revokes the opaque owner.

    }
    func syntheticCanary(_ data: Data, arm: Bool, caller: PerConnectionControl, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard canaryFilterActive, data.count <= 16384, case .routed(let mode) = caller.role else { throw SyntheticTrialFailure.bindingMismatch }
            let request = try JSONDecoder().decode(SyntheticCanaryRequest.self, from: data), b = request.binding
            guard b.mode == mode, b.providerGeneration == generation,
                  let c = contexts.values.first(where: { $0.root.pid == caller.pid && $0.mode == mode && $0.runID == b.runID && $0.epoch == b.epoch }),
                  c.preparationSession != nil, c.cache.isCurrent(c.root), b.rootAuditTokenSHA256 == ProtectionLease.hash(c.root.token),
                  b.executableSHA256 == c.root.sha256, b.profileSHA256 == ProtectionLease.hash(Data(b.profileID.utf8)),
                  [b.manifestSHA256,b.bootstrapSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
                  let executable = Bundle.main.executableURL else { throw SyntheticTrialFailure.bindingMismatch }
            if arm {
                if let old = canaries[c.root.token] {
                    guard old.session == caller.sessionID, old.request.binding == b,
                          old.request.stage == "self", request.stage == "webkit", old.drops.count == 4 else { throw SyntheticTrialFailure.canaryNotVerified }
                } else { guard request.stage == "self" else { throw SyntheticTrialFailure.canaryNotVerified } }
                guard let connection = caller.canaryConnection else { throw SyntheticTrialFailure.revoked }
                canaries[c.root.token] = try SyntheticCanaryObservation(request: request, session: caller.sessionID, now: Self.now)
                canaryConnections[caller.sessionID] = connection
            }
            guard let observed = canaries[c.root.token], observed.session == caller.sessionID,
                  observed.request.binding == b, observed.request.nonce == request.nonce, observed.request.stage == request.stage,
                  observed.request.targets == request.targets else { throw SyntheticTrialFailure.bindingMismatch }
            let providerSHA256 = ProtectionLease.hash(try Data(contentsOf: executable))
            refreshEntryFence(c)
            let connected = c.rules?.connected == true && c.graphAuthorityValid && c.ownerSession != nil && Self.now < c.lastHeartbeat + 1_000_000_000
            let entries = c.rules?.review.entries ?? []
            let verified = connected && !entries.isEmpty
            let ports = Set(entries.map(\.port))
            let value = SyntheticCanaryReply(schema: "P05_SYNTHETIC_CANARY_OBSERVED_V1", nonce: request.nonce, stage: request.stage, binding: b,
                providerSHA256: providerSHA256, drops: observed.drops.values.sorted { $0.targetID < $1.targetID },
                routePort: verified && ports.count == 1 ? ports.first : nil, routeSequence: verified ? c.rules?.sequence : nil, routeConnected: verified)
            reply(try JSONEncoder().encode(value), nil)
        } catch { reply(nil, String(describing: error)) }
    }
    #if YNX_SYNTHETIC_PROVIDER_SELF_FAULT
    /// Only a separate explicitly sealed QA provider can expose this selector.
    /// It exits itself; no caller PID, other process, normal route or filter
    /// configuration can be killed. An armed reply is not an applied fault.
    func syntheticProviderSelfFault(_ data: Data, operation: String, caller: PerConnectionControl,
                                    reply: @escaping (Data?, String?) -> Void) {
        do {
            guard SyntheticProviderFaultWire.markerEnabled(Bundle.main.object(forInfoDictionaryKey: SyntheticProviderFaultWire.marker)),
                  case .routed(let mode) = caller.role else { throw SyntheticProviderFaultFailure.notConfigured }
            let q = try SyntheticProviderFaultWire.decode(SyntheticProviderFaultRequest.self, from: data)
            try SyntheticProviderFaultWire.requireRequest(q, operation: operation)
            let root: ProcessPin
            lock.lock()
            guard normalCaptureSessions.contains(caller.sessionID), canaryFilterActive,
                  let c = contexts.values.first(where: { $0.root.pid == caller.pid && $0.mode == mode }) else {
                lock.unlock(); throw SyntheticProviderFaultFailure.revoked
            }
            root = c.root; lock.unlock()
            // Strict full-token peer and self signature/artifact checks happen
            // outside the global flow lock; late session loss is rechecked below.
            let live = try root.verifyLive()
            guard live.pid == caller.pid, live.euid == caller.uid,
                  let executable = Bundle.main.executableURL else { throw SyntheticProviderFaultFailure.invalidBinding }
            try NormalCaptureArtifactReader.seal(Bundle.main.bundleURL, requirement: FilterBuild.requirement(identifier: FilterBuild.providerIdentifier))
            let actualProvider = try NormalCaptureArtifactReader.digest(executable)
            let selfCode = try PublicIdentity.inspect(token: PublicIdentity.ownToken(), requirement: FilterBuild.requirement(identifier: FilterBuild.providerIdentifier))
            let runningHash = withUnsafePointer(to: selfCode.sha256) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
            let runningCode = withUnsafePointer(to: selfCode.codeDirectoryHash) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
            let runningPath = withUnsafePointer(to: selfCode.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
            guard actualProvider == q.expectedProviderSHA256, selfCode.pid == getpid(), runningHash == actualProvider,
                  runningPath == executable.path, try NormalCaptureArtifactReader.codeHash(Bundle.main.bundleURL) == runningCode else {
                throw SyntheticProviderFaultFailure.invalidBinding
            }
            lock.lock(); defer { lock.unlock() }
            try normalCaptureSessions.requireCurrent(caller.sessionID)
            try requireSyntheticProviderFault(q, root: root, caller: caller)
            if operation == "arm" {
                let ticket = try providerFaultFence.arm(q, session: caller.sessionID, now: ContinuousClock.now)
                let result = SyntheticProviderFaultArmReply(schema: "P05_SYNTHETIC_PROVIDER_SELF_FAULT_ARMED_V1", nonce: q.nonce,
                    ticketID: ticket, binding: q.binding, routeSequence: q.routeSequence,
                    providerSHA256: actualProvider, providerPID: getpid(), state: "armed-no-fault")
                reply(try SyntheticProviderFaultWire.encode(result), nil)
            } else {
                try providerFaultFence.consume(q, session: caller.sessionID, now: ContinuousClock.now)
                // No success reply, stopFilter ACK or timers. The only effect is
                // this exact provider's unexpected exit while the guards hold.
                SyntheticProviderFaultExit.terminateSelf()
            }
        } catch { reply(nil, (error as? SyntheticProviderFaultFailure)?.rawValue ?? SyntheticProviderFaultFailure.refused.rawValue) }
    }
    private func requireSyntheticProviderFault(_ q: SyntheticProviderFaultRequest, root: ProcessPin,
                                              caller: PerConnectionControl) throws {
        let b = q.binding
        guard canaryFilterActive, case .routed(let mode) = caller.role, b.mode == mode,
              contexts.count == 1, canaries.count == 1, b.providerGeneration == generation,
              let c = contexts[root.token], c.root == root, c.root.pid == caller.pid, c.mode == mode,
              c.runID == b.runID, c.epoch == b.epoch, c.preparationSession != nil, c.ownerSession != nil,
              c.graphAuthorityValid, c.cache.isCurrent(c.root), Self.now < c.lastHeartbeat + 1_000_000_000,
              b.rootAuditTokenSHA256 == ProtectionLease.hash(root.token), b.executableSHA256 == root.sha256,
              let active = c.rules, Date().timeIntervalSince1970 < active.review.expiresAt,
              !active.review.entries.isEmpty, Set(active.review.entries.map(\.port)).count == 1,
              proofGrants.values.allSatisfy({ $0.root == root.token }), normalProofGrants.values.allSatisfy({ $0.root == root.token }),
              let observed = canaries[root.token], observed.request.binding == b, observed.request.stage == "webkit",
              observed.request.targets.filter({ $0.transport == IPPROTO_TCP }).count == 2,
              observed.request.targets.filter({ $0.transport == IPPROTO_TCP }).allSatisfy({ target in
                  guard let drop = observed.drops[target.id] else { return false }
                  return drop.sourceKind == "webkit" && drop.verdict == "drop" && drop.sourceAppSHA256 == b.rootAuditTokenSHA256
              }) else { throw SyntheticProviderFaultFailure.revoked }
        refreshEntryFence(c)
        guard c.rules?.connected == true, c.rules?.sequence == q.routeSequence else { throw SyntheticProviderFaultFailure.revoked }
        // The existing self→WebKit canary transition required all four real
        // self drops. Missing WK UDP under native Lockdown is never fabricated.
    }
    #endif
    #endif
    private func rebuildBackendIndex() { backendOwners = [:]; for (root, c) in contexts { for b in c.rules?.review.backends ?? [] { backendOwners[b.process.token] = root } } }
    private func endpoint(_ value: Network.NWEndpoint?, _ protocol_: Int32) -> FilterEndpoint? { guard let value, case let .hostPort(host, port) = value else { return nil }; return .init(host: String(describing: host), port: port.rawValue, transport: protocol_) }
    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        lock.lock(); defer { lock.unlock() }
        let scope = backendDenies.scope(sourceApp: flow.sourceAppAuditToken, sourceProcess: flow.sourceProcessAuditToken, activeBackendOwners: backendOwners, roots: Set(contexts.keys))
        let key: Data
        switch scope {
        case .retiredOwnedDeny: return .drop() // No endpoint/payload read, including UNKNOWN backend.
        case .unrelatedAllow: return .allow() // No other-app endpoint/payload read.
        case .activeRoot(let root): key = root
        }
        guard let c = contexts[key] else { return .drop() }
        if flow.sourceAppAuditToken == c.root.token { c.counts["kernelSourceAppExactTokenMatches", default: 0] += 1 }
        #if YNX_PRIVACY_ACCEPTANCE
        if canaryFilterActive, var observation = canaries[key], c.preparationSession != nil, c.cache.isCurrent(c.root),
           let socket = flow as? NEFilterSocketFlow, socket.direction == .outbound,
           let remote = endpoint(socket.remoteFlowEndpoint, socket.socketProtocol),
           let app = socket.sourceAppAuditToken, let process = socket.sourceProcessAuditToken,
           observation.observedDrop(host: remote.host, port: remote.port, transport: remote.transport, flowID: socket.identifier,
               sourceApp: app, sourceProcess: process, trustedWebKit: PublicIdentity.trustedWebKit, now: Self.now) {
            canaries[key] = observation
            c.counts["syntheticActualCallbackDrop", default: 0] += 1
            return .drop()
        }
        #endif
        guard var active = c.rules, c.graphAuthorityValid, c.ownerSession != nil, c.preparationSession != nil, Self.now < c.lastHeartbeat + 1_000_000_000, let socket = flow as? NEFilterSocketFlow else { c.counts["preEnrollOrRevokedDrop", default: 0] += 1; return .drop() }
        let localEndpoint = endpoint(socket.localFlowEndpoint, socket.socketProtocol)
        let remoteEndpoint = endpoint(socket.remoteFlowEndpoint, socket.socketProtocol)
        let sourceProcess = socket.sourceProcessAuditToken
        let direction: ScopedRunRules.Direction = socket.direction == .outbound ? .outbound : .inbound
        let verdict = active.decision(sourceApp: socket.sourceAppAuditToken, sourceProcess: sourceProcess, endpoint: remoteEndpoint, localEndpoint: localEndpoint, direction: direction, live: c.cache.isCurrent, listener: c.cache.ownsListener, listenerGeneration: c.cache.listenerGeneration, proofAuthorized: { proofFlowAuthorized($0, entry: $1, in: c) }, webKit: { token in guard PublicIdentity.trustedWebKit(token) else { return false }; if c.webKitTokens.count < 16 { c.webKitTokens.insert(token.hex) }; return true })
        c.counts[verdict.rawValue, default: 0] += 1
        switch verdict {
        case .entryListenerLost:
            c.rules = active // Heartbeat reads the same epoch and route sequence as blocked.
            block(c, all: false)
            return .drop()
        case .ownedDrop: return .drop()
        case .unownedAllow: return .drop() // A selected known app with missing process identity stays owned.
        case .browserProxyAllow, .backendEntryAcceptAllow, .backendListenerAllow, .backendExactEndpointAllow:
            let entryTraffic = active.isEntryFlow(verdict, local: localEndpoint, remote: remoteEndpoint, direction: direction)
            guard c.retained.retain(socket, id: socket.identifier, entry: entryTraffic, process: sourceProcess) else { return .drop() }
            return .allow()
        }
    }
    private func proofFlowAuthorized(_ child: ProcessPin, entry: FilterEndpoint, in c: FilterRunContext) -> Bool {
        let token = child.token, root = c.root.token, now = Self.now
        if normalProofKnownTokens.contains(token) {
            guard normalProofFilterActive, let grant = normalProofGrants[token] else { return false }
            #if YNX_PRIVACY_ACCEPTANCE
            guard !proofKnownTokens.contains(token) else { return false }
            #endif
            return ProofFlowBinding(child: grant.child, root: grant.root, graphRevision: grant.lease.graphRevision,
                                    port: grant.lease.scope.routePort)
                .authorizes(child: child, root: root, graphRevision: c.graphRevision, port: entry.port,
                            authorized: grant.lease.authorized, live: grant.lease.live(now: now))
        }
        #if YNX_PRIVACY_ACCEPTANCE
        if canaryFilterActive, let grant = proofGrants[token] {
            return ProofFlowBinding(child: grant.child, root: grant.root, graphRevision: grant.lease.graphRevision,
                                    port: grant.lease.scope.routePort)
                .authorizes(child: child, root: root, graphRevision: c.graphRevision, port: entry.port,
                            authorized: grant.lease.authorized, live: grant.lease.live(now: now))
        }
        #endif
        return false
    }
    private func drop(_ c: FilterRunContext, scope: RetainedRouteFlows<NEFilterSocketFlow>.Scope) {
        for socket in c.retained.take(scope) { update(socket, using: .drop(), for: .any) }
    }
    private func revokeRouteProofs(_ c: FilterRunContext) {
        revokeNormalProofs(root: c.root.token)
        #if YNX_PRIVACY_ACCEPTANCE
        for (token, grant) in proofGrants where grant.root == c.root.token {
            revokeSyntheticProof(token)
        }
        #endif
    }
    private func block(_ c: FilterRunContext, all: Bool) {
        c.rules?.block()
        revokeRouteProofs(c)
        drop(c, scope: all ? .all : .entry)
    }
    // Called with the Provider lock held, before emitting health or granting proof.
    private func refreshEntryFence(_ c: FilterRunContext) {
        guard var active = c.rules, active.fenceIfListenerChanged(listenerGeneration: c.cache.listenerGeneration) else { return }
        c.rules = active
        block(c, all: false)
    }
    private func pinProofEntry(_ c: FilterRunContext, _ entry: FilterEndpoint) -> Bool {
        guard var rules = c.rules else { return false }
        let pinned = rules.pinNymProofEntry(entry, listenerGeneration: c.cache.listenerGeneration)
        c.rules = rules
        if rules.entryLossFenced { block(c, all: false) }
        return pinned
    }
    private func blockCaller(_ caller: PerConnectionControl) { for c in contexts.values where c.ownerSession == caller.sessionID { block(c, all: false) } }
    private func blockEveryBrowser() { lock.lock(); defer { lock.unlock() }; for c in contexts.values { block(c, all: false) } }
    private func connectionLost(_ session: UUID) {
        lock.lock(); defer { lock.unlock() }
        normalCaptureLedger.close(session: session)
        normalCaptureSessions.close(session)
        revokeNormalProofs(session: session); normalProofConnections.removeValue(forKey: session)
        for c in contexts.values {
            if c.ownerSession == session { c.ownerSession = nil; block(c, all: true) }
            if c.preparationSession == session { c.preparationSession = nil; c.graphAuthorityValid = false; block(c, all: true) }
        }
        #if YNX_PRIVACY_ACCEPTANCE
        #if YNX_SYNTHETIC_PROVIDER_SELF_FAULT
        providerFaultFence.connectionLost(session)
        #endif
        canaries = canaries.filter { $0.value.session != session }
        canaryConnections.removeValue(forKey: session)
        for (token, grant) in proofGrants where grant.lease.parentSession == session || grant.lease.childSession == session {
            revokeSyntheticProof(token)
        }
        #endif
        // Deny-only root contexts remain after IPC loss; no close operation silently unprotects.
    }
    private func checkLiveness() {
        lock.lock(); defer { lock.unlock() }
        normalCaptureLedger.expire(now: Self.now)
        for (token, grant) in normalProofGrants {
            guard let c = contexts[grant.root], c.graphAuthorityValid, c.ownerSession != nil, c.preparationSession != nil,
                  c.cache.isCurrent(grant.child), grant.lease.graphRevision == c.graphRevision,
                  grant.lease.childSession == nil || grant.lease.live(now: Self.now) else {
                revokeNormalProof(token); continue
            }
        }
        #if YNX_PRIVACY_ACCEPTANCE
        for (token, grant) in proofGrants where grant.lease.childSession != nil && !grant.lease.live(now: Self.now) {
            revokeSyntheticProof(token)
        }
        #endif
        for c in contexts.values {
            if !c.cache.isCurrent(c.root) || c.rules.map({ Date().timeIntervalSince1970 >= $0.review.expiresAt }) == true { c.graphAuthorityValid = false; block(c, all: true); continue }
            if c.ownerSession != nil && Self.now > c.lastHeartbeat + 1_000_000_000 { c.graphAuthorityValid = false; block(c, all: true) }
            refreshEntryFence(c)
        }
    }
}
