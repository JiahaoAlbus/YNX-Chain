import AppKit
import CryptoKit
import Foundation
import Network
import WebKit
import YNXBrowserCore

#if YNX_PRIVACY_ACCEPTANCE
import CoreFoundation
import Darwin

/// PUBLIC R2 observation only. No qualification, route authority, addresses or interface names.
struct TorPublicObservablePath: Codable, Equatable, Sendable {
    let status: String
    let interfaceTypes: [String]
    let expensive: Bool
    let constrained: Bool
    let supportsIPv4: Bool
    let supportsIPv6: Bool
    let supportsDNS: Bool
    init(_ path: NWPath) {
        status = path.status == .satisfied ? "satisfied" : path.status == .requiresConnection ? "requiresConnection" : "unsatisfied"
        let types: [(NWInterface.InterfaceType, String)] = [(.wifi, "wifi"), (.wiredEthernet, "wiredEthernet"), (.cellular, "cellular"), (.loopback, "loopback"), (.other, "other")]
        interfaceTypes = types
            .filter { path.usesInterfaceType($0.0) }.map { $0.1 }
        expensive = path.isExpensive; constrained = path.isConstrained
        supportsIPv4 = path.supportsIPv4; supportsIPv6 = path.supportsIPv6; supportsDNS = path.supportsDNS
    }
}

/// Diagnostic comparison of immutable Network path snapshots. Only the Bool
/// crosses to MainActor; no path description, address or interface name leaves
/// this locked holder. Equality is not a flow/LeakSafe proof or a stop override.
private final class TorPublicPathContentComparison: @unchecked Sendable {
    private let lock = NSLock()
    private var previous: NWPath?
    func compareAndRemember(_ path: NWPath) -> Bool? {
        lock.lock(); defer { lock.unlock() }
        let equal = previous.map { $0 == path }
        previous = path
        return equal
    }
}

/// Retains only fixed upstream message templates. Unknown text is NOT "safely redacted raw".
enum TorPublicStderrSanitizer {
    static func line(_ raw: Data) -> [String: Any] {
        var result: [String: Any] = ["rawLineBytes": raw.count, "rawLineSHA256": SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined(), "textDisposition": "omitted-unknown-template"]
        guard raw.count <= 4096, var text = String(data: raw, encoding: .utf8) else { result["textDisposition"] = "omitted-size-or-encoding"; return result }
        text = text.replacingOccurrences(of: "\u{1b}\\[[0-9;]*m", with: "", options: .regularExpression)
        guard text.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value < 127 }) else { result["textDisposition"] = "omitted-control-or-nonascii"; return result }
        // Fixed tor-chanmgr0.47.0 Error display templates. This is text-template
        // observation, not access to the Rust typed error or a control permit.
        let prefix = #"^(?:Attempt [0-9]{1,4}: Problem opening a channel to [^\r\n]{1,768}: )?"#
        let errors: [(String, String)] = [
            (#"^(?:Attempt [0-9]{1,4}: )?Problem opening a channel to [^\r\n]{1,768}: Channel for [^\r\n]{1,768} timed out$"#, "ARTI_CHANNEL_TIMEOUT"),
            (prefix + #"Network IO error, or TLS error, in TLS negotiation, talking to [^\r\n]{1,768}$"#, "ARTI_CHANNEL_TLS_IO"),
            (prefix + #"Protocol error while opening a channel with [^\r\n]{1,768}$"#, "ARTI_CHANNEL_PROTOCOL_ERROR")
        ]
        for (pattern, code) in errors where text.range(of: pattern, options: .regularExpression) != nil {
            result["pinnedErrorTemplateObserved"] = code
            result["errorTemplateScope"] = "continuation-text-not-typed-error"
            result["textDisposition"] = "fixed-error-class-only-all-variable-text-omitted"
            return result
        }
        let envelope = #"^ *([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z) +(TRACE|DEBUG|INFO|WARN|ERROR) +([a-z0-9_:]+): (.*)$"#
        guard let expression = try? NSRegularExpression(pattern: envelope), let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return result }
        func part(_ index: Int) -> String { String(text[Range(match.range(at: index), in: text)!]) }
        let target = part(3), body = part(4)
        let targets: Set<String> = ["arti::subcommands::proxy", "tor_dirmgr", "tor_dirmgr::bootstrap", "tor_ptmgr", "tor_ptmgr::ipc", "tor_ptmgr::ipc::sealed", "tor_guardmgr", "tor_chanmgr", "tor_chanmgr::builder"]
        guard targets.contains(target) else { result["textDisposition"] = "omitted-module"; return result }
        result["upstreamTimestamp"] = part(1); result["level"] = part(2); result["target"] = target
        // Every retained character is from a pinned upstream fixed literal or a bounded decimal COUNT.
        let literals = ["Sufficiently bootstrapped; proxy now functional.", "Bootstrapping deferred.", "Loaded a good directory from cache.", "Didn't get usable directory from cache.", "We have enough information to build circuits.", "Bootstrapping task exited before finishing.", "Directory being fetched is now outdated; resetting download state.", "Unable to advance downloading state", "PT binary initialisation done", "PT binary now proxying connections via supplied URI", "About to fetch certificates.", "Looking for a cached consensus.", "Looking for a consensus.", "Downloading a consensus.", "Validated consensus; about to get microdescriptors", "Failed to validate consensus"]
        var retained: String?
        for literal in literals {
            let pattern = "^(?:[0-9]{1,6}: )?(" + NSRegularExpression.escapedPattern(for: literal) + #")(?=$| [a-z_]+=)"#
            if let re = try? NSRegularExpression(pattern: pattern), let found = re.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)), let range = Range(found.range(at: 1), in: body) { retained = String(body[range]); break }
        }
        if retained == nil {
            let pattern = #"^(?:[0-9]{1,6}: )?(Downloading certificates for consensus \(we are missing [0-9]{1,6}/[0-9]{1,6}\)\.|Downloading microdescriptors \(we are missing [0-9]{1,6}\)\.)(?=$| [a-z_]+=)"#
            if let re = try? NSRegularExpression(pattern: pattern), let found = re.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)), let range = Range(found.range(at: 1), in: body) { retained = String(body[range]) }
        }
        // This is explicitly a keyword observation, not a reconstructed full error chain.
        let lower = body.lowercased()
        result["errorKindKeywordsOnly"] = ["timed out", "timeout", "connection refused", "network is unreachable", "no route to host", "certificate", "tls", "handshake", "directory", "bootstrap"].filter { lower.contains($0) }
        if let retained {
            result["textDisposition"] = "fixed-upstream-excerpt-variable-fields-omitted"
            result["sanitizedLine"] = part(1) + " " + part(2) + " " + target + ": " + retained
        }
        return result
    }
}

@MainActor final class TorPublicRuntimeTrace {
    enum Execution: String { case installedPublic, adjacentCLI, installedSnowflakePublic }
    let file: URL
    private let handle: FileHandle
    private var sequence = 0
    private var written = 0
    private var droppedEvents = 0
    private var pending = Data()
    private var overlongLine = false
    private var prefixHasher = SHA256()
    private var hashedBytes = 0
    private var totalBytes = 0
    private var stderrLines = 0
    private let began = DispatchTime.now().uptimeNanoseconds
    private var lastPath: TorPublicObservablePath?
    private var seenPT = Set<String>()
    private struct ManagedIdentity {
        let pid: Int32
        let seconds: UInt64
        let microseconds: UInt64
        let path: String
    }
    private var managedIdentities: [ManagedIdentity] = []
    private var transportPath: String?
    private var originalArtiPID: Int32?
    private var artiStart: (UInt64, UInt64)?
    init(directory: URL, execution: Execution) throws {
        let expectedRole: String
        switch execution {
        case .installedPublic: expectedRole = "com.ynxweb4.browser.qa.tor.public-search"
        case .adjacentCLI: expectedRole = "com.ynxweb4.browser.qa.tor.public-search.r2-cli"
        case .installedSnowflakePublic: expectedRole = TorSnowflakePublicBrowserBackend.bundleIdentifier
        }
        if execution == .installedSnowflakePublic, !TorSnowflakePublicBrowserBackend.claims() { throw TorPlatformError.invalidPin }
        guard Bundle.main.bundleIdentifier == expectedRole,
              let marker = Bundle.main.object(forInfoDictionaryKey: "YNXPublicSearchDiagnostic") as? NSNumber,
              CFGetTypeID(marker) == CFBooleanGetTypeID(), marker.boolValue else { throw TorPlatformError.invalidPin }
        var st = stat()
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
        defer { close(fd) }
        guard fstat(fd, &st) == 0, st.st_uid == getuid(), st.st_mode & 0o777 == 0o700 else { throw TorPlatformError.unsafeSessionDirectory }
        file = directory.appendingPathComponent("public-runtime.jsonl")
        let output = openat(fd, "public-runtime.jsonl", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard output >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
        handle = FileHandle(fileDescriptor: output, closeOnDealloc: true)
        record("begin", ["execution": execution.rawValue, "schema": "P05_TOR_PUBLIC_RUNTIME_R2_V1", "stderrPolicy": "fixed-upstream-excerpts-only; unknown-text-omitted", "privacyAdmission": "UNCHANGED_BLOCKED"])
    }
    func record(_ kind: String, _ fields: [String: Any] = [:], capturedAt: UInt64? = nil) {
        guard sequence < 1024, written < 512 * 1024, DispatchTime.now().uptimeNanoseconds - began <= 900_000_000_000 else { droppedEvents += 1; return }
        sequence += 1
        var value = fields
        value["event"] = kind; value["sequence"] = sequence
        value["observedMonotonicNS"] = capturedAt ?? DispatchTime.now().uptimeNanoseconds
        value["processedMonotonicNS"] = DispatchTime.now().uptimeNanoseconds
        value["wallUTC"] = ISO8601DateFormatter().string(from: Date())
        guard let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), bytes.count <= 8192,
              written + bytes.count + 1 <= 512 * 1024 else { droppedEvents += 1; return }
        do { try handle.write(contentsOf: bytes + Data([10])); written += bytes.count + 1 } catch { droppedEvents += 1 }
    }
    func path(_ value: TorPublicObservablePath, baselineAlreadySet: Bool, capturedAt: UInt64, pathContentEqualToPrevious: Bool? = nil) {
        var fields = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(value))) as? [String: Any] ?? [:]
        fields["baselineAlreadySet"] = baselineAlreadySet
        fields["sameObservable"] = lastPath.map { $0 == value } as Any? ?? NSNull()
        fields["sameObservableIsNotProofOfSameNetwork"] = true
        fields["pathContentEqualToPrevious"] = pathContentEqualToPrevious as Any? ?? NSNull()
        fields["pathContentEqualityDoesNotProveLeakSafety"] = true
        record("networkPath", fields, capturedAt: capturedAt); lastPath = value
    }
    func stderr(_ bytes: Data, capturedAt: UInt64) {
        totalBytes += bytes.count
        let prefix = bytes.prefix(max(0, 262_144 - hashedBytes)); prefixHasher.update(data: prefix); hashedBytes += prefix.count
        for byte in bytes.prefix(262_144) {
            if byte == 10 {
                if stderrLines < 512 {
                    stderrLines += 1
                    if overlongLine { record("stderrLine", ["textDisposition": "omitted-overlong-line"], capturedAt: capturedAt) }
                    else { if pending.last == 13 { pending.removeLast() }; record("stderrLine", TorPublicStderrSanitizer.line(pending), capturedAt: capturedAt) }
                }
                pending.removeAll(keepingCapacity: true); overlongLine = false
            } else if pending.count < 4096 && !overlongLine { pending.append(byte) }
            else { pending.removeAll(keepingCapacity: true); overlongLine = true }
        }
        if bytes.count > 262_144 { pending.removeAll(); overlongLine = true }
    }
    private static func identity(_ pid: Int32) -> (info: proc_bsdinfo, path: String)? {
        var info = proc_bsdinfo(), buffer = [CChar](repeating: 0, count: 4096)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size)) == MemoryLayout<proc_bsdinfo>.size,
              info.pbi_pid == pid, info.pbi_uid == getuid(), proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        return (info, String(cString: buffer))
    }
    func launched(pid: Int32, transport: URL?) {
        originalArtiPID = pid; transportPath = transport?.path
        var fields: [String: Any] = ["pid": pid]
        if let value = Self.identity(pid) {
            artiStart = (value.info.pbi_start_tvsec, value.info.pbi_start_tvusec)
            fields["startSeconds"] = value.info.pbi_start_tvsec; fields["startMicroseconds"] = value.info.pbi_start_tvusec; fields["ppid"] = value.info.pbi_ppid
        }
        record("artiStarted", fields)
    }
    func observeManagedTransport() {
        guard let pid = originalArtiPID, let path = transportPath, let start = artiStart,
              let parent = Self.identity(pid), parent.info.pbi_start_tvsec == start.0, parent.info.pbi_start_tvusec == start.1 else { return }
        for child in Self.observedChildPIDs(parent: pid) {
            guard let value = Self.identity(child), value.info.pbi_ppid == pid, value.path == path,
                  let after = Self.identity(child), after.info.pbi_start_tvsec == value.info.pbi_start_tvsec, after.info.pbi_start_tvusec == value.info.pbi_start_tvusec, after.path == path else { continue }
            let key = "\(child):\(value.info.pbi_start_tvsec):\(value.info.pbi_start_tvusec)"
            if seenPT.insert(key).inserted {
                managedIdentities.append(ManagedIdentity(pid: child, seconds: value.info.pbi_start_tvsec,
                    microseconds: value.info.pbi_start_tvusec, path: path))
                record("managedPTObserved", ["pid": child, "ppid": pid, "startSeconds": value.info.pbi_start_tvsec, "startMicroseconds": value.info.pbi_start_tvusec, "exactTransportPathMatched": true, "observationNotWaitpid": true])
            }
        }
    }
    /// Only already-observed exact managed children. No PID discovery/reattach,
    /// signal, waitpid or claim about unobserved descendants is performed here.
    var knownManagedTransportAbsence: Bool? { Self.observeKnownManagedTransportAbsence(managedIdentities) }
    private static func observeKnownManagedTransportAbsence(_ identities: [ManagedIdentity]) -> Bool? {
        guard !identities.isEmpty else { return nil }
        for expected in identities {
            if let actual = Self.identity(expected.pid) {
                // A changed incarnation is deliberately UNKNOWN, not a new owner.
                guard actual.info.pbi_start_tvsec == expected.seconds,
                      actual.info.pbi_start_tvusec == expected.microseconds,
                      actual.path == expected.path else { return nil }
                return false
            }
            // identity() has multiple calls; re-check proc-info and its errno
            // directly rather than interpreting any path/permission error as gone.
            var info = proc_bsdinfo()
            errno = 0
            let size = proc_pidinfo(expected.pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
            guard size <= 0, errno == ESRCH else { return nil }
        }
        return true
    }
    static func observedChildPIDs(parent: Int32) -> [Int32] {
        var children = [Int32](repeating: 0, count: 64)
        // Apple's proc_listchildpids wrapper already converts byte size to PID count.
        // Unlike proc_listpids, dividing its result by sizeof(pid_t) loses small child sets.
        let count = proc_listchildpids(parent, &children, Int32(children.count * MemoryLayout<Int32>.size))
        guard count > 0 else { return [] }
        return Array(children.prefix(min(children.count, Int(count)))).filter { $0 > 0 }
    }
    func checkpoint(_ kind: String) {
        var copy = prefixHasher
        record(kind, ["stderrBytesObserved": totalBytes, "stderrPrefixHashedBytes": hashedBytes, "stderrPrefixSHA256": copy.finalize().map { String(format: "%02x", $0) }.joined(), "stderrLinesRetainedOrOmitted": stderrLines, "partialLineBytesOmitted": pending.count, "droppedEvents": droppedEvents])
        try? handle.synchronize()
    }
}
#endif

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
            var raw = Data(pending[..<newline])
            pending.removeSubrange(...newline)
            if raw.last == 13 { raw.removeLast() }
            guard let line = String(data: raw, encoding: .utf8) else { continue }
            // Fixed Arti2.7.0 non-TTY stderr uses UTC LogTimer + INFO + target
            // + literal message (trace-level run/run_proxy spans are disabled by
            // our --log-level info). Match that envelope, not text inside another
            // level/target's payload. This line is bootstrap evidence, not a permit.
            let envelope = #"^ *[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z +INFO +arti::subcommands::proxy: (?:Sufficiently bootstrapped; proxy now functional\.|Bootstrapping deferred\.)$"#
            guard line.range(of: envelope, options: .regularExpression) != nil else { continue }
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
    #if YNX_PRIVACY_ACCEPTANCE
    private(set) var publicRuntimeTrace: TorPublicRuntimeTrace?
    private var publicEntryPhases = SnowflakeSafePhaseRecorder()
    private var publicFatalLatch = TorPublicBackendFatalLatch()
    private var publicPolicyFatalEnabled = false
    var publicBackendFatal: TorPublicBackendFatalLatch.Failure? { publicFatalLatch.first }
    var publicKnownManagedTransportAbsence: Bool? { publicRuntimeTrace?.knownManagedTransportAbsence }
    func enablePublicRuntimeTrace(directory: URL, execution: TorPublicRuntimeTrace.Execution) throws {
        guard process == nil, publicRuntimeTrace == nil else { throw TorPlatformError.alreadyRunning }
        publicRuntimeTrace = try TorPublicRuntimeTrace(directory: directory, execution: execution)
    }
    #endif

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
        /// Explicit externally owned PT. The default keeps the original Arti-managed lifecycle.
        var externalProxyPort: UInt16? = nil
        func validate() throws {
            if externalProxyPort == 0 { throw TorPlatformError.invalidPort }
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
            result += "\n[bridges]\nenabled = true\nbridges = \(lines)\n[[bridges.transports]]\nprotocols = [\"obfs4\"]\n"
            if let externalPort = bridge.externalProxyPort {
                // Official unmanaged transport contract: path/arguments/run_on_startup are absent.
                result += "proxy_addr = \"127.0.0.1:\(externalPort)\"\n"
            } else {
                result += "path = \(try quoted(bridge.transport.path))\narguments = []\nrun_on_startup = true\n"
            }
        }
        return result
    }

    #if YNX_PRIVACY_ACCEPTANCE
    /// Compare the fixed managed-obfs4 inputs across two PUBLIC diagnostics.
    /// The normalized configuration is never written or retained as trace text.
    static func publicComparisonBinding(pin: BinaryPin, port: UInt16, directory: URL,
                                        bridge: BridgeConfiguration, config: String) -> [String: Any]? {
        guard pin.version == pinnedVersion, pin.binarySHA256 == BundledTorBackend.artiSHA256,
              pin.sourceArchiveSHA256 == BundledTorBackend.sourceSHA256,
              bridge.transportSHA256 == BundledTorBackend.lyrebirdSHA256, bridge.externalProxyPort == nil,
              let expected = try? configuration(port: port, sessionDirectory: directory, deferBootstrap: false, bridge: bridge),
              expected == config else { return nil }
        let syntheticRoot = URL(fileURLWithPath: "/ynx-public-comparison", isDirectory: true)
        let normalizedBridge = BridgeConfiguration(lines: bridge.lines,
            transport: syntheticRoot.appendingPathComponent("lyrebird"), transportSHA256: bridge.transportSHA256)
        guard let normalized = try? configuration(port: 1, sessionDirectory: syntheticRoot,
                                                   deferBootstrap: false, bridge: normalizedBridge) else { return nil }
        func digest(_ text: String) -> String {
            SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        }
        return ["bindingSchema": "P05_PUBLIC_TOR_MANAGED_OBFS4_COMPARISON_V1",
                "artiVersion": pin.version, "artiSHA256": pin.binarySHA256,
                "artiSourceArchiveSHA256": pin.sourceArchiveSHA256,
                "artiCargoLockSHA256": BundledTorBackend.manifestFields["artiCargoLockSHA256"] ?? "",
                "lyrebirdVersion": "0.9.0",
                "lyrebirdBundleArchiveSHA256": BundledTorBackend.manifestFields["lyrebirdBundleArchiveSHA256"] ?? "",
                "lyrebirdSHA256": bridge.transportSHA256, "publicBridgeCount": bridge.lines.count,
                "socksPort": Int(port), "configurationSHA256": digest(config),
                "normalizedConfigurationSHA256": digest(normalized), "sameBindingIsNotProofOfSameNetwork": true]
    }
    #endif

    private func validateStartPin(_ pin: BinaryPin, bridge: BridgeConfiguration?) throws {
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
    }
    func start(pin: BinaryPin, port: UInt16, sessionDirectory: URL, deferBootstrap: Bool = true, bridge: BridgeConfiguration? = nil) throws {
        try validateStartPin(pin, bridge: bridge)
        let config = try Self.configuration(port: port, sessionDirectory: sessionDirectory, deferBootstrap: deferBootstrap, bridge: bridge)
        #if YNX_PRIVACY_ACCEPTANCE
        if let trace = publicRuntimeTrace, let bridge,
           let binding = Self.publicComparisonBinding(pin: pin, port: port, directory: sessionDirectory, bridge: bridge, config: config) {
            trace.record("fixedBackendComparisonBinding", binding)
        }
        #endif
        try startVerifiedProcess(pin: pin, sessionDirectory: sessionDirectory, deferBootstrap: deferBootstrap, config: config,
            additionalArguments: [], environment: ["PATH": "/usr/bin:/bin", "HOME": sessionDirectory.path], traceTransport: bridge?.transport)
    }
    #if YNX_PRIVACY_ACCEPTANCE
    func startPublicSnowflake(_ launch: TorSnowflakePublicBrowserBackend.VerifiedLaunch) throws {
        try Task.checkCancellation()
        try launch.requireLaunchBudget()
        switch launch.artiVariant {
        case .publishedBaseline: try validateStartPin(launch.pin, bridge: nil)
        case .nonDirectChannelThirtySeconds:
            guard process == nil else { throw TorPlatformError.alreadyRunning }
            try TorSnowflakePublicBrowserBackend.requireChannelTimeoutPin(launch.pin)
        }
        let config = try launch.configuration()
        let arguments = try launch.additionalArguments()
        try launch.claimAttempt()
        try startVerifiedProcess(pin: launch.pin, sessionDirectory: launch.profile, deferBootstrap: false, config: config,
            additionalArguments: arguments, environment: launch.environment, traceTransport: launch.helper, policyFatalEnabled: true,
            beforeRun: { try Task.checkCancellation(); try launch.requireLaunchBudget() })
    }
    #endif
    /// Shared original Process/flock/pipe/ready/fence/stop ownership. Callers above
    /// already fixed and validated the configuration; no public override API exists.
    private func startVerifiedProcess(pin: BinaryPin, sessionDirectory: URL, deferBootstrap: Bool,
                                      config: String, additionalArguments: [String], environment: [String: String],
                                      traceTransport: URL?, policyFatalEnabled: Bool = false,
                                      beforeRun: (@MainActor () throws -> Void)? = nil) throws {
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
        task.arguments = ["proxy", "--config", configURL.path, "--log-level", "info"] + additionalArguments
        // Do not inherit routing overrides or private browser context. No shell, URL, RPC listener or LAN control API.
        task.environment = environment
        task.currentDirectoryURL = sessionDirectory
        task.standardInput = FileHandle.nullDevice
        let diagnostics = Pipe(); diagnosticPipe = diagnostics
        task.standardOutput = FileHandle.nullDevice; task.standardError = diagnostics
        generation = UUID(); let expected = generation; signalParser = ArtiBootstrapSignalParser()
        #if YNX_PRIVACY_ACCEPTANCE
        publicEntryPhases = SnowflakeSafePhaseRecorder()
        publicFatalLatch.begin(expected)
        #endif
        diagnostics.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            #if YNX_PRIVACY_ACCEPTANCE
            let receivedAt = DispatchTime.now().uptimeNanoseconds
            #endif
            guard !bytes.isEmpty else {
                handle.readabilityHandler = nil
                #if YNX_PRIVACY_ACCEPTANCE
                Task { @MainActor [weak self] in self?.publicRuntimeTrace?.record("stderrEOF", capturedAt: receivedAt) }
                #endif
                return
            }
            Task { @MainActor [weak self] in
                #if YNX_PRIVACY_ACCEPTANCE
                // Observe pipe ingress even if the safety fence already revoked bootstrap signals.
                self?.publicRuntimeTrace?.stderr(bytes, capturedAt: receivedAt)
                self?.consumePublicEntryPhases(bytes, generation: expected, receivedAt: receivedAt)
                #endif
                guard let self, self.generation == expected, self.process?.isRunning == true,
                      self.state != .stopping else { return }
                for signal in self.signalParser.consume(bytes) {
                    #if YNX_PRIVACY_ACCEPTANCE
                    self.publicRuntimeTrace?.record("officialBootstrapSignal", ["signal": signal == .ready ? "ready" : "deferred"])
                    #endif
                    switch signal {
                    case .deferred: self.state = .bootstrapDeferred
                    case .ready: if !deferBootstrap { self.state = .bootstrapReady }
                    }
                }
            }
        }
        state = .starting
        do {
            try beforeRun?()
            try task.run(); process = task; state = .processRunningOnly; lastStopReason = nil; started = true
            #if YNX_PRIVACY_ACCEPTANCE
            // A rejected launch must leave an existing owner's monitoring policy intact.
            publicPolicyFatalEnabled = policyFatalEnabled
            publicRuntimeTrace?.launched(pid: task.processIdentifier, transport: traceTransport)
            #endif
            if !deferBootstrap { monitorRouteInterruptions(generation: expected) }
        }
        catch { diagnostics.fileHandleForReading.readabilityHandler = nil; diagnosticPipe = nil; state = .stopped; throw error }
    }

    #if YNX_PRIVACY_ACCEPTANCE
    private func consumePublicEntryPhases(_ bytes: Data, generation expected: UUID, receivedAt: UInt64) {
        guard generation == expected, process?.isRunning == true, state != .stopping,
              publicRuntimeTrace != nil || publicPolicyFatalEnabled else { return }
        for event in publicEntryPhases.consume(bytes, at: receivedAt) {
            publicRuntimeTrace?.record("snowflakeEntryPhase", event, capturedAt: receivedAt)
            if publicPolicyFatalEnabled, publicFatalLatch.observe(event, generation: expected) {
                publicRuntimeTrace?.record("verifiedBackendPolicyFatal", ["failure": publicBackendFatal!.summary])
                // Fence immediately; retain original Process SIGINT/deadline/reap.
                stop(reason: "fixed-public-policy-rejected")
                break
            }
        }
        // Independent sticky state, not another event that could be dropped.
        // Exhausted observation cannot stand in for healthy control coverage.
        if publicPolicyFatalEnabled,
           let reason = publicEntryPhases.monitoringCoverageFailure(at: receivedAt),
           publicFatalLatch.coverageIncomplete(reason: reason, generation: expected,
               observedAt: receivedAt, processedAt: DispatchTime.now().uptimeNanoseconds) {
            let failure = publicBackendFatal!
            publicRuntimeTrace?.record("diagnosticCoverageIncomplete", [
                "failure": failure.summary, "generation": failure.generation.uuidString,
                "firstObservedMonotonicNS": receivedAt,
                "firstProcessedMonotonicNS": failure.processedMonotonicNS!], capturedAt: receivedAt)
            stop(reason: "fixed-public-coverage-incomplete")
        }
    }
    #endif

    func pollProcess() -> State {
        #if YNX_PRIVACY_ACCEPTANCE
        publicRuntimeTrace?.observeManagedTransport()
        #endif
        if let process, !process.isRunning {
            // Revoke callbacks for this exact exited process before publishing
            // exit/releasing ownership. A queued monitor callback is not a new
            // route interruption and must not erase the observed exit status.
            revokeRouteInterruptionMonitoring()
            #if YNX_PRIVACY_ACCEPTANCE
            publicRuntimeTrace?.record("exitObserved", ["pid": process.processIdentifier, "terminationStatus": process.terminationStatus, "terminationReason": process.terminationReason == .exit ? "exit" : "uncaughtSignal", "lastStopReason": publicStopReason(lastStopReason)])
            publicRuntimeTrace?.checkpoint("exitStderrCheckpoint")
            if publicRuntimeTrace != nil {
                var coverage = publicEntryPhases.summary
                coverage["snapshotOnly"] = true
                coverage["queuedPipeIngressMayRemain"] = true
                publicRuntimeTrace?.record("snowflakeEntryPhaseCoverage", coverage)
            }
            #endif
            state = .exited(process.terminationStatus); self.process = nil
            diagnosticPipe?.fileHandleForReading.readabilityHandler = nil; diagnosticPipe = nil
            releaseOwnership()
        }
        return state
    }

    func stop(reason: String = "explicit-stop") {
        #if YNX_PRIVACY_ACCEPTANCE
        // Retain original PT incarnation before Arti can exit and reparent it.
        if publicPolicyFatalEnabled { publicRuntimeTrace?.observeManagedTransport() }
        publicRuntimeTrace?.record("stopRequested", ["reason": publicStopReason(reason), "processRunning": process?.isRunning == true, "alreadyStopping": state == .stopping])
        #endif
        if state == .stopping { _ = pollProcess(); return }
        if process?.isRunning == true { lastStopReason = reason }
        revokeRouteInterruptionMonitoring()
        if let process, process.isRunning {
            state = .stopping
            // Arti owns managed PT children; SIGINT lets its runtime close their stdin and state.
            #if YNX_PRIVACY_ACCEPTANCE
            publicRuntimeTrace?.record("interruptRequested", ["pid": process.processIdentifier, "signal": "SIGINT", "reason": publicStopReason(reason)])
            #endif
            process.interrupt()
            shutdownTask = Task { @MainActor [self, process] in
                defer { shutdownTask = nil }
                let deadline = ContinuousClock.now.advanced(by: .seconds(12))
                while process.isRunning, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(100)) }
                if process.isRunning, self.process === process {
                    #if YNX_PRIVACY_ACCEPTANCE
                    self.publicRuntimeTrace?.record("killRequested", ["pid": process.processIdentifier, "signal": "SIGKILL", "afterSeconds": 12])
                    #endif
                    _ = Darwin.kill(process.processIdentifier, SIGKILL)
                }
                _ = pollProcess()
            }
        }
        // Keep the original process handle until exit is observed; never spawn a replacement concurrently.
        _ = pollProcess()
        if process == nil {
            if case .exited = state { /* retain the actual observed exit */ }
            else { state = .stopped }
        }
    }

    private func revokeRouteInterruptionMonitoring() {
        generation = UUID()
        #if YNX_PRIVACY_ACCEPTANCE
        publicFatalLatch.fence()
        #endif
        pathMonitor?.cancel(); pathMonitor = nil
        for observer in powerObservers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        powerObservers.removeAll()
    }

    private func releaseOwnership() {
        if ownershipFD >= 0 { _ = flock(ownershipFD, LOCK_UN); close(ownershipFD); ownershipFD = -1 }
    }

    #if YNX_PRIVACY_ACCEPTANCE
    private func publicStopReason(_ value: String?) -> String {
        let known = ["explicit-stop", "network-path-changed", "network-unavailable", "system-sleep", "system-wake", "fixed-public-diagnostic-stop", "fixed-public-policy-rejected", "fixed-public-coverage-incomplete", "r2-cli-stop"]
        return value.map { known.contains($0) ? $0 : "other" } ?? "none"
    }
    #endif

    /// Private callback control; availability is diagnostic DATA, not a route
    /// authority. Kept separate so an exited owner cannot be stopped again by
    /// a queued monitor delivery, while every live later update still fences.
    private func receivePathUpdate(available: Bool, generation expected: UUID) {
        guard generation == expected else { return }
        guard process?.isRunning == true else { _ = pollProcess(); return }
        if !available || hasInitialPath { stop(reason: available ? "network-path-changed" : "network-unavailable") }
        else { hasInitialPath = true }
    }

    private func monitorRouteInterruptions(generation expected: UUID) {
        hasInitialPath = false
        let monitor = NWPathMonitor(); pathMonitor = monitor
        #if YNX_PRIVACY_ACCEPTANCE
        let contentComparison = TorPublicPathContentComparison()
        #endif
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            #if YNX_PRIVACY_ACCEPTANCE
            let observed = TorPublicObservablePath(path), receivedAt = DispatchTime.now().uptimeNanoseconds
            let pathContentEqual = contentComparison.compareAndRemember(path)
            #endif
            Task { @MainActor [weak self] in
                guard let self, self.generation == expected else { return }
                guard self.process?.isRunning == true else { _ = self.pollProcess(); return }
                #if YNX_PRIVACY_ACCEPTANCE
                self.publicRuntimeTrace?.path(observed, baselineAlreadySet: self.hasInitialPath, capturedAt: receivedAt, pathContentEqualToPrevious: pathContentEqual)
                #endif
                // The first satisfied path establishes the baseline. Every later path update is a fence.
                self.receivePathUpdate(available: available, generation: expected)
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.ynx.browser.arti-path"))
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification] {
            let observer = NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == expected else { return }
                    guard self.process?.isRunning == true else { _ = self.pollProcess(); return }
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
        // Public native WebKit hardening; keep it enabled for every routed navigation.
        // This narrows browser capabilities but is not whole-window leak qualification.
        configuration.defaultWebpagePreferences.isLockdownModeEnabled = true
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.suppressesIncrementalRendering = true
        return configuration
    }

    /// Public WebKit proxy APIs alone do not establish a no-WebRTC/STUN/QUIC/DNS-bypass boundary.
    /// Production must remain blocked until that platform boundary is implemented and independently verified.
    static func makeWebView(endpoint: PrivacyRouteEndpoint, admission: RoutedPlatformIsolationAdmission = .current, protection: RoutedIsolationClient? = nil) throws -> WKWebView {
        guard admission.permitsWebContent, let protection,
              try protection.requireLiveControlLease().phase == .routeEntryConnected else { throw TorPlatformError.webKitIsolationNotVerified }
        let configuration = try configurationForControlledProbe(port: endpoint.port)
        return WKWebView(frame: .zero, configuration: configuration)
    }
}
