import Foundation

// Local editable data only. No server publication or approved price is inferred
// from a saved draft. Prior versions remain encrypted in bounded local history.
@MainActor final class SellerLocalDraftStore {
    struct Record:Codable {let account,storeID,productID:String;var versions:[Data]}
    private let read:(String)throws->Data?,write:(String,Data)throws->Void
    init(read:@escaping (String)throws->Data?={try Vault.read($0)},write:@escaping (String,Data)throws->Void={try Vault.put($0,$1)}){self.read=read;self.write=write}
    private func namespace(_ account:String)->String{"apple-shop-seller-local-drafts-v1-"+NativeWire.hash(account)}
    private func records(_ account:String)throws->[String:Record]{guard let data=try read(namespace(account)) else{return [:]};guard data.count<=1_048_576 else{throw ShopError.security};let records=try JSONDecoder().decode([String:Record].self,from:data);guard records.count<=64 else{throw ShopError.security};for (key,r) in records{guard r.account==account,key==NativeWire.hash(r.storeID+"\n"+r.productID),NativeWire.matches(r.storeID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),NativeWire.matches(r.productID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),!r.versions.isEmpty,r.versions.count<=16 else{throw ShopError.security};for bytes in r.versions{let d=try JSONDecoder().decode(SellerListingDraft.self,from:bytes);guard d.productID==r.productID else{throw ShopError.security}}};return records}
    func load(account:String,storeID:String)throws->[String:SellerListingDraft]{let values=try records(account);var drafts:[String:SellerListingDraft]=[:];for r in values.values where r.storeID==storeID{drafts[r.productID]=try JSONDecoder().decode(SellerListingDraft.self,from:r.versions.last!)};return drafts}
    func save(account:String,storeID:String,draft:SellerListingDraft)throws{var values=try records(account);let key=NativeWire.hash(storeID+"\n"+draft.productID);let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys];let bytes=try encoder.encode(draft);guard bytes.count<=65_536 else{throw ShopError.security};var record=values[key] ?? Record(account:account,storeID:storeID,productID:draft.productID,versions:[]);if record.versions.last==bytes{return};guard record.versions.count<16,values[key] != nil || values.count<64 else{throw ShopError.security};record.versions.append(bytes);values[key]=record;let result=try JSONEncoder().encode(values);guard result.count<=1_048_576 else{throw ShopError.security};try write(namespace(account),result);guard try read(namespace(account))==result else{throw ShopError.security}}
}
