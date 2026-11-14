import Foundation
import CoreFoundation
import CryptoKit
import Darwin

private enum ColdFailure: String, Error { case arguments, plan, notFresh, missingFreshProof, foreignOwner, synchronization, wrongTabs, diskUnavailable, unsafeDisk, diskMismatch }
private let marker = "P05PublicColdSessionOwner" // QA fixture ownership, never a product/profile schema.
private struct Plan: Decodable {
    let owner: UUID
    let suite: String
    let firstTabID: UUID
    let homeTabID: UUID
    let secretTabID: UUID
    let newTabID: UUID
    func validate() throws {
        guard owner.uuid.6 & 0xf0 == 0x40,
              suite == "com.ynx.browser.p05-cold-session." + owner.uuidString.lowercased(),
              Set([firstTabID, homeTabID, secretTabID, newTabID]).count == 4 else { throw ColdFailure.plan }
    }
    var first: BrowserSessionTab { .init(id: firstTabID, url: "https://example.org/PUBLIC-cold-A", title: "PUBLIC cold A", isPrivate: false) }
    var home: BrowserSessionTab { .init(id: homeTabID, url: BrowserLocalProfile.homeURL, title: "PUBLIC home", isPrivate: false) }
    var secret: BrowserSessionTab { .init(id: secretTabID, url: "https://PUBLIC-secret.invalid/never-save", title: "PUBLIC private excluded", isPrivate: true) }
    var fresh: BrowserSessionTab { .init(id: newTabID, url: "https://example.org/PUBLIC-cold-new", title: "PUBLIC explicit new session", isPrivate: false) }
}
private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func keys(_ suite: String) -> [String] {
    (CFPreferencesCopyKeyList(suite as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) as? [String] ?? []).sorted()
}
private func diskURL(_ suite: String) -> URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Preferences", isDirectory: true).appendingPathComponent(suite + ".plist")
}
private func diskBytes(_ path: URL) throws -> Data? {
    let fd = open(path.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    if fd < 0, errno == ENOENT { return nil }
    guard fd >= 0 else { throw ColdFailure.unsafeDisk }; defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
          info.st_nlink == 1, info.st_size <= 1_048_576 else { throw ColdFailure.unsafeDisk }
    return try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd()
}
private func writeJSON(_ value: [String: Any], _ path: URL) throws {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: path, options: .withoutOverwriting)
}

@main private struct BrowserColdSessionProbe {
    static func execute(stage: String, planURL: URL) throws -> [String: Any] {
        let plan = try JSONDecoder().decode(Plan.self, from: Data(contentsOf: planURL)); try plan.validate()
        let output = planURL.deletingLastPathComponent()
        let observations = output.appendingPathComponent("observations", isDirectory: true)
        let proofURL = output.appendingPathComponent("receipts/fresh.json")
        guard let defaults = UserDefaults(suiteName: plan.suite) else { throw ColdFailure.plan }
        var receipt: [String: Any] = ["schema": "YNX_PUBLIC_COLD_SESSION_PROCESS_V1", "stage": stage,
            "suite": plan.suite, "owner": plan.owner.uuidString.lowercased(), "pid": getpid(), "uid": getuid(),
            "GUI": "NOT_RUN", "network": "NOT_RUN", "RootSourceGrant": "NOT_RUN"]
        let path = diskURL(plan.suite)
        if stage == "fresh" {
            guard defaults.persistentDomain(forName: plan.suite) == nil, keys(plan.suite).isEmpty,
                  try diskBytes(path) == nil else { throw ColdFailure.notFresh }
            receipt["exactDomainAbsent"] = true; receipt["exactDiskFileAbsent"] = true
            receipt["status"] = "PASS"
            return receipt
        }
        guard let proof = try JSONSerialization.jsonObject(with: Data(contentsOf: proofURL)) as? [String: Any],
              proof["status"] as? String == "PASS", proof["stage"] as? String == "fresh",
              proof["suite"] as? String == plan.suite, proof["owner"] as? String == plan.owner.uuidString.lowercased(),
              proof["exactDomainAbsent"] as? Bool == true, proof["uid"] as? UInt32 == getuid() else { throw ColdFailure.missingFreshProof }
        if stage == "cleanup-verify" {
            let deadline = ContinuousClock.now.advanced(by: .seconds(10))
            var samples = 0
            repeat {
                samples += 1
                let domain = defaults.persistentDomain(forName: plan.suite)
                guard domain == nil || domain?.isEmpty == true, keys(plan.suite).isEmpty else { throw ColdFailure.foreignOwner }
                let disk = try diskBytes(path)
                let plist = try disk.map { try PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: Any] }
                if disk == nil || plist??.isEmpty == true {
                    receipt["status"] = "PASS"; receipt["ownedDomainAbsent"] = true
                    receipt["diskObservationSamples"] = samples
                    receipt["emptyDiskFileRetainedByCFPreferences"] = disk != nil
                    receipt["officialAPI"] = "PASS"; receipt["physicalPlistObservation"] = "PASS"
                    return receipt
                }
                usleep(50_000)
            } while ContinuousClock.now < deadline
            receipt["status"] = "PASS"; receipt["officialAPI"] = "PASS"; receipt["ownedDomainAbsent"] = true
            receipt["physicalPlistObservation"] = "UNKNOWN"; receipt["physicalObservationFirstCause"] = "diskMismatch-at-10s"
            receipt["diskObservationSamples"] = samples
            return receipt
        }
        if stage == "writer" {
            // Recheck freshness at the actual first write; never overwrite an existing domain.
            guard defaults.persistentDomain(forName: plan.suite) == nil, keys(plan.suite).isEmpty,
                  try diskBytes(path) == nil else { throw ColdFailure.notFresh }
            defaults.set(plan.owner.uuidString.lowercased(), forKey: marker)
        } else {
            let domain = defaults.persistentDomain(forName: plan.suite)
            if ["cleanup", "cleanup-verify"].contains(stage), domain == nil || domain?.isEmpty == true, keys(plan.suite).isEmpty {
                let disk = try diskBytes(path)
                let empty = try disk.map { try PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: Any] }
                if disk == nil || empty??.isEmpty == true {
                    receipt["status"] = "PASS"; receipt["ownedDomainAbsent"] = true
                    receipt["readOnlyAlreadyEmptyCleanup"] = true; receipt["officialAPI"] = "PASS"; receipt["physicalPlistObservation"] = "PASS"; return receipt
                }
            }
            guard domain?[marker] as? String == plan.owner.uuidString.lowercased(),
                  Set(domain?.keys.map { $0 } ?? []).isSubset(of: [marker, "tabs"]) else { throw ColdFailure.foreignOwner }
        }
        func persist(_ selection: [BrowserSessionTab]?) {
            if let selection { BrowserLocalProfile.persistTabs(selection, defaults: defaults) }
        }
        switch stage {
        case "writer":
            var selection = BrowserSessionPersistenceSelection()
            persist(selection.windowClosed(tabs: [plan.first, plan.home, plan.secret], isPrivate: false, survivingOrdinaryWindows: []))
            persist(selection.willQuit(openOrdinaryWindows: []))
        case "clear-writer":
            var selection = BrowserSessionPersistenceSelection()
            _ = selection.windowClosed(tabs: [plan.first, plan.home, plan.secret], isPrivate: false, survivingOrdinaryWindows: [])
            persist(selection.clear())
            persist(selection.update(openOrdinaryWindows: [[plan.first, plan.home, plan.secret]]))
            persist(selection.windowClosed(tabs: [plan.first], isPrivate: false, survivingOrdinaryWindows: []))
            persist(selection.willQuit(openOrdinaryWindows: []))
            guard !selection.allowsRecording else { throw ColdFailure.wrongTabs }
        case "explicit-writer":
            var selection = BrowserSessionPersistenceSelection()
            _ = selection.clear()
            selection.beginOrdinarySession()
            persist(selection.update(openOrdinaryWindows: [[plan.fresh, plan.home, plan.secret]]))
            persist(selection.willQuit(openOrdinaryWindows: [[plan.fresh, plan.home, plan.secret]]))
            guard selection.allowsRecording else { throw ColdFailure.wrongTabs }
        case "reader-initial", "reader-empty", "reader-new": break
        case "cleanup":
            if let data = try diskBytes(path) { try data.write(to: observations.appendingPathComponent("cleanup-before.plist"), options: .withoutOverwriting) }
            defaults.removePersistentDomain(forName: plan.suite)
            let synchronized = defaults.synchronize(), cfSynchronized = CFPreferencesAppSynchronize(plan.suite as CFString)
            receipt["userDefaultsSynchronize"] = synchronized; receipt["CFPreferencesAppSynchronize"] = cfSynchronized
            receipt["remainingOwnKeys"] = keys(plan.suite)
            let remaining = defaults.persistentDomain(forName: plan.suite)
            guard synchronized, cfSynchronized, keys(plan.suite).isEmpty,
                  remaining == nil || remaining?.isEmpty == true else { throw ColdFailure.synchronization }
            receipt["ownedDomainAbsent"] = true; receipt["officialAPI"] = "PASS"
            // Actual physical removal is checked by a separate process after this writer
            // exits/reaps. CFPreferences may still own pending filesystem work here.
            try writeJSON(receipt, observations.appendingPathComponent("cleanup-synchronization.json"))
            receipt["physicalCleanup"] = "PENDING_INDEPENDENT_READER"
            receipt["status"] = "PASS"; return receipt
        default: throw ColdFailure.arguments
        }
        if stage.hasSuffix("writer") || stage == "writer" {
            let synchronized = defaults.synchronize(), cfSynchronized = CFPreferencesAppSynchronize(plan.suite as CFString)
            receipt["userDefaultsSynchronize"] = synchronized; receipt["CFPreferencesAppSynchronize"] = cfSynchronized
            try writeJSON(receipt, observations.appendingPathComponent(stage + "-synchronization.json"))
            guard synchronized, cfSynchronized else { throw ColdFailure.synchronization }
        }
        let expected: [BrowserSessionTab] = ["reader-empty", "clear-writer"].contains(stage) ? []
            : (["reader-new", "explicit-writer"].contains(stage) ? [plan.fresh, plan.home] : [plan.first, plan.home])
        // Require a value in this exact owned domain before the production accessor can
        // search defaults. A missing/partial fixture never falls back to another domain.
        guard let ownedDomain = defaults.persistentDomain(forName: plan.suite), let raw = ownedDomain["tabs"] as? Data,
              defaults.data(forKey: "tabs") == raw else { throw ColdFailure.wrongTabs }
        let restored = BrowserLocalProfile.restoreBrowserSession(defaults: defaults)
        guard restored == expected, !String(decoding: raw, as: UTF8.self).contains("PUBLIC-secret") else { throw ColdFailure.wrongTabs }
        let direct = CFPreferencesCopyAppValue("tabs" as CFString, plan.suite as CFString) as? Data
        guard direct == raw else { throw ColdFailure.diskMismatch }
        // Writer observes its own memory/synchronization only. The separate reader,
        // launched after writer exit/reap, is the sole cold/disk persistence assertion.
        try raw.write(to: observations.appendingPathComponent(stage + "-tabs.json"), options: .withoutOverwriting)
        if stage.hasSuffix("writer") || stage == "writer" {
            if let disk = try diskBytes(path) {
                try disk.write(to: observations.appendingPathComponent(stage + "-first-disk.plist"), options: .withoutOverwriting)
            }
            receipt["physicalPersistence"] = "PENDING_INDEPENDENT_READER"
        } else {
            let deadline = ContinuousClock.now.advanced(by: .seconds(10))
            var matchedDisk: Data?, samples = 0
            repeat {
                samples += 1
                if let disk = try diskBytes(path) {
                    if samples == 1 { try disk.write(to: observations.appendingPathComponent(stage + "-first-disk.plist"), options: .withoutOverwriting) }
                    if let plist = try PropertyListSerialization.propertyList(from: disk, format: nil) as? [String: Any],
                       plist[marker] as? String == plan.owner.uuidString.lowercased(), plist["tabs"] as? Data == raw,
                       Set(plist.keys).isSubset(of: [marker, "tabs"]) { matchedDisk = disk; break }
                }
                usleep(50_000)
            } while ContinuousClock.now < deadline
            receipt["diskObservationSamples"] = samples
            try writeJSON(receipt, observations.appendingPathComponent(stage + "-disk-observation.json"))
            if let disk = matchedDisk {
                try disk.write(to: observations.appendingPathComponent(stage + "-disk.plist"), options: .withoutOverwriting)
                receipt["diskSHA256"] = hash(disk)
                receipt["ownDiskPlistEqualsUserDefaults"] = true
                receipt["physicalPlistObservation"] = "PASS"
            } else {
                receipt["physicalPlistObservation"] = "UNKNOWN"
                receipt["physicalObservationFirstCause"] = "diskUnavailable-at-10s"
            }
        }
        receipt["status"] = "PASS"; receipt["officialAPI"] = "PASS"; receipt["restoredCount"] = restored.count
        receipt["tabIDs"] = restored.map { $0.id.uuidString }; receipt["tabURLs"] = restored.map(\.url)
        receipt["tabsBytes"] = raw.count; receipt["tabsSHA256"] = hash(raw)
        receipt["CFPreferencesEqualsUserDefaults"] = true
        return receipt
    }
    static func main() {
        let args = CommandLine.arguments
        guard args.count == 3 else { exit(64) }
        do {
            let receipt = try execute(stage: args[1], planURL: URL(fileURLWithPath: args[2]))
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])); exit(0)
        } catch {
            let receipt: [String: Any] = ["status": "FAIL", "stage": args[1], "pid": getpid(), "error": (error as? ColdFailure)?.rawValue ?? "owned-IO-failure", "RootSourceGrant": "NOT_RUN"]
            if let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]) { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) }
            exit(1)
        }
    }
}
