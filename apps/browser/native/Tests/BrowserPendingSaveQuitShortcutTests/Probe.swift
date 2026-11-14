import AppKit

@MainActor private final class ProbeApplication: NSApplication {
    var quitActions = 0
    override func terminate(_ sender: Any?) { quitActions += 1 }
}

@main private struct PendingSaveQuitProbe {
    @MainActor static func main() throws {
        let app = ProbeApplication.shared as! ProbeApplication
        app.setActivationPolicy(.prohibited)
        let root = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        root.autoenablesItems = false; appMenu.autoenablesItems = false
        let quit = appMenu.addItem(withTitle: "Quit Probe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        BrowserPendingSaveQuitShortcut.configureQuitItem(quit, application: app)
        appItem.submenu = appMenu; root.addItem(appItem); app.mainMenu = root
        let bridge = BrowserPendingSaveQuitShortcut()
        defer { bridge.stop() }
        let first = NSObject(), second = NSObject(), foreignTarget = NSObject()
        func key(_ text: String = "q", _ flags: NSEvent.ModifierFlags = [.command], type: NSEvent.EventType = .keyDown) -> NSEvent {
            NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: 0,
                windowNumber: 0, context: nil, characters: text, charactersIgnoringModifiers: text,
                isARepeat: false, keyCode: 12)!
        }
        let commandQ = key()
        precondition(bridge.handle(commandQ, application: app) === commandQ)
        precondition(!bridge.isMonitoring && app.quitActions == 0)
        bridge.begin(first); bridge.begin(first); bridge.begin(second)
        precondition(bridge.isMonitoring)
        for flags: NSEvent.ModifierFlags in [[], [.shift], [.option], [.command, .shift], [.command, .control], [.command, .option]] {
            let event = key("q", flags)
            precondition(bridge.handle(event, application: app) === event)
        }
        for event in [key("w"), key("q", [.command], type: .keyUp)] {
            precondition(bridge.handle(event, application: app) === event)
        }
        precondition(app.quitActions == 0)
        quit.isEnabled = false
        precondition(bridge.handle(commandQ, application: app) === commandQ && app.quitActions == 0)
        quit.isEnabled = true; quit.isHidden = true
        precondition(bridge.handle(commandQ, application: app) === commandQ && app.quitActions == 0)
        quit.isHidden = false; quit.target = foreignTarget
        precondition(bridge.handle(commandQ, application: app) === commandQ && app.quitActions == 0)
        quit.target = app; quit.keyEquivalent = "x"
        precondition(bridge.handle(commandQ, application: app) === commandQ && app.quitActions == 0)
        quit.keyEquivalent = "q"
        precondition(bridge.handle(commandQ, application: app) == nil && app.quitActions == 1)
        bridge.end(first)
        precondition(bridge.isMonitoring)
        // Exercise AppKit's real app-local dispatch without a window, real keyboard, panel,
        // application activation, global hook or actual process termination.
        app.sendEvent(commandQ)
        precondition(app.quitActions == 2, "local dispatch must send exactly one Quit action")
        bridge.end(second)
        precondition(!bridge.isMonitoring)
        precondition(bridge.handle(commandQ, application: app) === commandQ && app.quitActions == 2)
        bridge.begin(first); bridge.stop(); bridge.stop()
        precondition(!bridge.isMonitoring)
        let result: [String: Any] = [
            "schema": "YNX_PENDING_SAVE_QUIT_PUBLIC_APPKIT_DELTA_V1",
            "mechanismStatus": "PASS", "quitMenuActions": app.quitActions,
            "modifierAndUnrelatedKeysPassThrough": true,
            "disabledHiddenForeignTargetAndChangedEquivalentPassThrough": true,
            "multiplePendingDecisionLifecycle": true, "ownerStopRemovesMonitor": true,
            "realAppKitLocalSendEvent": true,
            "visibleGUI": "NOT_RUN", "NSSavePanel": "NOT_RUN",
            "installedModalKeyDelivery": "NOT_RUN", "actualProcessQuit": "NOT_RUN",
            "network": "NOT_RUN"
        ]
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
}
