import Foundation

@MainActor final class SellerMutationJournal {
    struct Record:Codable,Equatable {
        let key,account,storeID,target,kind,method,path,intentHash,requestHash:String
        let body:Data
        var phase:String
        var result:Data?
    }
    private let read:(String)throws->Data?,write:(String,Data)throws->Void
    init(read:@escaping (String)throws->Data?={try Vault.read($0)},write:@escaping (String,Data)throws->Void={try Vault.put($0,$1)}){self.read=read;self.write=write}
    private func namespace(_ account:String)->String{"apple-shop-seller-mutations-v1-"+NativeWire.hash(account)}
    func records(_ account:String)throws->[String:Record] {
        guard let bytes=try read(namespace(account)) else{return [:]}
        let values=try JSONDecoder().decode([String:Record].self,from:bytes)
        guard values.count<=256 else{throw ShopError.security}
        for (key,r) in values {
            guard r.key==key,r.account==account,["prepared","unknown","confirmed"].contains(r.phase),NativeWire.matches(key,"^[A-Za-z0-9-]{8,128}$"),
                  NativeWire.matches(r.storeID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),r.method=="POST",r.path.hasPrefix("/"),!r.path.hasPrefix("/api/"),r.body.count<=1_048_576,
                  let text=String(data:r.body,encoding:.utf8),NativeWire.hash(text)==r.requestHash,
                  var input=try JSONSerialization.jsonObject(with:r.body) as? [String:Any],input["IdempotencyKey"] as? String==key,
                  try CanonicalJSON.data(input)==r.body else{throw ShopError.security}
            _ = try AppleNativeBusinessPolicy.scopes(r.method,"/api"+r.path,profile:.seller)
            input.removeValue(forKey:"IdempotencyKey")
            guard NativeWire.hash(String(data:try CanonicalJSON.data(input),encoding:.utf8)!)==r.intentHash else{throw ShopError.security}
            if r.phase=="confirmed"{guard r.result != nil else{throw ShopError.security}}
        }
        return values
    }
    private func save(_ values:[String:Record],account:String)throws{let bytes=try JSONEncoder().encode(values);try write(namespace(account),bytes);guard try read(namespace(account))==bytes else{throw ShopError.security}}
    func prepare(account:String,storeID:String,target:String,kind:String,path:String,input:[String:Any])throws->Record {
        _ = try AppleNativeBusinessPolicy.scopes("POST","/api"+path,profile:.seller)
        guard input["IdempotencyKey"]==nil else{throw ShopError.security}
        let intent=NativeWire.hash(String(data:try CanonicalJSON.data(input),encoding:.utf8)!)
        var all=try records(account)
        let pending=all.values.filter{$0.storeID==storeID && $0.target==target && $0.phase != "confirmed"}
        guard pending.count<=1 else{throw ShopError.security}
        if let old=pending.first{guard old.path==path,old.intentHash==intent,old.kind==kind else{throw ShopError.unresolvedMutation};return old}
        guard all.count<256 else{throw ShopError.security}
        let key=UUID().uuidString.lowercased();var value=input;value["IdempotencyKey"]=key
        let body=try CanonicalJSON.data(value);guard body.count<=1_048_576 else{throw ShopError.security}
        let r=Record(key:key,account:account,storeID:storeID,target:target,kind:kind,method:"POST",path:path,intentHash:intent,requestHash:NativeWire.hash(String(data:body,encoding:.utf8)!),body:body,phase:"prepared",result:nil)
        all[key]=r;try save(all,account:account);return r
    }
    func input(_ r:Record)throws->[String:Any]{guard let original=try records(r.account)[r.key],original.requestHash==r.requestHash,let input=try JSONSerialization.jsonObject(with:original.body) as? [String:Any] else{throw ShopError.security};return input}
    func dispatch(_ r:Record)throws{var all=try records(r.account);guard var original=all[r.key],original.requestHash==r.requestHash,original.phase=="prepared" else{throw ShopError.unresolvedMutation};original.phase="unknown";all[r.key]=original;try save(all,account:r.account)}
    func confirm(_ r:Record,result:[String:Any])throws{var all=try records(r.account);guard var original=all[r.key],original.requestHash==r.requestHash else{throw ShopError.security};if original.phase=="confirmed"{return};guard original.phase=="unknown" else{throw ShopError.security};original.result=try CanonicalJSON.data(result);original.phase="confirmed";all[r.key]=original;try save(all,account:r.account)}
}
