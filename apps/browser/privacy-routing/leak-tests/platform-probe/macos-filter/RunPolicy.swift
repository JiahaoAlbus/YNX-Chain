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
struct ProcessPin: Codable, Equatable {
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
    static func pinSelf(requirement: String) throws -> ProcessPin {
        let token = try ownToken(), value = try inspect(token: token, requirement: requirement)
        let path = withUnsafePointer(to: value.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        let hash = withUnsafePointer(to: value.sha256) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        return ProcessPin(auditTokenHex: token.hex, pid: value.pid, pidVersion: value.pidVersion, path: path, sha256: hash, requirement: requirement)
    }
    static func trustedWebKit(_ token: Data) -> Bool {
        let requirement = "anchor apple and (identifier \"com.apple.WebKit.Networking\" or identifier \"com.apple.WebKit.WebContent\")"
        guard let identity = try? inspect(token: token, requirement: requirement) else { return false }
        let path = withUnsafePointer(to: identity.path) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
        return path.hasPrefix("/System/") && path.contains("/WebKit.framework/")
    }
    static func ownsListener(_ pin: ProcessPin, endpoint: FilterEndpoint) -> Bool {
        guard (try? pin.verifyLive()) != nil else { return false }
        return pin.token.withUnsafeBytes { bytes in endpoint.host.withCString { host in YNXOwnsLoopbackTCPListener(bytes.bindMemory(to: UInt8.self).baseAddress!, bytes.count, host, endpoint.port) == 1 } }
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
    func validate() throws {
        try process.validate()
        guard !role.isEmpty, role.count <= 64, !responsibleAppTokens.isEmpty, responsibleAppTokens.count <= 4, destinations.count <= 256 else { throw FilterFailure.rejected("Bounded explicit backend authority required") }
        for value in responsibleAppTokens { _ = try Data(strictHex: value) }
        for endpoint in destinations { try endpoint.validate() }
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
    enum Verdict: String { case unownedAllow, browserProxyAllow, backendExactEndpointAllow, backendEntryAcceptAllow, ownedDrop }
    enum Direction { case inbound, outbound }
    let review: ReviewedFilterRun
    private(set) var connected = false
    private(set) var sequence: UInt64 = 0
    mutating func block() { connected = false }
    mutating func setConnected(sequence: UInt64, userActionReference: String, live: (ProcessPin) -> Bool = { (try? $0.verifyLive()) != nil }, listener: (ProcessPin, FilterEndpoint) -> Bool = PublicIdentity.ownsListener) throws {
        guard Date().timeIntervalSince1970 < review.expiresAt, sequence == self.sequence + 1, UUID(uuidString: userActionReference) != nil, live(review.browser), live(review.entryOwner), review.entries.allSatisfy({ listener(review.entryOwner, $0) }) else { connected = false; throw FilterFailure.rejected("Expired/stale sequence or route incarnation/listener not ready") }
        self.sequence = sequence; connected = true
    }
    mutating func disconnected(sequence: UInt64) throws { guard sequence == self.sequence + 1 else { throw FilterFailure.rejected("Stale route sequence") }; self.sequence = sequence; connected = false }
    func isPotentiallyOwned(sourceApp: Data?, sourceProcess: Data?) -> Bool { sourceApp == review.browser.token || sourceProcess == review.browser.token || review.backends.contains(where: { $0.process.token == sourceProcess }) }
    func decision(sourceApp: Data?, sourceProcess: Data?, endpoint: FilterEndpoint?, localEndpoint: FilterEndpoint? = nil, direction: Direction = .outbound, now: Double = Date().timeIntervalSince1970, live: (ProcessPin) -> Bool = { (try? $0.verifyLive()) != nil }, webKit: (Data) -> Bool = PublicIdentity.trustedWebKit) -> Verdict {
        if let backend = review.backends.first(where: { $0.process.token == sourceProcess }) {
            // OS may attribute a backend launched by Browser to Browser's responsible app token.
            guard now < review.expiresAt, live(backend.process), let sourceApp, backend.responsibleAppTokens.contains(sourceApp.hex), let endpoint else { return .ownedDrop }
            if direction == .inbound {
                guard connected, backend.process == review.entryOwner, let localEndpoint, review.entries.contains(localEndpoint), endpoint.transport == 6, ["127.0.0.1", "::1"].contains(endpoint.host) else { return .ownedDrop }
                return .backendEntryAcceptAllow
            }
            guard backend.destinations.contains(endpoint) else { return .ownedDrop }
            return .backendExactEndpointAllow
        }
        let directlyPinnedBrowser = sourceProcess == review.browser.token
        guard sourceApp == review.browser.token || directlyPinnedBrowser else { return .unownedAllow }
        guard sourceApp == review.browser.token, direction == .outbound, now < review.expiresAt, connected, live(review.browser), let sourceProcess, sourceProcess.count == 32, sourceProcess == review.browser.token || webKit(sourceProcess), let endpoint, endpoint.transport == 6, review.entries.contains(endpoint), live(review.entryOwner) else { return .ownedDrop }
        return .browserProxyAllow
    }
}
