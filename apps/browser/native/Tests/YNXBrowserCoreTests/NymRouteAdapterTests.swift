import XCTest
@testable import YNXBrowserCore

final class NymRouteAdapterTests: XCTestCase {
    private func directoryFixture() throws -> (Data, Data, Data, Date) {
        let identity = String(repeating: "A", count: 43)
        let exitIdentity = String(repeating: "B", count: 43)
        let inactiveIdentity = String(repeating: "C", count: 43)
        let node: (UInt32, String, String, String) -> [String: Any] = { id, key, role, score in
            ["node_id": id, "ed25519_identity_pubkey": key, "role": role, "performance": score,
             "supported_roles": ["entry": true, "exit_nr": true], "entry": ["hostname": "synthetic-entry.test", "wss_port": 443]]
        }
        let page: ([[String: Any]]) -> [String: Any] = { rows in ["data": rows, "pagination": ["page": 0, "total": rows.count]] }
        let basic: [String: Any] = ["metadata": ["status": NSNull(), "absolute_epoch_id": 1, "rotation_id": 1,
             "refreshed_at": "2026-10-31 12:00:00.000 +00:00:00"], "nodes": page([
                node(1, identity, "EntryGateway", "0.8"), node(2, exitIdentity, "ExitGateway", "0.7"), node(3, inactiveIdentity, "Inactive", "1")])]
        let descriptor: (UInt32, String) -> [String: Any] = { id, key in
            ["node_id": id, "description": ["host_information": ["keys": ["ed25519": key]],
             "network_requester": ["address": String(repeating: "A", count: 43) + "." + String(repeating: "B", count: 43) + "@" + key]]]
        }
        let described = page([descriptor(2, exitIdentity), descriptor(3, inactiveIdentity)])
        let epoch: [String: Any] = ["total_elapsed_epochs": 1, "current_epoch_start": "2026-10-31T11:30:00Z", "epoch_length": ["secs": 3600, "nanos": 0]]
        return (try JSONSerialization.data(withJSONObject: basic), try JSONSerialization.data(withJSONObject: described), try JSONSerialization.data(withJSONObject: epoch), Date(timeIntervalSince1970: 1793448000))
    }
    func testActiveAssignmentRejectsHigherPerformanceInactiveRequester() throws {
        let (basic, described, epoch, now) = try directoryFixture()
        let selected = try NymActiveDirectorySelector.select(basic: basic, described: described, epoch: epoch, now: now)
        XCTAssertEqual(selected.requesterNodeID, 2)
        XCTAssertEqual(selected.entryIdentity, String(repeating: "A", count: 43))
        XCTAssertEqual(selected.basicSHA256.count, 64)
        // Official refreshed_at is the oldest of three caches, not the role issue time.
        XCTAssertNoThrow(try NymActiveDirectorySelector.select(basic: basic, described: described, epoch: epoch, now: now.addingTimeInterval(901)))
    }
    func testActiveAssignmentRejectsExpiredIncompleteAndNoActiveExit() throws {
        let (basic, described, epoch, now) = try directoryFixture()
        XCTAssertThrowsError(try NymActiveDirectorySelector.select(basic: basic, described: described, epoch: epoch, now: now.addingTimeInterval(3601)))
        var object = try JSONSerialization.jsonObject(with: basic) as! [String: Any]
        var page = object["nodes"] as! [String: Any]
        var nodes = page["data"] as! [[String: Any]]; nodes[1]["role"] = "Inactive"; page["data"] = nodes; object["nodes"] = page
        XCTAssertThrowsError(try NymActiveDirectorySelector.select(basic: JSONSerialization.data(withJSONObject: object), described: described, epoch: epoch, now: now))
        page["pagination"] = ["page": 0, "total": 5]; object["nodes"] = page
        XCTAssertThrowsError(try NymActiveDirectorySelector.select(basic: JSONSerialization.data(withJSONObject: object), described: described, epoch: epoch, now: now))
    }
    func testActiveAssignmentRejectsEpochMismatchNearEndAndMissingPlanProof() throws {
        let (basic, described, epoch, now) = try directoryFixture()
        var object = try JSONSerialization.jsonObject(with: epoch) as! [String: Any]
        object["total_elapsed_epochs"] = 2
        XCTAssertThrowsError(try NymActiveDirectorySelector.select(basic: basic, described: described, epoch: JSONSerialization.data(withJSONObject: object), now: now))
        object["total_elapsed_epochs"] = 1; object["current_epoch_start"] = "2026-10-31T11:00:10Z"
        XCTAssertThrowsError(try NymActiveDirectorySelector.select(basic: basic, described: described, epoch: JSONSerialization.data(withJSONObject: object), now: now))
        XCTAssertThrowsError(try plan().validateDirectory(now: now))
        let selected = try NymActiveDirectorySelector.select(basic: basic, described: described, epoch: epoch, now: now)
        let bound = try NymRouteLaunchPlan(executable: URL(fileURLWithPath: "/nonexistent/nym-socks5-client"), executableSHA256: digest,
            profileID: "ynx-route-epoch", profileSHA256: digest, provider: selected.requester, port: 1087, directorySelection: selected)
        XCTAssertNoThrow(try bound.validateDirectory(now: now))
        XCTAssertThrowsError(try bound.validateDirectory(now: selected.validUntil))

    }
    func testOfficialBootstrapMarkerRequiresCompleteEventNotListenerLog() {
        let marker = NymBootstrapMarker()
        marker.append(Data("SOCKS5 listening address: 127.0.0.1:1087\nClient startup fin".utf8))
        XCTAssertFalse(marker.isFinished)
        marker.append(Data("ished!\n".utf8))
        XCTAssertTrue(marker.isFinished)
    }

    func testBootstrapMustConsumeSelectedGatewayBeforeReadinessProbe() {
        let marker = NymBootstrapMarker(expectedGatewayIdentity: "selected-entry")
        marker.append(Data("Client startup finished!\nThe address of this client is: public.public@old-entry\n".utf8))
        XCTAssertFalse(marker.isFinished)
        marker.append(Data("The address of this client is: public.public@selected-entry\n".utf8))
        XCTAssertTrue(marker.isFinished)
    }
    func testControlledProbePreservesTLSRemoteDNSAndCannotUseUserPage() throws {
        let origin = URL(string: "https://owned-nonce.trycloudflare.com/")!
        let probe = try NymControlledProbe(url: origin.appendingPathComponent("ynx-route-probe/test-token/proof"), responseSHA256: String(repeating: "b", count: 64), runID: "test-token", reviewedOrigin: origin)
        let args = probe.curlArguments(port: 1087)
        XCTAssertEqual(args.first, "--proxy")
        XCTAssertEqual(args[1], "socks5h://127.0.0.1:1087")
        XCTAssertTrue(args.contains("=https"))
        XCTAssertFalse(args.contains("--insecure"))
        for url in ["https://other.trycloudflare.com/ynx-route-probe/test-token/proof", "https://owned-nonce.trycloudflare.com/private", "http://owned-nonce.trycloudflare.com/ynx-route-probe/test-token/proof", "https://owned-nonce.trycloudflare.com/ynx-route-probe/test-token/proof?secret=x", "https://owned-nonce.trycloudflare.com/ynx-route-probe/old-token/proof", "https://owned-nonce.trycloudflare.com/ynx-route-probe/test-token/%70roof"] {
            XCTAssertThrowsError(try NymControlledProbe(url: URL(string: url)!, responseSHA256: String(repeating: "b", count: 64), runID: "test-token", reviewedOrigin: origin))
        }
    }
    private let digest = String(repeating: "a", count: 64)
    private var recipient: String { String(repeating: "A", count: 43) + "." + String(repeating: "B", count: 43) + "@" + String(repeating: "C", count: 43) }
    private func plan(host: String = "127.0.0.1", anonymous: Bool = true, id: String = "ynx-route-test") throws -> NymRouteLaunchPlan {
        try NymRouteLaunchPlan(executable: URL(fileURLWithPath: "/nonexistent/nym-socks5-client"), executableSHA256: digest, profileID: id, profileSHA256: digest, provider: recipient, port: 1087, host: host, anonymousReplies: anonymous)
    }
    func testPinnedOfficialCommandsForceLoopbackAndAnonymousReplies() throws {
        let p = try plan()
        XCTAssertEqual(p.sourceCommit, NymRouteDependency.sourceCommit)
        XCTAssertEqual(p.runArguments[p.runArguments.firstIndex(of: "--ynx-runtime-contract")! + 1], "ynx-mixnet-v1")
        XCTAssertTrue(p.initializationArguments.suffix(4).elementsEqual(["--use-reply-surbs", "true", "--output", "json"]))
        XCTAssertTrue(p.runArguments.suffix(2).elementsEqual(["--use-anonymous-replies", "true"]))
        XCTAssertEqual(p.runArguments[p.runArguments.firstIndex(of: "--host")! + 1], "127.0.0.1")
        for args in [p.initializationArguments, p.runArguments] {
            XCTAssertEqual(args[args.firstIndex(of: "--enabled-credentials-mode")! + 1], "false")
        }
        XCTAssertFalse(p.runArguments.contains("--fastmode"))
        XCTAssertFalse(p.runArguments.contains("--no-cover"))
        XCTAssertEqual(Array(p.resumptionArguments.prefix(2)), ["init", "--resume-unconfigured"])
        XCTAssertEqual(p.resumptionArguments.filter { $0 == "--id" }.count, 1)
        XCTAssertEqual(p.resumptionArguments[p.resumptionArguments.firstIndex(of: "--id")! + 1], p.profileID)
    }
    func testRejectsLANAnonymousDowngradeAndProfileTraversal() {
        XCTAssertThrowsError(try plan(host: "0.0.0.0"))
        XCTAssertThrowsError(try plan(host: "::"))
        XCTAssertThrowsError(try plan(anonymous: false))
        XCTAssertThrowsError(try plan(id: "../../other-account"))
    }
    func testMissingSupplyCannotRunOrBecomeReady() throws {
        XCTAssertThrowsError(try plan().validateInstalledSupply()) { XCTAssertEqual($0 as? NymRouteAdapterError, .missingExecutable) }
    }
    func testChangedExecutableRejectedBeforeProfileReadOrLaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let binary = directory.appendingPathComponent("nym-socks5-client")
        try Data([0xcf, 0xfa, 0xed, 0xfe, 0x00]).write(to: binary)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: binary.path)
        let p = try NymRouteLaunchPlan(executable: binary, executableSHA256: digest, profileID: "ynx-route-test", profileSHA256: digest, provider: recipient, port: 1087)
        XCTAssertThrowsError(try p.validateInstalledSupply()) { XCTAssertEqual($0 as? NymRouteAdapterError, .executableMismatch) }
    }
    func testSOCKSRequestCarriesSyntheticDomainWithoutDNSOrUDP() throws {
        let request = try NymRouteLaunchPlan.socks5DomainConnect(host: "synthetic-leak.test")
        XCTAssertEqual(Array(request.prefix(5)), [5, 1, 0, 3, 19])
        XCTAssertEqual(String(decoding: request.dropFirst(5).dropLast(2), as: UTF8.self), "synthetic-leak.test")
        XCTAssertEqual(Array(request.suffix(2)), [1, 187])
        for host in ["127.0.0.1", "::1", "localhost", "secret.localhost", "https://example.test/", "invalid host.test"] {
            XCTAssertThrowsError(try NymRouteLaunchPlan.socks5DomainConnect(host: host))
        }
        XCTAssertThrowsError(try NymRouteLaunchPlan.socks5DomainConnect(host: "synthetic-leak.test", port: 53))
    }
    @MainActor func testCancelAndMissingProviderNeverReportConnected() async {
        let adapter = NymRouteAdapter()
        do { _ = try await adapter.start(); XCTFail("missing client must not start") } catch { XCTAssertEqual(error as? NymRouteAdapterError, .missingExecutable) }
        let before = await adapter.status(); XCTAssertNotEqual(before, .connected)
        await adapter.stop()
        do { _ = try await adapter.start(); XCTFail("cancel must not restart") } catch { XCTAssertEqual(error as? NymRouteAdapterError, .cancelled) }
        let after = await adapter.status(); XCTAssertNotEqual(after, .connected)
    }
    @MainActor func testMixnetStopUsesInterruptAndReapsChild() async throws {
        let child = Process(); child.executableURL = URL(fileURLWithPath: "/bin/sleep"); child.arguments = ["30"]
        try child.run()
        await NymRouteAdapter.stopChild(child, mixnet: true)
        child.waitUntilExit()
        XCTAssertEqual(child.terminationReason, .uncaughtSignal)
        XCTAssertEqual(child.terminationStatus, 2)
    }
    @MainActor func testUnresponsiveMixnetStopIsBoundedEvenWhenCallerCancelled() async throws {
        let child = Process(); child.executableURL = URL(fileURLWithPath: "/bin/sh")
        child.arguments = ["-c", "trap '' INT; exec /bin/sleep 30"]
        try child.run()
        try await Task.sleep(for: .milliseconds(100))
        let task = Task { await NymRouteAdapter.stopChild(child, mixnet: true, grace: .milliseconds(200)) }
        task.cancel(); await task.value; child.waitUntilExit()
        XCTAssertEqual(child.terminationStatus, 9)
    }

    func testProfileLeaseRejectsConcurrentRunnerUntilRelease() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent(".ynx-run.lock")
        let first = try NymProfileLease(url: url)
        XCTAssertThrowsError(try NymProfileLease(url: url)) { XCTAssertEqual($0 as? NymRouteAdapterError, .profileInUse) }
        first.release()
        let next = try NymProfileLease(url: url); next.release()
    }

}
