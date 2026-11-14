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

    fileprivate static func ordinaryTabs(_ tabs: [BrowserSessionTab]) -> [BrowserSessionTab] {
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

    /// A late document-title notification updates metadata, not the time or number of visits.
    /// Only the current newest visit may change; private/background older visits never reopen.
    @discardableResult public static func refreshLatestVisitTitle(_ tab: BrowserSessionTab, defaults: UserDefaults) -> Bool {
        let title = tab.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tab.isPrivate, !title.isEmpty,
              let data = defaults.data(forKey: "history"),
              var values = try? JSONDecoder().decode([BrowserVisitRecord].self, from: data),
              let first = values.first, first.url == tab.url, first.title != title else { return false }
        values[0] = BrowserVisitRecord(url: first.url, title: title, visitedAt: first.visitedAt)
        guard let updated = try? JSONEncoder().encode(values) else { return false }
        defaults.set(updated, forKey: "history")
        return true
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

/// In-memory selection for the original `tabs` profile key. One instance belongs to the
/// ordinary-window coordinator; it contains no private-window snapshot or new disk schema.
/// A nil result means "leave the existing saved session alone"; [] is an intentional empty
/// session. Call BrowserLocalProfile.persistTabs only for a nonnil returned selection.
public struct BrowserSessionPersistenceSelection: Sendable {
    private var lastClosedOrdinaryTabs: [BrowserSessionTab]?
    private var explicitlyCleared = false
    /// Local recording preference only, not an authorization capability. Guard history/title
    /// writes with this too: passive callbacks after clear must not revive cleared records.
    public var allowsRecording: Bool { !explicitlyCleared }

    public init() {}

    /// Passive persistence (including late title/completion callbacks). Live ordinary windows
    /// supersede a closed-window fallback; no-live-window callbacks must not erase it.
    public mutating func update(openOrdinaryWindows: [[BrowserSessionTab]]) -> [BrowserSessionTab]? {
        if explicitlyCleared { return [] }
        if !openOrdinaryWindows.isEmpty {
            lastClosedOrdinaryTabs = nil
            return BrowserLocalProfile.ordinaryTabs(openOrdinaryWindows.flatMap { $0 })
        }
        return lastClosedOrdinaryTabs
    }

    /// Take the closing window's detached records before the UI discards its state. Survivors
    /// must include each still-open ordinary window (even one with zero tabs), excluding all
    /// closed/private windows. Closing a private window can never establish a fallback.
    public mutating func windowClosed(tabs: [BrowserSessionTab], isPrivate: Bool,
                                      survivingOrdinaryWindows: [[BrowserSessionTab]]) -> [BrowserSessionTab]? {
        if explicitlyCleared { return [] }
        if isPrivate || !survivingOrdinaryWindows.isEmpty {
            return update(openOrdinaryWindows: survivingOrdinaryWindows)
        }
        let selected = BrowserLocalProfile.ordinaryTabs(tabs)
        lastClosedOrdinaryTabs = selected
        return selected
    }

    /// A last-window close followed by automatic Quit must retain that last ordinary snapshot.
    /// Direct Quit with live ordinary windows saves only those windows, not older closed ones.
    public mutating func willQuit(openOrdinaryWindows: [[BrowserSessionTab]]) -> [BrowserSessionTab]? {
        update(openOrdinaryWindows: openOrdinaryWindows)
    }

    /// Explicit new ordinary-window/session activity supersedes both a previous last-close
    /// fallback and an explicit clear. Do not call from passive/late navigation-title callbacks.
    /// This only changes selection state; it does not write or erase the existing profile.
    public mutating func beginOrdinarySession() {
        lastClosedOrdinaryTabs = nil
        explicitlyCleared = false
    }

    /// Explicitly clear saved session state using the SAME original `tabs` key. A later Quit,
    /// close, or passive callback cannot resurrect old open/closed tabs. Only a new explicit
    /// ordinary session may resume persistence, through beginOrdinarySession().
    @discardableResult public mutating func clear() -> [BrowserSessionTab] {
        lastClosedOrdinaryTabs = nil
        explicitlyCleared = true
        return []
    }
}
