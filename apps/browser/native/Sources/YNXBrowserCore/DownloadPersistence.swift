import Foundation
import Darwin

public enum BrowserDownloadFile {
    public static func safeFilename(_ suggested: String) -> String {
        let leaf = suggested.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last ?? ""
        let cleaned = leaf.components(separatedBy: .controlCharacters).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, cleaned != ".", cleaned != ".." else { return "Download" }
        // A Character can contain many UTF-16 elements (emoji/combining marks).
        // Bound the decomposed name without splitting a grapheme or losing a
        // short extension. The chooser still validates the actual destination.
        func units(_ text: String) -> Int { text.decomposedStringWithCanonicalMapping.utf16.count }
        guard units(cleaned) > 240 else { return cleaned }
        let path = cleaned as NSString
        let extensionPart = path.pathExtension
        let suffix = !extensionPart.isEmpty && units(extensionPart) <= 31 ? "." + extensionPart : ""
        let stem = suffix.isEmpty ? cleaned : path.deletingPathExtension
        let budget = 240 - units(suffix)
        var prefix = "", used = 0
        for character in stem {
            let part = String(character), length = units(part)
            guard used + length <= budget else { break }
            prefix.append(character); used += length
        }
        return (prefix.isEmpty ? "Download" : prefix) + suffix
    }

    public static func stagingURL(for destination: URL) -> URL {
        destination.deletingLastPathComponent().appendingPathComponent(".ynx-download-\(UUID().uuidString).part")
    }

    public static func makeOrdinaryStagingURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ynx-download-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        return stagingURL(for: directory.appendingPathComponent("download"))
    }

    /// The ordinary controller owns this directory and the one download in it.
    public static func discardOrdinaryStaging(_ staging: URL) {
        try? FileManager.default.removeItem(at: staging.deletingLastPathComponent())
    }

    public struct OrdinaryRecovery {
        private let staging: URL
        private let identity: FileIdentity

        public init(staging: URL) throws {
            let descriptor = try BrowserDownloadFile.openOrdinaryStaging(staging)
            defer { Darwin.close(descriptor) }
            self.identity = try FileIdentity(descriptor: descriptor)
            self.staging = staging
        }

        public func save(to destination: URL) throws {
            try BrowserDownloadFile.commitOrdinary(staging: staging, destination: destination, matching: identity, beforePublish: {})
        }

        public func discard() {
            // Leave a replaced entry alone. The containing directory was created for this
            // download; remove it only when empty so cleanup cannot delete other files.
            var current = stat()
            guard lstat(staging.path, &current) == 0, identity.matchesEntry(current) else { return }
            if unlink(staging.path) == 0 { _ = rmdir(staging.deletingLastPathComponent().path) }
        }
    }

    private struct FileIdentity: Equatable {
        let device: dev_t
        let inode: ino_t
        let size: off_t
        let changedSeconds: Int
        let changedNanoseconds: Int

        init(descriptor: Int32) throws {
            var info = stat()
            guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1 else {
                throw CocoaError(.fileWriteInvalidFileName)
            }
            device = info.st_dev; inode = info.st_ino; size = info.st_size
            changedSeconds = info.st_ctimespec.tv_sec; changedNanoseconds = info.st_ctimespec.tv_nsec
        }

        func matchesEntry(_ info: stat) -> Bool {
            info.st_dev == device && info.st_ino == inode && info.st_mode & S_IFMT == S_IFREG && info.st_nlink == 1
        }
    }

    private static func openOrdinaryStaging(_ staging: URL) throws -> Int32 {
        guard staging.isFileURL else { throw CocoaError(.fileWriteInvalidFileName) }
        let descriptor = Darwin.open(staging.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        return descriptor
    }

    /// Copy the WebKit-owned bytes into a sibling of the selected destination.
    /// The final rename remains atomic even when the destination is on another volume.
    public static func commitOrdinary(staging: URL, destination: URL, beforePublish: () throws -> Void = {}) throws {
        try commitOrdinary(staging: staging, destination: destination, matching: nil, beforePublish: beforePublish)
    }

    private static func commitOrdinary(staging: URL, destination: URL, matching recovery: FileIdentity?, beforePublish: () throws -> Void) throws {
        guard staging.isFileURL, destination.isFileURL,
              staging.deletingLastPathComponent() != destination.deletingLastPathComponent() else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        if recovery != nil, staging.deletingLastPathComponent().resolvingSymlinksInPath() == destination.deletingLastPathComponent().resolvingSymlinksInPath() {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let source = try openOrdinaryStaging(staging)
        defer { Darwin.close(source) }
        let identity = try FileIdentity(descriptor: source)
        guard recovery == nil || recovery == identity else { throw CocoaError(.fileReadCorruptFile) }

        // Keep the same directory vnode for copy, publication and cleanup. The
        // user's chosen path may pass through a legitimate directory symlink.
        let directory = destination.deletingLastPathComponent()
        let folder = try openCommitDirectory(directory)
        defer { Darwin.close(folder) }
        let siblingName = stagingURL(for: destination).lastPathComponent
        let target = openat(folder, siblingName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard target >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        var published = false
        defer {
            if !published, let created = try? FileIdentity(descriptor: target) {
                var current = stat()
                if fstatat(folder, siblingName, &current, AT_SYMLINK_NOFOLLOW) == 0, created.matchesEntry(current) {
                    _ = unlinkat(folder, siblingName, 0)
                }
            }
            Darwin.close(target)
        }
        guard fcopyfile(source, target, nil, copyfile_flags_t(COPYFILE_DATA | COPYFILE_XATTR)) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        try beforePublish()
        if let recovery {
            guard try FileIdentity(descriptor: source) == recovery else { throw CocoaError(.fileReadCorruptFile) }
        }
        var openedFolder = stat(), selectedFolder = stat()
        guard fstat(folder, &openedFolder) == 0, stat(directory.path, &selectedFolder) == 0,
              openedFolder.st_dev == selectedFolder.st_dev, openedFolder.st_ino == selectedFolder.st_ino else {
            throw POSIXError(.ESTALE)
        }
        try publish(stagingName: siblingName, destinationName: destination.lastPathComponent, in: folder,
                    matching: FileIdentity(descriptor: target))
        published = true
        if recovery == nil { discardOrdinaryStaging(staging) }
    }

    /// Both paths are in the chosen directory so POSIX rename commits the complete file atomically.
    public static func commit(staging: URL, destination: URL) throws {
        let directory = destination.deletingLastPathComponent()
        guard staging.isFileURL, destination.isFileURL,
              staging.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let folder = try openCommitDirectory(directory)
        defer { Darwin.close(folder) }
        try publish(stagingName: staging.lastPathComponent, destinationName: destination.lastPathComponent, in: folder)
    }

    private static func openCommitDirectory(_ directory: URL) throws -> Int32 {
        let fd = directory.withUnsafeFileSystemRepresentation { path in
            guard let path else { return Int32(-1) }
            return Darwin.open(path, O_EXEC | O_DIRECTORY | O_CLOEXEC)
        }
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        return fd
    }

    private static func publish(stagingName sourceName: String, destinationName targetName: String, in folder: Int32,
                                matching expected: FileIdentity? = nil) throws {
        guard sourceName.hasPrefix(".ynx-download-"), (sourceName as NSString).pathExtension == "part",
              sourceName != targetName, !targetName.isEmpty, !targetName.contains("/"),
              targetName != ".", targetName != ".." else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        var stagingInfo = stat()
        guard fstatat(folder, sourceName, &stagingInfo, AT_SYMLINK_NOFOLLOW) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        guard stagingInfo.st_mode & S_IFMT == S_IFREG, stagingInfo.st_nlink == 1,
              expected?.matchesEntry(stagingInfo) ?? true else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        guard renameat(folder, sourceName, folder, targetName) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }
}

public struct BrowserDownloadRecord: Codable, Equatable, Sendable {
    public let filename: String
    public let source: String
    public let finishedAt: Date

    public init(filename: String, source: String, finishedAt: Date) {
        self.filename = filename
        self.source = source
        self.finishedAt = finishedAt
    }
}

public struct BrowserDownloadContext: Equatable, Sendable {
    public let source: String
    public let isPrivate: Bool
    public var destinationFilename: String?

    public init(source: String, isPrivate: Bool, destinationFilename: String? = nil) {
        self.source = source
        self.isPrivate = isPrivate
        self.destinationFilename = destinationFilename
    }
}

public enum BrowserDownloadPersistenceOutcome: Equatable, Sendable {
    case omittedPrivate
    case persisted(BrowserDownloadRecord)
}

public enum BrowserDownloadPersistence {
    public static let defaultsKey = "downloads"

    @discardableResult
    public static func persistFinishedDownload(
        context: BrowserDownloadContext,
        defaults: UserDefaults,
        finishedAt: Date = Date(),
        limit: Int = 500
    ) -> BrowserDownloadPersistenceOutcome {
        guard context.isPrivate == false else {
            return .omittedPrivate
        }

        let record = BrowserDownloadRecord(
            filename: context.destinationFilename ?? "User-selected file",
            source: context.source,
            finishedAt: finishedAt
        )
        var records = decodeRecords(from: defaults.data(forKey: defaultsKey))
        records.insert(record, at: 0)
        let bounded = Array(records.prefix(max(1, limit)))
        if let data = try? JSONEncoder().encode(bounded) {
            defaults.set(data, forKey: defaultsKey)
        }
        return .persisted(record)
    }

    public static func decodeRecords(from data: Data?) -> [BrowserDownloadRecord] {
        guard let data else { return [] }
        return (try? JSONDecoder().decode([BrowserDownloadRecord].self, from: data)) ?? []
    }
}
