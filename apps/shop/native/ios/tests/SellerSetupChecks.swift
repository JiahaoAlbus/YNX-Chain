import Foundation
@MainActor final class SetupAuthority:AppleNativeAuthority {
    var current:ShopSession?
    let account="ynx1"+String(repeating:"q",count:38)
    func restore()async throws{}
    func connect()async throws{current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)}
    func disconnect()throws{current=nil}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};_ = try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller);return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class SetupHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((SetupHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ body:Any)throws{client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:try JSONSerialization.data(withJSONObject:body));client?.urlProtocolDidFinishLoading(self)}
    func lost(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
    func body()throws->[String:Any]{var data=request.httpBody ?? Data();if data.isEmpty,let stream=request.httpBodyStream{stream.open();defer{stream.close()};var b=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&b,maxLength:b.count);guard n>=0 else{throw ShopError.security};if n==0{break};data.append(contentsOf:b.prefix(n))}};return try JSONSerialization.jsonObject(with:data) as! [String:Any]}
}
@main struct SellerSetupChecks {
    @MainActor static func main()async throws {
        var checks=0
        func check(_ yes:Bool,_ name:String)throws{guard yes else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func until(_ ready:()->Bool)async throws{for _ in 0..<200_000{if ready(){return};await Task.yield()};throw NSError(domain:"bounded setup flow",code:1)}
        let authority=SetupAuthority(),storeID="store_new_original",time="2026-11-07T00:00:00Z"
        var store:[String:Any]=[:],products:[[String:Any]]=[],invitations:[[String:Any]]=[],pending:[SetupHTTP]=[],writes=0
        SetupHTTP.handler={r in
            let path=r.request.url!.path
            if r.request.httpMethod != "GET"{writes+=1;pending.append(r);return}
            switch path {
            case "/api/seller/stores":try! r.respond(["stores":store.isEmpty ? []:[store],"access":store.isEmpty ? [:]:[storeID:["role":"owner","permissions":["seller.read","catalog.write","inventory.write","team.read"]]]])
            case "/api/seller/products":try! r.respond(["products":products])
            case "/api/seller/orders":try! r.respond(["orders":[]])
            case "/api/seller/stores/"+storeID+"/roles":try! r.respond(["roles":[authority.account:"owner"],"revocations":[],"invitations":invitations])
            case "/api/seller/audit":try! r.respond(["events":[]])
            case "/api/seller/settlements":try! r.respond(["settlements":[]])
            default:preconditionFailure(path)
            }
        }
        func take(_ path:String)async throws->SetupHTTP{try await until{!pending.isEmpty};let r=pending.removeFirst();try check(r.request.url?.path=="/api/"+path,"actual setup route "+path);return r}
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[SetupHTTP.self]
        let api=APIClient(session:URLSession(configuration:config),authority:authority)
        var saved=["retained-Pay-UNKNOWN":Data("unchanged original invoice".utf8)]
        let sentinel=saved["retained-Pay-UNKNOWN"]
        let journal=SellerMutationJournal(read:{saved[$0]},write:{saved[$0]=$1})
        let model=ShopSellerModel(api:api,journal:journal,localDraftStore:SellerLocalDraftStore(read:{saved[$0]},write:{saved[$0]=$1}))
        model.connect();try await until{model.signedIn && !model.busy}
        try check(model.stores.isEmpty && model.selectedStoreID.isEmpty && writes==0,"empty authentic store projection does not synthesize a store or mutation")
        model.perform(.createStore(name:"My original store",description:"Owner supplied",policy:"Reviewed policy",trustURL:"",settlementAccount:authority.account))
        let create=try await take("seller/stores"),input=try create.body()
        let original=try journal.records(authority.account).values.first!
        try check(original.storeID.isEmpty && original.kind=="create-store" && original.phase=="unknown","new-store request has no fabricated pre-existing Store ID")
        store=["ID":storeID,"Owner":authority.account,"Name":"My original store","Description":"Owner supplied","Policy":"Reviewed policy","TrustURL":"","SettlementAccount":authority.account,"Status":"onboarding","CreatedAt":time,"UpdatedAt":time]
        create.lost();try await until{!model.busy};try check(model.stores.isEmpty && model.pendingOriginalCount==1,"lost new-store acknowledgement remains UNKNOWN without a fake store in UI")
        model.recoverOriginals();let read=try await take("seller/mutations/lookup");let query=try read.body()
        try check(query["OriginalBody"] as? String==String(data:original.body,encoding:.utf8) && query["IdempotencyKey"]==nil,"creation recovery queries only exact retained original body")
        try read.respond(["Actor":authority.account,"Method":"POST","Path":"/seller/stores","IdempotencyKey":input["IdempotencyKey"]!,"Result":store]);try await until{!model.busy && model.stores.count==1}
        try check(model.selectedStoreID==storeID && model.stores[0].Status=="onboarding" && model.pendingOriginalCount==0,"only matching original acknowledgement and fresh owned read adopt the created onboarding store")
        model.perform(.activateStore(expectedUpdatedAt:time,expectedPolicy:"Different unreviewed policy",expectedSettlementAccount:authority.account));try await until{!model.busy};try check(writes==2,"changed activation terms are refused before durable preparation or HTTP")
        model.perform(.activateStore(expectedUpdatedAt:time,expectedPolicy:"Reviewed policy",expectedSettlementAccount:authority.account));let activate=try await take("seller/stores/"+storeID+"/native-activate");let activationBody=try activate.body()
        try check(activationBody["ExpectedPolicy"] as? String=="Reviewed policy" && activationBody["ExpectedSettlementAccount"] as? String==authority.account,"activation freezes the actual reviewed policy and payout as well as its timestamp")
        store["Status"]="active";try activate.respond(["Store":store,"OriginalApplied":true,"QueryOnly":false]);try await until{!model.busy}
        try check(model.stores[0].Status=="active","activation is reflected only after actual confirmation and fresh read")
        let draft=SellerListingDraft(productID:"",expectedRevision:"0",title:"Unpublished original",description:"",category:"",variants:[SellerVariantDraft(Name:"Own SKU",SKU:"own-sku",PriceYNXT:String(Int64.max),Inventory:"0")])
        model.perform(.createProduct(draft));let productRequest=try await take("seller/products"),productBody=try productRequest.body();let variant=(productBody["Variants"] as! [[String:Any]])[0]
        try check((variant["PriceYNXT"] as? NSNumber)?.int64Value==Int64.max,"new unpublished product freezes every price digit without floating point rounding")
        let product:[String:Any]=["ID":"product_original","StoreID":storeID,"Title":"Unpublished original","Description":"","Category":"","Published":false,"Revision":1,"Media":[],"Variants":[["ID":"variant_original","Name":"Own SKU","SKU":"own-sku","PriceYNXT":Int64.max,"Inventory":0,"Reserved":0]]]
        products=[product];try productRequest.respond(product);try await until{!model.busy && model.products.count==1};try check(!model.products[0].Published,"creating a remote draft does not publish or claim an order")
        let target="ynx1"+String(repeating:"p",count:38)
        model.perform(.invite(account:target,role:"support",ttlSeconds:"900"));let invitation=try await take("seller/stores/"+storeID+"/native-invitations")
        let row:[String:Any]=["ID":"invitation_original","StoreID":storeID,"Account":target,"Role":"support","CreatedBy":authority.account,"Status":"pending","Reason":"","CreatedAt":time,"ExpiresAt":"2099-01-01T00:00:00Z","UpdatedAt":time,"AcceptedAt":"0001-01-01T00:00:00Z","CancelledAt":"0001-01-01T00:00:00Z"]
        invitations=[row];try invitation.respond(["Invitation":row,"OriginalApplied":true,"QueryOnly":false]);try await until{!model.busy && model.invitations.count==1}
        try check(model.invitations[0].Status=="pending" && !model.members.contains(where:{$0.Account==target}),"pending invitation grants no role or approved Wallet session")
        let pendingInvitation=model.invitations[0]
        model.perform(.invitationDecision(pendingInvitation,accept:true,reason:""));try check(pending.isEmpty,"store owner cannot accept an invitation addressed to a different account")
        model.perform(.invitationDecision(pendingInvitation,accept:false,reason:"Not needed anymore"));let cancel=try await take("seller/stores/"+storeID+"/invitations/"+pendingInvitation.ID+"/native-cancel"),cancelBody=try cancel.body()
        try check(cancelBody["ExpectedAccount"] as? String==target && cancelBody["ExpectedRole"] as? String=="support" && cancelBody["ExpectedUpdatedAt"] as? String==time,"owner cancellation freezes the actual reviewed invitation")
        var cancelled=row;cancelled["Status"]="cancelled";cancelled["Reason"]="Not needed anymore";cancelled["CancelledAt"]=time;invitations=[cancelled]
        try cancel.respond(["Invitation":cancelled,"OriginalApplied":true,"QueryOnly":false]);try await until{!model.busy}
        try check(model.invitations[0].Status=="cancelled" && !model.members.contains(where:{$0.Account==target}),"confirmed cancellation grants no membership")

        let profile=model.stores[0],charges=SellerNativeCharges(Genesis:String(repeating:"ab",count:32),NativeChainID:"6423",AssetID:"YNXT",UnitVersion:"1",ShippingAtoms:"0",TaxAtoms:"0")
        model.perform(.updateStore(profile,name:profile.Name,description:profile.Description,policy:profile.Policy,trustURL:profile.TrustURL,settlementAccount:profile.SettlementAccount,nativeCharges:charges))
        let nativeProfile=try await take("seller/stores/"+storeID+"/native-profile"),profileBody=try nativeProfile.body(),profileUpdate=profileBody["Update"] as! [String:Any],chargeData=profileUpdate["NativeCharges"] as! [String:Any]
        try check(chargeData["ShippingAtoms"] as? String=="0" && chargeData["TaxAtoms"] as? String=="0" && chargeData["Genesis"] as? String==String(repeating:"ab",count:32),"profile sends only explicit native charge strings on original owner mutation")
        store["NativeCharges"]=chargeData;store["NativeChargesApprovalRef"]="shop.charges/"+storeID+"/"+String(repeating:"a",count:64)
        try nativeProfile.respond(["Store":store,"Applied":profileUpdate,"OriginalApplied":true,"QueryOnly":false]);try await until{!model.busy}
        try check(model.stores[0].NativeCharges?.ShippingAtoms=="0" && model.stores[0].NativeChargesApprovalRef != nil,"matching normal profile receipt adopts native charge data and actual reference")
        products[0]["Media"]=[["URL":"https://media.example/original.jpg","AltText":"Original","Kind":"image"]];model.refresh();try await until{!model.busy}
        var nativeDraft=model.draft(for:model.products[0]);nativeDraft.variants[0].nativePrice=SellerNativePriceDraft(genesis:String(repeating:"ab",count:32),nativeChainID:"6423",amountAtoms:String(UInt64.max))
        model.perform(.publish(nativeDraft));let nativeListing=try await take("seller/products/product_original/native-listing"),nativeBody=try nativeListing.body(),nativeVariants=nativeBody["Variants"] as! [[String:Any]],nativeData=nativeVariants[0]["NativePrice"] as! [String:Any]
        try check(nativeData["AmountAtoms"] as? String==String(UInt64.max) && nativeVariants[0]["PriceYNXT"] as? String==String(Int64.max),"same authenticated listing keeps UInt64 native atoms separate from exact legacy Int64 price")
        products[0]["Revision"]=3;products[0]["Published"]=true;var liveVariants=products[0]["Variants"] as! [[String:Any]];liveVariants[0]["NativePrice"]=nativeData;products[0]["Variants"]=liveVariants
        var acceptedVariant=nativeVariants[0];acceptedVariant["Reserved"]="0";acceptedVariant.removeValue(forKey:"ClearNativePrice")
        try nativeListing.respond(["OriginalApplied":true,"QueryOnly":false,"Product":["ID":"product_original","StoreID":storeID,"Title":nativeDraft.title,"Revision":"3","Published":true,"Variants":[acceptedVariant]]]);try await until{!model.busy}
        try check(model.products[0].Variants[0].NativePrice?.AmountAtoms==String(UInt64.max),"fresh normal product read retains configured native price without conversion")
        let beforeNativeInvalid=writes
        var invalid=model.draft(for:model.products[0]);invalid.variants[0].nativePrice?.amountAtoms="01";model.perform(.publish(invalid))
        try check(writes==beforeNativeInvalid && pending.isEmpty,"noncanonical native amount is refused before durable mutation and HTTP")
        try check(saved["retained-Pay-UNKNOWN"]==sentinel && pending.isEmpty,"setup creates no payment and preserves unrelated original invoice UNKNOWN")
        print("Actual Seller setup checks PASS \(checks); controlled fixture only, no real account, Store, provider or funds")
    }
}
