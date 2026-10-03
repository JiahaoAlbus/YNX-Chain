import CryptoKit
import Foundation
import Security

enum Vault {
    static let service = "com.ynxweb4.shop.secure"
    static func put(_ key: String, _ data: Data) throws {
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        let attributes:[String:Any]=[kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let updated=SecItemUpdate(query as CFDictionary,attributes as CFDictionary)
        if updated==errSecSuccess{return}
        guard updated==errSecItemNotFound else{throw ShopError.security}
        var value=query;for(key,item) in attributes{value[key]=item}
        guard SecItemAdd(value as CFDictionary,nil)==errSecSuccess else{throw ShopError.security}
    }
    static func get(_ key:String)->Data? {
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var item:CFTypeRef?; return SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess ? item as? Data:nil
    }
    static func remove(_ key:String){ SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key] as CFDictionary) }
    static func text(_ key:String)->String? { get(key).flatMap{String(data:$0,encoding:.utf8)} }
}

enum CanonicalJSON {
    static func data(_ value:Any) throws -> Data { try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys,.withoutEscapingSlashes]) }
}

enum ShopError: LocalizedError {
    case unavailable, security, invalidResponse, signedOut, offlineQueued, contextChanged, unresolvedMutation
    var errorDescription:String? { String(localized: LocalizedStringResource(stringLiteral: String(describing:self))) }
}

// Original bare tokens and unbound offline records remain in their old keys.
// They cannot establish an account-bound active context or enter the new replay queue.
enum PendingApproval {
    static func digest(_ data:Data)->Data{Data(SHA256.hash(data:data))}
    static func permits(_ pending:Data,active:Data?,cancelled:Data?)->Bool{let original=digest(pending);return active==original && cancelled != original}
}
struct ShopSession: Codable, Equatable {
    static let storageKey="apple-commerce-session-context-v1"
    let account:String
    let token:String
    let expiresAt:String
    static func parse(_ data:Data?,now:Date=Date())->ShopSession? {
        guard let data,let value=try? JSONDecoder().decode(Self.self,from:data),
              value.account.range(of:"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$",options:.regularExpression) != nil,
              value.token.count>=24,value.token.utf8.allSatisfy({$0>=0x21 && $0<=0x7e}) else{return nil}
        let time=ISO8601DateFormatter();time.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let expiry=time.date(from:value.expiresAt) ?? ISO8601DateFormatter().date(from:value.expiresAt)
        guard let expiry,expiry>now else{return nil};return value
    }
}
struct OfflineEnvelope:Codable,Identifiable,Equatable {let id:String;let account:String;let method:String;let path:String;let body:Data;let createdAt:Date}
@MainActor final class OfflineQueue {
    private let read:()->Data?
    private let write:(Data)throws->Void
    init(read:@escaping ()->Data?={Vault.get("offline-mutations-account-bound-v1")},write:@escaping (Data)throws->Void={try Vault.put("offline-mutations-account-bound-v1",$0)}){self.read=read;self.write=write}
    private func businessPath(_ path:String)->Bool{path.range(of:"^orders(?:/[A-Za-z0-9._:-]{1,128}/(?:transition|pay-handoff))?$",options:.regularExpression) != nil}
    private func all()throws->[OfflineEnvelope]{guard let data=read() else{return []};let values=try JSONDecoder().decode([OfflineEnvelope].self,from:data);guard Set(values.map(\.id)).count==values.count,Set(values.map{$0.account+"|"+$0.path}).count==values.count,values.allSatisfy({$0.account.range(of:"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$",options:.regularExpression) != nil && $0.method=="POST" && businessPath($0.path)}) else{throw ShopError.security};return values}
    func load(account:String)throws->[OfflineEnvelope]{try all().filter{$0.account==account}}
    // Persist the original wire request before any network effect. A changed
    // body cannot rotate the key while the original result is still unknown.
    func prepare(account:String,path:String,input:[String:Any])throws->OfflineEnvelope{
        guard businessPath(path) else{throw ShopError.security};var values=try all();var original=input;original.removeValue(forKey:"IdempotencyKey")
        if let existing=values.first(where:{$0.account==account && $0.path==path}){
            guard var saved=try JSONSerialization.jsonObject(with:existing.body) as? [String:Any] else{throw ShopError.security};saved.removeValue(forKey:"IdempotencyKey")
            guard try CanonicalJSON.data(saved)==CanonicalJSON.data(original) else{throw ShopError.unresolvedMutation};return existing
        }
        guard account.range(of:"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$",options:.regularExpression) != nil else{throw ShopError.signedOut}
        original["IdempotencyKey"]=UUID().uuidString.lowercased()
        let item=OfflineEnvelope(id:UUID().uuidString,account:account,method:"POST",path:path,body:try CanonicalJSON.data(original),createdAt:Date());values.append(item);try write(JSONEncoder().encode(values));guard try all().contains(item) else{throw ShopError.security};return item
    }
    func confirmed(_ item:OfflineEnvelope)throws{
        var values=try all();guard let index=values.firstIndex(where:{$0.id==item.id}),values[index]==item else{throw ShopError.security};values.remove(at:index);try write(JSONEncoder().encode(values));guard try !all().contains(where:{$0.id==item.id}) else{throw ShopError.security}
    }
}
