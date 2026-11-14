import Foundation
import CryptoKit
import YNXBrowserCore

private enum ProbeFailure: Error { case failed(String) }
private func require(_ value: Bool, _ label: String) throws {
    if !value { throw ProbeFailure.failed(label) }
}

@main private struct BackendStartupQualificationProbe {
    @MainActor static func main() {
        do {
            var checks: [String] = []
            #if YNX_ROUTE_BINDING_REDUCER_FIXTURE
            try checkReviewedEntry(&checks)
            #endif
            for mode in PrivacyRouteMode.allCases {
                // Actual normal initializer, not an injected qualification, Team,
                // canary, Root or provider. No accepted object is manufactured.
                do {
                    _ = try BrowserRouteProtection(mode: mode, onLeaseLost: { _ in })
                    throw ProbeFailure.failed("normal-owner-unexpectedly-created")
                } catch RoutedQualificationFailure.signingNotConfigured {
                    checks.append("actual-normal-\(mode)-NoTeam-before-control-owner")
                }
            }
            // This fixture contains the EXACT source of the new wrapper. Its
            // underlying checker ALWAYS rejects. It tests dispatch/fencing only;
            // no opaque qualification or usable protected owner is constructed.
            for mode in PrivacyRouteMode.allCases {
                let ownMode: RoutedIsolationMode = mode == .tor ? .tor : .nym
                let otherMode: PrivacyRouteMode = mode == .tor ? .nym : .tor
                let owned = PublicNegativeStartupDispatch(mode: ownMode)
                try expect(.qualificationIssuerNotSupplied) { try owned.requireBackendStartupQualification(mode: mode) }
                try require(owned.checks == 1, "same-mode-must-reach-fresh-owner-check")
                try expect(.qualificationIssuerNotSupplied) { try owned.requireBackendStartupQualification(mode: mode) }
                try require(owned.checks == 2, "repeated-use-must-not-cache-diagnostic-admission")
                checks.append("DATA-dispatch-\(mode)-same-mode-fresh-check-every-call-denied")

                let foreign = PublicNegativeStartupDispatch(mode: ownMode)
                try expect(.wrongMode) { try foreign.requireBackendStartupQualification(mode: otherMode) }
                try require(foreign.checks == 0, "foreign-mode-reached-owner-check")
                checks.append("DATA-dispatch-\(mode)-wrong-mode-zero-checks")

                let closed = PublicNegativeStartupDispatch(mode: ownMode)
                closed.content.invalidated = true
                try expect(.closed) { try closed.requireBackendStartupQualification(mode: mode) }
                try require(closed.checks == 0, "closed-owner-rechecked-or-reopened")
                checks.append("DATA-dispatch-\(mode)-closed-zero-checks")

                for first in [RoutedQualificationFailure.expired, .revoked, .installationChanged] {
                    let failed = PublicNegativeStartupDispatch(mode: ownMode)
                    failed.qualificationFailure = first; failed.content.invalidated = true
                    try expect(first) { try failed.requireBackendStartupQualification(mode: otherMode) }
                    try require(failed.checks == 0, "first-failure-replaced-by-closed-or-mode")
                    checks.append("DATA-dispatch-\(mode)-\(first)-first-cause-retained")
                }
            }
            let value: [String: Any] = [
                "schema": "P05_BACKEND_STARTUP_QUALIFICATION_DELTA_V1", "checks": checks,
                "actualNormalFactory": "NoTeam rejected; no Root/client/WK owner returned",
                "wrapperFixture": "Exact method source; underlying checker always throws; DATA control flow only",
                "positiveQualification": "NOT_RUN_ORIGINAL_SUPPLIER_NOT_PROVIDED",
                "actualNE": "NOT_RUN", "GUIOrNetworkUsed": false,
            ]
            print(String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self))
        } catch { print("STARTUP_QUALIFICATION_DELTA_FAILED: \(error)"); exit(1) }
    }
    @MainActor private static func expect(_ expected: RoutedQualificationFailure,
        _ operation: () throws -> Void) throws {
        do { try operation(); throw ProbeFailure.failed("expected-denial-missing") }
        catch let observed as RoutedQualificationFailure { try require(observed == expected, "wrong-denial") }
    }

    #if YNX_ROUTE_BINDING_REDUCER_FIXTURE
    private static func checkReviewedEntry(_ checks: inout [String]) throws {
        // Offline values exercise the actual binding reducer only. The signed owner,
        // control client, WK view and OS filter are never created by these fixtures.
        let epoch = UUID(), provider = UUID().uuidString
        let token = Data(repeating: 0x51, count: 32)
        let hash = SHA256.hash(data: token).map { String(format: "%02x", $0) }.joined()
        let configuration = try RoutedIsolationConfiguration(teamIdentifier: "TESTTEAM01", mode: .nym,
            runID: "route-entry-fixture", epoch: epoch, expectedBrowserSHA256: String(repeating: "a", count: 64))
        func ack(mode: RoutedIsolationMode = .nym, owner: String? = nil) throws -> BackendGraphAcknowledgement {
            let payload: [String: Any] = ["schema": "P05_BACKEND_GRAPH_ACK_V1", "runID": configuration.runID,
                "epoch": epoch.uuidString, "mode": mode.rawValue, "requestNonce": UUID().uuidString,
                "requestSequence": 2, "providerGeneration": provider, "rootAuditTokenSHA256": hash,
                "graphRevision": 2, "backendAuditTokenSHA256": [owner ?? hash]]
            return try JSONDecoder().decode(BackendGraphAcknowledgement.self, from: JSONSerialization.data(withJSONObject: payload))
        }
        func review(host: String = "127.0.0.1", port: UInt16 = 63801, transport: Int = 6, duplicate: Bool = false) throws -> Data {
            let entry: [String: Any] = ["host": host, "port": port, "transport": transport]
            return try JSONSerialization.data(withJSONObject: ["entryOwner": ["auditTokenHex": String(repeating: "51", count: 32)],
                "entries": duplicate ? [entry, entry] : [entry]])
        }
        func lease(_ p: ProtectionLeaseView.Phase, _ sequence: UInt64, _ generation: UInt64 = 3,
                   _ providerGeneration: String? = nil) -> ProtectionLeaseView {
            .init(generation: generation, phase: p, providerGeneration: providerGeneration ?? provider, routeSequence: sequence, failure: nil)
        }
        let approved = try ack(), payload = try review()
        func bind(_ payload: Data, _ ack: BackendGraphAcknowledgement) throws -> ReviewedBrowserRouteEntry {
            try ReviewedBrowserRouteEntry(review: payload, acknowledgement: ack, configuration: configuration, lease: lease(.blocked, 0))
        }
        let entry = try bind(payload, approved)
        try require(entry.endpoint.port == 63801 && entry.matches(lease(.blocked, 0), connected: false)
            && entry.matches(lease(.routeEntryConnected, 1), connected: true), "checked-loopback-owner-and-next-sequence")
        try require(!entry.matches(lease(.blocked, 1), connected: true)
            && !entry.matches(lease(.routeEntryConnected, 1, 4), connected: true)
            && !entry.matches(lease(.routeEntryConnected, 1, 3, UUID().uuidString), connected: true)
            && !entry.matches(lease(.routeEntryConnected, 2), connected: true), "connected-requires-same-generation-provider-and-sequence")
        try require(entry != bind(payload, ack()), "reissued-graph-cannot-reuse-old-binding")
        checks += ["acknowledged-Nym-owner-port-and-exact-lease", "reject-blocked-and-stale-leases", "graph-reissue-invalidates-old-binding"]
        for (label, invalid, invalidAck) in [
            ("foreign-graph-mode", payload, try ack(mode: .tor)),
            ("unacknowledged-listener-owner", payload, try ack(owner: String(repeating: "b", count: 64))),
            ("alternate-loopback", try review(host: "127.0.0.2"), approved),
            ("privileged-port", try review(port: 80), approved),
            ("wrong-transport", try review(transport: 17), approved),
            ("ambiguous-endpoints", try review(duplicate: true), approved),
        ] {
            do {
                _ = try bind(invalid, invalidAck)
                throw ProbeFailure.failed(label)
            } catch ProtectionLeaseFailure.bindingMismatch { checks.append(label) }
        }
    }
    #endif
}
