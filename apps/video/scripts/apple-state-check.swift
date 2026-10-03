import CryptoKit
import Foundation
import Security

// Temporary injected storage and generated keys only, never the user's Keychain.
@main enum AppleStateChecks {
    struct Failure: Error { let message: String }
    static func require(_ value: Bool,_ message: String) throws { if !value { throw Failure(message:message) } }
    static func rejects(_ action: () throws -> Void) throws {
        do { try action() } catch { return }; throw Failure(message:"invalid operation was accepted")
    }
    static func main() throws {
        for platform in ["ios","macos"] {
            var stored: Data?; var writes=0; var fail=false
            let key=P256.Signing.PrivateKey(),deviceKey=VideoNativeState.encode(key.publicKey.compressedRepresentation)
            func make() throws -> VideoNativeState {
                try VideoNativeState(platform:platform,deviceId:"original-device-123456",deviceKey:deviceKey,
                    read:{stored},write:{if fail { throw Failure(message:"injected persistence failure") };writes+=1;stored=$0})
            }
            let state=try make(),context=try state.context()
            let namespace="ynx.native-product-session.v2:"+String(repeating:"a",count:64),root=state.root
            try state.set(namespace,root+":pending","original pending",context)
            let reopened=try make();try require(try reopened.context()==context,"cold boot changed original context")
            try require(try reopened.get(namespace,root+":pending",context)=="original pending","cold boot lost SDK pending")
            try rejects { try state.set(namespace,"ynx.product-session.v2:music:ios:com.ynxweb4.music","cross product",context) }
            var changed=context; changed.generation+=1
            try rejects { _ = try state.get(namespace,root,changed) }
            try state.requestRevocation(namespace,context)
            try require(try make().revocationRequested(namespace,context),"local negative did not survive cold boot")
            try rejects { _ = try state.withSigningContext(context) { "launch" } }
            let scope=try state.revocationScope(context)
            let id=String(repeating:"x",count:43)
            let nullIntent=try VideoNativeState.canonical(["version":1,"intentId":id,"scope":scope,"session":NSNull()])
            try require(try state.saveRevocationIntent(namespace,root+":revoke",nullIntent,context)==nullIntent,"intent not exact")
            let account="ynx1"+String(repeating:"q",count:38),binding=String(repeating:"s",count:43)
            let session: [String:Any] = ["productId":"video","clientId":"ynx-video-mobile-v1","applicationId":VideoNativeState.application,"bundleId":VideoNativeState.application,"packageId":NSNull(),"origin":"app://\(platform)/com.ynxweb4.video","callback":"ynxvideo://wallet-auth/callback","deviceId":context.deviceId,"deviceKey":context.deviceKey,"account":account,"chainId":"ynx_6423-1","platform":platform,"scopes":VideoNativeState.scopes,"deviceAlgorithm":"p256-sha256","sessionBinding":binding]
            let target=try VideoNativeState.canonical(["version":1,"intentId":id,"scope":scope,"session":session])
            try require(try state.saveRevocationIntent(namespace,root+":revoke",target,context)==target,"late exact target did not refine null intent")
            var proof=session;proof["method"]="POST";proof["path"]="/v2/product-sessions/revoke";proof["bodyDigest"]=VideoNativeState.hash(Data("{}".utf8))
            let bytes=try Data(("YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"+VideoNativeState.canonical(proof)).utf8)
            var input: [String:Any] = ["purpose":"http-proof","algorithm":"p256-sha256","deviceKey":deviceKey,"payload":VideoNativeState.encode(bytes)]
            let signed=try state.sign(input,context) { VideoNativeState.encode(try key.signature(for:$0).derRepresentation) }
            let signature=try P256.Signing.ECDSASignature(derRepresentation:VideoNativeState.decode(signed)!)
            try require(key.publicKey.isValidSignature(signature,for:bytes),"actual CryptoKit signature did not verify")
            proof["path"]="/v1/playlists";input["payload"]=try VideoNativeState.encode(Data(("YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"+VideoNativeState.canonical(proof)).utf8))
            try rejects { _ = try state.sign(input,context) { _ in throw Failure(message:"forbidden signer reached") } }
            let rival=try VideoNativeState.canonical(["version":1,"intentId":String(repeating:"z",count:43),"scope":scope,"session":session])
            try require(try state.saveRevocationIntent(namespace,root+":revoke",rival,context)==target,"rival intent replaced original target")
            try rejects { try state.finishRevocationIntent(namespace,root+":revoke",rival,context) }
            try state.finishRevocationIntent(namespace,root+":revoke",target,context)
            try require(try !state.revocationRequested(namespace,context),"ack did not clear original negative")
            try require(try state.get(namespace,root+":pending",context)==nil,"original pending survived completed null-current revoke")
            try state.selectAccount(account);try rejects { _ = try state.get(namespace,root,context) }
            try require(try state.context().generation==2,"selection generation did not persist")
            let current=try state.context();fail=true
            try rejects { try state.set("ynx.native-product-session.v2:"+String(repeating:"b",count:64),root,"not published",current) }
            try rejects { _ = try state.context() };fail=false
            try require(try make().context()==current,"failed write replaced durable context")
            let preserved=stored!
            var malformed=try JSONSerialization.jsonObject(with:preserved) as! [String:Any]
            malformed["unownedRecovery"]="preserve this";stored=try JSONSerialization.data(withJSONObject:malformed)
            let before=writes;try rejects { _ = try make() };try require(writes==before,"malformed state was silently rewritten");stored=preserved
            var keyCreates=0
            let missing=ProductDeviceKey(read:{(errSecItemNotFound,nil)},add:{_ in keyCreates+=1;return errSecSuccess},create:{keyCreates+=1;return key})
            let existingCustody=VideoNativeCustody(read:{(errSecSuccess,preserved)},add:{_ in throwawayStatus()},update:{_ in throwawayStatus()})
            try rejects { _ = try VideoNativeState.open(platform:platform,key:missing,custody:existingCustody) }
            try require(keyCreates==0,"saved metadata recreated absent original key")
            try require(writes>0,"no persistence exercised")
            print("PASS: \(platform) original protected state cold restore, negative retirement, exact target, CryptoKit proof, account fence, poisoned write recovery")
        }
        var adds=0,updates=0
        let locked=VideoNativeCustody(read:{(errSecInteractionNotAllowed,nil)},add:{_ in adds+=1;return errSecSuccess},update:{_ in updates+=1;return errSecSuccess})
        try rejects { try locked.write(Data("new".utf8)) };try require(adds==0 && updates==0,"locked custody was treated as missing")
        let race=VideoNativeCustody(read:{(errSecItemNotFound,nil)},add:{_ in adds+=1;return errSecDuplicateItem},update:{_ in updates+=1;return errSecSuccess})
        try rejects { try race.write(Data("new".utf8)) };try require(updates==0,"duplicate creation overwrote winning custody")
    }
    static func throwawayStatus() -> OSStatus { errSecAuthFailed }
}
