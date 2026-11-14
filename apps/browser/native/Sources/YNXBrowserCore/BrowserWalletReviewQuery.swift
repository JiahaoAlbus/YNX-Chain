import Foundation

public enum BrowserWalletReviewQueryFailure: Error, Equatable {
    case invalidURL, unsupportedScheme, credentialsNotAllowed, tooLarge
    case invalidQuery, duplicateKey, unknownField, fieldTooLarge, unsafeText
}

/// Untrusted display DATA for the Browser's human review dialog only. Neither a field name
/// nor any value establishes requester identity, Wallet consent, a Grant or a transaction.
/// This parser does not open Wallet, follow callbacks, sign, persist or send requests.
public struct BrowserWalletReviewQuery: Equatable, Sendable {
    public let fields: [String: String]
    public subscript(_ name: String) -> String? { fields[name] }
    public static let maximumURLBytes = 8192
    private static let limits: [String: Int] = [
        "requestingProduct": 256, "callback": 1024, "scopes": 1024, "recipient": 256,
        "amount": 128, "fee": 128, "data": 4096, "expiresAt": 128
    ]

    private init(fields: [String: String]) { self.fields = fields }

    public static func parse(_ url: URL) throws -> Self {
        guard url.baseURL == nil else { throw BrowserWalletReviewQueryFailure.invalidURL }
        return try parse(url.absoluteString)
    }

    public static func parse(_ rawURL: String) throws -> Self {
        guard !rawURL.isEmpty else { throw BrowserWalletReviewQueryFailure.invalidURL }
        guard rawURL.utf8.count <= maximumURLBytes else { throw BrowserWalletReviewQueryFailure.tooLarge }
        guard !rawURL.contains("\\"), !rawURL.unicodeScalars.contains(where: {
            CharacterSet.whitespacesAndNewlines.contains($0) || unsafe($0)
        }) else { throw BrowserWalletReviewQueryFailure.unsafeText }
        try validateEscapes(rawURL) // URLComponents may otherwise repair a malformed '%' escape.
        guard let separator = rawURL.range(of: "://") else { throw BrowserWalletReviewQueryFailure.invalidURL }
        let scheme = String(rawURL[..<separator.lowerBound]).lowercased()
        guard scheme == "ynxwallet" || scheme == "ynx-wallet" else { throw BrowserWalletReviewQueryFailure.unsupportedScheme }
        let authority = String(rawURL[separator.upperBound...].prefix { $0 != "/" && $0 != "?" && $0 != "#" })
        if authority.contains("@") { throw BrowserWalletReviewQueryFailure.credentialsNotAllowed }
        guard authority.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$", options: .regularExpression) != nil,
              let parts = URLComponents(string: rawURL), parts.url != nil,
              parts.scheme?.lowercased() == scheme, parts.host != nil,
              parts.port == nil, parts.fragment == nil else { throw BrowserWalletReviewQueryFailure.invalidURL }
        guard let normalizedURL = parts.url, normalizedURL.absoluteString.utf8.count <= maximumURLBytes else { throw BrowserWalletReviewQueryFailure.tooLarge }
        guard parts.user == nil, parts.password == nil else { throw BrowserWalletReviewQueryFailure.credentialsNotAllowed }
        guard let path = parts.percentEncodedPath.removingPercentEncoding, path.utf8.count <= 512,
              !path.contains("\\"), !path.unicodeScalars.contains(where: unsafe) else { throw BrowserWalletReviewQueryFailure.invalidURL }
        guard let query = parts.percentEncodedQuery else { return Self(fields: [:]) }
        guard !query.isEmpty else { throw BrowserWalletReviewQueryFailure.invalidQuery }
        let pairs = query.split(separator: "&", omittingEmptySubsequences: false)
        guard pairs.count <= limits.count else { throw BrowserWalletReviewQueryFailure.tooLarge }
        var captured: [String: String] = [:]
        for pair in pairs {
            guard let equals = pair.firstIndex(of: "="), equals != pair.startIndex,
                  let name = String(pair[..<equals]).removingPercentEncoding,
                  let value = String(pair[pair.index(after: equals)...]).removingPercentEncoding,
                  !value.isEmpty else { throw BrowserWalletReviewQueryFailure.invalidQuery }
            // Decode once, then check uniqueness: scopes and %73copes are the SAME key.
            guard captured[name] == nil else { throw BrowserWalletReviewQueryFailure.duplicateKey }
            guard let maximum = limits[name] else { throw BrowserWalletReviewQueryFailure.unknownField }
            guard value.utf8.count <= maximum else { throw BrowserWalletReviewQueryFailure.fieldTooLarge }
            guard !value.unicodeScalars.contains(where: unsafe) else { throw BrowserWalletReviewQueryFailure.unsafeText }
            captured[name] = value
        }
        return Self(fields: captured)
    }

    private static func unsafe(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .control, .format, .lineSeparator, .paragraphSeparator, .surrogate: return true
        default: return false
        }
    }

    private static func validateEscapes(_ text: String) throws {
        let bytes = Array(text.utf8)
        func hex(_ byte: UInt8) -> Bool { (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte) }
        var index = 0
        while index < bytes.count {
            if bytes[index] == 37 {
                guard index + 2 < bytes.count, hex(bytes[index + 1]), hex(bytes[index + 2]) else { throw BrowserWalletReviewQueryFailure.invalidURL }
                index += 3
            } else { index += 1 }
        }
    }
}
