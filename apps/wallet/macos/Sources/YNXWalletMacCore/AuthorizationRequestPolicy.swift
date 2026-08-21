import CryptoKit
import Foundation

public enum NativeAuthorizationDecision: Equatable, Sendable {
  case rejected(code: String)
}

public enum NativeAuthorizationPolicy {
  private static let requestFields: Set<String> = [
    "version", "nonce", "chainId", "requestingProduct", "productClientId", "bundleId",
    "productDeviceAlgorithm", "productDeviceKey", "callback", "scopes", "purpose", "issuedAt", "expiresAt",
  ]

  public static func evaluate(_ rawValue: String) -> NativeAuthorizationDecision {
    evaluate(rawValue, registryData: bundledRegistryData(), now: Date())
  }

  public static func evaluate(
    _ rawValue: String,
    registryData: Data?,
    now: Date = Date()
  ) -> NativeAuthorizationDecision {
    do {
      let request = try parseDeepLink(rawValue, now: now)
      guard let registryData else { return .rejected(code: "CANONICAL_REGISTRY_UNAVAILABLE") }
      try verifyRegistryBinding(request, registryData: registryData)
      // Parsing and registry binding do not authorize an account or unlock a
      // signing key. That bridge remains unavailable until its frozen native
      // implementation and direct device evidence exist.
      return .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE")
    } catch let failure as NativeAuthorizationFailure {
      return .rejected(code: failure.code)
    } catch {
      return .rejected(code: "INVALID_AUTHORIZATION_REQUEST")
    }
  }

  private static func bundledRegistryData() -> Data? {
    if let url = Bundle.main.url(forResource: "central-registry", withExtension: "json"),
       let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) {
      return data
    }
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    guard let url = bundle.url(forResource: "central-registry", withExtension: "json") else { return nil }
    return try? Data(contentsOf: url, options: [.mappedIfSafe])
    #else
    return nil
    #endif
  }

  private static func parseDeepLink(_ rawValue: String, now: Date) throws -> [String: Any] {
    guard let components = URLComponents(string: rawValue),
          components.scheme == "ynxwallet",
          components.host == "authorize",
          components.path.isEmpty,
          components.fragment == nil,
          let encodedQuery = components.percentEncodedQuery,
          encodedQuery.hasPrefix("request=") else {
      throw NativeAuthorizationFailure("INVALID_DEEP_LINK")
    }
    let encoded = String(encodedQuery.dropFirst("request=".count))
    guard !encoded.isEmpty, !encoded.contains("&"), !encoded.contains("="),
          encoded.unicodeScalars.allSatisfy({
            CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_").contains($0)
          }),
          let decoded = decodeBase64URL(encoded),
          encodeBase64URL(decoded) == encoded,
          let jsonText = String(data: decoded, encoding: .utf8),
          Data(jsonText.utf8) == decoded else {
      throw NativeAuthorizationFailure("INVALID_DEEP_LINK")
    }
    guard let root = try? JSONSerialization.jsonObject(with: decoded),
          let request = root as? [String: Any] else {
      throw NativeAuthorizationFailure("INVALID_JSON")
    }
    guard Set(request.keys) == requestFields else { throw NativeAuthorizationFailure("INVALID_FIELD") }

    let version = try string(request, "version", maximum: 4)
    let nonce = try pattern(request, "nonce", "^[A-Za-z0-9_-]{32,64}$")
    let chainID = try string(request, "chainId", maximum: 32)
    _ = try pattern(request, "requestingProduct", "^[a-z][a-z0-9-]{1,31}$")
    _ = try pattern(request, "productClientId", "^[a-z][a-z0-9._-]{2,63}$")
    _ = try pattern(request, "bundleId", "^[A-Za-z][A-Za-z0-9.-]{2,127}$")
    let algorithm = try string(request, "productDeviceAlgorithm", maximum: 32)
    try validateDeviceKey(try pattern(request, "productDeviceKey", "^[A-Za-z0-9_-]{44}$"))
    try validateCallback(try string(request, "callback", maximum: 512))
    try validateScopes(request["scopes"])
    _ = try string(request, "purpose", maximum: 180)
    let issuedAt = try timestamp(request, "issuedAt")
    let expiresAt = try timestamp(request, "expiresAt")

    guard version == "1" else { throw NativeAuthorizationFailure("UNSUPPORTED_VERSION") }
    guard chainID == "ynx_6423-1" else { throw NativeAuthorizationFailure("WRONG_NETWORK") }
    guard algorithm == "p256-sha256" else { throw NativeAuthorizationFailure("UNSUPPORTED_DEVICE_ALGORITHM") }
    guard expiresAt > issuedAt, expiresAt.timeIntervalSince(issuedAt) <= 300 else {
      throw NativeAuthorizationFailure("INVALID_EXPIRY")
    }
    guard issuedAt <= now.addingTimeInterval(30) else { throw NativeAuthorizationFailure("ISSUED_IN_FUTURE") }
    guard expiresAt > now else { throw NativeAuthorizationFailure("EXPIRED") }
    _ = nonce
    return request
  }

  private static func verifyRegistryBinding(_ request: [String: Any], registryData: Data) throws {
    guard registryData.count <= 256 * 1024,
          let registry = try? JSONSerialization.jsonObject(with: registryData) as? [String: Any],
          Set(registry.keys) == Set(["registryVersion", "chainId", "products"]),
          registry["registryVersion"] as? Int == 2,
          registry["chainId"] as? String == "ynx_6423-1",
          let products = registry["products"] as? [[String: Any]],
          products.count == 34 else {
      throw NativeAuthorizationFailure("INVALID_REGISTRY")
    }
    let clientID = request["productClientId"] as? String
    let matches = products.filter { $0["productClientId"] as? String == clientID }
    guard matches.count == 1 else { throw NativeAuthorizationFailure("UNKNOWN_PRODUCT") }
    let product = matches[0]
    guard product["enabled"] as? Bool == true,
          product["reviewState"] as? String == "approved" else {
      throw NativeAuthorizationFailure("REGISTRY_DISABLED")
    }
    guard product["requestingProduct"] as? String == request["requestingProduct"] as? String,
          product["bundleId"] as? String == request["bundleId"] as? String else {
      throw NativeAuthorizationFailure("PRODUCT_MISMATCH")
    }
    guard let callbacks = product["callbacks"] as? [String],
          callbacks.contains(request["callback"] as? String ?? "") else {
      throw NativeAuthorizationFailure("CALLBACK_MISMATCH")
    }
    guard let allowedScopes = product["scopes"] as? [String],
          let scopes = request["scopes"] as? [String],
          scopes.allSatisfy({ allowedScopes.contains($0) }) else {
      throw NativeAuthorizationFailure("SCOPE_NOT_ALLOWED")
    }
    let maximum = product["maxScopes"] as? Int ?? allowedScopes.count
    guard scopes.count <= maximum else { throw NativeAuthorizationFailure("SCOPE_TOO_BROAD") }
  }

  private static func string(_ object: [String: Any], _ key: String, maximum: Int) throws -> String {
    guard let value = object[key] as? String, !value.isEmpty, value.count <= maximum,
          value.trimmingCharacters(in: .whitespacesAndNewlines) == value else {
      throw NativeAuthorizationFailure("INVALID_FIELD")
    }
    return value
  }

  private static func pattern(_ object: [String: Any], _ key: String, _ expression: String) throws -> String {
    let value = try string(object, key, maximum: 256)
    guard value.range(of: expression, options: .regularExpression) != nil else {
      throw NativeAuthorizationFailure("INVALID_FIELD")
    }
    return value
  }

  private static func timestamp(_ object: [String: Any], _ key: String) throws -> Date {
    let value = try pattern(object, key, "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value), formatter.string(from: date) == value else {
      throw NativeAuthorizationFailure("INVALID_TIME")
    }
    return date
  }

  private static func validateCallback(_ value: String) throws {
    guard let components = URLComponents(string: value),
          let scheme = components.scheme,
          scheme.range(of: "^[a-z][a-z0-9+.-]*$", options: .regularExpression) != nil,
          components.user == nil, components.password == nil, components.fragment == nil,
          components.url?.absoluteString == value else {
      throw NativeAuthorizationFailure("INVALID_CALLBACK")
    }
  }

  private static func validateScopes(_ raw: Any?) throws {
    guard let scopes = raw as? [String], (1...8).contains(scopes.count),
          Set(scopes).count == scopes.count, scopes.sorted() == scopes,
          scopes.allSatisfy({ $0.range(of: "^[a-z][a-z0-9._:-]{1,63}$", options: .regularExpression) != nil }) else {
      throw NativeAuthorizationFailure("INVALID_SCOPES")
    }
  }

  private static func validateDeviceKey(_ value: String) throws {
    guard let bytes = decodeBase64URL(value), bytes.count == 33,
          encodeBase64URL(bytes) == value, bytes[0] == 2 || bytes[0] == 3 else {
      throw NativeAuthorizationFailure("INVALID_DEVICE_KEY")
    }
    do {
      _ = try P256.Signing.PublicKey(compactRepresentation: bytes.dropFirst())
    } catch {
      throw NativeAuthorizationFailure("INVALID_DEVICE_KEY")
    }
  }

  private static func decodeBase64URL(_ value: String) -> Data? {
    var normalized = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
    return Data(base64Encoded: normalized)
  }

  private static func encodeBase64URL(_ value: Data) -> String {
    value.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}

private struct NativeAuthorizationFailure: Error {
  let code: String
  init(_ code: String) { self.code = code }
}
