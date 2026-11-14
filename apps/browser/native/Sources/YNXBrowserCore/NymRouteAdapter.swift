import CryptoKit
import Foundation
import Darwin

public enum NymRouteAdapterError: Error, Equatable {
    case invalidConfiguration, missingExecutable, executableMismatch, missingProfile, profileMismatch
    case mixnetReadinessUnverified, cancelled
    case startupFailed, startupTimedOut, probeFailed, profileInUse
}

/// Official Nym Mixnet SOCKS5 client, never the NymVPN fast/WireGuard proxy.
public enum NymRouteDependency {
    public static let release = "nym-binaries-v2026.21-hanoi"
    public static let sourceCommit = "f92749c5f45bf1fdaacb824f9796bca2d641c6f9"
    public static let clientVersion = "1.1.88"
    public static let license = "Apache-2.0"
    public static let sourceURL = "https://github.com/nymtech/nym/tree/\(sourceCommit)/clients/socks5"
}

public struct NymActiveDirectorySelection: Sendable {
    public let entryIdentity: String
    public let requester: String
    public let requesterNodeID: UInt32
    public let epoch: UInt64
    public let rotation: UInt64
    public let basicSHA256: String
    public let describedSHA256: String
    public let epochSHA256: String
    public let validUntil: Date
}

/// Public Nym directory data selects routes, never grants identity/asset authority. Declaring
/// exit_nr or a high performance score alone is insufficient: the current assigned role matters.
public enum NymActiveDirectorySelector {
    public static func select(basic: Data, described: Data, epoch: Data, now: Date = Date()) throws -> NymActiveDirectorySelection {
        guard let b = try JSONSerialization.jsonObject(with: basic) as? [String: Any],
              let metadata = b["metadata"] as? [String: Any], metadata["status"] is NSNull,
              let epochID = metadata["absolute_epoch_id"] as? UInt64, let rotation = metadata["rotation_id"] as? UInt64,
              let refreshed = metadata["refreshed_at"] as? String,
              let nodesPage = b["nodes"] as? [String: Any], let nodes = completePage(nodesPage),
              let d = try JSONSerialization.jsonObject(with: described) as? [String: Any], let descriptions = completePage(d) else { throw NymRouteAdapterError.invalidConfiguration }
        let pieces = refreshed.split(separator: " ")
        guard pieces.count == 3, pieces[2] == "+00:00:00" else { throw NymRouteAdapterError.invalidConfiguration }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: "\(pieces[0])T\(pieces[1])Z"),
              now.timeIntervalSince(date) >= -60 else { throw NymRouteAdapterError.invalidConfiguration }
        // The official current-epoch contract uses total_elapsed_epochs as absolute ID.
        // Metadata freshness alone cannot authorize using a role assignment after its epoch.
        guard let interval = try JSONSerialization.jsonObject(with: epoch) as? [String: Any],
              interval["total_elapsed_epochs"] as? UInt64 == epochID,
              let started = interval["current_epoch_start"] as? String,
              let duration = interval["epoch_length"] as? [String: Any],
              let seconds = duration["secs"] as? UInt64, (600...86400).contains(seconds),
              duration["nanos"] as? UInt64 == 0 else { throw NymRouteAdapterError.invalidConfiguration }
        let epochFormatter = ISO8601DateFormatter()
        guard let epochStart = epochFormatter.date(from: started) else { throw NymRouteAdapterError.invalidConfiguration }
        let epochEnd = epochStart.addingTimeInterval(Double(seconds))
        guard now.timeIntervalSince(date) <= Double(seconds), now >= epochStart, now.addingTimeInterval(300) < epochEnd else { throw NymRouteAdapterError.invalidConfiguration }
        var entryCandidates: [(String, Double, UInt32)] = []
        var exitCandidates: [(String, Double, UInt32)] = []
        for node in nodes {
            guard let role = node["role"] as? String,
                  let identity = node["ed25519_identity_pubkey"] as? String,
                  let nodeID = node["node_id"] as? UInt32,
                  let scoreText = node["performance"] as? String, let score = Double(scoreText), score.isFinite, (0...1).contains(score),
                  let roles = node["supported_roles"] as? [String: Bool] else { continue }
            if role == "EntryGateway", roles["entry"] == true,
               let entry = node["entry"] as? [String: Any], let host = entry["hostname"] as? String, !host.isEmpty,
               let port = entry["wss_port"] as? UInt16, port > 0 {
                entryCandidates.append((identity, score, nodeID))
            }
            guard role == "ExitGateway", roles["exit_nr"] == true else { continue }
            let matches = descriptions.filter { row in
                guard row["node_id"] as? UInt32 == nodeID, let description = row["description"] as? [String: Any],
                      let host = description["host_information"] as? [String: Any], let keys = host["keys"] as? [String: Any] else { return false }
                return keys["ed25519"] as? String == identity
            }
            guard matches.count == 1, let description = matches[0]["description"] as? [String: Any],
                  let requester = description["network_requester"] as? [String: Any], let address = requester["address"] as? String,
                  address.range(of: "^[1-9A-HJ-NP-Za-km-z]{32,44}\\.[1-9A-HJ-NP-Za-km-z]{32,44}@[1-9A-HJ-NP-Za-km-z]{32,44}$", options: .regularExpression) != nil,
                  address.split(separator: "@").last.map(String.init) == identity else { continue }
            exitCandidates.append((address, score, nodeID))
        }
        let rank: ((String, Double, UInt32), (String, Double, UInt32)) -> Bool = { $0.1 == $1.1 ? $0.2 < $1.2 : $0.1 > $1.1 }
        guard let entry = entryCandidates.sorted(by: rank).first, let exit = exitCandidates.sorted(by: rank).first else { throw NymRouteAdapterError.invalidConfiguration }
        return NymActiveDirectorySelection(entryIdentity: entry.0, requester: exit.0, requesterNodeID: exit.2, epoch: epochID, rotation: rotation,
            basicSHA256: SHA256.hash(data: basic).map { String(format: "%02x", $0) }.joined(),
            describedSHA256: SHA256.hash(data: described).map { String(format: "%02x", $0) }.joined(),
            epochSHA256: SHA256.hash(data: epoch).map { String(format: "%02x", $0) }.joined(),
            validUntil: epochEnd.addingTimeInterval(-60))
    }
    private static func completePage(_ page: [String: Any]) -> [[String: Any]]? {
        guard let rows = page["data"] as? [[String: Any]], let p = page["pagination"] as? [String: Any],
              p["page"] as? Int == 0, p["total"] as? Int == rows.count else { return nil }
        return rows
    }
}

/// A packaging-owner receipt pins the local executable and the already initialized, route-specific
/// profile. This object is local control-plane data, never decoded from a page or a URL.
public struct NymRouteLaunchPlan: Sendable {
    public let executable: URL
    public let executableSHA256: String
    public let profileID: String
    public let profileSHA256: String
    public let provider: String
    public let port: UInt16
    public let sourceCommit: String
    public let directorySelection: NymActiveDirectorySelection?

    public init(executable: URL, executableSHA256: String, profileID: String,
                profileSHA256: String, provider: String, port: UInt16,
                sourceCommit: String = NymRouteDependency.sourceCommit,
                host: String = "127.0.0.1", anonymousReplies: Bool = true,
                directorySelection: NymActiveDirectorySelection? = nil) throws {
        let digest = "^[0-9a-f]{64}$"
        guard executable.isFileURL, executable.path.hasPrefix("/"),
              executable.lastPathComponent == "nym-socks5-client",
              executableSHA256.range(of: digest, options: .regularExpression) != nil,
              profileSHA256.range(of: digest, options: .regularExpression) != nil,
              profileID.range(of: "^ynx-route-[a-z0-9-]{1,64}$", options: .regularExpression) != nil,
              provider.range(of: "^[1-9A-HJ-NP-Za-km-z]{32,44}\\.[1-9A-HJ-NP-Za-km-z]{32,44}@[1-9A-HJ-NP-Za-km-z]{32,44}$", options: .regularExpression) != nil,
              port > 0, host == "127.0.0.1", anonymousReplies,
              sourceCommit == NymRouteDependency.sourceCommit else { throw NymRouteAdapterError.invalidConfiguration }
        self.executable = executable; self.executableSHA256 = executableSHA256
        self.profileID = profileID; self.profileSHA256 = profileSHA256
        self.provider = provider; self.port = port; self.sourceCommit = sourceCommit
        self.directorySelection = directorySelection
    }

    /// Provision only a NEW isolated route profile via the official CLI. Recipient validation is
    /// additionally performed by Nym's Recipient parser; this layer does not implement that protocol.
    public var initializationArguments: [String] {
        ["init", "--id", profileID, "--provider", provider, "--host", "127.0.0.1",
         "--port", String(port), "--force-tls-gateway", "--enabled-credentials-mode", "false",
         "--use-reply-surbs", "true", "--output", "json"]
    }

    /// Requires the separately pinned YNX recovery overlay; the original official binary rejects
    /// this flag. The overlay loads existing keys and publishes an official serialized config
    /// using no-replace CAS. Never substitute plain init after any recovery error.
    public var resumptionArguments: [String] {
        var args = initializationArguments
        args.insert("--resume-unconfigured", at: 1)
        return args
    }

    /// These are the exact run.rs flag names at the pinned commit. No arbitrary extra arguments,
    /// fastmode, no-cover, medium-toggle, UDP, API listener, or direct-connect option is exposed.
    public var runArguments: [String] {
        ["run", "--ynx-runtime-contract", "ynx-mixnet-v1", "--id", profileID, "--provider", provider, "--host", "127.0.0.1",
         "--port", String(port), "--enabled-credentials-mode", "false", "--use-anonymous-replies", "true"]
    }

    public var profileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nym/socks5-clients/\(profileID)/config/config.toml")
    }

    public func validateDirectory(now: Date = Date()) throws {
        guard let directorySelection, directorySelection.requester == provider,
              now < directorySelection.validUntil else { throw NymRouteAdapterError.invalidConfiguration }
    }

    public func validateInstalledSupply() throws {
        guard FileManager.default.isExecutableFile(atPath: executable.path),
              (try? executable.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == false else { throw NymRouteAdapterError.missingExecutable }
        let binary = try Data(contentsOf: executable, options: .mappedIfSafe)
        guard Self.sha256(binary) == executableSHA256 else { throw NymRouteAdapterError.executableMismatch }
        // The macOS packaging owner must supply a Mach-O build of the pinned source. The official
        // unclassified release executable is not silently substituted or executed as a macOS build.
        let magic = Array(binary.prefix(4))
        let machOMagic: [[UInt8]] = [[0xcf,0xfa,0xed,0xfe], [0xfe,0xed,0xfa,0xcf], [0xca,0xfe,0xba,0xbe], [0xbe,0xba,0xfe,0xca]]
        guard machOMagic.contains(magic) else { throw NymRouteAdapterError.invalidConfiguration }
        guard let profile = try? Data(contentsOf: profileURL),
              (try? profileURL.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == false else { throw NymRouteAdapterError.missingProfile }
        guard Self.sha256(profile) == profileSHA256 else { throw NymRouteAdapterError.profileMismatch }
        try validateDirectory()
    }

    private static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    /// RFC1928 CONNECT with ATYP=DOMAIN: the target is handed to the Mixnet exit, never resolved
    /// locally by this encoder. This is a control/test primitive, NOT evidence of WKWebView routing.
    public static func socks5DomainConnect(host: String, port: UInt16 = 443) throws -> Data {
        guard port == 443, host.utf8.count <= 253,
              host.range(of: "^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$", options: .regularExpression) != nil,
              host.lowercased() != "localhost", !host.lowercased().hasSuffix(".localhost") else { throw NymRouteAdapterError.invalidConfiguration }
        let bytes = Array(host.utf8)
        return Data([5, 1, 0, 3, UInt8(bytes.count)] + bytes + [UInt8(port >> 8), UInt8(port & 255)])
    }
}

/// A controlled synthetic HTTPS endpoint, not a user's target page. Successful SOCKS CONNECT alone
/// is insufficient: normal TLS trust, exact response bytes and an official bootstrap event are required.
public struct NymControlledProbe: Sendable {
    public let url: URL
    public let responseSHA256: String
    public init(url: URL, responseSHA256: String, runID: String, reviewedOrigin: URL) throws {
        guard runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              let origin = URLComponents(url: reviewedOrigin, resolvingAgainstBaseURL: false),
              origin.scheme == "https", origin.user == nil, origin.password == nil,
              origin.port == nil || origin.port == 443, origin.query == nil, origin.fragment == nil,
              ["", "/"].contains(origin.path), let originHost = origin.host,
              !originHost.hasSuffix(".test"), !originHost.hasSuffix(".local"),
              let target = URLComponents(url: url, resolvingAgainstBaseURL: false),
              target.percentEncodedPath == "/ynx-route-probe/\(runID)/proof" else { throw NymRouteAdapterError.invalidConfiguration }
        guard url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, url.query == nil, url.fragment == nil,
              let host = url.host, host == originHost,
              responseSHA256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw NymRouteAdapterError.invalidConfiguration }
        _ = try NymRouteLaunchPlan.socks5DomainConnect(host: host)
        self.url = url; self.responseSHA256 = responseSHA256
    }
    public func curlArguments(port: UInt16) -> [String] {
        ["--proxy", "socks5h://127.0.0.1:\(port)", "--noproxy", "", "--proto", "=https",
         "--proto-redir", "=https", "--max-redirs", "0", "--max-time", "20", "--max-filesize", "4096",
         "--fail", "--silent", "--show-error", url.absoluteString]
    }
}

/// Discards all client logs and addresses, retaining only a bounded partial line and this exact
/// official source marker. The marker follows BaseClientBuilder.start_base(), not a port check.
final class NymBootstrapMarker: @unchecked Sendable {
    private let lock = NSLock()
    private var partial = Data()
    private var finished = false
    private let expectedGatewayIdentity: String?
    private var gatewayMatched: Bool
    init(expectedGatewayIdentity: String? = nil) {
        self.expectedGatewayIdentity = expectedGatewayIdentity; self.gatewayMatched = expectedGatewayIdentity == nil
    }
    func append(_ data: Data) {
        lock.lock(); defer { lock.unlock() }
        partial.append(data)
        while let newline = partial.firstIndex(of: 10) {
            let line = String(decoding: partial[..<newline], as: UTF8.self)
                .replacingOccurrences(of: "\u{001B}\\[[0-9;]*m", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasSuffix("Client startup finished!") { finished = true }
            if let expectedGatewayIdentity, let range = line.range(of: "The address of this client is: ") {
                let address = line[range.upperBound...]
                if address.split(separator: "@").last.map(String.init) == expectedGatewayIdentity { gatewayMatched = true }
            }
            partial.removeSubrange(...newline)
        }
        if partial.count > 4096 { partial = Data(partial.suffix(4096)) }
    }
    var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return finished && gatewayMatched }
}

/// Shares the same advisory profile lease as the owned CLI runner. It is held through
/// graceful/forced shutdown, and an exited child can release it even if its caller goes away.
final class NymProfileLease: @unchecked Sendable {
    private let lock = NSLock()
    private var descriptor: Int32?
    init(url: URL) throws {
        let fd = open(url.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, mode_t(0o600))
        guard fd >= 0 else { throw NymRouteAdapterError.profileInUse }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw NymRouteAdapterError.profileInUse }
        descriptor = fd
    }
    func release() {
        lock.lock(); defer { lock.unlock() }
        if let descriptor { _ = flock(descriptor, LOCK_UN); close(descriptor); self.descriptor = nil }
    }
    deinit { release() }
}

/// Backend lifecycle only. Never grants platform isolation admission. The parent keeps that gate
/// closed until installed-window and leakage acceptance independently pass. No direct fallback.
@MainActor public final class NymRouteAdapter: PrivacyRouteProvider {
    public let mode: PrivacyRouteMode = .nym
    private let plan: NymRouteLaunchPlan?
    private let probe: NymControlledProbe?
    private let startupTimeout: TimeInterval
    private var process: Process?
    private var probeProcess: Process?
    private var output: Pipe?
    private var profileLease: NymProfileLease?
    private var generation: UInt64 = 0
    private var state: PrivacyRouteStatus = .blocked("Nym Mixnet client supply/readiness is not verified")
    private var cancelled = false
    public init(plan: NymRouteLaunchPlan? = nil, probe: NymControlledProbe? = nil, startupTimeout: TimeInterval = 120) {
        self.plan = plan; self.probe = probe; self.startupTimeout = min(300, max(1, startupTimeout))
    }
    public func start() async throws -> PrivacyRouteEndpoint {
        guard !cancelled, !Task.isCancelled else { throw NymRouteAdapterError.cancelled }
        guard process == nil, probeProcess == nil else { throw NymRouteAdapterError.startupFailed }
        guard let plan else {
            state = .blocked("Pinned macOS Nym Mixnet client is not installed")
            throw NymRouteAdapterError.missingExecutable
        }
        do { try plan.validateInstalledSupply() }
        catch { state = .blocked("Nym client/profile supply validation failed"); throw error }
        guard let probe else { state = .blocked("Controlled Mixnet probe not configured"); throw NymRouteAdapterError.mixnetReadinessUnverified }
        do {
            profileLease = try NymProfileLease(url: plan.profileURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(".ynx-run.lock"))
        } catch { state = .blocked("Nym profile is already owned by another route operation"); throw error }
        generation &+= 1; let expected = generation
        let marker = NymBootstrapMarker(expectedGatewayIdentity: plan.directorySelection?.entryIdentity); let pipe = Pipe(); let child = Process()
        child.executableURL = plan.executable; child.arguments = plan.runArguments
        child.environment = ["PATH": "/usr/bin:/bin", "RUST_LOG": "info", "NO_COLOR": "1"]
        child.standardInput = FileHandle.nullDevice; child.standardOutput = pipe; child.standardError = pipe
        let lease = profileLease
        child.terminationHandler = { _ in lease?.release() }
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil } else { marker.append(data) }
        }
        process = child; output = pipe; state = .connecting
        do {
            guard !cancelled, !Task.isCancelled else { throw NymRouteAdapterError.cancelled }
            try child.run()
            let deadline = Date().addingTimeInterval(startupTimeout)
            while !marker.isFinished {
                guard generation == expected, !cancelled, !Task.isCancelled else { throw NymRouteAdapterError.cancelled }
                guard child.isRunning else { throw NymRouteAdapterError.startupFailed }
                guard Date() < deadline else { throw NymRouteAdapterError.startupTimedOut }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard child.isRunning else { throw NymRouteAdapterError.startupFailed }
            try plan.validateDirectory()
            try await verifyProbe(probe, plan: plan, child: child, generation: expected)
            try plan.validateDirectory()
            state = .connected
            return try PrivacyRouteEndpoint(port: plan.port)
        } catch {
            await stopChildren(); state = .blocked("Nym startup/probe failed; no direct fallback")
            throw error
        }
    }
    public func status() async -> PrivacyRouteStatus {
        if state == .connected {
            guard let child = process, child.isRunning, let plan, let probe else {
                generation &+= 1; state = .blocked("Nym process exited; no direct fallback"); await stopChildren(); return state
            }
            // A live process can have lost its gateway/network. Revalidate the controlled route
            // before returning connected; concurrent callers see connecting and remain blocked.
            state = .connecting
            do { try plan.validateDirectory(); try await verifyProbe(probe, plan: plan, child: child, generation: generation); try plan.validateDirectory(); state = .connected }
            catch { generation &+= 1; state = .blocked("Nym route probe failed; no direct fallback"); await stopChildren() }
        }
        return state
    }
    private func verifyProbe(_ probe: NymControlledProbe, plan: NymRouteLaunchPlan, child: Process, generation expected: UInt64) async throws {
        let test = Process(); let body = Pipe()
        test.executableURL = URL(fileURLWithPath: "/usr/bin/curl"); test.arguments = probe.curlArguments(port: plan.port)
        test.environment = ["PATH": "/usr/bin:/bin"]
        test.standardInput = FileHandle.nullDevice; test.standardOutput = body; test.standardError = FileHandle.nullDevice
        probeProcess = test; try test.run()
        while test.isRunning {
            guard generation == expected, child.isRunning, !cancelled, !Task.isCancelled else { throw NymRouteAdapterError.cancelled }
            try await Task.sleep(for: .milliseconds(100))
        }
        let bytes = body.fileHandleForReading.readDataToEndOfFile()
        let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        guard generation == expected, child.isRunning, test.terminationStatus == 0,
              bytes.count <= 4096, digest == probe.responseSHA256 else { throw NymRouteAdapterError.probeFailed }
        probeProcess = nil
    }
    public func stop() async {
        cancelled = true; generation &+= 1; state = .blocked("Nym route cancelled; no direct fallback")
        await stopChildren()
    }
    // The official Nym shutdown manager listens to SIGINT; SIGTERM skips SURB flush.
    // A cancelled caller must still allow its child a bounded graceful shutdown.
    static func stopChild(_ child: Process, mixnet: Bool, grace: Duration? = nil) async {
        guard child.isRunning else { return }
        if mixnet { child.interrupt() } else { child.terminate() }
        let deadline = ContinuousClock.now.advanced(by: grace ?? (mixnet ? .seconds(12) : .milliseconds(500)))
        while child.isRunning && ContinuousClock.now < deadline {
            await Task.detached { try? await Task.sleep(for: .milliseconds(50)) }.value
        }
        if child.isRunning {
            _ = kill(child.processIdentifier, SIGKILL)
            let reapDeadline = ContinuousClock.now.advanced(by: .seconds(2))
            while child.isRunning && ContinuousClock.now < reapDeadline {
                await Task.detached { try? await Task.sleep(for: .milliseconds(50)) }.value
            }
        }
        // Process owns/reaps its PID. Future starts validate the preserved storage;
        // a forced stop never authorizes automatic database replacement.
    }
    private func stopChildren() async {
        if let probeProcess { await Self.stopChild(probeProcess, mixnet: false) }
        if let process { await Self.stopChild(process, mixnet: true) }
        // Drain Nym's shutdown logs while it flushes. Never drop a still-live handle
        // and thereby permit a second backend after an OS-level termination failure.
        if probeProcess?.isRunning != true { probeProcess = nil }
        if process?.isRunning != true {
            process = nil
            profileLease?.release(); profileLease = nil
            output?.fileHandleForReading.readabilityHandler = nil
            output = nil
        }
    }
}
