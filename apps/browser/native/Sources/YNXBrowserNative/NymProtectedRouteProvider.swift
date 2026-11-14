import AppKit
import CryptoKit
import Darwin
import Foundation
import Network
import Security
import YNXBrowserCore

enum NymProtectedFailure: String, Error {
    case signingNotConfigured, wrongApplication, platformDenied, invalidEndpoint, helperPinMissing
    case invalidNumericPlan, staleNumericPlan, unattributedRuntimeDNS, identityRejected
    case profileProvisioningRequired, provisioningUnknown, unsafeJournal, ownershipConflict
    case cancelled, backendExited, bootstrapTimedOut, proofFailed, cleanupUnconfirmed
    case proofNotSupplied, controlPlaneFailed, invalidProfileReceipt, unsupportedRuntime
    case supplyRejected, directoryFailed, gatewayFailed, controlLeaseLost, proofTimedOut, networkChanged
    case helperContractMismatch, outputCaptureIncomplete, qualificationNotSupplied, qualificationLost
    case proofScopeNotSupplied, proofScopeLost
}

/// Local diagnostics only; none of these stages grants any of the five readiness states.
enum NymProtectedStage: String, Sendable {
    case idle, identityPreflight, supply, proofResource, directory, profile, gateway
    case numericPolicy, bootstrap, proof, routeConnect, connected, cleanup
}

/// Detect descriptor reuse across an awaited Gate reply. This carries no authorization;
/// the original generation, live lease and deadline must also be checked before reading.
struct NymOwnedOutputIdentity {
    let fileDescriptor: Int32
    private let device: dev_t, inode: ino_t, kind: mode_t
    init(fileDescriptor: Int32) throws {
        var observed = stat()
        guard fileDescriptor >= 0, fstat(fileDescriptor, &observed) == 0 else { throw NymProtectedFailure.backendExited }
        self.fileDescriptor = fileDescriptor; device = observed.st_dev; inode = observed.st_ino; kind = observed.st_mode & S_IFMT
    }
    func requireCurrent() throws {
        var current = stat()
        guard fstat(fileDescriptor, &current) == 0, current.st_dev == device, current.st_ino == inode,
              current.st_mode & S_IFMT == kind else { throw NymProtectedFailure.backendExited }
    }
}

/// Own the original startup across actor suspension. Stopping must join it before inspecting
/// gates/leases: an epoch/preparation factory can finish *after* cancellation and still return
/// an owner that must be retained and closed. This helper conveys no network authority.
@MainActor final class NymStartupOperation {
    private var worker: Task<PrivacyRouteEndpoint, Error>?
    private var operationID: UUID?
    var isRunning: Bool { worker != nil }
    func run(_ operation: @escaping @MainActor () async throws -> PrivacyRouteEndpoint) async throws -> PrivacyRouteEndpoint {
        guard worker == nil else { throw NymProtectedFailure.ownershipConflict }
        let id = UUID(); operationID = id
        let task = Task { @MainActor in try await operation() }
        worker = task
        defer { if operationID == id { worker = nil; operationID = nil } }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    func cancel() { worker?.cancel() }
    func join() async {
        if let worker {
            let id = operationID
            _ = try? await worker.value
            if operationID == id { self.worker = nil; operationID = nil }
        }
    }
}

/// Public control-plane addresses only. Never accepts a user's search/URL/DNS name. This is
/// proposed input to the OS review, not an acknowledgement or authority to transmit.
struct NymNumericBootstrapPlan: Sendable {
    enum Purpose: String, Codable, Sendable { case directoryHTTPS, chainRPC, gatewayWSS }
    struct Peer: Codable, Equatable, Sendable {
        let purpose: Purpose
        let host: String
        let port: UInt16
        let transport: Int32
        let hostname: String?
        init(purpose: Purpose, host: String, port: UInt16, transport: Int32, hostname: String? = nil) {
            self.purpose = purpose; self.host = host; self.port = port; self.transport = transport; self.hostname = hostname
        }
    }
    let peers: [Peer]
    let directoryEpoch: UInt64
    let directorySHA256: [String]
    let receivedAt: Date
    let validUntil: Date

    func validate(selection: NymActiveDirectorySelection, now: Date) throws {
        guard !peers.isEmpty, peers.count <= 128,
              Set(peers.map(\.purpose)) == Set([.directoryHTTPS, .chainRPC, .gatewayWSS]),
              Set(peers.map { "\($0.host):\($0.port):\($0.transport)" }).count == peers.count,
              peers.allSatisfy({ Self.numeric($0.host) && $0.port > 0 && $0.transport == IPPROTO_TCP }),
              directoryEpoch == selection.epoch,
              directorySHA256 == [selection.basicSHA256, selection.describedSHA256, selection.epochSHA256] else { throw NymProtectedFailure.invalidNumericPlan }
        guard (-5...120).contains(now.timeIntervalSince(receivedAt)), now < validUntil,
              validUntil <= selection.validUntil else { throw NymProtectedFailure.staleNumericPlan }
    }
    static func numeric(_ host: String) -> Bool {
        guard !host.contains("%"), !host.contains("\0") else { return false }
        var v4 = in_addr(), v6 = in6_addr()
        let parsed = host.withCString { inet_pton(AF_INET, $0, &v4) == 1 || inet_pton(AF_INET6, $0, &v6) == 1 }
        // Local/unspecified/multicast endpoints cannot be relabelled as public gateway peers.
        if host.withCString({ inet_pton(AF_INET, $0, &v4) }) == 1 {
            let b = Array(withUnsafeBytes(of: &v4) { Data($0) })
            return parsed && b[0] != 0 && b[0] != 10 && b[0] != 127 && b[0] < 224 &&
                !(b[0] == 169 && b[1] == 254) && !(b[0] == 172 && (16...31).contains(b[1])) && !(b[0] == 192 && b[1] == 168)
        }
        let b = Array(withUnsafeBytes(of: &v6) { Data($0) })
        return parsed && b[0] & 0xe0 == 0x20 // global-unicast only; no IPv4-mapped/local forms
    }
    /// 04d uses system/native hostname resolution in the real vendor gateway path. An IP
    /// allowlist cannot attribute mDNSResponder or force TLS hostname+IP binding. Neither a
    /// caller Boolean nor a graph ACK supplies the missing restricted resolver implementation.
    func requireAttributedDNS(runtimeSHA256: String) throws {
        if runtimeSHA256 == "04d788aa0ed3395162fc475e4973353fa71afd4c0ce75c5e00bd36326e357248" { throw NymProtectedFailure.unattributedRuntimeDNS }
        guard runtimeSHA256 == "9cf0324880bdb8d8b8909581c81b91f750174b6ff0569e4f5270426c0dacb5a6" else { throw NymProtectedFailure.identityRejected }
        // Exact source-pinned successor has actual closed HTTP0.13/RPC0.11/WSS callees,
        // mandatory private policy SHA/runID and no hostname fallback. This is a supply
        // capability check only; OS attribution, live ACK and HTTPS proof remain required.
    }
}

/// A policy is an exact local request to the OS/vendor boundary, never its acknowledgement.
/// Ordinary user domains cannot enter this map; they remain SOCKS DOMAIN destinations.
struct NymReviewedNetworkPolicy: Codable {
    struct Endpoint: Codable {
        let purpose: String; let scheme: String; let host: String; let port: UInt16; let addresses: [String]
    }
    let schema = "YNX_NYM_REVIEWED_NETWORK_V1"
    let runID: String; let stage: String; let issuedAt: UInt64; let expiresAt: UInt64
    let directoryEpoch: UInt64?; let directorySHA256: [String]?; let entryIdentity: String?
    let bootstrapSourceSHA256: String?
    let endpoints: [Endpoint]
    enum CodingKeys: String, CodingKey {
        case schema, runID, stage, issuedAt, expiresAt, directoryEpoch, directorySHA256, entryIdentity, endpoints
        case bootstrapSourceSHA256 = "networkDefaultsSHA256"
    }
    func bytes() throws -> Data {
        guard runID.range(of: "^[a-z0-9-]{1,64}$", options: .regularExpression) != nil,
              expiresAt > issuedAt, !endpoints.isEmpty, endpoints.count <= 128,
              endpoints.allSatisfy({ endpoint in
                  ["directoryHTTPS", "chainRPC", "gatewayWSS"].contains(endpoint.purpose) &&
                  endpoint.scheme == (endpoint.purpose == "gatewayWSS" ? "wss" : "https") &&
                  endpoint.port > 0 && endpoint.host.range(of: "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", options: .regularExpression) != nil &&
                  !endpoint.addresses.isEmpty && endpoint.addresses.count <= 16 && endpoint.addresses.allSatisfy(NymNumericBootstrapPlan.numeric)
              }) else { throw NymProtectedFailure.invalidNumericPlan }
        if stage == "directory-bootstrap" {
            guard expiresAt - issuedAt <= 120, directoryEpoch == nil, directorySHA256 == nil, entryIdentity == nil,
                  bootstrapSourceSHA256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  endpoints.allSatisfy({ $0.purpose != "gatewayWSS" }) else { throw NymProtectedFailure.invalidNumericPlan }
        } else if stage == "route-runtime" {
            guard directoryEpoch != nil, directorySHA256?.count == 3,
                  directorySHA256!.allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
                  entryIdentity?.range(of: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", options: .regularExpression) != nil,
                  bootstrapSourceSHA256 == nil else { throw NymProtectedFailure.invalidNumericPlan }
        } else { throw NymProtectedFailure.invalidNumericPlan }
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys; return try encoder.encode(self)
    }
}

/// A durable no-replay intent. The owner holds its exclusive NymProfileLease around this
/// operation and the original child until an actual childReaped receipt. UNKNOWN is never
/// deleted or changed to "not started" on timeout/cancel/crash. No keys are read here.
enum NymProvisioningIntent {
    struct Record: Codable, Equatable { let schema: String; let profileID: String; let operation: String; let state: String }
    static func claimBeforeResume(at url: URL, profileID: String, operation: UUID) throws {
        guard profileID.range(of: "^ynx-route-bundled-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", options: .regularExpression) != nil else { throw NymProtectedFailure.unsafeJournal }
        guard url.isFileURL, url.standardizedFileURL == url, url.resolvingSymlinksInPath() == url else { throw NymProtectedFailure.unsafeJournal }
        var parent = stat()
        guard lstat(url.deletingLastPathComponent().path, &parent) == 0, parent.st_uid == getuid(),
              parent.st_mode & S_IFMT == S_IFDIR, parent.st_mode & 0o777 == 0o700 else { throw NymProtectedFailure.unsafeJournal }
        var existing = stat()
        if lstat(url.path, &existing) == 0 {
            guard existing.st_mode & S_IFMT == S_IFREG, existing.st_uid == getuid(), existing.st_nlink == 1,
                  existing.st_mode & 0o777 == 0o600 else { throw NymProtectedFailure.unsafeJournal }
            throw NymProtectedFailure.provisioningUnknown
        }
        guard errno == ENOENT else { throw NymProtectedFailure.unsafeJournal }
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { if errno == EEXIST { throw NymProtectedFailure.provisioningUnknown }; throw NymProtectedFailure.unsafeJournal }
        defer { Darwin.close(fd) }
        let bytes = try JSONEncoder().encode(Record(schema: "YNX_NYM_PROVISIONING_INTENT_V1", profileID: profileID, operation: operation.uuidString.lowercased(), state: "UNKNOWN"))
        // Retain even a partial/failed receipt: its existence prohibits automatic init replay.
        try bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw NymProtectedFailure.unsafeJournal }; offset += count
            }
        }
        guard fsync(fd) == 0 else { throw NymProtectedFailure.unsafeJournal }
        let parentFD = open(url.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parentFD >= 0 else { throw NymProtectedFailure.unsafeJournal }
        defer { Darwin.close(parentFD) }
        guard fsync(parentFD) == 0 else { throw NymProtectedFailure.unsafeJournal }
    }
}

struct NymProtectedGraph {
    struct Pin: Codable, Equatable {
        let auditTokenHex: String; let pid: Int32; let pidVersion: Int32
        let path: String; let sha256: String; let requirement: String
        static func decode(_ data: Data, executable: URL, sha256: String, requirement: String) throws -> Self {
            guard data.count <= 16_384, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == ["auditTokenHex", "pid", "pidVersion", "path", "sha256", "requirement"] else { throw NymProtectedFailure.identityRejected }
            let pin = try JSONDecoder().decode(Self.self, from: data)
            guard token(pin.auditTokenHex), pin.pid > 1, pin.pidVersion > 0, pin.path == executable.path,
                  pin.sha256 == sha256, pin.requirement == requirement else { throw NymProtectedFailure.identityRejected }
            return pin
        }
        static func token(_ s: String) -> Bool { s.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    }
    struct Endpoint: Codable, Equatable { let host: String; let port: UInt16; let transport: Int32 }
    private struct Backend: Encodable {
        let role: String; let process: Pin; let responsibleAppTokens: [String]
        let destinations: [Endpoint]; let listeningEntries: [Endpoint]
    }
    private struct Review: Encodable { let entryOwner: Pin; let entries: [Endpoint]; let backends: [Backend] }
    let rootToken: String; let nym: Pin; let probe: Pin; let port: UInt16; let peers: [NymNumericBootstrapPlan.Peer]
    func encoded(listenerVerified: Bool) throws -> Data {
        guard Pin.token(rootToken), Pin.token(nym.auditTokenHex), Pin.token(probe.auditTokenHex),
              nym.pid > 1, probe.pid > 1, nym.pidVersion > 0, probe.pidVersion > 0,
              probe.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, !probe.requirement.isEmpty,
              nym.pid != probe.pid, nym.auditTokenHex != probe.auditTokenHex,
              ![nym.auditTokenHex, probe.auditTokenHex].contains(rootToken), port >= 1024,
              nym.sha256 == BundledNymSupply.runtimeSHA256, nym.requirement == BundledNymSupply.runtimeRequirement,
              !peers.isEmpty, peers.allSatisfy({ NymNumericBootstrapPlan.numeric($0.host) && $0.port > 0 && $0.transport == IPPROTO_TCP }) else { throw NymProtectedFailure.identityRejected }
        let entry = Endpoint(host: "127.0.0.1", port: port, transport: IPPROTO_TCP)
        let review = Review(entryOwner: nym, entries: [entry], backends: [
            .init(role: "nym", process: nym, responsibleAppTokens: [rootToken, nym.auditTokenHex], destinations: peers.map { .init(host: $0.host, port: $0.port, transport: $0.transport) }, listeningEntries: listenerVerified ? [entry] : []),
            .init(role: "nym-helper", process: probe, responsibleAppTokens: [rootToken, probe.auditTokenHex], destinations: listenerVerified ? [entry] : [], listeningEntries: [])
        ])
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys; return try encoder.encode(review)
    }
}

/// The mode app's only vendor lifecycle is OwnedBackendStartGate. There is no Process/curl or
/// NymRouteAdapter.start here. NoTeam/platform refusal precedes plan callbacks, filesystem,
/// control-plane acquisition, key provisioning, XPC and owned child creation.
@MainActor final class NymProtectedRouteProvider: PrivacyRouteProvider {
    let mode: PrivacyRouteMode = .nym
    enum Phase { case idle, starting, backendReady, connected, blocked }
    enum Cleanup { case notStarted, reaped, unknown }
    private(set) var phase: Phase = .idle
    private(set) var cleanup: Cleanup = .notStarted
    private(set) var firstFailure: NymProtectedFailure?
    private(set) var firstQualificationFailure: RoutedQualificationFailure?
    private(set) var firstProofScopeFailure: RoutedNormalProofFailure?
    private(set) var lastFailure: NymProtectedFailure?
    private(set) var firstGateStopFailure: BackendStartGateFailure?
    private(set) var operationStage: NymProtectedStage = .idle
    private(set) var firstFailureStage: NymProtectedStage?
    private let startup = NymStartupOperation()
    private struct PendingGatewayEffect {
        let journal: NymGatewayActionJournal; let operation: UUID
        let gate: OwnedBackendStartGate; let preparation: RoutedRootPreparation
    }
    private var pendingGatewayEffects: [PendingGatewayEffect] = []
    var cleanupConfirmed: Bool {
        !startup.isRunning && shutdownTask == nil && pendingGatewayEffects.isEmpty && normalProofRegistration == nil && normalProofRefresh == nil && cleanup != .unknown && profileLease == nil && modeReceiptLease == nil && attempted.isEmpty && vendor == nil && proofGate == nil && preparation == nil && auxiliaryPreparations.isEmpty && auxiliaryProtections.isEmpty
    }
    typealias Inputs = (latestDirectory: NymLatestDirectoryInput, peers: NymNumericBootstrapPlan, proof: NymControlledProbe, runID: String, reviewedOrigin: URL)
    private let inputs: (() throws -> Inputs)?
    private let modeSupplier: NymModeRouteSupplier?
    private let bundle: Bundle
    private let gateSHA256: String
    private let userAction: UUID
    private let packageIdentity: NymCodeSignatureIdentity
    private let profile: NymDedicatedProfile?
    private let port: UInt16
    private var pathSeen = false
    private var selectionDeadline: Date?
    private var invoked = false, generation = UUID()
    private var protection: BrowserRouteProtection?
    private var preparation: RoutedRootPreparation?
    private var vendor: OwnedBackendStartGate?, proofGate: OwnedBackendStartGate?
    private var vendorOutputDiscardAcknowledgement: BackendOutputDiscardAcknowledgement?
    private var attempted: [OwnedBackendStartGate] = []
    private var normalProofRegistration: RoutedNormalProofParentRegistration?
    private var normalProofRefresh: Task<Void, Error>?
    private var profileLease: NymProfileLease?
    private var modeReceiptLease: NymProfileLease?
    private var watchdog: Task<Void, Never>?
    private var pathMonitor: NWPathMonitor?
    private var observers: [NSObjectProtocol] = []
    private var shutdownTask: Task<Void, Never>?
    private var auxiliaryProtections: [BrowserRouteProtection] = []
    private var auxiliaryPreparations: [RoutedRootPreparation] = []
    private var observedRootClosures: Set<UUID> = []
    #if YNX_PRIVACY_ACCEPTANCE
    private var syntheticFactory: NymSyntheticEpochFactory?
    private var syntheticRunID: String?
    private var syntheticReference: SyntheticTrialBinding?
    private var syntheticEpochs: [NymSyntheticEpoch] = []
    private var activeSyntheticEpochs: Set<UUID> = []
    private var pendingDirectoryEpoch: NymSyntheticEpoch?
    private var syntheticProofRegistration: SyntheticProofParentRegistration?
    private var syntheticProofRefresh: Task<Void, Error>?
    private(set) var syntheticEpoch: NymSyntheticEpoch?
    #endif

    init(protection: BrowserRouteProtection? = nil, helperSHA256: String, expectedPackageIdentity: NymCodeSignatureIdentity, profile: NymDedicatedProfile?, port: UInt16 = 19160, explicitUserAction: UUID, bundle: Bundle = .main, modeSupplier: NymModeRouteSupplier? = nil, inputs: (() throws -> Inputs)? = nil) {
        gateSHA256 = helperSHA256; userAction = explicitUserAction; self.bundle = bundle; self.inputs = inputs
        packageIdentity = expectedPackageIdentity; self.profile = profile; self.port = port
        self.protection = protection
        self.modeSupplier = modeSupplier
    }
    static func preflight(team: String, identifier: String?, helperSHA256: String) throws {
        // Historical diagnostic fixture only. Actual normal startup consumes its retained
        // opaque owner below, rather than treating this unqualified snapshot as authority.
        try validateIdentityInputs(team: team, identifier: identifier, helperSHA256: helperSHA256)
        guard RoutedPlatformIsolationAdmission.current.permitsWebContent else { throw NymProtectedFailure.platformDenied }
    }
    static func validateIdentityInputs(team: String, identifier: String?, helperSHA256: String) throws {
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw NymProtectedFailure.signingNotConfigured }
        guard identifier == RoutedIsolationMode.nym.bundleIdentifier else { throw NymProtectedFailure.wrongApplication }
        guard helperSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NymProtectedFailure.helperPinMissing }
    }
    private func authorizeNormalStartup() throws {
        try Self.validateIdentityInputs(team: bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "", identifier: bundle.bundleIdentifier, helperSHA256: gateSHA256)
        let owner = try protection ?? BrowserRouteProtection(mode: .nym, onLeaseLost: { [weak self] _ in self?.fence(.controlLeaseLost) })
        protection = owner // Same owner is retained through all subsequent async effects/cleanup.
        try owner.requireBackendStartupQualification(mode: .nym)
    }
    func start() async throws -> PrivacyRouteEndpoint {
        guard !invoked, phase == .idle else { throw NymProtectedFailure.ownershipConflict }
        invoked = true; generation = UUID(); let expected = generation
        phase = .starting
        do {
            return try await startup.run { [self] in try await performStart(expected: expected) }
        } catch {
            // The original worker has completed before stop joins it; never self-await from
            // inside performStart, including when another caller already initiated shutdown.
            await stop(); throw error
        }
    }
    private func performStart(expected: UUID) async throws -> PrivacyRouteEndpoint {
        do {
            operationStage = .identityPreflight
            try Task.checkCancellation()
            #if YNX_PRIVACY_ACCEPTANCE
            if syntheticFactory != nil {
                try SyntheticTrialAuthority.signingPreflight()
                guard bundle.bundleIdentifier == RoutedIsolationMode.nym.bundleIdentifier,
                      gateSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NymProtectedFailure.helperPinMissing }
            } else {
                try authorizeNormalStartup()
            }
            #else
            try authorizeNormalStartup()
            #endif
            guard bundle.bundleURL == Bundle.main.bundleURL else { throw NymProtectedFailure.wrongApplication }
            operationStage = .supply
            let supply = try BundledNymSupply.load(bundle: bundle, expectedPackageIdentity: packageIdentity)
            let resolved: (profile: NymDedicatedProfile, input: Inputs)
            if let modeSupplier {
                phase = .starting
                resolved = try await prepareMode(supplier: modeSupplier, supply: supply, expected: expected)
            } else {
                guard let profile, let inputs else { throw NymProtectedFailure.profileProvisioningRequired }
                operationStage = .proofResource
                resolved = (profile, try inputs())
            }
            let profile = resolved.profile, input = resolved.input
            operationStage = .numericPolicy
            let plan = try supply.makePlan(profile: profile, latestDirectory: input.latestDirectory, port: port)
            guard plan.port >= 1024, plan.executableSHA256 == BundledNymSupply.runtimeSHA256,
                  let selection = plan.directorySelection else { throw NymProtectedFailure.invalidNumericPlan }
            // Reconstruct the proof through the exact original run/origin validator, not URL strings alone.
            let proof = try NymControlledProbe(url: input.proof.url, responseSHA256: input.proof.responseSHA256, runID: input.runID, reviewedOrigin: input.reviewedOrigin)
            _ = try NymDedicatedProfile(id: plan.profileID, configSHA256: plan.profileSHA256)
            try plan.validateInstalledSupply(); try input.peers.validate(selection: selection, now: Date())
            let expectedEndpoints = try runtimeEndpoints(latest: input.latestDirectory, selection: selection)
            let expectedPeers = expectedEndpoints.flatMap { endpoint in endpoint.addresses.map { NymNumericBootstrapPlan.Peer(purpose: .init(rawValue: endpoint.purpose)!, host: $0, port: endpoint.port, transport: IPPROTO_TCP, hostname: endpoint.host) } }
            guard Set(input.peers.peers.map { "\($0.purpose.rawValue)|\($0.hostname ?? "")|\($0.host)|\($0.port)" }) == Set(expectedPeers.map { "\($0.purpose.rawValue)|\($0.hostname ?? "")|\($0.host)|\($0.port)" }) else { throw NymProtectedFailure.invalidNumericPlan }
            selectionDeadline = min(selection.validUntil, input.peers.validUntil)
            let helper = try NymProofHelper.pinnedExecutable(in: bundle)
            // Only the exact tested strict-callee successor can consume this map. A caller's
            // Boolean, successful ordinary DNS lookup or stale epoch cannot grant egress.
            try input.peers.requireAttributedDNS(runtimeSHA256: plan.executableSHA256)
            phase = .starting
            if profileLease == nil { profileLease = try NymProfileLease(url: plan.profileURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(".ynx-run.lock")) }
            try plan.validateInstalledSupply() // Recheck config pin after acquiring the real profile lock.
            let protection: BrowserRouteProtection
            let prep: RoutedRootPreparation
            #if YNX_PRIVACY_ACCEPTANCE
            if syntheticFactory != nil {
                let epoch = try await acquireSyntheticEpoch(.runtime, expected: expected)
                syntheticEpoch = epoch; protection = epoch.protection
                prep = try await protection.beginBackendPreparation(qualifiedTrial: epoch.authority)
            } else {
                protection = try self.protection ?? BrowserRouteProtection(mode: .nym, onLeaseLost: { [weak self] _ in self?.fence(.cancelled) })
                self.protection = protection // Adopt before its asynchronous preparation can suspend.
                prep = try await protection.beginBackendPreparation()
            }
            #else
            protection = try self.protection ?? BrowserRouteProtection(mode: .nym, onLeaseLost: { [weak self] _ in self?.fence(.cancelled) })
            self.protection = protection
            prep = try await protection.beginBackendPreparation()
            #endif
            self.protection = protection
            preparation = prep; try require(expected)
            let root = try RoutedOwnAuditToken.copy()
            guard Self.hash(root) == prep.receipt?.rootAuditTokenSHA256 else { throw NymProtectedFailure.identityRejected }
            let rootHex = root.map { String(format: "%02x", $0) }.joined()
            let gateExecutable = bundle.bundleURL.appendingPathComponent(OwnedBackendStartGate.helperRelativePath)
            let profileRoot = plan.profileURL.deletingLastPathComponent().deletingLastPathComponent()
            let policyBytes = try NymReviewedNetworkPolicy(runID: prep.configuration.runID, stage: "route-runtime", issuedAt: UInt64(Date().timeIntervalSince1970), expiresAt: UInt64(selection.validUntil.timeIntervalSince1970), directoryEpoch: selection.epoch,
                directorySHA256: [selection.basicSHA256, selection.describedSHA256, selection.epochSHA256], entryIdentity: selection.entryIdentity, bootstrapSourceSHA256: nil, endpoints: expectedEndpoints).bytes()
            let policyURL = profileRoot.appendingPathComponent("network-" + prep.configuration.epoch.uuidString.lowercased() + ".json")
            try NymModeProfileReceipt.writeNew(policyBytes, to: policyURL)
            var runArguments = plan.runArguments
            if let flag = runArguments.firstIndex(of: "--ynx-runtime-contract"), runArguments.indices.contains(flag + 1) { runArguments[flag + 1] = "ynx-protected-numeric-v2" }
            let protectedArguments = ["--no-banner", "--ynx-reviewed-network", policyURL.path, "--ynx-reviewed-network-sha256", Self.hash(policyBytes), "--ynx-reviewed-run-id", prep.configuration.runID] + runArguments
            let vendor = try OwnedBackendStartGate(helperExecutable: gateExecutable, helperSHA256: gateSHA256, preparation: prep, directory: profileRoot.appendingPathComponent("run-gate-" + expected.uuidString.lowercased()))
            self.vendor = vendor; protection.trackBackendGate(vendor); attempted.append(vendor); cleanup = .unknown
            let vi = try await vendor.prepare(specification: .init(executable: plan.executable, executableSHA256: plan.executableSHA256, codeRequirement: BundledNymSupply.runtimeRequirement, arguments: protectedArguments, environment: ["PATH": "/usr/bin:/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path], output: .merged, outputPolicy: .discardAfterBootstrap))
            try require(expected)
            let pg = try OwnedBackendStartGate(helperExecutable: gateExecutable, helperSHA256: gateSHA256, preparation: prep, directory: profileRoot.appendingPathComponent("proof-gate-" + expected.uuidString.lowercased()))
            proofGate = pg; protection.trackBackendGate(pg); attempted.append(pg)
            let proofArguments: [String]
            var normalProofBinding: RoutedNormalProofBinding?
            #if YNX_PRIVACY_ACCEPTANCE
            if let syntheticEpoch { proofArguments = try NymSyntheticProofHelper.arguments(binding: syntheticEpoch.authority.binding) }
            else {
                let binding = try protection.normalProofBinding(profileID: plan.profileID, profileSHA256: plan.profileSHA256, proofRunID: input.runID)
                normalProofBinding = binding
                proofArguments = try NymNormalProofHelper.arguments(binding: binding, request: .init(port: plan.port, runID: input.runID, origin: input.reviewedOrigin, proof: proof))
            }
            #else
            let binding = try protection.normalProofBinding(profileID: plan.profileID, profileSHA256: plan.profileSHA256, proofRunID: input.runID)
            normalProofBinding = binding
            proofArguments = try NymNormalProofHelper.arguments(binding: binding, request: .init(port: plan.port, runID: input.runID, origin: input.reviewedOrigin, proof: proof))
            #endif
            let pi = try await pg.prepare(specification: .init(executable: helper.executable, executableSHA256: helper.sha256, codeRequirement: helper.requirement, arguments: proofArguments, environment: ["PATH": "/usr/bin:/bin"], output: .standardOutput))
            try require(expected)
            let graph = NymProtectedGraph(rootToken: rootHex,
                nym: try .decode(vi.processPinJSON, executable: plan.executable, sha256: plan.executableSHA256, requirement: BundledNymSupply.runtimeRequirement),
                probe: try .decode(pi.processPinJSON, executable: helper.executable, sha256: helper.sha256, requirement: helper.requirement), port: plan.port, peers: input.peers.peers)
            let ack = try await protection.enrollBootstrapGraph(review: graph.encoded(listenerVerified: false)); try require(expected)
            try input.peers.validate(selection: selection, now: Date()); try plan.validateDirectory()
            try await vendor.resume(after: ack, lease: try protection.bootstrapControlLease); try require(expected)
            operationStage = .bootstrap
            let observedStartupLineSHA256 = try await awaitMarker(vendor, selection: selection, expected: expected)
            // The original helper verifies this exact observed complete line inside its own
            // bounded capture and acknowledges truncation/discard for this live backend token.
            // Only the vendor run opts in; short control JSON never enters discard mode.
            let discard = try await vendor.discardOutput(afterBootstrapMarkerSHA256: observedStartupLineSHA256,
                acknowledgement: ack, lease: try protection.bootstrapControlLease)
            try require(expected)
            vendorOutputDiscardAcknowledgement = discard
            // The provider checks actual listening ownership while acknowledging this edge. The
            // official marker alone is not proof that any HTTP request traversed the Mixnet.
            let proofAck = try await protection.updateBootstrapGraph(review: graph.encoded(listenerVerified: true)); try require(expected)
            operationStage = .proof
            if let normalProofBinding {
                // Actual final graph/listener ACK and official startup/discard precede scope
                // registration. Adopt even a late result so cancellation can revoke it.
                normalProofRegistration = try await protection.registerNormalProof(binding: normalProofBinding,
                    proofURL: proof.url, responseSHA256: proof.responseSHA256, helper: pi, readyBackend: vendor)
                try require(expected)
            }
            #if YNX_PRIVACY_ACCEPTANCE
            if let syntheticEpoch {
                let pin = try NymProtectedGraph.Pin.decode(pi.processPinJSON, executable: helper.executable, sha256: helper.sha256, requirement: helper.requirement)
                let token = try NymSyntheticProofHelper.auditTokenBytes(hex: pin.auditTokenHex)
                syntheticProofRegistration = try await SyntheticProofParentRegistration.register(authority: syntheticEpoch.authority,
                    manifestURL: syntheticEpoch.manifestURL, helperAuditTokenSHA256: Self.hash(token), readyBackend: vendor)
                try require(expected)
            }
            #endif
            try await pg.resume(after: proofAck, lease: try protection.bootstrapControlLease); try require(expected)
            operationStage = .proof
            try await awaitProof(pg, proof: proof, expected: expected)
            if normalProofBinding != nil { try await requireNormalProofRegistration(); try require(expected) }
            #if YNX_PRIVACY_ACCEPTANCE
            if syntheticEpoch != nil { try await requireSyntheticProofRegistration(); try require(expected) }
            #endif
            phase = .backendReady
            operationStage = .routeConnect
            #if YNX_PRIVACY_ACCEPTANCE
            if let syntheticEpoch {
                try await protection.connectReadyBackend(provider: self, explicitUserAction: userAction, qualifiedTrial: syntheticEpoch.authority)
            } else { try await protection.connectReadyBackend(provider: self, explicitUserAction: userAction) }
            #else
            try await protection.connectReadyBackend(provider: self, explicitUserAction: userAction)
            #endif
            try require(expected)
            phase = .connected; operationStage = .connected; installWatchdog(expected)
            return try PrivacyRouteEndpoint(port: plan.port)
        } catch {
            rememberAuthorityFailure(error)
            recordFailure(Self.classify(error, stage: operationStage))
            protection?.close(); preparation?.close(); throw error
        }
    }
    func status() async -> PrivacyRouteStatus {
        guard [.backendReady, .connected].contains(phase), let protection, let vendor, let proofGate, let preparation, let vendorOutputDiscardAcknowledgement else { return phase == .starting ? .connecting : .blocked(lastFailure?.rawValue ?? "Nym has not completed protected bootstrap and HTTPS proof") }
        let before = generation, beforePhase = phase
        do {
            #if YNX_PRIVACY_ACCEPTANCE
            if syntheticEpoch != nil { try await requireSyntheticProofRegistration() }
            else { try await requireNormalProofRegistration() }
            #else
            try await requireNormalProofRegistration()
            #endif
            let lease = try protection.bootstrapControlLease
            guard let selectionDeadline, Date() < selectionDeadline else { throw NymProtectedFailure.staleNumericPlan }
            guard lease.phase == (phase == .backendReady ? .blocked : .routeEntryConnected),
                  vendorOutputDiscardAcknowledgement.pid == vendor.prepared?.pid,
                  vendorOutputDiscardAcknowledgement.runID == preparation.configuration.runID,
                  vendorOutputDiscardAcknowledgement.epoch == preparation.configuration.epoch.uuidString,
                  vendorOutputDiscardAcknowledgement.providerGeneration == lease.providerGeneration,
                  try await vendor.poll() == nil, try await proofGate.poll() == nil,
                  before == generation, beforePhase == phase,
                  Date() < selectionDeadline,
                  try protection.bootstrapControlLease.phase == lease.phase else { throw NymProtectedFailure.backendExited }
            return .connected
        } catch {
            // A late status reply after stop/replacement cannot overwrite its original failure.
            if before == generation, beforePhase == phase { rememberAuthorityFailure(error); fence(Self.classify(error, stage: .connected)) }
            return .blocked(firstFailure?.rawValue ?? "Nym backend/proof/protection lease lost")
        }
    }
    func stop() async {
        if let shutdownTask { await shutdownTask.value; return }
        generation = UUID(); phase = .blocked; startup.cancel()
        let task = Task { @MainActor [self] in
            await performStop()
            shutdownTask = nil // Clear before waking concurrent stop/cleanup waiters.
        }
        shutdownTask = task
        await task.value
    }
    func awaitCleanupConfirmation() async -> Bool {
        await stop()
        return cleanupConfirmed
    }
    private func performStop() async {
        generation = UUID(); phase = .blocked; watchdog?.cancel(); watchdog = nil
        pathMonitor?.cancel(); pathMonitor = nil
        for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }; observers.removeAll()
        normalProofRefresh?.cancel(); normalProofRegistration?.close()
        protection?.close(); preparation?.close()
        for owned in auxiliaryProtections { owned.close() }
        for owned in auxiliaryPreparations { owned.close() }
        // A cancelled factory may return an owned preparation. Wait for the original worker to
        // retain that result and fail its generation check before taking the final cleanup set.
        await startup.join()
        // A late registration/refresh belongs to this original operation until it actually
        // returns. Close before joining its bounded RPC; no replacement receives its scope.
        normalProofRegistration?.close()
        if let refresh = normalProofRefresh { refresh.cancel(); _ = try? await refresh.value }
        normalProofRefresh = nil; normalProofRegistration = nil
        operationStage = .cleanup
        #if YNX_PRIVACY_ACCEPTANCE
        activeSyntheticEpochs.removeAll()
        syntheticProofRefresh?.cancel(); syntheticProofRefresh = nil
        syntheticProofRegistration?.close(); syntheticProofRegistration = nil
        for epoch in syntheticEpochs { epoch.authority.revoke() }
        #endif
        protection?.close(); preparation?.close()
        for owned in auxiliaryProtections { owned.close() }
        for owned in auxiliaryPreparations { owned.close() }
        for gate in attempted.reversed() { await gate.stop() }
        for gate in attempted {
            if firstGateStopFailure == nil { firstGateStopFailure = gate.stopFailure }
            // A child receipt alone does not prove that the original helper, control/output
            // descriptors and owned files were closed. UNKNOWN keeps all original leases.
            guard Self.hasConfirmedGateCleanup(receipt: try? await gate.poll(), preparedPID: gate.prepared?.pid,
                cleanupChildPID: gate.cleanupChildPID, helperCleanupConfirmed: gate.cleanupConfirmed) else { cleanup = .unknown; recordFailure(.cleanupUnconfirmed); return }
        }
        var allPreparations = auxiliaryPreparations
        if let preparation { allPreparations.append(preparation) }
        for context in allPreparations where !observedRootClosures.contains(context.configuration.epoch) {
            do {
                _ = try await RootClosureObserver.awaitClosed(preparation: context)
                observedRootClosures.insert(context.configuration.epoch)
            } catch {
                cleanup = .unknown; recordFailure(.cleanupUnconfirmed)
                // Do not equate local invalidate with provider-observed dual-control close.
                // Keep the original gates and both real leases while closure is UNKNOWN.
                return
            }
        }
        // A mutation can have exited successfully before a delayed/UNKNOWN remote close.
        // Preserve that original process evidence once final cleanup confirms the same epoch;
        // fresh official active-state readback is still required on the next explicit request.
        for effect in pendingGatewayEffects {
            guard let exit = effect.gate.observedExit, exit.code == 0, exit.signal == nil,
                  observedRootClosures.contains(effect.preparation.configuration.epoch),
                  Self.hasConfirmedGateCleanup(receipt: exit, preparedPID: effect.gate.prepared?.pid,
                    cleanupChildPID: effect.gate.cleanupChildPID, helperCleanupConfirmed: effect.gate.cleanupConfirmed) else { continue }
            do { try effect.journal.recordEffectExit(operation: effect.operation, exit: exit) }
            catch { cleanup = .unknown; recordFailure(.cleanupUnconfirmed); return }
        }
        pendingGatewayEffects.removeAll()
        cleanup = attempted.isEmpty ? .notStarted : .reaped
        attempted.removeAll(); vendor = nil; proofGate = nil; preparation = nil; vendorOutputDiscardAcknowledgement = nil
        auxiliaryProtections.removeAll(); auxiliaryPreparations.removeAll()
        #if YNX_PRIVACY_ACCEPTANCE
        syntheticEpochs.removeAll(); syntheticEpoch = nil; pendingDirectoryEpoch = nil
        #endif
        profileLease?.release(); profileLease = nil
        modeReceiptLease?.release(); modeReceiptLease = nil
        selectionDeadline = nil
    }
    private func require(_ expected: UUID) throws {
        try Task.checkCancellation()
        guard generation == expected, [.starting, .backendReady].contains(phase) else { throw NymProtectedFailure.cancelled }
        guard let selectionDeadline, Date() < selectionDeadline else { throw NymProtectedFailure.staleNumericPlan }
        guard try protection?.bootstrapControlLease.phase != .lost else { throw NymProtectedFailure.cancelled }
    }
    private func fence(_ failure: NymProtectedFailure) {
        generation = UUID(); phase = .blocked; recordFailure(failure); protection?.close(); preparation?.close()
        Task { await stop() }
    }
    private func recordFailure(_ failure: NymProtectedFailure) {
        if firstFailure == nil { firstFailure = failure; firstFailureStage = operationStage }
        lastFailure = failure
    }
    static func hasConfirmedGateCleanup(receipt: BackendProcessExit?, preparedPID: Int32?, cleanupChildPID: Int32?, helperCleanupConfirmed: Bool) -> Bool {
        guard helperCleanupConfirmed, let receipt, let cleanupChildPID, cleanupChildPID > 1,
              receipt.childReaped, receipt.pid == cleanupChildPID else { return false }
        // Cancellation can precede public prepare() completion. The Gate's independently
        // validated cleanup-only child identity proves cleanup, never resume/graph authority.
        if let preparedPID { guard preparedPID > 1, receipt.pid == preparedPID else { return false } }
        return true
    }
    static func classify(_ error: Error, stage: NymProtectedStage) -> NymProtectedFailure {
        if let failure = error as? NymProtectedFailure { return failure }
        if error is CancellationError { return .cancelled }
        if let failure = error as? RoutedQualificationFailure {
            switch failure {
            case .signingNotConfigured: return .signingNotConfigured
            case .wrongMode: return .wrongApplication
            case .invalidSignature: return .identityRejected
            case .helperNotBound: return .helperPinMissing
            case .qualificationIssuerNotSupplied: return .qualificationNotSupplied
            case .installationChanged, .expired, .revoked, .closed: return .qualificationLost
            }
        }
        if let failure = error as? RoutedNormalProofFailure {
            switch failure {
            case .missingProviderPin: return .proofScopeNotSupplied
            case .invalidSignature: return .identityRejected
            case .invalidBinding, .invalidScope: return .proofFailed
            case .revoked, .transportLost, .timeout: return .proofScopeLost
            }
        }
        if let failure = error as? BackendStartGateFailure {
            if failure.operation == "output-capture-incomplete" { return .outputCaptureIncomplete }
            if ["output-capture-limit", "output-capture-ack"].contains(failure.operation) { return .helperContractMismatch }
        }
        if let failure = error as? ProtectionLeaseFailure {
            switch failure {
            case .signingNotConfigured: return .signingNotConfigured
            case .wrongApplicationInstance: return .wrongApplication
            case .identityUnavailable: return .identityRejected
            case .cancelled: return .cancelled
            case .systemSleep: return .networkChanged
            default: return .controlLeaseLost
            }
        }
        if error is PrivacyRouteError { return .controlLeaseLost }
        if let failure = error as? NymRouteAdapterError {
            switch failure {
            case .cancelled: return .cancelled
            case .profileInUse: return .ownershipConflict
            case .missingProfile, .profileMismatch: return .invalidProfileReceipt
            case .missingExecutable, .executableMismatch: return .unsupportedRuntime
            case .probeFailed: return .proofFailed
            case .startupTimedOut: return .bootstrapTimedOut
            default: break
            }
        }
        if let failure = error as? BundledNymSupplyError {
            switch failure {
            case .staleDirectory: return .staleNumericPlan
            case .invalidProfile, .missingProfile, .unsafeProfilePermissions: return .invalidProfileReceipt
            default: return .supplyRejected
            }
        }
        switch stage {
        case .proofResource: return .proofNotSupplied
        case .supply: return .supplyRejected
        case .directory: return .directoryFailed
        case .profile: return .invalidProfileReceipt
        case .gateway: return .gatewayFailed
        case .numericPolicy: return .invalidNumericPlan
        case .proof: return .proofFailed
        case .bootstrap: return .backendExited
        default: return .controlPlaneFailed
        }
    }
    private func rememberAuthorityFailure(_ error: Error) {
        if firstQualificationFailure == nil, let failure = error as? RoutedQualificationFailure { firstQualificationFailure = failure }
        if firstProofScopeFailure == nil, let failure = error as? RoutedNormalProofFailure { firstProofScopeFailure = failure }
    }
    private func requireNormalProofRegistration() async throws {
        if let pending = normalProofRefresh { try await pending.value; return }
        guard let registration = normalProofRegistration else { throw NymProtectedFailure.proofFailed }
        let pending = Task { @MainActor in try Task.checkCancellation(); try await registration.requireLive() }
        normalProofRefresh = pending
        defer { normalProofRefresh = nil }
        try await pending.value
    }
    private func awaitMarker(_ gate: OwnedBackendStartGate, selection: NymActiveDirectorySelection, expected: UUID) async throws -> String {
        let marker = NymObservedStartupLine(expectedGatewayIdentity: selection.entryIdentity)
        try await readBounded(gate, limit: 1_048_576, seconds: 180, expected: expected) { marker.append($0); return marker.observedLineSHA256 != nil }
        guard let digest = marker.observedLineSHA256 else { throw NymProtectedFailure.bootstrapTimedOut }
        return digest
    }
    private func awaitProof(_ gate: OwnedBackendStartGate, proof: NymControlledProbe, expected: UUID) async throws {
        var received = Data()
        try await readBounded(gate, limit: 8192, seconds: 25, expected: expected) { data in
            received.append(data)
            guard let newline = received.firstIndex(of: 10) else { return false }
            guard newline == received.count - 1,
                  let object = try JSONSerialization.jsonObject(with: received.prefix(upTo: newline)) as? [String: Any],
                  Set(object.keys) == ["schema", "body"], object["schema"] as? String == "YNX_NYM_HTTPS_PROOF_V1",
                  let body = object["body"] as? String, let bytes = Data(base64Encoded: body) else { throw NymProtectedFailure.proofFailed }
            try proof.validateResponse(bytes); return true
        }
    }
    private func readBounded(_ gate: OwnedBackendStartGate, limit: Int, seconds: Int, expected: UUID, consume: (Data) throws -> Bool) async throws {
        let outputIdentity = try NymOwnedOutputIdentity(fileDescriptor: gate.backendOutput.fileDescriptor)
        let fd = outputIdentity.fileDescriptor, flags = fcntl(fd, F_GETFL)
        guard flags >= 0, fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0 else { throw NymProtectedFailure.backendExited }
        let deadline = ContinuousClock.now.advanced(by: .seconds(seconds)); var total = 0
        while ContinuousClock.now < deadline {
            try require(expected)
            guard try protection?.bootstrapControlLease.phase == .blocked, try await gate.poll() == nil,
                  let vendor, try await vendor.poll() == nil else { throw NymProtectedFailure.backendExited }
            // poll() can suspend while stop/revocation closes and reuses this descriptor.
            // A late nil reply cannot authorize a read or complete a cancelled bootstrap.
            try require(expected)
            guard try protection?.bootstrapControlLease.phase == .blocked else { throw NymProtectedFailure.controlLeaseLost }
            try outputIdentity.requireCurrent()
            guard ContinuousClock.now < deadline else { break }
            var buffer = [UInt8](repeating: 0, count: 2048); let n = read(fd, &buffer, buffer.count)
            if n > 0 { total += n; guard total <= limit else { throw NymProtectedFailure.proofFailed }; if try consume(Data(buffer.prefix(n))) { return } }
            else if n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { throw NymProtectedFailure.backendExited }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw operationStage == .proof ? NymProtectedFailure.proofTimedOut : .bootstrapTimedOut
    }
    private func installWatchdog(_ expected: UUID) {
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard let self, self.generation == expected, self.phase == .connected else { return }
                if await self.status() != .connected { return }
            }
        }
        let monitor = NWPathMonitor(); pathMonitor = monitor
        pathSeen = false
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor in
            guard let self, self.generation == expected else { return }
            if self.pathSeen || !available { self.fence(.networkChanged) } else { self.pathSeen = true }
        } }
        monitor.start(queue: DispatchQueue(label: "com.ynx.browser.nym-route-path"))
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification] {
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.fence(.cancelled) } })
        }
    }
    private static func hash(_ d: Data) -> String { SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }
}

/// Retains only the digest of the actual complete startup line while reusing the original
/// matching-gateway marker parser. The digest authenticates an owned helper control transition,
/// never route readiness. Raw addresses/logs are not retained or persisted here.
final class NymObservedStartupLine {
    private let marker: NymBootstrapMarker
    private var partial = Data(), overlong = false
    private var startupLineSHA256: String?
    init(expectedGatewayIdentity: String) { marker = NymBootstrapMarker(expectedGatewayIdentity: expectedGatewayIdentity) }
    func append(_ bytes: Data) {
        marker.append(bytes)
        for byte in bytes {
            if byte == 10 {
                if !overlong {
                    if partial.last == 13 { partial.removeLast() }
                    let normalized = String(decoding: partial, as: UTF8.self)
                        .replacingOccurrences(of: "\u{001B}\\[[0-9;]*m", with: "", options: .regularExpression)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if normalized.hasSuffix("Client startup finished!") {
                        startupLineSHA256 = SHA256.hash(data: partial).map { String(format: "%02x", $0) }.joined()
                    }
                }
                partial.removeAll(keepingCapacity: true); overlong = false
            } else if partial.count < 4096 && !overlong { partial.append(byte) }
            else { partial.removeAll(keepingCapacity: true); overlong = true }
        }
    }
    var observedLineSHA256: String? { marker.isFinished ? startupLineSHA256 : nil }
}

/// Restricted background role, dispatched BEFORE NSApplication.shared. It never constructs
/// BrowserController, changes DNS/trust, follows a redirect, solves CAPTCHA, or requests a user URL.
enum NymProofHelper {
    static let flag = "--ynx-nym-proof-v1"
    static let identifier = "com.ynxweb4.browser.route.nym.probe"
    static let relativePath = "Contents/Helpers/YNX Nym Probe.app"
    struct Request { let port: UInt16; let runID: String; let origin: URL; let proof: NymControlledProbe }
    struct Pin { let executable: URL; let sha256: String; let requirement: String }
    static func arguments(port: UInt16, runID: String, reviewedOrigin: URL, proof: NymControlledProbe) -> [String] {
        [flag, String(port), runID, reviewedOrigin.absoluteString, proof.url.absoluteString, proof.responseSHA256]
    }
    static func parse(_ args: [String]) throws -> Request {
        guard args.count == 7, args[1] == flag, let port = UInt16(args[2]), port >= 1024,
              String(port) == args[2], let origin = URL(string: args[4]), let url = URL(string: args[5]) else { throw NymProtectedFailure.proofFailed }
        return try Request(port: port, runID: args[3], origin: origin, proof: NymControlledProbe(url: url, responseSHA256: args[6], runID: args[3], reviewedOrigin: origin))
    }
    /// Compare requested DATA with the scope returned by the independent opaque child owner.
    /// Neither this function nor a passing comparison can construct that authority.
    static func validateAuthorityScope(_ request: Request, port: UInt16, runID: String,
                                       reviewedOrigin: URL, proofURL: URL, responseSHA256: String) throws {
        guard port >= 1024, request.port == port,
              request.runID.utf8.elementsEqual(runID.utf8),
              request.origin.absoluteString.utf8.elementsEqual(reviewedOrigin.absoluteString.utf8),
              request.proof.url.absoluteString.utf8.elementsEqual(proofURL.absoluteString.utf8),
              request.proof.responseSHA256.utf8.elementsEqual(responseSHA256.utf8) else { throw NymProtectedFailure.proofFailed }
        _ = try NymControlledProbe(url: proofURL, responseSHA256: responseSHA256, runID: runID, reviewedOrigin: reviewedOrigin)
    }
    /// Actual immutable helper identity precedes informational normal-scope decoding or IPC.
    static func selfPreflight(bundle: Bundle) throws {
        let team = bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? ""
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw NymProtectedFailure.signingNotConfigured }
        guard bundle.bundleURL == Bundle.main.bundleURL, bundle.bundleIdentifier == identifier,
              bundle.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool == true,
              bundle.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool == true,
              bundle.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") == nil,
              bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil,
              let executable = bundle.executableURL,
              executable.standardizedFileURL == URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL,
              executable.resolvingSymlinksInPath() == executable else { throw NymProtectedFailure.wrongApplication }
        let rule = "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"\(team)\""
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(rule as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else { throw NymProtectedFailure.identityRejected }
        try verify(bundle.bundleURL, requirement: rule)
    }
    static func dispatchDecision(identifier id: String?, role: Bool, arguments: [String]) -> Bool? {
        let requested = arguments.dropFirst().contains(where: { $0.hasPrefix("--ynx-nym-proof") })
        if id == identifier || role { return id == identifier && role && (try? parse(arguments)) != nil }
        return requested ? false : nil
    }
    static func pinnedExecutable(in parent: Bundle) throws -> Pin {
        let url = parent.bundleURL.appendingPathComponent(relativePath)
        guard url.resolvingSymlinksInPath() == url, let helper = Bundle(url: url), helper.bundleIdentifier == identifier,
              helper.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool == true,
              helper.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") == nil,
              helper.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil,
              helper.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool == true,
              let exe = helper.executableURL, exe.path == url.appendingPathComponent("Contents/MacOS/YNXBrowserNative").path,
              exe.resolvingSymlinksInPath() == exe,
              let hash = parent.object(forInfoDictionaryKey: "YNXNymProofHelperSHA256") as? String,
              hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              SHA256.hash(data: try Data(contentsOf: exe)).map({ String(format: "%02x", $0) }).joined() == hash,
              let team = parent.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw NymProtectedFailure.helperPinMissing }
        let requirement = "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"\(team)\""
        try verify(url, requirement: requirement)
        return .init(executable: exe, sha256: hash, requirement: requirement)
    }
    /// nil: normal mode may continue. Any nonnil result MUST be passed directly to exit().
    /// Bad/missing helper parameters return 78; there is no fallback into the ordinary UI.
    static func runIfRequested(arguments: [String] = CommandLine.arguments, bundle: Bundle = .main) -> Int32? {
        if NymNormalProofHelper.claims(arguments) { return NymNormalProofHelper.run(arguments: arguments, bundle: bundle) }
        #if YNX_PRIVACY_ACCEPTANCE
        if NymSyntheticProofHelper.claims(arguments) { return NymSyntheticProofHelper.run(arguments: arguments, bundle: bundle) }
        #endif
        guard let decision = dispatchDecision(identifier: bundle.bundleIdentifier, role: bundle.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool == true, arguments: arguments) else { return nil }
        // The legacy argv has no parent/child scope. It remains a DATA parser fixture,
        // never a transport entry, even if a future global diagnostic reports ready.
        _ = decision
        return 78
    }
    private static func verify(_ url: URL, requirement: String) throws {
        var code: SecStaticCode?, rule: SecRequirement?
        guard SecStaticCodeCreateWithPath(url as CFURL, SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(requirement as CFString, SecCSFlags(), &rule) == errSecSuccess, let rule,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), rule) == errSecSuccess else { throw NymProtectedFailure.identityRejected }
    }
}

/// Normal child lookup constraints are informational. Only its real signed Provider channel
/// can return the independently bound opaque child capability; no Root factory is used here.
enum NymNormalProofHelper {
    static let flag = "--ynx-nym-normal-proof-v1"
    static func claims(_ arguments: [String]) -> Bool {
        arguments.dropFirst().contains { $0.hasPrefix("--ynx-nym-normal-proof") }
    }
    static func validateBinding(_ binding: RoutedNormalProofBinding) throws {
        guard binding.mode == .nym, binding.purpose == "normal-nym-bootstrap-proof",
              binding.rootRunID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              binding.proofRunID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              UUID(uuidString: binding.epoch) != nil, UUID(uuidString: binding.providerGeneration) != nil,
              [binding.rootAuditTokenSHA256, binding.executableSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else { throw NymProtectedFailure.proofFailed }
        _ = try NymDedicatedProfile(id: binding.profileID, configSHA256: binding.profileSHA256)
    }
    static func arguments(binding: RoutedNormalProofBinding, request: NymProofHelper.Request) throws -> [String] {
        try validateBinding(binding)
        guard binding.proofRunID.utf8.elementsEqual(request.runID.utf8) else { throw NymProtectedFailure.proofFailed }
        let bytes = try JSONEncoder().encode(binding)
        guard bytes.count <= 4096 else { throw NymProtectedFailure.proofFailed }
        return [flag, bytes.base64EncodedString(), String(request.port), request.runID,
                request.origin.absoluteString, request.proof.url.absoluteString, request.proof.responseSHA256]
    }
    static func parse(_ arguments: [String]) throws -> (RoutedNormalProofBinding, NymProofHelper.Request) {
        guard arguments.count == 8, arguments[1] == flag, arguments[2].utf8.count <= 8192,
              let bytes = Data(base64Encoded: arguments[2]), bytes.count <= 4096,
              bytes.base64EncodedString() == arguments[2] else { throw NymProtectedFailure.proofFailed }
        let binding = try JSONDecoder().decode(RoutedNormalProofBinding.self, from: bytes)
        try validateBinding(binding)
        let request = try NymProofHelper.parse([arguments[0], NymProofHelper.flag] + Array(arguments.dropFirst(3)))
        guard binding.proofRunID.utf8.elementsEqual(request.runID.utf8) else { throw NymProtectedFailure.proofFailed }
        return (binding, request)
    }
    static func run(arguments: [String], bundle: Bundle) -> Int32 {
        do {
            try NymProofHelper.selfPreflight(bundle: bundle)
            try RoutedNormalProofChildAuthority.preflight()
            let (binding, request) = try parse(arguments)
            let authority = try RoutedNormalProofChildAuthority.begin(binding: binding)
            defer { authority.revoke() }
            let scope = authority.scope
            try NymProofHelper.validateAuthorityScope(request, port: scope.routePort, runID: authority.binding.proofRunID,
                reviewedOrigin: scope.reviewedOrigin, proofURL: scope.proofURL, responseSHA256: scope.responseSHA256)
            let transfer = NymProofTransfer(request: request)
            authority.installRevocationHandler { transfer.cancel() }
            let body = try transfer.perform { try authority.authorize(request: $0) }
            try authority.requireLive(); try request.proof.validateResponse(body)
            let receipt = try JSONSerialization.data(withJSONObject: ["schema": "YNX_NYM_HTTPS_PROOF_V1", "body": body.base64EncodedString()], options: [.sortedKeys])
            try FileHandle.standardOutput.write(contentsOf: receipt + Data([10]))
            // Preserve the reviewed live child token and real revocation checks while idle.
            // EOF stops it; bytes, scope loss or lease loss cannot trigger another request.
            while true {
                try authority.requireLive()
                var descriptor = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN | POLLHUP | POLLERR), revents: 0)
                let result = poll(&descriptor, 1, 100)
                if result < 0 { if errno == EINTR { continue }; return 78 }
                if result > 0 {
                    var byte: UInt8 = 0
                    let count = read(STDIN_FILENO, &byte, 1)
                    if count == 0 { return 0 }
                    if count > 0 || (errno != EAGAIN && errno != EINTR) { return 78 }
                }
            }
        } catch { return 78 }
    }
}

/// Runs only in the separately enrolled long-lived helper. The OS graph permits its sole
/// socket destination 127.0.0.1:port. Public SOCKSv5 API forbids direct failover; any resolver,
/// certificate-fetch or auxiliary direct flow is still denied by the provider, never exempted.
private final class NymProofTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let port: UInt16
    private let proofURL: URL
    private let cancellationLock = NSLock()
    private var cancelled = false
    private var activeSession: URLSession?
    private let completed = DispatchSemaphore(value: 0)
    // DelegateQueue serializes all state; perform reads only after the completion semaphore.
    private var bytes = Data(), accepted = false, failed = false
    init(request: NymProofHelper.Request) { port = request.port; proofURL = request.proof.url }
    #if YNX_PRIVACY_ACCEPTANCE
    init(port: UInt16, proofURL: URL) { self.port = port; self.proofURL = proofURL }
    #endif
    func cancel() {
        cancellationLock.lock(); cancelled = true; let session = activeSession; cancellationLock.unlock()
        session?.invalidateAndCancel()
    }
    func perform(authorize: (URLRequest) throws -> Void) throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: .ipv4(.loopback), port: .init(rawValue: port)!))
        proxy.allowFailover = false; proxy.matchDomains = [""]; proxy.excludedDomains = []
        config.proxyConfigurations = [proxy]
        config.urlCache = nil; config.urlCredentialStorage = nil; config.httpCookieStorage = nil
        config.httpShouldSetCookies = false; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 20; config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 1
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
        cancellationLock.lock()
        let wasCancelled = cancelled
        if !wasCancelled { activeSession = session }
        cancellationLock.unlock()
        guard !wasCancelled else { session.invalidateAndCancel(); throw NymProtectedFailure.cancelled }
        defer {
            session.invalidateAndCancel()
            cancellationLock.lock(); activeSession = nil; cancellationLock.unlock()
        }
        var query = URLRequest(url: proofURL); query.httpMethod = "GET"
        query.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        try authorize(query) // Synthetic child performs a real fresh signed-provider check here.
        cancellationLock.lock(); let stillLive = !cancelled; cancellationLock.unlock()
        guard stillLive else { throw NymProtectedFailure.cancelled }
        session.dataTask(with: query).resume()
        guard completed.wait(timeout: .now() + 22) == .success else { throw NymProtectedFailure.proofFailed }
        guard accepted && !failed else { throw NymProtectedFailure.proofFailed }; return bytes
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        accepted = (response as? HTTPURLResponse)?.statusCode == 200 && response.url == proofURL && response.expectedContentLength <= 4096
        if !accepted { failed = true }; completionHandler(accepted ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= 4096 else { failed = true; dataTask.cancel(); return }; bytes.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { failed = true; completionHandler(nil) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // Only normal platform server-trust evaluation; never inject credentials or accept trust.
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { if error != nil { failed = true }; completed.signal() }
}

/// Mode-page entry. No caller-supplied "success" closure, historical profile or cached epoch.
/// Current NoTeam/platform refusal happens before supply/receipt/control-plane/key operations.
@MainActor enum NymModeRouteFactory {
    static func make(protection: BrowserRouteProtection, explicitUserAction: UUID,
                     trustedPackageIdentity: NymCodeSignatureIdentity? = nil, bundle: Bundle = .main) throws -> NymProtectedRouteProvider {
        let gateHash = bundle.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String ?? ""
        try NymProtectedRouteProvider.validateIdentityInputs(team: bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "", identifier: bundle.bundleIdentifier, helperSHA256: gateHash)
        try protection.requireBackendStartupQualification(mode: .nym)
        let identity = try trustedPackageIdentity ?? reviewedIdentity(bundle)
        return NymProtectedRouteProvider(protection: protection, helperSHA256: gateHash, expectedPackageIdentity: identity,
            profile: nil, explicitUserAction: explicitUserAction, bundle: bundle,
            modeSupplier: NymModeRouteSupplier(bundle: bundle, userAction: explicitUserAction))
    }
    private static func reviewedIdentity(_ bundle: Bundle) throws -> NymCodeSignatureIdentity {
        guard let team = bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil,
              bundle.bundleIdentifier == RoutedIsolationMode.nym.bundleIdentifier,
              bundle.bundleURL == Bundle.main.bundleURL else { throw NymProtectedFailure.identityRejected }
        let requirement = "anchor apple generic and identifier \"\(RoutedIsolationMode.nym.bundleIdentifier)\" and certificate leaf[subject.OU] = \"\(team)\""
        var code: SecStaticCode?, rule: SecRequirement?, information: CFDictionary?
        guard SecStaticCodeCreateWithPath(bundle.bundleURL as CFURL, SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(requirement as CFString, SecCSFlags(), &rule) == errSecSuccess, let rule,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), rule) == errSecSuccess,
              SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let information = information as? [String: Any], let hash = information[kSecCodeInfoUnique as String] as? Data,
              information[kSecCodeInfoTeamIdentifier as String] as? String == team,
              information[kSecCodeInfoIdentifier as String] as? String == RoutedIsolationMode.nym.bundleIdentifier else { throw NymProtectedFailure.identityRejected }
        return try .init(identifier: RoutedIsolationMode.nym.bundleIdentifier, codeDirectoryHash: hash.map { String(format: "%02x", $0) }.joined(), teamIdentifier: team)
    }
}

@MainActor final class NymModeRouteSupplier {
    let bundle: Bundle; let userAction: UUID
    init(bundle: Bundle, userAction: UUID) { self.bundle = bundle; self.userAction = userAction }
    #if YNX_PRIVACY_ACCEPTANCE
    var syntheticRunID: String?
    private var syntheticScope: SyntheticTrialScope?
    func bindSyntheticScope(_ scope: SyntheticTrialScope) throws {
        guard let runID = syntheticRunID, scope.noncePrefix == "/ynx-route-probe/" + runID + "/" else { throw NymProtectedFailure.identityRejected }
        syntheticScope = scope
    }
    #endif
    func plannedProfile() throws -> NymModeProfileReceipt.Plan {
        #if YNX_PRIVACY_ACCEPTANCE
        if let runID = syntheticRunID {
            return try NymModeProfileReceipt.planned(in: stateDirectory, expectedProfileID: NymSyntheticProfileIdentity.profileID(runID: runID))
        }
        #endif
        return try NymModeProfileReceipt.planned(in: stateDirectory)
    }
    func proof() throws -> (proof: NymControlledProbe, runID: String, origin: URL) {
        #if YNX_PRIVACY_ACCEPTANCE
        if let runID = syntheticRunID {
            guard let scope = syntheticScope, let origin = scope.origins.first else { throw NymProtectedFailure.proofNotSupplied }
            let url = origin.appendingPathComponent("ynx-route-probe/" + runID + "/proof")
            return try (.init(url: url, responseSHA256: scope.responseSHA256, runID: runID, reviewedOrigin: origin), runID, origin)
        }
        #endif
        guard let originText = bundle.object(forInfoDictionaryKey: "YNXNymProofOrigin") as? String,
              let origin = URL(string: originText),
              let hash = bundle.object(forInfoDictionaryKey: "YNXNymProofResponseSHA256") as? String else { throw NymProtectedFailure.proofNotSupplied }
        let runID = userAction.uuidString.lowercased()
        let url = origin.appendingPathComponent("ynx-route-probe/" + runID + "/proof")
        return try (.init(url: url, responseSHA256: hash, runID: runID, reviewedOrigin: origin), runID, origin)
    }
    var stateDirectory: URL {
        #if YNX_PRIVACY_ACCEPTANCE
        if let runID = syntheticRunID {
            return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/YNX Browser Routes/NymSynthetic/" + runID, isDirectory: true)
        }
        #endif
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/YNX Browser Routes/Nym", isDirectory: true)
    }
}

/// Immutable planned/completed records, never rewriting a profile/key or overwriting a
/// concurrent receipt. A crash between successful official init and completion publication is
/// UNKNOWN and requires reconciliation of that original operation; it cannot replay init.
enum NymModeProfileReceipt {
    struct Plan: Codable, Equatable { let schema: String; let profileID: String; let operation: String }
    struct Complete: Codable { let schema: String; let plannedSHA256: String; let configSHA256: String; let childReaped: Bool; let exitCode: Int32 }
    static func planned(in directory: URL, expectedProfileID: String? = nil) throws -> Plan {
        if let expectedProfileID { try validateID(expectedProfileID) }
        let path = directory.appendingPathComponent("profile-planned.json")
        if let bytes = try readIfPresent(path) {
            let existing = try decodePlan(bytes)
            guard expectedProfileID == nil || existing.profileID == expectedProfileID else { throw NymProtectedFailure.invalidProfileReceipt }
            return existing
        }
        let record = Plan(schema: "YNX_NYM_PROFILE_PLANNED_V1", profileID: expectedProfileID ?? ("ynx-route-bundled-" + UUID().uuidString.lowercased()), operation: UUID().uuidString.lowercased())
        try writeNew(try JSONEncoder().encode(record), to: path); return record
    }
    static func completed(in directory: URL, plan: Plan) throws -> NymDedicatedProfile? {
        guard let bytes = try readIfPresent(directory.appendingPathComponent("profile-complete.json")) else { return nil }
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(object.keys) == ["schema", "plannedSHA256", "configSHA256", "childReaped", "exitCode"] else { throw NymProtectedFailure.invalidProfileReceipt }
        let record = try JSONDecoder().decode(Complete.self, from: bytes)
        guard let plannedBytes = try readIfPresent(directory.appendingPathComponent("profile-planned.json")),
              try decodePlan(plannedBytes) == plan,
              record.schema == "YNX_NYM_PROFILE_COMPLETE_V1", record.plannedSHA256 == hash(plannedBytes),
              record.childReaped, record.exitCode == 0 else { throw NymProtectedFailure.invalidProfileReceipt }
        return try NymDedicatedProfile(id: plan.profileID, configSHA256: record.configSHA256)
    }
    static func publishCompletion(in directory: URL, plan: Plan, config: URL, exit: BackendProcessExit) throws -> NymDedicatedProfile {
        guard exit.childReaped, exit.code == 0, exit.signal == nil,
              let plannedBytes = try readIfPresent(directory.appendingPathComponent("profile-planned.json")),
              try decodePlan(plannedBytes) == plan,
              let configBytes = try readIfPresent(config), configBytes.count <= 1_048_576 else { throw NymProtectedFailure.provisioningUnknown }
        let digest = hash(configBytes)
        let record = Complete(schema: "YNX_NYM_PROFILE_COMPLETE_V1", plannedSHA256: hash(plannedBytes), configSHA256: digest, childReaped: true, exitCode: 0)
        try writeNew(try JSONEncoder().encode(record), to: directory.appendingPathComponent("profile-complete.json"))
        return try NymDedicatedProfile(id: plan.profileID, configSHA256: digest)
    }
    static func decodePlan(_ bytes: Data) throws -> Plan {
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(object.keys) == ["schema", "profileID", "operation"] else { throw NymProtectedFailure.invalidProfileReceipt }
        let record = try JSONDecoder().decode(Plan.self, from: bytes)
        guard record.schema == "YNX_NYM_PROFILE_PLANNED_V1", UUID(uuidString: record.operation) != nil else { throw NymProtectedFailure.invalidProfileReceipt }
        try validateID(record.profileID)
        return record
    }
    static func validateID(_ id: String) throws {
        guard id.range(of: "^ynx-route-bundled-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", options: .regularExpression) != nil else { throw NymProtectedFailure.invalidProfileReceipt }
    }
    static func ensurePrivateDirectory(_ url: URL) throws {
        guard url.isFileURL, url.standardizedFileURL == url else { throw NymProtectedFailure.unsafeJournal }
        var current = URL(fileURLWithPath: "/", isDirectory: true)
        for component in url.pathComponents.dropFirst() {
            current.appendPathComponent(component, isDirectory: true)
            var info = stat()
            if lstat(current.path, &info) != 0 {
                guard errno == ENOENT, mkdir(current.path, 0o700) == 0 else { throw NymProtectedFailure.unsafeJournal }
                guard lstat(current.path, &info) == 0 else { throw NymProtectedFailure.unsafeJournal }
            }
            guard info.st_mode & S_IFMT == S_IFDIR else { throw NymProtectedFailure.unsafeJournal }
        }
        var info = stat()
        guard lstat(url.path, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o777 == 0o700,
              url.resolvingSymlinksInPath() == url else { throw NymProtectedFailure.unsafeJournal }
    }
    static func readIfPresent(_ url: URL) throws -> Data? {
        var info = stat()
        guard lstat(url.path, &info) == 0 else { if errno == ENOENT { return nil }; throw NymProtectedFailure.invalidProfileReceipt }
        guard info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(), info.st_nlink == 1,
              info.st_mode & 0o777 == 0o600, info.st_size >= 0, info.st_size <= 1_048_576 else { throw NymProtectedFailure.invalidProfileReceipt }
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw NymProtectedFailure.invalidProfileReceipt }
        defer { Darwin.close(fd) }
        var actual = stat(); guard fstat(fd, &actual) == 0, actual.st_dev == info.st_dev, actual.st_ino == info.st_ino,
              actual.st_uid == info.st_uid, actual.st_mode == info.st_mode, actual.st_nlink == 1 else { throw NymProtectedFailure.invalidProfileReceipt }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        let bytes = try handle.read(upToCount: 1_048_577) ?? Data()
        guard bytes.count <= 1_048_576, bytes.count == Int(actual.st_size) else { throw NymProtectedFailure.invalidProfileReceipt }; return bytes
    }
    static func writeNew(_ bytes: Data, to url: URL) throws {
        guard bytes.count <= 1_048_576, url.resolvingSymlinksInPath() == url else { throw NymProtectedFailure.unsafeJournal }
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw NymProtectedFailure.ownershipConflict }; defer { Darwin.close(fd) }
        try bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if n < 0 && errno == EINTR { continue }; guard n > 0 else { throw NymProtectedFailure.unsafeJournal }; offset += n
            }
        }
        guard fsync(fd) == 0 else { throw NymProtectedFailure.unsafeJournal }
        let parent = open(url.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else { throw NymProtectedFailure.unsafeJournal }; defer { Darwin.close(parent) }
        guard fsync(parent) == 0 else { throw NymProtectedFailure.unsafeJournal }
    }
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}

private extension NymProtectedRouteProvider {
    static var bootstrapEndpoints: [NymReviewedNetworkPolicy.Endpoint] {
        [.init(purpose: "directoryHTTPS", scheme: "https", host: "validator.nymtech.net", port: 443, addresses: ["92.39.63.14"]),
         .init(purpose: "chainRPC", scheme: "https", host: "rpc.nymtech.net", port: 443, addresses: ["194.182.169.49", "91.92.200.116", "2a04:c43:e00:6f28:400:d8ff:fe00:1483", "2a04:c46:e00:6f28:4b3:68ff:fe00:460"])]
    }
    static var bootstrapSourceHash: String { "596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b" }
    func prepareMode(supplier: NymModeRouteSupplier, supply: BundledNymSupply, expected: UUID) async throws -> (profile: NymDedicatedProfile, input: Inputs) {
        #if YNX_PRIVACY_ACCEPTANCE
        if syntheticFactory != nil {
            let epoch = try await acquireSyntheticEpoch(.directory, expected: expected)
            pendingDirectoryEpoch = epoch
            try supplier.bindSyntheticScope(epoch.authority.scope)
        }
        #endif
        operationStage = .proofResource
        let proof = try supplier.proof() // Missing owned origin is NOT_SUPPLIED, never a generic-site substitute.
        // Require the actually built reviewed-network CLI/callee pin before any control child
        // or profile effect. Directory retrieval never occurs in the blocked Browser Root.
        let capability = NymNumericBootstrapPlan(peers: [], directoryEpoch: 0, directorySHA256: [], receivedAt: Date(), validUntil: Date())
        try capability.requireAttributedDNS(runtimeSHA256: BundledNymSupply.runtimeSHA256)
        try NymModeProfileReceipt.ensurePrivateDirectory(supplier.stateDirectory)
        modeReceiptLease = try NymProfileLease(url: supplier.stateDirectory.appendingPathComponent(".profile-receipt.lock"))
        operationStage = .directory
        let directoryResult = try await auxiliaryOperation(supply: supply, directory: supplier.stateDirectory, expected: expected,
            arguments: ["ynx-reviewed-directory"], maximumOutput: 16_777_216,
            endpoints: Self.bootstrapEndpoints, selection: nil, beforeResume: {})
        guard let envelope = try JSONSerialization.jsonObject(with: directoryResult.bytes) as? [String: Any],
              Set(envelope.keys) == ["schema", "basic", "described", "epoch"], envelope["schema"] as? String == "YNX_NYM_DIRECTORY_V1",
              let basic = envelope["basic"], let described = envelope["described"], let epoch = envelope["epoch"] else { throw NymProtectedFailure.controlPlaneFailed }
        let latest = try NymLatestDirectoryInput(basic: JSONSerialization.data(withJSONObject: basic, options: [.sortedKeys]), described: JSONSerialization.data(withJSONObject: described, options: [.sortedKeys]), epoch: JSONSerialization.data(withJSONObject: epoch, options: [.sortedKeys]), receivedAt: Date())
        let selection = try NymActiveDirectorySelector.select(basic: latest.basic, described: latest.described, epoch: latest.epoch)
        let endpoints = try runtimeEndpoints(latest: latest, selection: selection)
        let peers = endpoints.flatMap { endpoint in endpoint.addresses.map { NymNumericBootstrapPlan.Peer(purpose: .init(rawValue: endpoint.purpose)!, host: $0, port: endpoint.port, transport: IPPROTO_TCP, hostname: endpoint.host) } }
        let numeric = NymNumericBootstrapPlan(peers: peers, directoryEpoch: selection.epoch, directorySHA256: [selection.basicSHA256, selection.describedSHA256, selection.epochSHA256], receivedAt: latest.receivedAt, validUntil: selection.validUntil)
        try numeric.validate(selection: selection, now: Date())
        operationStage = .profile
        let planned = try supplier.plannedProfile()
        let profile: NymDedicatedProfile
        if let complete = try NymModeProfileReceipt.completed(in: supplier.stateDirectory, plan: planned) {
            profile = complete // Config/path/key metadata is subsequently checked by the fixed supply factory.
        } else {
            let intent = supplier.stateDirectory.appendingPathComponent("profile-init-unknown.json")
            if try NymModeProfileReceipt.readIfPresent(intent) != nil { throw NymProtectedFailure.provisioningUnknown }
            let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nym/socks5-clients/" + planned.profileID, isDirectory: true)
            // A foreign/partial profile, even with the right name, is never adopted or reinitialized.
            var original = stat()
            guard lstat(root.path, &original) != 0, errno == ENOENT else { throw NymProtectedFailure.provisioningUnknown }
            try NymModeProfileReceipt.ensurePrivateDirectory(root)
            profileLease = try NymProfileLease(url: root.appendingPathComponent(".ynx-run.lock"))
            try NymModeProfileReceipt.ensurePrivateDirectory(root.appendingPathComponent("config", isDirectory: true))
            try NymModeProfileReceipt.ensurePrivateDirectory(root.appendingPathComponent("data", isDirectory: true))
            let args = ["init", "--id", planned.profileID, "--provider", selection.requester, "--gateway", selection.entryIdentity,
                "--host", "127.0.0.1", "--port", String(port), "--force-tls-gateway", "--enabled-credentials-mode", "false", "--use-reply-surbs", "true", "--output", "json"]
            let result = try await auxiliaryOperation(supply: supply, directory: supplier.stateDirectory, expected: expected,
                arguments: args, maximumOutput: 65_536, endpoints: endpoints, selection: selection, beforeResume: {
                    try NymProvisioningIntent.claimBeforeResume(at: intent, profileID: planned.profileID, operation: UUID(uuidString: planned.operation)!)
                })
            // The unmodified official JSON result is consumed only in memory; no address/key
            // material is emitted into Browser logs or durable operation evidence.
            guard let initialized = try JSONSerialization.jsonObject(with: result.bytes) as? [String: Any],
                  initialized["id"] as? String == planned.profileID, initialized["gateway_id"] as? String == selection.entryIdentity,
                  initialized["version"] as? String == NymRouteDependency.clientVersion,
                  initialized["fallback_listener"] is NSNull else { throw NymProtectedFailure.provisioningUnknown }
            profile = try NymModeProfileReceipt.publishCompletion(in: supplier.stateDirectory, plan: planned, config: root.appendingPathComponent("config/config.toml"), exit: result.exit)
        }
        let checked = try supply.makePlan(profile: profile, latestDirectory: latest, port: port)
        if profileLease == nil { profileLease = try NymProfileLease(url: checked.profileURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(".ynx-run.lock")) }
        _ = try supply.makePlan(profile: profile, latestDirectory: latest, port: port)
        operationStage = .gateway
        try await ensureCurrentGateway(profile: profile, selection: selection, endpoints: endpoints, supplier: supplier, supply: supply, expected: expected)
        // No old ACK or init token is reused for run. Each auxiliary client is already closed
        // and its child actually reaped. A late remote disconnect causes the next begin to fail
        // closed; the completed receipt prevents repeating init on that failure.
        return (profile, (latest, numeric, proof.proof, proof.runID, proof.origin))
    }
    func runtimeEndpoints(latest: NymLatestDirectoryInput, selection: NymActiveDirectorySelection) throws -> [NymReviewedNetworkPolicy.Endpoint] {
        guard let basic = try JSONSerialization.jsonObject(with: latest.basic) as? [String: Any],
              let page = basic["nodes"] as? [String: Any], let rows = page["data"] as? [[String: Any]],
              let described = try JSONSerialization.jsonObject(with: latest.described) as? [String: Any], let details = described["data"] as? [[String: Any]] else { throw NymProtectedFailure.invalidNumericPlan }
        let entries = rows.filter { $0["ed25519_identity_pubkey"] as? String == selection.entryIdentity }
        guard entries.count == 1, let node = entries.first, let id = node["node_id"] as? UInt32,
              node["role"] as? String == "EntryGateway", let entry = node["entry"] as? [String: Any],
              let hostname = entry["hostname"] as? String, let wssPort = entry["wss_port"] as? UInt16,
              let ips = node["ip_addresses"] as? [String], !ips.isEmpty, ips.allSatisfy(NymNumericBootstrapPlan.numeric) else { throw NymProtectedFailure.invalidNumericPlan }
        let matched = details.filter { $0["node_id"] as? UInt32 == id }
        guard matched.count == 1, let description = matched[0]["description"] as? [String: Any],
              let host = description["host_information"] as? [String: Any], let keys = host["keys"] as? [String: Any],
              keys["ed25519"] as? String == selection.entryIdentity, host["hostname"] as? String == hostname,
              let describedIPs = host["ip_address"] as? [String], Set(ips) == Set(describedIPs) else { throw NymProtectedFailure.invalidNumericPlan }
        return Self.bootstrapEndpoints + [.init(purpose: "gatewayWSS", scheme: "wss", host: hostname, port: wssPort, addresses: ips)]
    }
    func auxiliaryOperation(supply: BundledNymSupply, directory: URL, expected: UUID, arguments: [String], maximumOutput: Int,
                            endpoints: [NymReviewedNetworkPolicy.Endpoint], selection: NymActiveDirectorySelection?,
                            gatewayAction: (journal: NymGatewayActionJournal, operation: UUID)? = nil,
                            beforeResume: () throws -> Void) async throws -> (bytes: Data, exit: BackendProcessExit) {
        try requireAuxiliary(expected)
        let owner: BrowserRouteProtection
        let prep: RoutedRootPreparation
        #if YNX_PRIVACY_ACCEPTANCE
        var trialEpoch: NymSyntheticEpoch?
        if syntheticFactory != nil {
            let purpose = try NymSyntheticEpochPurpose(arguments: arguments)
            let epoch: NymSyntheticEpoch
            if purpose == .directory, let pending = pendingDirectoryEpoch { epoch = pending; pendingDirectoryEpoch = nil }
            else { epoch = try await acquireSyntheticEpoch(purpose, expected: expected) }
            trialEpoch = epoch; owner = epoch.protection
            prep = try await owner.beginBackendPreparation(qualifiedTrial: epoch.authority)
        } else {
            owner = try BrowserRouteProtection(mode: .nym, onLeaseLost: { [weak self] _ in self?.fence(.cancelled) })
            auxiliaryProtections.append(owner) // Cancellation cannot orphan a suspended begin.
            prep = try await owner.beginBackendPreparation()
        }
        #else
        owner = try BrowserRouteProtection(mode: .nym, onLeaseLost: { [weak self] _ in self?.fence(.cancelled) })
        auxiliaryProtections.append(owner)
        prep = try await owner.beginBackendPreparation()
        #endif
        if !auxiliaryProtections.contains(where: { $0 === owner }) { auxiliaryProtections.append(owner) }
        if !auxiliaryPreparations.contains(where: { $0 === prep }) { auxiliaryPreparations.append(prep) }
        try requireAuxiliary(expected)
        let now = UInt64(Date().timeIntervalSince1970)
        let policy = NymReviewedNetworkPolicy(runID: prep.configuration.runID, stage: selection == nil ? "directory-bootstrap" : "route-runtime", issuedAt: now,
            expiresAt: selection.map { UInt64($0.validUntil.timeIntervalSince1970) } ?? now + 120,
            directoryEpoch: selection?.epoch, directorySHA256: selection.map { [$0.basicSHA256, $0.describedSHA256, $0.epochSHA256] }, entryIdentity: selection?.entryIdentity,
            bootstrapSourceSHA256: selection == nil ? Self.bootstrapSourceHash : nil, endpoints: endpoints)
        let policyBytes = try policy.bytes(), policyURL = directory.appendingPathComponent("network-" + prep.configuration.epoch.uuidString.lowercased() + ".json")
        try NymModeProfileReceipt.writeNew(policyBytes, to: policyURL)
        let gate = try OwnedBackendStartGate(helperExecutable: bundle.bundleURL.appendingPathComponent(OwnedBackendStartGate.helperRelativePath), helperSHA256: gateSHA256, preparation: prep, directory: directory.appendingPathComponent("control-gate-" + prep.configuration.epoch.uuidString.lowercased()))
        owner.trackBackendGate(gate); attempted.append(gate); cleanup = .unknown
        let args = ["--no-banner", "--ynx-reviewed-network", policyURL.path, "--ynx-reviewed-network-sha256", Self.hash(policyBytes), "--ynx-reviewed-run-id", prep.configuration.runID] + arguments
        let identity = try await gate.prepare(specification: .init(executable: supply.executable, executableSHA256: BundledNymSupply.runtimeSHA256, codeRequirement: BundledNymSupply.runtimeRequirement,
            arguments: args, environment: ["PATH": "/usr/bin:/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path], keepStandardInputOpen: false, output: .standardOutput,
            outputCaptureLimit: maximumOutput))
        try requireAuxiliary(expected)
        let pin = try NymProtectedGraph.Pin.decode(identity.processPinJSON, executable: supply.executable, sha256: BundledNymSupply.runtimeSHA256, requirement: BundledNymSupply.runtimeRequirement)
        let root = try RoutedOwnAuditToken.copy()
        guard Self.hash(root) == prep.receipt?.rootAuditTokenSHA256 else { throw NymProtectedFailure.identityRejected }
        let rootHex = root.map { String(format: "%02x", $0) }.joined()
        let destinations = endpoints.flatMap { endpoint in endpoint.addresses.map { ["host": $0, "port": endpoint.port, "transport": IPPROTO_TCP] as [String: Any] } }
        let pinObject = try JSONSerialization.jsonObject(with: identity.processPinJSON)
        let review: [String: Any] = ["entryOwner": pinObject, "entries": [["host": "127.0.0.1", "port": port, "transport": IPPROTO_TCP]],
            "backends": [["role": "nym", "process": pinObject, "responsibleAppTokens": [rootHex, pin.auditTokenHex], "destinations": destinations, "listeningEntries": []]]]
        let ack = try await owner.enrollBootstrapGraph(review: JSONSerialization.data(withJSONObject: review, options: [.sortedKeys])); try requireAuxiliary(expected)
        if let selection { guard Date() < selection.validUntil else { throw NymProtectedFailure.staleNumericPlan } }
        try beforeResume() // Durable UNKNOWN before the first possible official init side effect.
        if let action = gatewayAction {
            pendingGatewayEffects.append(.init(journal: action.journal, operation: action.operation, gate: gate, preparation: prep))
        }
        try await gate.resume(after: ack, lease: try owner.bootstrapControlLease); try requireAuxiliary(expected)
        let outputIdentity = try NymOwnedOutputIdentity(fileDescriptor: gate.backendOutput.fileDescriptor)
        let fd = outputIdentity.fileDescriptor, flags = fcntl(fd, F_GETFL)
        guard flags >= 0, fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0 else { throw NymProtectedFailure.backendExited }
        var output = Data(); let deadline = ContinuousClock.now.advanced(by: .seconds(90))
        func drain() throws {
            while true {
                try outputIdentity.requireCurrent()
                var buffer = [UInt8](repeating: 0, count: 8192); let n = read(fd, &buffer, buffer.count)
                if n > 0 { guard output.count + n <= maximumOutput else { throw NymProtectedFailure.controlPlaneFailed }; output.append(contentsOf: buffer.prefix(n)); continue }
                if n == 0 || errno == EAGAIN || errno == EWOULDBLOCK { return }
                if errno != EINTR { throw NymProtectedFailure.controlPlaneFailed }
            }
        }
        while ContinuousClock.now < deadline {
            try requireAuxiliary(expected); guard try owner.bootstrapControlLease.phase == .blocked else { throw NymProtectedFailure.cancelled }
            try drain()
            if let exit = try await gate.poll() {
                try requireAuxiliary(expected)
                guard try owner.bootstrapControlLease.phase == .blocked else { throw NymProtectedFailure.controlLeaseLost }
                guard ContinuousClock.now < deadline else { throw NymProtectedFailure.bootstrapTimedOut }
                try drain()
                guard exit.childReaped, exit.code == 0, exit.signal == nil else { throw NymProtectedFailure.provisioningUnknown }
                // Retiring an auxiliary epoch must confirm its original helper/FD cleanup too,
                // before a successor epoch or a durable effect-completion record can exist.
                await gate.stop()
                if firstGateStopFailure == nil { firstGateStopFailure = gate.stopFailure }
                guard Self.hasConfirmedGateCleanup(receipt: exit, preparedPID: gate.prepared?.pid,
                    cleanupChildPID: gate.cleanupChildPID, helperCleanupConfirmed: gate.cleanupConfirmed) else { throw NymProtectedFailure.cleanupUnconfirmed }
                try requireAuxiliary(expected)
                #if YNX_PRIVACY_ACCEPTANCE
                if let trialEpoch { retireSyntheticEpoch(trialEpoch) }
                #endif
                owner.close(); prep.close() // Entire operation retired, never an in-place dead-token edit.
                _ = try await RootClosureObserver.awaitClosed(preparation: prep)
                observedRootClosures.insert(prep.configuration.epoch)
                try requireAuxiliary(expected)
                // Exit0 proves neither EOF nor complete JSON. Keep the original exit/intent
                // for reconciliation if this fails; never consume a truncated successful body.
                try gate.requireCompleteOutputCapture()
                return (output, exit)
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NymProtectedFailure.bootstrapTimedOut
    }
    func requireAuxiliary(_ expected: UUID) throws {
        try Task.checkCancellation(); guard generation == expected, phase == .starting else { throw NymProtectedFailure.cancelled }
    }
    func ensureCurrentGateway(profile: NymDedicatedProfile, selection: NymActiveDirectorySelection, endpoints: [NymReviewedNetworkPolicy.Endpoint], supplier: NymModeRouteSupplier, supply: BundledNymSupply, expected: UUID) async throws {
        func inspect() async throws -> (state: NymModeGatewayState, bytes: Data, exit: BackendProcessExit) {
            let result = try await auxiliaryOperation(supply: supply, directory: supplier.stateDirectory, expected: expected,
                arguments: ["list-gateways", "--id", profile.id, "--output", "json"], maximumOutput: 1_048_576,
                endpoints: endpoints, selection: selection, beforeResume: {})
            return (try NymModeGatewayState.decode(result.bytes, expectedIdentity: selection.entryIdentity), result.bytes, result.exit)
        }
        let inspection = try await inspect(), current = inspection.state
        guard let gateway = endpoints.first(where: { $0.purpose == "gatewayWSS" }) else { throw NymProtectedFailure.invalidNumericPlan }
        let journal = try NymGatewayActionJournal(directory: supplier.stateDirectory, profileID: profile.id, gatewayIdentity: selection.entryIdentity)
        if current.registered {
            try current.validateEndpoint(host: gateway.host, port: gateway.port)
            if current.active {
                try journal.reconcileActive(current, readback: inspection.bytes, exit: inspection.exit, host: gateway.host, port: gateway.port)
                return
            }
        }
        // A new explicit user action may revisit a successfully completed gateway. An old
        // unresolved intent, including legacy records without a real exit receipt, still blocks.
        try journal.requireResolved()
        let args = current.registered
            ? ["switch-gateway", "--id", profile.id, "--gateway-id", selection.entryIdentity]
            : ["add-gateway", "--id", profile.id, "--gateway-id", selection.entryIdentity, "--force-tls-gateway", "--output", "json"]
        let effect = try await auxiliaryOperation(supply: supply, directory: supplier.stateDirectory, expected: expected,
            arguments: args, maximumOutput: 65_536, endpoints: endpoints, selection: selection,
            gatewayAction: (journal, userAction), beforeResume: {
                try journal.claim(operation: userAction)
            })
        try requireAuxiliary(expected)
        try journal.recordEffectExit(operation: userAction, exit: effect.exit)
        let observed = try await inspect()
        try journal.reconcileActive(observed.state, readback: observed.bytes, exit: observed.exit, host: gateway.host, port: gateway.port)
        try journal.requireResolved()
    }
}

/// Private no-replay history, never a network/NE permission. Intents remain immutable. Each
/// explicit action has its own exit and official-readback reconciliation records, so a later
/// legitimate A -> B -> A switch does not mistake a historical completed A action for UNKNOWN.
struct NymGatewayActionJournal {
    let directory: URL, profileID: String, gatewaySHA256: String
    private let gatewayIdentity: String
    private var prefix: String { "gateway-" + gatewaySHA256 }
    private struct Terminal: Codable {
        let schema: String, profileID: String, operation: String, intentSHA256: String, gatewaySHA256: String
        let pid: Int32, exitCode: Int32
    }
    private struct Reconciled: Codable {
        let schema: String, profileID: String, operation: String, intentSHA256: String, terminalSHA256: String
        let gatewaySHA256: String, readbackSHA256: String, endpointSHA256: String
        let readbackPID: Int32
    }
    init(directory: URL, profileID: String, gatewayIdentity: String) throws {
        try NymModeProfileReceipt.validateID(profileID)
        _ = try NymModeGatewayState.publicIdentityBytes(gatewayIdentity)
        self.directory = directory; self.profileID = profileID
        self.gatewayIdentity = gatewayIdentity
        gatewaySHA256 = Self.hash(Data(gatewayIdentity.utf8))
    }
    private func actionURL(_ operation: UUID) -> URL {
        directory.appendingPathComponent(prefix + "-" + operation.uuidString.lowercased() + "-unknown.json")
    }
    private func sibling(_ intent: URL, _ suffix: String) -> URL {
        directory.appendingPathComponent(String(intent.lastPathComponent.dropLast("unknown.json".count)) + suffix + ".json")
    }
    private func intents() throws -> [URL] {
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        guard names.count <= 4096 else { throw NymProtectedFailure.unsafeJournal }
        let selected = try names.filter { name in
            guard name.hasPrefix(prefix + "-"), name.hasSuffix("-unknown.json") else { return false }
            if name == prefix + "-unknown.json" { return true } // Original immutable legacy intent.
            let operation = String(name.dropFirst((prefix + "-").count).dropLast("-unknown.json".count))
            guard let uuid = UUID(uuidString: operation), uuid.uuidString.lowercased() == operation else { throw NymProtectedFailure.unsafeJournal }
            return true
        }
        guard selected.count <= 128 else { throw NymProtectedFailure.unsafeJournal }
        return selected.sorted().map { directory.appendingPathComponent($0) }
    }
    private func intent(_ url: URL) throws -> (NymProvisioningIntent.Record, Data) {
        guard let bytes = try NymModeProfileReceipt.readIfPresent(url),
              let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(object.keys) == ["schema", "profileID", "operation", "state"] else { throw NymProtectedFailure.unsafeJournal }
        let record = try JSONDecoder().decode(NymProvisioningIntent.Record.self, from: bytes)
        guard record.schema == "YNX_NYM_PROVISIONING_INTENT_V1", record.profileID == profileID, record.state == "UNKNOWN",
              let operation = UUID(uuidString: record.operation), operation.uuidString.lowercased() == record.operation,
              url.lastPathComponent == prefix + "-unknown.json" || url == actionURL(operation) else { throw NymProtectedFailure.unsafeJournal }
        return (record, bytes)
    }
    private func terminal(_ url: URL, record: NymProvisioningIntent.Record, bytes: Data) throws -> Data? {
        guard let saved = try NymModeProfileReceipt.readIfPresent(sibling(url, "effect-exited")) else { return nil }
        guard let object = try JSONSerialization.jsonObject(with: saved) as? [String: Any],
              Set(object.keys) == ["schema", "profileID", "operation", "intentSHA256", "gatewaySHA256", "pid", "exitCode"] else { throw NymProtectedFailure.unsafeJournal }
        let value = try JSONDecoder().decode(Terminal.self, from: saved)
        guard value.schema == "YNX_NYM_GATEWAY_EFFECT_EXIT_V1", value.profileID == profileID,
              value.operation == record.operation, value.intentSHA256 == Self.hash(bytes), value.gatewaySHA256 == gatewaySHA256,
              value.pid > 1, value.exitCode == 0 else { throw NymProtectedFailure.unsafeJournal }
        return saved
    }
    private func resolved(_ url: URL, record: NymProvisioningIntent.Record, bytes: Data) throws -> Bool {
        guard let saved = try NymModeProfileReceipt.readIfPresent(sibling(url, "reconciled")) else { return false }
        guard let terminal = try terminal(url, record: record, bytes: bytes) else { throw NymProtectedFailure.unsafeJournal }
        guard let object = try JSONSerialization.jsonObject(with: saved) as? [String: Any],
              Set(object.keys) == ["schema", "profileID", "operation", "intentSHA256", "terminalSHA256", "gatewaySHA256", "readbackSHA256", "endpointSHA256", "readbackPID"] else { throw NymProtectedFailure.unsafeJournal }
        let value = try JSONDecoder().decode(Reconciled.self, from: saved)
        guard value.schema == "YNX_NYM_GATEWAY_RECONCILED_V1", value.profileID == profileID, value.operation == record.operation,
              value.intentSHA256 == Self.hash(bytes), value.terminalSHA256 == Self.hash(terminal), value.gatewaySHA256 == gatewaySHA256,
              value.readbackPID > 1, [value.readbackSHA256, value.endpointSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else { throw NymProtectedFailure.unsafeJournal }
        return true
    }
    func requireResolved() throws {
        for path in try intents() {
            let (record, bytes) = try intent(path)
            guard try resolved(path, record: record, bytes: bytes) else { throw NymProtectedFailure.provisioningUnknown }
        }
    }
    func claim(operation: UUID) throws {
        try requireResolved()
        try NymProvisioningIntent.claimBeforeResume(at: actionURL(operation), profileID: profileID, operation: operation)
    }
    // Caller reaches this only after auxiliaryOperation confirms the original exit, Gate
    // cleanup and actual RootClosureObserver receipt. An existing record is never overwritten.
    func recordEffectExit(operation: UUID, exit: BackendProcessExit) throws {
        guard exit.childReaped, exit.pid > 1, exit.code == 0, exit.signal == nil else { throw NymProtectedFailure.provisioningUnknown }
        let path = actionURL(operation), (record, bytes) = try intent(path)
        if let existing = try terminal(path, record: record, bytes: bytes) {
            guard try JSONDecoder().decode(Terminal.self, from: existing).pid == exit.pid else { throw NymProtectedFailure.unsafeJournal }
            return // Idempotent publication of the exact original exit; never another process.
        }
        let value = Terminal(schema: "YNX_NYM_GATEWAY_EFFECT_EXIT_V1", profileID: profileID, operation: record.operation,
            intentSHA256: Self.hash(bytes), gatewaySHA256: gatewaySHA256, pid: exit.pid, exitCode: 0)
        try NymModeProfileReceipt.writeNew(try JSONEncoder().encode(value), to: sibling(path, "effect-exited"))
    }
    func reconcileActive(_ state: NymModeGatewayState, readback: Data, exit: BackendProcessExit, host: String, port: UInt16) throws {
        guard exit.childReaped, exit.pid > 1, exit.code == 0, exit.signal == nil, state.registered, state.active else { throw NymProtectedFailure.provisioningUnknown }
        let decoded = try NymModeGatewayState.decode(readback, expectedIdentity: gatewayIdentity)
        guard decoded.registered == state.registered, decoded.active == state.active,
              decoded.endpoint == state.endpoint, decoded.fallback == state.fallback else { throw NymProtectedFailure.invalidProfileReceipt }
        try state.validateEndpoint(host: host, port: port)
        for path in try intents() {
            let (record, bytes) = try intent(path)
            if try resolved(path, record: record, bytes: bytes) { continue }
            // Readback alone cannot fabricate the missing original process receipt, including
            // legacy intents or crashes before durable effect-exit publication. Preserve UNKNOWN.
            guard let terminal = try terminal(path, record: record, bytes: bytes) else { continue }
            let value = Reconciled(schema: "YNX_NYM_GATEWAY_RECONCILED_V1", profileID: profileID, operation: record.operation,
                intentSHA256: Self.hash(bytes), terminalSHA256: Self.hash(terminal), gatewaySHA256: gatewaySHA256,
                readbackSHA256: Self.hash(readback), endpointSHA256: Self.hash(Data((state.endpoint ?? "").utf8)), readbackPID: exit.pid)
            try NymModeProfileReceipt.writeNew(try JSONEncoder().encode(value), to: sibling(path, "reconciled"))
        }
    }
    private static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}

struct NymModeGatewayState {
    let registered: Bool; let active: Bool; let endpoint: String?; let fallback: String?
    static func decode(_ bytes: Data, expectedIdentity: String) throws -> Self {
        guard bytes.count <= 1_048_576, let rows = try JSONSerialization.jsonObject(with: bytes) as? [[String: Any]], rows.count <= 4096 else { throw NymProtectedFailure.invalidProfileReceipt }
        let expected = try publicIdentityBytes(expectedIdentity)
        var matches: [[String: Any]] = []
        for row in rows {
            guard let raw = row["identity"] as? [Any], raw.count == 32 else { throw NymProtectedFailure.invalidProfileReceipt }
            var identity: [UInt8] = []
            for value in raw {
                guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue == Double(number.uint8Value) else { throw NymProtectedFailure.invalidProfileReceipt }
                identity.append(number.uint8Value)
            }
            if identity == expected { matches.append(row) }
        }
        guard matches.count <= 1 else { throw NymProtectedFailure.invalidProfileReceipt }
        guard let row = matches.first else { return .init(registered: false, active: false, endpoint: nil, fallback: nil) }
        guard row["typ"] as? String == "remote", let active = row["active"] as? NSNumber,
              CFGetTypeID(active) == CFBooleanGetTypeID(),
              let endpoint = row["endpoint"] as? String, endpoint.utf8.count <= 4096,
              let fallback = row["fallback_endpoint"], fallback is NSNull || fallback is String else { throw NymProtectedFailure.invalidProfileReceipt }
        return .init(registered: true, active: active.boolValue, endpoint: endpoint, fallback: fallback as? String)
    }
    func validateEndpoint(host: String, port: UInt16) throws {
        guard registered, fallback == nil, let endpoint, let value = URLComponents(string: endpoint),
              value.scheme == "wss", value.host == host, value.port == Int(port), value.user == nil, value.password == nil,
              ["", "/"].contains(value.path), value.query == nil, value.fragment == nil else { throw NymProtectedFailure.invalidProfileReceipt }
    }
    /// Decode the selected *public* directory identity only, to compare the official CLI's
    /// serde32-byte array. This never handles private keys or grants cryptographic authority.
    static func publicIdentityBytes(_ value: String) throws -> [UInt8] {
        guard value.range(of: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", options: .regularExpression) != nil else { throw NymProtectedFailure.invalidProfileReceipt }
        let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
        var bytes = [UInt8](repeating: 0, count: 32)
        for character in value {
            guard let index = alphabet.firstIndex(of: character) else { throw NymProtectedFailure.invalidProfileReceipt }
            var carry = index
            for i in stride(from: 31, through: 0, by: -1) { carry += Int(bytes[i]) * 58; bytes[i] = UInt8(carry & 255); carry >>= 8 }
            guard carry == 0 else { throw NymProtectedFailure.invalidProfileReceipt }
        }
        let leading = value.prefix(while: { $0 == "1" }).count
        guard leading == (bytes.firstIndex(where: { $0 != 0 }) ?? 32) else { throw NymProtectedFailure.invalidProfileReceipt }
        return bytes
    }
}

#if YNX_PRIVACY_ACCEPTANCE
/// Stage names choose the existing official operation, never a permission or arbitrary argv.
enum NymSyntheticEpochPurpose: Equatable {
    case directory, initializeProfile, listGateways, addGateway, switchGateway, runtime
    init(arguments: [String]) throws {
        switch arguments.first {
        case "ynx-reviewed-directory": self = .directory
        case "init": self = .initializeProfile
        case "list-gateways": self = .listGateways
        case "add-gateway": self = .addGateway
        case "switch-gateway": self = .switchGateway
        default: throw NymProtectedFailure.controlPlaneFailed
        }
    }
}
@MainActor struct NymSyntheticEpoch {
    let protection: BrowserRouteProtection
    let authority: SyntheticTrialAuthority
    let manifestURL: URL
    init(protection: BrowserRouteProtection, authority: SyntheticTrialAuthority, manifestURL: URL) throws {
        try SyntheticTrialAuthority.signingPreflight()
        guard authority.binding.mode == .nym else { throw NymProtectedFailure.identityRejected }
        _ = try authority.requireQualification()
        try protection.requireSyntheticTrialAuthority(authority)
        guard manifestURL.isFileURL, manifestURL.standardizedFileURL == manifestURL else { throw NymProtectedFailure.proofNotSupplied }
        self.protection = protection; self.authority = authority; self.manifestURL = manifestURL
    }
}
typealias NymSyntheticEpochFactory = @MainActor (NymSyntheticEpochPurpose) async throws -> NymSyntheticEpoch

/// Deterministic dedicated vendor identity for the authenticated logical synthetic profile.
/// This is not a key derivation: official init still creates its own random keys exactly once.
enum NymSyntheticProfileIdentity {
    static func profileID(runID: String) throws -> String {
        guard runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil else { throw NymProtectedFailure.invalidProfileReceipt }
        let hex = SHA256.hash(data: Data(("YNX_NYM_SYNTHETIC_PROFILE_V1|" + runID).utf8)).map { String(format: "%02x", $0) }.joined()
        let h = Array(hex.prefix(32))
        let uuid = String(h[0..<8]) + "-" + String(h[8..<12]) + "-" + String(h[12..<16]) + "-" + String(h[16..<20]) + "-" + String(h[20..<32])
        return "ynx-route-bundled-" + uuid
    }
}
@MainActor extension NymProtectedRouteProvider {
    convenience init(syntheticRunID: String, explicitUserAction: UUID, epochFactory: @escaping NymSyntheticEpochFactory,
                     helperSHA256: String, expectedPackageIdentity: NymCodeSignatureIdentity, bundle: Bundle = .main) throws {
        try SyntheticTrialAuthority.signingPreflight() // Before parsing proposed scope/profile or invoking the factory.
        _ = try NymSyntheticProfileIdentity.profileID(runID: syntheticRunID)
        let supplier = NymModeRouteSupplier(bundle: bundle, userAction: explicitUserAction)
        supplier.syntheticRunID = syntheticRunID
        self.init(helperSHA256: helperSHA256, expectedPackageIdentity: expectedPackageIdentity, profile: nil,
                  explicitUserAction: explicitUserAction, bundle: bundle, modeSupplier: supplier)
        syntheticFactory = epochFactory; self.syntheticRunID = syntheticRunID
    }
    private func acquireSyntheticEpoch(_ purpose: NymSyntheticEpochPurpose, expected: UUID) async throws -> NymSyntheticEpoch {
        try SyntheticTrialAuthority.signingPreflight()
        try requireAuxiliary(expected)
        guard let factory = syntheticFactory, let runID = syntheticRunID,
              syntheticEpochs.allSatisfy({ observedRootClosures.contains($0.authority.configuration.epoch) }) else { throw NymProtectedFailure.cleanupUnconfirmed }
        let epoch = try await factory(purpose)
        // Retain the original owner even if a cancellation or malformed successor is discovered.
        syntheticEpochs.append(epoch)
        auxiliaryProtections.append(epoch.protection); auxiliaryPreparations.append(epoch.authority.preparation)
        try requireAuxiliary(expected)
        let bound = epoch.authority.binding
        guard bound.mode == .nym, bound.runID == runID, bound.profileID == "synthetic-" + runID,
              bound.profileSHA256 == Self.hash(Data(bound.profileID.utf8)),
              epoch.authority.scope.noncePrefix == "/ynx-route-probe/" + runID + "/",
              Set(syntheticEpochs.map { $0.authority.configuration.epoch }).count == syntheticEpochs.count else { throw NymProtectedFailure.identityRejected }
        try epoch.protection.requireSyntheticTrialAuthority(epoch.authority)
        _ = try epoch.authority.requireQualification()
        if let original = syntheticReference {
            guard bound.runID == original.runID, bound.profileID == original.profileID, bound.profileSHA256 == original.profileSHA256,
                  bound.rootAuditTokenSHA256 == original.rootAuditTokenSHA256, bound.manifestSHA256 == original.manifestSHA256,
                  bound.bootstrapSHA256 == original.bootstrapSHA256, bound.executableSHA256 == original.executableSHA256 else { throw NymProtectedFailure.identityRejected }
        } else { syntheticReference = bound }
        let id = epoch.authority.configuration.epoch
        activeSyntheticEpochs.insert(id)
        try epoch.authority.installRevocationHandler { [weak self] in
            guard let self, self.activeSyntheticEpochs.contains(id), self.generation == expected else { return }
            self.fence(.cancelled)
        }
        return epoch
    }
    private func requireSyntheticProofRegistration() async throws {
        if let pending = syntheticProofRefresh { try await pending.value; return }
        guard let registration = syntheticProofRegistration else { throw NymProtectedFailure.proofFailed }
        let pending = Task { @MainActor in try Task.checkCancellation(); try await registration.requireLive() }
        syntheticProofRefresh = pending
        defer { syntheticProofRefresh = nil }
        try await pending.value
    }
    private func retireSyntheticEpoch(_ epoch: NymSyntheticEpoch) {
        activeSyntheticEpochs.remove(epoch.authority.configuration.epoch)
        epoch.authority.revoke()
    }
}
@MainActor extension NymModeRouteFactory {
    static func makeSynthetic(runID: String, explicitUserAction: UUID, epochFactory: @escaping NymSyntheticEpochFactory,
                              bundle: Bundle = .main) throws -> NymProtectedRouteProvider {
        try SyntheticTrialAuthority.signingPreflight()
        let identity = try reviewedIdentity(bundle)
        return try NymProtectedRouteProvider(syntheticRunID: runID, explicitUserAction: explicitUserAction,
            epochFactory: epochFactory, helperSHA256: bundle.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String ?? "",
            expectedPackageIdentity: identity, bundle: bundle)
    }
}
#endif

#if YNX_PRIVACY_ACCEPTANCE
/// Informational binding bytes only: the independent signed child must obtain its own
/// opaque live capability from the provider using the XPC connection's actual audit token.
enum NymSyntheticProofHelper {
    static let flag = "--ynx-nym-synthetic-proof-v1"
    static func claims(_ arguments: [String]) -> Bool { arguments.dropFirst().contains { $0.hasPrefix("--ynx-nym-synthetic-proof") } }
    static func arguments(binding: SyntheticTrialBinding) throws -> [String] {
        guard binding.mode == .nym else { throw NymProtectedFailure.identityRejected }
        return [flag, try JSONEncoder().encode(binding).base64EncodedString()]
    }
    static func parseBinding(_ arguments: [String]) throws -> SyntheticTrialBinding {
        guard arguments.count == 3, arguments[1] == flag, arguments[2].utf8.count <= 8192,
              let bytes = Data(base64Encoded: arguments[2]), bytes.count <= 4096 else { throw NymProtectedFailure.proofFailed }
        let binding = try JSONDecoder().decode(SyntheticTrialBinding.self, from: bytes)
        guard binding.mode == .nym, binding.runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              UUID(uuidString: binding.epoch) != nil, binding.profileID == "synthetic-" + binding.runID,
              binding.profileSHA256 == SHA256.hash(data: Data(binding.profileID.utf8)).map({ String(format: "%02x", $0) }).joined(),
              [binding.rootAuditTokenSHA256, binding.manifestSHA256, binding.bootstrapSHA256, binding.executableSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else { throw NymProtectedFailure.proofFailed }
        return binding
    }
    static func auditTokenBytes(hex: String) throws -> Data {
        guard hex.count == 64, hex.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NymProtectedFailure.identityRejected }
        let chars = Array(hex); var bytes = Data()
        for i in stride(from: 0, to: chars.count, by: 2) {
            guard let value = UInt8(String(chars[i...i+1]), radix: 16) else { throw NymProtectedFailure.identityRejected }
            bytes.append(value)
        }
        return bytes
    }
    static func preflight(bundle: Bundle) throws {
        let team = bundle.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? ""
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw NymProtectedFailure.signingNotConfigured }
        guard bundle.bundleURL == Bundle.main.bundleURL, bundle.bundleIdentifier == NymProofHelper.identifier,
              bundle.object(forInfoDictionaryKey: "YNXNymProofHelper") as? Bool == true,
              bundle.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool == true,
              bundle.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") == nil,
              bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil,
              let executable = bundle.executableURL,
              executable.standardizedFileURL == URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL else { throw NymProtectedFailure.wrongApplication }
        var code: SecCode?, requirement: SecRequirement?
        let rule = "anchor apple generic and identifier \"\(NymProofHelper.identifier)\" and certificate leaf[subject.OU] = \"\(team)\""
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(rule as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              SecCodeCheckValidity(code, SecCSFlags(), requirement) == errSecSuccess else { throw NymProtectedFailure.identityRejected }
    }
    static func run(arguments: [String], bundle: Bundle) -> Int32 {
        do {
            try preflight(bundle: bundle) // Actual helper Team/role precedes even informational argv parsing.
            let binding = try parseBinding(arguments)
            let authority = try SyntheticProofChildAuthority.begin(binding: binding)
            defer { authority.revoke() }
            let scope = authority.scope
            guard scope.origins.count == 2, let origin = scope.origins.first,
                  scope.routePort >= 1024, scope.proofURL.scheme == "https",
                  scope.proofURL.host == origin.host, scope.proofURL.query == "probe=baseline-https" else { throw NymProtectedFailure.proofFailed }
            var components = URLComponents(url: scope.proofURL, resolvingAgainstBaseURL: false)
            components?.query = nil
            guard let unqueried = components?.url else { throw NymProtectedFailure.proofFailed }
            let proof = try NymControlledProbe(url: unqueried, responseSHA256: scope.responseSHA256, runID: binding.runID, reviewedOrigin: origin)
            let transfer = NymProofTransfer(port: scope.routePort, proofURL: scope.proofURL)
            authority.installRevocationHandler { transfer.cancel() }
            let body = try transfer.perform { try authority.authorize(request: $0) }
            try authority.requireLive(); try proof.validateResponse(body)
            let receipt = try JSONSerialization.data(withJSONObject: ["schema": "YNX_NYM_HTTPS_PROOF_V1", "body": body.base64EncodedString()], options: [.sortedKeys])
            try FileHandle.standardOutput.write(contentsOf: receipt + Data([10]))
            // Keep the registered token pinned while idle, and continue actual signed lease
            // checks. EOF/one byte/parent revoke cannot become an automatic request or retry.
            while true {
                try authority.requireLive()
                var poller = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN | POLLHUP | POLLERR), revents: 0)
                let result = poll(&poller, 1, 100)
                if result < 0 { if errno == EINTR { continue }; throw NymProtectedFailure.cancelled }
                if result > 0 {
                    var byte: UInt8 = 0; let n = read(STDIN_FILENO, &byte, 1)
                    if n == 0 { return 0 }
                    if n > 0 { return 78 }
                    if errno != EAGAIN && errno != EINTR { return 78 }
                }
            }
        } catch { return 78 }
    }
}
#endif
