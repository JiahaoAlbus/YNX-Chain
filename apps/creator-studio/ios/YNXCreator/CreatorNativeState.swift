import CryptoKit
import Foundation
import Security

// Product metadata only. Every publication follows an acknowledged protected
// write; original Keychain device identity and media records are never migrated.
final class CreatorNativeState {
    enum Failure: Error { case invalidState, changedContext, pendingRevocation, unconfirmedPersistence }
    struct Context: Codable, Equatable {
        let platform, applicationId, deviceId, deviceKey, securityLevel: String
        var generation: UInt64
        var account: String?
        static func from(_ object: [String:Any]) throws -> Context {
            guard Set(object.keys)==Set(["platform","applicationId","deviceId","deviceKey","securityLevel","generation","account"]) else { throw Failure.invalidState }
            return try JSONDecoder().decode(Context.self,from:JSONSerialization.data(withJSONObject:object))
        }
        enum CodingKeys: String, CodingKey { case platform, applicationId, deviceId, deviceKey, securityLevel, generation, account }
        func encode(to encoder: Encoder) throws {
            var box=encoder.container(keyedBy:CodingKeys.self)
            try box.encode(platform,forKey:.platform); try box.encode(applicationId,forKey:.applicationId)
            try box.encode(deviceId,forKey:.deviceId); try box.encode(deviceKey,forKey:.deviceKey)
            try box.encode(securityLevel,forKey:.securityLevel); try box.encode(generation,forKey:.generation)
            if let account { try box.encode(account,forKey:.account) } else { try box.encodeNil(forKey:.account) }
        }
        func object() throws -> [String:Any] {
            ["platform":platform,"applicationId":applicationId,"deviceId":deviceId,
             "deviceKey":deviceKey,"securityLevel":securityLevel,"generation":generation,
             "account":account as Any? ?? NSNull()]
        }
    }
    private struct Box: Codable { let context: Context; var values: [String:String]; var revocationRequested: Bool }
    private struct Stored: Codable { let version: Int; var context: Context; var namespaces: [String:Box] }
    static let application = "com.ynxweb4.creator-studio"
    static let scopes = ["creator:account","creator:publish","creator:revenue"]
    let root: String
    private let lock = NSRecursiveLock()
    private let read: () throws -> Data?
    private let write: (Data) throws -> Void
    private var state: Stored
    private var poisoned = false

    static func open(platform: String, key: CreatorDeviceKey, custody: CreatorNativeCustody) throws -> CreatorNativeState {
        // Inspect protected metadata before any first-use key generation. A
        // saved runtime with a missing inherited key is a recovery condition.
        let saved=try custody.read()
        let publicKey=try key.compressedPublicKey(allowCreation:saved==nil)
        var bytes=[UInt8](repeating:0,count:32)
        guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else { throw Failure.invalidState }
        return try CreatorNativeState(platform:platform,deviceId:encode(Data(bytes)),deviceKey:publicKey,
            read:custody.read,write:custody.write)
    }

    init(platform: String, deviceId: String, deviceKey: String,
         read: @escaping () throws -> Data?, write: @escaping (Data) throws -> Void) throws {
        guard ["ios","macos"].contains(platform) else { throw Failure.invalidState }
        root = "ynx.product-session.v2:creator-studio:\(platform):\(Self.application)"
        self.read=read; self.write=write
        if let data=try read() {
            try Self.validateSnapshotShape(data)
            state=try JSONDecoder().decode(Stored.self,from:data)
            guard state.context.platform==platform,state.context.deviceKey==deviceKey else { throw Failure.changedContext }
            try validate(state)
        } else {
            state=Stored(version:1,context:Context(platform:platform,applicationId:Self.application,
                deviceId:deviceId,deviceKey:deviceKey,securityLevel:"os-protected",generation:1,account:nil),namespaces:[:])
            try persist(state)
        }
    }
    func context() throws -> Context { try locked { try live(); return state.context } }
    func selectAccount(_ account: String?) throws {
        try locked {
            try live(); if let account { guard Self.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else { throw Failure.invalidState } }
            if state.context.account==account { return }
            guard state.context.generation<9_007_199_254_740_991 else { throw Failure.invalidState }
            var next=state; next.context.generation+=1; next.context.account=account; try persist(next)
        }
    }
    func get(_ namespace: String,_ key: String,_ expected: Context) throws -> String? {
        try locked { try require(expected); try checkKey(key); try checkNamespace(namespace,expected,state); return state.namespaces[namespace]?.values[key] }
    }
    func set(_ namespace: String,_ key: String,_ value: String,_ expected: Context) throws {
        try locked { try require(expected); try checkKey(key); try bounded(value); var next=state; try ensure(namespace,expected,&next); next.namespaces[namespace]!.values[key]=value; try persist(next) }
    }
    func remove(_ namespace: String,_ key: String,_ expected: Context) throws {
        try locked { try require(expected); try checkKey(key); try checkNamespace(namespace,expected,state); guard state.namespaces[namespace] != nil else { return }; var next=state; next.namespaces[namespace]!.values.removeValue(forKey:key); try persist(next) }
    }
    func requestRevocation(_ namespace: String,_ expected: Context) throws {
        try locked { try require(expected); var next=state; try ensure(namespace,expected,&next); next.namespaces[namespace]!.revocationRequested=true; try persist(next) }
    }
    func requestCurrentRevocation(_ expected: Context) throws {
        try locked {
            try require(expected); var next=state; var changed=false
            for (name,box) in next.namespaces where box.context==expected { next.namespaces[name]!.revocationRequested=true; changed=true }
            if changed { try persist(next) }
        }
    }
    func revocationRequested(_ namespace: String,_ expected: Context) throws -> Bool {
        try locked { try require(expected); try checkNamespace(namespace,expected,state); return state.namespaces[namespace]?.revocationRequested ?? false }
    }
    func saveRevocationIntent(_ namespace: String,_ key: String,_ raw: String,_ expected: Context) throws -> String {
        try locked {
            try require(expected); guard key==root+":revoke" else { throw Failure.invalidState }; let incoming=try intent(raw,expected)
            var next=state; try ensure(namespace,expected,&next)
            if let previous=next.namespaces[namespace]!.values[key] {
                let original=try intent(previous,expected)
                guard original["intentId"] as? String == incoming["intentId"] as? String,
                      original["scope"] as? String == incoming["scope"] as? String,
                      original["session"] is NSNull, !(incoming["session"] is NSNull) else { return previous }
            }
            next.namespaces[namespace]!.values[key]=raw; try persist(next); return raw
        }
    }
    func finishRevocationIntent(_ namespace: String,_ key: String,_ raw: String,_ expected: Context) throws {
        try locked {
            try require(expected); guard key==root+":revoke" else { throw Failure.invalidState }; let target=try intent(raw,expected)
            try checkNamespace(namespace,expected,state)
            guard var box=state.namespaces[namespace],box.values[key]==raw else { throw Failure.changedContext }
            let current=box.values[root]
            let matches: Bool
            if let current,let session=target["session"] as? [String:Any] { matches=try Self.canonical(Self.object(current))==Self.canonical(session) } else { matches=false }
            if current==nil || matches { for suffix in ["",":pending",":return",":completion"] { box.values.removeValue(forKey:root+suffix) } }
            box.values.removeValue(forKey:key); box.revocationRequested=false
            var next=state; next.namespaces[namespace]=box; try persist(next)
        }
    }
    func withSigningContext<T>(_ expected: Context,_ action: () throws -> T) throws -> T {
        try locked { try require(expected); guard !negative(expected) else { throw Failure.pendingRevocation }; return try action() }
    }
    func sign(_ input: [String:Any],_ expected: Context,_ signer: (Data) throws -> String) throws -> String {
        try locked {
            try require(expected)
            guard Set(input.keys)==Set(["purpose","algorithm","deviceKey","payload"]),input["algorithm"] as? String=="p256-sha256",input["deviceKey"] as? String==expected.deviceKey,
                  let purpose=input["purpose"] as? String,["challenge","http-proof"].contains(purpose),
                  let payload=input["payload"] as? String,payload.count<=32768,Self.matches(payload,"^[A-Za-z0-9_-]+$"),let bytes=Self.decode(payload),Self.encode(bytes)==payload,
                  let text=String(data:bytes,encoding:.utf8) else { throw Failure.invalidState }
            let prefix=purpose=="challenge" ? "YNX_PRODUCT_SESSION_CHALLENGE_V2\n" : "YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"
            guard text.hasPrefix(prefix) else { throw Failure.invalidState }
            let subject=try Self.object(String(text.dropFirst(prefix.count)))
            guard try prefix+Self.canonical(subject)==text else { throw Failure.invalidState }
            try checkSubject(subject,expected)
            if purpose=="challenge" { try checkNative(subject,expected) }
            if negative(expected) {
                guard purpose=="http-proof",subject["method"] as? String=="POST",subject["path"] as? String=="/v2/product-sessions/revoke",subject["bodyDigest"] as? String==Self.hash(Data("{}".utf8)) else { throw Failure.pendingRevocation }
                var found=false
                for box in state.namespaces.values where box.context==expected {
                    if let raw=box.values[root+":revoke"],let target=try intent(raw,expected)["session"] as? [String:Any],
                       target["sessionBinding"] as? String==subject["sessionBinding"] as? String,
                       target["account"] as? String==subject["account"] as? String { found=true }
                }
                guard found else { throw Failure.pendingRevocation }
            }
            return try signer(bytes)
        }
    }
    func checkWalletRequest(_ request: [String:Any],_ expected: Context) throws {
        try locked {
            try require(expected); try checkSubject(request,expected,requireAccount:false); try checkNative(request,expected)
            guard request["deviceAlgorithm"] as? String=="p256-sha256" else { throw Failure.invalidState }
        }
    }
    private func intent(_ raw: String,_ expected: Context) throws -> [String:Any] {
        try bounded(raw); let value=try Self.object(raw)
        guard Set(value.keys)==Set(["version","intentId","scope","session"]),value["version"] as? Int==1,
              let id=value["intentId"] as? String,Self.matches(id,"^[A-Za-z0-9_-]{32,64}$"),value["scope"] as? String == (try revocationScope(expected)) else { throw Failure.invalidState }
        if let session=value["session"] as? [String:Any] {
            try checkSubject(session,expected); try checkNative(session,expected)
            guard session["deviceAlgorithm"] as? String=="p256-sha256",
                  let binding=session["sessionBinding"] as? String,Self.matches(binding,"^[A-Za-z0-9_-]{32,128}$"),
                  let account=session["account"] as? String,Self.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else { throw Failure.invalidState }
        }
        else if !(value["session"] is NSNull) { throw Failure.invalidState }
        return value
    }
    func revocationScope(_ expected: Context) throws -> String {
        var scope=tuple(expected); scope["chainId"]="ynx_6423-1"; scope["platform"]=expected.platform; scope["deviceId"]=expected.deviceId; scope["deviceKey"]=expected.deviceKey; scope["scopes"]=Self.scopes
        return try Self.hash(Data(("YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1\n"+Self.canonical(scope)).utf8))
    }
    private func tuple(_ context: Context) -> [String:Any] {
        ["productId":"creator-studio","clientId":"ynx-creator-studio-web-v1","applicationId":Self.application,"bundleId":Self.application,"packageId":NSNull(),"origin":"app://\(context.platform)/\(Self.application)","callback":"ynxcreator://wallet-auth/callback"]
    }
    private func checkSubject(_ value: [String:Any],_ expected: Context,requireAccount: Bool=true) throws {
        for (key,original) in tuple(expected) { guard let provided=value[key],try Self.canonical(provided)==Self.canonical(original) else { throw Failure.changedContext } }
        guard value["deviceId"] as? String==expected.deviceId,value["deviceKey"] as? String==expected.deviceKey else { throw Failure.changedContext }
        if requireAccount,let account=expected.account { guard value["account"] as? String==account else { throw Failure.changedContext } }
    }
    private func checkNative(_ value: [String:Any],_ expected: Context) throws {
        guard value["chainId"] as? String=="ynx_6423-1",value["platform"] as? String==expected.platform,value["scopes"] as? [String]==Self.scopes else { throw Failure.invalidState }
    }
    private func validate(_ value: Stored) throws {
        guard value.version==1 else { throw Failure.invalidState }; try validateContext(value.context)
        for (namespace,box) in value.namespaces { try validateContext(box.context); try checkNamespace(namespace,box.context,value); for (key,raw) in box.values { try checkKey(key); try bounded(raw) } }
    }
    private static func validateSnapshotShape(_ bytes: Data) throws {
        guard bytes.count<=2_097_152,
              let saved=try JSONSerialization.jsonObject(with:bytes) as? [String:Any],
              Set(saved.keys)==Set(["version","context","namespaces"]),
              let context=saved["context"] as? [String:Any],
              let all=saved["namespaces"] as? [String:Any] else { throw Failure.invalidState }
        let fields=Set(["platform","applicationId","deviceId","deviceKey","securityLevel","generation","account"])
        guard Set(context.keys)==fields else { throw Failure.invalidState }
        for raw in all.values {
            guard let box=raw as? [String:Any],Set(box.keys)==Set(["context","values","revocationRequested"]),
                  let original=box["context"] as? [String:Any],Set(original.keys)==fields else { throw Failure.invalidState }
        }
    }
    private func validateContext(_ context: Context) throws {
        guard ["ios","macos"].contains(context.platform),context.platform==state.context.platform,context.applicationId==Self.application,context.securityLevel=="os-protected",context.generation>0,context.generation<=9_007_199_254_740_991,
              Self.matches(context.deviceId,"^[A-Za-z0-9._:-]{16,128}$"),Self.matches(context.deviceKey,"^[A-Za-z0-9_-]{44}$"),let key=Self.decode(context.deviceKey),key.count==33,[2,3].contains(key[0]) else { throw Failure.invalidState }
        if let account=context.account { guard Self.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else { throw Failure.invalidState } }
    }
    private func checkNamespace(_ namespace: String,_ expected: Context,_ value: Stored) throws {
        guard Self.matches(namespace,"^ynx\\.native-product-session\\.v2:[a-f0-9]{64}$") else { throw Failure.invalidState }
        if let box=value.namespaces[namespace],box.context != expected { throw Failure.changedContext }
    }
    private func ensure(_ namespace: String,_ expected: Context,_ value: inout Stored) throws { try checkNamespace(namespace,expected,value); if value.namespaces[namespace]==nil { value.namespaces[namespace]=Box(context:expected,values:[:],revocationRequested:false) } }
    private func negative(_ expected: Context) -> Bool { state.namespaces.values.contains { $0.context==expected && $0.revocationRequested } }
    private func require(_ expected: Context) throws { try live(); guard expected==state.context else { throw Failure.changedContext } }
    private func live() throws { if poisoned { throw Failure.unconfirmedPersistence } }
    private func checkKey(_ key: String) throws { guard ["",":pending",":return",":completion",":revoke"].map({root+$0}).contains(key) else { throw Failure.invalidState } }
    private func bounded(_ raw: String) throws { guard raw.utf16.count<=16384 else { throw Failure.invalidState } }
    private func persist(_ next: Stored) throws {
        try validate(next); let bytes=try JSONEncoder().encode(next)
        do { try write(bytes); guard try read()==bytes else { throw Failure.unconfirmedPersistence }; state=next }
        catch { poisoned=true; throw error }
    }
    private func locked<T>(_ action: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try action() }
    static func matches(_ value: String,_ pattern: String) -> Bool { value.range(of:pattern,options:.regularExpression) == value.startIndex..<value.endIndex }
    static func encode(_ bytes: Data) -> String { bytes.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
    static func decode(_ text: String) -> Data? { Data(base64Encoded:text.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")+String(repeating:"=",count:(4-text.count%4)%4)) }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined() }
    static func object(_ raw: String) throws -> [String:Any] { guard let object=try JSONSerialization.jsonObject(with:Data(raw.utf8)) as? [String:Any] else { throw Failure.invalidState }; return object }
    static func canonical(_ value: Any) throws -> String {
        let bytes=try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys,.withoutEscapingSlashes,.fragmentsAllowed])
        guard let text=String(data:bytes,encoding:.utf8) else { throw Failure.invalidState }; return text
    }
}
