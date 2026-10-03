import Foundation
import CryptoKit
import Security
#if canImport(AppKit)
import AppKit
#endif

// Keychain access errors are distinct from absent items. Inaccessible/corrupt
// original records never trigger a fresh key or namespace.
enum AppleNativeVault {
    static let service="com.ynxweb4.shop.native-product-v2"
    static func read(_ key:String)throws->Data? {let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne];var item:CFTypeRef?;let status=SecItemCopyMatching(query as CFDictionary,&item);if status==errSecItemNotFound{return nil};guard status==errSecSuccess,let data=item as? Data else{throw ShopError.security};return data}
    static func write(_ key:String,_ data:Data)throws {let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key];let attrs:[String:Any]=[kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly];let status=SecItemUpdate(query as CFDictionary,attrs as CFDictionary);if status==errSecSuccess{return};guard status==errSecItemNotFound else{throw ShopError.security};var value=query;value.merge(attrs){_,new in new};guard SecItemAdd(value as CFDictionary,nil)==errSecSuccess else{throw ShopError.security}}
}

@MainActor final class AppleNativeProtectedRuntime {
    private let key:SecureEnclave.P256.Signing.PrivateKey
    let state:AppleNativeProductState
    init(bundle:Bundle = .main)throws {
#if os(macOS)
        guard bundle.bundleIdentifier==AppleNativeProductState.app,SecureEnclave.isAvailable else{throw ShopError.unavailable}
        let original=try AppleNativeVault.read("secure-enclave-p256-v2")
        let protected=try AppleNativeVault.read("native-product-state-v2")
        if let original {key=try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation:original)}
        else {
            // Never replace a missing key while original protected state exists.
            guard protected==nil else{throw ShopError.security}
            var failure:Unmanaged<CFError>?
            guard let access=SecAccessControlCreateWithFlags(nil,kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,[.privateKeyUsage],&failure) else{throw ShopError.security}
            key=try SecureEnclave.P256.Signing.PrivateKey(accessControl:access)
            let blob=key.dataRepresentation;try AppleNativeVault.write("secure-enclave-p256-v2",blob);guard try AppleNativeVault.read("secure-enclave-p256-v2")==blob else{throw ShopError.security}
        }
        let deviceKey=NativeWire.base64(key.publicKey.compressedRepresentation)
        state=try AppleNativeProductState(platform:"macos",deviceId:UUID().uuidString.lowercased(),deviceKey:deviceKey,securityLevel:"hardware-backed",read:{try AppleNativeVault.read("native-product-state-v2")},write:{try AppleNativeVault.write("native-product-state-v2",$0)})
#else
        // Only the adopted registered macOS Native tuple is admitted here.
        throw ShopError.unavailable
#endif
    }
    func readContext()throws->[String:Any] {try state.context()}
    func randomBytes(_ length:Int)throws->Data {guard length==32 else{throw ShopError.security};var data=Data(count:32);let status=data.withUnsafeMutableBytes{SecRandomCopyBytes(kSecRandomDefault,32,$0.baseAddress!)};guard status==errSecSuccess else{throw ShopError.security};return data}
    func sign(_ input:[String:Any],expected:[String:Any],revokeOnly:Bool)throws->String {try state.sign(input,expected,revokeOnly:revokeOnly){NativeWire.base64(try key.signature(for:$0).derRepresentation)}}
    func openInvoice(_ url:URL,expected:[String:Any])throws->Bool {
        try state.permitOpen(expected)
        guard let parts=URLComponents(url:url,resolvingAgainstBaseURL:false),parts.scheme=="ynxpay",parts.host=="invoice",parts.query==nil,parts.fragment==nil,parts.user==nil,parts.password==nil,parts.port==nil,NativeWire.matches(parts.path,"^/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),url.absoluteString=="ynxpay://invoice"+parts.path else{throw ShopError.security}
        try state.permitOpen(expected)
#if canImport(AppKit)
        return NSWorkspace.shared.open(url)
#else
        throw ShopError.unavailable
#endif
    }
    func openWallet(_ input:[String:Any],expected:[String:Any])throws->Bool {
        try state.permitOpen(expected)
        guard input.count==2,let raw=input["url"] as? String,let request=input["request"] as? [String:Any],let components=URLComponents(string:raw),components.scheme=="ynxwallet",components.host=="authorize",components.path.isEmpty,components.user==nil,components.password==nil,components.port==nil,components.fragment==nil,let items=components.queryItems,items.count==1,items[0].name=="request",let encoded=items[0].value,raw=="ynxwallet://authorize?request="+encoded else{throw ShopError.security}
        let decoded=try NativeWire.decode(encoded);guard let text=String(data:decoded,encoding:.utf8),try text==NativeWire.canonical(request) else{throw ShopError.security};try state.checkWalletRequest(request,expected);try state.permitOpen(expected)
#if canImport(AppKit)
        guard let url=components.url else{throw ShopError.security};return NSWorkspace.shared.open(url)
#else
        throw ShopError.unavailable
#endif
    }
}
