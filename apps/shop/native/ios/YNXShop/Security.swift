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
    static func read(_ key:String)throws->Data? {
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var item:CFTypeRef?;let status=SecItemCopyMatching(query as CFDictionary,&item);if status==errSecItemNotFound{return nil};guard status==errSecSuccess,let data=item as? Data else{throw ShopError.security};return data
    }
    static func get(_ key:String)->Data? {try? read(key)}
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
    let nativeGeneration:Int?
    init(account:String,token:String,expiresAt:String,nativeGeneration:Int?=nil){self.account=account;self.token=token;self.expiresAt=expiresAt;self.nativeGeneration=nativeGeneration}
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
    private let read:()throws->Data?
    private let write:(Data)throws->Void
    init(read:@escaping ()throws->Data?={try Vault.read("offline-mutations-account-bound-v1")},write:@escaping (Data)throws->Void={try Vault.put("offline-mutations-account-bound-v1",$0)}){self.read=read;self.write=write}
    private func businessPath(_ path:String)->Bool{path.range(of:"^orders(?:/[A-Za-z0-9._:-]{1,128}/(?:transition|pay-handoff))?$",options:.regularExpression) != nil}
    private func all()throws->[OfflineEnvelope]{guard let data=try read() else{return []};let values=try JSONDecoder().decode([OfflineEnvelope].self,from:data);guard Set(values.map(\.id)).count==values.count,Set(values.map{$0.account+"|"+$0.path}).count==values.count,values.allSatisfy({$0.account.range(of:"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$",options:.regularExpression) != nil && $0.method=="POST" && businessPath($0.path)}) else{throw ShopError.security};return values}
    func load(account:String)throws->[OfflineEnvelope]{try all().filter{$0.account==account && !$0.path.hasSuffix("/pay-handoff")}}
    func hasPending(account:String)throws->Bool{try all().contains{$0.account==account}}
    func originalHandoff(account:String,path:String)throws->OfflineEnvelope?{guard path.hasSuffix("/pay-handoff") else{throw ShopError.security};guard let item=try all().first(where:{$0.account==account && $0.path==path}) else{return nil};guard let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any],body.count==1,let key=body["IdempotencyKey"] as? String,key.range(of:"^[A-Za-z0-9._:-]{8,128}$",options:.regularExpression) != nil else{throw ShopError.security};return item}
    // Persist the original wire request before any network effect. A changed
    // body cannot rotate the key while the original result is still unknown.
    func prepare(account:String,path:String,input:[String:Any])throws->OfflineEnvelope{
        guard businessPath(path),!path.hasSuffix("/pay-handoff") else{throw ShopError.security};var values=try all();var original=input;original.removeValue(forKey:"IdempotencyKey")
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

// Invoice preparation has its own durable journal and requires an explicit
// current-order click. It never enters batch/offline execution or grants payment.
@MainActor final class InvoiceHandoffJournal {
    struct Record:Codable,Equatable {let key:String;let digest:String}
    struct Prepared {let namespace:String;let target:String;let record:Record;let orderID:String}
    private let read:(String)throws->Data?
    private let write:(String,Data)throws->Void
    init(read:@escaping (String)throws->Data?={try Vault.read($0)},write:@escaping (String,Data)throws->Void={try Vault.put($0,$1)}){self.read=read;self.write=write}
    private func hash(_ text:String)->String{SHA256.hash(data:Data(text.utf8)).map{String(format:"%02x",$0)}.joined()}
    private func namespace(_ account:String)->String{"apple-invoice-handoffs-v1-"+hash(account)}
    private func records(_ namespace:String)throws->[String:Record]{guard let data=try read(namespace) else{return [:]};let records=try JSONDecoder().decode([String:Record].self,from:data);guard records.allSatisfy({$0.key.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil && $0.value.key.range(of:"^[A-Za-z0-9._:-]{8,128}$",options:.regularExpression) != nil && $0.value.digest.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil}) else{throw ShopError.security};return records}
    func digest(_ order:Order)throws->String{guard order.orderID.range(of:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",options:.regularExpression) != nil,let account=order.buyer,(NativeWire.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") || NativeWire.matches(account,"^0x[a-fA-F0-9]{40}$")),let store=order.storeID,!store.isEmpty,order.totalYNXT>0,order.currency=="YNXT" else{throw ShopError.security};return hash(String(decoding:try CanonicalJSON.data([order.orderID,account,store,String(order.totalYNXT),"YNXT"]),as:UTF8.self))}
    func prepare(account:String,order:Order,originalKey:String?=nil)throws->Prepared{guard AppleBuyerReceipt.owned(order,account),originalKey==nil || originalKey!.range(of:"^[A-Za-z0-9._:-]{8,128}$",options:.regularExpression) != nil else{throw ShopError.security};let namespace=namespace(account),target=hash(order.orderID),digest=try digest(order);var saved=try records(namespace);let record:Record;if let original=saved[target]{guard original.digest==digest,originalKey==nil || original.key==originalKey else{throw ShopError.unresolvedMutation};record=original}else{record=Record(key:originalKey ?? UUID().uuidString.lowercased(),digest:digest);saved[target]=record;try write(namespace,JSONEncoder().encode(saved));guard try records(namespace)==saved else{throw ShopError.security}};return Prepared(namespace:namespace,target:target,record:record,orderID:order.orderID)}
    func existing(account:String,order:Order)throws->Bool {try records(namespace(account))[hash(order.orderID)] != nil}
    func reviewURL(_ original:Prepared,response:[String:Any])throws->URL{guard let raw=response["order"] as? [String:Any],let invoice=response["invoiceId"] as? String,invoice.range(of:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",options:.regularExpression) != nil,raw["InvoiceID"] as? String==invoice,let link=response["deepLink"] as? String,link=="ynxpay://invoice/"+invoice,let url=URL(string:link) else{throw ShopError.security};let order=try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(raw));guard try digest(order)==original.record.digest,try records(original.namespace)[original.target]==original.record else{throw ShopError.security};return url}
    func confirmed(_ original:Prepared)throws{var saved=try records(original.namespace);guard saved[original.target]==original.record else{throw ShopError.security};saved.removeValue(forKey:original.target);try write(original.namespace,JSONEncoder().encode(saved));guard try records(original.namespace)==saved else{throw ShopError.security}}
    func hasPending(account:String)throws->Bool{try !records(namespace(account)).isEmpty}
}

// Product drafts and original-target observations use the EXISTING Vault service.
// This journal carries no approval, signing key or payment authority.
enum AppleBuyerReceipt {
    static func owned(_ order:Order,_ account:String)->Bool {order.buyer==account || (order.walletBuyer==account && NativeWire.matches(order.buyer ?? "","^0x[a-fA-F0-9]{40}$"))}
    static func validate(_ order:Order,account:String)throws {
        guard owned(order,account),NativeWire.matches(order.orderID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),order.totalYNXT>0,order.currency=="YNXT" else{throw ShopError.security}
        if ["paid","shipped","delivered","reviewed","return_requested","return_approved","refund_requested","refunded"].contains(order.status) {
            guard let r=order.settlement,NativeWire.matches(order.invoiceID ?? "","^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),NativeWire.matches(order.payIntentID ?? "","^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),!(order.payMerchant ?? "").isEmpty,!(order.payPayoutAddress ?? "").isEmpty,r.Status=="paid",r.InvoiceID==order.invoiceID,r.IntentID==order.payIntentID,r.Merchant==order.payMerchant,r.PayoutAddress==order.payPayoutAddress,r.Payer==account,r.Currency=="YNXT",r.AmountYNXT==order.totalYNXT,r.BlockHeight>0,NativeWire.matches(r.TransactionHash,"^0x[a-fA-F0-9]{64}$") else{throw ShopError.security}
        }
    }
    static func decode(_ json:[String:Any],account:String)throws->Order {let order=try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(json));try validate(order,account:account);return order}
}
@MainActor final class AppleBuyerJourney {
    struct CartIntent:Codable {let key:String;let expected:String;let items:[CartItem]}
    struct Review:Codable {let original:Order;let key:String;let digest:String;var phase:String;var invoiceID:String?;var intentID:String?;var url:String?;var observed:Order?}
    struct Draft:Codable {let account:String;var items:[CartItem]=[];var revision:String?;var dirty=false;var cartIntent:CartIntent?;var checkoutKey:String?;var checkoutPhase:String?;var review:Review?}
    private let read:(String)throws->Data?,write:(String,Data)throws->Void
    init(read:@escaping (String)throws->Data?={try Vault.read($0)},write:@escaping (String,Data)throws->Void={try Vault.put($0,$1)}){self.read=read;self.write=write}
    private func key(_ account:String)throws->String{guard NativeWire.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else{throw ShopError.security};return "apple-buyer-draft-v1-"+account}
    func guest()throws->[CartItem] {guard let raw=try read("apple-buyer-guest-cart-v1") else{return []};return try JSONDecoder().decode([CartItem].self,from:raw)}
    func editGuest(_ items:[CartItem])throws {let raw=try JSONEncoder().encode(items);try write("apple-buyer-guest-cart-v1",raw);guard try read("apple-buyer-guest-cart-v1")==raw else{throw ShopError.security}}
    func load(_ account:String)throws->Draft {guard let raw=try read(key(account)) else{return Draft(account:account)};let d=try JSONDecoder().decode(Draft.self,from:raw);guard d.account==account,d.items.allSatisfy({NativeWire.matches($0.productID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") && NativeWire.matches($0.variantID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") && $0.quantity>0}),d.checkoutPhase==nil || ["prepared","unknown"].contains(d.checkoutPhase!),d.review==nil || ["prepared","unknown","invoice_ready","wallet_opened"].contains(d.review!.phase) else{throw ShopError.security};return d}
    private func save(_ d:Draft)throws {let raw=try JSONEncoder().encode(d),name=try key(d.account);try write(name,raw);guard try read(name)==raw else{throw ShopError.security}}
    static func same(_ a:[CartItem],_ b:[CartItem])throws->Bool {try CanonicalJSON.data(a.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]})==CanonicalJSON.data(b.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]})}
    func edit(_ account:String,items:[CartItem])throws {var d=try load(account);guard d.cartIntent==nil else{throw ShopError.unresolvedMutation};d.items=items;d.dirty=true;try save(d)}
    func cartRead(_ json:[String:Any],account:String)throws->(String,[CartItem]) {guard json["Buyer"] as? String==account || (json["WalletBuyer"] as? String==account && NativeWire.matches(json["Buyer"] as? String ?? "","^0x[a-fA-F0-9]{40}$")),let revision=json["Revision"] as? String else{throw ShopError.security};let items=try JSONDecoder().decode([CartItem].self,from:CanonicalJSON.data(json["Items"] as? [[String:Any]] ?? []));return (revision,items)}
    func reconcileCart(_ json:[String:Any],account:String)throws {let(revision,items)=try cartRead(json,account:account);var d=try load(account);if let pending=d.cartIntent {guard revision != pending.expected,try Self.same(items,pending.items) else{throw ShopError.unresolvedMutation};d.cartIntent=nil;d.revision=revision;d.dirty=false}else if d.dirty{d.revision=revision}else{d.items=items;d.revision=revision};try save(d)}
    func prepareCart(_ account:String)throws->CartIntent {var d=try load(account);guard d.cartIntent==nil,let revision=d.revision else{throw ShopError.unresolvedMutation};let item=CartIntent(key:UUID().uuidString.lowercased(),expected:revision,items:d.items);d.cartIntent=item;try save(d);return item}
    func deletionPermitted(_ account:String)throws->Bool {let d=try load(account);return d.cartIntent==nil && d.checkoutPhase==nil && d.review==nil}
    func deletedDraft(_ account:String)throws {guard try deletionPermitted(account) else{throw ShopError.unresolvedMutation};var d=try load(account);d.items=[];d.revision=nil;d.dirty=false;try save(d)}
    func checkoutPrepared(_ account:String,item:OfflineEnvelope,existing:Bool)throws {var d=try load(account);guard !existing || (d.checkoutKey==item.id && d.checkoutPhase=="prepared") else{throw ShopError.unresolvedMutation};d.checkoutKey=item.id;d.checkoutPhase="prepared";try save(d)}
    func checkoutDispatch(_ account:String,item:OfflineEnvelope)throws {var d=try load(account);guard d.checkoutKey==item.id,d.checkoutPhase=="prepared" else{throw ShopError.unresolvedMutation};d.checkoutPhase="unknown";try save(d)}
    func checkoutConfirmed(_ account:String,item:OfflineEnvelope,order:Order)throws {try AppleBuyerReceipt.validate(order,account:account);guard let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any],let original=body["CartRevision"] as? String,let consumed=order.cartConsumption,consumed.PreviousRevision==original,!consumed.Revision.isEmpty else{throw ShopError.security};var d=try load(account);d.items=[];d.revision=consumed.Revision;d.dirty=false;d.checkoutKey=nil;d.checkoutPhase=nil;try save(d)}
    func prepareReview(_ account:String,order:Order,original:InvoiceHandoffJournal.Prepared,existing:Bool)throws->Review {try AppleBuyerReceipt.validate(order,account:account);var d=try load(account);if let saved=d.review,saved.original.orderID==order.orderID{guard saved.key==original.record.key,saved.digest==original.record.digest else{throw ShopError.security};return saved};let r=Review(original:order,key:original.record.key,digest:original.record.digest,phase:existing || !(order.invoiceID ?? "").isEmpty ? "unknown":"prepared");d.review=r;try save(d);return r}
    func reviewDispatch(_ account:String,review:Review)throws {var d=try load(account);guard d.review?.key==review.key,d.review?.phase=="prepared",(review.original.invoiceID ?? "").isEmpty else{throw ShopError.unresolvedMutation};d.review?.phase="unknown";try save(d)}
    func reviewReceived(_ account:String,review:Review,response:[String:Any],url:URL)throws->Review {guard let raw=response["order"] as? [String:Any],let invoice=response["invoiceId"] as? String,let intent=response["intentId"] as? String else{throw ShopError.security};let order=try AppleBuyerReceipt.decode(raw,account:account);guard order.invoiceID==invoice,order.payIntentID==intent,!intent.isEmpty else{throw ShopError.security};var d=try load(account);guard var r=d.review,r.key==review.key,r.digest==review.digest else{throw ShopError.contextChanged};r.phase="invoice_ready";r.invoiceID=invoice;r.intentID=intent;r.url=url.absoluteString;d.review=r;try save(d);return r}
    func reviewOpened(_ account:String,review:Review)throws {var d=try load(account);guard d.review?.key==review.key,d.review?.phase=="invoice_ready" else{throw ShopError.contextChanged};d.review?.phase="wallet_opened";try save(d)}
    func observed(_ account:String,order:Order,journal:InvoiceHandoffJournal)throws {try AppleBuyerReceipt.validate(order,account:account);var d=try load(account);guard var r=d.review,r.original.orderID==order.orderID,r.digest == (try journal.digest(order)),r.invoiceID==nil || (r.invoiceID==order.invoiceID && r.intentID==order.payIntentID) else{throw ShopError.security};r.observed=order;d.review=r;try save(d)}
    static func wakeHint(_ url:URL)->Bool {url.absoluteString=="ynxshop://orders"}
}

// Uses the existing transition envelope; never supplies a rating or reason for the buyer.
enum BuyerOrderActionInput {
    static func allowed(_ status:String,_ action:String)->Bool {
        switch action {
        case "cancelled": return status=="payment_pending"
        case "delivered": return status=="shipped"
        case "reviewed": return status=="delivered"
        case "return_requested": return ["delivered","reviewed"].contains(status)
        case "refund_requested": return ["paid","return_requested","return_approved"].contains(status)
        case "disputed": return ["paid","shipped","delivered","reviewed","return_requested","return_approved","refund_requested"].contains(status)
        default: return false
        }
    }
    static func build(status:String,action:String,rating:Int,reason:String,detail:String)throws->[String:Any] {
        let reason=reason.trimmingCharacters(in:.whitespacesAndNewlines),detail=detail.trimmingCharacters(in:.whitespacesAndNewlines)
        let review=action=="reviewed",resolution=["return_requested","refund_requested","disputed"].contains(action)
        guard allowed(status,action),review ? (1...5).contains(rating):rating==0,reason.utf8.count<=1000,detail.utf8.count<=5000,!resolution || !reason.isEmpty,!(review && !reason.isEmpty),!(!review && !resolution && (!reason.isEmpty || !detail.isEmpty)) else{throw ShopError.invalidResponse}
        return ["Action":action,"Rating":rating,"Reason":reason,"Explanation":resolution ? detail:"","Body":review ? detail:""]
    }
}

enum BuyerTransitionRecovery {
    static func receipt(_ value:[String:Any],session:ShopSession,item:OfflineEnvelope)throws->Order {
        let parts=item.path.split(separator:"/");guard parts.count==3,parts[0]=="orders",parts[2]=="transition",let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any],let action=body["Action"] as? String,let key=body["IdempotencyKey"] as? String,value["Actor"] as? String==session.account,value["OrderID"] as? String==String(parts[1]),value["Action"] as? String==action,value["IdempotencyKey"] as? String==key,let raw=value["Order"] as? [String:Any] else{throw ShopError.security};let order=try AppleBuyerReceipt.decode(raw,account:session.account);guard order.orderID==String(parts[1]) else{throw ShopError.security};return order
    }
}
