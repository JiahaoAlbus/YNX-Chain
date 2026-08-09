import CryptoKit
import Foundation

public struct BrowserWalletCallbackBindings: Equatable, Sendable {
    public let scheme: String
    public let host: String
    public let path: String
    public let chainId: String
    public let requestingProduct: String
    public let productClientId: String
    public let bundleId: String
    public let callback: String
    public let productDeviceAlgorithm: String
    public let orderedScopes: [String]

    public init(
        scheme: String,
        host: String,
        path: String,
        chainId: String,
        requestingProduct: String,
        productClientId: String,
        bundleId: String,
        callback: String,
        productDeviceAlgorithm: String,
        orderedScopes: [String]
    ) {
        self.scheme = scheme
        self.host = host
        self.path = path
        self.chainId = chainId
        self.requestingProduct = requestingProduct
        self.productClientId = productClientId
        self.bundleId = bundleId
        self.callback = callback
        self.productDeviceAlgorithm = productDeviceAlgorithm
        self.orderedScopes = orderedScopes
    }

    public static let macOS = BrowserWalletCallbackBindings(
        scheme: "ynxbrowser",
        host: "com.ynxweb4.browser.macos",
        path: "/auth/callback",
        chainId: "ynx_6423-1",
        requestingProduct: "browser",
        productClientId: "ynx-browser-macos",
        bundleId: "com.ynxweb4.browser.macos",
        callback: "ynxbrowser://com.ynxweb4.browser.macos/auth/callback",
        productDeviceAlgorithm: "p256-sha256",
        orderedScopes: ["account:read", "browser:wallet-request"]
    )
}

public enum BrowserWalletCallbackError: Error, Equatable, LocalizedError, Sendable {
    case routeMismatch
    case queryMismatch
    case duplicateQueryField
    case responseMalformed
    case responseFieldsMismatch
    case pendingMissingOrConsumed
    case pendingMalformed
    case pendingTampered
    case requestExpired
    case responseBindingMismatch

    public var code: String {
        switch self {
        case .routeMismatch: "BR-WALLET-CALLBACK-ROUTE"
        case .queryMismatch: "BR-WALLET-CALLBACK-QUERY"
        case .duplicateQueryField: "BR-WALLET-CALLBACK-DUPLICATE"
        case .responseMalformed: "BR-WALLET-CALLBACK-MALFORMED"
        case .responseFieldsMismatch: "BR-WALLET-CALLBACK-FIELDS"
        case .pendingMissingOrConsumed: "BR-WALLET-CALLBACK-STATE-MISSING"
        case .pendingMalformed: "BR-WALLET-CALLBACK-STATE-MALFORMED"
        case .pendingTampered: "BR-WALLET-CALLBACK-STATE-TAMPERED"
        case .requestExpired: "BR-WALLET-CALLBACK-EXPIRED"
        case .responseBindingMismatch: "BR-WALLET-CALLBACK-BINDING"
        }
    }

    public var errorDescription: String? {
        switch self {
        case .routeMismatch:
            "Wallet callback route mismatch"
        case .queryMismatch:
            "Wallet callback query mismatch"
        case .duplicateQueryField:
            "Wallet callback contains a duplicate query field"
        case .responseMalformed:
            "Wallet response is malformed"
        case .responseFieldsMismatch:
            "Wallet response fields do not match the accepted envelope"
        case .pendingMissingOrConsumed:
            "Wallet request state is missing or already consumed"
        case .pendingMalformed:
            "Wallet request state is malformed"
        case .pendingTampered:
            "Wallet request state was tampered"
        case .requestExpired:
            "Wallet request expired"
        case .responseBindingMismatch:
            "Wallet response binding mismatch"
        }
    }
}

public enum BrowserWalletCallbackPolicy {
    public static let pendingDefaultsKey = "walletPendingRequestV1"
    private static let legacyNonceKey = "walletPendingNonce"
    private static let legacyExpiryKey = "walletPendingExpiry"
    private static let pendingDomain = "YNX_BROWSER_MACOS_WALLET_REQUEST_V1"
    private static let maxEncodedResponseBytes = 16_384
    private static let maxPendingBytes = 16_384
    private static let responseFields: Set<String> = ["nonce", "chainId", "productClientId", "bundleId"]
    private static let pendingFields: Set<String> = [
        "nonce",
        "expiresAtMilliseconds",
        "chainId",
        "requestingProduct",
        "productClientId",
        "bundleId",
        "callback",
        "productDeviceAlgorithm",
        "orderedScopes",
        "signature"
    ]

    public static func persistPending(
        nonce: String,
        expiresAt: Date,
        defaults: UserDefaults,
        signingKey: P256.Signing.PrivateKey,
        bindings: BrowserWalletCallbackBindings = .macOS
    ) throws {
        guard nonce.isEmpty == false, expiresAt.timeIntervalSince1970.isFinite else {
            throw BrowserWalletCallbackError.pendingMalformed
        }
        let unsigned = PendingWalletRequest(
            nonce: nonce,
            expiresAtMilliseconds: Int64((expiresAt.timeIntervalSince1970 * 1_000).rounded()),
            chainId: bindings.chainId,
            requestingProduct: bindings.requestingProduct,
            productClientId: bindings.productClientId,
            bundleId: bindings.bundleId,
            callback: bindings.callback,
            productDeviceAlgorithm: bindings.productDeviceAlgorithm,
            orderedScopes: bindings.orderedScopes,
            signature: ""
        )
        let signature = try signingKey.signature(for: pendingPayload(unsigned)).rawRepresentation.base64URLEncodedString()
        let pending = unsigned.withSignature(signature)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let encoded = try encoder.encode(pending)
        guard encoded.count <= maxPendingBytes else {
            throw BrowserWalletCallbackError.pendingMalformed
        }
        defaults.set(encoded, forKey: pendingDefaultsKey)
        defaults.removeObject(forKey: legacyNonceKey)
        defaults.removeObject(forKey: legacyExpiryKey)
    }

    public static func clearPending(defaults: UserDefaults) {
        defaults.removeObject(forKey: pendingDefaultsKey)
        defaults.removeObject(forKey: legacyNonceKey)
        defaults.removeObject(forKey: legacyExpiryKey)
    }

    public static func validateAndConsume(
        url: URL,
        defaults: UserDefaults,
        now: Date = Date(),
        verificationKey: P256.Signing.PublicKey,
        bindings: BrowserWalletCallbackBindings = .macOS
    ) throws -> String {
        try validateRoute(url, bindings: bindings)
        let encodedResponse = try exactResponseQueryValue(url)
        let response = try decodeResponse(encodedResponse)
        let pending = try loadPending(defaults: defaults)
        try verifyPending(pending, verificationKey: verificationKey, bindings: bindings)

        let nowMilliseconds = Int64((now.timeIntervalSince1970 * 1_000).rounded())
        guard pending.expiresAtMilliseconds > nowMilliseconds else {
            clearPending(defaults: defaults)
            throw BrowserWalletCallbackError.requestExpired
        }
        guard response.nonce == pending.nonce,
              response.chainId == bindings.chainId,
              response.productClientId == bindings.productClientId,
              response.bundleId == bindings.bundleId else {
            throw BrowserWalletCallbackError.responseBindingMismatch
        }

        clearPending(defaults: defaults)
        return "Wallet response received. Gateway signature and device challenge verification are required; no Product Session was created locally."
    }

    private static func validateRoute(_ url: URL, bindings: BrowserWalletCallbackBindings) throws {
        guard url.scheme?.lowercased() == bindings.scheme,
              url.host == bindings.host,
              url.path == bindings.path,
              url.fragment == nil,
              url.user == nil,
              url.password == nil,
              url.port == nil else {
            throw BrowserWalletCallbackError.routeMismatch
        }
    }

    private static func exactResponseQueryValue(_ url: URL) throws -> String {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems,
              items.isEmpty == false else {
            throw BrowserWalletCallbackError.queryMismatch
        }
        var values: [String: String] = [:]
        for item in items {
            guard values[item.name] == nil else {
                throw BrowserWalletCallbackError.duplicateQueryField
            }
            values[item.name] = item.value ?? ""
        }
        guard values.count == 1,
              let response = values["response"],
              response.isEmpty == false else {
            throw BrowserWalletCallbackError.queryMismatch
        }
        return response
    }

    private static func decodeResponse(_ encoded: String) throws -> WalletAuthorizationResponse {
        guard encoded.utf8.count <= maxEncodedResponseBytes,
              let data = Data(base64URLEncoded: encoded),
              data.count <= maxPendingBytes else {
            throw BrowserWalletCallbackError.responseMalformed
        }
        let fields: [String]
        do {
            fields = try strictTopLevelObjectFields(data)
        } catch {
            throw BrowserWalletCallbackError.responseMalformed
        }
        guard fields.count == responseFields.count,
              Set(fields).count == fields.count,
              Set(fields) == responseFields else {
            throw BrowserWalletCallbackError.responseFieldsMismatch
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            throw BrowserWalletCallbackError.responseMalformed
        }
        guard let nonce = dictionary["nonce"] as? String,
              let chainId = dictionary["chainId"] as? String,
              let productClientId = dictionary["productClientId"] as? String,
              let bundleId = dictionary["bundleId"] as? String,
              nonce.isEmpty == false,
              chainId.isEmpty == false,
              productClientId.isEmpty == false,
              bundleId.isEmpty == false else {
            throw BrowserWalletCallbackError.responseFieldsMismatch
        }
        return WalletAuthorizationResponse(
            nonce: nonce,
            chainId: chainId,
            productClientId: productClientId,
            bundleId: bundleId
        )
    }

    private static func loadPending(defaults: UserDefaults) throws -> PendingWalletRequest {
        guard let data = defaults.data(forKey: pendingDefaultsKey) else {
            defaults.removeObject(forKey: legacyNonceKey)
            defaults.removeObject(forKey: legacyExpiryKey)
            throw BrowserWalletCallbackError.pendingMissingOrConsumed
        }
        guard data.count <= maxPendingBytes else {
            throw BrowserWalletCallbackError.pendingMalformed
        }
        guard let fields = try? strictTopLevelObjectFields(data),
              fields.count == pendingFields.count,
              Set(fields).count == fields.count,
              Set(fields) == pendingFields else {
            throw BrowserWalletCallbackError.pendingMalformed
        }
        do {
            return try JSONDecoder().decode(PendingWalletRequest.self, from: data)
        } catch {
            throw BrowserWalletCallbackError.pendingMalformed
        }
    }

    private static func verifyPending(
        _ pending: PendingWalletRequest,
        verificationKey: P256.Signing.PublicKey,
        bindings: BrowserWalletCallbackBindings
    ) throws {
        guard pending.chainId == bindings.chainId,
              pending.requestingProduct == bindings.requestingProduct,
              pending.productClientId == bindings.productClientId,
              pending.bundleId == bindings.bundleId,
              pending.callback == bindings.callback,
              pending.productDeviceAlgorithm == bindings.productDeviceAlgorithm,
              pending.orderedScopes == bindings.orderedScopes,
              let signatureData = Data(base64URLEncoded: pending.signature),
              let signature = try? P256.Signing.ECDSASignature(rawRepresentation: signatureData),
              verificationKey.isValidSignature(signature, for: pendingPayload(pending)) else {
            throw BrowserWalletCallbackError.pendingTampered
        }
    }

    private static func pendingPayload(_ pending: PendingWalletRequest) -> Data {
        Data([
            pendingDomain,
            pending.nonce,
            String(pending.expiresAtMilliseconds),
            pending.chainId,
            pending.requestingProduct,
            pending.productClientId,
            pending.bundleId,
            pending.callback,
            pending.productDeviceAlgorithm,
            pending.orderedScopes.joined(separator: "\n")
        ].joined(separator: "\n").utf8)
    }

    private static func strictTopLevelObjectFields(_ data: Data) throws -> [String] {
        let bytes = [UInt8](data)
        var index = 0

        func skipWhitespace() {
            while index < bytes.count, [9, 10, 13, 32].contains(bytes[index]) {
                index += 1
            }
        }

        func scanString() throws -> Data {
            guard index < bytes.count, bytes[index] == 34 else {
                throw JSONFieldScanError.invalid
            }
            let start = index
            index += 1
            var escaped = false
            while index < bytes.count {
                let byte = bytes[index]
                index += 1
                if escaped {
                    escaped = false
                } else if byte == 92 {
                    escaped = true
                } else if byte == 34 {
                    return Data(bytes[start..<index])
                }
            }
            throw JSONFieldScanError.invalid
        }

        func scanValue() throws {
            skipWhitespace()
            let start = index
            var depth = 0
            var inString = false
            var escaped = false
            while index < bytes.count {
                let byte = bytes[index]
                if inString {
                    index += 1
                    if escaped {
                        escaped = false
                    } else if byte == 92 {
                        escaped = true
                    } else if byte == 34 {
                        inString = false
                    }
                    continue
                }
                switch byte {
                case 34:
                    inString = true
                    index += 1
                case 123, 91:
                    depth += 1
                    index += 1
                case 125:
                    if depth == 0 {
                        guard index > start else { throw JSONFieldScanError.invalid }
                        return
                    }
                    depth -= 1
                    index += 1
                case 93:
                    guard depth > 0 else { throw JSONFieldScanError.invalid }
                    depth -= 1
                    index += 1
                case 44 where depth == 0:
                    guard index > start else { throw JSONFieldScanError.invalid }
                    return
                default:
                    index += 1
                }
            }
            guard index > start, inString == false, depth == 0 else {
                throw JSONFieldScanError.invalid
            }
        }

        skipWhitespace()
        guard index < bytes.count, bytes[index] == 123 else {
            throw JSONFieldScanError.invalid
        }
        index += 1
        skipWhitespace()
        if index < bytes.count, bytes[index] == 125 {
            index += 1
            skipWhitespace()
            guard index == bytes.count else { throw JSONFieldScanError.invalid }
            return []
        }

        var fields: [String] = []
        while true {
            skipWhitespace()
            let encodedField = try scanString()
            guard let field = try? JSONDecoder().decode(String.self, from: encodedField) else {
                throw JSONFieldScanError.invalid
            }
            fields.append(field)
            skipWhitespace()
            guard index < bytes.count, bytes[index] == 58 else {
                throw JSONFieldScanError.invalid
            }
            index += 1
            try scanValue()
            skipWhitespace()
            guard index < bytes.count else { throw JSONFieldScanError.invalid }
            if bytes[index] == 44 {
                index += 1
                continue
            }
            guard bytes[index] == 125 else { throw JSONFieldScanError.invalid }
            index += 1
            break
        }
        skipWhitespace()
        guard index == bytes.count else { throw JSONFieldScanError.invalid }
        return fields
    }
}

private enum JSONFieldScanError: Error {
    case invalid
}

private struct PendingWalletRequest: Codable, Equatable {
    let nonce: String
    let expiresAtMilliseconds: Int64
    let chainId: String
    let requestingProduct: String
    let productClientId: String
    let bundleId: String
    let callback: String
    let productDeviceAlgorithm: String
    let orderedScopes: [String]
    let signature: String

    func withSignature(_ value: String) -> PendingWalletRequest {
        PendingWalletRequest(
            nonce: nonce,
            expiresAtMilliseconds: expiresAtMilliseconds,
            chainId: chainId,
            requestingProduct: requestingProduct,
            productClientId: productClientId,
            bundleId: bundleId,
            callback: callback,
            productDeviceAlgorithm: productDeviceAlgorithm,
            orderedScopes: orderedScopes,
            signature: value
        )
    }
}

private struct WalletAuthorizationResponse: Equatable {
    let nonce: String
    let chainId: String
    let productClientId: String
    let bundleId: String
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded: String) {
        var value = base64URLEncoded
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = value.count % 4
        guard remainder != 1 else { return nil }
        if remainder > 0 {
            value += String(repeating: "=", count: 4 - remainder)
        }
        self.init(base64Encoded: value)
    }
}
