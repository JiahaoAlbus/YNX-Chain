import AppKit
import CryptoKit
import Security
import OSLog
import YNXBrowserCore

enum BrowserRoutedLaunchError: Error { case unverifiedPackage, unexpectedProcess }

/// LaunchServices gives each routed mode its own app/process responsibility. The filter still
/// requires actual NE source-app attribution; this launch alone grants no network admission.
@MainActor enum BrowserRoutedApplicationLauncher {
    static func launch(_ mode: PrivacyRouteMode) async throws {
        let application = try BrowserRoutedPackage.verifiedApplication(mode, in: .main)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.arguments = ["--ynx-routed-mode", mode.launchValue]
        // No URL, private profile, history, Wallet token, target or parent launch environment is sent.
        configuration.environment = ["PATH": "/usr/bin:/bin"]
        let launched = try await NSWorkspace.shared.openApplication(at: application, configuration: configuration)
        guard launched.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              launched.bundleURL?.standardizedFileURL.path == application.path else { throw BrowserRoutedLaunchError.unexpectedProcess }
    }
}

enum BrowserRoutedPackage {
    static func verifiedApplication(_ mode: PrivacyRouteMode, in parentBundle: Bundle) throws -> URL {
        let parent = parentBundle.bundleURL.standardizedFileURL
        let application = parent.appendingPathComponent("Contents/Helpers/\(mode.applicationName)").standardizedFileURL
        guard application.resolvingSymlinksInPath() == application,
              let bundle = Bundle(url: application), bundle.bundleIdentifier == mode.bundleIdentifier,
              bundle.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") as? String == mode.launchValue,
              bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil,
              let pins = parentBundle.object(forInfoDictionaryKey: "YNXRoutedExecutableSHA256") as? [String: String],
              let expected = pins[mode.launchValue], expected.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let executable = bundle.executableURL?.standardizedFileURL, executable.resolvingSymlinksInPath() == executable,
              SHA256.hash(data: try Data(contentsOf: executable)).map({ String(format: "%02x", $0) }).joined() == expected else { throw BrowserRoutedLaunchError.unverifiedPackage }
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(application as CFURL, SecCSFlags(), &code) == errSecSuccess,
              let code, SecStaticCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess else { throw BrowserRoutedLaunchError.unverifiedPackage }
        return application
    }
}

/// Contains no ordinary BrowserController, preferences, restore, URL callback or Wallet consumer.
@MainActor final class RoutedBrowserApplicationDelegate: NSObject, NSApplicationDelegate {
    private let mode: PrivacyRouteMode
    private var controller: PrivacyRouteWindowController?
    private var terminationPending = false
    #if YNX_PRIVACY_ACCEPTANCE
    private var acceptanceLaunch: ProtectedAcceptanceDispatcher.Launch?
    private var acceptanceDispatcher: ProtectedAcceptanceDispatcher?
    private var acceptanceCleanupUnknown = false
    private var syntheticController: ProtectedSyntheticWindowController?
    convenience init(acceptanceLaunch: ProtectedAcceptanceDispatcher.Launch) {
        self.init(mode: acceptanceLaunch.mode); self.acceptanceLaunch = acceptanceLaunch
    }
    #endif
    init(mode: PrivacyRouteMode) { self.mode = mode }
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard NSRunningApplication.current.bundleURL?.standardizedFileURL.path == Bundle.main.bundleURL.standardizedFileURL.path,
              Bundle.main.bundleIdentifier == mode.bundleIdentifier else { NSApp.terminate(nil); return }
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit \(mode.rawValue)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem); NSApp.mainMenu = menu
        #if YNX_PRIVACY_ACCEPTANCE
        if let acceptanceLaunch {
            do {
                let dispatcher = try ProtectedAcceptanceDispatcher(launch: acceptanceLaunch,
                    hostFactory: { self }, record: { [weak self] record in
                        guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
                        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
                        if record["kind"] == "cleanup-unknown" { self?.acceptanceCleanupUnknown = true }
                        if record["kind"] == "whole-window-closed" { self?.acceptanceCleanupUnknown = false }
                        if record["kind"] == "finished", self?.acceptanceCleanupUnknown == false {
                            DispatchQueue.main.async { NSApp.terminate(nil) }
                        }
                    })
                acceptanceDispatcher = dispatcher; dispatcher.startCommandLoop()
            } catch {
                FileHandle.standardError.write(Data("Protected acceptance dispatcher refused before page startup.\n".utf8))
                NSApp.terminate(nil)
            }
            return
        }
        #endif
        let window = PrivacyRouteWindowController(mode: mode)
        controller = window; window.showWindow(nil); window.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        #if YNX_PRIVACY_ACCEPTANCE
        if acceptanceLaunch != nil { return false } // Explicit close/rebuild keeps the command owner alive.
        #endif
        return true
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        Task { @MainActor [weak self] in
            guard let self else { sender.reply(toApplicationShouldTerminate: false); return }
            #if YNX_PRIVACY_ACCEPTANCE
            await acceptanceDispatcher?.terminate()
            guard !acceptanceCleanupUnknown else {
                terminationPending = false; syntheticController?.presentCleanupBlocked()
                sender.reply(toApplicationShouldTerminate: false); return
            }
            #endif
            var confirmed = await controller?.shutdown() ?? true
            #if YNX_PRIVACY_ACCEPTANCE
            if let syntheticController { confirmed = await syntheticController.shutdown() && confirmed }
            #endif
            terminationPending = false
            if !confirmed { controller?.presentCleanupBlocked() }
            sender.reply(toApplicationShouldTerminate: confirmed)
        }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) {
        #if YNX_PRIVACY_ACCEPTANCE
        acceptanceDispatcher = nil
        syntheticController = nil
        #endif
        controller = nil
    }
}

#if YNX_PRIVACY_ACCEPTANCE
extension RoutedBrowserApplicationDelegate: ProtectedAcceptanceWindowHosting {
    func openAcceptanceRoute(mode: PrivacyRouteMode, runID: String, inputs: ProtectedAcceptanceTrialInputs) async throws -> ProtectedAcceptanceAttachment {
        guard acceptanceLaunch != nil, self.mode == mode, syntheticController == nil, !terminationPending else { throw PrivacyRouteError.stale }
        let next = ProtectedSyntheticWindowController(mode: mode)
        syntheticController = next; next.showWindow(nil); next.window?.makeKeyAndOrderFront(nil)
        return try await next.start(runID: runID, inputs: inputs)
    }
    func closeAcceptanceRoute() async -> Bool {
        guard acceptanceLaunch != nil, let current = syntheticController else { return false }
        let confirmed = await current.shutdown()
        guard confirmed else { current.presentCleanupBlocked(); return false }
        current.close(); syntheticController = nil
        return true
    }
}
#endif
