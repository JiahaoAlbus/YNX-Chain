import Foundation
import Security
import Darwin

/// Native IPC only. Payloads are the existing P08 request and P05 readout DATA;
/// neither the endpoint nor a source reference is a TaskGrant.
@objc(YNXBrowserOriginalPageReadoutIPC) protocol BrowserOriginalPageReadoutIPC {
    func readOriginalBrowserPageReadout(_ request: Data, withReply reply: @escaping @Sendable (Data?, String?) -> Void)
}

/// Implemented by the original registered Auth/Native composition. The transport
/// cannot supply this owner from JSON, an environment variable, or a page callback.
/// A read must adopt and release any partial original borrow before returning.
@MainActor protocol BrowserOriginalPageReadoutOwner: AnyObject {
    func requireCurrent() throws
    func readOriginalBrowserPageReadout(_ request: Data) async throws -> Data
    func close() async throws
}

enum BrowserPageIPCFailure: String, Error {
    case peerRejected = "BROWSER_PAGE_IPC_PEER_REJECTED"
    case invalidated = "BROWSER_PAGE_IPC_INVALIDATED"
    case busy = "BROWSER_PAGE_IPC_BUSY"
    case requestLimit = "BROWSER_PAGE_IPC_REQUEST_LIMIT"
    case responseLimit = "BROWSER_PAGE_IPC_RESPONSE_LIMIT"
    case sourceRejected = "BROWSER_PAGE_IPC_SOURCE_REJECTED"
}

/// Exact code/incarnation operands come from the original registered source,
/// not from request DATA. XPC enforces the code requirement on every message.
struct BrowserPageIPCPeer: Sendable {
    let pid: pid_t
    let uid: uid_t
    let requirement: String
    init(pid: pid_t, uid: uid_t, identifier: String, codeDirectoryHash: String) throws {
        guard pid > 1, uid == geteuid(),
              identifier.range(of: "^[A-Za-z0-9][A-Za-z0-9.-]{1,191}$", options: .regularExpression) != nil,
              codeDirectoryHash.range(of: "^([a-f0-9]{40}|[a-f0-9]{64})$", options: .regularExpression) != nil else {
            throw BrowserPageIPCFailure.peerRejected
        }
        let rule = "identifier \"\(identifier)\" and cdhash H\"\(codeDirectoryHash)\""
        var parsed: SecRequirement?
        guard SecRequirementCreateWithString(rule as CFString, SecCSFlags(), &parsed) == errSecSuccess,
              parsed != nil else { throw BrowserPageIPCFailure.peerRejected }
        self.pid = pid; self.uid = uid; requirement = rule
    }
    func matches(_ connection: NSXPCConnection) -> Bool {
        connection.processIdentifier == pid && connection.effectiveUserIdentifier == uid
    }
}

/// The listener is private (anonymous or original embedded service). It never
/// advertises a public socket, reads a caller PID from DATA, or registers a Root.
/// Constructing a transport is separate from original Source qualification.
final class BrowserPageProtectedIPC: NSObject, NSXPCListenerDelegate, @unchecked Sendable {
    static let maximumRequestBytes = 32 * 1024
    static let maximumResponseBytes = 256 * 1024
    private let listener: NSXPCListener
    private let peer: BrowserPageIPCPeer
    private let owner: any BrowserOriginalPageReadoutOwner
    private let lock = NSLock()
    private var stopped = false
    private var connections: [ObjectIdentifier: BrowserPageIPCConnection] = [:]

    init(listener: NSXPCListener, peer: BrowserPageIPCPeer, owner: any BrowserOriginalPageReadoutOwner) {
        self.listener = listener; self.peer = peer; self.owner = owner
        super.init(); listener.delegate = self
    }
    var endpoint: NSXPCListenerEndpoint { listener.endpoint }
    @MainActor func activate() throws {
        try owner.requireCurrent()
        lock.lock(); let dead = stopped; lock.unlock()
        guard !dead else { throw BrowserPageIPCFailure.invalidated }
        listener.resume()
    }
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard peer.matches(connection) else { return false }
        // Validation in BrowserPageIPCPeer prevents the Objective-C malformed-
        // requirement exception. This is checked by XPC for subsequent messages too.
        connection.setCodeSigningRequirement(peer.requirement)
        let state = BrowserPageIPCConnection(connection: connection, peer: peer)
        lock.lock()
        guard !stopped, connections.count < 8 else { lock.unlock(); return false }
        connections[ObjectIdentifier(connection)] = state
        lock.unlock()
        connection.exportedInterface = NSXPCInterface(with: BrowserOriginalPageReadoutIPC.self)
        connection.exportedObject = BrowserPageIPCExport(owner: owner, state: state)
        let key = ObjectIdentifier(connection)
        let lost: @Sendable () -> Void = { [weak self, weak state] in
            state?.invalidate()
            self?.forget(key)
        }
        connection.interruptionHandler = lost; connection.invalidationHandler = lost
        connection.resume()
        return true
    }
    private func forget(_ id: ObjectIdentifier) { lock.lock(); connections.removeValue(forKey: id); lock.unlock() }
    func invalidate() {
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        stopped = true; let owned = Array(connections.values); connections.removeAll()
        lock.unlock()
        for connection in owned { connection.invalidate() }
        listener.invalidate()
    }
    @MainActor func close() async throws { invalidate(); try await owner.close() }
    deinit { invalidate() }
}

private final class BrowserPageIPCConnection: @unchecked Sendable {
    private let connection: NSXPCConnection
    private let peer: BrowserPageIPCPeer
    private let lock = NSLock()
    private var dead = false, active: UUID?
    private var task: Task<Void, Never>?
    init(connection: NSXPCConnection, peer: BrowserPageIPCPeer) { self.connection = connection; self.peer = peer }
    func begin(caller: NSXPCConnection?) throws -> UUID {
        lock.lock(); defer { lock.unlock() }
        guard !dead, let caller, caller === connection, peer.matches(caller) else { throw BrowserPageIPCFailure.invalidated }
        guard active == nil else { throw BrowserPageIPCFailure.busy }
        let id = UUID(); active = id; return id
    }
    func install(_ work: Task<Void, Never>, id: UUID) {
        lock.lock(); let cancel = dead || active != id
        if !cancel { task = work }; lock.unlock()
        if cancel { work.cancel() }
    }
    func current(_ id: UUID) throws {
        lock.lock(); let valid = !dead && active == id; lock.unlock()
        guard valid else { throw BrowserPageIPCFailure.invalidated }
    }
    func end(_ id: UUID) { lock.lock(); if active == id { active = nil; task = nil }; lock.unlock() }
    func invalidate() {
        lock.lock(); guard !dead else { lock.unlock(); return }; dead = true
        let pending = task; task = nil; active = nil; lock.unlock()
        pending?.cancel(); connection.invalidate()
    }
}

private final class BrowserPageIPCExport: NSObject, BrowserOriginalPageReadoutIPC, @unchecked Sendable {
    private let owner: any BrowserOriginalPageReadoutOwner
    private let state: BrowserPageIPCConnection
    init(owner: any BrowserOriginalPageReadoutOwner, state: BrowserPageIPCConnection) { self.owner = owner; self.state = state }
    func readOriginalBrowserPageReadout(_ request: Data, withReply reply: @escaping @Sendable (Data?, String?) -> Void) {
        let id: UUID
        do {
            guard !request.isEmpty, request.count <= BrowserPageProtectedIPC.maximumRequestBytes else { throw BrowserPageIPCFailure.requestLimit }
            id = try state.begin(caller: NSXPCConnection.current())
        } catch { reply(nil, (error as? BrowserPageIPCFailure)?.rawValue ?? BrowserPageIPCFailure.sourceRejected.rawValue); return }
        let work = Task { @MainActor [owner, state] in
            defer { state.end(id) }
            do {
                try Task.checkCancellation(); try state.current(id); try owner.requireCurrent()
                let result = try await owner.readOriginalBrowserPageReadout(Data(request))
                try Task.checkCancellation(); try state.current(id); try owner.requireCurrent()
                guard !result.isEmpty, result.count <= BrowserPageProtectedIPC.maximumResponseBytes else { throw BrowserPageIPCFailure.responseLimit }
                reply(Data(result), nil) // No await between final current fence and publication.
            } catch {
                // No partial DATA accompanies any source/current/cancellation failure.
                reply(nil, (error as? BrowserPageIPCFailure)?.rawValue ?? BrowserPageIPCFailure.sourceRejected.rawValue)
            }
        }
        state.install(work, id: id)
    }
}
