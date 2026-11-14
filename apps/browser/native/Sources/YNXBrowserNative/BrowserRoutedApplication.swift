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
    init(mode: PrivacyRouteMode) { self.mode = mode }
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard NSRunningApplication.current.bundleURL?.standardizedFileURL.path == Bundle.main.bundleURL.standardizedFileURL.path,
              Bundle.main.bundleIdentifier == mode.bundleIdentifier else { NSApp.terminate(nil); return }
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit \(mode.rawValue)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem); NSApp.mainMenu = menu
        let window = PrivacyRouteWindowController(mode: mode)
        controller = window; window.showWindow(nil); window.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { controller?.close(); controller = nil }
}
