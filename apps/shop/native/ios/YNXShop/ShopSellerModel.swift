import Foundation
import SwiftUI

@MainActor final class ShopSellerModel:ObservableObject {
    @Published private(set) var stores:[SellerStore]=[]
    @Published private(set) var products:[SellerProduct]=[]
    @Published private(set) var orders:[SellerOrder]=[]
    @Published private(set) var members:[SellerMember]=[]
    @Published private(set) var revocations:[SellerRevocation]=[]
    @Published private(set) var receivedInvitations:[SellerInvitation]=[]
    @Published var invitationInboxVisible=false
    @Published private(set) var invitations:[SellerInvitation]=[]
    @Published private(set) var localDrafts:[String:SellerListingDraft]=[:]
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
    @Published private(set) var pendingInvitations=Set<String>()
    private var pendingJournalReadable=true
    func hasPending(_ target:String)->Bool{!pendingJournalReadable || pendingTargets.contains(target)}
    @Published var workspaceVisible=false
    @Published private(set) var awaitingWalletReturn=false
    let api:APIClient,journal:SellerMutationJournal
    let localDraftStore:SellerLocalDraftStore
    private var session:ShopSession?,epoch=0,selection=0
    private var pendingReturn:URL?
    private var permissions:[String]=[]
    init(api:APIClient?=nil,journal:SellerMutationJournal?=nil,localDraftStore:SellerLocalDraftStore?=nil){self.localDraftStore=localDraftStore ?? SellerLocalDraftStore();self.api=api ?? APIClient(authorityFactory:{try AppleNativeSessionBridge(profile:.seller)});self.journal=journal ?? SellerMutationJournal();self.api.onSessionChanged={[weak self] in self?.identityChanged()}}
    private func clearRows(){stores=[];products=[];orders=[];members=[];revocations=[];invitations=[];receivedInvitations=[];localDrafts=[:];storeRole="";audit=[];settlements=[];permissions=[];selectedStoreID="";sectionUnavailable=[];pendingOriginalCount=0;preparedOriginalCount=0;pendingTargets=[];pendingInvitations=[];pendingJournalReadable=true}
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
    private func updatePending(){guard let account=api.currentSession?.account else{pendingOriginalCount=0;preparedOriginalCount=0;pendingTargets=[];pendingInvitations=[];return};do{let pending=try journal.records(account).values.filter{$0.phase != "confirmed"};pendingOriginalCount=pending.count;pendingInvitations=Set(pending.filter{$0.kind=="accept-invitation" || $0.kind=="cancel-invitation"}.map{$0.storeID+"\n"+$0.target});preparedOriginalCount=pending.filter{($0.storeID==selectedStoreID || $0.kind=="create-store" || $0.kind=="accept-invitation") && $0.phase=="prepared"}.count;pendingTargets=Set(pending.filter{$0.storeID==selectedStoreID || $0.kind=="create-store"}.map(\.target));pendingJournalReadable=true}catch{pendingJournalReadable=false;state="security_error"}}
    func loadInvitationInbox(){guard signedIn,!busy else{return};invitationInboxVisible=true;busy=true;let at=epoch;Task{defer{if at==epoch{busy=false;updatePending()}};do{
        let check=try api.capture();let value=try await api.raw("seller/invitations",method:"GET",json:[:]);try check();guard at==epoch,let account=api.currentSession?.account else{return}
        let rows:[SellerInvitation]=try self.rows("invitations",value,as:SellerInvitation.self)
        guard Set(rows.map(\.ID)).count==rows.count,rows.allSatisfy({validID($0.ID) && validID($0.StoreID) && $0.Account==account}) else{throw ShopError.security}
        receivedInvitations=rows;state=""
    }catch{if at==epoch{receivedInvitations=[];state="unavailable"}}}}
    func invitationPending(_ row:SellerInvitation)->Bool{!signedIn || !pendingJournalReadable || pendingInvitations.contains(row.StoreID+"\n"+row.ID)}
    func refresh(){guard signedIn,!busy else{return};busy=true;let at=epoch,view=selection;Task{defer{if at==epoch{busy=false;updatePending()}};do{
        let check=try api.capture();let storeValue=try await api.raw("seller/stores",method:"GET",json:[:]);try check();guard at==epoch,view==selection else{return}
        let fresh: [SellerStore]=try rows("stores",storeValue,as:SellerStore.self)
        guard fresh.allSatisfy({validID($0.ID)}),Set(fresh.map(\.ID)).count==fresh.count,let access=storeValue["access"] as? [String:[String:Any]],fresh.allSatisfy({access[$0.ID] != nil}) else{throw ShopError.security}
        stores=fresh
        if !fresh.contains(where:{$0.ID==selectedStoreID}){selectedStoreID=fresh.first?.ID ?? ""}
        storeRole=access[selectedStoreID]?["role"] as? String ?? ""
        permissions=access[selectedStoreID]?["permissions"] as? [String] ?? []
        products=[];orders=[];members=[];revocations=[];invitations=[];audit=[];settlements=[];sectionUnavailable=[]
        guard !selectedStoreID.isEmpty else{state="no_fake_records";return}
        let store=selectedStoreID
        for section in ["products","orders","members","audit","settlements"] {
            do{
                let path:String
                switch section{case "products":path="seller/products";case "orders":path="seller/orders";case "members":path="seller/stores/"+store+"/roles";case "audit":path="seller/audit";default:path="seller/settlements"}
                let value=try await api.raw(path,method:"GET",json:[:]);try check();guard at==epoch,view==selection,selectedStoreID==store else{return}
                switch section {
                case "products":let all:[SellerProduct]=try rows("products",value,as:SellerProduct.self);let items=all.filter{$0.StoreID==store};guard Set(items.map(\.ID)).count==items.count,items.allSatisfy({validID($0.ID) && $0.Revision>0 && !$0.Variants.isEmpty && Set($0.Variants.map(\.ID)).count==$0.Variants.count}) else{throw ShopError.security};products=items
                case "orders":let all:[SellerOrder]=try rows("orders",value,as:SellerOrder.self);let items=all.filter{$0.StoreID==store};guard Set(items.map(\.ID)).count==items.count,items.allSatisfy({validID($0.ID) && $0.TotalYNXT>=0}) else{throw ShopError.security};orders=items
                case "members":guard let roles=value["roles"] as? [String:String] else{throw ShopError.invalidResponse};members=roles.keys.sorted().map{SellerMember(Account:$0,Role:roles[$0]!)};revocations=try rows("revocations",value,as:SellerRevocation.self);invitations=try rows("invitations",value,as:SellerInvitation.self)
                case "audit":audit=try rows("events",value,as:SellerAudit.self)
                default:settlements=try rows("settlements",value,as:SellerSettlement.self)
                }
            }catch{try check();guard at==epoch,view==selection else{return};sectionUnavailable.insert(section)}
        }
        if let account=api.currentSession?.account {do{localDrafts=try localDraftStore.load(account:account,storeID:store)}catch{localDrafts=[:];state="seller_local_draft_failed";return}}
        state=""
    }catch{guard at==epoch else{return};clearRows();state="unavailable"}}}
    func draft(for product:SellerProduct)->SellerListingDraft{localDrafts[product.ID] ?? SellerListingDraft(product)}
    func saveLocalDraft(_ draft:SellerListingDraft){do{
        let check=try api.capture();guard let account=api.currentSession?.account,can("catalog.write"),!hasPending(draft.productID),products.contains(where:{$0.ID==draft.productID && $0.StoreID==selectedStoreID}),!draft.productID.isEmpty,(1...50).contains(draft.variants.count) else{throw ShopError.security}
        _ = try integer(draft.expectedRevision,positive:true);_ = try bounded(draft.title,160);_ = try bounded(draft.description,5000,required:false);_ = try bounded(draft.category,80,required:false)
        var skus=Set<String>();for v in draft.variants{guard skus.insert(v.SKU).inserted,v.ID.isEmpty || validID(v.ID) else{throw ShopError.security};_ = try bounded(v.Name,120);_ = try bounded(v.SKU,80);_ = try integer(v.PriceYNXT,positive:true);_ = try integer(v.Inventory);if let quote=v.nativePrice{_ = try nativeQuote(quote)}}
        try check();try localDraftStore.save(account:account,storeID:selectedStoreID,draft:draft);try check();localDrafts[draft.productID]=draft;state="seller_local_draft_saved"
    }catch{state="seller_local_draft_failed"}}
    private func integer(_ value:String,positive:Bool=false)throws->Int64{guard let number=Int64(value),number>=0,(!positive || number>0),String(number)==value else{throw ShopError.security};return number}
    private func nativeAtoms(_ value:String,positive:Bool=false)throws->String{guard let n=UInt64(value),String(n)==value,!positive || n>0 else{throw ShopError.security};return value}
    private func nativeNetwork(_ genesis:String,_ chain:String,_ asset:String,_ unit:String)throws{guard genesis.utf8.count==64,NativeWire.matches(genesis,"^[a-f0-9]{64}$"),asset=="YNXT",unit=="1" else{throw ShopError.security};_ = try nativeAtoms(chain,positive:true)}
    private func nativeQuote(_ value:SellerNativePriceDraft)throws->[String:String]{try nativeNetwork(value.genesis,value.nativeChainID,value.assetID,value.unitVersion);return ["Genesis":value.genesis,"NativeChainID":value.nativeChainID,"AssetID":value.assetID,"UnitVersion":value.unitVersion,"AmountAtoms":try nativeAtoms(value.amountAtoms,positive:true)]}
    private func bounded(_ value:String,_ limit:Int,required:Bool=true)throws->String{guard value.utf8.count<=limit,(!required || !value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty) else{throw ShopError.security};return value}
    private func command(_ command:SellerCommand,store:String)throws->(String,String,String,[String:Any]) {
        switch command {
        case .invitationDecision(let row,let accept,let reason):
            guard validID(row.ID),row.StoreID==store,row.Status=="pending",!invitationPending(row),!row.UpdatedAt.isEmpty else{throw ShopError.security}
            if accept {guard receivedInvitations.contains(where:{$0.ID==row.ID && $0.UpdatedAt==row.UpdatedAt && $0.Role==row.Role && $0.StoreID==row.StoreID && $0.Account==row.Account}),row.Account==api.currentSession?.account,reason.isEmpty else{throw ShopError.security}}
            else {guard canManageMembers,invitations.contains(where:{$0.ID==row.ID && $0.UpdatedAt==row.UpdatedAt && $0.Role==row.Role && $0.Account==row.Account}),reason.utf8.count>=8,!reason.contains("\n"),!reason.contains("\r") else{throw ShopError.security};_ = try bounded(reason,240)}
            return (accept ? "accept-invitation":"cancel-invitation",row.ID,"/seller/stores/"+store+"/invitations/"+row.ID+(accept ? "/native-accept":"/native-cancel"),["ExpectedUpdatedAt":row.UpdatedAt,"ExpectedRole":row.Role,"ExpectedAccount":row.Account,"Reason":reason])
        case .updateStore(let snapshot,let name,let description,let policy,let trustURL,let settlementAccount,let nativeCharges):
            guard canManageMembers,snapshot.ID==store,let current=stores.first(where:{$0.ID==store}),snapshot.CreatedAt != nil,snapshot.UpdatedAt != nil else{throw ShopError.security}
            let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys]
            guard try encoder.encode(current)==encoder.encode(snapshot) else{throw ShopError.contextChanged}
            if !trustURL.isEmpty {guard let u=URLComponents(string:trustURL),u.scheme=="https",u.host?.isEmpty==false,u.user==nil,u.password==nil else{throw ShopError.security}}
            guard settlementAccount.isEmpty || NativeWire.matches(settlementAccount,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else{throw ShopError.security}
            let expected=try JSONSerialization.jsonObject(with:encoder.encode(snapshot))
            var update:[String:Any]=["Name":try bounded(name,100),"Description":try bounded(description,3000,required:false),"Policy":try bounded(policy,5000),"TrustURL":try bounded(trustURL,500,required:false),"SettlementAccount":settlementAccount,"IdempotencyKey":""]
            if let nativeCharges{try nativeNetwork(nativeCharges.Genesis,nativeCharges.NativeChainID,nativeCharges.AssetID,nativeCharges.UnitVersion);_ = try nativeAtoms(nativeCharges.ShippingAtoms);_ = try nativeAtoms(nativeCharges.TaxAtoms);update["NativeCharges"]=try JSONSerialization.jsonObject(with:JSONEncoder().encode(nativeCharges))}else if snapshot.NativeCharges != nil{update["ClearNativeCharges"]=true}
            return ("update-store",store,"/seller/stores/"+store+"/native-profile",["Expected":expected,"Update":update])
        case .createStore(let name,let description,let policy,let trustURL,let settlementAccount):
            guard !hasPending("create-store") else{throw ShopError.unresolvedMutation}
            if !trustURL.isEmpty {guard let u=URLComponents(string:trustURL),u.scheme=="https",u.host?.isEmpty==false,u.user==nil,u.password==nil else{throw ShopError.security}}
            guard settlementAccount.isEmpty || NativeWire.matches(settlementAccount,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else{throw ShopError.security}
            return ("create-store","create-store","/seller/stores",["Name":try bounded(name,100),"Description":try bounded(description,3000,required:false),"Policy":try bounded(policy,5000),"TrustURL":try bounded(trustURL,500,required:false),"SettlementAccount":settlementAccount])
        case .createProduct(let draft):
            guard draft.productID.isEmpty,draft.expectedRevision=="0",can("catalog.write"),(1...50).contains(draft.variants.count) else{throw ShopError.security}
            var variants:[[String:Any]]=[];var skus=Set<String>()
            for v in draft.variants {guard v.ID.isEmpty,skus.insert(v.SKU).inserted else{throw ShopError.security};var row:[String:Any]=["ID":"","Name":try bounded(v.Name,120),"SKU":try bounded(v.SKU,80),"PriceYNXT":try integer(v.PriceYNXT,positive:true),"Inventory":try integer(v.Inventory),"Reserved":0];if let quote=v.nativePrice{row["NativePrice"]=try nativeQuote(quote)};variants.append(row)}
            return ("create-product","create-product","/seller/products",["StoreID":store,"Title":try bounded(draft.title,160),"Description":try bounded(draft.description,5000,required:false),"Category":try bounded(draft.category,80,required:false),"Media":[],"Variants":variants])
        case .activateStore(let updated,let policy,let settlement):
            guard canManageMembers,let original=stores.first(where:{$0.ID==store}),original.UpdatedAt==updated,original.Policy==policy,original.SettlementAccount==settlement,!policy.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{throw ShopError.security}
            return ("activate-store",store,"/seller/stores/"+store+"/native-activate",["ExpectedUpdatedAt":updated,"ExpectedPolicy":policy,"ExpectedSettlementAccount":settlement])
        case .invite(let account,let role,let ttl):
            guard canManageMembers,NativeWire.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$"),["admin","catalog","inventory","fulfillment","finance","support","viewer"].contains(role),(900...604800).contains(try integer(ttl)) else{throw ShopError.security}
            return ("invite",account,"/seller/stores/"+store+"/native-invitations",["Account":account,"Role":role,"TTLSeconds":ttl])
        case .publish(let draft):
            guard validID(draft.productID),let product=products.first(where:{$0.ID==draft.productID}),product.StoreID==store,try integer(draft.expectedRevision,positive:true)==product.Revision,(1...50).contains(draft.variants.count) else{throw ShopError.security}
            var variants:[[String:Any]]=[];var ids=Set<String>(),skus=Set<String>()
            for v in draft.variants {guard v.ID.isEmpty || validID(v.ID),v.ID.isEmpty || ids.insert(v.ID).inserted,skus.insert(v.SKU).inserted else{throw ShopError.security};_ = try integer(v.PriceYNXT,positive:true);_ = try integer(v.Inventory);var row:[String:Any]=["ID":v.ID,"Name":try bounded(v.Name,120),"SKU":try bounded(v.SKU,80),"PriceYNXT":v.PriceYNXT,"Inventory":v.Inventory];if let quote=v.nativePrice{row["NativePrice"]=try nativeQuote(quote)}else if product.Variants.contains(where:{$0.ID==v.ID && $0.NativePrice != nil}){row["ClearNativePrice"]=true};variants.append(row)}
            let media=(product.Media ?? []).map{["URL":$0.url,"AltText":$0.altText ?? "","Kind":$0.kind ?? "image"]}
            return ("listing",draft.productID,"/seller/products/"+draft.productID+"/native-listing",["StoreID":store,"ExpectedRevision":draft.expectedRevision,"Title":try bounded(draft.title,160),"Description":try bounded(draft.description,5000,required:false),"Category":try bounded(draft.category,80,required:false),"Media":media,"Variants":variants])
        case .inventory(let productID,let variantID,let expected,let inventory):
            guard let product=products.first(where:{$0.ID==productID}),product.StoreID==store,product.Variants.contains(where:{$0.ID==variantID}),try integer(expected,positive:true)==product.Revision else{throw ShopError.security};_ = try integer(inventory)
            return ("inventory",productID,"/seller/inventory/batch",["StoreID":store,"Items":[["ProductID":productID,"VariantID":variantID,"ExpectedRevision":expected,"Inventory":inventory]]])
        case .ship(let id,let carrier,let tracking):
            guard let order=orders.first(where:{$0.ID==id}),order.StoreID==store,order.Status=="paid",!order.PayIntentID.hasPrefix("npi_") || ["native_paid","native_partial_refund"].contains(order.paymentDisplayState) else{throw ShopError.security}
            return ("ship",id,"/seller/orders/"+id+"/transition",["Action":"shipped","Carrier":try bounded(carrier,120),"TrackingNumber":try bounded(tracking,200),"Explanation":""])
        case .returnDecision(let id,let returnID,let approve,let explanation):
            guard let order=orders.first(where:{$0.ID==id}),order.StoreID==store,order.Status=="return_requested",order.originalReturnID==returnID,validID(returnID) else{throw ShopError.security}
            return ("return",id,"/seller/orders/"+id+"/transition",["Action":approve ? "return_approved":"return_rejected","OriginalReturnID":returnID,"Explanation":try bounded(explanation,5000,required:!approve)])
        case .revoke(let account,let reason):
            guard canManageMembers,reason.utf8.count>=8,!reason.contains("\n"),!reason.contains("\r"),validID(account),members.contains(where:{$0.Account==account}) else{throw ShopError.security}
            return ("revoke",account,"/seller/stores/"+store+"/roles/"+account+"/native-revoke",["Reason":try bounded(reason,240)])
        }
    }
    private func sendPrepared(_ original:SellerMutationJournal.Record,view:Int,check:@escaping ()throws->Void)async throws {
        guard original.phase=="prepared" else{throw ShopError.unresolvedMutation}
        let response=try await api.raw(String(original.path.dropFirst()),json:journal.input(original),beforeDispatch:{try check();guard self.selection==view,(original.kind=="create-store" || original.kind=="accept-invitation" || self.selectedStoreID==original.storeID) else{throw ShopError.contextChanged};try self.journal.dispatch(original)})
        try check();try validate(response,original:original,recovery:false);try journal.confirm(original,result:response);if original.kind=="accept-invitation"{receivedInvitations.removeAll{$0.ID==original.target}}
    }
    func perform(_ command:SellerCommand){guard signedIn,!busy else{return};do{
        let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut};let view=selection,at=epoch
        let creatingStore:Bool;if case .createStore = command{creatingStore=true}else{creatingStore=false}
        let store:String;if case .invitationDecision(let row,let accept,_) = command,accept{store=row.StoreID}else{store=creatingStore ? "":selectedStoreID}
        guard creatingStore || !store.isEmpty else{throw ShopError.security}
        let(kind,target,path,input)=try self.command(command,store:store)
        let original=try journal.prepare(account:account,storeID:store,target:target,kind:kind,path:path,input:input)
        guard original.phase=="prepared" else{throw ShopError.unresolvedMutation}
        busy=true;Task{var reload=false;defer{if at==epoch{busy=false;updatePending();if reload{refresh()}}};do{
            try await sendPrepared(original,view:view,check:check)
            guard at==epoch,view==selection else{return};state="seller_change_confirmed";reload=true
        }catch{guard at==epoch else{return};state="seller_original_unconfirmed"}};updatePending()
    }catch{state="seller_original_unconfirmed";updatePending()}}
    func retryPreparedOriginals(){guard signedIn,!busy else{return};busy=true;let at=epoch,view=selection,store=selectedStoreID;Task{var reload=false;defer{if at==epoch{busy=false;updatePending();if reload{refresh()}}};do{
        let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
        let originals=try journal.records(account).values.filter{$0.phase=="prepared" && ($0.storeID==store || $0.kind=="create-store" || $0.kind=="accept-invitation")}.sorted{$0.key<$1.key}
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
        case "accept-invitation","cancel-invitation":
            guard response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let raw=response["Invitation"] as? [String:Any] else{throw ShopError.security}
            let row=try JSONDecoder().decode(SellerInvitation.self,from:CanonicalJSON.data(raw))
            guard row.ID==original.target,row.StoreID==original.storeID,row.Account==input["ExpectedAccount"] as? String,row.Role==input["ExpectedRole"] as? String,row.Status==(original.kind=="accept-invitation" ? "accepted":"cancelled") else{throw ShopError.security}
            if original.kind=="accept-invitation"{guard row.Account==original.account,!row.AcceptedAt.isEmpty,!row.AcceptedAt.hasPrefix("0001-") else{throw ShopError.security}}
            else{guard row.Reason==(input["Reason"] as? String)?.trimmingCharacters(in:.whitespacesAndNewlines),!row.CancelledAt.isEmpty,!row.CancelledAt.hasPrefix("0001-") else{throw ShopError.security}}
        case "update-store":
            guard response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let raw=response["Store"] as? [String:Any],let applied=response["Applied"] as? [String:Any],let expected=input["Expected"] as? [String:Any],let update=input["Update"] as? [String:Any],try CanonicalJSON.data(applied)==CanonicalJSON.data(update) else{throw ShopError.security}
            let store=try JSONDecoder().decode(SellerStore.self,from:CanonicalJSON.data(raw));guard store.ID==original.storeID,store.Owner==expected["Owner"] as? String else{throw ShopError.security}
            if !recovery {guard store.Name==update["Name"] as? String,store.Description==update["Description"] as? String,store.Policy==update["Policy"] as? String,store.TrustURL==update["TrustURL"] as? String,store.SettlementAccount==update["SettlementAccount"] as? String else{throw ShopError.security}}
            if !recovery {
                if let charges=update["NativeCharges"] as? [String:Any]{guard let value=raw["NativeCharges"] as? [String:Any],try CanonicalJSON.data(value)==CanonicalJSON.data(charges),let ref=store.NativeChargesApprovalRef,ref.hasPrefix("shop.charges/"+store.ID+"/") else{throw ShopError.security}}
                if update["ClearNativeCharges"] as? Bool==true{guard store.NativeCharges==nil else{throw ShopError.security}}
            }
        case "create-store":
            let store=try JSONDecoder().decode(SellerStore.self,from:CanonicalJSON.data(response))
            guard validID(store.ID),!store.Owner.isEmpty,store.Name==(input["Name"] as? String)?.trimmingCharacters(in:.whitespacesAndNewlines),store.Policy==input["Policy"] as? String,store.SettlementAccount==input["SettlementAccount"] as? String,(recovery || store.Status=="onboarding") else{throw ShopError.security}
        case "create-product":
            let product=try JSONDecoder().decode(SellerProduct.self,from:CanonicalJSON.data(response))
            guard validID(product.ID),product.StoreID==original.storeID,product.Title==(input["Title"] as? String)?.trimmingCharacters(in:.whitespacesAndNewlines),product.Revision>=1,!product.Variants.isEmpty,(recovery || !product.Published) else{throw ShopError.security}
        case "activate-store":
            guard response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let raw=response["Store"] as? [String:Any] else{throw ShopError.security}
            let store=try JSONDecoder().decode(SellerStore.self,from:CanonicalJSON.data(raw));guard store.ID==original.storeID,(recovery || store.Status=="active") else{throw ShopError.security}
        case "invite":
            guard response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let raw=response["Invitation"] as? [String:Any] else{throw ShopError.security}
            let invitation=try JSONDecoder().decode(SellerInvitation.self,from:CanonicalJSON.data(raw));guard validID(invitation.ID),invitation.StoreID==original.storeID,invitation.Account==original.target,invitation.Role==input["Role"] as? String,["pending","accepted","cancelled","expired"].contains(invitation.Status),(recovery || invitation.Status=="pending") else{throw ShopError.security}
        case "listing":
            guard response["OriginalApplied"] as? Bool==true,(!recovery || response["QueryOnly"] as? Bool==true),let p=response["Product"] as? [String:Any],p["ID"] as? String==original.target,p["StoreID"] as? String==original.storeID,p["Published"] as? Bool==true,let revision=p["Revision"] as? String,try integer(revision,positive:true)>integer(input["ExpectedRevision"] as? String ?? "") else{throw ShopError.security}
            guard let published=response["Product"] as? [String:Any],let title=published["Title"] as? String,!title.isEmpty,title.utf8.count<=160,
                  let variants=published["Variants"] as? [[String:Any]],!variants.isEmpty,variants.count<=50 else{throw ShopError.security}
            let requested=input["Variants"] as? [[String:Any]] ?? []
            var ids=Set<String>(),skus=Set<String>()
            for row in variants {
                guard let id=row["ID"] as? String,validID(id),ids.insert(id).inserted,let name=row["Name"] as? String,!name.isEmpty,
                      let sku=row["SKU"] as? String,!sku.isEmpty,skus.insert(sku).inserted,
                      let price=row["PriceYNXT"] as? String,let stock=row["Inventory"] as? String,let reserved=row["Reserved"] as? String,
                      try integer(price,positive:true)>0,try integer(stock)>=integer(reserved) else{throw ShopError.security}
                if let original=requested.first(where:{$0["SKU"] as? String==sku}){
                    if let expected=original["NativePrice"] as? [String:Any]{guard let actual=row["NativePrice"] as? [String:Any],try CanonicalJSON.data(actual)==CanonicalJSON.data(expected) else{throw ShopError.security}}
                    if original["ClearNativePrice"] as? Bool==true{guard row["NativePrice"]==nil || row["NativePrice"] is NSNull else{throw ShopError.security}}
                }
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
