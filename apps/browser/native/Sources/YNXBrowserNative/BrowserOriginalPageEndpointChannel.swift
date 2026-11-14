import Foundation
import Security
import Darwin

/// PRIVATE native object transfer, never a portable endpoint or authority factory.
/// The original Auth receiver is not supplied by this transport module.
@objc(YNXBrowserOriginalPageEndpointIPC) protocol BrowserOriginalPageEndpointIPC {
    func acceptOriginalBrowserPageEndpoint(_ endpoint: NSXPCListenerEndpoint,
        withReply reply: @escaping @Sendable () -> Void)
}

enum BrowserPageEndpointFailure: String, Error {
    case invalidEmbeddedService, alreadyTransferred, inactive, cancelled, lost, timedOut
}

/// Standard application-scoped XPC configuration. These code/incarnation
/// operands must come from original native composition, never request DATA.
/// Verifying an embedded code resource alone does not qualify a Source.
struct BrowserEmbeddedPageEndpointService {
    let identifier: String
    let peer: BrowserPageIPCPeer
    init(application: Bundle, identifier: String, codeDirectoryHash: String,
         peer: BrowserPageIPCPeer) throws {
        let checked = try BrowserPageIPCPeer(pid: peer.pid, uid: peer.uid,
            identifier: identifier, codeDirectoryHash: codeDirectoryHash)
        guard checked.requirement.utf8.elementsEqual(peer.requirement.utf8),
              application.bundleURL.pathExtension == "app" else { throw BrowserPageEndpointFailure.invalidEmbeddedService }
        let service = application.bundleURL.appendingPathComponent("Contents/XPCServices", isDirectory: true)
            .appendingPathComponent(identifier + ".xpc", isDirectory: true)
        // Do not follow a substituted directory/resource outside the owning app.
        guard service.standardizedFileURL.path.utf8.elementsEqual(service.resolvingSymlinksInPath().path.utf8),
              let bundle = Bundle(url: service), bundle.bundleIdentifier?.utf8.elementsEqual(identifier.utf8) == true,
              bundle.object(forInfoDictionaryKey: "CFBundlePackageType") as? String == "XPC!",
              let spec = bundle.object(forInfoDictionaryKey: "XPCService") as? [String: Any],
              spec["ServiceType"] as? String == "Application",
              bundle.object(forInfoDictionaryKey: "MachServices") == nil else {
            throw BrowserPageEndpointFailure.invalidEmbeddedService
        }
        var code: SecStaticCode?, requirement: SecRequirement?
        guard SecStaticCodeCreateWithPath(service as CFURL, [], &code) == errSecSuccess,
              let code,
              SecRequirementCreateWithString(peer.requirement as CFString, [], &requirement) == errSecSuccess,
              let requirement,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else {
            throw BrowserPageEndpointFailure.invalidEmbeddedService
        }
        self.identifier = identifier; self.peer = peer
    }
    /// Creates a suspended application-scoped connection. No global Mach service,
    /// LaunchAgent, environment path, socket or fallback transport is installed.
    func makeConnection() -> NSXPCConnection { NSXPCConnection(serviceName: identifier) }
}

// Ordinary nonactor resource teardown remains compatible with Swift tools6.0.
private final class BrowserPageEndpointConnectionLifetime {
    let connection: NSXPCConnection
    private var resumed = false
    init(_ connection: NSXPCConnection) { self.connection = connection }
    func activate() {
        guard !resumed else { return }; resumed = true; connection.resume()
    }
    func invalidate() {
        // Foundation requires initial suspension to be balanced before invalidation.
        // resume alone does NOT launch a service; only an actual proxy message does.
        // No endpoint message is sent on this cancellation/teardown-only path.
        activate(); connection.invalidate()
    }
    deinit { if !resumed { connection.resume() }; connection.invalidate() }
}

/// One-shot endpoint custody only. Constructed by INTERNAL original composition.
/// It cannot construct mount.Acquisition, produce original metadata, or grant a
/// Source. The original factory must separately return its actual owner + peer.
@MainActor final class BrowserOriginalPageEndpointChannel {
    enum State: String { case prepared, transferring, delivered, retiring, closeUnknown, closed }
    private let lifetime: BrowserPageEndpointConnectionLifetime
    private var connection: NSXPCConnection { lifetime.connection }
    private let peer: BrowserPageIPCPeer
    private let originalCurrent: @MainActor () throws -> Void
    private let retireEndpoint: @MainActor () -> Void
    private var endpoint: NSXPCListenerEndpoint?
    private var reply: CheckedContinuation<Void, Error>?
    private var closeWaiters: [CheckedContinuation<Void, Error>] = []
    private var transferDeadline: Task<Void, Never>?, closeDeadline: Task<Void, Never>?
    private var stopped = false, invalidationObserved = false
    private(set) var state: State = .prepared
    private(set) var firstFailure: Error?

    /// `connection` is still suspended and privately owned; never reuse an active
    /// caller connection. `peer` is the original registered CONSUMER identity,
    /// distinct from Browser target identity in Auth's Source scope.
    init(connection: NSXPCConnection, peer: BrowserPageIPCPeer,
         originalCurrent: @escaping @MainActor () throws -> Void,
         retireEndpoint: @escaping @MainActor () -> Void) {
        lifetime = BrowserPageEndpointConnectionLifetime(connection)
        self.peer = peer; self.originalCurrent = originalCurrent; self.retireEndpoint = retireEndpoint
        connection.remoteObjectInterface = NSXPCInterface(with: BrowserOriginalPageEndpointIPC.self)
        // Foundation transfers NSXPCListenerEndpoint as its native NSSecureCoding
        // object over XPC. There is intentionally no NSData/URL endpoint codec.
        connection.setCodeSigningRequirement(peer.requirement)
        let interrupted: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in self?.fail(BrowserPageEndpointFailure.lost) }
        }
        let invalidated: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in self?.didInvalidate() }
        }
        connection.interruptionHandler = interrupted; connection.invalidationHandler = invalidated
    }

    /// May be called exactly once while mount's anonymous page listener is still
    /// suspended. Receiver must only retain the endpoint here, not wait for a
    /// page RPC (which would deadlock original acquisition).
    func transfer(_ originalEndpoint: NSXPCListenerEndpoint) async throws {
        guard state == .prepared, !stopped else { throw BrowserPageEndpointFailure.alreadyTransferred }
        do { try Task.checkCancellation(); try originalCurrent() }
        catch { fail(error); throw error }
        guard !stopped else { throw BrowserPageEndpointFailure.inactive }
        endpoint = originalEndpoint; state = .transferring
        do {
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    reply = continuation
                    transferDeadline = Task { @MainActor [weak self] in
                        do { try await Task.sleep(for: .seconds(5)) } catch { return }
                        self?.fail(BrowserPageEndpointFailure.timedOut)
                    }
                    lifetime.activate()
                    let lost: @Sendable (Error) -> Void = { [weak self] _ in
                        Task { @MainActor in self?.fail(BrowserPageEndpointFailure.lost) }
                    }
                    let proxy = connection.remoteObjectProxyWithErrorHandler(lost)
                    guard let receiver = proxy as? BrowserOriginalPageEndpointIPC else {
                        fail(BrowserPageEndpointFailure.lost); return
                    }
                    receiver.acceptOriginalBrowserPageEndpoint(originalEndpoint) { [weak self] in
                        Task { @MainActor in self?.didTransfer() }
                    }
                }
                try Task.checkCancellation()
                try requireCurrent()
            } onCancel: { [weak self] in
                Task { @MainActor in self?.fail(BrowserPageEndpointFailure.cancelled) }
            }
        } catch { fail(error); throw error }
    }

    func requireCurrent() throws {
        guard state == .delivered, !stopped, endpoint != nil else { throw BrowserPageEndpointFailure.inactive }
        do {
            try originalCurrent()
            guard !stopped, peer.matches(connection) else { throw BrowserPageIPCFailure.peerRejected }
        } catch { fail(error); throw error }
    }
    /// Synchronous Window/App fence: retire the page listener FIRST, then the
    /// SAME bootstrap connection. Never reconnect or replay the endpoint offer.
    func invalidate() {
        guard !stopped else { return }; stopped = true
        retireEndpoint(); transferDeadline?.cancel(); transferDeadline = nil
        if let pending = reply { reply = nil; pending.resume(throwing: firstFailure ?? BrowserPageEndpointFailure.inactive) }
        if !invalidationObserved { state = .retiring }
        lifetime.invalidate()
    }
    /// Completion requires the actual NSXPC invalidation callback. A timeout is
    /// UNKNOWN: retain this same channel; a later close only observes its drain.
    func close() async throws {
        invalidate()
        if invalidationObserved { state = .closed; return }
        guard closeWaiters.count < 16 else { throw BrowserPageIPCFailure.busy }
        try await withCheckedThrowingContinuation { continuation in
            closeWaiters.append(continuation)
            if closeDeadline == nil {
                closeDeadline = Task { @MainActor [weak self] in
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                    guard let self, !self.invalidationObserved else { return }
                    self.closeDeadline = nil; self.state = .closeUnknown
                    self.remember(BrowserPageEndpointFailure.timedOut)
                    let waiting = self.closeWaiters; self.closeWaiters.removeAll()
                    for waiter in waiting { waiter.resume(throwing: BrowserPageEndpointFailure.timedOut) }
                }
            }
        }
    }
    private func didTransfer() {
        guard state == .transferring, !stopped else { return }
        do {
            try originalCurrent()
            guard !stopped, peer.matches(connection) else { throw BrowserPageIPCFailure.peerRejected }
            transferDeadline?.cancel(); transferDeadline = nil; state = .delivered
            let pending = reply; reply = nil; pending?.resume()
        } catch { fail(error) }
    }
    private func remember(_ error: Error) { if firstFailure == nil { firstFailure = error } }
    private func fail(_ error: Error) { remember(error); invalidate() }
    private func didInvalidate() {
        if !stopped { remember(BrowserPageEndpointFailure.lost); invalidate() }
        invalidationObserved = true; state = .closed
        endpoint = nil; closeDeadline?.cancel(); closeDeadline = nil
        let waiting = closeWaiters; closeWaiters.removeAll()
        for waiter in waiting { waiter.resume() }
    }
}
