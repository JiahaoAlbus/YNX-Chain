import Foundation
import Security

// Separate SDK metadata; the original wallet-auth-v1 device key and any media
// files retain their inherited names and accessibility. Failed writes retain
// the old item; no delete-and-add recovery is performed.
final class VideoNativeCustody {
    enum Failure: Error { case read(OSStatus), write(OSStatus), invalidData }
    typealias Read = () -> (OSStatus, Data?)
    typealias Add = (Data) -> OSStatus
    typealias Update = (Data) -> OSStatus
    private let readItem: Read
    private let addItem: Add
    private let updateItem: Update
    init(read: @escaping Read, add: @escaping Add, update: @escaping Update) {
        readItem=read; addItem=add; updateItem=update
    }
    convenience init(platform: String,viewerAccount: String? = nil) throws {
        guard ["ios","macos"].contains(platform) else { throw Failure.invalidData }
        if let viewerAccount { guard VideoNativeState.matches(viewerAccount,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else { throw Failure.invalidData } }
        let service=viewerAccount==nil ? "com.ynxweb4.video.product-session.v2" : "com.ynxweb4.video.viewer.v2"
        let item=viewerAccount.map{platform+":"+VideoNativeState.hash(Data($0.utf8))} ?? platform
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:service,
            kSecAttrAccount as String:item]
        self.init(read: {
            var request=query; request[kSecReturnData as String]=true; request[kSecMatchLimit as String]=kSecMatchLimitOne
            var result: CFTypeRef?; let status=SecItemCopyMatching(request as CFDictionary,&result)
            return (status,result as? Data)
        },add: { bytes in
            var item=query; item[kSecValueData as String]=bytes
            item[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            return SecItemAdd(item as CFDictionary,nil)
        },update: { bytes in
            SecItemUpdate(query as CFDictionary,[kSecValueData as String:bytes] as CFDictionary)
        })
    }
    func read() throws -> Data? {
        let (status,bytes)=readItem()
        if status==errSecItemNotFound { return nil }
        guard status==errSecSuccess else { throw Failure.read(status) }
        guard let bytes,!bytes.isEmpty,bytes.count<=2_097_152 else { throw Failure.invalidData }
        return bytes
    }
    func write(_ bytes: Data) throws {
        guard !bytes.isEmpty,bytes.count<=2_097_152 else { throw Failure.invalidData }
        let prior=try read()
        let status=prior==nil ? addItem(bytes) : updateItem(bytes)
        // Duplicate first creation is not overwritten with a losing context.
        guard status==errSecSuccess else { throw Failure.write(status) }
        guard try read()==bytes else { throw Failure.invalidData }
    }
}
