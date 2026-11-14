#if YNX_PRIVACY_ACCEPTANCE
import CoreFoundation
import CryptoKit
import Darwin
import Foundation

/// A sealed fixed PUBLIC diagnostic descriptor. This is DATA, never a route,
/// qualification, Root, NE graph or arbitrary-target authority.
@MainActor enum TorSnowflakePublicBrowserBackend {
    static let bundleIdentifier = "com.ynxweb4.browser.qa.tor.public-search.snowflake"
    static let helperSHA256 = "8d072f55417245ac63abad63d04a4c89590dc99d62f53b7e1373418539645922"
    static let sourceInputsSHA256 = "8b593f018eee2aef253523dc5da8cd5d6670f0c5f08616ca7e22ede8423468d4"
    static let firstLineSHA256 = "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f"
    enum ArtiVariant: Equatable { case publishedBaseline, nonDirectChannelThirtySeconds }
    static let channelTimeoutSourceInputsSHA256 = "a72764db4438ec7b4132307bc98932225183e9bdeb1b677731c08ad307d27270"
    // No invented digest or Info-authorized binary. Only the actual successful
    // derived build receipt may supply this compile-time pin in a later cohort.
    static let channelTimeoutBinarySHA256: String? = "e76e9049e5a7becf2be31683879d42851a386d985e2bd86ef73e1459ea8e68f6"
    static let port: UInt16 = 63782
    static let fields: Set<String> = ["schema", "runID", "profile", "scratch", "profileDevice", "profileInode", "scratchDevice", "scratchInode", "scopeSHA256", "helperSHA256", "sourceInputsSHA256", "reviewedSourceSHA256", "selectedBridgeLineSHA256", "deadlineUnixNano", "fixedTarget"]
    static func claims(bundle: Bundle = .main) -> Bool {
        func flag(_ key: String) -> Bool {
            guard let n = bundle.object(forInfoDictionaryKey: key) as? NSNumber,
                  CFGetTypeID(n) == CFBooleanGetTypeID() else { return false }
            return n.boolValue
        }
        return bundle.bundleIdentifier == bundleIdentifier
            && flag("YNXPublicSearchDiagnostic")
            && flag("YNXPublicSnowflakeSearchDiagnostic")
            && TorPublicSearchDiagnosticPolicy.hasIsolatedRoleMetadata(bundle: bundle, snowflake: true)
    }
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func integer(_ value: Any?) throws -> UInt64 {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              n.doubleValue >= 0, n.doubleValue <= Double(UInt64.max),
              n.doubleValue.rounded(.towardZero) == n.doubleValue,
              String(cString: n.objCType) != "f", String(cString: n.objCType) != "d" else { throw TorPlatformError.invalidPin }
        return n.uint64Value
    }
    /// Canonical bytes also reject duplicate keys: decoding and re-encoding a
    /// duplicate cannot reproduce the original compact sorted object.
    static func decodeDescriptor(_ bytes: Data, variant: ArtiVariant = .publishedBaseline) throws -> [String: Any] {
        let expectedFields = variant == .publishedBaseline ? fields : fields.union(["artiVariant", "artiSHA256", "artiSourceInputsSHA256"])
        let schema = variant == .publishedBaseline ? "P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1" : "P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V2"
        guard bytes.count <= 16_384, let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(object.keys) == expectedFields,
              try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) == bytes,
              object["schema"] as? String == schema,
              object["helperSHA256"] as? String == helperSHA256,
              object["sourceInputsSHA256"] as? String == sourceInputsSHA256,
              object["reviewedSourceSHA256"] as? String == BundledTorBackend.bridgesSHA256,
              object["selectedBridgeLineSHA256"] as? String == firstLineSHA256,
              object["fixedTarget"] as? String == TorPublicSearchDiagnosticPolicy.target,
              let run = object["runID"] as? String,
              UUID(uuidString: run)?.uuidString.lowercased() == run,
              let scopeHash = object["scopeSHA256"] as? String,
              scopeHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw TorPlatformError.invalidPin }
        if variant == .nonDirectChannelThirtySeconds {
            guard let binary = channelTimeoutBinarySHA256,
                  object["artiVariant"] as? String == "non-direct-channel-30s",
                  object["artiSHA256"] as? String == binary,
                  object["artiSourceInputsSHA256"] as? String == channelTimeoutSourceInputsSHA256 else { throw TorPlatformError.invalidPin }
        }
        return object
    }
    private static func artiVariant(bundle: Bundle) throws -> ArtiVariant {
        guard let value = bundle.object(forInfoDictionaryKey: "YNXPublicArtiChannelTimeoutExperiment") else { return .publishedBaseline }
        guard let flag = value as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { throw TorPlatformError.invalidPin }
        return flag.boolValue ? .nonDirectChannelThirtySeconds : .publishedBaseline
    }
    /// A second, explicitly derived QA artifact. Original bundled supply is
    /// always independently verified; this never replaces its FBB byte pin.
    static func requireChannelTimeoutPin(_ pin: ArtiProcessAdapter.BinaryPin) throws {
        guard claims(), try artiVariant(bundle: .main) == .nonDirectChannelThirtySeconds,
              let binary = channelTimeoutBinarySHA256,
              binary.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              pin.version == "2.7.0", pin.binarySHA256 == binary,
              pin.sourceArchiveSHA256 == channelTimeoutSourceInputsSHA256,
              let resources = Bundle.main.resourceURL,
              pin.executable == resources.appendingPathComponent("PublicSnowflakeQA/ChannelTimeoutQA/arti"),
              FileManager.default.isExecutableFile(atPath: pin.executable.path),
              hash(try readRegular(pin.executable, limit: 64 * 1024 * 1024)) == binary else { throw TorPlatformError.invalidPin }
    }
    static func readRegular(_ url: URL, limit: Int, privateFile: Bool = false) throws -> Data {
        let fd = open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw TorPlatformError.invalidPin }
        let file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? file.close() }
        var before = stat(), after = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_uid == getuid(), before.st_nlink == 1,
              before.st_mode & (privateFile ? 0o077 : 0o022) == 0,
              before.st_size >= 0, before.st_size <= limit else { throw TorPlatformError.invalidPin }
        var bytes = Data()
        while bytes.count <= limit {
            let next = try file.read(upToCount: min(16_384, limit + 1 - bytes.count)) ?? Data()
            if next.isEmpty { break }
            bytes.append(next)
        }
        guard bytes.count <= limit, bytes.count == Int(before.st_size), fstat(fd, &after) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_size == after.st_size, before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else { throw TorPlatformError.invalidPin }
        return bytes
    }
    static func directory(_ path: String, device: UInt64, inode: UInt64) throws -> URL {
        let url = path.withCString { URL(fileURLWithFileSystemRepresentation: $0, isDirectory: true, relativeTo: nil) }
        guard path.hasPrefix("/"), url.path == path else { throw TorPlatformError.unsafeSessionDirectory }
        var fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard fd >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
        defer { close(fd) }
        for component in url.pathComponents.dropFirst() {
            guard component != ".", component != ".." else { throw TorPlatformError.unsafeSessionDirectory }
            let next = openat(fd, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
            close(fd); fd = next
        }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
              info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700,
              UInt64(info.st_dev) == device, info.st_ino == inode else { throw TorPlatformError.unsafeSessionDirectory }
        return url
    }
    @MainActor final class VerifiedLaunch {
        let pin: ArtiProcessAdapter.BinaryPin
        let artiVariant: ArtiVariant
        let helper: URL
        let profile: URL
        let scratch: URL
        let runID: String
        let scopeSHA256: String
        let deadline: ContinuousClock.Instant
        private let wallDeadline: UInt64
        private let profileIdentity: (UInt64, UInt64)
        private let scratchIdentity: (UInt64, UInt64)
        fileprivate let bridgeLine: String
        private var claimed = false
        fileprivate init(pin: ArtiProcessAdapter.BinaryPin, helper: URL, profile: URL, scratch: URL,
                         runID: String, scopeSHA256: String, wallDeadline: UInt64,
                         profileIdentity: (UInt64, UInt64), scratchIdentity: (UInt64, UInt64), bridgeLine: String,
                         artiVariant: ArtiVariant = .publishedBaseline) throws {
            self.pin = pin; self.helper = helper; self.profile = profile; self.scratch = scratch; self.runID = runID
            self.artiVariant = artiVariant
            self.scopeSHA256 = scopeSHA256; self.wallDeadline = wallDeadline
            self.profileIdentity = profileIdentity; self.scratchIdentity = scratchIdentity; self.bridgeLine = bridgeLine
            let remaining = Double(wallDeadline) / 1e9 - Date().timeIntervalSince1970
            guard remaining > 100, remaining <= 650 else { throw TorPlatformError.invalidPin }
            deadline = ContinuousClock.now.advanced(by: .nanoseconds(Int64(remaining * 1e9)))
        }
        func requireCurrent() throws {
            guard TorSnowflakePublicBrowserBackend.claims(), try TorSnowflakePublicBrowserBackend.artiVariant(bundle: .main) == artiVariant, ContinuousClock.now < deadline,
                  Date().timeIntervalSince1970 * 1e9 < Double(wallDeadline) else { throw TorPlatformError.invalidPin }
            _ = try TorSnowflakePublicBrowserBackend.directory(profile.path, device: profileIdentity.0, inode: profileIdentity.1)
            _ = try TorSnowflakePublicBrowserBackend.directory(scratch.path, device: scratchIdentity.0, inode: scratchIdentity.1)
            guard TorSnowflakePublicBrowserBackend.hash(try TorSnowflakePublicBrowserBackend.readRegular(profile.appendingPathComponent(".ynx-public-entry-qa-scope.json"), limit: 65_536, privateFile: true)) == scopeSHA256 else { throw TorPlatformError.invalidPin }
        }
        func requireLaunchBudget() throws {
            try requireCurrent()
            guard ContinuousClock.now.advanced(by: .seconds(100)) < deadline,
                  (Date().timeIntervalSince1970 + 100) * 1e9 < Double(wallDeadline) else { throw TorPlatformError.invalidPin }
        }
        func claimAttempt() throws {
            try requireLaunchBudget()
            guard !claimed, !FileManager.default.fileExists(atPath: profile.appendingPathComponent("RUN-ONCE").path),
                  !FileManager.default.fileExists(atPath: profile.appendingPathComponent(".ynx-native-route.lock").path) else { throw TorPlatformError.alreadyRunning }
            let fd = open(profile.appendingPathComponent(".ynx-public-browser-attempt").path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard fd >= 0 else { throw TorPlatformError.alreadyRunning }
            close(fd); claimed = true // Never remove/retry this run, including spawn failure.
        }
        var documentBudgetAvailable: Bool { ContinuousClock.now.advanced(by: .seconds(70)) < deadline }
        func configuration() throws -> String {
            try requireCurrent()
            let base = try ArtiProcessAdapter.configuration(port: TorSnowflakePublicBrowserBackend.port, sessionDirectory: profile, deferBootstrap: false, bridge: nil)
            return base + "\n[bridges]\nenabled = true\n"
        }
        func additionalArguments() throws -> [String] {
            try requireCurrent()
            // Same effective CLI override contract as the successful PUBLIC leg.
            return ["-o", "bridges.bridges=" + (try quote([bridgeLine])), "-o",
                "bridges.transports=[{protocols=[\"snowflake\"],path=" + (try quote(helper.path)) + ",arguments=[],run_on_startup=true}]"]
        }
        var environment: [String: String] {
            var value = ["PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "YNX_PUBLIC_ENTRY_QA_ROLE": "tor-fixed-public-backend", "YNX_PUBLIC_ENTRY_QA_PROFILE_HOME": profile.path]
            if let inherited = ProcessInfo.processInfo.environment["HOME"] { value["HOME"] = inherited }
            return value
        }
        private func quote<T: Encodable>(_ value: T) throws -> String {
            let encoder = JSONEncoder(); encoder.outputFormatting = .withoutEscapingSlashes
            return String(decoding: try encoder.encode(value), as: UTF8.self)
        }
    }
    static func load(bundle: Bundle = .main) throws -> VerifiedLaunch {
        guard claims(bundle: bundle), bundle.bundleURL == Bundle.main.bundleURL,
              let expected = bundle.object(forInfoDictionaryKey: "YNXPublicSnowflakeLaunchSHA256") as? String,
              expected.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let resources = bundle.resourceURL else { throw TorPlatformError.invalidPin }
        let root = resources.appendingPathComponent("PublicSnowflakeQA", isDirectory: true)
        let variant = try artiVariant(bundle: bundle)
        let bytes = try readRegular(root.appendingPathComponent("launch.json"), limit: 16_384)
        guard hash(bytes) == expected else { throw TorPlatformError.invalidPin }
        let object = try decodeDescriptor(bytes, variant: variant)
        guard let profilePath = object["profile"] as? String, let scratchPath = object["scratch"] as? String,
              let scopeHash = object["scopeSHA256"] as? String, let runID = object["runID"] as? String,
              scratchPath.range(of: "/ynx-public-search-[A-Za-z0-9]{8}$", options: .regularExpression) != nil,
              profilePath == scratchPath + "/YNX Browser Route State/Tor" else { throw TorPlatformError.invalidPin }
        let profileID = (try integer(object["profileDevice"]), try integer(object["profileInode"]))
        let scratchID = (try integer(object["scratchDevice"]), try integer(object["scratchInode"]))
        let profile = try directory(profilePath, device: profileID.0, inode: profileID.1)
        let scratch = try directory(scratchPath, device: scratchID.0, inode: scratchID.1)
        let scopeBytes = try readRegular(profile.appendingPathComponent(".ynx-public-entry-qa-scope.json"), limit: 65_536, privateFile: true)
        guard hash(scopeBytes) == scopeHash, let scope = try JSONSerialization.jsonObject(with: scopeBytes) as? [String: Any],
              scope["schema"] as? String == "P05_PUBLIC_ENTRY_QA_SCOPE_V1",
              scope["runID"] as? String == runID, scope["reviewedSourceSHA256"] as? String == BundledTorBackend.bridgesSHA256,
              scope["selectedBridgeLineSHA256"] as? String == firstLineSHA256,
              try integer(scope["profileDevice"]) == profileID.0, try integer(scope["profileInode"]) == profileID.1 else { throw TorPlatformError.invalidPin }
        let expiry = try integer(object["deadlineUnixNano"])
        guard expiry <= (try integer(scope["planDeadlineUnixNano"])), expiry <= (try integer(scope["mappingExpiresUnixNano"])) else { throw TorPlatformError.invalidPin }
        let helper = root.appendingPathComponent("lyrebird")
        guard FileManager.default.isExecutableFile(atPath: helper.path), hash(try readRegular(helper, limit: 64 * 1024 * 1024)) == helperSHA256 else { throw TorPlatformError.invalidPin }
        let supply = try BundledTorBackend.load(bundle: bundle) // Original publisher bytes remain unchanged and separately verified.
        let artiPin: ArtiProcessAdapter.BinaryPin
        if variant == .nonDirectChannelThirtySeconds {
            guard let binary = channelTimeoutBinarySHA256 else { throw TorPlatformError.invalidPin }
            let manifestBytes = try readRegular(root.appendingPathComponent("ChannelTimeoutQA/manifest.json"), limit: 16_384)
            guard let manifest = try JSONSerialization.jsonObject(with: manifestBytes) as? [String: Any],
                  Set(manifest.keys) == Set(["schema", "artiSHA256", "sourceInputsSHA256", "baseArtiSHA256", "baseSourceArchiveSHA256", "nonDirectSeconds", "directSeconds"]),
                  try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys, .withoutEscapingSlashes]) == manifestBytes,
                  manifest["schema"] as? String == "P05_DERIVED_ARTI_PUBLIC_CHANNEL_TIMEOUT_ARTIFACT_V1",
                  manifest["artiSHA256"] as? String == binary,
                  manifest["sourceInputsSHA256"] as? String == channelTimeoutSourceInputsSHA256,
                  manifest["baseArtiSHA256"] as? String == BundledTorBackend.artiSHA256,
                  manifest["baseSourceArchiveSHA256"] as? String == BundledTorBackend.sourceSHA256,
                  try integer(manifest["nonDirectSeconds"]) == 30,
                  try integer(manifest["directSeconds"]) == 5 else { throw TorPlatformError.invalidPin }
            // For this typed QA variant this field identifies the complete
            // derived source manifest, not the original published crate archive.
            artiPin = ArtiProcessAdapter.BinaryPin(executable: root.appendingPathComponent("ChannelTimeoutQA/arti"), binarySHA256: binary,
                sourceArchiveSHA256: channelTimeoutSourceInputsSHA256, version: "2.7.0")
            try requireChannelTimeoutPin(artiPin)
        } else { artiPin = supply.pin }
        let publicBytes = try readRegular(supply.resourceDirectory.appendingPathComponent("public-bridges.json"), limit: 1_048_576)
        guard let all = try JSONSerialization.jsonObject(with: publicBytes) as? [String: Any], let bridges = all["bridges"] as? [String: Any],
              let lines = bridges["snowflake"] as? [String], lines.count == 2, hash(Data(lines[0].utf8)) == firstLineSHA256 else { throw TorPlatformError.invalidPin }
        return try VerifiedLaunch(pin: artiPin, helper: helper, profile: profile, scratch: scratch, runID: runID, scopeSHA256: scopeHash,
            wallDeadline: expiry, profileIdentity: profileID, scratchIdentity: scratchID, bridgeLine: lines[0], artiVariant: variant)
    }
}
#endif
