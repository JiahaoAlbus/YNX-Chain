import Foundation

// Controlled HTTP responses exercise the actual Model/API; no real approval or backend.
final class OrderRefreshHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((OrderRefreshHTTP)->Void)?
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

@MainActor final class OrderRefreshAuthority:AppleNativeAuthority {
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

@MainActor final class OrderRefreshInbox {
    private var pending:[OrderRefreshHTTP]=[]
    private var waiter:CheckedContinuation<OrderRefreshHTTP,Never>?
    func receive(_ request:OrderRefreshHTTP) {
        if request.request.url?.path=="/api/products"{request.respond(200,"{\"products\":[]}");return}
        precondition(request.request.httpMethod=="GET" && request.request.url?.path=="/api/orders")
        if let waiter{self.waiter=nil;waiter.resume(returning:request)}else{pending.append(request)}
    }
    func take()async->OrderRefreshHTTP {
        if !pending.isEmpty{return pending.removeFirst()}
        return await withCheckedContinuation{waiter=$0}
    }
}

@main struct ShopModelOrderRefreshChecks {
    @MainActor static func main()async throws {
        func check(_ value:Bool,_ name:String)throws {
            guard value else{throw NSError(domain:name,code:1)}
            print("PASS "+name)
        }
        let account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38)
        func session(_ actor:String,generation:Int=1)->ShopSession {
            ShopSession(account:actor,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:generation)
        }
        func response(_ actor:String,_ status:String)->String {
            "{\"orders\":[{\"ID\":\"original-order\",\"Buyer\":\"\(actor)\",\"Status\":\"\(status)\",\"TotalYNXT\":24,\"Currency\":\"YNXT\"}]}"
        }
        let authority=OrderRefreshAuthority();authority.current=session(account)
        let inbox=OrderRefreshInbox();OrderRefreshHTTP.handler={inbox.receive($0)}
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[OrderRefreshHTTP.self]
        let http=URLSession(configuration:configuration)
        let api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:http,authority:authority)
        var storage:[String:Data]=[:]
        let queue=OfflineQueue(read:{storage["queue"]},write:{storage["queue"]=$0},readPhase:{storage["phase"]},writePhase:{storage["phase"]=$0})
        let unresolved=try queue.prepareUnsent(account:account,path:"orders/original-order/transition",input:["Status":"cancelled"])
        try queue.beginDispatch(unresolved);try queue.markUnknown(unresolved)
        let preservedQueue=storage
        let journal=InvoiceHandoffJournal(read:{storage[$0]},write:{storage[$0]=$1})
        let journey=AppleBuyerJourney(read:{storage[$0]},write:{storage[$0]=$1})
        let model=ShopModel(api:api,queue:queue,invoiceHandoffs:journal,journey:journey)
        let bootstrap=await inbox.take();bootstrap.respond(200,response(account,"pending"))
        // Yield only to the actual startup read; no timer-based response ordering.
        while model.orders.isEmpty{await Task.yield()}
        try check(model.signedIn && model.orders.first?.status=="pending","current startup read is presented")

        let first=Task{await model.loadOrders()};let old=await inbox.take()
        let second=Task{await model.loadOrders()};let latest=await inbox.take()
        latest.respond(200,response(account,"cancelled"));await second.value
        old.respond(200,response(account,"pending"));await first.value
        try check(model.orders.first?.status=="cancelled","late old success cannot regress newer order status")

        let failing=Task{await model.loadOrders()};let oldFailure=await inbox.take()
        let succeeding=Task{await model.loadOrders()};let newSuccess=await inbox.take()
        newSuccess.respond(200,response(account,"cancelled"));await succeeding.value
        model.state="order_request_pending"
        oldFailure.respond(500);await failing.value
        try check(model.state=="order_request_pending" && model.orders.first?.status=="cancelled","late old failure cannot overwrite current presentation")

        let obsolete=Task{await model.loadOrders()};let oldSuccess=await inbox.take()
        let currentFailure=Task{await model.loadOrders()};let newFailure=await inbox.take()
        newFailure.respond(500);await currentFailure.value
        try check(model.state=="unavailable","latest real failure remains visible")
        oldSuccess.respond(200,response(account,"pending"));await obsolete.value
        try check(model.state=="unavailable" && model.orders.first?.status=="cancelled","old success cannot replace list after newer failure")

        let waiting=Task{await model.loadOrders()};let staleWhileLoading=await inbox.take()
        let loading=Task{await model.loadOrders()};let currentLoading=await inbox.take()
        model.state="loading";staleWhileLoading.respond(500);await waiting.value
        try check(model.state=="loading","old failure cannot interrupt newer loading state")
        currentLoading.respond(200,response(account,"cancelled"));await loading.value

        let oldAccountTask=Task{await model.loadOrders()};let oldAccount=await inbox.take()
        authority.current=session(other);api.onSessionChanged?()
        let newAccount=await inbox.take();model.state="loading"
        oldAccount.respond(500);await oldAccountTask.value
        try check(model.orders.isEmpty && model.state=="loading" && model.signedIn,"old-account failure cannot change new-account loading presentation")
        newAccount.respond(200,response(other,"pending"))
        while model.orders.isEmpty{await Task.yield()}
        try check(model.orders.first?.buyer==other,"current new-account read succeeds")

        let generationTask=Task{await model.loadOrders()};let oldGeneration=await inbox.take()
        authority.current=session(other,generation:2);api.onSessionChanged?()
        let newGeneration=await inbox.take();newGeneration.respond(200,response(other,"cancelled"))
        while model.orders.isEmpty{await Task.yield()}
        model.state="order_request_pending";oldGeneration.respond(200,response(other,"pending"));await generationTask.value
        try check(model.orders.first?.status=="cancelled" && model.state=="order_request_pending","same-account session replacement rejects late old success")

        let invalidatedTask=Task{await model.loadOrders()};let invalidated=await inbox.take()
        api.invalidate();model.state="loading";invalidated.respond(500);await invalidatedTask.value
        try check(model.state=="loading" && model.orders.first?.status=="cancelled","API revision invalidation suppresses stale failure without a new read")

        let foreignTask=Task{await model.loadOrders()};let foreign=await inbox.take()
        foreign.respond(200,response(account,"pending"));await foreignTask.value
        try check(model.state=="unavailable" && model.orders.first?.buyer==other,"current foreign-buyer receipt is still rejected")

        let deniedTask=Task{await model.loadOrders()};let denied=await inbox.take()
        denied.respond(401);await deniedTask.value
        try check(!model.signedIn && model.orders.isEmpty && authority.current==nil,"current authoritative 401 still clears the account and list")
        authority.current=session(other,generation:3);api.onSessionChanged?()
        let restored=await inbox.take();restored.respond(200,response(other,"pending"))
        while model.orders.isEmpty{await Task.yield()}

        let signingOut=Task{await model.loadOrders()};let logoutReply=await inbox.take()
        model.signOut();model.state="security_error";logoutReply.respond(500);await signingOut.value
        try check(!model.signedIn && model.orders.isEmpty && model.state=="security_error","late logout failure cannot rewrite signed-out presentation")
        try check(storage==preservedQueue && (try queue.dispatchPhase(unresolved))=="unknown","refresh leaves original unresolved mutation bytes and UNKNOWN intact")
        http.invalidateAndCancel()
        print("Actual Model/API controlled order-refresh checks PASS; real backend and Wallet approval NOT_VERIFIED")
    }
}
