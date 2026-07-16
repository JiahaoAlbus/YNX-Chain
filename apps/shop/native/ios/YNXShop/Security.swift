import CryptoKit
import Foundation
import Security

enum Vault {
    static let service = "com.ynxweb4.shop.secure"
    static func put(_ key: String, _ data: Data) throws {
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        SecItemDelete(query as CFDictionary)
        var value=query; value[kSecValueData as String]=data; value[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(value as CFDictionary,nil)==errSecSuccess else { throw ShopError.security }
    }
    static func get(_ key:String)->Data? {
        var query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var item:CFTypeRef?; return SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess ? item as? Data:nil
    }
    static func remove(_ key:String){ SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key] as CFDictionary) }
    static func text(_ key:String)->String? { get(key).flatMap{String(data:$0,encoding:.utf8)} }
}

enum CanonicalJSON {
    static func data(_ value:Any) throws -> Data { try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys,.withoutEscapingSlashes]) }
}

enum ShopError: LocalizedError {
    case unavailable, security, invalidResponse, signedOut, offlineQueued
    var errorDescription:String? { String(localized: LocalizedStringResource(stringLiteral: String(describing:self))) }
}

struct OfflineEnvelope:Codable,Identifiable { let id:String; let method:String; let path:String; let body:Data; let createdAt:Date }

final class OfflineQueue {
    private let key="offline-mutations-v1"
    func load()->[OfflineEnvelope] { guard let data=Vault.get(key) else{return []}; return (try? JSONDecoder().decode([OfflineEnvelope].self,from:data)) ?? [] }
    func append(method:String,path:String,body:Data) throws { var all=load(); all.append(.init(id:UUID().uuidString,method:method,path:path,body:body,createdAt:Date())); try Vault.put(key,try JSONEncoder().encode(all)) }
    func replace(_ all:[OfflineEnvelope]) throws { try Vault.put(key,try JSONEncoder().encode(all)) }
}
