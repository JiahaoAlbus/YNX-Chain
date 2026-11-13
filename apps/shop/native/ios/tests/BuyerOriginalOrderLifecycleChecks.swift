import Foundation

// Actual Shop Model/API and normal Main consumer, driven by controlled HTTP and
// authenticated-port fixtures. This does not execute Main approval or funds.
@MainActor final class BuyerLifecycleAuthority:AppleNativeAuthority {
    var current:ShopSession?
    func restore()async throws{}
    func connect()async throws{throw ShopError.unavailable}
    func handleReturn(_ url:URL)async throws{throw ShopError.security}
    func disconnect()throws{current=nil}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any] {
        guard current==expected else{throw ShopError.contextChanged}
        return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]
    }
}

final class BuyerLifecycleHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((BuyerLifecycleHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func body()->[String:Any] {
        var bytes=request.httpBody ?? Data()
        if bytes.isEmpty,let stream=request.httpBodyStream {
            stream.open();defer{stream.close()}
            var buffer=[UInt8](repeating:0,count:4096)
            while stream.hasBytesAvailable {let size=stream.read(&buffer,maxLength:buffer.count);if size<=0{break};bytes.append(buffer,count:size)}
        }
        return (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:]
    }
    func respond(_ object:Any,status:Int=200) {
        let data=try! CanonicalJSON.data(object)
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
    }
    func loseResponse(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
}

@MainActor final class BuyerLifecycleFixture {
    static let account="ynx1"+String(repeating:"q",count:38)
    static let other="ynx1"+String(repeating:"p",count:38)
    let authority=BuyerLifecycleAuthority()
    let original:[String:Any]
    var visible:[String:Any]
    let orderID:String,operation:String,storeID:String
    var storage:[String:Data]=[:]
    var calls:[String]=[],bodies:[[String:Any]]=[]
    var mainCalls:[[String:String]]=[]
    var mainRefusal:String?
    var mainReturned=false
    var queryAfterMain=0
    var holdConfirm=false
    var heldConfirm:[BuyerLifecycleHTTP]=[]
    var failTransition=false
    var foreignTransitionLookup=false
    var lastTransition:[String:Any]?
    var created=false
    var invoiceCreateResponseLost=false
    var nativeLookupUnavailable=false
    var reconcileReplyLost=false
    var confirmFails=false
    var orderReadFails=false
    var adoptArchiveOnConfirm=false
    lazy var queue=OfflineQueue(read:{self.storage["queue"]},write:{self.storage["queue"]=$0},readPhase:{self.storage["queue-phase"]},writePhase:{self.storage["queue-phase"]=$0})
    lazy var journey=AppleBuyerJourney(read:{self.storage[$0]},write:{self.storage[$0]=$1})
    lazy var journal=NativeInvoicePreparationJournal(read:{self.storage[$0]},write:{self.storage[$0]=$1})
    lazy var navigation=AppleOriginalMainPayNavigation(current:{guard let session=self.authority.current else{throw ShopError.signedOut};return session},status:{_ in
        if let code=self.mainRefusal{return ["ok":false,"error":["code":code]]}
        return ["ok":true,"value":["normalMainEntry":true,"available":false,"canRequest":true,"paymentAuthorized":false]]
    },invoke:{input,expectedOperation,_ in
        guard expectedOperation==self.operation else{throw ShopError.security}
        self.mainCalls.append(input);self.mainReturned=true
        if input["action"]=="order-reconcile-operation" {
            if self.reconcileReplyLost{throw OriginalMainPayRefusal(code:"NATIVE_PAY_ORIGINAL_RESPONSE_UNAVAILABLE")}
            let rows=(self.original["NativePayment"] as! [String:Any])["Receipts"] as! [[String:Any]],receipt=rows.first{$0["nativeHash"] as? String==input["nativeHash"]}!
            let operation:[String:Any]=["merchant":receipt["merchant"]!,"invoiceId":receipt["invoiceId"]!,"nativeHash":receipt["nativeHash"]!,"abciHash":receipt["abciHash"]!,"kind":receipt["kind"]!,"owner":receipt["merchant"]!,"status":"confirmed"]
            return ["ok":true,"value":["reference":["productId":"shop.order","sourceOrder":self.orderID,"intentId":self.operation,"merchant":receipt["merchant"]!,"invoiceId":receipt["invoiceId"]!,"nativeHash":receipt["nativeHash"]!],"clientIndependentFinality":false,"queryOnly":true,"approvalRequired":false,"canRetry":false,"reconciledOriginal":operation,"operations":[operation],"bill":["sourceOrder":self.orderID,"merchant":receipt["merchant"]!,"invoiceId":receipt["invoiceId"]!]]]
        }
        if input["action"]=="order-pay-review" {
            return ["ok":true,"value":["reference":["productId":"shop.order","sourceOrder":self.orderID,"intentId":self.operation,"merchant":self.original["PayMerchant"]!,"invoiceId":self.original["InvoiceID"]!],"clientIndependentFinality":false,"queryOnly":false,"approvalRequired":true,"canRetry":false,"walletRequest":["id":"original-main-controlled-review","method":"ynx_signPQNativeAction","approvalRequired":true]]]
        }
        return ["ok":true,"value":["reference":["productId":"shop.order","sourceOrder":self.orderID,"intentId":self.operation,"merchant":self.original["PayMerchant"]!,"invoiceId":self.original["InvoiceID"]!],"intent":["intentId":self.operation,"originalOperation":self.operation,"state":"PREPARED"],"clientIndependentFinality":false,"queryOnly":true,"approvalRequired":false,"canRetry":false]]
    })
    lazy var http:URLSession={let cfg=URLSessionConfiguration.ephemeral;cfg.protocolClasses=[BuyerLifecycleHTTP.self];return URLSession(configuration:cfg)}()
    lazy var api=APIClient(session:http,authority:authority,nativePayNavigation:navigation)
    lazy var model=ShopModel(api:api,queue:queue,invoiceHandoffs:InvoiceHandoffJournal(read:{self.storage[$0]},write:{self.storage[$0]=$1}),journey:journey,nativeInvoices:journal,comparisonJournal:ShopComparisonJournal(read:{self.storage[$0]},write:{self.storage[$0]=$1}),localDataInitiallyLocked:false)
    init()throws {
        let path=ProcessInfo.processInfo.environment["YNX_SHOP_REFUNDED_FIXTURE"] ?? "apps/shop/native/testdata/native-refunded-order.json"
        original=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:path))) as! [String:Any]
        orderID=original["ID"] as! String;operation=original["PayIntentID"] as! String;storeID=original["StoreID"] as! String
        visible=["ID":orderID,"Buyer":original["Buyer"]!,"WalletBuyer":Self.account,"StoreID":storeID,"Status":"payment_pending","TotalYNXT":original["TotalYNXT"]!,"Currency":"YNXT","CartConsumption":["PreviousRevision":"cart-original","Revision":"cart-consumed"]]
        authority.current=Self.session(Self.account)
    }
    static func session(_ account:String,generation:Int=1)->ShopSession {ShopSession(account:account,token:String(repeating:"t",count:43),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:generation)}
    func order()throws->Order{try AppleBuyerReceipt.decode(visible,account:authority.current!.account)}
    func observation()->[String:Any]{["orderId":orderID,"originalOperation":operation,"state":"PREPARED","phase":"awaiting_merchant_approval","queryOnly":true,"fundsVerified":false]}
    func receive(_ request:BuyerLifecycleHTTP) {
        let path=request.request.url!.path,method=request.request.httpMethod ?? "GET",body=request.body()
        calls.append(method+" "+path);bodies.append(body)
        if path=="/api/products"{request.respond(["products":[listing()]]);return}
        if path=="/api/products/product-original"{request.respond(listing());return}
        if path=="/api/orders",method=="GET"{if orderReadFails{request.respond(["error":"controlled read unavailable"],status:503)}else{request.respond(["orders":created ? [visible]:[]])};return}
        if path=="/api/orders",method=="POST"{created=true;request.respond(visible);return}
        if path=="/api/orders/\(orderID)"{request.respond(visible);return}
        if path=="/api/orders/\(orderID)/native-pay-intent",method=="POST" {
            visible["PayIntentID"]=operation;visible["InvoiceID"]=original["InvoiceID"]
            if invoiceCreateResponseLost{request.loseResponse()}else{request.respond(observation())};return
        }
        if path=="/api/orders/\(orderID)/native-pay-intent-lookup" || (path=="/api/orders/\(orderID)/native-pay-intent" && method=="GET") {
            if mainReturned{queryAfterMain+=1}
            if nativeLookupUnavailable{request.respond(["error":"original result is not yet available"],status:404)}else{request.respond(observation())};return
        }
        if path.hasSuffix("/confirm-payment") {if confirmFails{request.respond(["error":"controlled original archive unavailable"],status:503);return};if adoptArchiveOnConfirm{visible=original;visible["WalletBuyer"]=Self.account};if holdConfirm{heldConfirm.append(request)}else{request.respond(["untrustedTransportOnly":true])};return}
        if path=="/api/orders/\(orderID)/transition" {
            lastTransition=body
            if let action=body["Action"] as? String{visible["Status"]=action}
            if failTransition{request.loseResponse()}else{request.respond(visible)};return
        }
        if path=="/api/orders/\(orderID)/transition-intent-lookup",let saved=lastTransition {
            request.respond(["Actor":foreignTransitionLookup ? Self.other:Self.account,"OrderID":orderID,"Action":saved["Action"]!,"IdempotencyKey":saved["IdempotencyKey"]!,"Order":visible]);return
        }
        request.respond(["error":"unconfigured controlled route"],status:404)
    }
    func listing()->[String:Any]{["ID":"product-original","StoreID":storeID,"Title":"Original listed item","Variants":[["ID":"variant-original","Name":"Original variant","PriceYNXT":25,"Inventory":5,"Reserved":0]]]}
    func start()async throws {
        BuyerLifecycleHTTP.handler={self.receive($0)}
        _ = model
        try await BuyerOriginalOrderLifecycleChecks.until{self.model.signedIn && self.calls.contains("GET /api/orders") && !self.model.products.isEmpty && !self.model.mutationBusy}
    }
    func checkout()async throws {
        let item=CartItem(productID:"product-original",variantID:"variant-original",quantity:1)
        try journey.reconcileCart(["Buyer":Self.account,"Revision":"cart-original","Items":[["ProductID":item.productID,"VariantID":item.variantID,"Quantity":1]]],account:Self.account)
        model.cart=[item]
        model.checkout(recipient:"Controlled buyer",address:"Controlled address",city:"Test",country:"QA")
        try await BuyerOriginalOrderLifecycleChecks.until{!self.model.mutationBusy && self.model.checkoutResult != nil}
    }
    func restoreArchivedPayment(status:String)throws {
        // Select the original recorded settlement event as the historical paid
        // prefix; no receipt field, hash, Source flag or amount is fabricated.
        var raw=original,payment=original["NativePayment"] as! [String:Any]
        let receipts=payment["Receipts"] as! [[String:Any]]
        let settlement=receipts.first{$0["kind"] as? String=="invoice_settle" && $0["status"] as? String=="confirmed"}!
        payment["Receipts"]=[settlement];payment["RefundedAtoms"]="0";payment["NetPaidAtoms"]=payment["PaidAtoms"]
        raw["NativePayment"]=payment;raw["Status"]=status;raw["RefundStatus"]="not_requested";raw["WalletBuyer"]=Self.account
        _ = try AppleBuyerReceipt.decode(raw,account:Self.account);visible=raw
    }
    func finish(){model.signOut();http.invalidateAndCancel()}
}

@main struct BuyerOriginalOrderLifecycleChecks {
    @MainActor static func check(_ yes:Bool,_ label:String)throws {guard yes else{throw NSError(domain:label,code:1)};print("PASS "+label)}
    @MainActor static func until(_ predicate:()->Bool)async throws {
        let end=ContinuousClock.now.advanced(by:.seconds(4))
        while ContinuousClock.now<end {if predicate(){return};try await Task.sleep(for:.milliseconds(2))}
        throw NSError(domain:"controlled original-order operation did not finish",code:1)
    }
    @MainActor static func mainReturn()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        try check(f.model.cart.isEmpty && f.calls.filter{$0=="POST /api/orders"}.count==1,"normal catalog checkout consumes original cart into one order")
        let order=try f.order();f.model.pay(order)
        try await until{!f.model.mutationBusy && f.mainReturned}
        try check(f.queryAfterMain==1,"Main return queries the same original intent while its operation still owns the busy lock")
        try check(f.mainCalls==[["action":"order-invoice","productId":"shop.order","sourceOrder":f.orderID]],"actual normal Main consumer receives only original order selector")
        let reference=try f.journal.records(BuyerLifecycleFixture.account)[f.orderID]
        try check(reference?.originalOperation==f.operation && reference?.phase=="reference" && f.model.orders.first?.status=="payment_pending","Main data-only return retains original reference and cannot mark funds paid")
    }
    @MainActor static func exclusivePaymentCheck()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        f.holdConfirm=true;let order=try f.order();f.model.checkPayment(order)
        try check(f.model.mutationBusy,"payment query owns busy state before its task can dispatch")
        f.model.checkPayment(order);f.model.pay(order)
        try await until{f.heldConfirm.count==1}
        for _ in 0..<100{await Task.yield()}
        try check(f.calls.filter{$0.hasSuffix("/confirm-payment")}.count==1 && f.mainCalls.isEmpty && !f.calls.contains("POST /api/orders/\(f.orderID)/native-pay-intent"),"duplicate payment query and invoice preparation cannot overlap")
        f.heldConfirm.removeFirst().respond(["ignored":true]);try await until{!f.model.mutationBusy}
        try check(f.model.orders.first?.status=="payment_pending","confirmation transport response does not invent settlement")
    }
    @MainActor static func stalePaymentCheck()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        f.holdConfirm=true;f.model.checkPayment(try f.order());try await until{f.heldConfirm.count==1}
        let old=f.heldConfirm.removeFirst()
        f.authority.current=BuyerLifecycleFixture.session(BuyerLifecycleFixture.other,generation:2)
        f.visible=["ID":"order-other","Buyer":BuyerLifecycleFixture.other,"StoreID":f.storeID,"Status":"payment_pending","TotalYNXT":25,"Currency":"YNXT"]
        f.api.onSessionChanged?();try await until{f.model.orders.first?.buyer==BuyerLifecycleFixture.other && !f.model.mutationBusy}
        f.model.checkPayment(try f.order());try await until{f.heldConfirm.count==1}
        f.model.state="profile_saved";old.respond(["error":"old transport failed"],status:500)
        for _ in 0..<100{await Task.yield()}
        try check(f.model.mutationBusy && f.model.state=="profile_saved" && f.model.orders.first?.buyer==BuyerLifecycleFixture.other,"old-account payment failure cannot release or overwrite the new-account operation")
        f.heldConfirm.removeFirst().respond([:]);try await until{!f.model.mutationBusy}
    }
    @MainActor static func scheduledPaymentCheck()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        f.model.checkPayment(try f.order())
        // Replace authority before the newly scheduled Task gets an actor turn.
        // The click must remain bound to the original entry context.
        f.authority.current=BuyerLifecycleFixture.session(BuyerLifecycleFixture.other,generation:2)
        f.visible=["ID":"order-other","Buyer":BuyerLifecycleFixture.other,"StoreID":f.storeID,"Status":"payment_pending","TotalYNXT":25,"Currency":"YNXT"]
        f.api.onSessionChanged?();f.model.state="profile_saved"
        try await until{f.model.orders.first?.buyer==BuyerLifecycleFixture.other && !f.model.mutationBusy}
        try check(!f.calls.contains(where:{$0.hasSuffix("/confirm-payment")}) && f.model.state=="profile_saved","scheduled old-account payment query neither dispatches with replacement authority nor rewrites its state")
    }
#if !LIFECYCLE_BASELINE
    @MainActor static func refusalAndUnknownRecovery()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        f.mainRefusal="AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED";let order=try f.order();f.model.pay(order)
        try await until{!f.model.mutationBusy && (try? f.journal.records(BuyerLifecycleFixture.account)[f.orderID]?.phase)=="reference"}
        let first=try f.journal.records(BuyerLifecycleFixture.account)[f.orderID]!
        try check(f.mainCalls.isEmpty && first.originalOperation==f.operation && f.model.orders.first?.status=="payment_pending" && f.model.orders.first?.payIntentID==f.operation,"protected Main refusal preserves the original key and unpaid order")
        f.model.beginOrderAction(order,"cancelled",title:"Cancel order")
        try check(!f.model.canCancelOrder(order) && f.model.orderActionPresentation==nil && !f.calls.contains("POST /api/orders/\(f.orderID)/transition"),"an original native binding blocks cancellation even through a stale unbound order snapshot")
        let creates=f.calls.filter{$0=="POST /api/orders/\(f.orderID)/native-pay-intent"}.count
        f.model.recoverOrder(order);try await until{!f.model.mutationBusy}
        try check(try f.journal.records(BuyerLifecycleFixture.account)[f.orderID]==first && f.calls.filter{$0=="POST /api/orders/\(f.orderID)/native-pay-intent"}.count==creates && f.mainCalls.isEmpty,"explicit original recovery queries without reopening Main or recreating an invoice")
        f.mainRefusal="USER_REJECTED_REQUEST";f.model.reviewPayment(f.model.orders[0]);try await until{!f.model.mutationBusy}
        try check(f.model.state=="native_main_rejected" && f.mainCalls.isEmpty,"Main's explicit rejection remains distinct from transport unavailability")
        f.mainRefusal="USER_CANCELLED";f.model.pay(order);try await until{!f.model.mutationBusy}
        try check(try f.journal.records(BuyerLifecycleFixture.account)[f.orderID]==first && f.mainCalls.isEmpty && f.model.orders.first?.status=="payment_pending" && f.model.state=="native_main_cancelled","Main cancellation cannot rotate the original key or pretend payment succeeded")
        f.mainRefusal=nil;f.model.reviewPayment(f.model.orders[0]);try await until{!f.model.mutationBusy}
        try check(f.model.state=="native_main_review_pending" && f.mainCalls==[["action":"order-pay-review","productId":"shop.order","sourceOrder":f.orderID]] && f.model.orders.first?.status=="payment_pending","normal Main review admission remains pending approval on the same original order")
        try check(!f.calls.contains(where:{$0.hasSuffix("/confirm-payment")}) && f.calls.filter{$0=="POST /api/orders/\(f.orderID)/native-pay-intent"}.count==creates,"review admission does not trigger funds confirmation or another invoice creation")

        let g=try BuyerLifecycleFixture();defer{g.finish()};try await g.start();try await g.checkout()
        g.invoiceCreateResponseLost=true;let pending=try g.order();g.model.pay(pending);try await until{!g.model.mutationBusy}
        let unknown=try g.journal.records(BuyerLifecycleFixture.account)[g.orderID]!
        try check(unknown.phase=="unknown" && g.model.orderRecoveryState(pending)=="unknown" && !g.model.canRetryPreparedOrder(pending),"lost create response persists discoverable original UNKNOWN without a prepared resend affordance")
        g.nativeLookupUnavailable=true;g.model.recoverOrder(pending);try await until{!g.model.mutationBusy}
        try check(try g.journal.records(BuyerLifecycleFixture.account)[g.orderID]==unknown && g.model.orderRecoveryState(pending)=="unknown","missing original lookup remains UNKNOWN without rotating the key")
        g.nativeLookupUnavailable=false
        g.model.recoverOrder(pending);try await until{!g.model.mutationBusy}
        try check(try g.journal.records(BuyerLifecycleFixture.account)[g.orderID]?.key==unknown.key && g.calls.filter{$0=="POST /api/orders/\(g.orderID)/native-pay-intent"}.count==1 && g.mainCalls.isEmpty,"unknown original intent is recovered by lookup alone")
    }
    @MainActor static func fulfillmentAndRefundRecovery()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        try f.restoreArchivedPayment(status:"shipped");await f.model.loadOrders()
        try check(f.model.orders.first?.status=="shipped" && f.model.orders.first?.nativePayment?.PaidAtoms=="100","original archived settlement is required before fulfillment is shown")
        f.model.beginOrderAction(f.model.orders[0],"delivered",title:"Confirm delivery")
        let delivery=f.model.orderActionPresentation!
        try check(f.model.submitOrderAction(delivery,rating:0,reason:"",detail:""),"normal buyer delivery confirmation admits one original transition")
        try await until{!f.model.mutationBusy}
        try check(f.model.orders.first?.status=="delivered","normal readback observes the delivered original order")
        f.model.beginOrderAction(f.model.orders[0],"return_requested",title:"Request return")
        let returning=f.model.orderActionPresentation!
        try check(f.model.submitOrderAction(returning,rating:0,reason:"Item damaged",detail:"Original package damage"),"buyer explicitly provides the original return reason")
        try await until{!f.model.mutationBusy}
        try f.restoreArchivedPayment(status:"return_approved");await f.model.loadOrders()
        f.failTransition=true;f.model.beginOrderAction(f.model.orders[0],"refund_requested",title:"Request refund")
        try check(f.model.submitOrderAction(f.model.orderActionPresentation!,rating:0,reason:"Approved return",detail:"Please review the original return"),"buyer requests review without approving or sending a refund")
        try await until{!f.model.mutationBusy}
        let pending=try f.queue.load(account:BuyerLifecycleFixture.account).first!
        let posts=f.calls.filter{$0=="POST /api/orders/\(f.orderID)/transition"}.count
        try check(try f.queue.dispatchPhase(pending)=="unknown","lost refund-request response preserves its exact original envelope")
        f.foreignTransitionLookup=true;f.model.recoverOrder(try f.order());try await until{!f.model.mutationBusy}
        try check(try f.queue.load(account:BuyerLifecycleFixture.account).contains(pending),"foreign-actor lookup cannot consume the original unknown transition")
        f.foreignTransitionLookup=false;f.model.recoverOrder(try f.order());try await until{!f.model.mutationBusy}
        try check(try f.queue.load(account:BuyerLifecycleFixture.account).isEmpty && f.calls.filter{$0=="POST /api/orders/\(f.orderID)/transition"}.count==posts,"same-order refund request recovery consumes matching receipt without mutation replay")
        f.visible=f.original;f.visible["WalletBuyer"]=BuyerLifecycleFixture.account;await f.model.loadOrders()
        try check(f.model.orders.first?.status=="refunded" && f.model.orders.first?.nativePayment?.NetPaidAtoms=="0" && f.model.orders.first?.nativePayment?.RefundedAtoms=="100","unchanged original full-refund archive is shown through normal order readback")
    }
    @MainActor static func explicitOriginalReconciliation()async throws {
        for (loseReply,archiveReady) in [(false,true),(true,true),(true,false)]{
            let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
            try f.restoreArchivedPayment(status:"refund_requested")
            let rows=(f.original["NativePayment"] as! [String:Any])["Receipts"] as! [[String:Any]],hash=rows.first{$0["kind"] as? String=="invoice_refund"}!["nativeHash"] as! String
            var payment=f.visible["NativePayment"] as! [String:Any];payment["PendingOriginals"]=[hash];payment["CompleteKnownOriginals"]=false;f.visible["NativePayment"]=payment
            await f.model.loadOrders();let pending=try f.order()
            f.model.checkPayment(pending);try await until{!f.model.mutationBusy}
            try check(f.mainCalls.isEmpty && f.model.orders[0].nativePayment?.PendingOriginals==[hash],"ordinary payment query never invokes original-operation reconciliation")
            f.model.reconcilePayment(pending,nativeHash:"0x"+String(repeating:"f",count:64))
            try check(f.mainCalls.isEmpty && !f.model.mutationBusy,"reconciliation cannot select a hash absent from actual pending originals")
            f.holdConfirm=true;f.reconcileReplyLost=loseReply
            f.model.reconcilePayment(pending,nativeHash:hash);try await until{f.heldConfirm.count==1}
            try check(f.mainCalls==[["action":"order-reconcile-operation","productId":"shop.order","sourceOrder":f.orderID,"nativeHash":hash]],"explicit reconciliation sends only the retained original hash and original order")
            try check(f.model.orders[0].nativePayment?.RefundedAtoms=="0" && f.model.mutationBusy,"Main reconciliation result cannot update money before independent Shop archive read")
            if archiveReady{f.visible=f.original;f.visible["WalletBuyer"]=BuyerLifecycleFixture.account}
            f.heldConfirm.removeFirst().respond(["transportOnly":true]);try await until{!f.model.mutationBusy}
            try check(f.model.orders[0].nativePayment?.RefundedAtoms==(archiveReady ? "100":"0") && f.mainCalls.count==1,"original archive alone adopts recorded refund; lost Main reply never re-invokes or resends")
            f.model.reconcilePayment(pending,nativeHash:hash);try await until{!f.model.mutationBusy}
            try check(!f.model.canReconcilePayment(pending,nativeHash:hash) && f.mainCalls.count==1,"a lost or finished reconciliation offers queries rather than another same-hash invocation in this context")
            var expectedInvokes=1
            if !archiveReady{
                f.holdConfirm=false;f.confirmFails=true
                f.model.checkPayment(pending);try await until{!f.model.mutationBusy}
                try check(!f.model.canReconcilePayment(pending,nativeHash:hash) && f.mainCalls.count==1,"failed original archive query never enables same-hash reconciliation")
                f.confirmFails=false;f.orderReadFails=true
                f.model.checkPayment(pending);try await until{!f.model.mutationBusy}
                try check(!f.model.canReconcilePayment(pending,nativeHash:hash),"a failed fresh order read cannot reuse a stale successful query")
                f.orderReadFails=false
                let knownPending=f.visible
                f.visible["PayIntentID"]="npi_"+String(repeating:"f",count:48);await f.model.loadOrders()
                f.model.checkPayment(f.model.orders[0]);try await until{!f.model.mutationBusy}
                try check(!f.model.canReconcilePayment(f.model.orders[0],nativeHash:hash),"a consistently rebound read cannot unlock a hash captured under another original intent")
                f.visible=knownPending
                f.model.checkPayment(pending);try await until{!f.model.mutationBusy}
                try check(f.model.canReconcilePayment(pending,nativeHash:hash) && f.mainCalls.count==1,"fresh independent original archive and same bound pending hash enable only a new explicit decision")
                f.reconcileReplyLost=false;f.adoptArchiveOnConfirm=true
                f.model.reconcilePayment(pending,nativeHash:hash);try await until{!f.model.mutationBusy}
                expectedInvokes=2
                try check(f.mainCalls.count==2 && f.mainCalls[0]==f.mainCalls[1] && f.model.orders[0].nativePayment?.RefundedAtoms=="100","second user decision reconciles exactly the same hash then independently adopts its original archive")
            }
            f.model.sceneActive();try await Task.sleep(for:.milliseconds(10))
            try check(f.mainCalls.count==expectedInvokes && !f.calls.contains(where:{$0.hasSuffix("/transition") || $0.hasSuffix("/native-pay-intent") && $0.hasPrefix("POST")}),"cold/foreground recovery does not reconcile, recreate or send the original")
        }
    }
    @MainActor static func preparedActionIsExplicitAndTargeted()async throws {
        let f=try BuyerLifecycleFixture();defer{f.finish()};try await f.start();try await f.checkout()
        var remoteFence=try f.order();remoteFence.localCancellationBlocked=true;f.model.beginOrderAction(remoteFence,"cancelled",title:"Cancel")
        try check(!f.model.canCancelOrder(remoteFence) && f.model.orderActionPresentation==nil,"normal server cancellation fence protects a device without the original local invoice journal")
        let input=try BuyerOrderActionInput.build(status:"payment_pending",action:"cancelled",rating:0,reason:"",detail:"")
        let target=try f.queue.prepareUnsent(account:BuyerLifecycleFixture.account,path:"orders/\(f.orderID)/transition",input:input)
        let unrelated=try f.queue.prepareUnsent(account:BuyerLifecycleFixture.account,path:"orders/another-original-order/transition",input:input)
        await f.model.loadOrders()
        try check(f.model.orderRecoveryState(try f.order())=="prepared" && f.model.canRetryPreparedOrder(try f.order()),"unsent original action is distinguishable from dispatched UNKNOWN and offers explicit retry")
        f.model.recoverOrder(try f.order());try await until{!f.model.mutationBusy}
        try check(try f.queue.dispatchPhase(target)=="prepared" && !f.calls.contains("POST /api/orders/\(f.orderID)/transition"),"targeted recovery never dispatches an unsent prepared buyer action")
        f.model.retryPreparedOrder(try f.order());try await until{!f.model.mutationBusy}
        let originalBody=try JSONSerialization.jsonObject(with:target.body) as! [String:Any]
        try check(try CanonicalJSON.data(f.lastTransition!)==CanonicalJSON.data(originalBody),"explicit prepared retry preserves exact original body and idempotency key")
        try check(try f.queue.load(account:BuyerLifecycleFixture.account)==[unrelated] && f.queue.dispatchPhase(unrelated)=="prepared" && f.model.orders.first?.status=="cancelled","targeted explicit retry preserves every unrelated queued action")
        f.model.retryPreparedOrder(try f.order());try await until{!f.model.mutationBusy}
        try check(f.calls.filter{$0=="POST /api/orders/\(f.orderID)/transition"}.count==1,"confirmed prepared action cannot be dispatched again")
    }
#endif
    @MainActor static func main()async throws {
        let selected=CommandLine.arguments.dropFirst().first ?? "all"
        guard ["all","main","busy","session","scheduled","recovery","fulfillment","prepared","reconcile"].contains(selected) else{throw NSError(domain:"unknown lifecycle scenario",code:1)}
        if selected=="all" || selected=="main"{try await mainReturn()}
        if selected=="all" || selected=="busy"{try await exclusivePaymentCheck()}
        if selected=="all" || selected=="session"{try await stalePaymentCheck()}
        if selected=="all" || selected=="scheduled"{try await scheduledPaymentCheck()}
#if !LIFECYCLE_BASELINE
        if selected=="all" || selected=="recovery"{try await refusalAndUnknownRecovery()}
        if selected=="all" || selected=="fulfillment"{try await fulfillmentAndRefundRecovery()}
        if selected=="all" || selected=="prepared"{try await preparedActionIsExplicitAndTargeted()}
        if selected=="all" || selected=="reconcile"{try await explicitOriginalReconciliation()}
#endif
        print("PASS actual Buyer Model/API/normal Main consumer controlled lifecycle; real Main approval, Source and funds NOT_VERIFIED")
    }
}
