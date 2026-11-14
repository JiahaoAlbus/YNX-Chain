import Foundation
import NetworkExtension

extension RootPreparationRequest {
    func materialize(caller: PerConnectionControl) throws -> ProcessPin {
        guard schema == "P05_ROOT_PREPARATION_V1", case .routed(let callerMode) = caller.role, mode == callerMode, runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil, UUID(uuidString: epoch) != nil, UUID(uuidString: requestNonce) != nil, requestSequence > 0 else { throw FilterFailure.rejected("Invalid routed root deny context") }
        let token = try Data(strictHex: browser.auditTokenHex), observed = try PublicIdentity.inspect(token: token, requirement: caller.role.requirement)
        guard observed.pid == caller.pid, observed.euid == caller.uid else { throw FilterFailure.rejected("Root token differs from authenticated XPC caller") }
        let pin = ProcessPin(auditTokenHex: browser.auditTokenHex, pid: observed.pid, pidVersion: observed.pidVersion, path: browser.path, sha256: browser.sha256, requirement: caller.role.requirement)
        _ = try pin.verifyLive(); return pin
    }
}
struct BackendGraphReviewRequest: Codable { let context: RootPreparationRequest; let backendReview: RoutedBackendReview }

final class FilterRunContext {
    let root: ProcessPin
    let mode: RoutedIsolationMode
    let runID: String, epoch: String
    var cache: VerifiedPinCache
    var rules: ScopedRunRules?
    var ownerSession: UUID?
    var preparationSession: UUID?
    var graphAuthorityValid = false
    var preparationSequence: UInt64
    var requestSequence: UInt64 = 0
    var lastHeartbeat: UInt64 = 0
    var graphRevision: UInt64 = 0
    var retained = RetainedRouteFlows<NEFilterSocketFlow>()
    var counts: [String: UInt64] = [:]
    var webKitTokens: Set<String> = []
    init(root: ProcessPin, request: RootPreparationRequest) throws {
        self.root = root; mode = request.mode; runID = request.runID; epoch = request.epoch; preparationSequence = request.requestSequence
        cache = try VerifiedPinCache(pins: [root])
    }
    func replaceBootstrapGraph(_ proposed: RoutedBackendReview) throws {
        guard var active = rules else { throw FilterFailure.rejected("No initial reviewed graph") }
        let replacement = try BootstrapGraphPolicy.validate(current: active.review, proposed: proposed, connected: active.connected, live: cache.isCurrent, listener: cache.ownsListener)
        try active.replaceBlockedGraph(replacement); rules = active; graphRevision += 1
    }
}
