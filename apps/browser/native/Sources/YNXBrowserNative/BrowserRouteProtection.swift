import AppKit
import CryptoKit
import WebKit
import YNXBrowserCore

/// A connected lease is scoped to the last acknowledged local proxy, not every loopback port.
struct ReviewedBrowserRouteEntry: Equatable {
    let endpoint: PrivacyRouteEndpoint
    private let acknowledgement: BackendGraphAcknowledgement
    private let controlGeneration: UInt64
    private let blockedSequence: UInt64

    private struct Review: Decodable {
        struct Owner: Decodable { let auditTokenHex: String }
        struct Entry: Decodable { let host: String; let port: UInt16; let transport: Int32 }
        let entryOwner: Owner
        let entries: [Entry]
    }

    init(review: Data, acknowledgement: BackendGraphAcknowledgement, configuration: RoutedIsolationConfiguration,
         lease: ProtectionLeaseView) throws {
        let graph = try JSONDecoder().decode(Review.self, from: review)
        let hex = Array(graph.entryOwner.auditTokenHex.utf8)
        guard hex.count == 64, hex.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              graph.entries.count == 1, let entry = graph.entries.first,
              entry.host == "127.0.0.1", entry.port >= 1024, entry.transport == 6,
              acknowledgement.schema == "P05_BACKEND_GRAPH_ACK_V1",
              acknowledgement.mode == configuration.mode, acknowledgement.runID == configuration.runID,
              acknowledgement.epoch == configuration.epoch.uuidString, acknowledgement.graphRevision > 0,
              lease.phase == .blocked, lease.providerGeneration == acknowledgement.providerGeneration,
              lease.routeSequence < UInt64.max else { throw ProtectionLeaseFailure.bindingMismatch }
        var token = Data(capacity: 32)
        for offset in stride(from: 0, to: hex.count, by: 2) {
            let pair = String(decoding: hex[offset..<(offset + 2)], as: UTF8.self)
            guard let byte = UInt8(pair, radix: 16) else { throw ProtectionLeaseFailure.bindingMismatch }
            token.append(byte)
        }
        let tokenSHA256 = SHA256.hash(data: token).map { String(format: "%02x", $0) }.joined()
        guard acknowledgement.backendAuditTokenSHA256.contains(tokenSHA256) else { throw ProtectionLeaseFailure.bindingMismatch }
        endpoint = try PrivacyRouteEndpoint(port: entry.port)
        self.acknowledgement = acknowledgement
        controlGeneration = lease.generation
        blockedSequence = lease.routeSequence
    }

    func matches(_ lease: ProtectionLeaseView, connected: Bool) -> Bool {
        lease.generation == controlGeneration && lease.providerGeneration == acknowledgement.providerGeneration
            && lease.phase == (connected ? .routeEntryConnected : .blocked)
            && lease.routeSequence == blockedSequence + (connected ? 1 : 0)
    }
}

/// The dedicated Native route process owns this client for its whole lifetime. A live XPC
/// health lease never substitutes for the separately required OS isolation admission.
@MainActor final class BrowserRouteProtection {
    private let client: RoutedIsolationClient
    private let configuration: RoutedIsolationConfiguration
    private var preparation: RoutedRootPreparation?
    private var preparing = false
    private var reviewingGraph = false
    private var reviewedEntry: ReviewedBrowserRouteEntry?
    private var productionQualification: RoutedProductionQualification?
    private var normalProofRegistrations: [RoutedNormalProofParentRegistration] = []
    private(set) var qualificationFailure: RoutedQualificationFailure?
    private let content = RoutedContentLifetime()
    private var sleepObserver: NSObjectProtocol?
    #if YNX_PRIVACY_ACCEPTANCE
    private var syntheticAuthority: SyntheticTrialAuthority?
    private var syntheticRules: WKContentRuleList?
    private var syntheticRuleStore: WKContentRuleListStore?
    private var syntheticRuleID: String?
    /// A signed, bounded synthetic experiment is separate from production release admission.
    /// The same client, Root preparation and epoch remain owned through both actual canaries.
    static func prepareAcceptance(mode: PrivacyRouteMode, runID: String, inputs: ProtectedAcceptanceTrialInputs,
                                  onLeaseLost: @escaping @MainActor (ProtectionLeaseFailure) -> Void) async throws -> (BrowserRouteProtection, SyntheticTrialAuthority) {
        try SyntheticTrialAuthority.signingPreflight() // Before inputs, Root IPC, sockets or WK.
        let owner = try BrowserRouteProtection(mode: mode, runID: runID, onLeaseLost: onLeaseLost)
        do {
            let prepared = try await RoutedRootPreparation.begin(configuration: owner.configuration)
            owner.preparation = prepared
            let authority = try await SyntheticTrialAuthority.begin(configuration: owner.configuration,
                preparation: prepared, client: owner.client, manifestURL: inputs.manifestURL,
                expectedManifestSHA256: inputs.expectedManifestSHA256,
                bootstrapSHA256: inputs.expectedBootstrapSHA256, profileID: "synthetic-" + runID)
            owner.syntheticAuthority = authority
            try authority.installRevocationHandler { [weak owner] in owner?.content.invalidate() }
            _ = try await ProtectedSyntheticCanary.run(authority: authority)
            try owner.requireSyntheticTrialAuthority(authority)
            try await owner.prepareSyntheticResourceRules(authority: authority, directory: inputs.manifestURL.deletingLastPathComponent())
            return (owner, authority)
        } catch { owner.close(); throw error }
    }
    func requireSyntheticTrialAuthority(_ authority: SyntheticTrialAuthority) throws {
        guard syntheticAuthority === authority, !content.invalidated,
              authority.controlClient === client, authority.preparation === preparation,
              authority.configuration.mode == configuration.mode,
              authority.configuration.runID == configuration.runID,
              authority.configuration.epoch == configuration.epoch,
              authority.configuration.expectedBrowserSHA256 == configuration.expectedBrowserSHA256 else { throw PrivacyRouteError.stale }
        try authority.verify(binding: authority.binding)
        try authority.authorizeBackendPreparation(mode: configuration.mode)
    }
    func beginBackendPreparation(qualifiedTrial authority: SyntheticTrialAuthority) async throws -> RoutedRootPreparation {
        try requireSyntheticTrialAuthority(authority)
        guard let preparation, !preparing, client.current.phase == .idle else { throw PrivacyRouteError.blocked }
        return preparation
    }
    func connectReadyBackend(provider: any PrivacyRouteProvider, explicitUserAction: UUID,
                             qualifiedTrial authority: SyntheticTrialAuthority) async throws {
        try requireSyntheticTrialAuthority(authority)
        guard await provider.status() == .connected else { throw PrivacyRouteError.blocked }
        try requireSyntheticTrialAuthority(authority)
        let connected = try await client.connect(userActionID: explicitUserAction)
        guard connected.phase == .routeEntryConnected else { await client.block(); throw PrivacyRouteError.blocked }
        try await authority.confirmRouteBinding()
        _ = try authority.requireLive()
    }
    func authorizeSyntheticRequest() throws {
        guard let syntheticAuthority else { throw PrivacyRouteError.blocked }
        try requireSyntheticTrialAuthority(syntheticAuthority)
        _ = try syntheticAuthority.requireLive()
    }
    func makeSyntheticWebView(endpoint: PrivacyRouteEndpoint) throws -> WKWebView {
        try authorizeSyntheticRequest()
        guard let syntheticAuthority else { throw PrivacyRouteError.blocked }
        try syntheticAuthority.validateEndpoint(endpoint, binding: syntheticAuthority.binding)
        guard let syntheticRules else { throw PrivacyRouteError.blocked }
        let configuration = try TorRoutedWebViewFactory.configurationForControlledProbe(port: endpoint.port)
        configuration.userContentController.add(syntheticRules)
        let view = WKWebView(frame: .zero, configuration: configuration)
        content.views.add(view)
        return view
    }
    private func prepareSyntheticResourceRules(authority: SyntheticTrialAuthority, directory: URL) async throws {
        try requireSyntheticTrialAuthority(authority)
        let root = directory.appendingPathComponent("webkit-rules-" + configuration.epoch.uuidString, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: root.path) else { throw PrivacyRouteError.stale }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let store = WKContentRuleListStore(url: root)!
        let id = "p05-synthetic-" + configuration.epoch.uuidString
        let paths = NSRegularExpression.escapedPattern(for: authority.scope.noncePrefix)
        let probes = "(baseline|fault-retry|user-retry)-(https|long-wss|stream-download|redirect-same|redirect-cross|redirect-http|cross-origin|plain-ws)"
        var rules: [[String: Any]] = [["trigger": ["url-filter": "^(https?|wss?)://"], "action": ["type": "block"]]]
        for origin in authority.scope.origins {
            guard let host = origin.host else { throw PrivacyRouteError.unsafeTarget }
            let filter = "^(https|wss)://" + NSRegularExpression.escapedPattern(for: host) + paths + "[A-Za-z0-9/_-]+\\?probe=" + probes + "$"
            rules.append(["trigger": ["url-filter": filter, "url-filter-is-case-sensitive": true], "action": ["type": "ignore-previous-rules"]])
        }
        let bytes = try JSONSerialization.data(withJSONObject: rules)
        let list: WKContentRuleList = try await withCheckedThrowingContinuation { continuation in
            store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: String(decoding: bytes, as: UTF8.self)) { list, error in
                if let list, error == nil { continuation.resume(returning: list) }
                else { continuation.resume(throwing: error ?? PrivacyRouteError.blocked) }
            }
        }
        try requireSyntheticTrialAuthority(authority)
        syntheticRuleStore = store; syntheticRuleID = id; syntheticRules = list
    }
    #endif
    convenience init(mode: PrivacyRouteMode, onLeaseLost: @escaping @MainActor (ProtectionLeaseFailure) -> Void) throws {
        let qualification = try RoutedProductionQualification.acquireCurrent(mode: mode)
        // Normal intake precedes Root/control construction. The separate compiled
        // QA canary path deliberately uses the private identity constructor below.
        try self.init(mode: mode, runID: UUID().uuidString.lowercased(), onLeaseLost: onLeaseLost)
        productionQualification = qualification
        do {
            try qualification.requireCurrent(mode: mode, configuration: configuration)
            try qualification.installRevocationHandler { [weak self, weak qualification] in self?.invalidateProductionQualification(qualification?.failure ?? .revoked) }
        } catch { close(); throw error }
    }
    func makeSession(provider: any PrivacyRouteProvider) throws -> PrivacyRouteSession {
        try requireBackendStartupQualification(mode: provider.mode)
        guard let qualification = productionQualification else { throw RoutedQualificationFailure.qualificationIssuerNotSupplied }
        let session = PrivacyRouteSession(provider: provider, qualification: .success(qualification))
        if let failure = session.qualificationFailure { throw failure }
        return session
    }
    private func requireProductionQualification() throws {
        do {
            if let qualificationFailure { throw qualificationFailure }
            guard !content.invalidated else { throw RoutedQualificationFailure.closed }
            guard let qualification = productionQualification else { throw RoutedQualificationFailure.qualificationIssuerNotSupplied }
            try qualification.requireCurrent(mode: configuration.mode == .tor ? .tor : .nym, configuration: configuration)
        } catch {
            let failure = (error as? RoutedQualificationFailure) ?? .invalidSignature
            invalidateProductionQualification(failure); throw failure
        }
    }
    /// Normal backend startup uses the qualification owned by THIS process and epoch.
    /// Global admission diagnostics and synthetic canary authority cannot satisfy it.
    /// This check never creates a Root, enrolls a backend or supplies an admission value.
    func requireBackendStartupQualification(mode: PrivacyRouteMode) throws {
        if let qualificationFailure { throw qualificationFailure }
        guard !content.invalidated else { throw RoutedQualificationFailure.closed }
        guard configuration.mode == (mode == .tor ? .tor : .nym) else { throw RoutedQualificationFailure.wrongMode }
        try requireProductionQualification()
    }
    func normalProofBinding(profileID: String, profileSHA256: String, proofRunID: String) throws -> RoutedNormalProofBinding {
        try requireBackendStartupQualification(mode: .nym)
        guard let productionQualification, let preparation else { throw RoutedNormalProofFailure.revoked }
        return try RoutedNormalProofParentRegistration.makeBinding(qualification: productionQualification,
            preparation: preparation, client: client, profileID: profileID, profileSHA256: profileSHA256, proofRunID: proofRunID)
    }
    func registerNormalProof(binding: RoutedNormalProofBinding, proofURL: URL, responseSHA256: String,
                             helper: PreparedBackendIdentity, readyBackend: OwnedBackendStartGate) async throws -> RoutedNormalProofParentRegistration {
        let expected = try normalProofBinding(profileID: binding.profileID, profileSHA256: binding.profileSHA256, proofRunID: binding.proofRunID)
        guard binding == expected, let productionQualification, let preparation else { throw RoutedNormalProofFailure.invalidBinding }
        let registered = try await RoutedNormalProofParentRegistration.register(qualification: productionQualification,
            preparation: preparation, client: client, binding: binding, proofURL: proofURL, responseSHA256: responseSHA256,
            helper: helper, readyBackend: readyBackend)
        do {
            try requireBackendStartupQualification(mode: .nym)
            guard self.preparation === preparation else { throw RoutedNormalProofFailure.revoked }
            normalProofRegistrations.append(registered)
            return registered
        } catch { registered.close(); throw error }
    }
    private func invalidateProductionQualification(_ failure: RoutedQualificationFailure) {
        if qualificationFailure == nil { qualificationFailure = failure }
        content.invalidate() // Same synchronous WK/download/backend revocation chain.
        client.close()      // A healthy control lease cannot outlive lost static qualification.
    }
    private func requireBootstrapQualification() throws {
        #if YNX_PRIVACY_ACCEPTANCE
        if let syntheticAuthority { try requireSyntheticTrialAuthority(syntheticAuthority); return }
        #endif
        try requireProductionQualification()
    }
    #if YNX_PRIVACY_ACCEPTANCE
    /// A run is a public correlation nonce, never authority. Only the separate acceptance build
    /// can retain that nonce over explicit recovery; every object still gets a fresh epoch and
    /// must obtain all real provider acknowledgements and independent platform admission.
    convenience init(acceptanceMode mode: PrivacyRouteMode, reviewedRunID: String, onLeaseLost: @escaping @MainActor (ProtectionLeaseFailure) -> Void) throws {
        guard reviewedRunID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.invalidConfiguration }
        try self.init(mode: mode, runID: reviewedRunID, onLeaseLost: onLeaseLost)
    }
    #endif
    private init(mode: PrivacyRouteMode, runID: String, onLeaseLost: @escaping @MainActor (ProtectionLeaseFailure) -> Void) throws {
        guard let executable = Bundle.main.executableURL else { throw ProtectionLeaseFailure.identityUnavailable }
        let digest = SHA256.hash(data: try Data(contentsOf: executable)).map { String(format: "%02x", $0) }.joined()
        configuration = try RoutedIsolationConfiguration(
            teamIdentifier: Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "NOT_CONFIGURED",
            mode: mode == .tor ? .tor : .nym, runID: runID, epoch: UUID(), expectedBrowserSHA256: digest)
        guard Bundle.main.bundleIdentifier == configuration.mode.bundleIdentifier else { throw ProtectionLeaseFailure.wrongApplicationInstance }
        let content = self.content
        client = RoutedIsolationClient(configuration: configuration) { failure in
            content.invalidate() // Synchronous Native teardown precedes the owner's async stop.
            onLeaseLost(failure)
        }
        content.onInvalidate = { [weak self] in
            guard let self else { return }
            let proofs = self.normalProofRegistrations; self.normalProofRegistrations.removeAll()
            for proof in proofs { proof.close() }
            let prepared = self.preparation; self.preparation = nil
            prepared?.close()
            #if YNX_PRIVACY_ACCEPTANCE
            let authority = self.syntheticAuthority; self.syntheticAuthority = nil
            authority?.revoke()
            #endif
        }
        sleepObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.client.invalidateForSystemSleep() }
        }
    }
    /// All offline artifact/profile/peer validation precedes this call. A deny-only Root fence
    /// must be acknowledged before any owned backend child may be prepared, never after launch.
    func beginBackendPreparation() async throws -> RoutedRootPreparation {
        try requireProductionQualification()
        guard preparation == nil, !preparing, !content.invalidated,
              client.current.phase == .idle else { throw PrivacyRouteError.blocked }
        preparing = true; defer { preparing = false }
        let prepared = try await RoutedRootPreparation.begin(configuration: configuration)
        do { try requireProductionQualification() }
        catch { prepared.close(); throw error }
        guard !content.invalidated, client.current.phase == .idle, preparation == nil else { prepared.close(); throw PrivacyRouteError.stale }
        preparation = prepared
        return prepared
    }
    /// Live suspended child pins form the first full graph. Enrollment remains BLOCKED; a
    /// genuine provider acknowledgement, not a local Boolean, permits the next startup step.
    func enrollBootstrapGraph(review: Data) async throws -> BackendGraphAcknowledgement {
        try requireBootstrapQualification()
        guard let preparation else { throw PrivacyRouteError.blocked }
        let enrolled = try await client.enroll(backendReviewJSON: review)
        try requireBootstrapQualification()
        guard enrolled.phase == .blocked else { await client.block(); throw PrivacyRouteError.blocked }
        try preparation.bindControlLease(client)
        // Initial graph may still have a suspended entry owner with no allowed peers.
        // Only the final reviewed graph is eligible for production window binding.
        return try await acknowledgeGraph(review, preparation: preparation, bindEntry: false)
    }
    func updateBootstrapGraph(review: Data) async throws -> BackendGraphAcknowledgement {
        try requireBootstrapQualification()
        guard let preparation, try client.requireLiveControlLease().phase == .blocked else { throw PrivacyRouteError.blocked }
        return try await acknowledgeGraph(review, preparation: preparation, bindEntry: productionQualification != nil)
    }
    private func acknowledgeGraph(_ review: Data, preparation: RoutedRootPreparation, bindEntry: Bool) async throws -> BackendGraphAcknowledgement {
        guard !reviewingGraph else { close(); throw PrivacyRouteError.stale }
        reviewingGraph = true
        defer { reviewingGraph = false }
        reviewedEntry = nil
        do {
            let acknowledgement = try await preparation.reviewBootstrapBackendGraph(backendReviewJSON: review)
            try requireBootstrapQualification()
            guard self.preparation === preparation else { throw PrivacyRouteError.stale }
            if bindEntry {
                reviewedEntry = try .init(review: review, acknowledgement: acknowledgement, configuration: configuration,
                                          lease: client.requireLiveControlLease())
            }
            return acknowledgement
        } catch { close(); throw error }
    }
    var bootstrapControlLease: ProtectionLeaseView { get throws { try requireBootstrapQualification(); return try client.requireLiveControlLease() } }
    func trackBackendGate(_ gate: OwnedBackendStartGate) {
        guard !content.invalidated else { Task { await gate.stop() }; return }
        content.backends.append(gate)
    }
    /// The backend's actual official bootstrap/readiness owner must finish first. No WebKit or
    /// download admission follows from a listener, graph ACK or healthy blocked lease alone.
    func connectReadyBackend(provider: any PrivacyRouteProvider, explicitUserAction: UUID) async throws {
        try requireBackendStartupQualification(mode: provider.mode)
        guard let entry = reviewedEntry, entry.matches(try client.requireLiveControlLease(), connected: false),
              await provider.status() == .connected else { throw PrivacyRouteError.blocked }
        try requireBackendStartupQualification(mode: provider.mode)
        guard entry == reviewedEntry, entry.matches(try client.requireLiveControlLease(), connected: false) else { throw PrivacyRouteError.stale }
        let connected = try await client.connect(userActionID: explicitUserAction)
        try requireProductionQualification()
        guard entry == reviewedEntry, entry.matches(connected, connected: true) else { close(); throw PrivacyRouteError.stale }
    }
    func makeWebView(endpoint: PrivacyRouteEndpoint) throws -> WKWebView {
        try authorizeNewRequest()
        guard endpoint == reviewedEntry?.endpoint else { close(); throw ProtectionLeaseFailure.bindingMismatch }
        guard let qualification = productionQualification else { throw RoutedQualificationFailure.qualificationIssuerNotSupplied }
        let view = try TorRoutedWebViewFactory.makeWebView(endpoint: endpoint, admission: qualification.admission, protection: client)
        do { try authorizeNewRequest() }
        catch { view.stopLoading(); throw error }
        content.views.add(view)
        return view
    }
    func authorizeNewRequest() throws {
        try requireProductionQualification()
        let lease = try client.requireLiveControlLease()
        guard reviewedEntry?.matches(lease, connected: true) == true else { close(); throw ProtectionLeaseFailure.bindingMismatch }
    }
    func close() {
        reviewedEntry = nil
        let qualification = productionQualification; productionQualification = nil
        qualification?.revoke(.closed)
        content.invalidate()
        preparation?.close(); preparation = nil
        if let sleepObserver { NSWorkspace.shared.notificationCenter.removeObserver(sleepObserver); self.sleepObserver = nil }
        client.close()
        #if YNX_PRIVACY_ACCEPTANCE
        syntheticRules = nil
        if let syntheticRuleID { syntheticRuleStore?.removeContentRuleList(forIdentifier: syntheticRuleID) { _ in } }
        syntheticRuleStore = nil; syntheticRuleID = nil
        #endif
    }
    /// A routed download delegate must retain this generation and commit only after a matching
    /// completion. Ordinary BrowserController downloads never enter this dedicated owner.
    func registerDownload(_ download: WKDownload) throws -> UInt64 {
        try authorizeOwnedDownload()
        guard !content.invalidated else { throw PrivacyRouteError.stale }
        content.downloads.insert(ObjectIdentifier(download))
        return content.generation
    }
    func finishDownload(_ download: WKDownload, generation: UInt64) throws {
        guard generation == content.generation,
              content.downloads.remove(ObjectIdentifier(download)) != nil else { throw PrivacyRouteError.stale }
        try authorizeOwnedDownload()
    }
    private func authorizeOwnedDownload() throws {
        #if YNX_PRIVACY_ACCEPTANCE
        if syntheticAuthority != nil { try authorizeSyntheticRequest(); return }
        #endif
        try authorizeNewRequest()
    }
    func forgetDownload(_ download: WKDownload) { content.downloads.remove(ObjectIdentifier(download)) }
    func observePageInvalidation(_ withdraw: @escaping @MainActor () -> Void) throws {
        guard !content.invalidated, content.withdrawPage == nil else { throw PrivacyRouteError.stale }
        content.withdrawPage = withdraw
    }

    #if YNX_PRIVACY_ACCEPTANCE
    /// Capture the real control object before fault injection; local teardown is not a closure ACK.
    func acceptancePreparationForClosure() throws -> RoutedRootPreparation {
        try authorizeOwnedDownload()
        guard let preparation else { throw PrivacyRouteError.blocked }
        return preparation
    }
    func acceptanceOwnedBackendGates() -> [OwnedBackendStartGate] { content.backends }
    /// Observation binding for a separately built acceptance consumer. This is deliberately
    /// unavailable to the normal application and never changes platform or control admission.
    func acceptanceBinding(manifestSHA256: String, bootstrapSHA256: String) throws -> [String: String] {
        try authorizeOwnedDownload()
        guard [manifestSHA256, bootstrapSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              let generation = try client.requireLiveControlLease().providerGeneration else { throw PrivacyRouteError.blocked }
        let token = try RoutedOwnAuditToken.copy()
        return ["consumer": "BrowserRouteProtection", "mode": configuration.mode.rawValue,
                "runID": configuration.runID, "epoch": configuration.epoch.uuidString,
                "providerGeneration": generation, "rootPID": String(ProcessInfo.processInfo.processIdentifier),
                "rootAuditTokenSHA256": SHA256.hash(data: token).map { String(format: "%02x", $0) }.joined(),
                "executableSHA256": configuration.expectedBrowserSHA256,
                "manifestSHA256": manifestSHA256, "bootstrapSHA256": bootstrapSHA256]
    }
    #endif
}

/// Stopping a WK load is not a socket-isolation guarantee. The independently verified OS filter
/// must remain fail closed during this local teardown, including live WSS/RTC/IPv6 streams.
@MainActor private final class RoutedContentLifetime {
    let views = NSHashTable<WKWebView>.weakObjects()
    var downloads: Set<ObjectIdentifier> = []
    var backends: [OwnedBackendStartGate] = []
    var generation: UInt64 = 0
    private(set) var invalidated = false
    var onInvalidate: (() -> Void)?
    var withdrawPage: (@MainActor () -> Void)?
    func invalidate() {
        guard !invalidated else { return }
        generation &+= 1
        invalidated = true
        downloads.removeAll()
        let withdraw = withdrawPage; withdrawPage = nil
        withdraw?() // The page holds the only cancel callback and its staging lease.
        onInvalidate?()
        let stopped = backends; backends.removeAll()
        for backend in stopped { Task { await backend.stop() } }
        for view in views.allObjects {
            view.stopLoading(); view.navigationDelegate = nil; view.uiDelegate = nil
            view.removeFromSuperview()
        }
        views.removeAllObjects()
    }
}
