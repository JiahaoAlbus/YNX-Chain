import XCTest
@testable import YNXBrowserCore

final class BrowserSessionTests: XCTestCase {
    func testNativeHomeRestoresWithoutNetworkHistoryOrPrivateState() throws {
        let suite = "com.ynx.browser.home.tests.\(UUID())"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let home = BrowserSessionTab(id: UUID(), url: BrowserLocalProfile.homeURL, title: "New Tab", isPrivate: false)
        let privateHome = BrowserSessionTab(id: UUID(), url: BrowserLocalProfile.homeURL, title: "Private", isPrivate: true)
        let forged = BrowserSessionTab(id: UUID(), url: BrowserLocalProfile.homeURL + "?script=1", title: "Rejected", isPrivate: false)
        BrowserLocalProfile.persistTabs([home, privateHome, forged], defaults: defaults)
        XCTAssertEqual(BrowserLocalProfile.restoreBrowserSession(defaults: defaults), [home])
        BrowserLocalProfile.recordVisit(home, defaults: defaults)
        XCTAssertNil(defaults.object(forKey: "history"))
        XCTAssertFalse(BrowserLocalProfile.updateBookmark(defaults: defaults, url: home.url, title: home.title, remove: false))
    }
    func testP0503PersistAndReopenOnlyNormalTabsAndHistory() throws {
        let suite = "com.ynx.browser.session.tests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let normal = BrowserSessionTab(id: UUID(), url: "https://www.wikipedia.org/", title: "Wikipedia", isPrivate: false, crashed: true)
        let secret = BrowserSessionTab(id: UUID(), url: "https://private.test/", title: "private title", isPrivate: true)
        BrowserLocalProfile.persistTabs([normal, secret], defaults: defaults)
        BrowserLocalProfile.recordVisit(normal, defaults: defaults)
        BrowserLocalProfile.recordVisit(secret, defaults: defaults)
        defaults.synchronize()
        let reopened = UserDefaults(suiteName: suite)!
        XCTAssertEqual(BrowserLocalProfile.restoreBrowserSession(defaults: reopened), [normal])
        let stored = String(decoding: try XCTUnwrap(reopened.data(forKey: "tabs")), as: UTF8.self)
        XCTAssertFalse(stored.contains("private"))
        let visits = try JSONDecoder().decode([BrowserVisitRecord].self, from: XCTUnwrap(reopened.data(forKey: "history")))
        XCTAssertEqual(visits.map(\.url), [normal.url])
        XCTAssertNil(reopened.object(forKey: "selectedSources"))
    }
    func testP0503RestoreRefusesPrivateUnsafeAndDuplicateLegacyRecords() throws {
        let suite = "com.ynx.browser.session.tests.\(UUID())"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let normal = BrowserSessionTab(id: UUID(), url: "https://example.org/", title: "Normal", isPrivate: false)
        let secret = BrowserSessionTab(id: UUID(), url: "https://private.test/", title: "Private", isPrivate: true)
        let unsafe = BrowserSessionTab(id: UUID(), url: "file:///etc/passwd", title: "Invalid", isPrivate: false)
        defaults.set(try JSONEncoder().encode([normal, normal, secret, unsafe]), forKey: "tabs")
        XCTAssertEqual(BrowserLocalProfile.restoreBrowserSession(defaults: defaults), [normal])
    }
    func testP0508BookmarksCanonicalUpdateRemoveAndReadBack() {
        let suite = "com.ynx.browser.bookmark.tests.\(UUID())"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertTrue(BrowserLocalProfile.updateBookmark(defaults: defaults, url: "https://EXAMPLE.org:443", title: "Original", remove: false))
        XCTAssertTrue(BrowserLocalProfile.updateBookmark(defaults: defaults, url: "https://example.org/", title: "Updated", remove: false))
        let reopened = UserDefaults(suiteName: suite)!
        XCTAssertEqual(reopened.array(forKey: "bookmarks") as? [[String: String]], [["url": "https://example.org/", "title": "Updated"]])
        XCTAssertFalse(BrowserLocalProfile.updateBookmark(defaults: defaults, url: "javascript:alert(1)", title: "No", remove: false))
        XCTAssertTrue(BrowserLocalProfile.updateBookmark(defaults: defaults, url: "https://example.org/", title: "", remove: true))
        XCTAssertEqual((reopened.array(forKey: "bookmarks") as? [[String: String]])?.count, 0)
    }

    func testP0503RepeatedCompletionUpdatesMostRecentVisit() throws {
        let suite = "com.ynx.browser.history.tests.\(UUID())"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var tab = BrowserSessionTab(id: UUID(), url: "https://www.baidu.com/", title: "", isPrivate: false)
        for index in 0..<18 {
            tab.title = index == 17 ? "百度一下" : ""
            BrowserLocalProfile.recordVisit(tab, defaults: defaults, at: Date(timeIntervalSince1970: Double(index)))
        }
        let visits = try JSONDecoder().decode([BrowserVisitRecord].self, from: XCTUnwrap(defaults.data(forKey: "history")))
        XCTAssertEqual(visits.count, 1)
        XCTAssertEqual(visits.first?.url, tab.url)
        XCTAssertEqual(visits.first?.title, "百度一下")
        XCTAssertEqual(visits.first?.visitedAt, Date(timeIntervalSince1970: 17))
    }

    func testP0503SameURLUpdatePreservesAllEarlierRowsAndNeverMergesAcrossURLs() throws {
        let suite = "com.ynx.browser.history.tests.\(UUID())"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let url = "https://www.baidu.com/"
        let existing = [
            BrowserVisitRecord(url: url, title: "", visitedAt: Date(timeIntervalSince1970: 4)),
            BrowserVisitRecord(url: url, title: "Prior blank completion", visitedAt: Date(timeIntervalSince1970: 3)),
            BrowserVisitRecord(url: "https://www.apple.com/", title: "Apple", visitedAt: Date(timeIntervalSince1970: 2)),
            BrowserVisitRecord(url: url, title: "Older visit", visitedAt: Date(timeIntervalSince1970: 1))
        ]
        defaults.set(try JSONEncoder().encode(existing), forKey: "history")
        var tab = BrowserSessionTab(id: UUID(), url: url, title: "Updated", isPrivate: false)
        BrowserLocalProfile.recordVisit(tab, defaults: defaults, at: Date(timeIntervalSince1970: 5))
        var visits = try JSONDecoder().decode([BrowserVisitRecord].self, from: XCTUnwrap(defaults.data(forKey: "history")))
        XCTAssertEqual(visits.count, existing.count)
        XCTAssertEqual(visits.first?.title, "Updated")
        XCTAssertEqual(visits.first?.visitedAt, Date(timeIntervalSince1970: 5))
        XCTAssertEqual(visits.dropFirst().map(\.url), existing.dropFirst().map(\.url))
        XCTAssertEqual(visits.dropFirst().map(\.title), existing.dropFirst().map(\.title))
        XCTAssertEqual(visits.dropFirst().map(\.visitedAt), existing.dropFirst().map(\.visitedAt))

        tab.url = "https://www.apple.com/"; tab.title = "Apple latest"
        BrowserLocalProfile.recordVisit(tab, defaults: defaults, at: Date(timeIntervalSince1970: 6))
        tab.url = url; tab.title = "Returned to Baidu"
        BrowserLocalProfile.recordVisit(tab, defaults: defaults, at: Date(timeIntervalSince1970: 7))
        visits = try JSONDecoder().decode([BrowserVisitRecord].self, from: XCTUnwrap(defaults.data(forKey: "history")))
        XCTAssertEqual(visits.count, existing.count + 2)
        XCTAssertEqual(visits.prefix(3).map(\.url), [url, "https://www.apple.com/", url])
        XCTAssertEqual(visits.dropFirst(3).map(\.title), existing.dropFirst().map(\.title))
    }

    func testP0503EmptyTitlesUseHostAndPrivateCompletionWritesNothing() throws {
        let suite = "com.ynx.browser.history.tests.\(UUID())"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var tab = BrowserSessionTab(id: UUID(), url: "https://www.baidu.com/path", title: "", isPrivate: false)
        for title in ["", " \t\n "] {
            tab.title = title
            BrowserLocalProfile.recordVisit(tab, defaults: defaults)
            let visits = try JSONDecoder().decode([BrowserVisitRecord].self, from: XCTUnwrap(defaults.data(forKey: "history")))
            XCTAssertEqual(visits.first?.title, "www.baidu.com")
        }
        let beforePrivate = try XCTUnwrap(defaults.data(forKey: "history"))
        let secret = BrowserSessionTab(id: tab.id, url: tab.url, title: "Private title", isPrivate: true)
        BrowserLocalProfile.recordVisit(secret, defaults: defaults)
        XCTAssertEqual(defaults.data(forKey: "history"), beforePrivate)
    }
}
