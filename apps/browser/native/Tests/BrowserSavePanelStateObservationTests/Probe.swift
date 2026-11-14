import AppKit

@main private struct SavePanelStateProbe {
    @MainActor static func nextTurn() async {
        await withCheckedContinuation { continuation in DispatchQueue.main.async { continuation.resume() } }
    }

    @MainActor static func main() async throws {
        let notifications = NotificationCenter(), owner = NSObject(), application = NSObject(), foreign = NSObject()
        let validationObserver = BrowserSavePanelValidationObservation { _, _ in preconditionFailure("no panel was created") }
        precondition(!validationObserver.responds(to: #selector(NSWindowDelegate.windowWillClose(_:))))
        precondition(!validationObserver.responds(to: #selector(NSWindowDelegate.windowDidBecomeKey(_:))))
        var active = false, key = false, attached = false
        var observed: [(BrowserSavePanelStateObservation.Event, [String: Bool])] = []
        let observer = BrowserSavePanelStateObservation(notifications: notifications, owner: owner, application: application,
            readState: { .init(appActive: active, ownerKey: key, ownerMain: key,
                              ownerVisible: true, ownerMiniaturized: false, attachedSheet: attached) },
            record: { observed.append(($0, $1.evidence)) })
        let first = NSObject(), second = NSObject(), cancelled = NSObject(), stale = NSObject()
        observer.begin(first); observer.begin(second)
        precondition(observer.isObserving && observed.count == 2)
        precondition(observed[0].0 == .request && observed[0].1["appActive"] == false)
        notifications.post(name: NSApplication.didBecomeActiveNotification, object: foreign)
        notifications.post(name: NSWindow.didBecomeKeyNotification, object: foreign)
        precondition(observed.count == 2, "foreign app/window notifications must not be observed")
        active = true
        notifications.post(name: NSApplication.didBecomeActiveNotification, object: application)
        key = true
        notifications.post(name: NSWindow.didBecomeKeyNotification, object: owner)
        attached = true
        notifications.post(name: NSWindow.willBeginSheetNotification, object: owner)
        precondition(observed.map { $0.0 } == [.request, .request, .appBecameActive, .ownerBecameKey, .sheetBegan])
        precondition(observed.last?.1["hostAttachedSheet"] == true)
        precondition(observed[2].1["appActive"] == true && observed[2].1["ownerKey"] == false)
        observer.end(first)
        precondition(observer.isObserving)
        observer.end(second)
        let endedCount = observed.count
        notifications.post(name: NSApplication.didResignActiveNotification, object: application)
        precondition(!observer.isObserving && observed.count == endedCount)
        observer.begin(first)
        notifications.post(name: NSWindow.willCloseNotification, object: owner)
        precondition(!observer.isObserving && observed.last?.0 == .ownerClosed)
        let closedCount = observed.count
        notifications.post(name: NSWindow.didEndSheetNotification, object: owner)
        precondition(observed.count == closedCount)
        let allowedKeys: Set<String> = ["appActive", "ownerKey", "ownerMain", "ownerVisible", "ownerMiniaturized", "hostAttachedSheet"]
        precondition(observed.allSatisfy { Set($0.1.keys) == allowedKeys })

        // The candidate queue is intentionally not connected to main.swift/build18 behavior.
        // Exercise only its future contract with injected state and synthetic notifications.
        active = false; key = false; attached = false
        var presented: [String] = [], queueEvents: [BrowserDownloadSavePresentation.Event] = []
        let queue = BrowserDownloadSavePresentation(notifications: notifications, owner: owner, application: application,
            readState: { .init(appActive: active, ownerKey: key, ownerMain: key,
                              ownerVisible: true, ownerMiniaturized: false, attachedSheet: attached) },
            record: { queueEvents.append($0); _ = $1 })
        queue.request(first, isPending: { true }) { presented.append("first"); attached = true }
        queue.request(first, isPending: { true }) { preconditionFailure("duplicate decision") }
        await nextTurn()
        precondition(presented.isEmpty && queueEvents.last == .waitingForActivation)
        active = true
        notifications.post(name: NSApplication.didBecomeActiveNotification, object: application)
        await nextTurn()
        precondition(presented.isEmpty && queueEvents.last == .waitingForOwnerWindow)
        key = true; attached = true
        notifications.post(name: NSWindow.didBecomeKeyNotification, object: owner)
        await nextTurn()
        precondition(presented.isEmpty && queueEvents.last == .waitingForExistingSheet)
        attached = false
        notifications.post(name: NSWindow.didEndSheetNotification, object: owner)
        await nextTurn()
        precondition(presented == ["first"])
        queue.request(second, isPending: { true }) { presented.append("second"); attached = true }
        queue.finish(first, cancelled: false)
        await nextTurn()
        precondition(presented == ["first"], "completion alone cannot bypass a still-attached sheet")
        attached = false
        notifications.post(name: NSWindow.didEndSheetNotification, object: owner)
        await nextTurn()
        precondition(presented == ["first", "second"])
        queue.finish(second, cancelled: true)
        attached = false; active = false
        queue.request(cancelled, isPending: { true }) { preconditionFailure("cancelled queue item resurrected") }
        queue.finish(cancelled, cancelled: true)
        queue.request(stale, isPending: { false }) { preconditionFailure("revoked decision presented") }
        active = true
        notifications.post(name: NSApplication.didBecomeActiveNotification, object: application)
        await nextTurn()
        precondition(queue.queuedCount == 0 && presented == ["first", "second"])
        queue.request(first, isPending: { true }) { preconditionFailure("closed owner presented") }
        notifications.post(name: NSWindow.willCloseNotification, object: owner)
        await nextTurn()
        precondition(queue.queuedCount == 0)
        queue.stop(); observer.stop()
        let receipt: [String: Any] = ["schema": "YNX_SAVE_PANEL_OBSERVATION_DELTA_V1",
            "observerSyntheticNotificationContract": "PASS", "strictBooleanSnapshotKeys": true,
            "ownAppAndOwnerFilters": true, "multiDecisionStopAndRestart": true,
            "panelDelegateDoesNotReceiveOwnerWindowLifecycle": true,
            "unwiredPresentationQueueContract": "PASS", "productionQueueWiring": "NOT_ENABLED",
            "actualActivation": "NOT_RUN", "visibleGUI": "NOT_RUN", "NSSavePanel": "NOT_RUN",
            "saveButtonAcceptance": "NOT_RUN", "installedDownload": "NOT_RUN", "network": "NOT_RUN"]
        let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
}
