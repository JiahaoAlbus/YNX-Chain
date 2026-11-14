import AppKit

/// Defers a download's save sheet until its own window can receive user interaction.
/// It never activates an application, makes a window key, chooses a URL or resolves a download.
@MainActor final class BrowserDownloadSavePresentation: NSObject {
    struct State: Equatable {
        let appActive: Bool
        let ownerKey: Bool
        let ownerMain: Bool
        let ownerVisible: Bool
        let ownerMiniaturized: Bool
        let attachedSheet: Bool
        var canPresent: Bool { appActive && ownerKey && ownerVisible && !ownerMiniaturized && !attachedSheet }
        var evidence: [String: Bool] {
            ["appActive": appActive, "ownerKey": ownerKey, "ownerMain": ownerMain,
             "ownerVisible": ownerVisible, "ownerMiniaturized": ownerMiniaturized,
             "hostAttachedSheet": attachedSheet]
        }
    }
    enum Event: String {
        case requested, waitingForActivation, waitingForOwnerWindow, waitingForExistingSheet
        case presenting, appBecameActive, appResignedActive, ownerBecameKey, ownerResignedKey
        case ownerDeminiaturized, sheetBegan, sheetEnded, ownerClosed, cancelled, completed
    }
    private struct Request {
        let id: ObjectIdentifier
        let isPending: () -> Bool
        let present: () -> Void
    }
    private let notifications: NotificationCenter
    private let readState: () -> State
    private let record: (Event, State) -> Void
    private var requests: [Request] = []
    private var presentingID: ObjectIdentifier?
    private var drainScheduled = false
    private var stopped = false
    var queuedCount: Int { requests.count }

    convenience init(owner: NSWindow, application: NSApplication, record: @escaping (Event, State) -> Void) {
        self.init(notifications: .default, owner: owner, application: application, readState: { [weak owner] in
            State(appActive: application.isActive, ownerKey: owner?.isKeyWindow ?? false,
                  ownerMain: owner?.isMainWindow ?? false, ownerVisible: owner?.isVisible ?? false,
                  ownerMiniaturized: owner?.isMiniaturized ?? false, attachedSheet: owner?.attachedSheet != nil)
        }, record: record)
    }

    /// The injected state source lets the queue/cancellation contract be tested without
    /// creating or activating a GUI. Production always reads the real AppKit objects above.
    init(notifications: NotificationCenter, owner: NSObject, application: NSObject,
         readState: @escaping () -> State, record: @escaping (Event, State) -> Void) {
        self.notifications = notifications; self.readState = readState; self.record = record
        super.init()
        for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification] {
            notifications.addObserver(self, selector: #selector(stateChanged(_:)), name: name, object: application)
        }
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
                     NSWindow.didDeminiaturizeNotification, NSWindow.willBeginSheetNotification,
                     NSWindow.didEndSheetNotification, NSWindow.willCloseNotification] {
            notifications.addObserver(self, selector: #selector(stateChanged(_:)), name: name, object: owner)
        }
    }

    func request(_ decision: AnyObject, isPending: @escaping () -> Bool, present: @escaping () -> Void) {
        guard !stopped else { return }
        let id = ObjectIdentifier(decision)
        guard presentingID != id, !requests.contains(where: { $0.id == id }) else { return }
        requests.append(Request(id: id, isPending: isPending, present: present))
        record(.requested, readState()); scheduleDrain()
    }

    func finish(_ decision: AnyObject, cancelled: Bool) {
        let id = ObjectIdentifier(decision)
        let wasOwned = presentingID == id || requests.contains(where: { $0.id == id })
        requests.removeAll(where: { $0.id == id })
        if presentingID == id { presentingID = nil }
        if wasOwned { record(cancelled ? .cancelled : .completed, readState()) }
        scheduleDrain()
    }

    func stop() {
        guard !stopped else { return }
        stopped = true; requests.removeAll(); presentingID = nil
        notifications.removeObserver(self)
    }

    @objc private func stateChanged(_ notification: Notification) {
        guard !stopped else { return }
        let event: Event
        switch notification.name {
        case NSApplication.didBecomeActiveNotification: event = .appBecameActive
        case NSApplication.didResignActiveNotification: event = .appResignedActive
        case NSWindow.didBecomeKeyNotification: event = .ownerBecameKey
        case NSWindow.didResignKeyNotification: event = .ownerResignedKey
        case NSWindow.didDeminiaturizeNotification: event = .ownerDeminiaturized
        case NSWindow.willBeginSheetNotification: event = .sheetBegan
        case NSWindow.didEndSheetNotification: event = .sheetEnded
        case NSWindow.willCloseNotification: event = .ownerClosed
        default: return
        }
        record(event, readState())
        if event == .ownerClosed { stop() } else { scheduleDrain() }
    }

    private func scheduleDrain() {
        guard !stopped, !drainScheduled, presentingID == nil, !requests.isEmpty else { return }
        drainScheduled = true
        // Leave WebKit/ViewBridge/notification callbacks, then re-read actual activation.
        DispatchQueue.main.async { [weak self] in self?.drain() }
    }

    private func drain() {
        drainScheduled = false
        guard !stopped, presentingID == nil else { return }
        requests.removeAll(where: { !$0.isPending() })
        guard !requests.isEmpty else { return }
        let state = readState()
        guard state.canPresent else {
            record(!state.appActive ? .waitingForActivation : state.attachedSheet ? .waitingForExistingSheet : .waitingForOwnerWindow, state)
            return
        }
        let next = requests.removeFirst()
        presentingID = next.id
        record(.presenting, state)
        next.present()
    }
}
