import Foundation

@objc protocol ScopedNormalProofControl {
    func registerNormalProof(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func authorizeNormalProof(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
}
@objc protocol ScopedNormalRoutedControl: ScopedRoutedControlV3, ScopedNormalProofControl {}

public enum RoutedNormalProofFailure: String, Error, Sendable {
    case invalidBinding, invalidScope, missingProviderPin, invalidSignature, revoked, transportLost, timeout
}

/// Lookup DATA only. Decoding or constructing this value grants no authority.
public struct RoutedNormalProofBinding: Codable, Equatable, Sendable {
    public let rootRunID: String, proofRunID: String
    public let mode: RoutedIsolationMode
    public let epoch: String, providerGeneration: String
    public let profileID: String, profileSHA256: String
    public let rootAuditTokenSHA256: String, executableSHA256: String
    public let purpose: String
    init(configuration: RoutedIsolationConfiguration, receipt: RootDenyReceipt,
         profileID: String, profileSHA256: String, proofRunID: String) throws {
        rootRunID = configuration.runID; self.proofRunID = proofRunID; mode = configuration.mode
        epoch = configuration.epoch.uuidString; providerGeneration = receipt.providerGeneration
        self.profileID = profileID; self.profileSHA256 = profileSHA256
        rootAuditTokenSHA256 = receipt.rootAuditTokenSHA256; executableSHA256 = configuration.expectedBrowserSHA256
        purpose = "normal-nym-bootstrap-proof"
        try validate()
    }
    func validate() throws {
        guard mode == .nym, purpose == "normal-nym-bootstrap-proof",
              [rootRunID, proofRunID].allSatisfy({ $0.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil }),
              UUID(uuidString: epoch) != nil, UUID(uuidString: providerGeneration) != nil,
              profileID.range(of: "^[A-Za-z0-9._-]{1,128}$", options: .regularExpression) != nil,
              [profileSHA256, rootAuditTokenSHA256, executableSHA256].allSatisfy(Self.isHash) else { throw RoutedNormalProofFailure.invalidBinding }
    }
    static func isHash(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    public static func == (a: Self, b: Self) -> Bool {
        a.mode == b.mode && zip([a.rootRunID,a.proofRunID,a.epoch,a.providerGeneration,a.profileID,a.profileSHA256,a.rootAuditTokenSHA256,a.executableSHA256,a.purpose],
                               [b.rootRunID,b.proofRunID,b.epoch,b.providerGeneration,b.profileID,b.profileSHA256,b.rootAuditTokenSHA256,b.executableSHA256,b.purpose]).allSatisfy { $0.utf8.elementsEqual($1.utf8) }
    }
}

public struct RoutedNormalProofScope: Codable, Equatable, Sendable {
    public let proofURL: URL, reviewedOrigin: URL
    public let responseSHA256: String
    public let routePort: UInt16
    func validate(binding: RoutedNormalProofBinding) throws {
        guard routePort >= 1024 else { throw RoutedNormalProofFailure.invalidScope }
        try RoutedNormalProofTarget(proofURL: proofURL, reviewedOrigin: reviewedOrigin, responseSHA256: responseSHA256).validate(binding: binding)
    }
    func validate(_ request: URLRequest, binding: RoutedNormalProofBinding) throws {
        try validate(binding: binding)
        guard request.url?.absoluteString.utf8.elementsEqual(proofURL.absoluteString.utf8) == true,
              (request.httpMethod ?? "GET") == "GET", request.httpBody == nil, request.httpBodyStream == nil else { throw RoutedNormalProofFailure.invalidScope }
    }
}
/// Proposed target has no port. Only the Provider can attach its reviewed listener.
struct RoutedNormalProofTarget: Codable, Equatable, Sendable {
    let proofURL: URL, reviewedOrigin: URL
    let responseSHA256: String
    func validate(binding: RoutedNormalProofBinding) throws {
        try binding.validate()
        guard RoutedNormalProofBinding.isHash(responseSHA256),
              let p = URLComponents(url: proofURL, resolvingAgainstBaseURL: false),
              let o = URLComponents(url: reviewedOrigin, resolvingAgainstBaseURL: false),
              p.scheme == "https", o.scheme == "https", p.user == nil, p.password == nil,
              o.user == nil, o.password == nil, p.query == nil, p.fragment == nil,
              o.query == nil, o.fragment == nil, o.path.isEmpty,
              p.port == nil, o.port == nil, let host = p.host, host == o.host,
              Self.publicHostname(host),
              p.percentEncodedPath == "/ynx-route-probe/" + binding.proofRunID + "/proof",
              reviewedOrigin.absoluteString.utf8.elementsEqual(("https://" + host).utf8) else { throw RoutedNormalProofFailure.invalidScope }
    }
    static func publicHostname(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard host.utf8.count <= 253, host == host.lowercased(), labels.count >= 2,
              labels.allSatisfy({ $0.range(of: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", options: .regularExpression) != nil }),
              let last = labels.last, last.range(of: "^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$", options: .regularExpression) != nil,
              !["localhost","local","internal","invalid","test","example","onion","home","arpa"].contains(String(last)) else { return false }
        return true
    }
}
struct RoutedNormalProofRequest: Codable, Sendable {
    let schema: String, operation: String, nonce: String
    let sequence: UInt64
    let binding: RoutedNormalProofBinding
    let ownAuditToken: Data
    let helperAuditTokenSHA256: String
    let readyBackendAuditTokenSHA256: String?, readyMarkerSHA256: String?
    let scope: RoutedNormalProofTarget?
    let requestURL: URL?, requestMethod: String?
}
struct RoutedNormalProofReply: Codable, Sendable {
    let schema: String, nonce: String
    let sequence: UInt64
    let binding: RoutedNormalProofBinding
    let helperAuditTokenSHA256: String, providerSHA256: String
    let graphRevision: UInt64
    let scope: RoutedNormalProofScope
    let leaseMilliseconds: UInt32
}

/// DATA reducer, used only AFTER real signed XPC/full-token/process/Root graph verification.
struct RoutedNormalProofLeaseState {
    let binding: RoutedNormalProofBinding, scope: RoutedNormalProofScope
    let graphRevision: UInt64, parentSession: UUID
    private(set) var childSession: UUID?
    private(set) var sequence: UInt64 = 0, lastHeartbeat: UInt64 = 0
    private(set) var authorized = false
    mutating func accept(_ q: RoutedNormalProofRequest, session: UUID, now: UInt64) throws {
        try binding.validate(); try scope.validate(binding: binding)
        guard q.schema == "P05_NORMAL_PROOF_REQUEST_V1", q.binding == binding,
              q.sequence == sequence + 1, UUID(uuidString: q.nonce) != nil, q.scope == nil,
              q.readyBackendAuditTokenSHA256 == nil, q.readyMarkerSHA256 == nil else { throw RoutedNormalProofFailure.invalidBinding }
        switch q.operation {
        case "begin":
            guard childSession == nil, sequence == 0, q.requestURL == nil, q.requestMethod == nil else { throw RoutedNormalProofFailure.revoked }
            childSession = session
        case "heartbeat":
            guard childSession == session, live(now: now), q.requestURL == nil, q.requestMethod == nil else { throw RoutedNormalProofFailure.revoked }
        case "authorize":
            guard childSession == session, live(now: now), !authorized, let url = q.requestURL, q.requestMethod == "GET" else { throw RoutedNormalProofFailure.revoked }
            try scope.validate(URLRequest(url: url), binding: binding); authorized = true
        default: throw RoutedNormalProofFailure.invalidScope
        }
        sequence = q.sequence; lastHeartbeat = now
    }
    func live(now: UInt64) -> Bool { childSession != nil && now >= lastHeartbeat && now - lastHeartbeat < 750_000_000 }
}
