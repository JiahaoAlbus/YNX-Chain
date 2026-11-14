import Foundation

struct RoutedRootClaim: Codable { let auditTokenHex: String, path: String, sha256: String }
struct RoutedBackendReview: Codable { let entryOwner: ProcessPin; let entries: [FilterEndpoint]; let backends: [BackendPin] }
struct RoutedEnrollment: Codable {
    let schema: String
    let lease: ProtectionLeaseRequest
    let expiresAt: Double
    let browser: RoutedRootClaim
    let backendReview: RoutedBackendReview
    func materialize(callerMode: RoutedIsolationMode, callerPID: Int32, callerUID: uid_t, requirement: String) throws -> ReviewedFilterRun {
        guard schema == "P05_ROUTED_ENROLLMENT_V2", lease.mode == callerMode, lease.providerGeneration == nil, UUID(uuidString: lease.requestNonce) != nil, lease.requestSequence > 0 else { throw FilterFailure.rejected("Routed self-enrollment binding rejected") }
        let token = try Data(strictHex: browser.auditTokenHex), observed = try PublicIdentity.inspect(token: token, requirement: requirement)
        guard observed.pid == callerPID, observed.euid == callerUID else { throw FilterFailure.rejected("Root full audit token is not the authenticated routed XPC caller") }
        let pin = ProcessPin(auditTokenHex: browser.auditTokenHex, pid: observed.pid, pidVersion: observed.pidVersion, path: browser.path, sha256: browser.sha256, requirement: requirement)
        _ = try pin.verifyLive()
        let roles: Set<String> = callerMode == .tor ? ["tor", "arti", "obfs4", "snowflake", "tor-helper"] : ["nym", "nym-helper"]
        guard backendReview.backends.allSatisfy({ roles.contains($0.role) }) else { throw FilterFailure.rejected("Backend role does not belong to this fixed routed mode") }
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: lease.runID, epoch: lease.epoch, expiresAt: expiresAt, browser: pin, entryOwner: backendReview.entryOwner, entries: backendReview.entries, backends: backendReview.backends)
        try review.validate(); try review.verifyLive()
        for backend in review.backends { guard try backend.process.verifyLive().euid == callerUID else { throw FilterFailure.rejected("Backend is not owned by this routed caller UID") } }
        return review
    }
}
enum FilterCaller {
    case host, routed(RoutedIsolationMode)
    // The immutable proof-app identity is shared; normal and QA selectors/scopes
    // are separate and neither grants a production Root qualification.
    case nymProof
    var identifier: String { switch self {
        case .host: return FilterBuild.hostIdentifier
        case .routed(let mode): return mode.bundleIdentifier
        case .nymProof: return "com.ynxweb4.browser.route.nym.probe"
    } }
    var requirement: String { FilterBuild.requirement(identifier: identifier) }
    static func verifiedRole(pid: Int32) -> FilterCaller? {
        let roles = [FilterCaller.host, .routed(.tor), .routed(.nym), .nymProof]
        for role in roles {
            if role.requirement.withCString({ YNXMatchesCodeForPID(pid, $0) }) == 0 { return role }
        }
        return nil
    }
}
