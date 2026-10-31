import Foundation

@MainActor final class PreviewAuthority:AppleNativeAuthority {
    var current:ShopSession?
    var walletOpenings=0
    func restore()async throws{}
    func connect()async throws{throw ShopError.unavailable}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func disconnect()throws{current=nil}
    func openInvoice(_ url:URL,expected:ShopSession)async throws{walletOpenings+=1;throw ShopError.security}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any] {
        guard current==expected else{throw ShopError.contextChanged}
        return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]
    }
}
final class PreviewHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((PreviewHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ status:Int,_ object:[String:Any]=[:]) {
        let data=try! JSONSerialization.data(withJSONObject:object)
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
    }
}
@MainActor final class PreviewInbox {
    var waiter:CheckedContinuation<PreviewHTTP,Never>?
    var pending:[PreviewHTTP]=[]
    var reads=0
    var orderReads=0
    func receive(_ request:PreviewHTTP) {
        // Existing-invoice GET only. Any create-order, handoff POST or payment fails this test.
        precondition(request.request.httpMethod=="GET")
        let path=request.request.url!.path
        if path=="/api/products"{request.respond(200,["products":[]]);return}
        if path=="/api/orders"{orderReads+=1;request.respond(200,["orders":[]]);return}
        precondition(path.hasSuffix("/pay-handoff"));reads+=1
        if let waiter{self.waiter=nil;waiter.resume(returning:request)}else{pending.append(request)}
    }
    func take()async->PreviewHTTP {
        if !pending.isEmpty{return pending.removeFirst()}
        return await withCheckedContinuation{waiter=$0}
    }
}
@main struct InvoicePreviewContextChecks {
    @MainActor static func main()async throws {
        func check(_ value:Bool,_ label:String)throws{guard value else{throw NSError(domain:label,code:1)};FileHandle.standardOutput.write(Data(("PASS "+label+"\n").utf8))}
        func until(_ condition:()->Bool)async throws{let deadline=ContinuousClock.now.advanced(by:.seconds(5));while ContinuousClock.now<deadline{if condition(){return};try await Task.sleep(for:.milliseconds(1))};throw NSError(domain:"preview task did not finish",code:1)}
        let a="ynx1"+String(repeating:"q",count:38),b="ynx1"+String(repeating:"p",count:38)
        func session(_ account:String)->ShopSession{ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)))}
        func order(_ account:String,_ id:String)throws->Order {
            try JSONDecoder().decode(Order.self,from:JSONSerialization.data(withJSONObject:["ID":id,"Buyer":account,"StoreID":"test-store","Status":"payment_pending","TotalYNXT":24,"Currency":"YNXT","InvoiceID":"inv_"+id,"PayIntentID":"intent_"+id]))
        }
        let authority=PreviewAuthority();authority.current=session(a)
        let inbox=PreviewInbox();PreviewHTTP.handler={inbox.receive($0)}
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[PreviewHTTP.self]
        let http=URLSession(configuration:config),api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:http,authority:authority)
        var storage:[String:Data]=[:]
        let queue=OfflineQueue(read:{storage["queue"]},write:{storage["queue"]=$0},readPhase:{storage["phase"]},writePhase:{storage["phase"]=$0})
        let unknown=try queue.prepareUnsent(account:a,path:"orders/original/transition",input:["Action":"cancelled"])
        try queue.beginDispatch(unknown);try queue.markUnknown(unknown)
        var requiredRestoreRead=1;var initialRestoreFinished=false
        let journey=AppleBuyerJourney(read:{key in if inbox.orderReads>=requiredRestoreRead && key.hasPrefix("apple-buyer-draft-v1-"){initialRestoreFinished=true};return storage[key]},write:{storage[$0]=$1}),journal=InvoiceHandoffJournal(read:{storage[$0]},write:{storage[$0]=$1})
        let model=ShopModel(api:api,queue:queue,invoiceHandoffs:journal,journey:journey)
        // The startup fixture returns no products: the real model reports empty_catalog, not an empty status.
        try await until{model.signedIn && model.state=="empty_catalog" && initialRestoreFinished}
        let original=try order(a,"original")
        model.pay(original);let closed=await inbox.take()
        let before=storage;let review=try journey.load(a).review!
        model.cancelInvoicePresentation();model.state="profile_saved"
        closed.respond(500);try await until{!model.mutationBusy}
        try check(model.state=="profile_saved" && model.invoicePresentation==nil,"closed preview late failure cannot replace newer view state")
        try check(storage==before && review.phase=="unknown","closed preview preserves original UNKNOWN invoice journal bytes")

        model.pay(original);let current=await inbox.take();current.respond(500)
        try await until{!model.mutationBusy}
        try check(model.state=="unavailable","current preview failure still appears")
        let receipt:[String:Any]=["invoiceId":"inv_original","intentId":"intent_original","deepLink":"ynxpay://invoice/inv_original","order":try JSONSerialization.jsonObject(with:JSONEncoder().encode(original))]
        model.pay(original);let valid=await inbox.take();valid.respond(200,receipt)
        try await until{!model.mutationBusy}
        try check(model.invoicePresentation?.url.absoluteString=="ynxpay://invoice/inv_original" && authority.walletOpenings==0,"current valid receipt presents original invoice without opening Wallet")
        model.cancelInvoicePresentation()
        model.pay(original);let lateSuccess=await inbox.take()
        model.cancelInvoicePresentation();model.state="loading";lateSuccess.respond(200,receipt)
        try await until{!model.mutationBusy}
        try check(model.invoicePresentation==nil && model.state=="loading","closed preview late valid receipt cannot open or rewrite state")

        model.pay(original);let oldAccount=await inbox.take()
        requiredRestoreRead=inbox.orderReads+1;initialRestoreFinished=false
        authority.current=session(b);api.onSessionChanged?()
        try await until{initialRestoreFinished}
        model.pay(try order(b,"second"));let newAccount=await inbox.take()
        model.state="loading";oldAccount.respond(500)
        // Wait for an actor turn after URLSession processes the old response.
        for _ in 0..<500{await Task.yield()}
        try check(model.mutationBusy && model.state=="loading","old account response/finally cannot release new account operation")
        newAccount.respond(500);try await until{!model.mutationBusy}
        try check(model.state=="unavailable" && authority.current?.account==b,"new account current failure owns its presentation")
        model.pay(try order(b,"second"));let denied=await inbox.take();denied.respond(401)
        try await until{!model.signedIn && !model.mutationBusy}
        try check(authority.current==nil,"authoritative 401 still clears current account")
        try check((try queue.dispatchPhase(unknown))=="unknown" && authority.walletOpenings==0 && inbox.reads==7,"only seven existing-invoice reads, no order/create/payment/opening; old UNKNOWN retained")
        http.invalidateAndCancel()
        print("9 actual Model/API preview checks PASS; all HTTP/authority controlled, no external business or funds")
    }
}
