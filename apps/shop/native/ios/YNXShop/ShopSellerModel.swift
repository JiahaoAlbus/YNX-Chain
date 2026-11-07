import Foundation
import SwiftUI

@MainActor final class ShopSellerModel:ObservableObject {
    @Published private(set) var stores:[SellerStore]=[]
    @Published private(set) var products:[SellerProduct]=[]
    @Published private(set) var orders:[SellerOrder]=[]
    @Published private(set) var members:[SellerMember]=[]
    @Published private(set) var revocations:[SellerRevocation]=[]
    @Published private(set) var storeRole=""
    var canManageMembers:Bool{signedIn && storeRole=="owner"}
    @Published private(set) var audit:[SellerAudit]=[]
    @Published private(set) var settlements:[SellerSettlement]=[]
    @Published private(set) var selectedStoreID=""
    @Published private(set) var busy=false
    @Published private(set) var signedIn=false
    @Published private(set) var state=""
    @Published private(set) var sectionUnavailable=Set<String>()
    @Published private(set) var pendingOriginalCount=0
    @Published private(set) var preparedOriginalCount=0
    @Published private(set) var pendingTargets=Set<String>()
    private var pendingJournalReadable=true
    func hasPending(_ target:String)->Bool{!pendingJournalReadable || pendingTargets.contains(target)}
    @Published var workspaceVisible=false
    @Published private(set) var awaitingWalletReturn=false
    let api:APIClient,journal:SellerMutationJournal
    private var session:ShopSession?,epoch=0,selection=0
    private var pendingReturn:URL?
    private var permissions:[String]=[]
    init(api:APIClient?=nil,journal:SellerMutationJournal?=nil){self.api=api ?? APIClient(authorityFactory:{try AppleNativeSessionBridge(profile:.seller)});self.journal=journal ?? SellerMutationJournal();self.api.onSessionChanged={[weak self] in self?.identityChanged()}}
    private func clearRows(){stores=[];products=[];orders=[];members=[];revocations=[];storeRole="";audit=[];settlements=[];permissions=[];selectedStoreID="";sectionUnavailable=[];pendingOriginalCount=0;preparedOriginalCount=0;pendingTargets=[];pendingJournalReadable=true}
    private func identityChanged(){let current=api.currentSession;guard current != session else{return};epoch+=1;selection+=1;busy=false;clearRows();session=current;signedIn=current != nil;if current != nil{awaitingWalletReturn=false;pendingReturn=nil;refresh()}}
    func can(_ permission:String)->Bool{signedIn && permissions.contains(permission)}
    func retainColdReturn(_ url:URL){guard url.scheme=="ynxshop",url.host=="wallet-auth",url.path=="/callback",url.absoluteString.utf8.count<=16384 else{return};if pendingReturn==nil{pendingReturn=url}}
    func resumeAuthorizationReturnByUser(_ url:URL){
        guard !busy,url.scheme=="ynxshop",url.host=="wallet-auth",url.path=="/callback",url.absoluteString.utf8.count<=16384,pendingReturn==nil || pendingReturn==url else{state="security_error";return}
        pendingReturn=url;awaitingWalletReturn=true;resumeOriginalReturn()
    }
    func receiveWalletReturn(_ url:URL){retainColdReturn(url);guard awaitingWalletReturn else{return};resumeOriginalReturn()}
    private func resumeOriginalReturn(){guard !busy,let url=pendingReturn else{return};busy=true;let at=epoch;Task{defer{if at==epoch{busy=false}};do{try await api.resumeNativeReturnByUser(url);identityChanged();state=signedIn ? "wallet_active":"unavailable"}catch{if at==epoch{state="unavailable"}}}}
    func connect(){guard !busy else{return};if pendingReturn != nil{awaitingWalletReturn=true;resumeOriginalReturn();return};busy=true;let at=epoch;awaitingWalletReturn=true;Task{defer{if at==epoch{busy=false}};do{try await api.connectNative();identityChanged();state=signedIn ? "wallet_active":"wallet_sign_in"}catch{if at==epoch{state="unavailable"}}}}
    func disconnect(){epoch+=1;selection+=1;busy=false;session=nil;signedIn=false;awaitingWalletReturn=false;pendingReturn=nil;clearRows();do{try api.disconnectNative();state=""}catch{state="security_error"}}
    func selectStore(_ id:String){guard stores.contains(where:{$0.ID==id}),!busy else{return};selectedStoreID=id;selection+=1;refresh()}
    private func rows<T:Decodable>(_ key:String,_ value:[String:Any],as type:T.Type)throws->[T]{guard value.keys.contains(key) else{throw ShopError.invalidResponse};if value[key] is NSNull{return []};guard let raw=value[key] as? [Any],raw.count<=10_000 else{throw ShopError.invalidResponse};return try JSONDecoder().decode([T].self,from:CanonicalJSON.data(raw))}
    private func validID(_ id:String)->Bool{NativeWire.matches(id,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")}
    private func updatePending(){guard let account=api.currentSession?.account else{pendingOriginalCount=0;preparedOriginalCount=0;pendingTargets=[];return};do{let pending=try journal.records(account).values.filter{$0.phase != "confirmed"};pendingOriginalCount=pending.count;preparedOriginalCount=pending.filter{$0.storeID==selectedStoreID && $0.phase=="prepared"}.count;pendingTargets=Set(pending.filter{$0.storeID==selectedStoreID}.map(\.target));pendingJournalReadable=true}catch{pendingJournalReadable=false;state="security_error"}}
    func refresh(){guard signedIn,!busy else{return};busy=true;let at=epoch,view=selection;Task{defer{if at==epoch{busy=false;updatePending()}};do{
        let check=try api.capture();let storeValue=try await api.raw("seller/stores",method:"GET",json:[:]);try check();guard at==epoch,view==selection else{return}
        let fresh: [SellerStore]=try rows("stores",storeValue,as:SellerStore.self)
        guard fresh.allSatisfy({validID($0.ID)}),Set(fresh.map(\.ID)).count==fresh.count,let access=storeValue["access"] as? [String:[String:Any]],fresh.allSatisfy({access[$0.ID] != nil}) else{throw ShopError.security}
        stores=fresh
        if !fresh.contains(where:{$0.ID==selectedStoreID}){selectedStoreID=fresh.first?.ID ?? ""}
        storeRole=access[selectedStoreID]?["role"] as? String ?? ""
        permissions=access[selectedStoreID]?["permissions"] as? [String] ?? []
        products=[];orders=[];members=[];revocations=[];audit=[];settlements=[];sectionUnavailable=[]
        guard !selectedStoreID.isEmpty else{state="no_fake_records";return}
        let store=selectedStoreID
        for section in ["products","orders","members","audit","settlements"] {
            do{
                let path:String
                switch section{case "products":path="seller/products";case "orders":path="orders";case "members":path="seller/stores/"+store+"/roles";case "audit":path="seller/audit";default:path="seller/settlements"}
                let value=try await api.raw(path,method:"GET",json:[:]);try check();guard at==epoch,view==selection,selectedStoreID==store else{return}
                switch section {
                case "products":let all:[SellerProduct]=try rows("products",value,as:SellerProduct.self);let items=all.filter{$0.StoreID==store};guard Set(items.map(\.ID)).count==items.count,items.allSatisfy({validID($0.ID) && $0.Revision>0 && !$0.Variants.isEmpty && Set($0.Variants.map(\.ID)).count==$0.Variants.count}) else{throw ShopError.security};products=items
                case "orders":let all:[SellerOrder]=try rows("orders",value,as:SellerOrder.self);let items=all.filter{$0.StoreID==store};guard Set(items.map(\.ID)).count==items.count,items.allSatisfy({validID($0.ID) && $0.TotalYNXT>=0}) else{throw ShopError.security};orders=items
                case "members":guard let roles=value["roles"] as? [String:String] else{throw ShopError.invalidResponse};members=roles.keys.sorted().map{SellerMember(Account:$0,Role:roles[$0]!)};revocations=try rows("revocations",value,as:SellerRevocation.self)
                case "audit":audit=try rows("events",value,as:SellerAudit.self)
                default:settlements=try rows("settlements",value,as:SellerSettlement.self)
                }
            }catch{try check();guard at==epoch,view==selection else{return};sectionUnavailable.insert(section)}
        }
        state=""
    }catch{guard at==epoch else{return};clearRows();state="unavailable"}}}
    private func integer(_ value:String,positive:Bool=false)throws->Int64{guard let number=Int64(value),number>=0,(!positive || number>0),String(number)==value else{throw ShopError.security};return number}
    private func bounded(_ value:String,_ limit:Int,required:Bool=true)throws->String{guard value.utf8.count<=limit,(!required || !value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty) else{throw ShopError.security};return value}
    private func command(_ command:SellerCommand,store:String)throws->(String,String,String,[String:Any]) {
        switch command {
        case .publish(let draft):
            guard validID(draft.productID),let product=products.first(where:{$0.ID==draft.productID}),product.StoreID==store,try integer(draft.expectedRevision,positive:true)==product.Revision,(1...50).contains(draft.variants.count) else{throw ShopError.security}
            var variants:[[String:Any]]=[];var ids=Set<String>(),skus=Set<String>()
            for v in draft.variants {guard v.ID.isEmpty || validID(v.ID),v.ID.isEmpty || ids.insert(v.ID).inserted,skus.insert(v.SKU).inserted else{throw ShopError.security};_ = try integer(v.PriceYNXT,positive:true);_ = try integer(v.Inventory);variants.append(["ID":v.ID,"Name":try bounded(v.Name,120),"SKU":try bounded(v.SKU,80),"PriceYNXT":v.PriceYNXT,"Inventory":v.Inventory])}
            let media=(product.Media ?? []).map{["URL":$0.url,"AltText":$0.altText ?? "","Kind":$0.kind ?? "image"]}
            return ("listing",draft.productID,"/seller/products/"+draft.productID+"/native-listing",["StoreID":store,"ExpectedRevision":draft.expectedRevision,"Title":try bounded(draft.title,160),"Description":try bounded(draft.description,5000,required:false),"Category":try bounded(draft.category,80,required:false),"Media":media,"Variants":variants])
        case .inventory(let productID,let variantID,let expected,let inventory):
            guard let product=products.first(where:{$0.ID==productID}),product.StoreID==store,product.Variants.contains(where:{$0.ID==variantID}),try integer(expected,positive:true)==product.Revision else{throw ShopError.security};_ = try integer(inventory)
            return ("inventory",productID,"/seller/inventory/batch",["StoreID":store,"Items":[["ProductID":productID,"VariantID":variantID,"ExpectedRevision":expected,"Inventory":inventory]]])
        case .ship(let id,let carrier,let tracking):
            guard let order=orders.first(where:{$0.ID==id}),order.StoreID==store,order.Status=="paid" else{throw ShopError.security}
            return ("ship",id,"/orders/"+id+"/transition",["Action":"shipped","Carrier":try bounded(carrier,120),"TrackingNumber":try bounded(tracking,200),"Explanation":""])
        case .returnDecision(let id,let returnID,let approve,let explanation):
            guard let order=orders.first(where:{$0.ID==id}),order.StoreID==store,order.Status=="return_requested",order.originalReturnID==returnID,validID(returnID) else{throw ShopError.security}
            return ("return",id,"/orders/"+id+"/transition",["Action":approve ? "return_approved":"return_rejected","OriginalReturnID":returnID,"Explanation":try bounded(explanation,5000,required:!approve)])
        case .revoke(let account,let reason):
            guard canManageMembers,reason.utf8.count>=8,!reason.contains("\n"),!reason.contains("\r"),validID(account),members.contains(where:{$0.Account==account}) else{throw ShopError.security}
            return ("revoke",account,"/seller/stores/"+store+"/roles/"+account+"/native-revoke",["Reason":try bounded(reason,240)])
        }
    }
    private func sendPrepared(_ original:SellerMutationJournal.Record,view:Int,check:@escaping ()throws->Void)async throws {
        guard original.phase=="prepared" else{throw ShopError.unresolvedMutation}
        let response=try await api.raw(String(original.path.dropFirst()),json:journal.input(original),beforeDispatch:{try check();guard self.selection==view,self.selectedStoreID==original.storeID else{throw ShopError.contextChanged};try self.journal.dispatch(original)})
        try check();try validate(response,original:original,recovery:false);try journal.confirm(original,result:response)
    }
    func perform(_ command:SellerCommand){guard signedIn,!busy,!selectedStoreID.isEmpty else{return};do{
        let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut};let store=selectedStoreID,view=selection,at=epoch
        let(kind,target,path,input)=try self.command(command,store:store)
        let original=try journal.prepare(account:account,storeID:store,target:target,kind:kind,path:path,input:input)
        guard original.phase=="prepared" else{throw ShopError.unresolvedMutation}
        busy=true;Task{var reload=false;defer{if at==epoch{busy=false;updatePending();if reload{refresh()}}};do{
            try await sendPrepared(original,view:view,check:check)
            guard at==epoch,view==selection else{return};state="seller_change_confirmed";reload=true
        }catch{guard at==epoch else{return};state="seller_original_unconfirmed"}};updatePending()
    }catch{state="seller_original_unconfirmed";updatePending()}}
    func retryPreparedOriginals(){guard signedIn,!busy,!selectedStoreID.isEmpty else{return};busy=true;let at=epoch,view=selection,store=selectedStoreID;Task{var reload=false;defer{if at==epoch{busy=false;updatePending();if reload{refresh()}}};do{
        let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
        let originals=try journal.records(account).values.filter{$0.phase=="prepared" && $0.storeID==store}.sorted{$0.key<$1.key}
        var failed=false
        for original in originals {do{try await sendPrepared(original,view:view,check:check);reload=true}catch{try check();guard at==epoch,view==selection else{return};failed=true}}
        guard at==epoch else{return};state=failed ? "seller_original_unconfirmed":"seller_change_confirmed"
    }catch{if at==epoch{state="seller_original_unconfirmed"}}}}
    func recoverOriginals(){guard signedIn,!busy else{return};busy=true;let at=epoch;Task{var reload=false;defer{if at==epoch{busy=false;updatePending();if reload{refresh()}}};do{
        let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
        let originals=try journal.records(account).values.filter{$0.phase=="unknown"}.sorted{$0.key<$1.key}
        var failed=false
        for original in originals {do{
            let response=try await api.raw("seller/mutations/lookup",json:["Method":original.method,"Path":original.path,"OriginalBody":String(data:original.body,encoding:.utf8)!]);try check()
            guard response["Actor"] as? String==account,response["Method"] as? String==original.method,response["Path"] as? String==original.path,response["IdempotencyKey"] as? String==original.key,let result=response["Result"] as? [String:Any] else{throw ShopError.security}
            try validate(result,original:original,recovery:true);try journal.confirm(original,result:result);reload=true
        }catch{try check();guard at==epoch else{return};failed=true}}
        guard at==epoch else{return};state=failed ? "seller_original_unconfirmed":originals.isEmpty ? (preparedOriginalCount>0 ? "seller_original_prepared":""):"seller_change_confirmed"
    }catch{if at==epoch{state="seller_original_unconfirmed"}}}}
    private func validate(_ response:[String:Any],original:SellerMutationJournal.Record,recovery:Bool)throws {
        let input=try journal.input(original)
        switch original.kind {
        case "listing":
            guard response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let p=response["Product"] as? [String:Any],p["ID"] as? String==original.target,p["StoreID"] as? String==original.storeID,p["Published"] as? Bool==true,let revision=p["Revision"] as? String,try integer(revision,positive:true)>integer(input["ExpectedRevision"] as? String ?? "") else{throw ShopError.security}
            guard let published=response["Product"] as? [String:Any],let title=published["Title"] as? String,!title.isEmpty,title.utf8.count<=160,
                  let variants=published["Variants"] as? [[String:Any]],!variants.isEmpty,variants.count<=50 else{throw ShopError.security}
            var ids=Set<String>(),skus=Set<String>()
            for row in variants {
                guard let id=row["ID"] as? String,validID(id),ids.insert(id).inserted,let name=row["Name"] as? String,!name.isEmpty,
                      let sku=row["SKU"] as? String,!sku.isEmpty,skus.insert(sku).inserted,
                      let price=row["PriceYNXT"] as? String,let stock=row["Inventory"] as? String,let reserved=row["Reserved"] as? String,
                      try integer(price,positive:true)>0,try integer(stock)>=integer(reserved) else{throw ShopError.security}
            }
        case "inventory":
            guard response["StoreID"] as? String==original.storeID,response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let hash=response["RequestHash"] as? String,NativeWire.matches(hash,"^[a-f0-9]{64}$"),let rows=response["Products"] as? [[String:Any]],rows.count==1,rows[0]["ID"] as? String==original.target,rows[0]["StoreID"] as? String==original.storeID else{throw ShopError.security}
            guard let originalItems=input["Items"] as? [[String:Any]],originalItems.count==1,
                  let outputProducts=response["Products"] as? [[String:Any]],
                  let revision=outputProducts[0]["Revision"] as? String,try integer(revision,positive:true)>integer(originalItems[0]["ExpectedRevision"] as? String ?? ""),
                  let variants=outputProducts[0]["Variants"] as? [[String:Any]],variants.count==1,
                  variants[0]["ID"] as? String==originalItems[0]["VariantID"] as? String,
                  let inventory=variants[0]["Inventory"] as? String,let reserved=variants[0]["Reserved"] as? String,
                  try integer(inventory)>=integer(reserved) else{throw ShopError.security}
        case "ship","return":
            let order=try JSONDecoder().decode(SellerOrder.self,from:CanonicalJSON.data(response));guard order.ID==original.target,order.StoreID==original.storeID else{throw ShopError.security}
            if original.kind=="ship"{guard let shipment=order.Shipment,shipment.Carrier==input["Carrier"] as? String,shipment.TrackingNumber==input["TrackingNumber"] as? String,["shipped","delivered","reviewed","return_requested","return_approved","return_rejected","refund_requested","refund_approved","refund_rejected","refunded","disputed"].contains(order.Status) else{throw ShopError.security}}
            else{guard let id=input["OriginalReturnID"] as? String,let action=input["Action"] as? String,let start=order.Timeline.firstIndex(where:{$0.ID==id && $0.Status=="return_requested"}) else{throw ShopError.security};let rest=Array(order.Timeline.dropFirst(start+1));let events=Array(rest.prefix(while:{$0.Status != "return_requested"})).filter{["return_approved","return_rejected"].contains($0.Status)};guard events.count==1,events[0].Status==action else{throw ShopError.security}}
        case "revoke":
            guard response["RoleRevoked"] as? Bool==true,response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let data=response["Revocation"] as? [String:Any] else{throw ShopError.security}
            let r=try JSONDecoder().decode(SellerRevocation.self,from:CanonicalJSON.data(data))
            guard r.StoreID==original.storeID,r.Account==original.target,r.Reason==(input["Reason"] as? String)?.trimmingCharacters(in:.whitespacesAndNewlines),validID(r.ID),["pending","confirmed","unavailable","rejected"].contains(r.SessionStatus),response["SessionInvalidation"] as? String==r.SessionStatus else{throw ShopError.security}
        default:throw ShopError.security
        }
    }
}
