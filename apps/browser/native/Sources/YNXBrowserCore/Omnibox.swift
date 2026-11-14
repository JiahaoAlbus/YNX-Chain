import Foundation

public enum BrowserOmniboxError: Error, Equatable {
    case emptyInput, unsafeScheme, invalidURL, invalidProvider
}

public struct BrowserSearchProvider: Codable, Equatable, Sendable {
    public let name: String
    public let template: String
    public static let duckDuckGo = try! BrowserSearchProvider(name: "DuckDuckGo", template: "https://duckduckgo.com/?q={query}")

    public init(name: String, template: String) throws {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              template.components(separatedBy: "{query}").count == 2,
              template.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              let parts = URLComponents(string: template),
              parts.scheme?.lowercased() == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.queryItems?.filter({ $0.value == "{query}" }).count == 1,
              parts.queryItems?.allSatisfy({ !$0.name.contains("{query}") }) == true,
              parts.port.map({ (1...65535).contains($0) }) ?? true else {
            throw BrowserOmniboxError.invalidProvider
        }
        self.name = name
        self.template = template
    }

    public var destinationHost: String { URLComponents(string: template)?.host ?? "" }

    public func searchURL(_ query: String) throws -> URL {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: template.replacingOccurrences(of: "{query}", with: encoded)) else {
            throw BrowserOmniboxError.invalidProvider
        }
        return url
    }
}

public enum BrowserOmnibox {
    public static func resolveOmnibox(_ input: String, provider: BrowserSearchProvider = .duckDuckGo) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw BrowserOmniboxError.emptyInput }
        if let colon = value.firstIndex(of: ":") {
            let prefix = String(value[..<colon])
            if prefix.range(of: "^[A-Za-z][A-Za-z0-9+.-]*$", options: .regularExpression) != nil {
                guard ["http", "https"].contains(prefix.lowercased()) else { throw BrowserOmniboxError.unsafeScheme }
                guard let url = URL(string: value), isNavigable(url),
                      value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { throw BrowserOmniboxError.invalidURL }
                return url
            }
        }
        return try provider.searchURL(value)
    }

    public static func isNavigable(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil else { return false }
        return parts.port.map { (1...65535).contains($0) } ?? true
    }

    public static func isSameOriginBlobDownload(_ url: URL, documentURL: URL?) -> Bool {
        guard url.scheme?.lowercased() == "blob", let documentURL, isNavigable(documentURL),
              let embedded = URL(string: String(url.absoluteString.dropFirst(5))), isNavigable(embedded) else { return false }
        func origin(_ value: URL) -> String {
            let scheme = value.scheme!.lowercased(); let host = value.host!.lowercased()
            return "\(scheme)://\(host):\(value.port ?? (scheme == "https" ? 443 : 80))"
        }
        return origin(embedded) == origin(documentURL)
    }
}
