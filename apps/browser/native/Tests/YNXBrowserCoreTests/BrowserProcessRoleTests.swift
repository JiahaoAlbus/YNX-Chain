import Testing
@testable import YNXBrowserCore

struct BrowserProcessRoleTests {
    @Test func dedicatedModesCannotRestoreOrdinarySession() throws {
        #expect(try BrowserProcessRole.resolve(arguments: ["browser"], bundleMode: nil) == .ordinary)
        for mode in PrivacyRouteMode.allCases {
            #expect(try BrowserProcessRole.resolve(arguments: ["browser", "--ynx-routed-mode", mode.launchValue], bundleMode: mode.launchValue) == .routed(mode))
            // A routed bundle opened without its mode argument must never fall through to Standard.
            #expect(throws: BrowserProcessRoleError.self) { try BrowserProcessRole.resolve(arguments: ["browser"], bundleMode: mode.launchValue) }
            #expect(throws: BrowserProcessRoleError.self) { try BrowserProcessRole.resolve(arguments: ["browser", "--ynx-routed-mode", mode.launchValue], bundleMode: nil) }
            #expect(throws: BrowserProcessRoleError.self) { try BrowserProcessRole.resolve(arguments: ["browser", "--ynx-routed-mode", mode.launchValue, "https://duckduckgo.com/"], bundleMode: mode.launchValue) }
        }
    }
    @Test func malformedOrCrossModeLaunchFailsBeforeAnyDelegate() {
        for args in [
            ["--ynx-routed-mode=tor"], ["--ynx-routed-mode"], ["--ynx-routed-mode-extra", "tor"],
            ["--ynx-routed-mode", "nym"], ["--ynx-routed-mode", "tor", "--ynx-routed-mode", "tor"],
            ["--p05-synthetic-run", "anything"], ["ynxbrowser://auth/callback"]
        ] {
            #expect(throws: BrowserProcessRoleError.self) { try BrowserProcessRole.resolve(arguments: ["browser"] + args, bundleMode: "tor") }
        }
        #expect(throws: BrowserProcessRoleError.self) { try BrowserProcessRole.resolve(arguments: ["browser"], bundleMode: "unknown") }
    }
}
