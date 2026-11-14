import Foundation
import Network
import NetworkExtension
import CryptoKit

final class PerConnectionControl: NSObject, ScopedFilterControl {
    weak var provider: DataProvider?
    let uid: uid_t
    let sessionID = UUID()
    init(provider: DataProvider, uid: uid_t) { self.provider = provider; self.uid = uid }
    func enroll(_ reviewedJSON: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.enroll(reviewedJSON, callerUID: uid, sessionID: sessionID, reply: reply) }
    func routeState(_ requestJSON: Data, withReply reply: @escaping (Data?, String?) -> Void) { provider?.routeState(requestJSON, callerUID: uid, sessionID: sessionID, reply: reply) }
    func status(_ runID: String, epoch: String, withReply reply: @escaping (Data?, String?) -> Void) { provider?.status(runID: runID, epoch: epoch, callerUID: uid, reply: reply) }
}

@objc(DataProvider) final class DataProvider: NEFilterDataProvider, NSXPCListenerDelegate {
    private let lock = NSRecursiveLock()
    private var rules: ScopedRunRules?
    private var ownerUID: uid_t?
    private var ownerSession: UUID?
    private var enrolledHash: Data?
    private var listener: NSXPCListener?
    private var watchdog: DispatchSourceTimer?
    private var retained: [UUID: (NEFilterSocketFlow, Bool)] = [:] // Bool: Browser/entry flow, not backend transport.
    private var ownCounts: [String: UInt64] = [:]
    private var observedWebKitTokens: Set<String> = []

    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        guard FilterBuild.configured else { completionHandler(FilterFailure.rejected("Unconfigured signing team; filter cannot start")); return }
        // Default non-loopback filterData; explicit loopback rules are mandatory because Apple's
        // NEFilterSettings loopback default is allow and cannot be changed via defaultAction.
        let loop4 = NENetworkRule(remoteNetworkEndpoint: Network.NWEndpoint.hostPort(host: "127.0.0.1", port: .any), remotePrefix: 8, localNetworkEndpoint: nil, localPrefix: 0, protocol: .any, direction: .any)
        let loop6 = NENetworkRule(remoteNetworkEndpoint: Network.NWEndpoint.hostPort(host: "::1", port: .any), remotePrefix: 128, localNetworkEndpoint: nil, localPrefix: 0, protocol: .any, direction: .any)
        let settings = NEFilterSettings(rules: [NEFilterRule(networkRule: loop4, action: .filterData), NEFilterRule(networkRule: loop6, action: .filterData)], defaultAction: .filterData)
        apply(settings) { [weak self] error in
            guard error == nil, let self else { completionHandler(error); return }
            let listener = NSXPCListener(machServiceName: FilterBuild.service); listener.delegate = self; self.listener = listener; listener.resume()
            let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated)); timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250)); timer.setEventHandler { [weak self] in self?.checkLiveness() }; self.watchdog = timer; timer.resume()
            completionHandler(nil)
        }
    }
    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) { blockAllOwned(); watchdog?.cancel(); listener?.invalidate(); completionHandler() }
    override func sleep(completionHandler: @escaping () -> Void) { blockBrowserFlows(); completionHandler() }
    override func wake() { blockBrowserFlows() } // Never reconnect automatically after sleep/wake.

    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard FilterBuild.configured, connection.effectiveUserIdentifier != 0 else { return false }
        // Public per-message code requirement; never use private NSXPC auditToken KVC or PID-only
        // caller authorization. The signed host controls enrollment, not an arbitrary JSON writer.
        connection.setCodeSigningRequirement(FilterBuild.requirement(identifier: FilterBuild.hostIdentifier))
        connection.exportedInterface = NSXPCInterface(with: ScopedFilterControl.self)
        let control = PerConnectionControl(provider: self, uid: connection.effectiveUserIdentifier)
        connection.exportedObject = control
        connection.invalidationHandler = { [weak self] in self?.connectionLost(control.sessionID) }
        connection.interruptionHandler = { [weak self] in self?.connectionLost(control.sessionID) }
        connection.resume(); return true
    }
    private func encodedStatus() throws -> Data {
        try JSONSerialization.data(withJSONObject: ["schema": "P05_FILTER_RUNTIME_STATUS_V1", "runID": rules?.review.runID ?? "", "epoch": rules?.review.epoch ?? "", "sequence": rules?.sequence ?? 0, "connected": rules?.connected ?? false, "ownFlowCounts": ownCounts, "observedVerifiedWebKitAuditTokens": observedWebKitTokens.sorted(), "sourceAppResponsibilityAcceptance": "UNKNOWN_UNTIL_REAL_LS_CANARY", "productionRouteAdmission": false, "osIsolationAcceptance": "NOT_RUN"], options: [.sortedKeys])
    }
    func enroll(_ data: Data, callerUID: uid_t, sessionID: UUID, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard data.count <= 131072 else { throw FilterFailure.rejected("Bounded reviewed enrollment required") }
            let review = try JSONDecoder().decode(ReviewedFilterRun.self, from: data); try review.validate(); try review.verifyLive()
            let root = try review.browser.verifyLive(); guard root.euid == callerUID else { throw FilterFailure.rejected("Browser UID differs from authenticated signed host") }
            for backend in review.backends { guard try backend.process.verifyLive().euid == callerUID else { throw FilterFailure.rejected("Backend UID differs from this reviewed run") } }
            let digest = Data(SHA256.hash(data: data))
            if let old = rules, (try? old.review.browser.verifyLive()) != nil {
                guard ownerSession == nil, ownerUID == callerUID, enrolledHash == digest else { throw FilterFailure.rejected("Existing Browser incarnation/epoch cannot be replaced by another controller") }
                blockAllOwned(); ownerSession = sessionID; reply(try encodedStatus(), nil); return
            }
            blockAllOwned(); rules = ScopedRunRules(review: review); ownerUID = callerUID; ownerSession = sessionID; enrolledHash = digest; ownCounts = [:]; observedWebKitTokens = []
            reply(try encodedStatus(), nil)
        } catch { reply(nil, String(describing: error)) }
    }
    func routeState(_ data: Data, callerUID: uid_t, sessionID: UUID, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard data.count <= 4096, ownerUID == callerUID, ownerSession == sessionID, var active = rules else { throw FilterFailure.rejected("No caller/session-owned enrolled run") }
            let request = try JSONDecoder().decode(RouteStateRequest.self, from: data)
            guard request.runID == active.review.runID, request.epoch == active.review.epoch else { throw FilterFailure.rejected("Stale run/epoch") }
            switch request.state {
            case "connected": try active.setConnected(sequence: request.sequence, userActionReference: request.userActionReference ?? "")
            case "blocked": try active.disconnected(sequence: request.sequence)
            default: throw FilterFailure.rejected("Only connected/blocked states allowed")
            }
            rules = active; if !active.connected { dropRetained(browserOnly: true) }; reply(try encodedStatus(), nil)
        } catch { blockBrowserFlows(); reply(nil, String(describing: error)) }
    }
    func status(runID: String, epoch: String, callerUID: uid_t, reply: @escaping (Data?, String?) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard ownerUID == callerUID, rules?.review.runID == runID, rules?.review.epoch == epoch else { reply(nil, "No caller-owned matching run/epoch"); return }
        do { reply(try encodedStatus(), nil) } catch { reply(nil, String(describing: error)) }
    }
    private func endpoint(_ value: Network.NWEndpoint?, transport: Int32) -> FilterEndpoint? { guard let value, case let .hostPort(host, port) = value else { return nil }; return .init(host: String(describing: host), port: port.rawValue, transport: transport) }
    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        lock.lock(); defer { lock.unlock() }
        guard let active = rules else { return .allow() }
        // Only audit-token identity fields are inspected before scope. No URL, remote endpoint,
        // payload, app-name lookup, flow log or retained object is collected for another app.
        guard active.isPotentiallyOwned(sourceApp: flow.sourceAppAuditToken, sourceProcess: flow.sourceProcessAuditToken) else { return .allow() }
        if flow.sourceAppAuditToken == active.review.browser.token { ownCounts["kernelSourceAppExactTokenMatches", default: 0] += 1 }
        guard let socket = flow as? NEFilterSocketFlow else { return .drop() }
        let decision = active.decision(sourceApp: socket.sourceAppAuditToken, sourceProcess: socket.sourceProcessAuditToken, endpoint: endpoint(socket.remoteFlowEndpoint, transport: socket.socketProtocol), localEndpoint: endpoint(socket.localFlowEndpoint, transport: socket.socketProtocol), direction: socket.direction == .outbound ? .outbound : .inbound, webKit: { [weak self] token in
            guard PublicIdentity.trustedWebKit(token) else { return false }
            if (self?.observedWebKitTokens.count ?? 0) < 16 { self?.observedWebKitTokens.insert(token.hex) }
            return true
        })
        ownCounts[decision.rawValue, default: 0] += 1
        switch decision {
        case .ownedDrop: return .drop()
        case .unownedAllow: return .allow()
        case .browserProxyAllow, .backendEntryAcceptAllow, .backendExactEndpointAllow:
            guard retained.count < 4096 else { return .drop() }
            retained[socket.identifier] = (socket, decision != ScopedRunRules.Verdict.backendExactEndpointAllow)
            return .allow()
        }
    }
    private func dropRetained(browserOnly: Bool) {
        for (id, item) in retained where !browserOnly || item.1 { update(item.0, using: .drop(), for: .any); retained.removeValue(forKey: id) }
    }
    private func blockAllOwned() { lock.lock(); defer { lock.unlock() }; rules?.block(); dropRetained(browserOnly: false) }
    private func blockBrowserFlows() { lock.lock(); defer { lock.unlock() }; rules?.block(); dropRetained(browserOnly: true) }
    private func connectionLost(_ session: UUID) { lock.lock(); defer { lock.unlock() }; guard ownerSession == session else { return }; ownerSession = nil; blockBrowserFlows() }
    private func checkLiveness() {
        lock.lock(); defer { lock.unlock() }
        guard let active = rules else { return }
        if Date().timeIntervalSince1970 >= active.review.expiresAt || (try? active.review.browser.verifyLive()) == nil { blockAllOwned(); return }
        if active.connected && (!active.review.entries.allSatisfy({ PublicIdentity.ownsListener(active.review.entryOwner, endpoint: $0) })) { rules?.block(); dropRetained(browserOnly: true) }
    }
}
