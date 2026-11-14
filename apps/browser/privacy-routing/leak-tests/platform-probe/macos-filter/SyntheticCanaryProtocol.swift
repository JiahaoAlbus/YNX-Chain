#if YNX_PRIVACY_ACCEPTANCE
import Foundation

@objc protocol ScopedSyntheticCanaryControl: ScopedRoutedControlV3 {
    func armSyntheticCanary(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func syntheticCanaryStatus(_ request: Data, withReply reply: @escaping (Data?, String?) -> Void)
}
public struct SyntheticTrialEndpoint: Codable, Equatable, Sendable {
    public let host: String
    public let port: UInt16
}
public struct SyntheticTrialBinding: Codable, Equatable, Sendable {
    public let mode: RoutedIsolationMode
    public let runID: String, epoch: String, profileID: String, profileSHA256: String
    public let providerGeneration: String, rootAuditTokenSHA256: String
    public let manifestSHA256: String, bootstrapSHA256: String, executableSHA256: String
}
public struct SyntheticTrialScope: Sendable {
    public let origins: [URL]
    public let noncePrefix: String
    public let ownedSTUN: [SyntheticTrialEndpoint]
    public let responseSHA256: String
    static func read(_ data: Data, runID: String, bootstrapSHA256: String) throws -> Self {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["schema"] as? String == "P05_PUBLIC_NONCE_FIXTURE_V1", value["runID"] as? String == runID,
              let fixture = value["publicFixture"] as? [String: Any], fixture["nonce"] as? String == runID,
              let proof = fixture["responseSHA256"] as? String, proof.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let expected = value["expectedSHA256"] as? [String: String], expected["proof"] == proof,
              let raw = value["origins"] as? [String], raw.count == 2, Set(raw).count == 2,
              let trial = value["trialScope"] as? [String: Any], trial["schema"] as? String == "P05_STRICT_SYNTHETIC_SCOPE_V1",
              trial["bootstrapSHA256"] as? String == bootstrapSHA256,
              let rawSTUN = trial["ownedSTUN"] as? [[String: Any]],
              let bytes = try? JSONSerialization.data(withJSONObject: rawSTUN),
              let stun = try? JSONDecoder().decode([SyntheticTrialEndpoint].self, from: bytes), stun.count == 2,
              Set(stun.map(\.host)) == ["127.0.0.1", "::1"], stun.allSatisfy({ $0.port >= 1024 }) else { throw SyntheticTrialFailure.invalidScope }
        let origins = try raw.map { text -> URL in
            guard let parts = URLComponents(string: text), parts.scheme == "https", let host = parts.host, host.range(of: "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", options: .regularExpression) != nil, !host.hasSuffix(".local"), !host.hasSuffix(".localhost"), parts.port == nil,
                  parts.user == nil, parts.password == nil, parts.path.isEmpty, parts.query == nil, parts.fragment == nil,
                  let url = parts.url, url.absoluteString == text else { throw SyntheticTrialFailure.invalidScope }
            return url
        }
        return Self(origins: origins, noncePrefix: "/ynx-route-probe/\(runID)/", ownedSTUN: stun, responseSHA256: proof)
    }
    public func validate(_ request: URLRequest) throws {
        guard request.httpMethod == nil || request.httpMethod == "GET" || request.httpMethod == "HEAD",
              request.httpBody == nil, request.httpBodyStream == nil,
              let url = request.url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["https", "wss"].contains(parts.scheme ?? ""), parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil, let host = parts.host,
              origins.contains(where: { $0.host == host }), parts.percentEncodedPath.hasPrefix(noncePrefix),
              !parts.percentEncodedPath.contains("%"), !parts.percentEncodedPath.contains(".."),
              let query = parts.queryItems, query.count == 1, query[0].name == "probe", let probe = query[0].value,
              probe.range(of: "^(baseline|fault-retry|user-retry)-(https|long-wss|stream-download|redirect-same|redirect-cross|redirect-http|cross-origin|plain-ws)$", options: .regularExpression) != nil else { throw SyntheticTrialFailure.targetDenied }
    }
}
public enum SyntheticTrialFailure: String, Error, Sendable { case invalidScope, invalidSignature, missingPins, canaryNotVerified, canaryObservedLeak, canaryTimeout, revoked, bindingMismatch, targetDenied, routeNotVerified }

struct SyntheticCanaryTarget: Codable, Equatable, Sendable {
    let id: String, host: String
    let port: UInt16
    let transport: Int32
}
struct SyntheticCanaryRequest: Codable {
    let schema: String, nonce: String, stage: String
    let binding: SyntheticTrialBinding
    let targets: [SyntheticCanaryTarget]
}
struct SyntheticCanaryDrop: Codable, Sendable {
    let targetID: String, flowID: String, sourceAppSHA256: String, sourceProcessSHA256: String
    let sourceKind: String, verdict: String
}
struct SyntheticCanaryReply: Codable {
    let schema: String, nonce: String, stage: String
    let binding: SyntheticTrialBinding
    let providerSHA256: String
    let drops: [SyntheticCanaryDrop]
    let routePort: UInt16?
    let routeSequence: UInt64?
    let routeConnected: Bool
}
#endif
