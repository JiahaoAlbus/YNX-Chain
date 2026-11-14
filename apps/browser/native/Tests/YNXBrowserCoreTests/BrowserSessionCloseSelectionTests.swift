import Foundation
#if !YNX_SESSION_CLOSE_PROBE
import XCTest
@testable import YNXBrowserCore
#endif

private enum SessionCloseChecks {
    static func recordingDelta() throws -> Int {
        var state = BrowserSessionPersistenceSelection()
        func check(_ value: Bool, _ label: String) throws {
            guard value else { throw NSError(domain: "SessionRecordingDelta." + label, code: 1) }
        }
        let page = BrowserSessionTab(id: UUID(), url: "https://example.org/PUBLIC", title: "PUBLIC", isPrivate: false)
        try check(state.allowsRecording, "initial-local-recording")
        _ = state.clear()
        try check(!state.allowsRecording, "clear-suppresses-history-and-session")
        _ = state.update(openOrdinaryWindows: [[page]])
        _ = state.windowClosed(tabs: [page], isPrivate: false, survivingOrdinaryWindows: [])
        _ = state.willQuit(openOrdinaryWindows: [[page]])
        try check(!state.allowsRecording, "passive-late-title-finish-close-quit-cannot-reenable")
        state.beginOrdinarySession()
        try check(state.allowsRecording, "explicit-new-user-session-reenables")
        return 4
    }
    static func run() throws -> Int {
        var checks = 0
        func check(_ result: Bool, _ label: String) throws {
            guard result else { throw NSError(domain: "SessionCloseDelta." + label, code: 1) }
            checks += 1
        }
        func tab(_ url: String, privateMode: Bool = false) -> BrowserSessionTab {
            BrowserSessionTab(id: UUID(), url: url, title: url, isPrivate: privateMode)
        }
        let first = tab("https://example.org/first"), second = tab("https://example.org/second")
        let secret = tab("https://PUBLIC-secret.invalid/private", privateMode: true)
        let home = tab(BrowserLocalProfile.homeURL), emptyURL = tab("")
        let unsafe = tab("file:///PUBLIC-not-read"), forgedHome = tab(BrowserLocalProfile.homeURL + "?script=1")
        let suite = "com.ynx.browser.PUBLIC-session-close.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func persist(_ selection: [BrowserSessionTab]?) {
            if let selection { BrowserLocalProfile.persistTabs(selection, defaults: defaults) }
        }
        // Exact old persistence sequence: last window excluded -> [] -> cold-read loses tabs.
        BrowserLocalProfile.persistTabs([first], defaults: defaults)
        BrowserLocalProfile.persistTabs([], defaults: defaults)
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults).isEmpty, "legacy-last-close-loss-reproduced")

        var selector = BrowserSessionPersistenceSelection()
        let close = selector.windowClosed(tabs: [first, secret], isPrivate: false, survivingOrdinaryWindows: [])
        try check(close == [first], "last-ordinary-retained-private-filtered")
        persist(close)
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [first], "same-tabs-key-roundtrip")
        persist(selector.update(openOrdinaryWindows: []))
        persist(selector.willQuit(openOrdinaryWindows: []))
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [first], "autoquit-does-not-overwrite-last-close")
        let freshDefaults = UserDefaults(suiteName: suite)!
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: freshDefaults) == [first], "new-profile-reader-retains-last-close")
        let stored = String(decoding: defaults.data(forKey: "tabs")!, as: UTF8.self)
        try check(!stored.contains("PUBLIC-secret") && defaults.dictionaryRepresentation()["selectedSources"] == nil, "no-private-or-page-context-persistence")

        selector.beginOrdinarySession()
        try check(selector.update(openOrdinaryWindows: [[first], [second, secret]]) == [first, second], "all-live-ordinary-windows")
        persist(selector.windowClosed(tabs: [first], isPrivate: false, survivingOrdinaryWindows: [[second]]))
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [second], "survivors-win-over-closed-window")
        try check(selector.willQuit(openOrdinaryWindows: [[second]]) == [second], "direct-quit-only-live-windows")
        persist(selector.windowClosed(tabs: [second], isPrivate: false, survivingOrdinaryWindows: []))
        persist(selector.willQuit(openOrdinaryWindows: []))
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [second], "last-of-many-does-not-resurrect-first")

        let privacyBefore = selector.willQuit(openOrdinaryWindows: [])
        try check(selector.windowClosed(tabs: [secret, first], isPrivate: true, survivingOrdinaryWindows: []) == privacyBefore,
                  "private-window-cannot-establish-fallback-even-mislabelled-record")
        var privateOnly = BrowserSessionPersistenceSelection()
        let before = defaults.data(forKey: "tabs")
        persist(privateOnly.windowClosed(tabs: [secret], isPrivate: true, survivingOrdinaryWindows: []))
        try check(defaults.data(forKey: "tabs") == before, "private-only-event-leaves-existing-key-untouched")
        try check(privateOnly.willQuit(openOrdinaryWindows: []) == nil, "no-owner-no-empty-overwrite")

        try check(selector.windowClosed(tabs: [home, emptyURL, unsafe, forgedHome, secret, home], isPrivate: false,
                                        survivingOrdinaryWindows: []) == [home], "native-home-only-and-existing-filter")
        try check(selector.willQuit(openOrdinaryWindows: []) == [home], "home-retained-on-quit")
        try check(selector.windowClosed(tabs: [], isPrivate: false, survivingOrdinaryWindows: []) == [], "legitimate-empty-last-window")
        try check(selector.willQuit(openOrdinaryWindows: []) == [], "empty-last-close-is-not-older-fallback")
        _ = selector.windowClosed(tabs: [first], isPrivate: false, survivingOrdinaryWindows: [])
        try check(selector.update(openOrdinaryWindows: [[]]) == [], "live-empty-window-supersedes-old-last-close")

        _ = selector.windowClosed(tabs: [first], isPrivate: false, survivingOrdinaryWindows: [])
        selector.beginOrdinarySession()
        try check(selector.willQuit(openOrdinaryWindows: []) == nil, "new-session-clears-old-fallback-only")
        persist(selector.update(openOrdinaryWindows: [[second, secret]]))
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [second], "new-ordinary-window-wins")
        try check(selector.update(openOrdinaryWindows: [[first, first], [secret, second]]) == [first, second], "original-id-dedup-across-windows")

        _ = selector.windowClosed(tabs: [first], isPrivate: false, survivingOrdinaryWindows: [])
        persist(selector.clear())
        persist(selector.update(openOrdinaryWindows: [[first]]))
        persist(selector.windowClosed(tabs: [first], isPrivate: false, survivingOrdinaryWindows: [[second]]))
        persist(selector.willQuit(openOrdinaryWindows: [[second]]))
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [], "explicit-clear-wins-over-late-update-close-quit")
        try check(selector.willQuit(openOrdinaryWindows: []) == [], "clear-cannot-revive-cached-fallback")
        selector.beginOrdinarySession()
        persist(selector.update(openOrdinaryWindows: [[home]]))
        try check(BrowserLocalProfile.restoreBrowserSession(defaults: defaults) == [home], "new-explicit-session-resumes-after-clear")

        var returned = selector.windowClosed(tabs: [first], isPrivate: false, survivingOrdinaryWindows: [])!
        returned[0].title = "PUBLIC-external-mutation"
        try check(selector.willQuit(openOrdinaryWindows: []) == [first], "detached-value-copy")
        return checks
    }
}

#if YNX_SESSION_CLOSE_PROBE
@main struct SessionCloseProbe {
    static func main() throws {
        if CommandLine.arguments.dropFirst().contains("--recording-only") {
            print("SESSION_RECORDING_DELTA \(try SessionCloseChecks.recordingDelta()) checks PASS; no old close checks rerun; no GUI/network")
        } else {
            print("SESSION_CLOSE_DELTA \(try SessionCloseChecks.run()) checks PASS; original tabs key; isolated PUBLIC preferences only; no GUI/network")
        }
    }
}
#else
final class BrowserSessionCloseSelectionTests: XCTestCase {
    func testCloseQuitClearAndNewOrdinaryWindowSelection() throws { _ = try SessionCloseChecks.run() }
    func testExplicitClearSuppressesPassiveRecordingUntilUserSession() throws { _ = try SessionCloseChecks.recordingDelta() }
}
#endif
