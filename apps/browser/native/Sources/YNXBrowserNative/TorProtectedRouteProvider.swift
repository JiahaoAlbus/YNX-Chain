import AppKit
import CryptoKit
import Foundation
import Network
import Security
import Darwin
import YNXBrowserCore

enum TorCoordinatorFailure: String, Error {
    case signingNotConfigured, wrongApplication, invalidEndpoint, helperPinMissing, platformDenied
    case codeRejected, identityRejected, unsafeProfile, ownershipConflict, configurationWriteFailed
    case cancelled, processExited, bootstrapTimedOut, bootstrapOutputRejected, cleanupUnconfirmed
    case artiExitNonzero, artiTerminatedBySignal, artiHealthUnconfirmed
    case transportStartupTimedOut, transportProtocolRejected, protectionLost, startupFailed
    case networkUnavailable, networkPathChanged, systemSleep, systemWake
    case qualificationNotSupplied, qualificationLost
    #if YNX_PRIVACY_ACCEPTANCE
    case trialAuthorityUnavailable, trialBindingRejected, trialScopeRejected, trialPinsMissing
    case trialQualificationMissing, trialCanaryLeak, trialCanaryTimedOut, trialTargetDenied
    #endif

    /// Stable, non-sensitive categories. Never expose bridge lines, raw stderr or paths.
    static func classify(_ error: Error) -> Self {
        if let failure = error as? Self { return failure }
        if let failure = error as? RoutedQualificationFailure {
            switch failure {
            case .signingNotConfigured: return .signingNotConfigured
            case .wrongMode: return .wrongApplication
            case .invalidSignature: return .codeRejected
            case .helperNotBound: return .helperPinMissing
            case .qualificationIssuerNotSupplied: return .qualificationNotSupplied
            case .installationChanged, .expired, .revoked, .closed: return .qualificationLost
            }
        }
        if error is CancellationError { return .cancelled }
        #if YNX_PRIVACY_ACCEPTANCE
        // Trial revocation includes expiration/control loss; do not guess which one
        // occurred or report it as a bridge/network startup failure. No raw scope,
        // request, profile or underlying error text is included in these categories.
        if let failure = error as? SyntheticTrialFailure {
            switch failure {
            case .revoked: return .trialAuthorityUnavailable
            case .bindingMismatch: return .trialBindingRejected
            case .invalidScope: return .trialScopeRejected
            case .missingPins: return .trialPinsMissing
            case .invalidSignature: return .codeRejected
            case .canaryNotVerified: return .trialQualificationMissing
            case .canaryObservedLeak: return .trialCanaryLeak
            case .canaryTimeout: return .trialCanaryTimedOut
            case .targetDenied: return .trialTargetDenied
            case .routeNotVerified: return .protectionLost
            }
        }
        #endif
        if let failure = error as? TorTransportFailure {
            switch failure {
            case .startupTimedOut: return .transportStartupTimedOut
            case .processExited: return .processExited
            case .protocolRejected, .outputLimit: return .transportProtocolRejected
            case .protectionUnavailable: return .protectionLost
            case .alreadyRunning: return .ownershipConflict
            case .unsafeState: return .unsafeProfile
            case .invalidBridgePeer: return .invalidEndpoint
            }
        }
        if let failure = error as? ProtectionLeaseFailure {
            return failure == .systemSleep ? .systemSleep : .protectionLost
        }
        if let failure = error as? PrivacyRouteError {
            switch failure {
            case .invalidEndpoint: return .invalidEndpoint
            case .blocked, .stale, .unsafeTarget: return .protectionLost
            }
        }
        return .startupFailed
    }
}

/// One original startup task belongs to the provider, independently of its caller.
/// Cleanup joins it before observing/releasing process/profile ownership. The startup
/// operation must return errors to its OUTER waiter; it must never await stop itself.
@MainActor final class TorStartupOwnership<Value: Sendable> {
    private var startup: Task<Value, Error>?
    private var shutdown: Task<Void, Never>?
    private(set) var inFlight = false
    private(set) var stopping = false
    private(set) var closed = false

    func start(operation: @escaping @MainActor () async throws -> Value,
               cancellationFence: @escaping @MainActor @Sendable () -> Void) async throws -> Value {
        guard startup == nil, !closed else { throw TorCoordinatorFailure.ownershipConflict }
        inFlight = true
        let work = Task { @MainActor [self] in
            defer { inFlight = false }
            try Task.checkCancellation()
            return try await operation()
        }
        startup = work
        return try await withTaskCancellationHandler {
            let result = try await work.value
            try Task.checkCancellation()
            guard !closed else { throw TorCoordinatorFailure.cancelled }
            return result
        } onCancel: {
            work.cancel()
            Task { @MainActor in cancellationFence() }
        }
    }

    func stop(fence: @MainActor () -> Void, reap: @escaping @MainActor () async -> Void) async {
        if let shutdown { await shutdown.value; return }
        closed = true; stopping = true
        startup?.cancel()
        fence() // Same actor, before joining or reaping anything.
        let original = startup
        let work = Task { @MainActor in
            if let original { _ = await original.result }
            await reap()
        }
        shutdown = work
        await work.value
        stopping = false; shutdown = nil
        // Keep original startup and terminal closed state. A later explicit stop may
        // retry UNKNOWN reaping, but no replacement startup can be created here.
    }
}

/// Original official readiness parser plus byte-exact evidence for the owned helper.
/// Only LF-terminated lines are eligible; exclude LF and one CR, preserving all other bytes.
struct TorBootstrapOutputMarker {
    private var pending = Data()
    private var total = 0
    private var signal = ArtiBootstrapSignalParser()
    mutating func consume(_ data: Data) throws -> String? {
        total += data.count
        guard total <= 131_072 else { throw TorCoordinatorFailure.bootstrapOutputRejected }
        pending.append(data)
        while let end = pending.firstIndex(of: 10) {
            var raw = Data(pending[..<end]); pending.removeSubrange(...end)
            if raw.last == 13 { raw.removeLast() }
            guard raw.count <= 4096 else { throw TorCoordinatorFailure.bootstrapOutputRejected }
            var normalized = raw; normalized.append(10)
            if signal.consume(normalized).contains(.ready) {
                return SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined()
            }
        }
        guard pending.count <= 4096 else { throw TorCoordinatorFailure.bootstrapOutputRejected }
        return nil
    }
}

/// The two complete actual process pins are immutable across the loopback graph update.
/// These candidate responsible-app tokens do not assert observed NE source-app attribution.
struct TorProtectedBackendGraph {
    struct Pin: Codable, Equatable {
        let auditTokenHex: String
        let pid: Int32
        let pidVersion: Int32
        let path: String
        let sha256: String
        let requirement: String

        static func decode(_ data: Data, executable: URL, sha256: String, requirement: String) throws -> Self {
            guard data.count <= 16_384,
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == ["auditTokenHex", "pid", "pidVersion", "path", "sha256", "requirement"] else { throw TorCoordinatorFailure.identityRejected }
            let pin = try JSONDecoder().decode(Self.self, from: data)
            guard validToken(pin.auditTokenHex), pin.pid > 1, pin.pidVersion > 0,
                  executable.isFileURL, pin.path.hasPrefix("/"), !pin.path.contains("/../"),
                  pin.path == executable.path, pin.sha256 == sha256, pin.requirement == requirement else { throw TorCoordinatorFailure.identityRejected }
            return pin
        }
    }
    struct Endpoint: Codable, Equatable {
        let host: String
        let port: UInt16
        let transport: Int32
    }
    private struct Backend: Encodable {
        let role: String
        let process: Pin
        let responsibleAppTokens: [String]
        let destinations: [Endpoint]
        let listeningEntries: [Endpoint]
    }
    private struct Review: Encodable {
        let entryOwner: Pin
        let entries: [Endpoint]
        let backends: [Backend]
    }
    let rootToken: String
    let arti: Pin
    let transport: Pin
    let entryPort: UInt16
    let peers: [TorBridgeEntryPeer]

    @MainActor init(rootToken: String, arti: Pin, transport: Pin, entryPort: UInt16, peers: [TorBridgeEntryPeer]) throws {
        guard Self.validToken(rootToken), entryPort >= 1024, !peers.isEmpty, peers.count <= 32,
              Self.validToken(arti.auditTokenHex), Self.validToken(transport.auditTokenHex), arti.pid > 1, transport.pid > 1, arti.pidVersion > 0, transport.pidVersion > 0,
              arti.auditTokenHex != transport.auditTokenHex, arti.pid != transport.pid,
              ![arti.auditTokenHex, transport.auditTokenHex].contains(rootToken),
              arti.sha256 == BundledTorBackend.artiSHA256, transport.sha256 == BundledTorBackend.lyrebirdSHA256,
              arti.requirement == TorProtectedRouteProvider.artiRequirement,
              transport.requirement == TorProtectedRouteProvider.transportRequirement else { throw TorCoordinatorFailure.identityRejected }
        for peer in peers {
            var v4 = in_addr(), v6 = in6_addr()
            guard peer.port > 0, !["0.0.0.0", "::"].contains(peer.address),
                  inet_pton(AF_INET, peer.address, &v4) == 1 || inet_pton(AF_INET6, peer.address, &v6) == 1 else { throw TorCoordinatorFailure.invalidEndpoint }
        }
        self.rootToken = rootToken; self.arti = arti; self.transport = transport; self.entryPort = entryPort; self.peers = peers
    }
    /// Initial graph has no Arti destination or PT listener edge. Only the exact bridge peers
    /// are potential PT egress; later updates add one owned loopback edge and no remote peer.
    func encoded(externalPort: UInt16? = nil) throws -> Data {
        if let externalPort, externalPort < 1024 { throw TorCoordinatorFailure.invalidEndpoint }
        let edge = externalPort.map { Endpoint(host: "127.0.0.1", port: $0, transport: IPPROTO_TCP) }
        let review = Review(entryOwner: arti, entries: [.init(host: "127.0.0.1", port: entryPort, transport: IPPROTO_TCP)], backends: [
            .init(role: "arti", process: arti, responsibleAppTokens: [rootToken, arti.auditTokenHex], destinations: edge.map { [$0] } ?? [], listeningEntries: []),
            .init(role: "obfs4", process: transport, responsibleAppTokens: [rootToken, transport.auditTokenHex], destinations: peers.map { .init(host: $0.address, port: $0.port, transport: IPPROTO_TCP) }, listeningEntries: edge.map { [$0] } ?? [])
        ])
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        return try encoder.encode(review)
    }
    static func validToken(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
}

/// Complete Native coordinator. NoTeam/platform refusal precedes profile creation, XPC or child.
/// Default public admission remains false; this implementation does not supply an OS permit.
@MainActor final class TorProtectedRouteProvider: PrivacyRouteProvider {
    let mode: PrivacyRouteMode = .tor
    static let artiRequirement = "cdhash H\"73d808f90f87dbbb18de5473104f78bf82231aa8\""
    static let transportRequirement = "cdhash H\"92d74b5ad54a358926b32bbe5f272e28ce78e2a1\""
    // This coordinator always uses obfs4. Match the existing bridged adapter's
    // bounded cold-start allowance rather than its shorter direct-entry budget.
    // Elapsed time never supplies readiness; the official signal and live leases still do.
    static let bridgedBootstrapTimeout: Duration = .seconds(600)
    enum Phase { case idle, starting, backendReady, connected, blocked }
    enum CleanupStatus { case notStarted, complete, unconfirmed }
    private(set) var phase: Phase = .idle
    private(set) var cleanupStatus: CleanupStatus = .notStarted
    private(set) var firstFailure: TorCoordinatorFailure?
    private(set) var firstQualificationFailure: RoutedQualificationFailure?
    var cleanupConfirmed: Bool {
        !startupOwnership.inFlight && !startupOwnership.stopping && cleanupStatus != .unconfirmed &&
            ownershipFD < 0 && artiGate == nil && transport.cleanupStatus != .unconfirmed
    }
    private let bundle: Bundle
    private let suppliedHelperSHA256: String
    private let applicationSupport: URL?
    private let bridgeSource: BundledTorBackend.BridgeSource
    private let entryPort: UInt16
    private let userAction: UUID
    #if YNX_PRIVACY_ACCEPTANCE
    private var acceptanceAuthority: SyntheticTrialAuthority?
    #endif
    private var protection: BrowserRouteProtection?
    private var preparation: RoutedRootPreparation?
    private let transport = TorExternalTransport()
    private var artiGate: OwnedBackendStartGate?
    private var artiPrepareInvoked = false
    private var ownershipFD: Int32 = -1
    private var generation = UUID()
    private var startInvoked = false
    private var lastFailure: TorCoordinatorFailure?
    private var watchdog: Task<Void, Never>?
    private let startupOwnership = TorStartupOwnership<PrivacyRouteEndpoint>()
    private var pathMonitor: NWPathMonitor?
    private var initialPath = false
    private var powerObservers: [NSObjectProtocol] = []

    init(protection: BrowserRouteProtection? = nil, helperSHA256: String,
         explicitUserAction: UUID, bundle: Bundle = .main, applicationSupport: URL? = nil,
         bridgeSource: BundledTorBackend.BridgeSource = .bundledPublic, entryPort: UInt16 = 19150) {
        self.protection = protection; suppliedHelperSHA256 = helperSHA256; userAction = explicitUserAction
        self.bundle = bundle; self.applicationSupport = applicationSupport; self.bridgeSource = bridgeSource; self.entryPort = entryPort
    }

    #if YNX_PRIVACY_ACCEPTANCE
    /// Independent typed trial entry. No Boolean/environment value supplies qualification.
    /// The supplied protection must own this authority's exact client/preparation/epoch.
    convenience init(acceptanceAuthority: SyntheticTrialAuthority, protection: BrowserRouteProtection,
                     helperSHA256: String, explicitUserAction: UUID, bundle: Bundle = .main,
                     applicationSupport: URL? = nil, entryPort: UInt16 = 19150) throws {
        try Self.verifyLaunchIdentity(team: bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "",
            identifier: bundle.bundleIdentifier, helperSHA256: helperSHA256, port: entryPort)
        try acceptanceAuthority.authorizeBackendPreparation(mode: .tor)
        try protection.requireSyntheticTrialAuthority(acceptanceAuthority)
        self.init(protection: protection, helperSHA256: helperSHA256, explicitUserAction: explicitUserAction,
            bundle: bundle, applicationSupport: applicationSupport, bridgeSource: .bundledPublic, entryPort: entryPort)
        self.acceptanceAuthority = acceptanceAuthority
    }
    #endif

    /// Unqualified diagnostic preflight only. Normal startup must instead check its
    /// exact opaque protection owner; the global baseline cannot qualify an owner.
    static func preflight(team: String, identifier: String?, helperSHA256: String?, port: UInt16) throws {
        try verifyLaunchIdentity(team: team, identifier: identifier, helperSHA256: helperSHA256, port: port)
        guard RoutedPlatformIsolationAdmission.current.permitsWebContent else { throw TorCoordinatorFailure.platformDenied }
    }

    /// Shared identity checks are necessary for both production and a separately typed trial.
    /// This function alone supplies neither platform admission nor canary qualification.
    private static func verifyLaunchIdentity(team: String, identifier: String?, helperSHA256: String?, port: UInt16) throws {
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw TorCoordinatorFailure.signingNotConfigured }
        guard identifier == RoutedIsolationMode.tor.bundleIdentifier else { throw TorCoordinatorFailure.wrongApplication }
        guard port >= 1024 else { throw TorCoordinatorFailure.invalidEndpoint }
        guard let helperSHA256, helperSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw TorCoordinatorFailure.helperPinMissing }
    }

    func start() async throws -> PrivacyRouteEndpoint {
        guard !startInvoked, phase == .idle, ownershipFD < 0 else { throw TorCoordinatorFailure.ownershipConflict }
        startInvoked = true
        do {
            return try await startupOwnership.start(operation: { [self] in try await performStart() },
                cancellationFence: { [weak self] in self?.fence(.cancelled) })
        } catch {
            // This is the outer waiter, never the task being joined by stop().
            await stop()
            throw error
        }
    }

    private func performStart() async throws -> PrivacyRouteEndpoint {
        generation = UUID(); let expected = generation
        let helperHash = suppliedHelperSHA256
        do {
            try Task.checkCancellation() // A pre-cancelled startup must not create profile/control/child state.
            try authorizeStartup(helperSHA256: helperHash)
            guard bundle.bundleURL.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL else { throw TorCoordinatorFailure.wrongApplication }
            phase = .starting
            // Fixed source/binary/signature validation is offline and never executes --version.
            let supply = try BundledTorBackend.load(bundle: bundle)
            try Self.verifyCode(supply.pin.executable, requirement: Self.artiRequirement)
            try Self.verifyCode(supply.publicBridge.transport, requirement: Self.transportRequirement)
            let helper = bundle.bundleURL.appendingPathComponent(OwnedBackendStartGate.helperRelativePath).standardizedFileURL
            guard helper.resolvingSymlinksInPath() == helper,
                  Self.hash(try Data(contentsOf: helper)) == helperHash else { throw TorCoordinatorFailure.helperPinMissing }
            let backend = try prepareProfile(supply: supply)
            let peers = try TorBridgeEntryPeer.parse(backend.bridge.lines)
            ownershipFD = try Self.acquireProfile(backend.directory)
            // authorizeStartup retained and checked this exact owner before supply/profile I/O.
            guard let protection = self.protection else { throw TorCoordinatorFailure.platformDenied }
            let preparedRoot = try await beginPreparation(protection: protection)
            try requireGeneration(expected); preparation = preparedRoot
            installInterruptions(expected: expected) // Fence changes during PT startup too.
            let rootToken = try RoutedOwnAuditToken.copy()
            guard Self.hash(rootToken) == preparedRoot.receipt?.rootAuditTokenSHA256 else { throw TorCoordinatorFailure.identityRejected }
            let rootHex = rootToken.map { String(format: "%02x", $0) }.joined()
            let ptIdentity = try await transport.prepare(backend: backend, preparation: preparedRoot, helperExecutable: helper, helperSHA256: helperHash,
                codeRequirement: Self.transportRequirement, onGateCreated: { protection.trackBackendGate($0) })
            try requireGeneration(expected)
            let configURL = backend.directory.appendingPathComponent("protected-" + expected.uuidString.lowercased() + ".toml")
            let gateDirectory = backend.directory.appendingPathComponent("arti-gate-" + expected.uuidString.lowercased(), isDirectory: true)
            let gate = try OwnedBackendStartGate(helperExecutable: helper, helperSHA256: helperHash, preparation: preparedRoot, directory: gateDirectory)
            artiGate = gate; protection.trackBackendGate(gate)
            // Arti is post-exec suspended before main reads this fresh configuration path.
            // Its final configuration is written once, after the actual owned PT endpoint exists.
            artiPrepareInvoked = true; cleanupStatus = .unconfirmed
            let artiIdentity = try await gate.prepare(specification: .init(executable: backend.pin.executable, executableSHA256: backend.pin.binarySHA256,
                codeRequirement: Self.artiRequirement, arguments: ["proxy", "--config", configURL.path, "--log-level", "info"],
                environment: ["PATH": "/usr/bin:/bin", "HOME": backend.directory.path], keepStandardInputOpen: false, output: .standardError, outputPolicy: .discardAfterBootstrap))
            try requireGeneration(expected)
            let artiPin = try TorProtectedBackendGraph.Pin.decode(artiIdentity.processPinJSON, executable: backend.pin.executable, sha256: BundledTorBackend.artiSHA256, requirement: Self.artiRequirement)
            let ptPin = try TorProtectedBackendGraph.Pin.decode(ptIdentity.processPinJSON, executable: backend.bridge.transport, sha256: BundledTorBackend.lyrebirdSHA256, requirement: Self.transportRequirement)
            let graph = try TorProtectedBackendGraph(rootToken: rootHex, arti: artiPin, transport: ptPin, entryPort: entryPort, peers: peers)
            let firstAck = try await protection.enrollBootstrapGraph(review: graph.encoded())
            try requireGeneration(expected)
            let external = try await transport.resume(after: firstAck, lease: { try protection.bootstrapControlLease })
            try requireGeneration(expected)
            guard let externalPort = external.externalProxyPort, externalPort >= 1024 else { throw TorCoordinatorFailure.invalidEndpoint }
            let config = try ArtiProcessAdapter.configuration(port: entryPort, sessionDirectory: backend.directory, deferBootstrap: false, bridge: external)
            try Self.writeFreshConfiguration(config, to: configURL)
            // NE verifies that the declared loopback listener belongs to this live PT token.
            let secondAck = try await protection.updateBootstrapGraph(review: graph.encoded(externalPort: externalPort))
            try requireGeneration(expected)
            // PT startup is fully consumed; only this final loopback graph ACK may drop its
            // captured prefix. The gate supplies the real marker/token/epoch-bound receipt.
            try await transport.discardOutput(after: secondAck, lease: { try protection.bootstrapControlLease })
            try requireGeneration(expected)
            try await gate.resume(after: secondAck, lease: try protection.bootstrapControlLease)
            try requireGeneration(expected)
            let readyMarker = try await awaitOfficialReady(gate: gate, protection: protection, expected: expected)
            try requireGeneration(expected)
            let discarded = try await gate.discardOutput(afterBootstrapMarkerSHA256: readyMarker, acknowledgement: secondAck, lease: try protection.bootstrapControlLease)
            try requireGeneration(expected)
            guard discarded.pid == artiIdentity.pid, discarded.markerSHA256 == readyMarker,
                  transport.outputDiscardAcknowledgement != nil else { throw TorCoordinatorFailure.bootstrapOutputRejected }
            try requireGeneration(expected); phase = .backendReady
            try await connectReady(protection: protection)
            try requireGeneration(expected)
            try requireArtiHealth(gate)
            guard try protection.bootstrapControlLease.phase == .routeEntryConnected else { throw TorCoordinatorFailure.cancelled }
            phase = .connected; startWatchdog(expected: expected)
            return try PrivacyRouteEndpoint(port: entryPort)
        } catch {
            recordObservedFailure(error)
            // Native content/Root authority is synchronously invalidated before asynchronous reap.
            self.protection?.close(); preparation?.close()
            throw error
        }
    }

    func status() async -> PrivacyRouteStatus {
        let expected = generation, expectedPhase = phase
        guard [.backendReady, .connected].contains(phase), let protection, let gate = artiGate else {
            return phase == .starting ? .connecting : .blocked(firstFailure?.rawValue ?? "Tor route is not ready")
        }
        do {
            #if YNX_PRIVACY_ACCEPTANCE
            if let acceptanceAuthority {
                try protection.requireSyntheticTrialAuthority(acceptanceAuthority)
                if phase == .connected { _ = try acceptanceAuthority.requireLive() }
            }
            #endif
            let current = try protection.bootstrapControlLease
            guard current.phase == (phase == .backendReady ? .blocked : .routeEntryConnected) else { throw TorCoordinatorFailure.protectionLost }
            guard gate.outputDiscardAcknowledgement != nil, transport.outputDiscardAcknowledgement != nil else { throw TorCoordinatorFailure.bootstrapOutputRejected }
            try await pollArtiHealth(gate)
            guard generation == expected, phase == expectedPhase, artiGate === gate else { throw TorCoordinatorFailure.cancelled }
            guard case .protocolAvailable = try await transport.poll(onFailure: { [self] error in
                      fenceObservedStatusFailure(error, expected: expected)
                  }) else { throw TorCoordinatorFailure.processExited }
            guard generation == expected, phase == expectedPhase, artiGate === gate else { throw TorCoordinatorFailure.cancelled }
            try requireArtiHealth(gate)
            guard try protection.bootstrapControlLease.phase == current.phase else { throw TorCoordinatorFailure.protectionLost }
            return .connected
        } catch {
            fenceObservedStatusFailure(error, expected: expected)
            return .blocked(firstFailure?.rawValue ?? "Tor route lost its live backend/protection lease")
        }
    }

    private func pollArtiHealth(_ gate: OwnedBackendStartGate) async throws {
        let exit: BackendProcessExit?
        do { exit = try await gate.poll() }
        catch is CancellationError { throw CancellationError() }
        catch {
            // A STATUS wait can fail after its reader observed the terminal frame.
            // An unconfirmed gate failure must not be presented as a child exit.
            if let observed = gate.observedExit { try requireArtiHealth(gate, exit: observed) }
            throw TorCoordinatorFailure.artiHealthUnconfirmed
        }
        try requireArtiHealth(gate, exit: exit)
    }

    private func requireArtiHealth(_ gate: OwnedBackendStartGate, exit: BackendProcessExit? = nil) throws {
        if let exit = gate.observedExit ?? exit {
            guard exit.childReaped, exit.pid > 0, exit.pid == gate.cleanupChildPID else {
                throw TorCoordinatorFailure.artiHealthUnconfirmed
            }
            switch (exit.code, exit.signal) {
            case (0?, nil): throw TorCoordinatorFailure.processExited
            case (let code?, nil) where (1...255).contains(code): throw TorCoordinatorFailure.artiExitNonzero
            case (nil, let signal?) where (1...127).contains(signal): throw TorCoordinatorFailure.artiTerminatedBySignal
            default: throw TorCoordinatorFailure.artiHealthUnconfirmed
            }
        }
        guard gate.isRunning else { throw TorCoordinatorFailure.artiHealthUnconfirmed }
    }

    func stop() async {
        await startupOwnership.stop(fence: { [self] in fenceForStop() },
                                    reap: { [self] in await performStop() })
    }

    func awaitCleanupConfirmation() async -> Bool {
        await stop()
        return cleanupConfirmed
    }

    private func fenceForStop() {
        if startupOwnership.inFlight { recordFailure(.cancelled) }
        generation = UUID(); phase = .blocked
        watchdog?.cancel(); watchdog = nil; pathMonitor?.cancel(); pathMonitor = nil
        for observer in powerObservers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }; powerObservers.removeAll()
        protection?.close(); preparation?.close()
        #if YNX_PRIVACY_ACCEPTANCE
        acceptanceAuthority?.revoke()
        #endif
    }

    private func performStop() async {
        // Startup has settled, so no late preparation can now adopt another handle.
        preparation = nil
        let gate = artiGate
        if let gate { await gate.stop() }
        await transport.stop()
        let artiReaped: Bool
        if let gate, artiPrepareInvoked {
            // childReaped does not prove capture/control pipes or the wrapper have
            // finished cleanup. Read the gate's confirmation AFTER the awaited poll.
            let exit = try? await gate.poll()
            artiReaped = exit?.childReaped == true && exit?.pid == gate.cleanupChildPID && gate.cleanupConfirmed
        }
        else { artiReaped = true }
        let transportReaped = transport.cleanupStatus == .notStarted || transport.cleanupStatus == .reaped
        guard artiReaped && transportReaped else {
            cleanupStatus = .unconfirmed; recordFailure(.cleanupUnconfirmed)
            // Retain original gate/transport/FD. Parent waits for exact child reaping before exit.
            return
        }
        cleanupStatus = ownershipFD >= 0 || artiPrepareInvoked || cleanupStatus == .complete ? .complete : .notStarted
        artiGate = nil; artiPrepareInvoked = false
        if ownershipFD >= 0 { _ = flock(ownershipFD, LOCK_UN); close(ownershipFD); ownershipFD = -1 }
    }

    private func awaitOfficialReady(gate: OwnedBackendStartGate, protection: BrowserRouteProtection, expected: UUID) async throws -> String {
        let descriptor = gate.backendOutput.fileDescriptor
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else { throw TorCoordinatorFailure.processExited }
        var marker = TorBootstrapOutputMarker()
        let deadline = ContinuousClock.now.advanced(by: Self.bridgedBootstrapTimeout)
        while ContinuousClock.now < deadline {
            try requireGeneration(expected)
            guard try protection.bootstrapControlLease.phase == .blocked else { throw TorCoordinatorFailure.protectionLost }
            try await pollArtiHealth(gate)
            try requireGeneration(expected)
            guard artiGate === gate else { throw TorCoordinatorFailure.cancelled }
            guard case .protocolAvailable = try await transport.poll(onFailure: { [self] error in
                      fenceObservedStatusFailure(error, expected: expected)
                  }) else { throw TorCoordinatorFailure.processExited }
            // An Arti exit can arrive while awaiting PT. Stop may also close/reuse the
            // capture FD. Revalidate on this actor before touching that descriptor.
            try requireGeneration(expected)
            guard artiGate === gate else { throw TorCoordinatorFailure.cancelled }
            try requireArtiHealth(gate)
            guard try protection.bootstrapControlLease.phase == .blocked else { throw TorCoordinatorFailure.protectionLost }
            var buffer = [UInt8](repeating: 0, count: 4096)
            let count = read(descriptor, &buffer, buffer.count)
            if count > 0 {
                if let digest = try marker.consume(Data(buffer.prefix(count))) { return digest }
            } else if count < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { throw TorCoordinatorFailure.processExited }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw TorCoordinatorFailure.bootstrapTimedOut
    }
    private func requireGeneration(_ expected: UUID) throws {
        try Task.checkCancellation(); guard generation == expected, [.starting, .backendReady].contains(phase) else { throw TorCoordinatorFailure.cancelled }
        #if YNX_PRIVACY_ACCEPTANCE
        if let acceptanceAuthority {
            guard let protection else { throw TorCoordinatorFailure.cancelled }
            try protection.requireSyntheticTrialAuthority(acceptanceAuthority)
        }
        #endif
    }

    private func authorizeStartup(helperSHA256: String) throws {
        #if YNX_PRIVACY_ACCEPTANCE
        if let acceptanceAuthority {
            try Self.verifyLaunchIdentity(team: bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "",
                identifier: bundle.bundleIdentifier, helperSHA256: helperSHA256, port: entryPort)
            guard let protection else { throw TorCoordinatorFailure.cancelled }
            try acceptanceAuthority.authorizeBackendPreparation(mode: .tor)
            try protection.requireSyntheticTrialAuthority(acceptanceAuthority)
            return
        }
        #endif
        try Self.verifyLaunchIdentity(team: bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "",
            identifier: bundle.bundleIdentifier, helperSHA256: helperSHA256, port: entryPort)
        // Resolve the normal opaque owner before supply/profile creation. No global
        // diagnostic admission, copied snapshot or synthetic authority can replace it.
        let owner = try protection ?? BrowserRouteProtection(mode: .tor,
            onLeaseLost: { [weak self] failure in self?.fence(TorCoordinatorFailure.classify(failure)) })
        protection = owner
        try owner.requireBackendStartupQualification(mode: .tor)
    }

    private func prepareProfile(supply: BundledTorBackend.VerifiedSupply) throws -> BundledTorBackend.PreparedBackend {
        #if YNX_PRIVACY_ACCEPTANCE
        if let acceptanceAuthority { return try supply.prepareSyntheticTrialProfile(authority: acceptanceAuthority, applicationSupport: applicationSupport) }
        #endif
        return try supply.prepareProfile(applicationSupport: applicationSupport, bridgeSource: bridgeSource)
    }

    private func beginPreparation(protection: BrowserRouteProtection) async throws -> RoutedRootPreparation {
        #if YNX_PRIVACY_ACCEPTANCE
        if let acceptanceAuthority { return try await protection.beginBackendPreparation(qualifiedTrial: acceptanceAuthority) }
        #endif
        return try await protection.beginBackendPreparation()
    }

    private func connectReady(protection: BrowserRouteProtection) async throws {
        #if YNX_PRIVACY_ACCEPTANCE
        if let acceptanceAuthority { try await protection.connectReadyBackend(provider: self, explicitUserAction: userAction, qualifiedTrial: acceptanceAuthority); return }
        #endif
        try await protection.connectReadyBackend(provider: self, explicitUserAction: userAction)
    }
    private func fenceObservedStatusFailure(_ error: Error, expected: UUID) {
        guard generation == expected else { return }
        recordObservedFailure(error)
        // fence closes content/control immediately. Its cleanup task runs separately
        // so a startup/status caller can finish its own outstanding operation.
        fence(TorCoordinatorFailure.classify(error))
    }

    private func fence(_ failure: TorCoordinatorFailure) {
        recordFailure(failure); generation = UUID(); phase = .blocked
        protection?.close(); preparation?.close()
        Task { await stop() }
    }
    private func recordFailure(_ failure: TorCoordinatorFailure) {
        if firstFailure == nil { firstFailure = failure }
        lastFailure = failure
    }
    private func recordObservedFailure(_ error: Error) {
        if firstQualificationFailure == nil, let failure = error as? RoutedQualificationFailure {
            firstQualificationFailure = failure
        }
        recordFailure(TorCoordinatorFailure.classify(error))
    }
    private func startWatchdog(expected: UUID) {
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard let self, self.generation == expected, self.phase == .connected else { return }
                if await self.status() != .connected { return }
            }
        }
    }
    private func installInterruptions(expected: UUID) {
        let monitor = NWPathMonitor(); pathMonitor = monitor; initialPath = false
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.generation == expected else { return }
                if !available { self.fence(.networkUnavailable) }
                else if self.initialPath { self.fence(.networkPathChanged) }
                else { self.initialPath = true }
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.ynx.browser.protected-tor-path"))
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification] {
            powerObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == expected else { return }
                    self.fence(name == NSWorkspace.willSleepNotification ? .systemSleep : .systemWake)
                }
            })
        }
    }
    private static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    private static func verifyCode(_ executable: URL, requirement: String) throws {
        var code: SecStaticCode?, rule: SecRequirement?
        guard SecStaticCodeCreateWithPath(executable as CFURL, SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(requirement as CFString, SecCSFlags(), &rule) == errSecSuccess, let rule,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), rule) == errSecSuccess else { throw TorCoordinatorFailure.codeRejected }
    }
    static func acquireProfile(_ directory: URL) throws -> Int32 {
        guard directory.isFileURL, directory.path.hasPrefix("/") else { throw TorCoordinatorFailure.unsafeProfile }
        let root = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else { throw TorCoordinatorFailure.unsafeProfile }; defer { close(root) }
        var info = stat()
        guard fstat(root, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700 else { throw TorCoordinatorFailure.unsafeProfile }
        let fd = openat(root, ".ynx-native-route.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw TorCoordinatorFailure.unsafeProfile }
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_nlink == 1, info.st_mode & S_IFMT == S_IFREG,
              info.st_mode & 0o077 == 0 else { close(fd); throw TorCoordinatorFailure.unsafeProfile }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw TorCoordinatorFailure.ownershipConflict }
        return fd
    }
    static func writeFreshConfiguration(_ value: String, to url: URL) throws {
        guard url.isFileURL, url.path.hasPrefix("/") else { throw TorCoordinatorFailure.configurationWriteFailed }
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw TorCoordinatorFailure.configurationWriteFailed }; defer { close(fd) }
        let data = Data(value.utf8)
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 { if errno == EINTR { continue }; throw TorCoordinatorFailure.configurationWriteFailed }
                guard count > 0 else { throw TorCoordinatorFailure.configurationWriteFailed }; offset += count
            }
        }
        guard fsync(fd) == 0 else { throw TorCoordinatorFailure.configurationWriteFailed }
    }
}
