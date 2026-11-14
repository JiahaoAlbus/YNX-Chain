import Foundation
import CryptoKit
import Darwin
import YNXBrowserCore

@main struct ProtectedNymProbe {
    @MainActor static func main() async throws {
        if ProcessInfo.processInfo.environment["YNX_NYM_TEST_DELTA_ONLY"] == "1" {
            _ = try NymProductionLifecycleChecks.run(); return
        }
        var checks = try NymProductionLifecycleChecks.run()
        func refusal(_ expected: NymProtectedFailure, _ body: () throws -> Void) throws {
            do { try body(); fatalError("accepted \(expected)") }
            catch let error as NymProtectedFailure { precondition(error == expected, "\(error) != \(expected)"); checks += 1 }
        }
        let hash = String(repeating: "a", count: 64)
        try refusal(.signingNotConfigured) { try NymProtectedRouteProvider.preflight(team: "NOT_CONFIGURED", identifier: nil, helperSHA256: "invalid") }
        try refusal(.wrongApplication) { try NymProtectedRouteProvider.preflight(team: "FIXTURE001", identifier: "ordinary", helperSHA256: hash) }
        try refusal(.helperPinMissing) { try NymProtectedRouteProvider.preflight(team: "FIXTURE001", identifier: RoutedIsolationMode.nym.bundleIdentifier, helperSHA256: "invalid") }
        try refusal(.platformDenied) { try NymProtectedRouteProvider.preflight(team: "FIXTURE001", identifier: RoutedIsolationMode.nym.bundleIdentifier, helperSHA256: hash) }
        var calls = 0
        let identity = try NymCodeSignatureIdentity(identifier: "not-a-real-package", codeDirectoryHash: String(repeating: "a", count: 40), teamIdentifier: nil)
        let provider = NymProtectedRouteProvider(helperSHA256: hash, expectedPackageIdentity: identity, profile: nil, explicitUserAction: UUID()) { calls += 1; fatalError("NoTeam invoked supplier") }
        do { _ = try await provider.start(); fatalError("NoTeam started vendor") } catch NymProtectedFailure.signingNotConfigured { checks += 1 }
        precondition(calls == 0 && provider.cleanup == .notStarted); checks += 1
        guard case .blocked = await provider.status() else { fatalError("NoTeam ready") }; checks += 1
        do { _ = try await provider.start(); fatalError("replayed") } catch NymProtectedFailure.ownershipConflict { checks += 1 }
        await provider.stop()
        async let firstCleanup = provider.awaitCleanupConfirmation()
        async let secondCleanup = provider.awaitCleanupConfirmation()
        let joined = await (firstCleanup, secondCleanup)
        precondition(joined.0 && joined.1 && provider.cleanupConfirmed); checks += 1
        precondition(provider.firstFailure == .signingNotConfigured && provider.lastFailure == .signingNotConfigured); checks += 1

        precondition(NymNumericBootstrapPlan.numeric("1.1.1.1") && NymNumericBootstrapPlan.numeric("2001:4860:4860::8888")); checks += 1
        for bad in ["gateway.example.com", "127.0.0.1", "0.0.0.0", "10.0.0.1", "192.168.1.2", "172.16.0.1", "169.254.1.1", "224.0.0.1", "::1", "fe80::1%en0", "::ffff:8.8.8.8", "2001:4860::1\0garbage"] { precondition(!NymNumericBootstrapPlan.numeric(bad)); checks += 1 }
        // Explicit test of the real fixed artifact's independent resolver limitation: even a
        // syntactically numeric plan cannot grant shared system-resolver egress.
        let plan = NymNumericBootstrapPlan(peers: [.init(purpose: .gatewayWSS, host: "1.1.1.1", port: 443, transport: IPPROTO_TCP)], directoryEpoch: 1, directorySHA256: [], receivedAt: Date(), validUntil: Date().addingTimeInterval(60))
        try refusal(.unattributedRuntimeDNS) { try plan.requireAttributedDNS(runtimeSHA256: "04d788aa0ed3395162fc475e4973353fa71afd4c0ce75c5e00bd36326e357248") }
        try plan.requireAttributedDNS(runtimeSHA256: BundledNymSupply.runtimeSHA256); checks += 1
        try refusal(.identityRejected) { try plan.requireAttributedDNS(runtimeSHA256: hash) }

        let now = Date(), until = Date().addingTimeInterval(100)
        let selection = NymActiveDirectorySelection(entryIdentity: "fixture", requester: "fixture", requesterNodeID: 1, epoch: 7, rotation: 3, basicSHA256: hash, describedSHA256: hash, epochSHA256: hash, validUntil: until)
        let peers: [NymNumericBootstrapPlan.Peer] = [.init(purpose: .directoryHTTPS, host: "1.1.1.1", port: 443, transport: IPPROTO_TCP), .init(purpose: .chainRPC, host: "8.8.8.8", port: 443, transport: IPPROTO_TCP), .init(purpose: .gatewayWSS, host: "9.9.9.9", port: 9001, transport: IPPROTO_TCP)]
        let bound = NymNumericBootstrapPlan(peers: peers, directoryEpoch: 7, directorySHA256: [hash, hash, hash], receivedAt: now, validUntil: until)
        try bound.validate(selection: selection, now: now); checks += 1
        try refusal(.staleNumericPlan) { try bound.validate(selection: selection, now: now.addingTimeInterval(121)) }
        let staleEpoch = NymNumericBootstrapPlan(peers: peers, directoryEpoch: 6, directorySHA256: [hash, hash, hash], receivedAt: now, validUntil: until)
        try refusal(.invalidNumericPlan) { try staleEpoch.validate(selection: selection, now: now) }
        let missingRole = NymNumericBootstrapPlan(peers: Array(peers.dropLast()), directoryEpoch: 7, directorySHA256: [hash, hash, hash], receivedAt: now, validUntil: until)
        try refusal(.invalidNumericPlan) { try missingRole.validate(selection: selection, now: now) }
        let rootToken = String(repeating: "c", count: 64)
        let vendorPin = NymProtectedGraph.Pin(auditTokenHex: String(repeating: "a", count: 64), pid: 4101, pidVersion: 1, path: "/synthetic/nym-socks5-client", sha256: BundledNymSupply.runtimeSHA256, requirement: BundledNymSupply.runtimeRequirement)
        let probePin = NymProtectedGraph.Pin(auditTokenHex: String(repeating: "b", count: 64), pid: 4102, pidVersion: 1, path: "/synthetic/proof", sha256: hash, requirement: "synthetic requirement")
        let graph = NymProtectedGraph(rootToken: rootToken, nym: vendorPin, probe: probePin, port: 19160, peers: peers)
        let before = try JSONSerialization.jsonObject(with: graph.encoded(listenerVerified: false)) as! [String: Any]
        let after = try JSONSerialization.jsonObject(with: graph.encoded(listenerVerified: true)) as! [String: Any]
        let b = before["backends"] as! [[String: Any]], a = after["backends"] as! [[String: Any]]
        precondition((b[1]["destinations"] as! [Any]).isEmpty && (b[0]["listeningEntries"] as! [Any]).isEmpty); checks += 1
        precondition(NSDictionary(dictionary: b[0]["process"] as! [String: Any]).isEqual(to: a[0]["process"] as! [String: Any]) && NSArray(array: b[0]["destinations"] as! [Any]).isEqual(to: a[0]["destinations"] as! [Any])); checks += 1
        precondition((a[1]["destinations"] as! [[String: Any]]).count == 1 && (a[0]["listeningEntries"] as! [[String: Any]]).count == 1); checks += 1
        try refusal(.identityRejected) { _ = try NymProtectedGraph(rootToken: vendorPin.auditTokenHex, nym: vendorPin, probe: probePin, port: 19160, peers: peers).encoded(listenerVerified: true) }
        try refusal(.identityRejected) { _ = try NymProtectedGraph(rootToken: rootToken, nym: vendorPin, probe: vendorPin, port: 19160, peers: peers).encoded(listenerVerified: true) }

        let origin = URL(string: "https://proof.example.com")!
        let body = Data("reviewed proof".utf8), bodyHash = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
        let proof = try NymControlledProbe(url: URL(string: "https://proof.example.com/ynx-route-probe/run-1/proof")!, responseSHA256: bodyHash, runID: "run-1", reviewedOrigin: origin)
        let argv = ["/synthetic/YNXBrowserNative"] + NymProofHelper.arguments(port: 19160, runID: "run-1", reviewedOrigin: origin, proof: proof)
        let parsed = try NymProofHelper.parse(argv); precondition(parsed.port == 19160); checks += 1
        precondition(NymProofHelper.dispatchDecision(identifier: NymProofHelper.identifier, role: true, arguments: argv) == true); checks += 1
        precondition(NymProofHelper.dispatchDecision(identifier: NymProofHelper.identifier, role: true, arguments: [argv[0]]) == false); checks += 1
        precondition(NymProofHelper.dispatchDecision(identifier: "ordinary", role: false, arguments: argv) == false); checks += 1
        precondition(NymProofHelper.dispatchDecision(identifier: "ordinary", role: false, arguments: [argv[0]]) == nil); checks += 1
        for mutated in [Array(argv.dropLast()), argv + ["extra"], [argv[0], NymProofHelper.flag, "80"] + Array(argv.dropFirst(3)), [argv[0], NymProofHelper.flag, "019160"] + Array(argv.dropFirst(3))] { precondition((try? NymProofHelper.parse(mutated)) == nil); checks += 1 }
        var wrongRun = argv; wrongRun[3] = "other-run"; precondition((try? NymProofHelper.parse(wrongRun)) == nil); checks += 1
        var wrongOrigin = argv; wrongOrigin[4] = "https://unreviewed.example.com"; precondition((try? NymProofHelper.parse(wrongOrigin)) == nil); checks += 1
        try proof.validateResponse(body)
        do { try proof.validateResponse(Data(repeating: 0, count: 4097)); fatalError("oversize") } catch { checks += 1 }

        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["YNX_NYM_TEST_OUTPUT"]!).appendingPathComponent("journal-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let journal = directory.appendingPathComponent("provisioning.json"), id = "ynx-route-bundled-" + UUID().uuidString.lowercased()
        try NymProvisioningIntent.claimBeforeResume(at: journal, profileID: id, operation: UUID())
        let original = try Data(contentsOf: journal), record = try JSONDecoder().decode(NymProvisioningIntent.Record.self, from: original)
        precondition(record.state == "UNKNOWN" && record.profileID == id); checks += 1
        try refusal(.provisioningUnknown) { try NymProvisioningIntent.claimBeforeResume(at: journal, profileID: id, operation: UUID()) }
        let unchanged = try Data(contentsOf: journal); precondition(unchanged == original); checks += 1
        let dangling = directory.appendingPathComponent("dangling.json")
        try FileManager.default.createSymbolicLink(atPath: dangling.path, withDestinationPath: "/no-such-nym-journal")
        try refusal(.unsafeJournal) { try NymProvisioningIntent.claimBeforeResume(at: dangling, profileID: id, operation: UUID()) }
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: directory.path)
        try refusal(.unsafeJournal) { try NymProvisioningIntent.claimBeforeResume(at: directory.appendingPathComponent("unsafe.json"), profileID: id, operation: UUID()) }
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try FileManager.default.removeItem(at: directory)

        let receiptDir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["YNX_NYM_TEST_OUTPUT"]!).appendingPathComponent("receipt-" + UUID().uuidString, isDirectory: true)
        try NymModeProfileReceipt.ensurePrivateDirectory(receiptDir)
        let planned = try NymModeProfileReceipt.planned(in: receiptDir)
        let secondPlan = try NymModeProfileReceipt.planned(in: receiptDir)
        precondition(planned.profileID == secondPlan.profileID && planned.operation == secondPlan.operation); checks += 1
        let notCompleted = try NymModeProfileReceipt.completed(in: receiptDir, plan: planned)
        precondition(notCompleted == nil); checks += 1
        let syntheticConfig = receiptDir.appendingPathComponent("synthetic-config.toml")
        try NymModeProfileReceipt.writeNew(Data("not a Nym identity; isolated receipt fixture".utf8), to: syntheticConfig)
        let unconfirmed = BackendProcessExit(pid: 123, code: 0, signal: nil, childReaped: false)
        try refusal(.provisioningUnknown) { _ = try NymModeProfileReceipt.publishCompletion(in: receiptDir, plan: planned, config: syntheticConfig, exit: unconfirmed) }
        let failed = BackendProcessExit(pid: 123, code: 1, signal: nil, childReaped: true)
        try refusal(.provisioningUnknown) { _ = try NymModeProfileReceipt.publishCompletion(in: receiptDir, plan: planned, config: syntheticConfig, exit: failed) }
        let actual = BackendProcessExit(pid: 123, code: 0, signal: nil, childReaped: true)
        let receipt = try NymModeProfileReceipt.publishCompletion(in: receiptDir, plan: planned, config: syntheticConfig, exit: actual)
        let reread = try NymModeProfileReceipt.completed(in: receiptDir, plan: planned)
        precondition(reread?.id == receipt.id && reread?.configSHA256 == receipt.configSHA256); checks += 1
        try refusal(.ownershipConflict) { _ = try NymModeProfileReceipt.publishCompletion(in: receiptDir, plan: planned, config: syntheticConfig, exit: actual) }
        try FileManager.default.removeItem(at: receiptDir)
        let policy = NymReviewedNetworkPolicy(runID: "fixture-run", stage: "directory-bootstrap", issuedAt: 100, expiresAt: 220, directoryEpoch: nil, directorySHA256: nil, entryIdentity: nil, bootstrapSourceSHA256: hash,
            endpoints: [.init(purpose: "directoryHTTPS", scheme: "https", host: "validator.nymtech.net", port: 443, addresses: ["92.39.63.14"])])
        let encodedPolicy = try JSONSerialization.jsonObject(with: policy.bytes()) as! [String: Any]
        precondition(encodedPolicy["runID"] as? String == "fixture-run" && encodedPolicy["networkDefaultsSHA256"] as? String == hash && encodedPolicy["runId"] == nil); checks += 1
        let invalidPolicy = NymReviewedNetworkPolicy(runID: "fixture-run", stage: "directory-bootstrap", issuedAt: 100, expiresAt: 221, directoryEpoch: nil, directorySHA256: nil, entryIdentity: nil, bootstrapSourceSHA256: hash, endpoints: policy.endpoints)
        try refusal(.invalidNumericPlan) { _ = try invalidPolicy.bytes() }
        do { _ = try NymModeRouteSupplier(bundle: .main, userAction: UUID()).proof(); fatalError("missing proof accepted") }
        catch NymProtectedFailure.proofNotSupplied { checks += 1 }
        let identityText = String(repeating: "1", count: 32)
        let publicBytes = try NymModeGatewayState.publicIdentityBytes(identityText)
        precondition(publicBytes == [UInt8](repeating: 0, count: 32)); checks += 1
        try refusal(.invalidProfileReceipt) { _ = try NymModeGatewayState.publicIdentityBytes(String(repeating: "1", count: 43)) }
        let stateBytes = try JSONSerialization.data(withJSONObject: [["identity": publicBytes, "active": true, "typ": "remote", "endpoint": "wss://gateway.example.com:9001/", "fallback_endpoint": NSNull()]])
        let gateway = try NymModeGatewayState.decode(stateBytes, expectedIdentity: identityText)
        precondition(gateway.registered && gateway.active); try gateway.validateEndpoint(host: "gateway.example.com", port: 9001); checks += 1
        try refusal(.invalidProfileReceipt) { try gateway.validateEndpoint(host: "unreviewed.example.com", port: 9001) }
        try refusal(.invalidProfileReceipt) { _ = try NymModeGatewayState.decode(Data("[{},{}]".utf8), expectedIdentity: identityText) }
        print("protected-nym-offline checks=\(checks) vendor=NOT_RUN network=NOT_RUN profile_init=NOT_RUN")
    }
}
