import Foundation
import CryptoKit
import YNXBrowserCore

/// Pure requested-DATA versus scope comparisons. No constructor can mint child authority.
@MainActor enum NymNormalProofScopeDeltaChecks {
    static func run() throws -> Int {
        let origin = URL(string: "https://proof.example.com")!
        let url = URL(string: "https://proof.example.com/ynx-route-probe/normal-test/proof")!
        let hash = SHA256.hash(data: Data("synthetic proof only".utf8)).map { String(format: "%02x", $0) }.joined()
        let proof = try NymControlledProbe(url: url, responseSHA256: hash, runID: "normal-test", reviewedOrigin: origin)
        let request = NymProofHelper.Request(port: 19160, runID: "normal-test", origin: origin, proof: proof)
        try NymProofHelper.validateAuthorityScope(request, port: 19160, runID: "normal-test", reviewedOrigin: origin, proofURL: url, responseSHA256: hash)
        var checks = 1
        let mismatches: [(UInt16, String, URL, URL, String)] = [
            (1023, "normal-test", origin, url, hash),
            (19161, "normal-test", origin, url, hash),
            (19160, "other", origin, url, hash),
            (19160, "normal-test", URL(string: "https://other.example.com")!, url, hash),
            (19160, "normal-test", origin, URL(string: "https://proof.example.com/ynx-route-probe/other/proof")!, hash),
            (19160, "normal-test", origin, url, String(repeating: "a", count: 64)),
            (19160, "normal-test", URL(string: "https://proof.example.com/")!, url, hash)
        ]
        for (port, runID, reviewedOrigin, proofURL, responseHash) in mismatches {
            do {
                try NymProofHelper.validateAuthorityScope(request, port: port, runID: runID, reviewedOrigin: reviewedOrigin, proofURL: proofURL, responseSHA256: responseHash)
                preconditionFailure("Mismatched normal child scope DATA accepted")
            } catch NymProtectedFailure.proofFailed { checks += 1 }
        }
        // Actual host lacks a reviewed Team. No caller DATA is parsed and no IPC is used.
        do { try NymProofHelper.selfPreflight(bundle: .main); preconditionFailure("Unsigned host accepted as normal proof helper") }
        catch NymProtectedFailure.signingNotConfigured { checks += 1 }
        // The two IDs deliberately differ in the actual normal caller. Neither is authority.
        let wire: [String: String] = [
            "purpose": "normal-nym-bootstrap-proof", "mode": "nym", "rootRunID": "root-operation",
            "proofRunID": "normal-test", "epoch": UUID().uuidString, "providerGeneration": UUID().uuidString,
            "profileID": "ynx-route-bundled-" + UUID().uuidString.lowercased(),
            "profileSHA256": String(repeating: "b", count: 64), "rootAuditTokenSHA256": String(repeating: "c", count: 64),
            "executableSHA256": String(repeating: "d", count: 64)
        ]
        let binding = try JSONDecoder().decode(RoutedNormalProofBinding.self, from: JSONSerialization.data(withJSONObject: wire))
        let argv = ["probe"] + (try NymNormalProofHelper.arguments(binding: binding, request: request))
        let (parsed, parsedRequest) = try NymNormalProofHelper.parse(argv)
        precondition(parsed.rootRunID == "root-operation" && parsed.proofRunID == "normal-test" && parsedRequest.runID == "normal-test"); checks += 1
        func rejects(_ arguments: [String]) {
            do { _ = try NymNormalProofHelper.parse(arguments); preconditionFailure("Invalid normal child lookup DATA accepted") }
            catch { checks += 1 }
        }
        for (key, value) in [("purpose", "synthetic"), ("mode", "tor"), ("rootRunID", "../root"),
                             ("proofRunID", "other"), ("epoch", "old"), ("providerGeneration", "old"),
                             ("profileID", "ordinary"), ("profileSHA256", "bad"),
                             ("rootAuditTokenSHA256", "bad"), ("executableSHA256", "bad")] {
            var changed = wire; changed[key] = value
            var altered = argv; altered[2] = try JSONSerialization.data(withJSONObject: changed).base64EncodedString()
            rejects(altered)
        }
        for arguments in [Array(argv.dropLast()), argv + ["extra"], ["probe", NymNormalProofHelper.flag, "not base64"],
                          ["probe", NymNormalProofHelper.flag, String(repeating: "A", count: 8193)]] { rejects(arguments) }
        return checks + runFailures()
    }
    static func runFailures() -> Int {
        let failures: [(RoutedNormalProofFailure, NymProtectedFailure)] = [
            (.missingProviderPin, .proofScopeNotSupplied), (.invalidSignature, .identityRejected),
            (.invalidBinding, .proofFailed), (.invalidScope, .proofFailed),
            (.revoked, .proofScopeLost), (.transportLost, .proofScopeLost), (.timeout, .proofScopeLost)
        ]
        for (failure, expected) in failures {
            precondition(NymProtectedRouteProvider.classify(failure, stage: .proof) == expected)
        }
        return failures.count
    }
}
