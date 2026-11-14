#if YNX_PRIVACY_ACCEPTANCE
import Foundation

@objc protocol ScopedSyntheticProofControl {
    func registerSyntheticProof(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func authorizeSyntheticProof(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
}
@objc protocol ScopedSyntheticAcceptanceControl: ScopedSyntheticCanaryControl, ScopedSyntheticProofControl {}

public struct SyntheticProofChildScope: Codable, Equatable, Sendable {
    public let proofURL: URL
    public let responseSHA256: String
    public let routePort: UInt16
    public let origins: [URL]
    func validate(_ request: URLRequest) throws {
        guard request.url == proofURL, (request.httpMethod ?? "GET") == "GET", request.httpBody == nil,
              request.httpBodyStream == nil else { throw SyntheticTrialFailure.targetDenied }
    }
}
struct SyntheticProofRequest: Codable, Sendable {
    let schema: String, operation: String, nonce: String
    let sequence: UInt64
    let binding: SyntheticTrialBinding
    let ownAuditToken: Data
    let helperAuditTokenSHA256: String
    let readyBackendAuditTokenSHA256: String?
    let readyMarkerSHA256: String?
    let manifest: Data?
    let requestURL: URL?
    let requestMethod: String?
}
struct SyntheticProofReply: Codable, Sendable {
    let schema: String, nonce: String
    let sequence: UInt64
    let binding: SyntheticTrialBinding
    let helperAuditTokenSHA256: String, providerSHA256: String
    let graphRevision: UInt64
    let scope: SyntheticProofChildScope
    let leaseMilliseconds: UInt32
}

/// Caller JSON identifies an already registered scope; it does not authorize a socket.
/// This reducer is used only after the real XPC peer/full audit token/SecCode match in Provider.
struct SyntheticProofLeaseState {
    let binding: SyntheticTrialBinding
    let scope: SyntheticProofChildScope
    let graphRevision: UInt64
    let parentSession: UUID
    private(set) var childSession: UUID?
    private(set) var sequence: UInt64 = 0
    private(set) var lastHeartbeat: UInt64 = 0
    private(set) var authorized = false
    mutating func accept(_ request: SyntheticProofRequest, session: UUID, now: UInt64) throws {
        guard request.schema == "P05_SYNTHETIC_PROOF_REQUEST_V1", request.binding == binding,
              request.sequence == sequence + 1, UUID(uuidString: request.nonce) != nil,
              request.manifest == nil, request.readyBackendAuditTokenSHA256 == nil, request.readyMarkerSHA256 == nil else { throw SyntheticTrialFailure.bindingMismatch }
        switch request.operation {
        case "begin": guard childSession == nil, sequence == 0, request.requestURL == nil, request.requestMethod == nil else { throw SyntheticTrialFailure.revoked }; childSession = session
        case "heartbeat": guard childSession == session, live(now: now), request.requestURL == nil, request.requestMethod == nil else { throw SyntheticTrialFailure.revoked }
        case "authorize":
            guard childSession == session, live(now: now), !authorized, let url = request.requestURL, request.requestMethod == "GET" else { throw SyntheticTrialFailure.revoked }
            try scope.validate(URLRequest(url: url)); authorized = true
        default: throw SyntheticTrialFailure.targetDenied
        }
        sequence = request.sequence; lastHeartbeat = now
    }
    func live(now: UInt64) -> Bool { childSession != nil && now >= lastHeartbeat && now - lastHeartbeat < 750_000_000 }
}
#endif
