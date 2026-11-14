import Darwin
import Foundation
import YNXBrowserCore

@main @MainActor
struct FileCommitProbe {
    private static let kept = Data("existing selected file".utf8)
    private static let incoming = Data(repeating: 0x51, count: 65_536)
    private static let source = "https://fixture.example.test/new.bin"
    private static let finishedAt = Date(timeIntervalSince1970: 1_785_148_800)

    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let suite = "com.ynx.browser.commit-delta.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite),
              defaults.persistentDomain(forName: suite) == nil else { throw CheckError("Test domain unavailable") }
        defer { defaults.removePersistentDomain(forName: suite) }
        let history = BrowserDownloadRecord(filename: "older.bin", source: "https://fixture.example.test/older.bin", finishedAt: finishedAt)
        let previous = try JSONEncoder().encode([history])
        defaults.set(previous, forKey: BrowserDownloadPersistence.defaultsKey)
        var failures: [String] = []
        let cases: [(String, () throws -> Void)] = [
            ("destination-directory", { try blockedDestination(root, defaults, previous, history) }),
            ("staging-symlink", { try substitutedStaging(root, defaults, previous, asDirectory: false) }),
            ("staging-directory", { try substitutedStaging(root, defaults, previous, asDirectory: true) }),
            ("staging-hard-link", { try hardLinkedStaging(root, defaults, previous) }),
            ("existing-destination-link-in-linked-directory", { try linkedDestination(root, defaults, history) }),
            ("ordinary-staging-preserves-data-and-attributes", { try ordinaryStaging(root) }),
            ("recovery-does-not-publish-or-remove-replaced-file", { try replacedRecoveryFile(root) }),
            ("ordinary-selected-directory-moved", { try replacedChosenDirectory(root, substituteSibling: false) }),
            ("ordinary-selected-directory-replaced", { try replacedChosenDirectory(root, substituteSibling: true) }),
        ]
        let selected = CommandLine.arguments.contains("--directory-rebind-only") ? cases.suffix(2) : cases[...]
        for (name, run) in selected {
            defaults.set(previous, forKey: BrowserDownloadPersistence.defaultsKey)
            do {
                try run()
                print("PASS \(name)")
            } catch {
                failures.append(name)
                print("FAIL \(name): \(error)")
            }
        }
        if !failures.isEmpty { exit(1) }
    }

    private static func replacedChosenDirectory(_ root: URL, substituteSibling: Bool) throws {
        let staging = try BrowserDownloadFile.makeOrdinaryStagingURL()
        defer { BrowserDownloadFile.discardOrdinaryStaging(staging) }
        try incoming.write(to: staging)
        let name = substituteSibling ? "replaced-folder" : "moved-folder"
        let directory = try makeDirectory(root, name)
        let removed = root.appendingPathComponent(name + "-original", isDirectory: true)
        let destination = directory.appendingPathComponent("selected.bin")
        try kept.write(to: destination)
        let alias = root.appendingPathComponent(name + "-link", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: directory)
        // One case uses the selected folder's spelling, the other a valid link
        // pointing to that folder until another process changes the pathname.
        let chosen = (substituteSibling ? alias : directory).appendingPathComponent("selected.bin")
        var replacementSibling: URL?
        let result: Result<Void, any Error> = Result {
            try BrowserDownloadFile.commitOrdinary(staging: staging, destination: chosen) {
                let siblings = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".part") }
                try check(siblings.count == 1, "Expected the real staging copy to exist before publication")
                try FileManager.default.moveItem(at: directory, to: removed)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
                try kept.write(to: destination)
                if substituteSibling {
                    let planted = directory.appendingPathComponent(siblings[0])
                    try kept.write(to: planted)
                    replacementSibling = planted
                }
            }
        }
        guard case .failure = result else { throw CheckError("Published a replacement directory's unrelated staging bytes") }
        try check(try Data(contentsOf: staging) == incoming, "Rejection lost the original recoverable payload")
        try check(try Data(contentsOf: destination) == kept, "Replacement directory's selected file changed")
        if let replacementSibling {
            try check(try Data(contentsOf: replacementSibling) == kept, "Cleanup removed unrelated bytes in the replacement directory")
        }
        try check(try FileManager.default.contentsOfDirectory(atPath: removed.path) == ["selected.bin"],
                  "Copied bytes stranded in the moved original destination directory")
        try check(try Data(contentsOf: removed.appendingPathComponent("selected.bin")) == kept,
                  "Original selected file changed after the destination path moved")
        // A stable, user-selected directory link still supports retry without a new fetch.
        if let replacementSibling {
            try FileManager.default.removeItem(at: destination)
            try FileManager.default.createSymbolicLink(at: destination, withDestinationURL: replacementSibling)
        }
        let recovery = try BrowserDownloadFile.OrdinaryRecovery(staging: staging)
        try recovery.save(to: chosen)
        recovery.discard()
        try check(try Data(contentsOf: destination) == incoming, "Save As could not use verified bytes at a stable chosen path")
        if let replacementSibling {
            try check(try destination.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == false &&
                      Data(contentsOf: replacementSibling) == kept, "Save As modified the existing destination link's referent")
        }
        try check(!FileManager.default.fileExists(atPath: staging.path), "Successful Save As left recovery bytes behind")
    }

    private static func replacedRecoveryFile(_ root: URL) throws {
        let staging = try BrowserDownloadFile.makeOrdinaryStagingURL()
        defer { BrowserDownloadFile.discardOrdinaryStaging(staging) }
        try incoming.write(to: staging)
        let recovery = try BrowserDownloadFile.OrdinaryRecovery(staging: staging)
        let moved = staging.deletingLastPathComponent().appendingPathComponent("original.bin")
        try FileManager.default.moveItem(at: staging, to: moved)
        try kept.write(to: staging)
        let destination = root.appendingPathComponent("replaced-recovery.bin")
        do {
            try recovery.save(to: destination)
            throw CheckError("Recovery accepted a substituted file")
        } catch is CocoaError {}
        recovery.discard()
        try check(try Data(contentsOf: staging) == kept && Data(contentsOf: moved) == incoming,
                  "Recovery removal touched an unowned file")
        try check(!FileManager.default.fileExists(atPath: destination.path), "Recovery published a substituted file")
    }

    private static func ordinaryStaging(_ root: URL) throws {
        let staging = try BrowserDownloadFile.makeOrdinaryStagingURL()
        defer { BrowserDownloadFile.discardOrdinaryStaging(staging) }
        let destination = root.appendingPathComponent("ordinary-staged.bin")
        try incoming.write(to: staging)
        let attribute = "com.ynx.qa.download"
        let value = Data("preserve".utf8)
        let written = value.withUnsafeBytes {
            setxattr(staging.path, attribute, $0.baseAddress, $0.count, 0, 0)
        }
        try check(written == 0, "Could not create the test attribute")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false)
        do {
            try BrowserDownloadFile.commitOrdinary(staging: staging, destination: destination)
            throw CheckError("Unexpected directory replacement")
        } catch is POSIXError {}
        try check(try Data(contentsOf: staging) == incoming, "Commit failure removed the owned payload")
        try FileManager.default.removeItem(at: destination)
        try BrowserDownloadFile.commitOrdinary(staging: staging, destination: destination)
        try check(try Data(contentsOf: destination) == incoming, "Committed bytes changed")
        var copied = Data(count: value.count)
        let count = copied.withUnsafeMutableBytes {
            getxattr(destination.path, attribute, $0.baseAddress, $0.count, 0, 0)
        }
        try check(count == value.count && copied == value, "Download attribute was lost")
        try check(!FileManager.default.fileExists(atPath: staging.deletingLastPathComponent().path),
                  "Successful commit left staging behind")
    }

    private static func makeDirectory(_ parent: URL, _ name: String) throws -> URL {
        let directory = parent.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        return directory
    }

    private static func blockedDestination(_ root: URL, _ defaults: UserDefaults, _ previous: Data, _ history: BrowserDownloadRecord) throws {
        let directory = try makeDirectory(root, "destination-directory")
        let destination = directory.appendingPathComponent("new.bin")
        let staging = BrowserDownloadFile.stagingURL(for: destination)
        let occupied = try makeDirectory(directory, "new.bin").appendingPathComponent("untouched.bin")
        try kept.write(to: occupied)
        try incoming.write(to: staging)

        let activity = try transfer(to: destination, staging: staging)
        let error = try finish(activity, staging: staging, destination: destination, defaults: defaults)
        try check(error != nil && activity.phase == .failed && !activity.canFinish, "Commit failure must end in failed")
        try check(try Data(contentsOf: staging) == incoming, "Failed commit lost the complete staging bytes")
        try check(try Data(contentsOf: occupied) == kept, "Failed commit modified an occupied destination")
        try check(defaults.data(forKey: BrowserDownloadPersistence.defaultsKey) == previous, "Failed commit changed the ledger")
        try check(!activity.complete(), "Late completion resurrected failed activity")

        let recovered = directory.appendingPathComponent("recovered.bin")
        let next = BrowserDownloadFile.stagingURL(for: recovered)
        try incoming.write(to: next)
        try kept.write(to: recovered)
        let retry = try transfer(to: recovered, staging: next)
        let retryError = try finish(retry, staging: next, destination: recovered, defaults: defaults)
        try check(retryError == nil && retry.phase == .completed, "A fresh transfer cannot atomically replace its selected file")
        try check(try Data(contentsOf: recovered) == incoming, "Completed destination does not contain exact bytes")
        try check(!FileManager.default.fileExists(atPath: next.path), "Committed staging still exists")
        try check(try Data(contentsOf: staging) == incoming, "Fresh transfer modified the previous failure staging")
        let records = BrowserDownloadPersistence.decodeRecords(from: defaults.data(forKey: BrowserDownloadPersistence.defaultsKey))
        let record = BrowserDownloadRecord(filename: "recovered.bin", source: source, finishedAt: finishedAt)
        try check(records == [record, history], "Successful retry did not record the selected name and original source exactly once")
    }

    private static func substitutedStaging(_ root: URL, _ defaults: UserDefaults, _ previous: Data, asDirectory: Bool) throws {
        let directory = try makeDirectory(root, asDirectory ? "staging-directory" : "staging-symlink")
        let external = directory.appendingPathComponent("unowned.bin")
        try incoming.write(to: external)
        let destination = directory.appendingPathComponent("selected.bin")
        if !asDirectory { try kept.write(to: destination) }
        let staging = BrowserDownloadFile.stagingURL(for: destination)
        let activity = try transfer(to: destination, staging: staging)
        if asDirectory {
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false)
        } else {
            try FileManager.default.createSymbolicLink(at: staging, withDestinationURL: external)
        }
        let error = try finish(activity, staging: staging, destination: destination, defaults: defaults)
        try check(error != nil && activity.phase == .failed, "Non-file staging was marked completed")
        try check(try Data(contentsOf: external) == incoming, "Unowned file changed")
        if asDirectory {
            try check(!FileManager.default.fileExists(atPath: destination.path), "A directory was saved as a download")
        } else {
            try check(try Data(contentsOf: destination) == kept, "Staging symlink replaced the selected file")
            try check(try FileManager.default.destinationOfSymbolicLink(atPath: staging.path) == external.path,
                      "Rejected source link should be left at the original staging path")
        }
        try check(defaults.data(forKey: BrowserDownloadPersistence.defaultsKey) == previous, "Rejection changed the ledger")
    }

    private static func hardLinkedStaging(_ root: URL, _ defaults: UserDefaults, _ previous: Data) throws {
        let directory = try makeDirectory(root, "staging-hard-link")
        let destination = directory.appendingPathComponent("selected.bin")
        let staging = BrowserDownloadFile.stagingURL(for: destination)
        try kept.write(to: destination)
        try FileManager.default.linkItem(at: destination, to: staging)
        let activity = try transfer(to: destination, staging: staging)
        let error = try finish(activity, staging: staging, destination: destination, defaults: defaults)
        try check(error != nil && activity.phase == .failed, "Same-inode rename was recorded as a new completed file")
        try check(try Data(contentsOf: destination) == kept, "Hard-link rejection changed the selected file")
        try check(defaults.data(forKey: BrowserDownloadPersistence.defaultsKey) == previous, "Hard-link rejection changed the ledger")
    }

    private static func linkedDestination(_ root: URL, _ defaults: UserDefaults, _ history: BrowserDownloadRecord) throws {
        let actual = try makeDirectory(root, "actual-selected-directory")
        let alias = root.appendingPathComponent("linked-selected-directory", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: actual)
        let unchanged = actual.appendingPathComponent("other.bin")
        try kept.write(to: unchanged)
        let destination = alias.appendingPathComponent("selected.bin")
        try FileManager.default.createSymbolicLink(at: destination, withDestinationURL: unchanged)
        let staging = BrowserDownloadFile.stagingURL(for: destination)
        try incoming.write(to: staging)
        let activity = try transfer(to: destination, staging: staging)
        let error = try finish(activity, staging: staging, destination: destination, defaults: defaults)
        try check(error == nil && activity.phase == .completed, "A linked chosen directory no longer works")
        let saved = actual.appendingPathComponent("selected.bin")
        let info = try saved.resourceValues(forKeys: [.isSymbolicLinkKey])
        try check(info.isSymbolicLink == false && Data(contentsOf: saved) == incoming, "Existing destination link was not replaced by the download")
        try check(try Data(contentsOf: unchanged) == kept, "The destination link's referent was modified")
        let records = BrowserDownloadPersistence.decodeRecords(from: defaults.data(forKey: BrowserDownloadPersistence.defaultsKey))
        try check(records == [BrowserDownloadRecord(filename: "selected.bin", source: source, finishedAt: finishedAt), history],
                  "Commit through selected directory link did not preserve the normal record")
    }

    private static func transfer(to destination: URL, staging: URL) throws -> BrowserDownloadActivity {
        let activity = BrowserDownloadActivity(context: .init(source: source, isPrivate: false), changed: {})
        let ledger = BrowserDownloadDecisionLedger()
        let download = NSObject()
        var resolved: URL?
        let ticket = ledger.begin(downloadID: ObjectIdentifier(download)) { resolved = $0 }
        try check(activity.attachDecision(ticket, suggestedFilename: "suggested.bin"), "Could not attach the save decision")
        try check(activity.destinationChosen(filename: destination.lastPathComponent), "Could not choose the final name")
        try check(ticket.resolve(staging) && resolved == staging, "Staging decision did not resolve once")
        return activity
    }

    // Mirrors main.swift's ordinary didFinish order at the pure Swift boundary.
    private static func finish(_ activity: BrowserDownloadActivity, staging: URL, destination: URL,
                               defaults: UserDefaults) throws -> (any Error)? {
        try check(activity.canFinish, "Activity is not transferring")
        do { try BrowserDownloadFile.commit(staging: staging, destination: destination) }
        catch {
            activity.fail("Failed to commit file · partial file retained, no completion recorded")
            return error
        }
        BrowserDownloadPersistence.persistFinishedDownload(
            context: .init(source: activity.source, isPrivate: activity.isPrivate, destinationFilename: destination.lastPathComponent),
            defaults: defaults, finishedAt: finishedAt)
        try check(activity.complete(), "Commit could not mark the activity completed")
        return nil
    }

    private static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try condition() else { throw CheckError(message) }
    }

    private struct CheckError: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }
}
