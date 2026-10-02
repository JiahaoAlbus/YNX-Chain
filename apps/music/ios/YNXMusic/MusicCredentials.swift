import Foundation
import CryptoKit
import Security

// Keep the inherited account names and UTF-8 base64 device-key representation.
// Neither session replacement nor sign-out deletes the device identity.
final class MusicCredentials {
    enum StorageError:Error {
        case readFailed(OSStatus)
        case writeFailed(OSStatus)
        case deleteFailed(OSStatus)
        case invalidDeviceKey
        case invalidSession
    }
    typealias Read=(String)->(status:OSStatus,data:Data?)
    typealias Write=(String,Data)->OSStatus
    typealias Remove=(String)->OSStatus
    static let shared=MusicCredentials()
    private let read:Read
    private let add:Write
    private let update:Write
    private let remove:Remove
    private let create:()->P256.Signing.PrivateKey

    init(read:@escaping Read=MusicCredentials.readItem,
         add:@escaping Write=MusicCredentials.addItem,
         update:@escaping Write=MusicCredentials.updateItem,
         remove:@escaping Remove=MusicCredentials.removeItem,
         create:@escaping ()->P256.Signing.PrivateKey={ P256.Signing.PrivateKey() }) {
        self.read=read; self.add=add; self.update=update; self.remove=remove; self.create=create
    }
    func deviceKey()throws->P256.Signing.PrivateKey {
        let existing=read("device-p256")
        if existing.status==errSecSuccess { return try decodeDevice(existing.data) }
        guard existing.status==errSecItemNotFound else { throw StorageError.readFailed(existing.status) }
        let candidate=create()
        let encoded=Data(candidate.rawRepresentation.base64EncodedString().utf8)
        let status=add("device-p256",encoded)
        if status==errSecSuccess { return candidate }
        guard status==errSecDuplicateItem else { throw StorageError.writeFailed(status) }
        let winner=read("device-p256")
        guard winner.status==errSecSuccess else { throw StorageError.readFailed(winner.status) }
        return try decodeDevice(winner.data)
    }
    func session()throws->String? {
        let stored=read("sessionBinding")
        if stored.status==errSecItemNotFound { return nil }
        guard stored.status==errSecSuccess else { throw StorageError.readFailed(stored.status) }
        guard let data=stored.data,let value=String(data:data,encoding:.utf8),Self.validSession(value) else { throw StorageError.invalidSession }
        return value
    }
    func saveSession(_ value:String)throws {
        guard Self.validSession(value) else { throw StorageError.invalidSession }
        let data=Data(value.utf8)
        var status=update("sessionBinding",data)
        if status==errSecItemNotFound {
            status=add("sessionBinding",data)
            if status==errSecDuplicateItem { status=update("sessionBinding",data) }
        }
        guard status==errSecSuccess else { throw StorageError.writeFailed(status) }
    }
    func clearSession()throws {
        let status=remove("sessionBinding")
        guard status==errSecSuccess || status==errSecItemNotFound else { throw StorageError.deleteFailed(status) }
    }
    private static func validSession(_ value:String)->Bool {
        value.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil
    }
    private func decodeDevice(_ data:Data?)throws->P256.Signing.PrivateKey {
        guard let data,let value=String(data:data,encoding:.utf8),let raw=Data(base64Encoded:value),
              let key=try? P256.Signing.PrivateKey(rawRepresentation:raw) else { throw StorageError.invalidDeviceKey }
        return key
    }
    private static func query(_ account:String)->[String:Any] {
        [kSecClass as String:kSecClassGenericPassword,kSecAttrAccount as String:account]
    }
    private static func readItem(_ account:String)->(status:OSStatus,data:Data?) {
        var attributes=query(account)
        attributes[kSecReturnData as String]=true
        attributes[kSecMatchLimit as String]=kSecMatchLimitOne
        var item:CFTypeRef?
        let status=SecItemCopyMatching(attributes as CFDictionary,&item)
        return (status,item as? Data)
    }
    private static func addItem(_ account:String,_ data:Data)->OSStatus {
        var attributes=query(account)
        attributes[kSecValueData as String]=data
        attributes[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary,nil)
    }
    private static func updateItem(_ account:String,_ data:Data)->OSStatus {
        SecItemUpdate(query(account) as CFDictionary,[kSecValueData as String:data] as CFDictionary)
    }
    private static func removeItem(_ account:String)->OSStatus {
        SecItemDelete(query(account) as CFDictionary)
    }
}
