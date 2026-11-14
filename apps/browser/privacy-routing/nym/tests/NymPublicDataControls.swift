// PUBLIC DATA/metadata components only. No SDK identity, process, socket, GUI or authority.
import Foundation
import CryptoKit
import YNXBrowserCore

@main struct NymPublicDataControls {
    static func reject(_ body: () throws -> Void) throws {
        do { try body() } catch { return }
        throw NSError(domain: "ExpectedComponentRejection", code: 1)
    }
    static func main() throws {
        let now = Date(), date = ISO8601DateFormatter(), fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let refreshed = fractional.string(from: now).replacingOccurrences(of: "T", with: " ").replacingOccurrences(of: "Z", with: " +00:00:00")
        let nodes: [[String: Any]] = [
            ["node_id": 1, "role": "Inactive", "supported_roles": ["entry": true], "ed25519_identity_pubkey": "entry-public",
             "ip_addresses": ["1.1.1.1"], "performance": "1.0", "entry": ["hostname": "entry.fixture.invalid", "ws_port": 9000, "wss_port": 9001]],
            ["node_id": 2, "role": "EntryGateway", "supported_roles": ["exit_nr": true], "ed25519_identity_pubkey": "exit-public",
             "ip_addresses": ["8.8.8.8"], "performance": "1.0"]]
        let described: [[String: Any]] = [
            ["node_id": 1, "description": ["host_information": ["hostname": "entry.fixture.invalid", "ip_address": ["1.1.1.1"], "keys": ["ed25519": "entry-public"]],
                "mixnet_websockets": ["ws_port": 9000, "wss_port": 9001]]],
            ["node_id": 2, "description": ["host_information": ["ip_address": ["8.8.8.8"], "keys": ["ed25519": "exit-public"]],
                "network_requester": ["uses_exit_policy": true, "address": "fixture-typed-membership-only@exit-public"]]]]
        let pagination = ["page": 0, "total": 2, "size": 2]
        let body: [String: Any] = ["schema": "YNX_NYM_DIRECTORY_V1",
            "basic": ["metadata": ["status": NSNull(), "absolute_epoch_id": 1, "rotation_id": 0, "refreshed_at": refreshed],
                      "nodes": ["pagination": pagination, "data": nodes]],
            "described": ["pagination": pagination, "data": described],
            "epoch": ["total_elapsed_epochs": 1, "current_epoch_start": date.string(from: now.addingTimeInterval(-60)), "epoch_length": ["secs": 3600, "nanos": 0]]]
        let raw = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]), run = "qa-dir-" + String(repeating: "a", count: 32)
        let frame: [String: Any] = ["schema": "YNX_NYM_QA_CAPABILITY_CANDIDATES_V2", "runID": run,
            "payloadSHA256": NymPublicExecutableSupply.digest(raw), "entryNodeIDs": [1], "exitNodeIDs": [2]]
        let frameBytes = try JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys])
        let out = raw + Data([10]), err = NymPublicDirectorySnapshot.prefix + frameBytes + Data([10])
        let snapshot = try NymPublicDirectorySnapshot.decode(stdout: out, stderr: err, runID: run, expires: now.addingTimeInterval(120), now: now)
        let selection = try snapshot.select(now: now)
        precondition(selection.entryIdentity == "entry-public" && selection.requesterNodeID == 2)
        try reject { _ = try NymPublicDirectorySnapshot.decode(stdout: out, stderr: err, runID: run + "b", expires: now.addingTimeInterval(120), now: now) }
        try reject { _ = try NymPublicDirectorySnapshot.decode(stdout: Data([32]) + out, stderr: err, runID: run, expires: now.addingTimeInterval(120), now: now) }
        let duplicate = Data(("{\"runID\":\"" + run + "\"," + String(decoding: frameBytes, as: UTF8.self).dropFirst()).utf8)
        try reject { _ = try NymPublicDirectorySnapshot.decode(stdout: out, stderr: NymPublicDirectorySnapshot.prefix + duplicate + Data([10]), runID: run, expires: now.addingTimeInterval(120), now: now) }
        var boolean = frame; boolean["entryNodeIDs"] = [true]
        try reject { _ = try NymPublicDirectorySnapshot.decode(stdout: out, stderr: NymPublicDirectorySnapshot.prefix + JSONSerialization.data(withJSONObject: boolean) + Data([10]), runID: run, expires: now.addingTimeInterval(120), now: now) }
        try reject { _ = try NymPublicDirectorySnapshot.decode(stdout: out, stderr: Data("YNX_NYM_QA_DIRECTORY_CANDIDATES_V1 ".utf8) + frameBytes + Data([10]), runID: run, expires: now.addingTimeInterval(120), now: now) }
        try reject { _ = try NymPublicDirectorySnapshot.decode(stdout: out, stderr: err, runID: run, expires: now, now: now) }
        let monotonicExpired = NymPublicDirectorySnapshot(latest: snapshot.latest, entryIDs: snapshot.entryIDs,
            exitIDs: snapshot.exitIDs, captureExpires: now.addingTimeInterval(120),
            captureMonotonicDeadline: ContinuousClock.now.advanced(by: .nanoseconds(-1)), payloadSHA256: snapshot.payloadSHA256)
        try reject { _ = try monotonicExpired.select(now: now.addingTimeInterval(-1)) }
        func changedEpoch(start: Date, seconds: Int, at clock: Date) throws -> NymPublicDirectorySnapshot {
            var changed = body
            changed["epoch"] = ["total_elapsed_epochs": 1, "current_epoch_start": date.string(from: start), "epoch_length": ["secs": seconds, "nanos": 0]]
            let bytes = try JSONSerialization.data(withJSONObject: changed, options: [.sortedKeys])
            var control = frame; control["payloadSHA256"] = NymPublicExecutableSupply.digest(bytes)
            return try NymPublicDirectorySnapshot.decode(stdout: bytes + Data([10]),
                stderr: NymPublicDirectorySnapshot.prefix + JSONSerialization.data(withJSONObject: control) + Data([10]),
                runID: run, expires: clock.addingTimeInterval(120), now: clock)
        }
        let whole = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970))
        let futureStart = try changedEpoch(start: whole.addingTimeInterval(60), seconds: 600, at: whole)
        try reject { _ = try futureStart.select(now: whole) }
        let exact300 = try changedEpoch(start: whole.addingTimeInterval(-300), seconds: 600, at: whole)
        try reject { _ = try exact300.select(now: whole) }
        let above300 = try changedEpoch(start: whole.addingTimeInterval(-299), seconds: 600, at: whole)
        _ = try above300.select(now: whole)

        let collector = NymPublicProcessOutput(limit: 16_777_217, captureDirectoryStderr: true)
        collector.append(out, stdout: true); collector.append(err, stdout: false); collector.terminated(pid: 42, code: 0, signal: nil)
        try reject { _ = try collector.completedDirectoryCapture(expectedPID: 42) }
        collector.append(Data(), stdout: true)
        try reject { _ = try collector.completedDirectoryCapture(expectedPID: 42) }
        collector.append(Data(), stdout: false)
        let completed = try collector.completedDirectoryCapture(expectedPID: 42)
        precondition(completed.0 == out && completed.1 == err)
        let bounded = NymPublicProcessOutput(limit: 16, captureDirectoryStderr: true)
        bounded.append(Data(repeating: 0, count: 524_289), stdout: false)
        precondition(bounded.exceeded)

        let parent = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let scratch = try NymPublicScratch.create(parent: parent), id = "fixture-no-SDK-identity"
        let root = ActualProfilePins.relativeProfile(id)
        try scratch.makeDirectory(root + "/config"); try scratch.makeDirectory(root + "/data")
        for name in ["private_identity.pem", "public_identity.pem", "private_encryption.pem", "public_encryption.pem", "ack_key.pem"] {
            try scratch.writeNew(Data("FIXTURE_BYTES_NOT_A_VALID_KEY".utf8), relative: root + "/data/" + name)
        }
        try scratch.writeNew(Data("FIXTURE_CONFIG".utf8), relative: root + "/config/config.toml")
        try reject { _ = try scratch.read(root + "/data/private_identity.pem", limit: 1024) }
        try reject { _ = try scratch.read(root + "/data/ack_key.pem", limit: 1024) }
        let publicBytes = try scratch.read(root + "/data/public_identity.pem", limit: 1024)
        precondition(publicBytes == Data("FIXTURE_BYTES_NOT_A_VALID_KEY".utf8))
        let pins = try ActualProfilePins.profilePins(scratch: scratch, id: id)
        precondition(pins.count == 6 && !pins["data/private_identity.pem"]!.contains("public-sha256") && pins["data/public_identity.pem"]!.contains("public-sha256"))
        print("PASS NativePublicData V2 capture/hash/duplicate/type/role/expiry + dualEOF/cap + private-read-reject/metadata/publicfingerprint; no crypto-codec or authority claim")
    }
}
