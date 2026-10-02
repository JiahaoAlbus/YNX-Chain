import CryptoKit
import Foundation
import Security

// Keep the inherited Keychain identity. A locked or damaged item must never be
// interpreted as first use: replacing it would orphan the existing device.
final class ProductDeviceKey {
    enum StorageError: Error {
        case readFailed(OSStatus)
        case invalidStoredKey
        case writeFailed(OSStatus)
    }

    typealias Read = () -> (status: OSStatus, data: Data?)
    typealias Add = (Data) -> OSStatus
    static let shared = ProductDeviceKey()
    private static let service = "com.ynxweb4.video.product-device"
    private static let account = "wallet-auth-v1"
    private let read: Read
    private let add: Add
    private let create: () -> P256.Signing.PrivateKey

    init(read: @escaping Read = ProductDeviceKey.readKey,
         add: @escaping Add = ProductDeviceKey.addKey,
         create: @escaping () -> P256.Signing.PrivateKey = { P256.Signing.PrivateKey() }) {
        self.read = read
        self.add = add
        self.create = create
    }

    func compressedPublicKey() throws -> String {
        try loadKey().publicKey.compressedRepresentation.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func loadKey() throws -> P256.Signing.PrivateKey {
        let existing = read()
        if existing.status == errSecSuccess { return try decode(existing.data) }
        guard existing.status == errSecItemNotFound else {
            throw StorageError.readFailed(existing.status)
        }

        let created = create()
        let status = add(created.rawRepresentation)
        if status == errSecSuccess { return created }
        guard status == errSecDuplicateItem else { throw StorageError.writeFailed(status) }

        // Another process may win first creation. Use its persisted key and do
        // not overwrite it or use the losing, unpersisted key for authorization.
        let winner = read()
        guard winner.status == errSecSuccess else { throw StorageError.readFailed(winner.status) }
        return try decode(winner.data)
    }

    private func decode(_ data: Data?) throws -> P256.Signing.PrivateKey {
        guard let data, let key = try? P256.Signing.PrivateKey(rawRepresentation: data) else {
            throw StorageError.invalidStoredKey
        }
        return key
    }

    private static func readKey() -> (status: OSStatus, data: Data?) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return (status, item as? Data)
    }

    private static func addKey(_ data: Data) -> OSStatus {
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: data
        ]
        return SecItemAdd(attributes as CFDictionary, nil)
    }
}
