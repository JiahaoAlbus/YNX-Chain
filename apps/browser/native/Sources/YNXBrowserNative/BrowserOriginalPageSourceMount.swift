import Foundation

/// Non-actor resource lifetime. No Sendable/unchecked/unsafe isolation claim is needed:
/// NSXPCListener invalidation belongs to this object's ordinary deinit, not the UI actor's.
private final class BrowserPageMountListenerLifetime {
    let listener = NSXPCListener.anonymous()
    deinit { listener.invalidate() }
}

/// One-shot ownership/lifecycle only. The immutable acquisition callback is supplied by the
/// internal original Auth composition; it is not an authority factory, provider setter or Grant.
@MainActor final class BrowserOriginalPageSourceMount {
    @MainActor struct Acquisition {
        let owner: (any BrowserOriginalPageReadoutOwner)?
        let peer: BrowserPageIPCPeer?
        let error: Error?
        init(owner: (any BrowserOriginalPageReadoutOwner)?, peer: BrowserPageIPCPeer?, error: Error?) {
            self.owner = owner; self.peer = peer; self.error = error
        }
    }
    enum State: String { case idle, acquiring, active, closing, closeUnknown, closed }
    enum Failure: String, Error { case alreadyStarted, cancelled, missingOriginalOwner, missingOriginalPeer, inactive }
    typealias OriginalAcquisition = @MainActor (NSXPCListenerEndpoint) async -> Acquisition
    private let listenerLifetime: BrowserPageMountListenerLifetime
    private var listener: NSXPCListener { listenerLifetime.listener }
    private var acquireOriginal: OriginalAcquisition? // Consumed once; no setter or replacement.
    private var acquisition: Task<Acquisition, Never>?
    private var adopted = false, started = false, stopRequested = false
    private var owner: (any BrowserOriginalPageReadoutOwner)?
    private var peer: BrowserPageIPCPeer?
    private var transport: BrowserPageProtectedIPC?
    private struct CloseAttempt { let id: UUID; let task: Task<Void, Error> }
    private var closing: CloseAttempt?
    private(set) var state: State = .idle
    private(set) var firstFailure: Error?
    private(set) var lastCloseFailure: Error?

    init(acquireOriginal: @escaping OriginalAcquisition) {
        // A fresh anonymous listener starts suspended. Never double-suspend or resume it before
        // the original acquisition returns and real owner.current has succeeded.
        listenerLifetime = BrowserPageMountListenerLifetime(); self.acquireOriginal = acquireOriginal
    }
    /// The factory may bind/capture this prepared endpoint, but must not wait for a page request
    /// on it while acquiring: the listener intentionally cannot receive until start succeeds.
    func start() async throws -> NSXPCListenerEndpoint {
        guard !started else { throw Failure.alreadyStarted }; started = true
        guard !stopRequested, !Task.isCancelled else {
            remember(Failure.cancelled); invalidate(); try? await close(); throw Failure.cancelled
        }
        state = .acquiring
        guard let acquire = acquireOriginal else { throw Failure.alreadyStarted }
        acquireOriginal = nil // Do not retain a factory capture/partial owner after its one call.
        let endpoint = listener.endpoint
        let task = Task { @MainActor in await acquire(endpoint) }; acquisition = task
        let result = await withTaskCancellationHandler {
            await task.value
        } onCancel: { [weak self] in
            task.cancel()
            Task { @MainActor in self?.invalidate() }
        }
        adopt(result) // Adopt nonnil partial owner BEFORE checking its accompanying error/cancel.
        do {
            if let error = result.error { throw error }
            guard !stopRequested, !Task.isCancelled else { throw Failure.cancelled }
            guard let owner else { throw Failure.missingOriginalOwner }
            guard let peer else { throw Failure.missingOriginalPeer }
            try owner.requireCurrent()
            guard !stopRequested, !Task.isCancelled else { throw Failure.cancelled }
            let ipc = BrowserPageProtectedIPC(listener: listener, peer: peer, owner: owner)
            transport = ipc // Publish owned handle before any reentrant current callback.
            try ipc.activate() // Real BaseIPC checks current again before its actual resume.
            try owner.requireCurrent()
            guard !stopRequested, !Task.isCancelled else { throw Failure.cancelled }
            state = .active
            return endpoint
        } catch {
            remember(error); invalidate()
            // Cleanup failures stay owned/UNKNOWN and do not replace the original start cause.
            try? await close()
            throw error
        }
    }
    /// Local lifecycle fence surrounding the actual original owner's current check. An active
    /// transport is not qualification: the original Source remains responsible for every check.
    func requireCurrent() throws {
        guard state == .active, !stopRequested, let held = owner, transport != nil else { throw Failure.inactive }
        do {
            try held.requireCurrent()
            guard state == .active, !stopRequested, let current = owner, current === held else { throw Failure.inactive }
        } catch { remember(error); invalidate(); throw error }
    }
    /// Window/App teardown calls this synchronously before waiting for any async owner cleanup.
    /// It cancels only this acquisition and its actual IPC handles, never another Source/scope.
    func invalidate() {
        stopRequested = true
        if !started { acquireOriginal = nil }
        transport?.invalidate(); listener.invalidate(); acquisition?.cancel()
        if state != .closed && state != .closeUnknown { state = .closing }
    }
    /// Concurrent close calls join one attempt. A failed attempt retains owner and stopped IPC;
    /// only an explicit later close retries that SAME owner. Never drop this mount on UNKNOWN.
    func close() async throws {
        invalidate()
        if let pending = acquisition { adopt(await pending.value) }
        guard let held = owner else {
            transport = nil; peer = nil; state = .closed
            return
        }
        let attempt: CloseAttempt
        if let existing = closing { attempt = existing }
        else {
            state = .closing
            // Unstructured cleanup is independently owned; cancelling a start/waiting caller
            // cannot skip actual owner.close or discard its partial/failed cleanup result.
            let task = Task { @MainActor in try await held.close() }
            attempt = CloseAttempt(id: UUID(), task: task); closing = attempt
        }
        do {
            try await attempt.task.value
            if closing?.id == attempt.id {
                closing = nil; owner = nil; peer = nil; transport = nil
                lastCloseFailure = nil; state = .closed
            }
        } catch {
            if closing?.id == attempt.id {
                closing = nil; lastCloseFailure = error; remember(error); state = .closeUnknown
            }
            throw error
        }
    }
    private func adopt(_ result: Acquisition) {
        guard !adopted else { return }; adopted = true
        owner = result.owner; peer = result.peer; acquisition = nil
        if let error = result.error { remember(error) }
    }
    private func remember(_ error: Error) { if firstFailure == nil { firstFailure = error } }
    // BaseIPC owns its transport deinit invalidation; listenerLifetime owns the prepared listener.
    // Async original-owner close still requires explicit close(), including UNKNOWN retention.
}
