import Foundation
import LocalAuthentication
import Security

public enum DeviceSecurityError: Error, Equatable {
  case biometricUnavailable(code: Int)
  case randomGeneration(code: Int32)
  case keychain(code: Int32)
  case invalidRecoveryMaterial
}

public struct DeviceSecurityCapability: Codable, Equatable, Sendable {
  public let keychainAvailable: Bool
  public let keychainRoundTripVerified: Bool
  public let biometricPolicyAvailable: Bool
  public let biometricDomainStatePresent: Bool
  public let biometricErrorCode: Int?
  public let recoveryMaterialPersisted: Bool

  public init(
    keychainAvailable: Bool,
    keychainRoundTripVerified: Bool,
    biometricPolicyAvailable: Bool,
    biometricDomainStatePresent: Bool,
    biometricErrorCode: Int?,
    recoveryMaterialPersisted: Bool
  ) {
    self.keychainAvailable = keychainAvailable
    self.keychainRoundTripVerified = keychainRoundTripVerified
    self.biometricPolicyAvailable = biometricPolicyAvailable
    self.biometricDomainStatePresent = biometricDomainStatePresent
    self.biometricErrorCode = biometricErrorCode
    self.recoveryMaterialPersisted = recoveryMaterialPersisted
  }
}

public enum RecoveryMaterial {
  public static let byteCount = 32

  public static func validate(_ data: Data) throws -> Data {
    guard data.count == byteCount else { throw DeviceSecurityError.invalidRecoveryMaterial }
    return data
  }

  public static func generate() throws -> Data {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else { throw DeviceSecurityError.randomGeneration(code: status) }
    return Data(bytes)
  }
}

public final class KeychainRecoveryVault {
  private let service: String
  private let account: String

  public init(service: String = "com.ynxweb4.wallet.macos.recovery", account: String = "native-recovery-v1") {
    self.service = service
    self.account = account
  }

  public func create(reason: String) async throws {
    let context = try await authorize(reason: reason)
    let material = try RecoveryMaterial.generate()
    try replace(material, context: context)
  }

  public func recover(reason: String) async throws -> Data {
    let context = try await authorize(reason: reason)
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
      kSecUseAuthenticationContext: context,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else {
      throw DeviceSecurityError.keychain(code: status)
    }
    return try RecoveryMaterial.validate(data)
  }

  public func delete(reason: String) async throws {
    let context = try await authorize(reason: reason)
    let status = SecItemDelete(baseQuery(context: context) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw DeviceSecurityError.keychain(code: status)
    }
  }

  public func isAbsentWithoutAuthentication() throws -> Bool {
    let context = LAContext()
    context.interactionNotAllowed = true
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecMatchLimit: kSecMatchLimitOne,
      kSecReturnAttributes: true,
      kSecUseAuthenticationContext: context,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return true }
    if status == errSecSuccess || status == errSecInteractionNotAllowed || status == errSecAuthFailed {
      return false
    }
    throw DeviceSecurityError.keychain(code: status)
  }

  private func replace(_ material: Data, context: LAContext) throws {
    var accessError: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      nil,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      [.biometryCurrentSet],
      &accessError
    ) else {
      throw DeviceSecurityError.keychain(code: errSecParam)
    }
    let update: [CFString: Any] = [
      kSecValueData: material,
      kSecAttrAccessControl: access,
    ]
    let updateStatus = SecItemUpdate(baseQuery(context: context) as CFDictionary, update as CFDictionary)
    if updateStatus == errSecSuccess { return }
    guard updateStatus == errSecItemNotFound else {
      throw DeviceSecurityError.keychain(code: updateStatus)
    }
    var query = baseQuery(context: context)
    query[kSecValueData] = material
    query[kSecAttrAccessControl] = access
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw DeviceSecurityError.keychain(code: status) }
  }

  private func baseQuery(context: LAContext) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecUseAuthenticationContext: context,
    ]
  }

  private func authorize(reason: String) async throws -> LAContext {
    let context = LAContext()
    context.localizedCancelTitle = "Cancel"
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
      throw DeviceSecurityError.biometricUnavailable(code: error?.code ?? -1)
    }
    do {
      try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
      return context
    } catch let error as NSError {
      throw DeviceSecurityError.biometricUnavailable(code: error.code)
    }
  }
}

public enum DeviceSecurityProbe {
  public static func run() -> DeviceSecurityCapability {
    let service = "com.ynxweb4.wallet.macos.probe"
    let account = UUID().uuidString
    let canary = (try? RecoveryMaterial.generate()) ?? Data()
    let base: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
    ]
    var add = base
    add[kSecValueData] = canary
    add[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let addStatus = SecItemAdd(add as CFDictionary, nil)
    var roundTrip = false
    if addStatus == errSecSuccess {
      var read = base
      read[kSecReturnData] = true
      read[kSecMatchLimit] = kSecMatchLimitOne
      var item: CFTypeRef?
      let readStatus = SecItemCopyMatching(read as CFDictionary, &item)
      roundTrip = readStatus == errSecSuccess && (item as? Data) == canary
    }
    _ = SecItemDelete(base as CFDictionary)

    let context = LAContext()
    var biometricError: NSError?
    let biometricAvailable = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricError)
    return DeviceSecurityCapability(
      keychainAvailable: addStatus == errSecSuccess,
      keychainRoundTripVerified: roundTrip,
      biometricPolicyAvailable: biometricAvailable,
      biometricDomainStatePresent: context.evaluatedPolicyDomainState != nil,
      biometricErrorCode: biometricError?.code,
      recoveryMaterialPersisted: false
    )
  }
}
