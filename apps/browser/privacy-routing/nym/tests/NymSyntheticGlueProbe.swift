#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import CryptoKit
import YNXBrowserCore

@main struct NymSyntheticGlueProbe {
    @MainActor static func main() async throws {
        if CommandLine.arguments.dropFirst() == ["--normal-proof-delta"] {
            let checks = try NymNormalProofScopeDeltaChecks.run()
            print("Nym normal proof requested-DATA delta checks=\(checks) PASS; normal-authority-positive/vendor/network/NE=NOT_RUN")
            return
        }
        if CommandLine.arguments.dropFirst() == ["--qualification-delta"] {
            let checks = try NymQualificationDeltaChecks.run()
            print("Nym identity/qualification diagnostic delta checks=\(checks) PASS; qualified-positive/vendor/network/NE=NOT_RUN")
            return
        }
        if CommandLine.arguments.dropFirst() == ["--capture-consumer-delta"] {
            let checks = NymCaptureConsumerDeltaChecks.run()
            print("Nym capture consumer first-cause delta checks=\(checks) PASS; helper/vendor/GUI/network/NE=NOT_RUN")
            return
        }
        if CommandLine.arguments.dropFirst() == ["--gateway-recovery-delta"] {
            let checks = try NymGatewayRecoveryDeltaChecks.run()
            print("Nym gateway recovery journal delta checks=\(checks) PASS; originalKeys/vendor/network/NE=NOT_RUN")
            return
        }
        if CommandLine.arguments.dropFirst() == ["--gate-cleanup-delta"] {
            let checks = NymGateCleanupDeltaChecks.run()
            print("Nym Gate cleanup conjunction delta checks=\(checks) PASS; real-helper-cleanup/vendor/GUI/network/signedNE=NOT_RUN")
            return
        }
        if CommandLine.arguments.dropFirst() == ["--startup-delta"] {
            let checks = try await NymStartupDeltaChecks.run()
            print("Nym startup/diagnostic delta checks=\(checks) PASS; vendor/GUI/network/signedNE=NOT_RUN")
            return
        }
        var checks = 0
        func reject(_ action: () throws -> Void) {
            do { try action(); fatalError("Synthetic glue invalid input accepted") } catch { checks += 1 }
        }
        precondition(Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") == nil); checks += 1
        var factoryCalls = 0
        do {
            _ = try NymModeRouteFactory.makeSynthetic(runID: "../invalid", explicitUserAction: UUID(), epochFactory: { _ in
                factoryCalls += 1; throw NymProtectedFailure.cancelled
            })
            fatalError("NoTeam synthetic factory accepted")
        } catch ProtectionLeaseFailure.signingNotConfigured { checks += 1 }
        precondition(factoryCalls == 0); checks += 1
        do { try NymSyntheticProofHelper.preflight(bundle: .main); fatalError("Unsigned helper accepted") }
        catch NymProtectedFailure.signingNotConfigured { checks += 1 }
        precondition(NymSyntheticProofHelper.run(arguments: ["probe", NymSyntheticProofHelper.flag, "not-binding"], bundle: .main) == 78); checks += 1
        let purposes: [(String, NymSyntheticEpochPurpose)] = [("ynx-reviewed-directory", .directory), ("init", .initializeProfile), ("list-gateways", .listGateways), ("add-gateway", .addGateway), ("switch-gateway", .switchGateway)]
        for (argument, expected) in purposes { let purpose = try NymSyntheticEpochPurpose(arguments: [argument]); precondition(purpose == expected); checks += 1 }
        for arguments in [[], ["run"], ["curl"], ["ynx-reviewed-directory;init"]] { reject { _ = try NymSyntheticEpochPurpose(arguments: arguments) } }
        let runID = "trial-glue"
        let id = try NymSyntheticProfileIdentity.profileID(runID: runID)
        precondition(id == "ynx-route-bundled-eb173198-7fca-b0f8-5f46-b7ae498459f1"); checks += 1
        let otherID = try NymSyntheticProfileIdentity.profileID(runID: "trial-other")
        precondition(id != otherID); checks += 1
        for invalid in ["", "../keys", "Trial", String(repeating: "a", count: 41)] { reject { _ = try NymSyntheticProfileIdentity.profileID(runID: invalid) } }
        let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["YNX_NYM_TEST_OUTPUT"]!)
            .appendingPathComponent("synthetic-records-" + UUID().uuidString.lowercased(), isDirectory: true)
        try NymModeProfileReceipt.ensurePrivateDirectory(root)
        defer { try? FileManager.default.removeItem(at: root) }
        let plan = try NymModeProfileReceipt.planned(in: root, expectedProfileID: id)
        precondition(plan.profileID == id); checks += 1
        let path = root.appendingPathComponent("profile-planned.json"), original = try Data(contentsOf: path)
        let restored = try NymModeProfileReceipt.planned(in: root, expectedProfileID: id)
        let unchanged = try Data(contentsOf: path); precondition(restored == plan && unchanged == original); checks += 1
        reject { _ = try NymModeProfileReceipt.planned(in: root, expectedProfileID: otherID) }
        let stillOriginal = try Data(contentsOf: path); precondition(stillOriginal == original); checks += 1
        let malformed = Data("{broken original record".utf8); try malformed.write(to: path)
        reject { _ = try NymModeProfileReceipt.planned(in: root, expectedProfileID: id) }
        let stillMalformed = try Data(contentsOf: path); precondition(stillMalformed == malformed); checks += 1
        let profile = "synthetic-" + runID, hash: (Data) -> String = { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
        let wire: [String: String] = ["mode": "nym", "runID": runID, "epoch": UUID().uuidString,
            "profileID": profile, "profileSHA256": hash(Data(profile.utf8)), "providerGeneration": UUID().uuidString,
            "rootAuditTokenSHA256": String(repeating: "a", count: 64), "manifestSHA256": String(repeating: "b", count: 64),
            "bootstrapSHA256": String(repeating: "c", count: 64), "executableSHA256": String(repeating: "d", count: 64)]
        let binding = try JSONDecoder().decode(SyntheticTrialBinding.self, from: JSONSerialization.data(withJSONObject: wire))
        let argv = ["probe"] + (try NymSyntheticProofHelper.arguments(binding: binding))
        let parsed = try NymSyntheticProofHelper.parseBinding(argv); precondition(parsed == binding); checks += 1
        // A decoded lookup constraint cannot grant a child capability: the actual unsigned
        // test host fails before any signed IPC request, even for well-formed informational data.
        do { _ = try SyntheticProofChildAuthority.begin(binding: binding); fatalError("Decoded binding granted authority") }
        catch ProtectionLeaseFailure.signingNotConfigured { checks += 1 }
        for (key, changed) in [("mode", "tor"), ("epoch", "old"), ("profileID", "ordinary"), ("profileSHA256", "incorrect"), ("manifestSHA256", "ready")] {
            var altered = wire; altered[key] = changed
            let encoded = try JSONSerialization.data(withJSONObject: altered).base64EncodedString()
            reject { _ = try NymSyntheticProofHelper.parseBinding(["probe", NymSyntheticProofHelper.flag, encoded]) }
        }
        for invalid in [["probe"], argv + ["url=https://duckduckgo.com"], ["probe", NymSyntheticProofHelper.flag, "not base64"], ["probe", NymSyntheticProofHelper.flag, String(repeating: "A", count: 8193)]] {
            reject { _ = try NymSyntheticProofHelper.parseBinding(invalid) }
        }
        let token = try NymSyntheticProofHelper.auditTokenBytes(hex: String(repeating: "00", count: 32))
        precondition(token == Data(repeating: 0, count: 32)); checks += 1
        for invalid in ["", String(repeating: "0", count: 62), String(repeating: "A", count: 64), String(repeating: "g", count: 64)] { reject { _ = try NymSyntheticProofHelper.auditTokenBytes(hex: invalid) } }
        precondition(!RoutedPlatformIsolationAdmission.current.permitsWebContent); checks += 1
        checks += try await NymStartupDeltaChecks.run()
        checks += NymGateCleanupDeltaChecks.run()
        checks += try NymGatewayRecoveryDeltaChecks.run()
        checks += NymCaptureConsumerDeltaChecks.run()
        checks += try NymQualificationDeltaChecks.run()
        checks += try NymNormalProofScopeDeltaChecks.run()
        print("Nym synthetic glue new checks=\(checks) PASS; signedNE/authority-positive/vendor/network=NOT_RUN")
    }
}
#endif
