import Foundation
import CryptoKit
import Darwin
import YNXBrowserCore

/// Supply admission only: no subprocess, network, WebKit or platform admission is created here.
@MainActor enum BundledTorBackend {
    enum Failure: String, Error { case resourcesMissing, manifestRejected, unsafeFile, digestMismatch, unsafeProfile, bridgesMissing, bridgesRejected }
    enum BridgeSource { case bundledPublic, privateProfileFile }

    static let resourcePath = "PrivacyBackends/Tor"
    static let artiSHA256 = "fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a"
    static let sourceSHA256 = "a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813"
    static let lyrebirdSHA256 = "7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d"
    static let bridgesSHA256 = "2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407"

    /// Closed manifest contract. A resource manifest cannot authorize replacement executable bytes.
    /// public-bridges.json is the unchanged, publisher-verified Expert Bundle pt_config.json.
    static let manifestFields: [String: String] = [
        "schema": "ynx-bundled-tor-v1", "contentScope": "source-pinned-executables-and-public-default-bridges-only",
        "artiVersion": "2.7.0", "artiExecutable": "arti", "artiSHA256": artiSHA256,
        "artiSourceArchiveSHA256": sourceSHA256,
        "artiCargoLockSHA256": "866b32b0fea381705308414e976d4125644c7b88772dbf508ea950369dd29689",
        "lyrebirdVersion": "0.9.0", "lyrebirdExecutable": "lyrebird", "lyrebirdSHA256": lyrebirdSHA256,
        "lyrebirdBundleArchiveSHA256": "b8da251eccbe9e82f3681ee3af3c97fb4291c4a4e153e5b824bde48a1117cd6a",
        "publicBridgesFile": "public-bridges.json", "publicBridgesSHA256": bridgesSHA256
    ]

    @MainActor struct VerifiedSupply {
        let resourceDirectory: URL
        let pin: ArtiProcessAdapter.BinaryPin
        let publicBridge: ArtiProcessAdapter.BridgeConfiguration
        let manifestSHA256: String

        /// Explicit local preparation only; never copies a QA/ordinary profile or writes a bridge file.
        /// Private bridges are opt-in and must already exist as owner-only bridges.json in this profile.
        func prepareProfile(applicationSupport: URL? = nil, bridgeSource: BridgeSource = .bundledPublic) throws -> PreparedBackend {
            try prepareProfile(applicationSupport: applicationSupport, bridgeSource: bridgeSource, components: ["YNX Browser Route State", "Tor"])
        }

        #if YNX_PRIVACY_ACCEPTANCE
        /// Opaque qualification selects a separate synthetic namespace. profileSHA256
        /// binds its profile ID, not a claim about the contents of a state directory.
        func prepareSyntheticTrialProfile(authority: SyntheticTrialAuthority, applicationSupport: URL? = nil) throws -> PreparedBackend {
            try authority.authorizeBackendPreparation(mode: .tor)
            let binding = authority.binding
            guard binding.profileSHA256 == digest(Data(binding.profileID.utf8)) else { throw Failure.unsafeProfile }
            let namespace = digest(Data((binding.profileID + "\n" + binding.runID + "\n" + binding.epoch).utf8))
            return try prepareProfile(applicationSupport: applicationSupport, bridgeSource: .bundledPublic,
                components: ["YNX Browser Synthetic Trials", "Tor", namespace])
        }
        #endif

        private func prepareProfile(applicationSupport: URL?, bridgeSource: BridgeSource, components: [String]) throws -> PreparedBackend {
            // Revalidate supply at use, rather than trusting a previously held verification result.
            let current = try BundledTorBackend.load(resourceDirectory: resourceDirectory)
            guard current.manifestSHA256 == manifestSHA256 else { throw Failure.manifestRejected }
            let support = try applicationSupport ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
            let directory = try profileDirectory(applicationSupport: support, components: components)
            let bridge: ArtiProcessAdapter.BridgeConfiguration
            switch bridgeSource {
            case .bundledPublic: bridge = current.publicBridge
            case .privateProfileFile:
                let root = try openDirectory(directory)
                defer { close(root) }
                var privateInfo = stat()
                if fstatat(root, "bridges.json", &privateInfo, AT_SYMLINK_NOFOLLOW) != 0 {
                    if errno == ENOENT { throw Failure.bridgesMissing }
                    throw Failure.bridgesRejected
                }
                let bytes: Data
                do { bytes = try readFile(root: root, name: "bridges.json", maximum: 65_536, executable: false, privateOwner: true) }
                catch { throw Failure.bridgesRejected }
                guard let object = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
                      Set(object.keys) == ["schema", "obfs4"], object["schema"] as? String == "ynx-private-tor-bridges-v1",
                      let lines = object["obfs4"] as? [String] else { throw Failure.bridgesRejected }
                bridge = ArtiProcessAdapter.BridgeConfiguration(lines: lines, transport: current.publicBridge.transport, transportSHA256: lyrebirdSHA256)
                do { try bridge.validate() } catch { throw Failure.bridgesRejected }
            }
            return PreparedBackend(pin: current.pin, directory: directory, bridge: bridge, manifestSHA256: manifestSHA256)
        }
    }

    @MainActor struct PreparedBackend {
        let pin: ArtiProcessAdapter.BinaryPin
        let directory: URL
        let bridge: ArtiProcessAdapter.BridgeConfiguration
        let manifestSHA256: String

        /// The current production gate remains false. Constructing this provider starts nothing.
        func makeProvider(port: UInt16 = 19150, admission: RoutedPlatformIsolationAdmission = .current) -> TorRouteProvider {
            TorRouteProvider(pin: pin, port: port, directory: directory, admission: admission, bridge: bridge)
        }
    }

    static func load(bundle: Bundle = .main) throws -> VerifiedSupply {
        guard let resources = bundle.resourceURL else { throw Failure.resourcesMissing }
        return try load(resourceDirectory: resources.appendingPathComponent(resourcePath, isDirectory: true))
    }

    /// Explicit resource root is also the package probe's intake. No download/fallback lookup exists.
    static func load(resourceDirectory: URL) throws -> VerifiedSupply {
        let root = try openDirectory(resourceDirectory)
        defer { close(root) }
        let manifest = try readFile(root: root, name: "manifest.json", maximum: 16_384, executable: false)
        guard let fields = (try? JSONSerialization.jsonObject(with: manifest)) as? [String: String], fields == manifestFields else { throw Failure.manifestRejected }
        let arti = try readFile(root: root, name: "arti", maximum: 64 * 1024 * 1024, executable: true)
        let transport = try readFile(root: root, name: "lyrebird", maximum: 64 * 1024 * 1024, executable: true)
        let publicBytes = try readFile(root: root, name: "public-bridges.json", maximum: 65_536, executable: false)
        guard digest(arti) == artiSHA256, digest(transport) == lyrebirdSHA256, digest(publicBytes) == bridgesSHA256 else { throw Failure.digestMismatch }
        guard let published = (try? JSONSerialization.jsonObject(with: publicBytes)) as? [String: Any],
              let groups = published["bridges"] as? [String: Any], let lines = groups["obfs4"] as? [String] else { throw Failure.bridgesRejected }
        let bridge = ArtiProcessAdapter.BridgeConfiguration(lines: lines, transport: resourceDirectory.appendingPathComponent("lyrebird"), transportSHA256: lyrebirdSHA256)
        do { try bridge.validate() } catch { throw Failure.bridgesRejected }
        let pin = ArtiProcessAdapter.BinaryPin(executable: resourceDirectory.appendingPathComponent("arti"), binarySHA256: artiSHA256, sourceArchiveSHA256: sourceSHA256, version: "2.7.0")
        return VerifiedSupply(resourceDirectory: resourceDirectory, pin: pin, publicBridge: bridge, manifestSHA256: digest(manifest))
    }

    private static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    private static func openDirectory(_ url: URL) throws -> Int32 {
        guard url.isFileURL, url.path.hasPrefix("/"), !url.pathComponents.contains("..") else { throw Failure.unsafeFile }
        // Walk every component using no-follow directory descriptors; reject ancestor symlinks too.
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw Failure.unsafeFile }
        for component in url.pathComponents.dropFirst() {
            let next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            close(descriptor)
            guard next >= 0 else { throw Failure.unsafeFile }
            descriptor = next
        }
        return descriptor
    }

    private static func readFile(root: Int32, name: String, maximum: Int, executable: Bool, privateOwner: Bool = false) throws -> Data {
        let descriptor = openat(root, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw Failure.unsafeFile }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_nlink == 1, info.st_size > 0, info.st_size <= maximum,
              info.st_mode & 0o022 == 0, !executable || info.st_mode & 0o111 != 0,
              !privateOwner || (info.st_uid == getuid() && info.st_mode & 0o077 == 0) else { throw Failure.unsafeFile }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 65_536)
        while data.count <= maximum {
            let count = read(descriptor, &buffer, min(buffer.count, maximum + 1 - data.count))
            if count == 0 { break }
            if count < 0 { if errno == EINTR { continue }; throw Failure.unsafeFile }
            data.append(contentsOf: buffer.prefix(count))
        }
        guard data.count == info.st_size, data.count <= maximum else { throw Failure.unsafeFile }
        return data
    }

    private static func profileDirectory(applicationSupport: URL, components: [String]) throws -> URL {
        var descriptor: Int32
        do { descriptor = try openDirectory(applicationSupport) } catch { throw Failure.unsafeProfile }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o022 == 0 else { throw Failure.unsafeProfile }
        var directory = applicationSupport
        for component in components {
            if mkdirat(descriptor, component, 0o700) != 0 && errno != EEXIST { throw Failure.unsafeProfile }
            let next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else { throw Failure.unsafeProfile }
            guard fstat(next, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700 else { close(next); throw Failure.unsafeProfile }
            close(descriptor); descriptor = next
            directory.appendPathComponent(component, isDirectory: true)
        }
        return directory
    }
}
