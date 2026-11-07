import Foundation
@MainActor final class SellerFixtureAuthority:AppleNativeAuthority {
    var current:ShopSession?
    let account="ynx1"+String(repeating:"q",count:38)
    var restores=0,connections=0,returns=0,proofFails=false
    func restore()async throws{restores+=1}
    func connect()async throws{connections+=1;current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)}
    func handleReturn(_ url:URL)async throws{returns+=1;throw ShopError.unavailable}
    func disconnect()throws{current=nil}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard !proofFails,current==expected else{throw ShopError.security};_ = try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller);return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class SellerFixtureHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((SellerFixtureHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ value:Any)throws{let data=try JSONSerialization.data(withJSONObject:value);client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)}
    func loseAcknowledgement(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
    func body()throws->Data{if let value=request.httpBody{return value};guard let stream=request.httpBodyStream else{return Data()};stream.open();defer{stream.close()};var result=Data(),buffer=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&buffer,maxLength:buffer.count);guard n>=0 else{throw ShopError.invalidResponse};if n==0{break};result.append(contentsOf:buffer.prefix(n))};return result}
}
@main struct SellerModelChecks {
    @MainActor static func main()async throws {
        var checks=0
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func until(_ predicate:()->Bool)async throws{for _ in 0..<200_000{if predicate(){return};await Task.yield()};throw NSError(domain:"bounded Seller asynchronous condition",code:1)}
        let authority=SellerFixtureAuthority();let account=authority.account,store="store_original"
        var factoryCalls=0,reads=0,allowWrite=true,mutations:[SellerFixtureHTTP]=[],paths:[String]=[]
        var counts:[String:(Int64,Int64)]=["p1":(1,5),"p2":(1,5)]
        func product(_ id:String)->[String:Any]{let value=counts[id]!;return ["ID":id,"StoreID":store,"Title":"Controlled fixture "+id,"Description":"","Category":"","Published":true,"Revision":value.0,"Media":[],"Variants":[["ID":"v"+id,"Name":"Original","SKU":"sku"+id,"PriceYNXT":Int64.max,"Inventory":value.1,"Reserved":0]]]}
        SellerFixtureHTTP.handler={request in
            let path=request.request.url!.path,method=request.request.httpMethod!
            if method != "GET"{paths.append(path);mutations.append(request);return}
            precondition(request.request.value(forHTTPHeaderField:"Authorization")==nil)
            switch path {
            case "/api/seller/stores":try! request.respond(["stores":[["ID":store,"Owner":account,"Name":"Original store","Description":"","Policy":"","TrustURL":"","SettlementAccount":"","Status":"active"]],"access":[store:["role":"owner","permissions":["seller.read","catalog.write","inventory.write","fulfillment.write","returns.resolve","team.read","audit.read","finance.read"]]]])
            case "/api/seller/products":try! request.respond(["products":[product("p1"),product("p2")]])
            case "/api/seller/orders":try! request.respond(["orders":[]])
            case "/api/seller/stores/"+store+"/roles":try! request.respond(["roles":[account:"owner"],"revocations":[],"invitations":[]])
            case "/api/seller/audit":try! request.respond(["events":[]])
            case "/api/seller/settlements":try! request.respond(["settlements":[]])
            default:preconditionFailure("Unexpected Seller route "+path)
            }
        }
        func take(_ path:String)async throws->SellerFixtureHTTP{try await until{!mutations.isEmpty};let request=mutations.removeFirst();try check(request.request.url?.path=="/api/"+path,"exact original Seller route "+path);return request}
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[SellerFixtureHTTP.self]
        let api=APIClient(session:URLSession(configuration:config),authorityFactory:{factoryCalls+=1;return authority})
        var storage=["original-Pay-UNKNOWN":Data("original financial operation".utf8)]
        let sentinel=storage["original-Pay-UNKNOWN"]
        let journal=SellerMutationJournal(read:{reads+=1;return storage[$0]},write:{guard allowWrite else{throw ShopError.security};storage[$0]=$1})
        let model=ShopSellerModel(api:api,journal:journal,localDraftStore:SellerLocalDraftStore(read:{storage[$0]},write:{guard allowWrite else{throw ShopError.security};storage[$0]=$1}))
        model.workspaceVisible=true
        try check(factoryCalls==0 && reads==0 && authority.connections==0,"opening Seller workspace does not open Keychain or expand Buyer authority")
        model.connect();try await until{model.signedIn && !model.busy && model.products.count==2}
        try check(factoryCalls==1 && authority.restores==1 && authority.connections==1 && model.storeRole=="owner" && model.canManageMembers,"explicit Seller connect adopts only its separate actual profile and owned access projection")
        try check(model.products[0].Variants[0].PriceYNXT==Int64.max,"actual Seller API preserves Int64 maximum price through wire decoding")
        let sourceProduct=model.products.first(where:{$0.ID=="p1"})!
        var edited=SellerListingDraft(sourceProduct);edited.title="Private local edited title"
        model.saveLocalDraft(edited)
        try check(model.state=="seller_local_draft_saved" && paths.isEmpty && model.draft(for:sourceProduct).title==edited.title && model.products.first(where:{$0.ID=="p1"})?.Title==sourceProduct.Title,"saving a local draft changes encrypted local data only, never the server listing")
        for _ in 0..<20{model.saveLocalDraft(edited)}
        try check(model.state=="seller_local_draft_saved","repeated identical local save does not exhaust or rotate draft history")
        let coldDrafts=SellerLocalDraftStore(read:{storage[$0]},write:{storage[$0]=$1})
        try check(try coldDrafts.load(account:account,storeID:store)["p1"]?.title==edited.title,"cold local draft restores original product revision and edited text")
        allowWrite=false;var failedDraft=edited;failedDraft.title="Rejected local edit";model.saveLocalDraft(failedDraft)
        try check(model.state=="seller_local_draft_failed" && model.draft(for:sourceProduct).title==edited.title && paths.isEmpty,"failed encrypted draft persistence preserves prior draft without false saved status or HTTP")
        allowWrite=true
        model.perform(.inventory(productID:"p1",variantID:"vp1",expectedRevision:"1",inventory:"9"))
        let first=try await take("seller/inventory/batch"),frozen=try first.body()
        let original=try journal.records(account).values.first(where:{$0.target=="p1"})!
        try check(original.phase=="unknown" && original.body==frozen,"Seller UNKNOWN and frozen original body are durable before HTTP dispatch")
        first.loseAcknowledgement();try await until{!model.busy}
        try check(model.hasPending("p1") && !model.hasPending("p2"),"unknown Seller action blocks its own object while another object remains available")
        model.perform(.inventory(productID:"p1",variantID:"vp1",expectedRevision:"1",inventory:"9"));for _ in 0..<1000{await Task.yield()}
        try check(paths.count==1 && mutations.isEmpty,"lost Seller acknowledgement cannot resend or replace its original key")
        func inventoryResult(_ product:String,_ revision:String,_ count:String)->[String:Any]{["StoreID":store,"RequestHash":String(repeating:"a",count:64),"OriginalApplied":true,"QueryOnly":true,"Products":[["ID":product,"StoreID":store,"Revision":revision,"Variants":[["ID":"v"+product,"Inventory":count,"Reserved":"0"]]]]]}
        model.perform(.inventory(productID:"p2",variantID:"vp2",expectedRevision:"1",inventory:"8"));let independent=try await take("seller/inventory/batch");counts["p2"]=(2,8);try independent.respond(inventoryResult("p2","2","8"));try await until{!model.busy}
        try check(model.hasPending("p1") && !model.hasPending("p2") && model.products.first(where:{$0.ID=="p2"})?.Revision==2,"independent Seller object completes and refreshes while original UNKNOWN remains preserved")
        model.recoverOriginals();let foreign=try await take("seller/mutations/lookup");let lookup=try JSONSerialization.jsonObject(with:foreign.body()) as! [String:Any]
        try check(lookup["OriginalBody"] as? String==String(data:frozen,encoding:.utf8) && lookup["Path"] as? String==original.path,"Seller recovery reads the exact stored original request without reconstruction")
        try foreign.respond(["Actor":"foreign","Method":"POST","Path":original.path,"IdempotencyKey":original.key,"Result":inventoryResult("p1","2","9")]);try await until{!model.busy}
        try check(try journal.records(account)[original.key]?.phase=="unknown","foreign original result cannot acknowledge or erase Seller UNKNOWN")
        model.recoverOriginals();let recovered=try await take("seller/mutations/lookup");counts["p1"]=(2,9);try recovered.respond(["Actor":account,"Method":"POST","Path":original.path,"IdempotencyKey":original.key,"Result":inventoryResult("p1","2","9")]);try await until{!model.busy}
        try check(try journal.records(account)[original.key]?.phase=="confirmed" && model.pendingOriginalCount==0 && model.products.first(where:{$0.ID=="p1"})?.Revision==2,"matching original lookup acknowledges the one prior mutation and refreshes real current data")
        allowWrite=false;let before=paths.count;model.perform(.inventory(productID:"p2",variantID:"vp2",expectedRevision:"2",inventory:"12"));try await until{!model.busy}
        try check(paths.count==before,"durable prepare refusal prevents Seller HTTP dispatch")
        allowWrite=true;authority.proofFails=true;model.perform(.inventory(productID:"p2",variantID:"vp2",expectedRevision:"2",inventory:"12"));try await until{!model.busy}
        let prepared=try journal.records(account).values.first(where:{$0.target=="p2" && $0.phase=="prepared"})!
        try check(paths.count==before && model.preparedOriginalCount==1,"proof failure retains a known unsent original distinct from UNKNOWN")
        authority.proofFails=false;model.retryPreparedOriginals();let retry=try await take("seller/inventory/batch")
        try check(try retry.body()==prepared.body,"explicit known-unsent retry sends only original frozen bytes and key")
        counts["p2"]=(3,12);try retry.respond(inventoryResult("p2","3","12"));try await until{!model.busy}
        try check(model.preparedOriginalCount==0 && !model.hasPending("p2"),"confirmed known-unsent original leaves no stale action lock")
        model.perform(.inventory(productID:"p1",variantID:"vp1",expectedRevision:"2",inventory:"11"));let late=try await take("seller/inventory/batch");let uncertain=try journal.records(account).values.first(where:{$0.target=="p1" && $0.phase=="unknown"})!
        model.disconnect();try late.respond(inventoryResult("p1","3","11"));for _ in 0..<1000{await Task.yield()}
        try check(try !model.signedIn && model.products.isEmpty && model.members.isEmpty && journal.records(account)[uncertain.key]?.phase=="unknown","sign-out fences late Seller results while retaining the actual original request")
        let router=ShopAuthorizationReturnRouter(),callback=URL(string:"ynxshop://wallet-auth/callback?result=original")!
        try router.receive(callback);try check(router.original==callback && authority.returns==0,"shared callback remains opaque until the user chooses its original profile")
        do{try router.receive(URL(string:"ynxshop://wallet-auth/callback?result=replacement")!);throw NSError(domain:"replacement accepted",code:1)}catch ShopError.security{}
        try check(router.original==callback,"a second callback cannot replace the retained original")
        let connectCount=authority.connections;router.chooseSeller(model);try await until{!model.busy}
        try check(authority.returns==1 && authority.connections==connectCount && !model.signedIn,"explicit Seller return resumes only the original SDK callback without a new connect or fabricated grant")
        try check(storage["original-Pay-UNKNOWN"]==sentinel && mutations.isEmpty,"full Seller consumer preserves unrelated original Pay UNKNOWN and creates no financial operation")
        print("Actual Seller Model/API checks PASS \(checks); controlled HTTP/authority only, no real Source, Keychain, Wallet or money")
    }
}
