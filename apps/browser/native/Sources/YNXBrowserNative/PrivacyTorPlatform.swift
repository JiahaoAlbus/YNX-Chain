import AppKit
import CryptoKit
import Foundation
import Network
import WebKit
import YNXBrowserCore

enum TorPlatformError: Error, Equatable {
    case invalidPort, invalidPin, binaryMismatch, binaryUnavailable, alreadyRunning
    case webKitIsolationNotVerified
    case unsafeSessionDirectory
}

/// Only the fixed upstream proxy module's complete INFO line can acknowledge bootstrap.
/// Listener creation, a SOCKS handshake, partial lines and arbitrary output never mean ready.
struct ArtiBootstrapSignalParser {
    private var pending = Data()
    enum Signal: Equatable { case deferred, ready }
    mutating func consume(_ bytes: Data) -> [Signal] {
        pending.append(bytes.prefix(65_536))
        if pending.count > 65_536 { pending.removeAll(); return [] }
        var signals: [Signal] = []
        while let newline = pending.firstIndex(of: 10) {
            let line = String(decoding: pending[..<newline], as: UTF8.self)
            pending.removeSubrange(...newline)
            guard line.contains("INFO"), line.contains("arti::subcommands::proxy:") else { continue }
            if line.hasSuffix("Sufficiently bootstrapped; proxy now functional.") { signals.append(.ready) }
            if line.hasSuffix("Bootstrapping deferred.") { signals.append(.deferred) }
        }
        return signals
    }
}

/// The shipped build has no verified Arti artifact or whole-window isolation admission.
/// Keep this explicit provider usable by the window state machine without starting an unverified route.
@MainActor final class TorRouteProvider: PrivacyRouteProvider {
    let mode: PrivacyRouteMode = .tor
    private let adapter = ArtiProcessAdapter()
    private let pin: ArtiProcessAdapter.BinaryPin?
    private let port: UInt16
    private let directory: URL?
    private let admission: RoutedPlatformIsolationAdmission
    private let bridge: ArtiProcessAdapter.BridgeConfiguration?
    private var reason = "Verified Arti supply and whole-window leak isolation are required; Tor route is blocked."
    init(pin: ArtiProcessAdapter.BinaryPin? = nil, port: UInt16 = 19150, directory: URL? = nil, admission: RoutedPlatformIsolationAdmission = .current, bridge: ArtiProcessAdapter.BridgeConfiguration? = nil) {
        self.pin = pin; self.port = port; self.directory = directory; self.admission = admission; self.bridge = bridge
    }
    func start() async throws -> PrivacyRouteEndpoint {
        guard admission.permitsWebContent, let pin, let directory else { throw PrivacyRouteError.blocked }
        do {
            try adapter.start(pin: pin, port: port, sessionDirectory: directory, deferBootstrap: false, bridge: bridge)
            let deadline = ContinuousClock.now.advanced(by: .seconds(bridge == nil ? 180 : 600))
            while ContinuousClock.now < deadline {
                try Task.checkCancellation()
                switch adapter.pollProcess() {
                case .bootstrapReady: return try PrivacyRouteEndpoint(port: port)
                case .exited, .stopped, .stopping: throw PrivacyRouteError.blocked
                default: try await Task.sleep(for: .milliseconds(100))
                }
            }
            reason = "Tor bootstrap timed out; no direct fallback is permitted."
            throw PrivacyRouteError.blocked
        } catch { adapter.stop(); throw error }
    }
    func status() async -> PrivacyRouteStatus {
        guard admission.permitsWebContent else { return .blocked(admission.reason) }
        switch adapter.pollProcess() {
        case .bootstrapReady: return .connected
        case .starting, .processRunningOnly: return .connecting
        default: return .blocked(reason)
        }
    }
    func stop() async { adapter.stop() }
}

/// A process lifecycle is not proof of a bootstrapped Tor circuit or browser egress isolation.
@MainActor final class ArtiProcessAdapter {
    static let pinnedVersion = "2.7.0"
    enum State: Equatable { case stopped, starting, processRunningOnly, bootstrapDeferred, bootstrapReady, stopping, exited(Int32) }
    private var process: Process?
    private var diagnosticPipe: Pipe?
    private var signalParser = ArtiBootstrapSignalParser()
    private var generation = UUID()
    private var pathMonitor: NWPathMonitor?
    private var hasInitialPath = false
    private var powerObservers: [NSObjectProtocol] = []
    private var shutdownTask: Task<Void, Never>?
    private var ownershipFD: Int32 = -1
    private(set) var state: State = .stopped
    private(set) var lastStopReason: String?
    var processIdentifier: Int32? { process?.processIdentifier }

    struct BinaryPin {
        let executable: URL
        let binarySHA256: String
        let sourceArchiveSHA256: String
        let version: String
    }

    struct BridgeConfiguration {
        let lines: [String]
        let transport: URL
        let transportSHA256: String
        func validate() throws {
            guard !lines.isEmpty, lines.count <= 32, lines.allSatisfy({ line in
                line.hasPrefix("obfs4 ") && line.utf8.count <= 4096 && line.unicodeScalars.allSatisfy({ (32...126).contains($0.value) })
            }), transport.isFileURL,
            transportSHA256 == "7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d" else { throw TorPlatformError.invalidPin }
        }
        func validateExecutable() throws {
            try validate()
            guard FileManager.default.isExecutableFile(atPath: transport.path),
                  (try transport.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true,
                  SHA256.hash(data: try Data(contentsOf: transport)).map({ String(format: "%02x", $0) }).joined() == transportSHA256 else { throw TorPlatformError.binaryMismatch }
        }
    }

    static func configuration(port: UInt16, sessionDirectory: URL, deferBootstrap: Bool = true, bridge: BridgeConfiguration? = nil) throws -> String {
        guard port > 0 else { throw TorPlatformError.invalidPort }
        // TOML accepts these JSON string escapes except JSON's optional escaped slash.
        func quoted(_ path: String) throws -> String {
            let encoder = JSONEncoder(); encoder.outputFormatting = .withoutEscapingSlashes
            return String(decoding: try encoder.encode(path), as: UTF8.self)
        }
        var result = """
        [application]
        watch_configuration = false
        permit_debugging = false
        defer_bootstrap = \(deferBootstrap ? "true" : "false")
        [proxy]
        socks_listen = ["127.0.0.1:\(port)"]
        dns_listen = []
        [storage]
        cache_dir = \(try quoted(sessionDirectory.appendingPathComponent("cache").path))
        state_dir = \(try quoted(sessionDirectory.appendingPathComponent("state").path))
        [rpc]
        enable = false
        """
        if let bridge {
            try bridge.validate()
            let encoder = JSONEncoder(); encoder.outputFormatting = .withoutEscapingSlashes
            let lines = String(decoding: try encoder.encode(bridge.lines), as: UTF8.self)
            result += "\n[bridges]\nenabled = true\nbridges = \(lines)\n[[bridges.transports]]\nprotocols = [\"obfs4\"]\npath = \(try quoted(bridge.transport.path))\narguments = []\nrun_on_startup = true\n"
        }
        return result
    }

    func start(pin: BinaryPin, port: UInt16, sessionDirectory: URL, deferBootstrap: Bool = true, bridge: BridgeConfiguration? = nil) throws {
        guard process == nil else { throw TorPlatformError.alreadyRunning }
        func validDigest(_ value: String) -> Bool {
            value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
        }
        guard pin.version == Self.pinnedVersion, validDigest(pin.binarySHA256), validDigest(pin.sourceArchiveSHA256),
              pin.sourceArchiveSHA256 == "a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813" else { throw TorPlatformError.invalidPin }
        guard pin.executable.isFileURL, FileManager.default.isExecutableFile(atPath: pin.executable.path),
              (try pin.executable.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else { throw TorPlatformError.binaryUnavailable }
        let bytes = try Data(contentsOf: pin.executable)
        let actual = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        guard actual == pin.binarySHA256 else { throw TorPlatformError.binaryMismatch }
        try bridge?.validateExecutable()
        let config = try Self.configuration(port: port, sessionDirectory: sessionDirectory, deferBootstrap: deferBootstrap, bridge: bridge)
        guard sessionDirectory.isFileURL else { throw TorPlatformError.unsafeSessionDirectory }
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: sessionDirectory.path, isDirectory: &isDirectory) {
            let attributes = try FileManager.default.attributesOfItem(atPath: sessionDirectory.path)
            guard isDirectory.boolValue, (try sessionDirectory.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true,
                  (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                  ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o077 == 0 else { throw TorPlatformError.unsafeSessionDirectory }
        } else { try FileManager.default.createDirectory(at: sessionDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        let descriptor = open(sessionDirectory.appendingPathComponent(".ynx-native-route.lock").path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
        var attributes = stat()
        guard fstat(descriptor, &attributes) == 0, attributes.st_uid == getuid(), attributes.st_nlink == 1,
              attributes.st_mode & S_IFMT == S_IFREG, attributes.st_mode & 0o077 == 0,
              flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { close(descriptor); throw TorPlatformError.alreadyRunning }
        ownershipFD = descriptor
        var started = false
        defer { if !started { releaseOwnership() } }
        let configURL = sessionDirectory.appendingPathComponent("arti.toml")
        try config.write(to: configURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
        let task = Process(); task.executableURL = pin.executable
        task.arguments = ["proxy", "--config", configURL.path, "--log-level", "info"]
        // Do not inherit routing overrides or private browser context. No shell, URL, RPC listener or LAN control API.
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": sessionDirectory.path]
        task.currentDirectoryURL = sessionDirectory
        task.standardInput = FileHandle.nullDevice
        let diagnostics = Pipe(); diagnosticPipe = diagnostics
        task.standardOutput = FileHandle.nullDevice; task.standardError = diagnostics
        generation = UUID(); let expected = generation; signalParser = ArtiBootstrapSignalParser()
        diagnostics.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            guard !bytes.isEmpty else { handle.readabilityHandler = nil; return }
            Task { @MainActor [weak self] in
                guard let self, self.generation == expected, self.process?.isRunning == true,
                      self.state != .stopping else { return }
                for signal in self.signalParser.consume(bytes) {
                    switch signal {
                    case .deferred: self.state = .bootstrapDeferred
                    case .ready: if !deferBootstrap { self.state = .bootstrapReady }
                    }
                }
            }
        }
        state = .starting
        do {
            try task.run(); process = task; state = .processRunningOnly; lastStopReason = nil; started = true
            if !deferBootstrap { monitorRouteInterruptions(generation: expected) }
        }
        catch { diagnostics.fileHandleForReading.readabilityHandler = nil; diagnosticPipe = nil; state = .stopped; throw error }
    }

    func pollProcess() -> State {
        if let process, !process.isRunning {
            state = .exited(process.terminationStatus); self.process = nil
            diagnosticPipe?.fileHandleForReading.readabilityHandler = nil; diagnosticPipe = nil
            releaseOwnership()
        }
        return state
    }

    func stop(reason: String = "explicit-stop") {
        if state == .stopping { _ = pollProcess(); return }
        if process?.isRunning == true { lastStopReason = reason }
        generation = UUID()
        pathMonitor?.cancel(); pathMonitor = nil
        for observer in powerObservers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        powerObservers.removeAll()
        if let process, process.isRunning {
            state = .stopping
            // Arti owns managed PT children; SIGINT lets its runtime close their stdin and state.
            process.interrupt()
            shutdownTask = Task { @MainActor [self, process] in
                defer { shutdownTask = nil }
                let deadline = ContinuousClock.now.advanced(by: .seconds(12))
                while process.isRunning, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(100)) }
                if process.isRunning, self.process === process { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
                _ = pollProcess()
            }
        }
        // Keep the original process handle until exit is observed; never spawn a replacement concurrently.
        _ = pollProcess()
        if process == nil { state = .stopped }
    }

    private func releaseOwnership() {
        if ownershipFD >= 0 { _ = flock(ownershipFD, LOCK_UN); close(ownershipFD); ownershipFD = -1 }
    }

    private func monitorRouteInterruptions(generation expected: UUID) {
        hasInitialPath = false
        let monitor = NWPathMonitor(); pathMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.generation == expected else { return }
                // The first satisfied path establishes the baseline. Every later path update is a fence.
                if !available || self.hasInitialPath { self.stop(reason: available ? "network-path-changed" : "network-unavailable") }
                else { self.hasInitialPath = true }
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.ynx.browser.arti-path"))
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification] {
            let observer = NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == expected else { return }
                    self.stop(reason: name == NSWorkspace.willSleepNotification ? "system-sleep" : "system-wake")
                }
            }
            powerObservers.append(observer)
        }
    }
}

@MainActor enum TorRoutedWebViewFactory {
    /// Builds only a configuration for synthetic, controlled leak probes. No WKWebView or request is created.
    static func configurationForControlledProbe(port: UInt16) throws -> WKWebViewConfiguration {
        guard let proxyPort = NWEndpoint.Port(rawValue: port), port > 0 else { throw TorPlatformError.invalidPort }
        let store = WKWebsiteDataStore.nonPersistent()
        var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: "127.0.0.1", port: proxyPort))
        proxy.allowFailover = false
        store.proxyConfigurations = [proxy]
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.suppressesIncrementalRendering = true
        return configuration
    }

    /// Public WebKit proxy APIs alone do not establish a no-WebRTC/STUN/QUIC/DNS-bypass boundary.
    /// Production must remain blocked until that platform boundary is implemented and independently verified.
    static func makeWebView(endpoint: PrivacyRouteEndpoint, admission: RoutedPlatformIsolationAdmission = .current) throws -> WKWebView {
        guard admission.permitsWebContent else { throw TorPlatformError.webKitIsolationNotVerified }
        let configuration = try configurationForControlledProbe(port: endpoint.port)
        return WKWebView(frame: .zero, configuration: configuration)
    }
}
