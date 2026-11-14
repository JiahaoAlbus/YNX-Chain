import Foundation

public struct BrowserSessionTab: Codable, Equatable, Sendable {
    public let id: UUID
    public var url: String
    public var title: String
    public let isPrivate: Bool
    public var crashed: Bool
    public var group: String?

    public init(id: UUID, url: String, title: String, isPrivate: Bool, crashed: Bool = false, group: String? = nil) {
        self.id = id; self.url = url; self.title = title; self.isPrivate = isPrivate; self.crashed = crashed; self.group = group
    }
}

public struct BrowserVisitRecord: Codable, Sendable {
    public let url: String
    public let title: String
    public let visitedAt: Date
}

/// Reuses the original local profile keys. Temporary page selections and permissions never enter session data.
public enum BrowserLocalProfile {
    public static let homeURL = "ynx-browser://newtab"
    public static func persistTabs(_ tabs: [BrowserSessionTab], defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(ordinaryTabs(tabs)) { defaults.set(data, forKey: "tabs") }
    }

    public static func restoreBrowserSession(defaults: UserDefaults) -> [BrowserSessionTab] {
        guard let data = defaults.data(forKey: "tabs"), let tabs = try? JSONDecoder().decode([BrowserSessionTab].self, from: data) else { return [] }
        return ordinaryTabs(tabs)
    }

    private static func ordinaryTabs(_ tabs: [BrowserSessionTab]) -> [BrowserSessionTab] {
        var seen = Set<UUID>()
        return tabs.filter { tab in
            guard !tab.isPrivate, !seen.contains(tab.id) else { return false }
            guard tab.url == homeURL || URL(string: tab.url).map(BrowserOmnibox.isNavigable) == true else { return false }
            seen.insert(tab.id); return true
        }
    }

    public static func recordVisit(_ tab: BrowserSessionTab, defaults: UserDefaults, at date: Date = Date()) {
        guard !tab.isPrivate, let url = URL(string: tab.url), BrowserOmnibox.isNavigable(url) else { return }
        var values = (try? JSONDecoder().decode([BrowserVisitRecord].self, from: defaults.data(forKey: "history") ?? Data())) ?? []
        let trimmedTitle = tab.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let visit = BrowserVisitRecord(url: tab.url, title: trimmedTitle.isEmpty ? (url.host ?? tab.url) : trimmedTitle, visitedAt: date)
        if values.first?.url == tab.url {
            // Repeated completion callbacks update this visit; earlier records remain untouched.
            values[0] = visit
        } else {
            values.insert(visit, at: 0)
            values = Array(values.prefix(5000))
        }
        if let data = try? JSONEncoder().encode(values) { defaults.set(data, forKey: "history") }
    }

    public static func canonicalBookmarkURL(_ input: String) -> String? {
        guard let url = URL(string: input), BrowserOmnibox.isNavigable(url), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = parts.scheme?.lowercased(); parts.host = parts.host?.lowercased()
        if (parts.scheme == "https" && parts.port == 443) || (parts.scheme == "http" && parts.port == 80) { parts.port = nil }
        if parts.path.isEmpty { parts.path = "/" }
        return parts.string
    }

    @discardableResult public static func updateBookmark(defaults: UserDefaults, url: String, title: String, remove: Bool) -> Bool {
        guard let canonical = canonicalBookmarkURL(url) else { return false }
        var values = defaults.array(forKey: "bookmarks") as? [[String: String]] ?? []
        values.removeAll { canonicalBookmarkURL($0["url"] ?? "") == canonical }
        if !remove { values.insert(["url": canonical, "title": String(title.prefix(4096))], at: 0) }
        defaults.set(values, forKey: "bookmarks")
        return true
    }
}
