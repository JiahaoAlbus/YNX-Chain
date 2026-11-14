import Foundation
import Darwin

enum FilterFailure: Error, CustomStringConvertible {
    case rejected(String)
    var description: String { if case .rejected(let text) = self { return text }; return "Rejected" }
}
extension Data {
    init(strictHex: String) throws {
        guard strictHex.count == 64, strictHex.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { throw FilterFailure.rejected("Full lowercase 32-byte audit token required") }
        var bytes: [UInt8] = []; var index = strictHex.startIndex
        while index < strictHex.endIndex { let end = strictHex.index(index, offsetBy: 2); guard let value = UInt8(strictHex[index..<end], radix: 16) else { throw FilterFailure.rejected("Invalid token") }; bytes.append(value); index = end }
        self.init(bytes)
    }
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
struct ProcessPin: Codable, Equatable, Hashable {
    let auditTokenHex: String
    let pid: Int32
    let pidVersion: Int32
    let path: String
    let sha256: String
    let requirement: String
    var token: Data { (try? Data(strictHex: auditTokenHex)) ?? Data() }
    func validate() throws {
        _ = try Data(strictHex: auditTokenHex)
        guard pid > 1, pidVersion > 0, path.hasPrefix("/"), !path.contains("/../"), sha256.count == 64, sha256.allSatisfy({ $0.isHexDigit && !$0.isUppercase }), !requirement.isEmpty, requirement.utf8.count <= 4096 else { throw FilterFailure.rejected("Invalid reviewed process pin") }
    }
    func verifyLive() throws -> YNXProcessIdentity {
        try validate(); let identity = try PublicIdentity.inspect(token: token, requirement: requirement)
        let actualPath = withUnsafePointer(to: identity.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        let actualHash = withUnsafePointer(to: identity.sha256) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        guard identity.pid == pid, identity.pidVersion == pidVersion, actualPath == path, actualHash == sha256 else { throw FilterFailure.rejected("Live audit-token process incarnation/path/hash changed") }
        return identity
    }
}
enum PublicIdentity {
    static func ownToken() throws -> Data { var bytes = [UInt8](repeating: 0, count: 32); guard YNXCopyOwnAuditToken(&bytes, bytes.count) else { throw FilterFailure.rejected("Own public task audit token unavailable") }; return Data(bytes) }
    static func inspect(token: Data, requirement: String) throws -> YNXProcessIdentity {
        guard token.count == 32 else { throw FilterFailure.rejected("Malformed full audit token") }
        var identity = YNXProcessIdentity()
        let result = token.withUnsafeBytes { bytes in requirement.withCString { rule in YNXInspectAuditIdentity(bytes.bindMemory(to: UInt8.self).baseAddress!, bytes.count, rule, &identity) } }
        guard result == 0 else { throw FilterFailure.rejected("Public audit-token/SecCode verification failed: \(result)") }; return identity
    }
    static func inspectCode(token: Data, requirement: String) throws -> YNXProcessIdentity {
        guard token.count == 32 else { throw FilterFailure.rejected("Malformed full audit token") }
        var identity = YNXProcessIdentity()
        let result = token.withUnsafeBytes { bytes in requirement.withCString { rule in YNXInspectAuditCodeIdentity(bytes.bindMemory(to: UInt8.self).baseAddress!, bytes.count, rule, &identity) } }
        guard result == 0 else { throw FilterFailure.rejected("Live audit-token/SecCode check failed: \(result)") }; return identity
    }
    static func pinSelf(requirement: String) throws -> ProcessPin {
        let token = try ownToken(), value = try inspect(token: token, requirement: requirement)
        let path = withUnsafePointer(to: value.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        let hash = withUnsafePointer(to: value.sha256) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        return ProcessPin(auditTokenHex: token.hex, pid: value.pid, pidVersion: value.pidVersion, path: path, sha256: hash, requirement: requirement)
    }
    static func trustedWebKit(_ token: Data) -> Bool {
        let requirement = "anchor apple and (identifier \"com.apple.WebKit.Networking\" or identifier \"com.apple.WebKit.WebContent\")"
        guard let identity = try? inspectCode(token: token, requirement: requirement) else { return false }
        let path = withUnsafePointer(to: identity.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        return path.hasPrefix("/System/") && path.contains("/WebKit.framework/")
    }
    static func ownsListener(_ pin: ProcessPin, endpoint: FilterEndpoint) -> Bool {
        guard (try? pin.verifyLive()) != nil else { return false }
        return ownsListenerAfterVerification(pin, endpoint: endpoint)
    }
    static func ownsListenerAfterVerification(_ pin: ProcessPin, endpoint: FilterEndpoint) -> Bool {
        return pin.token.withUnsafeBytes { bytes in endpoint.host.withCString { host in YNXOwnsLoopbackTCPListener(bytes.bindMemory(to: UInt8.self).baseAddress!, bytes.count, host, endpoint.port) == 1 } }
    }
    static func listenerGeneration(_ pin: ProcessPin, endpoint: FilterEndpoint) -> UInt64? {
        guard (try? pin.verifyLive()) != nil else { return nil }
        return listenerGenerationAfterVerification(pin, endpoint: endpoint)
    }
    static func listenerGenerationAfterVerification(_ pin: ProcessPin, endpoint: FilterEndpoint) -> UInt64? {
        guard endpoint.transport == IPPROTO_TCP else { return nil }
        var generation: UInt64 = 0
        let result = pin.token.withUnsafeBytes { bytes in
            endpoint.host.withCString { host in
                YNXLoopbackTCPListenerGeneration(bytes.bindMemory(to: UInt8.self).baseAddress!, bytes.count, host, endpoint.port, &generation)
            }
        }
        return result == 1 && generation != 0 ? generation : nil
    }
}
// Full expected executable SHA-256 is verified when enrolling/replacing a review. Frequent
// heartbeat/flow checks then revalidate the kernel audit incarnation, live code requirement,
// exact path/start and CodeDirectory identity obtained from that verified process. A same-PID
// exec/code change cannot reuse the cached full-file pin. No unowned process enters this cache.
struct VerifiedPinCache {
    struct Stamp: Equatable { let path: String, code: String; let pidVersion: Int32; let seconds: UInt64, microseconds: UInt64 }
    private var verified: [ProcessPin: Stamp] = [:]
    private func stamp(_ value: YNXProcessIdentity) -> Stamp {
        let path = withUnsafePointer(to: value.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        let code = withUnsafePointer(to: value.codeDirectoryHash) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        return .init(path: path, code: code, pidVersion: value.pidVersion, seconds: value.startSeconds, microseconds: value.startMicroseconds)
    }
    init(pins: [ProcessPin] = []) throws { for pin in pins { verified[pin] = stamp(try pin.verifyLive()) } }
    func isCurrent(_ pin: ProcessPin) -> Bool { guard let expected = verified[pin], let live = try? PublicIdentity.inspectCode(token: pin.token, requirement: pin.requirement) else { return false }; return !expected.code.isEmpty && expected == stamp(live) }
    func ownsListener(_ pin: ProcessPin, _ endpoint: FilterEndpoint) -> Bool { isCurrent(pin) && PublicIdentity.ownsListenerAfterVerification(pin, endpoint: endpoint) }
    func listenerGeneration(_ pin: ProcessPin, _ endpoint: FilterEndpoint) -> UInt64? {
        guard isCurrent(pin) else { return nil }
        return PublicIdentity.listenerGenerationAfterVerification(pin, endpoint: endpoint)
    }
}
struct FilterEndpoint: Codable, Equatable, Hashable {
    let host: String
    let port: UInt16
    let transport: Int32 // IPPROTO_TCP=6 / IPPROTO_UDP=17; never infer protocol from port.
    func validate(loopbackEntry: Bool = false) throws {
        var v4 = in_addr(), v6 = in6_addr()
        let literal = host.withCString { inet_pton(AF_INET, $0, &v4) == 1 || inet_pton(AF_INET6, $0, &v6) == 1 }
        guard literal, !["0.0.0.0", "::"].contains(host), port > 0, [6, 17].contains(transport) else { throw FilterFailure.rejected("Only explicit literal-IP/port/protocol endpoints are allowed") }
        if loopbackEntry { guard ["127.0.0.1", "::1"].contains(host), port >= 1024, transport == 6 else { throw FilterFailure.rejected("Browser may use only exact nonprivileged loopback TCP proxy entries") } }
    }
}
struct BackendPin: Codable {
    let role: String // tor, nym, or a reviewed managed PT/helper; never inferred by executable name.
    let process: ProcessPin
    let responsibleAppTokens: [String]
    let destinations: [FilterEndpoint]
    var listeningEntries: [FilterEndpoint]? = nil
    func validate() throws {
        try process.validate()
        guard !role.isEmpty, role.count <= 64, !responsibleAppTokens.isEmpty, responsibleAppTokens.count <= 4, destinations.count <= 256 else { throw FilterFailure.rejected("Bounded explicit backend authority required") }
        for value in responsibleAppTokens { _ = try Data(strictHex: value) }
        for endpoint in destinations { try endpoint.validate() }
        for endpoint in listeningEntries ?? [] { try endpoint.validate(loopbackEntry: true) }
    }
}
struct ReviewedFilterRun: Codable {
    let schema: String
    let runID: String
    let epoch: String
    let expiresAt: Double
    let browser: ProcessPin
    let entryOwner: ProcessPin
    let entries: [FilterEndpoint]
    let backends: [BackendPin]
    func validate(now: Double = Date().timeIntervalSince1970) throws {
        guard schema == "P05_REVIEWED_FILTER_RUN_V1", runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil, UUID(uuidString: epoch) != nil, expiresAt > now, expiresAt <= now + 600, !entries.isEmpty, entries.count <= 4, !backends.isEmpty, backends.count <= 8, Set(backends.map { $0.process.auditTokenHex }).count == backends.count else { throw FilterFailure.rejected("One bounded reviewed run/epoch and exact backend set required") }
        try browser.validate(); try entryOwner.validate(); for endpoint in entries { try endpoint.validate(loopbackEntry: true) }; for backend in backends { try backend.validate() }
        guard backends.contains(where: { $0.process == entryOwner }), !backends.contains(where: { $0.process.token == browser.token }) else { throw FilterFailure.rejected("Proxy listener must be an independently pinned backend process, not Browser authority") }
    }
    func verifyLive() throws { _ = try browser.verifyLive(); _ = try entryOwner.verifyLive(); for backend in backends { _ = try backend.process.verifyLive() } }
}

// This reducer is shared by the actual NE provider and recorded-tuple regression. Test injection
// cannot install an extension or produce a network verdict. PublicIdentity is used in production.
struct ScopedRunRules {
    enum Verdict: String { case unownedAllow, browserProxyAllow, backendExactEndpointAllow, backendEntryAcceptAllow, backendListenerAllow, ownedDrop, entryListenerLost }
    enum Direction { case inbound, outbound }
    private(set) var review: ReviewedFilterRun
    let mode: RoutedIsolationMode
    private(set) var connected = false
    private(set) var sequence: UInt64 = 0
    private(set) var entryLossFenced = false
    private(set) var proofBootstrapClosed = false
    private var entryGenerations: [FilterEndpoint: UInt64] = [:]
    init(review: ReviewedFilterRun, mode: RoutedIsolationMode) {
        self.review = review
        self.mode = mode
    }
    mutating func block() { connected = false; proofBootstrapClosed = true }
    mutating func entryListenerLost() {
        entryLossFenced = true
        block()
    }
    mutating func setConnected(sequence: UInt64, userActionReference: String, live: (ProcessPin) -> Bool = { (try? $0.verifyLive()) != nil }, listenerGeneration: (ProcessPin, FilterEndpoint) -> UInt64? = PublicIdentity.listenerGeneration) throws {
        guard !entryLossFenced, Date().timeIntervalSince1970 < review.expiresAt, sequence == self.sequence + 1, UUID(uuidString: userActionReference) != nil, live(review.browser), live(review.entryOwner) else { connected = false; throw FilterFailure.rejected("Expired/stale sequence or route incarnation not ready") }
        var observed: [FilterEndpoint: UInt64] = [:]
        for endpoint in review.entries {
            guard let generation = listenerGeneration(review.entryOwner, endpoint), generation != 0 else {
                if !entryGenerations.isEmpty { entryListenerLost() }
                else { block() }
                throw FilterFailure.rejected("Route TCP listener generation unavailable")
            }
            observed[endpoint] = generation
        }
        guard !observed.isEmpty, entryGenerations.isEmpty || observed == entryGenerations else {
            entryListenerLost()
            throw FilterFailure.rejected("Route TCP listener generation changed")
        }
        entryGenerations = observed
        self.sequence = sequence; connected = true; proofBootstrapClosed = true
    }
    mutating func disconnected(sequence: UInt64) throws { guard sequence == self.sequence + 1 else { throw FilterFailure.rejected("Stale route sequence") }; self.sequence = sequence; block() }
    mutating func replaceBlockedGraph(_ value: ReviewedFilterRun) throws { guard !connected else { throw FilterFailure.rejected("Backend graph cannot change while Browser connected") }; review = value }
    func isEntryFlow(_ verdict: Verdict, local: FilterEndpoint?, remote: FilterEndpoint?, direction: Direction) -> Bool {
        switch verdict {
        case .browserProxyAllow, .backendEntryAcceptAllow: return true
        case .backendListenerAllow: return direction == .inbound && local.map(review.entries.contains) == true
        case .backendExactEndpointAllow: return direction == .outbound && mode == .nym && remote.map(review.entries.contains) == true
        default: return false
        }
    }
    func isPotentiallyOwned(sourceApp: Data?, sourceProcess: Data?) -> Bool { sourceApp == review.browser.token || sourceProcess == review.browser.token || review.backends.contains(where: { $0.process.token == sourceProcess }) }
    private mutating func denyMissingEntry() -> Verdict {
        guard !entryLossFenced, !entryGenerations.isEmpty else { return .ownedDrop }
        entryListenerLost()
        return .entryListenerLost
    }
    private func currentPinnedEntry(_ entry: FilterEndpoint, listenerGeneration: (ProcessPin, FilterEndpoint) -> UInt64?) -> Bool {
        guard !entryLossFenced, let expected = entryGenerations[entry] else { return false }
        return listenerGeneration(review.entryOwner, entry) == expected
    }
    mutating func fenceIfListenerChanged(listenerGeneration: (ProcessPin, FilterEndpoint) -> UInt64?) -> Bool {
        guard !entryLossFenced, !entryGenerations.isEmpty,
              !review.entries.allSatisfy({ entry in
                  currentPinnedEntry(entry, listenerGeneration: listenerGeneration)
              }) else { return false }
        entryListenerLost()
        return true
    }
    mutating func pinNymProofEntry(_ entry: FilterEndpoint, listenerGeneration: (ProcessPin, FilterEndpoint) -> UInt64?) -> Bool {
        guard mode == .nym, !proofBootstrapClosed, !entryLossFenced, review.entries == [entry],
              review.backends.contains(where: { $0.process == review.entryOwner && $0.role == "nym" }) else { return false }
        guard let observed = listenerGeneration(review.entryOwner, entry), observed != 0,
              entryGenerations.isEmpty || entryGenerations[entry] == observed else {
            if !entryGenerations.isEmpty { entryListenerLost() }
            return false
        }
        entryGenerations[entry] = observed
        return true
    }
    mutating func decision(sourceApp: Data?, sourceProcess: Data?, endpoint: FilterEndpoint?, localEndpoint: FilterEndpoint? = nil, direction: Direction = .outbound, now: Double = Date().timeIntervalSince1970, live: (ProcessPin) -> Bool = { (try? $0.verifyLive()) != nil }, listener: (ProcessPin, FilterEndpoint) -> Bool = PublicIdentity.ownsListener, listenerGeneration: (ProcessPin, FilterEndpoint) -> UInt64? = PublicIdentity.listenerGeneration, proofAuthorized: (ProcessPin, FilterEndpoint) -> Bool = { _, _ in false }, webKit: (Data) -> Bool = PublicIdentity.trustedWebKit) -> Verdict {
        func nymEntryIsCurrent(_ entry: FilterEndpoint) -> Bool {
            guard !entryLossFenced, review.backends.contains(where: { $0.process == review.entryOwner && $0.role == "nym" }) else { return false }
            if !entryGenerations.isEmpty { return currentPinnedEntry(entry, listenerGeneration: listenerGeneration) }
            return !connected && listener(review.entryOwner, entry) // Parked proof before the first connection.
        }
        if let backend = review.backends.first(where: { $0.process.token == sourceProcess }) {
            // OS may attribute a backend launched by Browser to Browser's responsible app token.
            guard now < review.expiresAt, live(backend.process), let sourceApp, backend.responsibleAppTokens.contains(sourceApp.hex), let endpoint else { return .ownedDrop }
            if backend.role == "nym-helper" {
                // The final graph precedes proof registration and only describes a possible edge.
                guard mode == .nym, direction == .outbound, review.entries.contains(endpoint),
                      proofAuthorized(backend.process, endpoint) else { return .ownedDrop }
            }
            if direction == .inbound {
                // The verified Nym entry is also a bootstrap listener for the proof helper.
                // Check its holder before either inbound allow branch, including while blocked.
                if let localEndpoint, review.entries.contains(localEndpoint) {
                    guard backend.process == review.entryOwner else { return .ownedDrop }
                    guard connected || (mode == .nym && !proofBootstrapClosed) else { return .ownedDrop }
                    let current = mode == .nym ? nymEntryIsCurrent(localEndpoint) :
                        currentPinnedEntry(localEndpoint, listenerGeneration: listenerGeneration)
                    guard current else { return denyMissingEntry() }
                }
                if let localEndpoint, backend.listeningEntries?.contains(localEndpoint) == true, endpoint.transport == 6, ["127.0.0.1", "::1"].contains(endpoint.host) { return .backendListenerAllow }
                guard connected, backend.process == review.entryOwner, let localEndpoint, review.entries.contains(localEndpoint), endpoint.transport == 6, ["127.0.0.1", "::1"].contains(endpoint.host) else { return .ownedDrop }
                return .backendEntryAcceptAllow
            }
            guard backend.destinations.contains(endpoint) else { return .ownedDrop }
            if mode == .nym, review.entries.contains(endpoint) {
                guard connected || !proofBootstrapClosed else { return .ownedDrop }
                guard nymEntryIsCurrent(endpoint) else { return denyMissingEntry() }
            }
            return .backendExactEndpointAllow
        }
        let directlyPinnedBrowser = sourceProcess == review.browser.token
        guard sourceApp == review.browser.token || directlyPinnedBrowser else { return .unownedAllow }
        guard sourceApp == review.browser.token, direction == .outbound, now < review.expiresAt, connected, live(review.browser), let sourceProcess, sourceProcess.count == 32, sourceProcess == review.browser.token || webKit(sourceProcess), let endpoint, endpoint.transport == 6, review.entries.contains(endpoint) else { return .ownedDrop }
        let current = mode == .nym ? nymEntryIsCurrent(endpoint) :
            currentPinnedEntry(endpoint, listenerGeneration: listenerGeneration)
        guard current else { return denyMissingEntry() }
        return .browserProxyAllow
    }
}

/// Post-XPC grant data required to release a proof socket to its enrolled entry.
struct ProofFlowBinding {
    let child: ProcessPin
    let root: Data
    let graphRevision: UInt64
    let port: UInt16

    func authorizes(child: ProcessPin, root: Data, graphRevision: UInt64, port: UInt16, authorized: Bool, live: Bool) -> Bool {
        authorized && live && self.child == child && self.root == root && self.graphRevision == graphRevision && self.port == port
    }
}

/// One Root incarnation's accepted socket flows, used under the Provider lock.
struct RetainedRouteFlows<Flow> {
    enum Scope { case all, entry, process(Data) }
    private struct Record {
        let flow: Flow
        let entry: Bool
        let process: Data?
    }
    private var records: [UUID: Record] = [:]

    var isEmpty: Bool { records.isEmpty }

    mutating func retain(_ flow: Flow, id: UUID, entry: Bool, process: Data?) -> Bool {
        guard records.count < 4096 else { return false }
        records[id] = Record(flow: flow, entry: entry, process: process)
        return true
    }

    mutating func take(_ scope: Scope) -> [Flow] {
        let selected = records.compactMap { id, record -> UUID? in
            switch scope {
            case .all: return id
            case .entry: return record.entry ? id : nil
            case .process(let token): return record.process == token ? id : nil
            }
        }
        // Remove records before the caller asks the OS to update either direction.
        return selected.compactMap { records.removeValue(forKey: $0)?.flow }
    }
}
