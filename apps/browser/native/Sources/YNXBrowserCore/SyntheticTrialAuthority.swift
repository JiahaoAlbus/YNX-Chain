#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import Security
import CryptoKit
import Darwin

// Withdrawal only: this object cannot create a qualification or authorize a request.
// ContinuousClock includes system sleep; an idle WK/WSS must not retain a local
// capability until the next request happens to call verify().
enum SyntheticTrialLifetimeFailure: Error { case expired }
@MainActor final class SyntheticTrialWithdrawal {
    private let deadline: ContinuousClock.Instant
    private let onWithdraw: @MainActor () -> Void
    private var expiry: Task<Void, Never>?
    private(set) var failure: Error?
    init(deadline: ContinuousClock.Instant, onWithdraw: @escaping @MainActor () -> Void) {
        self.deadline = deadline; self.onWithdraw = onWithdraw
        expiry = Task { @MainActor [weak self] in
            do { try await ContinuousClock().sleep(until: deadline, tolerance: .zero) } catch { return }
            guard !Task.isCancelled else { return }
            self?.withdraw(SyntheticTrialLifetimeFailure.expired)
        }
    }
    func requireCurrent() throws {
        if let failure { throw failure }
        if ContinuousClock.now >= deadline { withdraw(SyntheticTrialLifetimeFailure.expired) }
        if let failure { throw failure }
    }
    func withdraw(_ reason: Error) {
        guard failure == nil else { return }
        failure = reason // First cause is visible before any reentrant close callback.
        expiry?.cancel(); expiry = nil
        onWithdraw()
    }
    deinit { expiry?.cancel() }
}

@MainActor public final class SyntheticCanaryQualification {
    public let binding: SyntheticTrialBinding
    public let coverage: [String: String]
    private weak var owner: SyntheticTrialAuthority?
    fileprivate init(owner: SyntheticTrialAuthority) { self.owner = owner; binding = owner.binding; coverage = ["selfTCPIPv4": "observed-drop", "selfTCPIPv6": "observed-drop", "selfUDPIPv4": "observed-drop", "selfUDPIPv6": "observed-drop", "webKitTCPIPv4": "observed-drop", "webKitTCPIPv6": "observed-drop", "webKitUDP": "not-required-not-inferred-no-flow-is-not-drop", "fullLeakSafe": "NOT_RUN"] }
    public func verify() throws { guard let owner else { throw SyntheticTrialFailure.revoked }; try owner.verify(binding: binding); guard owner.qualification === self else { throw SyntheticTrialFailure.canaryNotVerified } }
}

/// A separate compiled QA capability, never production admission or a decodable ready value.
@MainActor public final class SyntheticTrialAuthority {
    public let configuration: RoutedIsolationConfiguration
    public let preparation: RoutedRootPreparation
    public let controlClient: RoutedIsolationClient
    public let scope: SyntheticTrialScope
    public let binding: SyntheticTrialBinding
    public private(set) var qualification: SyntheticCanaryQualification?
    private let transport: SyntheticCanaryTransport
    private let expectedProviderSHA256: String
    private let deadline: ContinuousClock.Instant
    private lazy var withdrawal = SyntheticTrialWithdrawal(deadline: deadline) { [weak self] in self?.finishRevocation() }
    private var sockets: [OwnedSyntheticCanarySocket] = []
    private var currentRequest: SyntheticCanaryRequest?
    private var rootVerified = false, revoked = false
    private var routePort: UInt16?, routeSequence: UInt64?
    private var revocations: [@MainActor () -> Void] = []
    private init(configuration: RoutedIsolationConfiguration, preparation: RoutedRootPreparation, client: RoutedIsolationClient,
                 scope: SyntheticTrialScope, binding: SyntheticTrialBinding, expectedProviderSHA256: String) {
        self.configuration = configuration; self.preparation = preparation; controlClient = client
        self.scope = scope; self.binding = binding; self.expectedProviderSHA256 = expectedProviderSHA256
        deadline = ContinuousClock.now.advanced(by: .seconds(configuration.lifetimeSeconds))
        transport = SyntheticCanaryTransport(configuration: configuration)
        transport.onLost = { [weak self] in self?.withdrawal.withdraw(ProtectionLeaseFailure.transportLost) }
        _ = withdrawal // Start independent expiry after every owned field is initialized.
    }
    public static func signingPreflight() throws {
        let team = Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? ""
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.signingNotConfigured }
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code,
              SecRequirementCreateWithString("anchor apple generic and certificate leaf[subject.OU] = \"\(team)\"" as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              SecCodeCheckValidity(code, SecCSFlags(), requirement) == errSecSuccess else { throw SyntheticTrialFailure.invalidSignature }
    }
    public static func preflight(configuration: RoutedIsolationConfiguration) throws {
        try signingPreflight()
        guard Bundle.main.bundleIdentifier == configuration.mode.bundleIdentifier,
              Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String == configuration.teamIdentifier,
              let executable = Bundle.main.executableURL, ProtectionLease.hash(try Data(contentsOf: executable)) == configuration.expectedBrowserSHA256 else { throw SyntheticTrialFailure.bindingMismatch }
    }
    public static func begin(configuration: RoutedIsolationConfiguration, preparation: RoutedRootPreparation, client: RoutedIsolationClient,
                             manifestURL: URL, expectedManifestSHA256: String, bootstrapSHA256: String, profileID: String) async throws -> SyntheticTrialAuthority {
        try preflight(configuration: configuration) // Before manifest/socket/WK, even if supplied objects are invalid.
        try preparation.requireValidPreparation()
        guard let deny = preparation.receipt, deny.runID == configuration.runID, deny.epoch == configuration.epoch.uuidString,
              deny.mode == configuration.mode, client.configuration.runID == configuration.runID, client.configuration.epoch == configuration.epoch,
              client.configuration.mode == configuration.mode, preparation.configuration.epoch == configuration.epoch,
              profileID == "synthetic-" + configuration.runID,
              [expectedManifestSHA256, bootstrapSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              let helperPin = Bundle.main.object(forInfoDictionaryKey: "YNXBackendStartGateSHA256") as? String,
              let providerPin = Bundle.main.object(forInfoDictionaryKey: "YNXAcceptanceProviderSHA256") as? String,
              [helperPin, providerPin].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else { throw SyntheticTrialFailure.missingPins }
        let helper = Bundle.main.bundleURL.appendingPathComponent(OwnedBackendStartGate.helperRelativePath)
        guard helper.resolvingSymlinksInPath() == helper, ProtectionLease.hash(try Data(contentsOf: helper)) == helperPin else { throw SyntheticTrialFailure.missingPins }
        var staticCode: SecStaticCode?, requirement: SecRequirement?
        guard SecStaticCodeCreateWithPath(helper as CFURL, SecCSFlags(), &staticCode) == errSecSuccess, let staticCode,
              SecRequirementCreateWithString("anchor apple generic and certificate leaf[subject.OU] = \"\(configuration.teamIdentifier)\"" as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              SecStaticCodeCheckValidity(staticCode, SecCSFlags(), requirement) == errSecSuccess else { throw SyntheticTrialFailure.invalidSignature }
        let token = try RoutedOwnAuditToken.copy(), tokenHash = ProtectionLease.hash(token)
        guard tokenHash == deny.rootAuditTokenSHA256 else { throw SyntheticTrialFailure.bindingMismatch }
        let fd = Darwin.open(manifestURL.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw SyntheticTrialFailure.invalidScope }; defer { Darwin.close(fd) }
        var info = stat(), directory = stat(); let parent = manifestURL.deletingLastPathComponent()
        guard manifestURL.isFileURL, manifestURL.standardizedFileURL == manifestURL, manifestURL.resolvingSymlinksInPath() == manifestURL,
              lstat(parent.path, &directory) == 0, directory.st_mode & S_IFMT == S_IFDIR, directory.st_uid == getuid(), directory.st_mode & 0o777 == 0o700,
              fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(), info.st_nlink == 1, info.st_mode & 0o777 == 0o600, info.st_size > 0, info.st_size <= 65536 else { throw SyntheticTrialFailure.invalidScope }
        let bytes = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data()
        guard ProtectionLease.hash(bytes) == expectedManifestSHA256 else { throw SyntheticTrialFailure.invalidScope }
        let scope = try SyntheticTrialScope.read(bytes, runID: configuration.runID, bootstrapSHA256: bootstrapSHA256)
        let binding = SyntheticTrialBinding(mode: configuration.mode, runID: configuration.runID, epoch: configuration.epoch.uuidString,
            profileID: profileID, profileSHA256: ProtectionLease.hash(Data(profileID.utf8)), providerGeneration: deny.providerGeneration,
            rootAuditTokenSHA256: tokenHash, manifestSHA256: expectedManifestSHA256, bootstrapSHA256: bootstrapSHA256, executableSHA256: configuration.expectedBrowserSHA256)
        let authority = SyntheticTrialAuthority(configuration: configuration, preparation: preparation, client: client, scope: scope, binding: binding, expectedProviderSHA256: providerPin)
        do {
            try authority.transport.open()
            try await authority.arm(stage: "self")
            for socket in authority.sockets { try socket.sendSelf() }
            try await authority.verifyCanary(stage: "self"); authority.rootVerified = true
            return authority
        } catch { authority.withdrawal.withdraw(error); throw authority.firstFailure ?? error }
    }
    public func installRevocationHandler(_ handler: @escaping @MainActor () -> Void) throws {
        do { try verify(binding: binding) }
        catch { handler(); throw withdrawal.failure ?? error }
        revocations.append(handler)
    }
    public var firstFailure: Error? { withdrawal.failure }
    public func verify(binding proposed: SyntheticTrialBinding) throws {
        do {
            try withdrawal.requireCurrent()
            guard !revoked, transport.valid else { throw SyntheticTrialFailure.revoked }
            guard proposed == binding else { throw SyntheticTrialFailure.bindingMismatch }
            try preparation.requireValidPreparation()
            guard ProtectionLease.hash(try RoutedOwnAuditToken.copy()) == binding.rootAuditTokenSHA256 else { throw SyntheticTrialFailure.bindingMismatch }
        } catch { withdrawal.withdraw(error); throw withdrawal.failure ?? error }
    }
    public func authorizeCanaryConstruction() throws { try verify(binding: binding); guard rootVerified, qualification == nil else { throw SyntheticTrialFailure.canaryNotVerified } }
    public func prepareWebKitCanary() async throws -> [URLRequest] {
        try authorizeCanaryConstruction(); try await arm(stage: "webkit")
        return sockets.filter { $0.target.transport == IPPROTO_TCP }.map { URLRequest(url: $0.httpsURL) }
    }
    public var webKitCanaryHTML: String { get throws {
        try authorizeCanaryConstruction()
        guard currentRequest?.stage == "webkit" else { throw SyntheticTrialFailure.canaryNotVerified }
        let urls = sockets.filter { $0.target.transport == IPPROTO_TCP }.map { $0.httpsURL.absoluteString }
        let stun = sockets.filter { $0.target.transport == IPPROTO_UDP }.map { "stun:\($0.target.host == "::1" ? "[::1]" : $0.target.host):\($0.target.port)" }
        let configuration = try JSONSerialization.data(withJSONObject: ["urls": urls, "stun": stun])
        return "<!doctype html><meta charset=utf-8><title>YNX synthetic deny canary</title><p>合成源归因测试，未获隐私浏览资格。</p><script>const c=\(String(decoding: configuration, as: UTF8.self));for(const u of c.urls)fetch(u,{cache:'no-store'}).catch(()=>{});if(typeof RTCPeerConnection==='function'){try{const p=new RTCPeerConnection({iceServers:c.stun.map(u=>({urls:u}))});p.createDataChannel('synthetic');p.createOffer().then(o=>p.setLocalDescription(o)).catch(()=>{});}catch(e){}}</script>"
    } }
    public func completeWebKitCanary() async throws -> SyntheticCanaryQualification {
        try authorizeCanaryConstruction(); try await verifyCanary(stage: "webkit")
        try authorizeCanaryConstruction() // The awaited reply cannot revive an expired/closed owner.
        let result = SyntheticCanaryQualification(owner: self); qualification = result; return result
    }
    public func requireQualification() throws -> SyntheticCanaryQualification {
        try verify(binding: binding); guard let qualification else { throw SyntheticTrialFailure.canaryNotVerified }; return qualification
    }
    public func authorizeBackendPreparation(mode: RoutedIsolationMode) throws {
        _ = try requireQualification(); guard binding.mode == mode else { throw SyntheticTrialFailure.bindingMismatch }
    }
    public func confirmRouteBinding() async throws {
        do {
            try Task.checkCancellation()
            _ = try requireQualification(); let before = try controlClient.requireLiveControlLease()
            guard before.phase == .routeEntryConnected, before.providerGeneration == binding.providerGeneration, let request = currentRequest else { throw SyntheticTrialFailure.routeNotVerified }
            let reply = try await transport.status(request)
            try Task.checkCancellation()
            _ = try requireQualification(); let after = try controlClient.requireLiveControlLease()
            try validate(reply, request: request)
            guard after.phase == .routeEntryConnected, after.providerGeneration == binding.providerGeneration,
                  before.routeSequence == after.routeSequence, reply.routeConnected, let port = reply.routePort,
                  port >= 1024, reply.routeSequence == after.routeSequence else { throw SyntheticTrialFailure.routeNotVerified }
            routePort = port; routeSequence = after.routeSequence
        } catch { withdrawal.withdraw(error); throw withdrawal.failure ?? error }
    }
    public func requireLive() throws -> ProtectionLeaseView {
        do {
            _ = try requireQualification(); let live = try controlClient.requireLiveControlLease()
            guard live.phase == .routeEntryConnected, live.providerGeneration == binding.providerGeneration, routeSequence == live.routeSequence else { throw SyntheticTrialFailure.routeNotVerified }
            return live
        } catch { withdrawal.withdraw(error); throw withdrawal.failure ?? error }
    }
    public func validateEndpoint(_ endpoint: PrivacyRouteEndpoint, binding proposed: SyntheticTrialBinding) throws {
        try verify(binding: proposed); _ = try requireLive(); guard endpoint.port == routePort else { throw SyntheticTrialFailure.routeNotVerified }
    }
    public func authorize(request: URLRequest, binding proposed: SyntheticTrialBinding) throws {
        try verify(binding: proposed); _ = try requireLive(); try scope.validate(request)
    }
    public func revoke() {
        withdrawal.withdraw(SyntheticTrialFailure.revoked)
    }
    private func finishRevocation() {
        guard !revoked else { return }; revoked = true; qualification = nil
        routePort = nil; routeSequence = nil; currentRequest = nil
        for socket in sockets { socket.close() }; sockets.removeAll(); transport.close()
        preparation.close(); controlClient.close() // Same actual owners; this is local teardown, not proof of OS socket denial.
        let handlers = revocations; revocations.removeAll(); for handler in handlers { handler() }
    }
    private func arm(stage: String) async throws {
        do {
        try Task.checkCancellation(); try verify(binding: binding); for socket in sockets { socket.close() }; sockets.removeAll()
        for host in ["127.0.0.1", "::1"] { for transport in [IPPROTO_TCP, IPPROTO_UDP] { sockets.append(try OwnedSyntheticCanarySocket(host: host, transport: transport)) } }
        let request = SyntheticCanaryRequest(schema: "P05_SYNTHETIC_CANARY_ARM_V1", nonce: UUID().uuidString, stage: stage, binding: binding, targets: sockets.map(\.target))
            let reply = try await transport.arm(request)
            try Task.checkCancellation()
            try verify(binding: binding); try validate(reply, request: request); currentRequest = request
        } catch { withdrawal.withdraw(error); throw withdrawal.failure ?? error }
    }
    private func verifyCanary(stage: String) async throws {
        do {
        guard let request = currentRequest, request.stage == stage else { throw SyntheticTrialFailure.canaryNotVerified }
        let until = DispatchTime.now().uptimeNanoseconds + 8_000_000_000
        while DispatchTime.now().uptimeNanoseconds < until {
            try Task.checkCancellation()
            try verify(binding: binding)
            if try sockets.contains(where: { try $0.receivedTraffic() }) { throw SyntheticTrialFailure.canaryObservedLeak }
            let reply = try await transport.status(request)
            try Task.checkCancellation()
            try verify(binding: binding)
            try validate(reply, request: request)
            // Real ingress can arrive while the status RPC is suspended. A
            // complete set of callback drops cannot override that observation.
            if try sockets.contains(where: { try $0.receivedTraffic() }) { throw SyntheticTrialFailure.canaryObservedLeak }
            guard DispatchTime.now().uptimeNanoseconds < until else { throw SyntheticTrialFailure.canaryTimeout }
            let required = request.targets.filter { stage == "self" || $0.transport == IPPROTO_TCP }
            let observed = reply.drops.filter { item in required.contains(where: { $0.id == item.targetID }) }
            if Set(observed.map(\.targetID)) == Set(required.map(\.id)), observed.count == required.count,
               observed.allSatisfy({ $0.sourceAppSHA256 == binding.rootAuditTokenSHA256 && $0.sourceKind == stage && $0.verdict == "drop" && UUID(uuidString: $0.flowID) != nil }) { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw SyntheticTrialFailure.canaryTimeout
        } catch { withdrawal.withdraw(error); throw withdrawal.failure ?? error }
    }
    private func validate(_ reply: SyntheticCanaryReply, request: SyntheticCanaryRequest) throws {
        guard reply.schema == "P05_SYNTHETIC_CANARY_OBSERVED_V1", reply.binding == binding, reply.nonce == request.nonce,
              reply.stage == request.stage, reply.providerSHA256 == expectedProviderSHA256 else { throw SyntheticTrialFailure.bindingMismatch }
    }
}

@MainActor private final class OwnedSyntheticCanarySocket {
    let target: SyntheticCanaryTarget
    private var descriptor: Int32
    private var senders: [Int32] = []
    var httpsURL: URL { URL(string: "https://\(target.host == "::1" ? "[::1]" : target.host):\(target.port)/p05-canary/\(target.id)")! }
    init(host: String, transport: Int32) throws {
        let family = host == "::1" ? AF_INET6 : AF_INET
        let fd = Darwin.socket(family, transport == IPPROTO_TCP ? SOCK_STREAM : SOCK_DGRAM, transport)
        guard fd >= 0 else { throw SyntheticTrialFailure.canaryNotVerified }
        var address = Self.address(host: host, port: 0)
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, host == "::1" ? socklen_t(MemoryLayout<sockaddr_in6>.size) : socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard bound == 0, transport != IPPROTO_TCP || Darwin.listen(fd, 4) == 0 else { Darwin.close(fd); throw SyntheticTrialFailure.canaryNotVerified }
        var length = socklen_t(MemoryLayout<sockaddr_storage>.size)
        guard withUnsafeMutablePointer(to: &address, { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) } }) == 0 else { Darwin.close(fd); throw SyntheticTrialFailure.canaryNotVerified }
        let port: UInt16 = withUnsafePointer(to: address) { pointer in host == "::1"
            ? pointer.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { UInt16(bigEndian: $0.pointee.sin6_port) }
            : pointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt16(bigEndian: $0.pointee.sin_port) } }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        descriptor = fd
        target = SyntheticCanaryTarget(id: UUID().uuidString, host: host, port: port, transport: transport)
    }
    private static func address(host: String, port: UInt16) -> sockaddr_storage {
        var storage = sockaddr_storage()
        if host == "::1" { var value = sockaddr_in6(); value.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size); value.sin6_family = sa_family_t(AF_INET6); value.sin6_port = port.bigEndian; _ = inet_pton(AF_INET6, host, &value.sin6_addr); withUnsafeMutablePointer(to: &storage) { $0.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { $0.pointee = value } } }
        else { var value = sockaddr_in(); value.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); value.sin_family = sa_family_t(AF_INET); value.sin_port = port.bigEndian; _ = inet_pton(AF_INET, host, &value.sin_addr); withUnsafeMutablePointer(to: &storage) { $0.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee = value } } }
        return storage
    }
    func sendSelf() throws {
        let fd = Darwin.socket(target.host == "::1" ? AF_INET6 : AF_INET, target.transport == IPPROTO_TCP ? SOCK_STREAM : SOCK_DGRAM, target.transport)
        guard fd >= 0 else { throw SyntheticTrialFailure.canaryNotVerified }; senders.append(fd)
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        var address = Self.address(host: target.host, port: target.port)
        let size = target.host == "::1" ? socklen_t(MemoryLayout<sockaddr_in6>.size) : socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { pointer in
            if target.transport == IPPROTO_TCP { return Darwin.connect(fd, pointer, size) }
            let data = Data(("P05-SYNTHETIC-" + target.id).utf8); return data.withUnsafeBytes { Int32(sendto(fd, $0.baseAddress, $0.count, 0, pointer, size)) }
        } }
    }
    func receivedTraffic() throws -> Bool {
        guard descriptor >= 0 else { throw SyntheticTrialFailure.revoked }
        if target.transport == IPPROTO_TCP { let accepted = Darwin.accept(descriptor, nil, nil); if accepted >= 0 { Darwin.close(accepted); return true } }
        else { var byte: UInt8 = 0; if recv(descriptor, &byte, 1, 0) >= 0 { return true } }
        guard errno == EAGAIN || errno == EWOULDBLOCK else { throw SyntheticTrialFailure.canaryNotVerified }; return false
    }
    deinit { if descriptor >= 0 { Darwin.close(descriptor) }; for fd in senders { Darwin.close(fd) } }
    func close() { if descriptor >= 0 { Darwin.close(descriptor); descriptor = -1 }; for fd in senders { Darwin.close(fd) }; senders.removeAll() }
}

@MainActor private final class SyntheticCanaryTransport {
    let configuration: RoutedIsolationConfiguration
    private var connection: NSXPCConnection?, proxy: ScopedSyntheticCanaryControl?
    private(set) var valid = true
    var onLost: (@MainActor () -> Void)?
    init(configuration: RoutedIsolationConfiguration) { self.configuration = configuration }
    func open() throws {
        let xpc = NSXPCConnection(machServiceName: configuration.providerService, options: .privileged)
        xpc.setCodeSigningRequirement(configuration.providerRequirement); xpc.remoteObjectInterface = NSXPCInterface(with: ScopedSyntheticCanaryControl.self)
        let lost: @Sendable () -> Void = { [weak self] in Task { @MainActor in guard let self, self.valid else { return }; self.close(); self.onLost?() } }
        xpc.invalidationHandler = lost; xpc.interruptionHandler = lost; connection = xpc
        guard let remote = xpc.remoteObjectProxyWithErrorHandler({ _ in lost() }) as? ScopedSyntheticCanaryControl else { close(); throw ProtectionLeaseFailure.transportLost }
        proxy = remote; xpc.resume()
    }
    func close() { valid = false; proxy = nil; let old = connection; connection = nil; old?.invalidate() }
    func arm(_ request: SyntheticCanaryRequest) async throws -> SyntheticCanaryReply { try await rpc(request, arm: true) }
    func status(_ request: SyntheticCanaryRequest) async throws -> SyntheticCanaryReply { try await rpc(request, arm: false) }
    private func rpc(_ request: SyntheticCanaryRequest, arm: Bool) async throws -> SyntheticCanaryReply {
        guard valid, let proxy else { throw ProtectionLeaseFailure.transportLost }; let bytes = try JSONEncoder().encode(request)
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            let pending = SyntheticCanaryPending(continuation)
            let timeout = Task { try? await Task.sleep(for: .seconds(1)); pending.finish(.failure(ProtectionLeaseFailure.replyTimeout)) }
            let reply: (Data?, String?) -> Void = { [weak self] bytes, error in Task { @MainActor in
                timeout.cancel(); guard self?.valid == true, error == nil, let bytes, bytes.count <= 32768 else { pending.finish(.failure(ProtectionLeaseFailure.malformedReply)); return }; pending.finish(.success(bytes))
            } }
            if arm { proxy.armSyntheticCanary(bytes, withReply: reply) } else { proxy.syntheticCanaryStatus(bytes, withReply: reply) }
        }
        return try JSONDecoder().decode(SyntheticCanaryReply.self, from: data)
    }
}
@MainActor private final class SyntheticCanaryPending {
    private var continuation: CheckedContinuation<Data, Error>?
    init(_ value: CheckedContinuation<Data, Error>) { continuation = value }
    func finish(_ result: Result<Data, Error>) { guard let old = continuation else { return }; continuation = nil; old.resume(with: result) }
}
#endif
