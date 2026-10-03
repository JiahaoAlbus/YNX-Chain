import Foundation
import CoreFoundation
import CryptoKit

// Protocol bytes are JSON.stringify canonical bytes, not Foundation's optional
// slash/HTML/control escaping. All ports run synchronously on the owner actor.
enum NativeWire {
    static func matches(_ value:String,_ pattern:String)->Bool {value.range(of:pattern,options:.regularExpression) != nil}
    static func base64(_ data:Data)->String {data.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")}
    static func decode(_ value:String)throws->Data {guard matches(value,"^[A-Za-z0-9_-]+$") else{throw ShopError.security};let padded=value.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")+String(repeating:"=",count:(4-value.count%4)%4);guard let data=Data(base64Encoded:padded),base64(data)==value else{throw ShopError.security};return data}
    static func object(_ raw:String)throws->[String:Any] {guard raw.utf8.count<=1_048_576,let data=raw.data(using:.utf8),let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.security};return value}
    static func hash(_ raw:String)->String {SHA256.hash(data:Data(raw.utf8)).map{String(format:"%02x",$0)}.joined()}
    static func quote(_ value:String)->String {
        var result="\""
        for scalar in value.unicodeScalars {switch scalar.value {
        case 34:result+="\\\"";case 92:result+="\\\\";case 8:result+="\\b";case 12:result+="\\f";case 10:result+="\\n";case 13:result+="\\r";case 9:result+="\\t"
        case 0..<32:result+=String(format:"\\u%04x",scalar.value)
        default:result.unicodeScalars.append(scalar)
        }}
        return result+"\""
    }
    static func canonical(_ value:Any)throws->String {
        if value is NSNull{return "null"}
        if let object=value as? [String:Any] {return "{"+(try object.keys.sorted{Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16))}.map{quote($0)+":"+(try canonical(object[$0]!))}).joined(separator:",")+"}"}
        if let array=value as? [Any] {return "["+(try array.map{try canonical($0)}).joined(separator:",")+"]"}
        if let text=value as? String{return quote(text)}
        if let number=value as? NSNumber {if CFGetTypeID(number)==CFBooleanGetTypeID(){return number.boolValue ? "true":"false"};let decimal=number.doubleValue;guard decimal.isFinite,decimal.rounded()==decimal,abs(decimal)<=9_007_199_254_740_991 else{throw ShopError.security};return decimal==0 ? "0":String(format:"%.0f",locale:Locale(identifier:"en_US_POSIX"),decimal)}
        throw ShopError.security
    }
}

@MainActor final class AppleNativeProductState {
    static let app="com.ynxweb4.shop",scopes=["account:read","shop:orders:write","shop:profile:write"]
    // Persist the complete snapshot as original JSON. Do not delete unknown old
    // records or adopt another device's namespaces after key replacement.
    private let read:()throws->Data?
    private let write:(Data)throws->Void
    private var state:[String:Any]=[:]
    private var poisoned=false
    let platform:String
    var root:String {"ynx.product-session.v2:shop:"+platform+":"+Self.app}
    init(platform:String,deviceId:String,deviceKey:String,securityLevel:String,read:@escaping ()throws->Data?,write:@escaping (Data)throws->Void)throws {
        guard platform=="macos" else{throw ShopError.security};self.platform=platform;self.read=read;self.write=write
        if let saved=try read(){guard let raw=String(data:saved,encoding:.utf8) else{throw ShopError.security};let restored=try NativeWire.object(raw);try validateState(restored);guard let context=restored["context"] as? [String:Any],context["deviceKey"] as? String==deviceKey,context["securityLevel"] as? String==securityLevel else{throw ShopError.security};state=restored}
        else{try persist(["context":["platform":platform,"applicationId":Self.app,"deviceId":deviceId,"deviceKey":deviceKey,"securityLevel":securityLevel,"generation":1,"account":NSNull()],"namespaces":[String:Any]()])}
    }
    func context()throws->[String:Any] {guard !poisoned,let context=state["context"] as? [String:Any] else{throw ShopError.security};return context}
    private func expected(_ original:[String:Any])throws {try validateContext(original);guard try NativeWire.canonical(original)==NativeWire.canonical(context()) else{throw ShopError.contextChanged}}
    private func namespaces(_ value:[String:Any])throws->[String:[String:Any]] {guard let all=value["namespaces"] as? [String:[String:Any]] else{throw ShopError.security};return all}
    private func box(_ namespace:String,_ original:[String:Any],create:Bool=false)throws->[String:Any]? {
        try expected(original);guard NativeWire.matches(namespace,"^ynx\\.native-product-session\\.v2:[a-f0-9]{64}$") else{throw ShopError.security}
        if let box=try namespaces(state)[namespace]{guard try NativeWire.canonical(box["context"]!)==NativeWire.canonical(original) else{throw ShopError.contextChanged};return box}
        return create ? ["context":original,"values":[String:String](),"revocationRequested":false]:nil
    }
    private func update(_ namespace:String,_ box:[String:Any])throws {var all=try namespaces(state);all[namespace]=box;var next=state;next["namespaces"]=all;try persist(next)}
    private func checkKey(_ key:String)throws {guard [root,root+":pending",root+":return",root+":completion",root+":revoke"].contains(key) else{throw ShopError.security}}
    func get(_ namespace:String,_ key:String,_ original:[String:Any])throws->String? {try checkKey(key);return try box(namespace,original)?["values"].flatMap{$0 as? [String:String]}?[key]}
    func set(_ namespace:String,_ key:String,_ value:String,_ original:[String:Any])throws {try checkKey(key);guard value.utf16.count<=16384,var box=try box(namespace,original,create:true),var values=box["values"] as? [String:String] else{throw ShopError.security};values[key]=value;box["values"]=values;try update(namespace,box)}
    func remove(_ namespace:String,_ key:String,_ original:[String:Any])throws {try checkKey(key);guard var box=try box(namespace,original),var values=box["values"] as? [String:String] else{return};values.removeValue(forKey:key);box["values"]=values;try update(namespace,box)}
    func requestRevocation(_ namespace:String,_ original:[String:Any])throws {guard var box=try box(namespace,original,create:true) else{throw ShopError.security};box["revocationRequested"]=true;try update(namespace,box)}
    func revocationRequested(_ namespace:String,_ original:[String:Any])throws->Bool {try box(namespace,original)?["revocationRequested"] as? Bool ?? false}
    func requestCurrentRevocation()throws {let original=try context();var next=state,all=try namespaces(state);for (name,var box) in all where try NativeWire.canonical(box["context"]!)==NativeWire.canonical(original){box["revocationRequested"]=true;all[name]=box};next["namespaces"]=all;try persist(next)}
    private func negative(_ original:[String:Any])throws->Bool {try expected(original);return try namespaces(state).values.contains{box in try NativeWire.canonical(box["context"]!)==NativeWire.canonical(original) && box["revocationRequested"] as? Bool==true}}
    func permitOpen(_ original:[String:Any])throws {guard try !negative(original) else{throw ShopError.contextChanged}}
    func selectAccount(_ account:String?)throws {var original=try context();if let account{guard NativeWire.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else{throw ShopError.security}};if original["account"] as? String==account && (account != nil || original["account"] is NSNull){return};guard let generation=original["generation"] as? NSNumber,generation.int64Value<9_007_199_254_740_991 else{throw ShopError.security};original["generation"]=generation.int64Value+1;original["account"]=account as Any? ?? NSNull();var next=state;next["context"]=original;try persist(next)}
    func scope(_ original:[String:Any])throws->String {var subject=tuple();subject["deviceId"]=original["deviceId"];subject["deviceKey"]=original["deviceKey"];subject["scopes"]=Self.scopes;return NativeWire.hash("YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1\n"+(try NativeWire.canonical(subject)))}
    func tuple()->[String:Any] {["chainId":"ynx_6423-1","productId":"shop","clientId":"ynx-shop-v1","platform":platform,"applicationId":Self.app,"bundleId":Self.app,"packageId":NSNull(),"origin":"app://"+platform+"/"+Self.app,"callback":"ynxshop://wallet-auth/callback"]}
    func checkSubject(_ subject:[String:Any],_ original:[String:Any],requireAccount:Bool=true)throws {for(key,value) in tuple() where key != "chainId" && key != "platform"{guard let actual=subject[key],try NativeWire.canonical(actual)==NativeWire.canonical(value) else{throw ShopError.security}};guard subject["deviceId"] as? String==original["deviceId"] as? String,subject["deviceKey"] as? String==original["deviceKey"] as? String else{throw ShopError.security};if requireAccount,let account=original["account"] as? String{guard subject["account"] as? String==account else{throw ShopError.security}}}
    func checkWalletRequest(_ subject:[String:Any],_ original:[String:Any])throws {try expected(original);try checkSubject(subject,original,requireAccount:false);guard subject["chainId"] as? String=="ynx_6423-1",subject["platform"] as? String==platform,subject["deviceAlgorithm"] as? String=="p256-sha256",subject["scopes"] as? [String]==Self.scopes else{throw ShopError.security}}
    private func intent(_ raw:String,_ original:[String:Any])throws->[String:Any] {guard raw.utf16.count<=16384 else{throw ShopError.security};let value=try NativeWire.object(raw);guard value.count==4,(value["version"] as? NSNumber)?.intValue==1,let id=value["intentId"] as? String,NativeWire.matches(id,"^[A-Za-z0-9_-]{32,64}$"),value["scope"] as? String == (try scope(original)),let session=value["session"] else{throw ShopError.security};if !(session is NSNull){guard let target=session as? [String:Any],target["chainId"] as? String=="ynx_6423-1",target["platform"] as? String==platform,target["deviceAlgorithm"] as? String=="p256-sha256",target["scopes"] as? [String]==Self.scopes else{throw ShopError.security};try checkSubject(target,original)};return value}
    func saveRevocationIntent(_ namespace:String,_ key:String,_ raw:String,_ original:[String:Any])throws->String {guard key==root+":revoke" else{throw ShopError.security};let incoming=try intent(raw,original);if let previous=try get(namespace,key,original){let saved=try intent(previous,original);if saved["intentId"] as? String==incoming["intentId"] as? String,saved["scope"] as? String==incoming["scope"] as? String,saved["session"] is NSNull,!(incoming["session"] is NSNull){try set(namespace,key,raw,original);return raw};return previous};try set(namespace,key,raw,original);return raw}
    func finishRevocationIntent(_ namespace:String,_ key:String,_ raw:String,_ original:[String:Any])throws {guard key==root+":revoke",try get(namespace,key,original)==raw,var box=try box(namespace,original),var values=box["values"] as? [String:String] else{throw ShopError.contextChanged};let target=try intent(raw,original);var matches=false;if let active=values[root],let session=target["session"] as? [String:Any]{matches=try NativeWire.canonical(NativeWire.object(active))==NativeWire.canonical(session)};if values[root]==nil || matches{for key in [root,root+":pending",root+":return",root+":completion"]{values.removeValue(forKey:key)}};values.removeValue(forKey:key);box["values"]=values;box["revocationRequested"]=false;try update(namespace,box)}
    func sign(_ input:[String:Any],_ original:[String:Any],revokeOnly:Bool,signer:(Data)throws->String)throws->String {
        try expected(original);guard input.count==4,input["algorithm"] as? String=="p256-sha256",input["deviceKey"] as? String==original["deviceKey"] as? String,let purpose=input["purpose"] as? String,let encoded=input["payload"] as? String,encoded.count<=32768 else{throw ShopError.security}
        let prefix:String;if purpose=="challenge"{prefix="YNX_PRODUCT_SESSION_CHALLENGE_V2\n"}else if purpose=="http-proof"{prefix="YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"}else{throw ShopError.security}
        let bytes=try NativeWire.decode(encoded);guard let raw=String(data:bytes,encoding:.utf8),raw.hasPrefix(prefix) else{throw ShopError.security};let subject=try NativeWire.object(String(raw.dropFirst(prefix.count)));guard try prefix+NativeWire.canonical(subject)==raw else{throw ShopError.security};try checkSubject(subject,original)
        if purpose=="challenge"{guard subject["chainId"] as? String=="ynx_6423-1",subject["platform"] as? String==platform,subject["scopes"] as? [String]==Self.scopes else{throw ShopError.security}}
        if try revokeOnly || negative(original){guard purpose=="http-proof",subject["method"] as? String=="POST",subject["path"] as? String=="/v2/product-sessions/revoke",subject["bodyDigest"] as? String==NativeWire.hash("{}") else{throw ShopError.contextChanged};var found=false;for box in try namespaces(state).values where try NativeWire.canonical(box["context"]!)==NativeWire.canonical(original){if let values=box["values"] as? [String:String],let raw=values[root+":revoke"],let target=try intent(raw,original)["session"] as? [String:Any],let binding=subject["sessionBinding"] as? String,target["sessionBinding"] as? String==binding,let account=subject["account"] as? String,target["account"] as? String==account{found=true}};guard found else{throw ShopError.contextChanged}}
        return try signer(bytes)
    }
    private func persist(_ next:[String:Any])throws {try validateState(next);let raw=Data(try NativeWire.canonical(next).utf8);guard raw.count<=1_048_576 else{throw ShopError.security};do{try write(raw);guard try read()==raw else{throw ShopError.security};state=next}catch{poisoned=true;throw error}}
    private func validateContext(_ value:[String:Any])throws {guard value.count==7,value["platform"] as? String==platform,value["applicationId"] as? String==Self.app,let id=value["deviceId"] as? String,NativeWire.matches(id,"^[A-Za-z0-9._:-]{16,128}$"),let key=value["deviceKey"] as? String,key.count==44,let security=value["securityLevel"] as? String,["hardware-backed","os-protected"].contains(security),let generation=value["generation"] as? NSNumber,CFGetTypeID(generation) != CFBooleanGetTypeID(),generation.doubleValue.rounded()==generation.doubleValue,generation.int64Value>=1,generation.int64Value<=9_007_199_254_740_991,let account=value["account"] else{throw ShopError.security};let decoded=try NativeWire.decode(key);guard decoded.count==33,[2,3].contains(decoded.first!) else{throw ShopError.security};if !(account is NSNull){guard let text=account as? String,NativeWire.matches(text,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else{throw ShopError.security}}}
    private func validateState(_ value:[String:Any])throws {guard value.count==2,let context=value["context"] as? [String:Any] else{throw ShopError.security};try validateContext(context);for(name,box) in try namespaces(value){guard NativeWire.matches(name,"^ynx\\.native-product-session\\.v2:[a-f0-9]{64}$"),box.count==3,let context=box["context"] as? [String:Any],let values=box["values"] as? [String:String],let signal=box["revocationRequested"] as? NSNumber,CFGetTypeID(signal)==CFBooleanGetTypeID() else{throw ShopError.security};try validateContext(context);for(key,raw) in values{try checkKey(key);guard raw.utf16.count<=16384 else{throw ShopError.security}}}}
}
