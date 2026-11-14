#if YNX_PRIVACY_ACCEPTANCE
import CoreFoundation
import CryptoKit
import Darwin
import Foundation
import YNXBrowserCore

/// PUBLIC diagnostic supply only. These pins never confer normal route qualification.
struct NymPublicExecutableSupply {
    enum Cohort: String {
        case fixedPublic = "YNX_NYM_PUBLIC_DUAL_EXECUTOR_SUPPLY_V2"
        case interactive = "YNX_NYM_INTERACTIVE_DUAL_EXECUTOR_SUPPLY_V1"

        var directorySHA256: String {
            switch self {
            case .fixedPublic: NymPublicExecutableSupply.directorySHA256
            case .interactive: "855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798"
            }
        }

        var directorySourceSHA256: String {
            switch self {
            case .fixedPublic: NymPublicExecutableSupply.directorySourceSHA256
            case .interactive: "65838e1371153c3ac7a497bf628082115c5b1a7fbe87426effe0a9d9c0951055"
            }
        }
    }

    static let directorySHA256 = "6dce5c8d32932b8968f4a4e2db65db52c48aaf049ad75dad7c4f249f1e8ffda4"
    static let runtimeSHA256 = "331afc307bd38c5a8adcddc25f0e333790bf332a61661ce1d800412917a9cb00"
    static let directorySourceSHA256 = "0704783948054fc2c8f6ba8f82a12ab06bda85910c642a9374c509670a1773cf"
    static let runtimeSourceSHA256 = "4f0eab68be0fa772fae47fa4cee3a9ed9ab5373cd38d30367df1f24431deab01"
    let directory: URL
    let executable: URL
    static func load(bundle: Bundle, cohort: Cohort = .fixedPublic) throws -> Self {
        guard let resources = bundle.resourceURL else { throw NymPublicRuntimeFailure.supplyRejected }
        let root = resources.appendingPathComponent("NymPublicRuntime", isDirectory: true)
        let manifest = try bytes(root.appendingPathComponent("manifest.json"), limit: 4096)
        guard let value = try JSONSerialization.jsonObject(with: manifest) as? [String: String],
              value == ["schema": cohort.rawValue, "directorySHA256": cohort.directorySHA256,
                        "runtimeSHA256": runtimeSHA256, "directorySourceManifestSHA256": cohort.directorySourceSHA256,
                        "runtimeSourceManifestSHA256": runtimeSourceSHA256] else { throw NymPublicRuntimeFailure.supplyRejected }
        let directory = root.appendingPathComponent("directory/nym-socks5-client")
        let runtime = root.appendingPathComponent("runtime/nym-socks5-client")
        guard digest(try bytes(directory, limit: 36_000_000)) == cohort.directorySHA256,
              digest(try bytes(runtime, limit: 36_000_000)) == runtimeSHA256,
              FileManager.default.isExecutableFile(atPath: directory.path), FileManager.default.isExecutableFile(atPath: runtime.path)
        else { throw NymPublicRuntimeFailure.supplyRejected }
        return .init(directory: directory, executable: runtime)
    }
    private static func bytes(_ url: URL, limit: Int) throws -> Data {
        guard url.resolvingSymlinksInPath().path == url.path else { throw NymPublicRuntimeFailure.supplyRejected }
        let fd = open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw NymPublicRuntimeFailure.supplyRejected }; defer { Darwin.close(fd) }
        var before = stat(), after = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1,
              before.st_uid == getuid(), before.st_size > 0, before.st_size <= limit else { throw NymPublicRuntimeFailure.supplyRejected }
        let data = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).read(upToCount: limit + 1) ?? Data()
        guard data.count == before.st_size, fstat(fd, &after) == 0, before.st_dev == after.st_dev,
              before.st_ino == after.st_ino, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec
        else { throw NymPublicRuntimeFailure.supplyRejected }
        return data
    }
    static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}

/// Public directory DATA, separate from Core's active-role production selector.
struct NymPublicDirectorySelection {
    let entryIdentity: String, requester: String
    let requesterNodeID: UInt32
    let epoch: UInt64, rotation: UInt64
    let basicSHA256: String, describedSHA256: String, epochSHA256: String
    let validUntil: Date
}

struct NymPublicDirectorySnapshot {
    let latest: NymLatestDirectoryInput
    let entryIDs: Set<UInt32>, exitIDs: Set<UInt32>
    let captureExpires: Date
    let captureMonotonicDeadline: ContinuousClock.Instant
    let payloadSHA256: String
    static let prefix = Data("YNX_NYM_QA_CAPABILITY_CANDIDATES_V2 ".utf8)

    /// Called only after the original pinned directory child exited zero, both
    /// original pipes reached EOF, and its descriptors were closed successfully.
    static func decode(stdout: Data, stderr: Data, runID: String, expires: Date, now: Date = Date()) throws -> Self {
        let monotonicStarted = ContinuousClock.now
        let remaining = expires.timeIntervalSince(now)
        guard remaining > 0, remaining <= 120, stdout.count > 1, stdout.count <= 16_777_217, stdout.last == 10,
              stderr.count <= 524_288, stderr.last == 10 else { throw NymPublicRuntimeFailure.outputIncomplete }
        let frames = stderr.split(separator: 10, omittingEmptySubsequences: false).dropLast().filter { $0.starts(with: prefix) }
        guard frames.count == 1 else { throw NymPublicRuntimeFailure.directoryFailed }
        let rawFrame = Data(frames[0].dropFirst(prefix.count))
        // The producer emits only five ASCII field names, fixed strings and u32
        // arrays. Reject escaped keys and duplicate keys before JSONSerialization.
        guard rawFrame.count <= 262_144, let text = String(data: rawFrame, encoding: .ascii), !text.contains("\\") else { throw NymPublicRuntimeFailure.directoryFailed }
        let expression = try NSRegularExpression(pattern: "\"([A-Za-z][A-Za-z0-9]*)\"\\s*:")
        let names = expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { String(text[Range($0.range(at: 1), in: text)!]) }
        let keys: Set<String> = ["schema", "runID", "payloadSHA256", "entryNodeIDs", "exitNodeIDs"]
        guard names.count == 5, Set(names) == keys,
              let frame = try JSONSerialization.jsonObject(with: rawFrame) as? [String: Any], Set(frame.keys) == keys,
              frame["schema"] as? String == "YNX_NYM_QA_CAPABILITY_CANDIDATES_V2", frame["runID"] as? String == runID
        else { throw NymPublicRuntimeFailure.directoryFailed }
        let raw = Data(stdout.dropLast()), digest = NymPublicExecutableSupply.digest(raw)
        guard frame["payloadSHA256"] as? String == digest else { throw NymPublicRuntimeFailure.directoryFailed }
        let entries = try ids(frame["entryNodeIDs"]), exits = try ids(frame["exitNodeIDs"])
        guard entries.count + exits.count <= 20_000,
              let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any], Set(value.keys) == ["schema", "basic", "described", "epoch"],
              value["schema"] as? String == "YNX_NYM_DIRECTORY_V1", let basic = value["basic"], let described = value["described"], let epoch = value["epoch"]
        else { throw NymPublicRuntimeFailure.directoryFailed }
        let latest = try NymLatestDirectoryInput(basic: JSONSerialization.data(withJSONObject: basic, options: [.sortedKeys]),
            described: JSONSerialization.data(withJSONObject: described, options: [.sortedKeys]),
            epoch: JSONSerialization.data(withJSONObject: epoch, options: [.sortedKeys]), receivedAt: now)
        return .init(latest: latest, entryIDs: Set(entries), exitIDs: Set(exits), captureExpires: expires,
            captureMonotonicDeadline: monotonicStarted.advanced(by: .nanoseconds(Int64(remaining * 1_000_000_000))), payloadSHA256: digest)
    }
    private static func ids(_ value: Any?) throws -> [UInt32] {
        guard let array = value as? [Any], !array.isEmpty, array.count <= 20_000 else { throw NymPublicRuntimeFailure.directoryFailed }
        let result = try array.map { item -> UInt32 in
            guard let number = item as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  !["f", "d"].contains(String(cString: number.objCType)), let value = UInt32(number.stringValue)
            else { throw NymPublicRuntimeFailure.directoryFailed }; return value
        }
        guard result == Array(Set(result)).sorted() else { throw NymPublicRuntimeFailure.directoryFailed }; return result
    }
    private static func rows(_ page: [String: Any]) throws -> [[String: Any]] {
        guard let rows = page["data"] as? [[String: Any]], !rows.isEmpty, rows.count <= 20_000,
              let pagination = page["pagination"] as? [String: Any], pagination["page"] as? Int == 0,
              pagination["total"] as? Int == rows.count, pagination["size"] as? Int == rows.count
        else { throw NymPublicRuntimeFailure.directoryFailed }; return rows
    }
    func select(now: Date = Date()) throws -> NymPublicDirectorySelection {
        guard now < captureExpires, ContinuousClock.now < captureMonotonicDeadline,
              let basic = try JSONSerialization.jsonObject(with: latest.basic) as? [String: Any],
              let metadata = basic["metadata"] as? [String: Any], metadata["status"] is NSNull,
              let epochID = metadata["absolute_epoch_id"] as? UInt64, let rotation = metadata["rotation_id"] as? UInt64,
              let page = basic["nodes"] as? [String: Any], let described = try JSONSerialization.jsonObject(with: latest.described) as? [String: Any],
              let epoch = try JSONSerialization.jsonObject(with: latest.epoch) as? [String: Any], epoch["total_elapsed_epochs"] as? UInt64 == epochID,
              let started = epoch["current_epoch_start"] as? String, let length = epoch["epoch_length"] as? [String: Any],
              let seconds = length["secs"] as? UInt64, (600...86400).contains(seconds), length["nanos"] as? UInt64 == 0,
              let refreshed = metadata["refreshed_at"] as? String else { throw NymPublicRuntimeFailure.staleDirectory }
        let formatter = ISO8601DateFormatter(), fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parts = refreshed.split(separator: " ")
        guard parts.count == 3, parts[2] == "+00:00:00", let fresh = fractional.date(from: "\(parts[0])T\(parts[1])Z"),
              let start = formatter.date(from: started) ?? fractional.date(from: started), now.timeIntervalSince(start) >= 0,
              fresh.timeIntervalSince(now) <= 5, now.timeIntervalSince(fresh) <= Double(seconds),
              now.addingTimeInterval(300) < start.addingTimeInterval(Double(seconds)) else { throw NymPublicRuntimeFailure.staleDirectory }
        let nodes = try Self.rows(page), descriptions = try Self.rows(described)
        var details: [UInt32: [String: Any]] = [:], seen = Set<UInt32>()
        for row in descriptions {
            guard let id = row["node_id"] as? UInt32, details.updateValue(row, forKey: id) == nil else { throw NymPublicRuntimeFailure.directoryFailed }
        }
        var entries: [(Double, UInt32, String)] = [], exits: [(Double, UInt32, String)] = []
        for node in nodes {
            guard let id = node["node_id"] as? UInt32, seen.insert(id).inserted else { throw NymPublicRuntimeFailure.directoryFailed }
            guard entryIDs.contains(id) || exitIDs.contains(id) else { continue }
            guard let identity = node["ed25519_identity_pubkey"] as? String, let roles = node["supported_roles"] as? [String: Bool],
                  let description = details[id]?["description"] as? [String: Any], let host = description["host_information"] as? [String: Any],
                  let keys = host["keys"] as? [String: Any], keys["ed25519"] as? String == identity,
                  let ips = node["ip_addresses"] as? [String], !ips.isEmpty, ips.allSatisfy(NymNumericBootstrapPlan.numeric),
                  let joinedIPs = host["ip_address"] as? [String], Set(ips) == Set(joinedIPs),
                  let performance = node["performance"] as? String, let score = Double(performance), score.isFinite, (0...1).contains(score)
            else { throw NymPublicRuntimeFailure.directoryFailed }
            if entryIDs.contains(id) {
                guard roles["entry"] == true, let entry = node["entry"] as? [String: Any], let hostname = entry["hostname"] as? String,
                      host["hostname"] as? String == hostname, let wss = entry["wss_port"] as? UInt16, wss > 0,
                      let ws = description["mixnet_websockets"] as? [String: Any], ws["wss_port"] as? UInt16 == wss,
                      entry["ws_port"] as? UInt16 == ws["ws_port"] as? UInt16 else { throw NymPublicRuntimeFailure.invalidNumericPlan }
                entries.append((score, id, identity))
            }
            if exitIDs.contains(id) {
                guard roles["exit_nr"] == true, let requester = description["network_requester"] as? [String: Any],
                      requester["uses_exit_policy"] as? Bool == true, let address = requester["address"] as? String,
                      address.split(separator: "@").last.map(String.init) == identity else { throw NymPublicRuntimeFailure.directoryFailed }
                // Typed Recipient membership came from the exact pinned Rust frame.
                exits.append((score, id, address))
            }
        }
        guard entryIDs.isSubset(of: seen), exitIDs.isSubset(of: seen) else { throw NymPublicRuntimeFailure.directoryFailed }
        let rank: ((Double, UInt32, String), (Double, UInt32, String)) -> Bool = { $0.0 == $1.0 ? $0.1 < $1.1 : $0.0 > $1.0 }
        guard let entry = entries.sorted(by: rank).first, let exit = exits.sorted(by: rank).first else { throw NymPublicRuntimeFailure.directoryFailed }
        return .init(entryIdentity: entry.2, requester: exit.2, requesterNodeID: exit.1, epoch: epochID, rotation: rotation,
            basicSHA256: NymPublicExecutableSupply.digest(latest.basic), describedSHA256: NymPublicExecutableSupply.digest(latest.described),
            epochSHA256: NymPublicExecutableSupply.digest(latest.epoch), validUntil: start.addingTimeInterval(Double(seconds) - 60))
    }
}
#endif
