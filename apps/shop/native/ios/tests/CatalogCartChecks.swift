import Foundation

// Deterministically reorder actual Model/API reads without any external service.
final class CatalogCartHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((CatalogCartHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func fail(){client?.urlProtocol(self,didFailWithError:URLError(.notConnectedToInternet))}
    func respond(_ status:Int=200,_ body:String="{}") {
        let response=HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor final class CatalogCartAuthority:AppleNativeAuthority {
    var current:ShopSession?
    func restore()async throws{}
    func connect()async throws{throw ShopError.unavailable}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func disconnect()throws{current=nil}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any] {
        guard current==expected else{throw ShopError.contextChanged}
        return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]
    }
}


@MainActor final class CatalogCartInbox {
    var pending:[CatalogCartHTTP]=[]
    func receive(_ request:CatalogCartHTTP){pending.append(request)}
    func take(_ path:String)async throws->CatalogCartHTTP {
        for _ in 0..<100_000 {
            if let index=pending.firstIndex(where:{$0.request.url?.path==path}){return pending.remove(at:index)}
            await Task.yield()
        };throw NSError(domain:"missing request "+path,code:1)
    }
}
@main struct CatalogCartChecks {
    @MainActor static func main()async throws {
        var checks=0
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func product(_ id:String="p",_ sku:String="v",stock:Int=3,reserved:Int=1,revision:Int=1,store:String="store",price:Int64=8,native:String?=nil)->String{
            "{\"ID\":\"\(id)\",\"StoreID\":\"\(store)\",\"Title\":\"Product \(id)\",\"Revision\":\(revision),\"Variants\":[{\"ID\":\"\(sku)\",\"Name\":\"Variant\",\"PriceYNXT\":\(price),\"Inventory\":\(stock),\"Reserved\":\(reserved)\(native.map{",\"NativePrice\":"+$0} ?? "")}]}"
        }
        func native(_ amount:String="10",chain:String="6423")->String{"{\"Genesis\":\""+String(repeating:"a",count:64)+"\",\"NativeChainID\":\"\(chain)\",\"AssetID\":\"YNXT\",\"UnitVersion\":\"1\",\"AmountAtoms\":\"\(amount)\"}"}
        let inbox=CatalogCartInbox();CatalogCartHTTP.handler={inbox.receive($0)}
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[CatalogCartHTTP.self]
        let http=URLSession(configuration:configuration),authority=CatalogCartAuthority()
        let api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:http,authority:authority)
        var storage:[String:Data]=[:]
        let journey=AppleBuyerJourney(read:{storage[$0]},write:{storage[$0]=$1})
        let model=ShopModel(api:api,journey:journey,localDataInitiallyLocked:false)
        let boot=try await inbox.take("/api/products");boot.respond(200,"{\"products\":["+product()+"]}")
        for _ in 0..<100_000{if model.catalogPhase=="loaded"{break};await Task.yield()}
        let original=model.products[0],variant=original.variants[0]
        try check(model.canAdd(original,variant),"actual successful catalog enables original variant")
        model.add(original,variant);model.add(original,variant);let full=storage
        model.add(original,variant)
        try check(model.cart[0].quantity==2 && storage==full,"cumulative add stops at actual inventory minus reservations")
        model.setCartQuantity(model.cart[0],quantity:3,revision:model.privacyRevision)
        try check(model.cart[0].quantity==2 && storage==full,"quantity editor cannot exceed original available stock")
        try check(model.cartLegacySubtotal==16 && model.cartNativeSubtotal==nil,"legacy merchandise subtotal preserves integer unit")
        model.search="other";let search=Task{await model.loadCatalog()};let searchReq=try await inbox.take("/api/products")
        try check(model.catalogIsStale,"changed search explicitly marks prior catalog stale")
        searchReq.respond(200,"{\"products\":["+product("other","other-v")+"]}");await search.value
        try check(model.products[0].productID=="other" && model.cachedProduct("p")?.name==original.name && model.cartLegacySubtotal==16,"search replacement retains independent original cart product and price")
        model.search="failed";let failed=Task{await model.loadCatalog()};let failedReq=try await inbox.take("/api/products");failedReq.respond(500);await failed.value
        try check(model.catalogPhase=="failed" && model.catalogIsStale && model.catalogLoadedQuery=="other" && !model.products.isEmpty,"failed search preserves labelled old query rather than false empty")
        let offline=Task{await model.loadCatalog()};let offlineReq=try await inbox.take("/api/products");offlineReq.fail();await offline.value
        try check(model.catalogPhase=="offline" && model.catalogIsStale,"transport offline is distinct from server refusal")
        let empty=Task{await model.loadCatalog()};let emptyReq=try await inbox.take("/api/products");emptyReq.respond(200,"{\"products\":[]}");await empty.value
        try check(model.catalogPhase=="loaded" && model.products.isEmpty && !model.catalogIsStale,"only successful empty response is current empty catalog")
        let first=Task{await model.refreshProduct("p")};let detail=try await inbox.take("/api/products/p")
        let second=Task{await model.refreshProduct("p")};for _ in 0..<100{await Task.yield()}
        try check(inbox.pending.isEmpty,"concurrent same product detail reads coalesce")
        detail.respond(200,product(stock:2,reserved:1,revision:3));await first.value;await second.value
        try check(model.maximumCartQuantity(model.cart[0])==1 && model.cartCatalogIssue=="shop_cart_quantity_exceeds_stock","fresh reduced stock preserves draft and reports excess")
        model.setCartQuantity(model.cart[0],quantity:1,revision:model.privacyRevision)
        try check(model.cart[0].quantity==1 && model.cartLegacySubtotal==8,"user may reduce overstock draft without dropping original item")
        let older=Task{await model.refreshProduct("p")};let oldReq=try await inbox.take("/api/products/p");oldReq.respond(200,product(revision:2));await older.value
        try check(model.cachedProduct("p")?.revision==3 && model.productPhase("p")=="failed" && !model.canAdd(original,variant),"lower server revision cannot restore stock or enable stale buy")
        let unknown=Task{await model.refreshProduct("p")};let unknownReq=try await inbox.take("/api/products/p");unknownReq.respond(404);await unknown.value
        try check(model.productPhase("p")=="not_found" && model.cachedProduct("p") != nil && !model.canAdd(original,variant) && model.cartLegacySubtotal==nil,"unpublished original is explicit unavailable and retains readonly detail and draft")
        model.removeCart(model.cart[0]);try check(model.cart.isEmpty,"unavailable cached product remains removable")
        let n=Task{await model.refreshProduct("n")};let nReq=try await inbox.take("/api/products/n");nReq.respond(200,product("n","nv",stock:20,reserved:0,native:native()));await n.value
        let np=model.cachedProduct("n")!;model.add(np,np.variants[0]);model.add(np,np.variants[0])
        try check(model.cartNativeSubtotal?.atoms==20 && model.cartLegacySubtotal==nil,"explicit native atoms never use legacy fallback amount")
        let invalid=try JSONDecoder().decode(Product.self,from:Data(product(native:native("01")).utf8))
        try check(CatalogPricing.nativeUnit(invalid.variants[0])==nil && !CatalogPricing.isLegacy(invalid),"noncanonical native price cannot become legacy price")
        let max=try JSONDecoder().decode(Product.self,from:Data(product(native:native("18446744073709551615")).utf8))
        try check(CatalogPricing.nativeUnit(max.variants[0])?.atoms==UInt64.max,"native UInt64 maximum keeps every digit")
        for (id,chain,store) in [("mixed","99","store"),("cross","6423","different")] {
            let read=Task{await model.refreshProduct(id)};let req=try await inbox.take("/api/products/"+id);req.respond(200,product(id,id+"v",store:store,native:native(chain:chain)));await read.value
            let p=model.cachedProduct(id)!;model.add(p,p.variants[0])
            try check(model.cartNativeSubtotal==nil && model.cartLegacySubtotal==nil && model.cartCatalogIssue==(id=="cross" ? "shop_cart_multiple_stores":"shop_cart_price_unavailable"),"mixed network or store never produces guessed total")
            model.removeCart(model.cart.last!)
        }
        let overflow=Task{await model.refreshProduct("n")};let overflowReq=try await inbox.take("/api/products/n");overflowReq.respond(200,product("n","nv",stock:20,reserved:0,revision:2,native:native(String(UInt64.max))));await overflow.value
        try check(model.cartNativeSubtotal==nil && model.cartCatalogIssue=="shop_cart_price_unavailable","native merchandise multiplication overflow is unavailable")
        let bytes=storage;let stale=Task{await model.refreshProduct("n")};let staleReq=try await inbox.take("/api/products/n");api.invalidate();staleReq.respond(200,product("n","nv",revision:5));await stale.value
        try check(model.cachedProduct("n")?.revision==2 && model.productPhase("n")=="idle" && storage==bytes,"invalidated API read cannot replace cache or edit original draft")
        let active=ShopSession(account:"ynx1"+String(repeating:"q",count:38),token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
        authority.current=active;api.onSessionChanged?()
        let orders=try await inbox.take("/api/orders");orders.respond(200,"{\"orders\":[]}")
        let refused=Task{await model.loadCatalog()};let refusedReq=try await inbox.take("/api/products");refusedReq.respond(401);await refused.value
        try check(model.catalogPhase=="failed" && api.currentSession==active && model.signedIn,"public catalog refusal cannot sign out existing protected account")
        http.invalidateAndCancel();print("Actual catalog/cart Model/API checks \(checks) PASS; live backend, image network, funds NOT_VERIFIED")
    }
}
