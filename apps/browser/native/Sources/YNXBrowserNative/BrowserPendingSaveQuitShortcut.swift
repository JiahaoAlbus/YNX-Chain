import AppKit
import OSLog

/// A narrow app-local key-equivalent bridge while this owner awaits a download destination.
/// NSSavePanel may use an out-of-process UI; this cannot observe events that AppKit never
/// delivers to this application. It neither installs a global monitor nor changes termination.
@MainActor final class BrowserPendingSaveQuitShortcut {
    static let quitItemIdentifier = NSUserInterfaceItemIdentifier("YNXApplicationQuit")
    private var pendingDecisions = Set<ObjectIdentifier>()
    private var monitor: Any?
    private let logger = Logger(subsystem: "com.ynxweb4.browser.macos", category: "pending-save-quit")

    var isMonitoring: Bool { monitor != nil }

    static func configureQuitItem(_ item: NSMenuItem, application: NSApplication) {
        item.identifier = quitItemIdentifier
        item.target = application
        item.keyEquivalentModifierMask = [.command]
    }

    func begin(_ decision: AnyObject) {
        pendingDecisions.insert(ObjectIdentifier(decision))
        guard monitor == nil else { return }
        // NSEvent.h: local monitors run before NSApplication.sendEvent dispatch. Only the
        // application's own events are visible; nested tracking loops are outside its scope.
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let consumed = MainActor.assumeIsolated {
                guard let self else { return false }
                return self.handle(event, application: NSApp) == nil
            }
            return consumed ? nil : event
        }
    }

    func end(_ decision: AnyObject) {
        pendingDecisions.remove(ObjectIdentifier(decision))
        if pendingDecisions.isEmpty { stop() }
    }

    func stop() {
        pendingDecisions.removeAll()
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    /// Internal for the independent non-GUI AppKit delta. This does not synthesize events
    /// or call terminate directly: the real enabled menu remains the action authority.
    func handle(_ event: NSEvent, application: NSApplication) -> NSEvent? {
        guard !pendingDecisions.isEmpty, event.type == .keyDown,
              event.modifierFlags.intersection([.command, .option, .control, .shift]) == [.command],
              event.charactersIgnoringModifiers?.lowercased() == "q" else { return event }
        logger.notice("cmdQ-observed")
        guard let menu = application.mainMenu, let quit = Self.quitItem(in: menu),
              quit.isEnabled, !quit.isHiddenOrHasHiddenAncestor,
              quit.action == #selector(NSApplication.terminate(_:)),
              (quit.target as? NSApplication) === application else {
            logger.notice("menuHandled=false")
            return event
        }
        // Public NSMenu.performKeyEquivalent preserves menu validation, user key-equivalent
        // overrides and the existing terminate/delegate cleanup. Nil prevents double dispatch.
        let handled = menu.performKeyEquivalent(with: event)
        logger.notice("menuHandled=\(handled, privacy: .public)")
        return handled ? nil : event
    }

    private static func quitItem(in menu: NSMenu) -> NSMenuItem? {
        for item in menu.items {
            if item.identifier == quitItemIdentifier { return item }
            if let submenu = item.submenu, let found = quitItem(in: submenu) { return found }
        }
        return nil
    }
}
