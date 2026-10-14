import Foundation

// Deterministically reorder actual Model/API reads without any external service.
final class CatalogRefreshHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((CatalogRefreshHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ status:Int=200,_ body:String="{}") {
        let response=HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor final class CatalogRefreshAuthority:AppleNativeAuthority {
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

@MainActor final class CatalogRefreshInbox {
    private var pending:[CatalogRefreshHTTP]=[]
    private var waiter:CheckedContinuation<CatalogRefreshHTTP,Never>?
    func receive(_ request:CatalogRefreshHTTP) {
        precondition(request.request.httpMethod=="GET")
        if request.request.url?.path=="/api/orders"{request.respond(200,"{\"orders\":[]}");return}
        precondition(request.request.url?.path=="/api/products")
        precondition(request.request.value(forHTTPHeaderField:"Authorization")==nil)
        precondition(request.request.value(forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2")==nil)
        if let waiter{self.waiter=nil;waiter.resume(returning:request)}else{pending.append(request)}
    }
    func take()async->CatalogRefreshHTTP {
        if !pending.isEmpty{return pending.removeFirst()}
        return await withCheckedContinuation{waiter=$0}
    }
}

@main struct ShopModelCatalogRefreshChecks {
    @MainActor static func main()async throws {
        func check(_ value:Bool,_ name:String)throws {
            guard value else{throw NSError(domain:name,code:1)};print("PASS "+name)
        }
        func until(_ condition:()->Bool)async throws {
            for _ in 0..<100_000{if condition(){return};await Task.yield()}
            throw NSError(domain:"startup did not complete",code:1)
        }
        let account="ynx1"+String(repeating:"q",count:38)
        func session(_ generation:Int)->ShopSession {
            ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:generation)
        }
        func response(_ name:String)->String {
            "{\"products\":[{\"ID\":\"\(name)\",\"StoreID\":\"original-store\",\"Title\":\"\(name)\",\"Variants\":[],\"Media\":[]}]}"
        }
        let inbox=CatalogRefreshInbox();CatalogRefreshHTTP.handler={inbox.receive($0)}
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[CatalogRefreshHTTP.self]
        let http=URLSession(configuration:configuration),authority=CatalogRefreshAuthority()
        let api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:http,authority:authority)
        var storage:[String:Data]=[:]
        let queue=OfflineQueue(read:{storage["queue"]},write:{storage["queue"]=$0},readPhase:{storage["phase"]},writePhase:{storage["phase"]=$0})
        let original=try queue.prepareUnsent(account:account,path:"orders/original-order/transition",input:["Status":"cancelled"])
        try queue.beginDispatch(original);try queue.markUnknown(original)
        let journey=AppleBuyerJourney(read:{storage[$0]},write:{storage[$0]=$1})
        try journey.editGuest([CartItem(productID:"original-product",variantID:"original-variant",quantity:3)])
        let preserved=storage
        let journal=InvoiceHandoffJournal(read:{storage[$0]},write:{storage[$0]=$1})
        let model=ShopModel(api:api,queue:queue,invoiceHandoffs:journal,journey:journey)
        let bootstrap=await inbox.take();bootstrap.respond(200,response("bootstrap"))
        try await until{model.products.first?.productID=="bootstrap"}
        try check(model.state.isEmpty && model.cart.first?.quantity==3,"current guest catalog and original cart restore")

        model.search="old";let first=Task{await model.loadCatalog()};let old=await inbox.take()
        model.search="new";let second=Task{await model.loadCatalog()};let new=await inbox.take()
        new.respond(200,response("new"));await second.value
        old.respond(200,response("old"));await first.value
        try check(model.products.first?.productID=="new" && model.state.isEmpty,"late old search cannot replace newer catalog")

        model.search="same";let earlier=Task{await model.loadCatalog()};let sameOld=await inbox.take()
        let later=Task{await model.loadCatalog()};let sameNew=await inbox.take()
        sameNew.respond(200,response("fresh"));await later.value
        sameOld.respond(200,response("cached"));await earlier.value
        try check(model.products.first?.productID=="fresh","same-query refreshes still honor request order")

        let failing=Task{await model.loadCatalog()};let staleFailure=await inbox.take()
        let succeeding=Task{await model.loadCatalog()};let success=await inbox.take()
        success.respond(200,response("latest"));await succeeding.value
        staleFailure.respond(500);await failing.value
        try check(model.products.first?.productID=="latest" && model.state.isEmpty,"late old failure cannot replace current successful presentation")

        let older=Task{await model.loadCatalog()};let oldWhileLoading=await inbox.take()
        let loading=Task{await model.loadCatalog()};let currentLoading=await inbox.take()
        oldWhileLoading.respond(500);await older.value
        try check(model.state=="loading","stale failure cannot interrupt newer loading state")
        currentLoading.respond(500);await loading.value
        try check(model.state=="unavailable" && model.products.first?.productID=="latest","current failure remains visible and retains catalog")

        let waiting=Task{await model.loadCatalog()};let oldSuccess=await inbox.take()
        let errorTask=Task{await model.loadCatalog()};let currentFailure=await inbox.take()
        currentFailure.respond(500);await errorTask.value
        oldSuccess.respond(200,response("obsolete"));await waiting.value
        try check(model.state=="unavailable" && model.products.first?.productID=="latest","older success cannot replace a newer failed search")

        let editing=Task{await model.loadCatalog()};let beforeEdit=await inbox.take()
        model.search="unsubmitted-new-query";model.state="order_request_pending"
        beforeEdit.respond(200,response("unwanted"));await editing.value
        try check(model.products.first?.productID=="latest" && model.state=="order_request_pending","editing query invalidates old success before another request")
        let editedFailure=Task{await model.loadCatalog()};let beforeFailureEdit=await inbox.take()
        model.search="another-query";model.state="loading"
        beforeFailureEdit.respond(500);await editedFailure.value
        try check(model.state=="loading","editing query also invalidates old failure")

        let guest=Task{await model.loadCatalog()};let guestReply=await inbox.take()
        authority.current=session(1);api.onSessionChanged?();model.state="wallet_active"
        guestReply.respond(200,response("guest-late"));await guest.value
        try check(model.products.first?.productID=="latest" && model.state=="wallet_active","old guest success cannot rewrite signed-in presentation")
        let sessionRead=Task{await model.loadCatalog()};let sessionReply=await inbox.take()
        authority.current=session(2);api.onSessionChanged?();model.state="wallet_active"
        sessionReply.respond(500);await sessionRead.value
        try check(model.state=="wallet_active","same-account session change invalidates old catalog failure")

        let invalidatedTask=Task{await model.loadCatalog()};let invalidated=await inbox.take()
        api.invalidate();model.state="security_error";invalidated.respond(500);await invalidatedTask.value
        try check(model.state=="security_error","API-only invalidation suppresses obsolete catalog failure")
        let active=Task{await model.loadCatalog()};let activeReply=await inbox.take()
        activeReply.respond(200,"{\"products\":[]}");await active.value
        try check(model.products.isEmpty && model.state=="empty_catalog","current empty result still updates catalog and message")
        try check(storage==preserved && (try queue.dispatchPhase(original))=="unknown","public catalog reads preserve original cart and UNKNOWN bytes")
        http.invalidateAndCancel()
        print("Actual Model/API controlled catalog checks PASS; real backend and approval NOT_VERIFIED")
    }
}
