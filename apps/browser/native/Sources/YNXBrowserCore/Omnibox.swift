import Foundation

public enum BrowserOmniboxError: Error, Equatable {
    case emptyInput, unsafeScheme, invalidURL, invalidProvider
}

public struct BrowserSearchProvider: Codable, Equatable, Sendable {
    public let name: String
    public let template: String
    public static let duckDuckGo = try! BrowserSearchProvider(name: "DuckDuckGo", template: "https://duckduckgo.com/?q={query}")

    public init(name: String, template: String) throws {
        let token = "{query}"
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              template.components(separatedBy: token).count == 2,
              template.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              // Parse a URL-valid spelling of the token. Raw braces make Foundation repair
              // the entire string, which can double-escape an existing %71 query name and
              // hide its collision with q. Substitution below preserves the original template.
              let parts = URLComponents(string: template.replacingOccurrences(of: token, with: "%7Bquery%7D")),
              parts.scheme?.lowercased() == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              // Require the literal placeholder in the original URL. A static percent-encoded
              // token must never authorize interpolation in a path or another parameter.
              let query = template.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).dropFirst().first,
              query.split(separator: "&").contains(where: { item in
                  guard let equals = item.firstIndex(of: "=") else { return false }
                  return item[item.index(after: equals)...] == token
              }),
              let queryItems = parts.queryItems,
              queryItems.filter({ $0.value == token }).count == 1,
              queryItems.allSatisfy({ !$0.name.isEmpty && !$0.name.contains(token) }),
              Set(queryItems.map(\.name)).count == queryItems.count,
              parts.port.map({ (1...65535).contains($0) }) ?? true else {
            throw BrowserOmniboxError.invalidProvider
        }
        self.name = name
        self.template = template
    }

    private enum CodingKeys: String, CodingKey { case name, template }

    /// Saved preferences cross the same validation boundary as an explicit user selection.
    /// Synthesized decoding would otherwise bypass the HTTPS/template initializer above.
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(name: values.decode(String.self, forKey: .name),
                      template: values.decode(String.self, forKey: .template))
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
    public static func resolveOmnibox(_ input: String, provider: BrowserSearchProvider = .duckDuckGo,
                                      allowTorOnion: Bool = false) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw BrowserOmniboxError.emptyInput }
        // Consume onion-shaped address input before the search-provider branch.
        let address = value.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? value
        let onionAddress: String
        if address.range(of: "^[A-Za-z][A-Za-z0-9+.-]*://", options: .regularExpression) != nil {
            onionAddress = address
        } else if address.hasPrefix("//") {
            onionAddress = "http:" + address
        } else {
            onionAddress = "http://" + address
        }
        let authority = onionAddress.range(of: "://").flatMap { separator in
            onionAddress[separator.upperBound...].split(whereSeparator: { "/?#\\".contains($0) }).first
        } ?? ""
        let authorityHost = authority.split(whereSeparator: { ":@".contains($0) }).first.map(String.init) ?? ""
        let candidate = URLComponents(string: onionAddress)
        if isOnionHost(candidate?.host) || isOnionHost(authorityHost.removingPercentEncoding ?? authorityHost) {
            guard allowTorOnion, address == value, let candidate, isOnionHost(candidate.host), let url = candidate.url,
                  isNavigable(url, allowTorOnion: true) else { throw BrowserOmniboxError.invalidURL }
            return url
        }
        if let colon = value.firstIndex(of: ":") {
            let prefix = String(value[..<colon])
            if prefix.range(of: "^[A-Za-z][A-Za-z0-9+.-]*$", options: .regularExpression) != nil {
                guard ["http", "https"].contains(prefix.lowercased()) else { throw BrowserOmniboxError.unsafeScheme }
                guard let url = URL(string: value), isNavigable(url, allowTorOnion: allowTorOnion),
                      value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { throw BrowserOmniboxError.invalidURL }
                return url
            }
        }
        let search = try provider.searchURL(value)
        guard isNavigable(search) else { throw BrowserOmniboxError.invalidProvider }
        return search
    }

    static func isOnionHost(_ host: String?) -> Bool {
        guard let host else { return false }
        let name = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return name == "onion" || name.hasSuffix(".onion")
    }

    public static func isNavigable(_ url: URL) -> Bool {
        isNavigable(url, allowTorOnion: false)
    }

    public static func isNavigable(_ url: URL, allowTorOnion: Bool) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              allowTorOnion || !isOnionHost(host) else { return false }
        return parts.port.map { (1...65535).contains($0) } ?? true
    }

    public static func isSameOriginBlobDownload(_ url: URL, documentURL: URL?, allowTorOnion: Bool = false) -> Bool {
        guard url.scheme?.lowercased() == "blob", let documentURL, isNavigable(documentURL, allowTorOnion: allowTorOnion),
              let embedded = URL(string: String(url.absoluteString.dropFirst(5))), isNavigable(embedded, allowTorOnion: allowTorOnion) else { return false }
        func origin(_ value: URL) -> String {
            let scheme = value.scheme!.lowercased(); let host = value.host!.lowercased()
            return "\(scheme)://\(host):\(value.port ?? (scheme == "https" ? 443 : 80))"
        }
        return origin(embedded) == origin(documentURL)
    }
}
