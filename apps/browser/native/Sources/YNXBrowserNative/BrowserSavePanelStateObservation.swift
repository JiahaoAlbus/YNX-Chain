import AppKit

/// Observes public host-app state only. It never activates, reorders or presents anything.
/// Remote NSSavePanel process focus and button validation remain unknown to this observer.
@MainActor final class BrowserSavePanelStateObservation: NSObject {
    struct State {
        let appActive: Bool
        let ownerKey: Bool
        let ownerMain: Bool
        let ownerVisible: Bool
        let ownerMiniaturized: Bool
        let attachedSheet: Bool
        var evidence: [String: Bool] {
            ["appActive": appActive, "ownerKey": ownerKey, "ownerMain": ownerMain,
             "ownerVisible": ownerVisible, "ownerMiniaturized": ownerMiniaturized,
             "hostAttachedSheet": attachedSheet]
        }
    }
    enum Event: String {
        case request, sheetBeginReturned, sheetNextMainTurn, panelAccepted, panelCancelled
        case validationRequested, directoryChanged, appBecameActive, appResignedActive
        case ownerBecameKey, ownerResignedKey, ownerBecameMain, ownerResignedMain
        case sheetBegan, sheetEnded, ownerClosed
    }
    private let notifications: NotificationCenter
    private weak var owner: NSObject?
    private weak var application: NSObject?
    private let readState: () -> State
    private let record: (Event, State) -> Void
    private var decisions = Set<ObjectIdentifier>()
    private(set) var isObserving = false

    convenience init(owner: NSWindow, application: NSApplication, record: @escaping (Event, State) -> Void) {
        self.init(notifications: .default, owner: owner, application: application, readState: { [weak owner] in
            State(appActive: application.isActive, ownerKey: owner?.isKeyWindow ?? false,
                  ownerMain: owner?.isMainWindow ?? false, ownerVisible: owner?.isVisible ?? false,
                  ownerMiniaturized: owner?.isMiniaturized ?? false, attachedSheet: owner?.attachedSheet != nil)
        }, record: record)
    }

    init(notifications: NotificationCenter, owner: NSObject, application: NSObject,
         readState: @escaping () -> State, record: @escaping (Event, State) -> Void) {
        self.notifications = notifications; self.owner = owner; self.application = application
        self.readState = readState; self.record = record
        super.init()
    }

    func begin(_ decision: AnyObject) {
        decisions.insert(ObjectIdentifier(decision))
        if !isObserving {
            isObserving = true
            for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification] {
                notifications.addObserver(self, selector: #selector(stateChanged(_:)), name: name, object: application)
            }
            for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
                         NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification,
                         NSWindow.willBeginSheetNotification, NSWindow.didEndSheetNotification,
                         NSWindow.willCloseNotification] {
                notifications.addObserver(self, selector: #selector(stateChanged(_:)), name: name, object: owner)
            }
        }
        record(.request, readState())
    }

    func end(_ decision: AnyObject) {
        decisions.remove(ObjectIdentifier(decision))
        if decisions.isEmpty { stop() }
    }

    func stop() {
        decisions.removeAll(); notifications.removeObserver(self); isObserving = false
    }

    @objc private func stateChanged(_ notification: Notification) {
        guard isObserving else { return }
        let event: Event
        switch notification.name {
        case NSApplication.didBecomeActiveNotification: event = .appBecameActive
        case NSApplication.didResignActiveNotification: event = .appResignedActive
        case NSWindow.didBecomeKeyNotification: event = .ownerBecameKey
        case NSWindow.didResignKeyNotification: event = .ownerResignedKey
        case NSWindow.didBecomeMainNotification: event = .ownerBecameMain
        case NSWindow.didResignMainNotification: event = .ownerResignedMain
        case NSWindow.willBeginSheetNotification: event = .sheetBegan
        case NSWindow.didEndSheetNotification: event = .sheetEnded
        case NSWindow.willCloseNotification: event = .ownerClosed
        default: return
        }
        record(event, readState())
        if event == .ownerClosed { stop() }
    }
}

/// Intentionally separate from the browser's NSWindowDelegate. A save panel must never
/// deliver its window lifecycle callbacks to BrowserController's owner-window teardown.
@MainActor final class BrowserSavePanelValidationObservation: NSObject, NSOpenSavePanelDelegate {
    private let record: (BrowserSavePanelStateObservation.Event, NSSavePanel) -> Void
    init(record: @escaping (BrowserSavePanelStateObservation.Event, NSSavePanel) -> Void) {
        self.record = record; super.init()
    }

    // No shouldEnable override, custom rejection or forced Save action. AppKit still
    // performs its normal validation; this optional hook only witnesses a Save attempt.
    func panel(_ sender: Any, validate url: URL) throws {
        if let panel = sender as? NSSavePanel { record(.validationRequested, panel) }
    }
    func panel(_ sender: Any, didChangeToDirectoryURL url: URL?) {
        if let panel = sender as? NSSavePanel { record(.directoryChanged, panel) }
    }
}
