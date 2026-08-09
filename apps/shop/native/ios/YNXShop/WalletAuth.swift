import CryptoKit
import Foundation
import UIKit

enum WalletAuth {
    static let client="ynx-shop-v1", bundle="com.ynxweb4.shop", callback="ynxshop://wallet-auth/callback", protocolName="wallet-auth-v1"
    static let scopes=["account:read","shop:orders:write","shop:profile:write"]
    private static let iso:ISO8601DateFormatter={let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return f}()
    static func begin(api:APIClient) async throws {
        let config=try await api.raw("auth/config?surface=buyer",method:"GET",json:[:])
        guard config["protocol"] as? String==protocolName,config["clientId"] as? String==client,config["bundleId"] as? String==bundle,config["callback"] as? String==callback,config["scopes"] as? [String]==scopes else{throw ShopError.security}
        let key:P256.Signing.PrivateKey
        if let stored=Vault.get("device-p256"){key = try .init(rawRepresentation:stored)}else{key = .init();try Vault.put("device-p256",key.rawRepresentation)}
        let now=Date(),expires=now.addingTimeInterval(240),nonce=UUID().uuidString.replacingOccurrences(of:"-",with:"").lowercased()
        let request:[String:Any]=["protocol":protocolName,"requestId":UUID().uuidString.lowercased(),"clientId":client,"bundleId":bundle,"callback":callback,"network":"ynx_6423-1","nonce":nonce,"scopes":scopes,"purpose":String(localized:"signing_text"),"issuedAt":iso.string(from:now),"expiresAt":iso.string(from:expires)]
        try Vault.put("wallet-pending",try CanonicalJSON.data(request))
        var parts=URLComponents();parts.scheme="ynxwallet";parts.host="authorize";parts.queryItems=[URLQueryItem(name:"request",value:try String(data:CanonicalJSON.data(request),encoding:.utf8))]
        guard let url=parts.url else{throw ShopError.security};await UIApplication.shared.open(url)
    }
    static func complete(_ url:URL,api:APIClient) async throws {
        guard url.scheme=="ynxshop",url.host=="wallet-auth",url.path=="/callback",let raw=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="response"})?.value?.data(using:.utf8),let approval=try JSONSerialization.jsonObject(with:raw) as? [String:Any],let pendingData=Vault.get("wallet-pending"),let pending=try JSONSerialization.jsonObject(with:pendingData) as? [String:Any] else{throw ShopError.security}
        let requestId=approval["requestId"] as? String ?? "",account=approval["account"] as? String ?? "",signature=approval["signature"] as? String ?? ""
        guard approval["protocol"] as? String==protocolName,requestId==pending["requestId"] as? String,approval["clientId"] as? String==client,approval["bundleId"] as? String==bundle,approval["callback"] as? String==callback,approval["nonce"] as? String==pending["nonce"] as? String,approval["scopes"] as? [String]==scopes,!account.isEmpty,!signature.isEmpty,Vault.get("replay-\(requestId)")==nil else{throw ShopError.security}
        let challenge=try await api.raw("auth/gateway/challenges",json:["walletApproval":approval,"devicePublicKey":try publicKey()])
        guard let challengeJSON=challenge["challenge"] as? [String:Any] else{throw ShopError.security}
        let signing=Data("YNX_PRODUCT_SESSION_CHALLENGE_V1\n".utf8)+((try? CanonicalJSON.data(challengeJSON)) ?? Data())
        let key=try P256.Signing.PrivateKey(rawRepresentation:Vault.get("device-p256")!);let proof=try key.signature(for:signing).derRepresentation.base64EncodedString()
        let session=try await api.raw("auth/gateway/sessions",json:["walletApproval":approval,"challenge":challengeJSON,"deviceSignature":proof])
        guard let token=session["token"] as? String,token.count>=24,session["account"] as? String==account,let expires=session["expiresAt"] as? String,let expiry=iso.date(from:expires),expiry>Date() else{throw ShopError.security}
        try Vault.put("product-session",Data(token.utf8));try Vault.put("replay-\(requestId)",Data(iso.string(from:Date()).utf8));Vault.remove("wallet-pending")
    }
    private static func publicKey() throws->String {let key=try P256.Signing.PrivateKey(rawRepresentation:Vault.get("device-p256")!);return key.publicKey.compressedRepresentation.map{String(format:"%02x",$0)}.joined()}
}
