import Foundation

@MainActor final class FulfillmentAuthority:AppleNativeAuthority {
    var current:ShopSession?
    let account="ynx1"+String(repeating:"q",count:38)
    var proofFails=false
    func restore()async throws{}
    func connect()async throws{current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func disconnect()throws{current=nil}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard !proofFails,current==expected else{throw ShopError.security};_ = try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller);return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class FulfillmentHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((FulfillmentHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ value:Any,status:Int=200)throws{let data=try JSONSerialization.data(withJSONObject:value);client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)}
    func lose(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
    func body()throws->Data{if let value=request.httpBody{return value};guard let stream=request.httpBodyStream else{return Data()};stream.open();defer{stream.close()};var result=Data(),buffer=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&buffer,maxLength:buffer.count);guard n>=0 else{throw ShopError.invalidResponse};if n==0{break};result.append(contentsOf:buffer.prefix(n))};return result}
}
@main struct SellerFulfillmentChecks {
    @MainActor static func main()async throws {
        var checks=0
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func until(_ predicate:()->Bool)async throws{for _ in 0..<200_000{if predicate(){return};await Task.yield()};throw NSError(domain:"bounded fulfillment async condition",code:1)}
        let authority=FulfillmentAuthority(),store="store_original",now="2026-11-08T12:00:00Z"
        let account=authority.account,buyer="ynx1"+String(repeating:"p",count:38)
        func event(_ id:String,_ status:String,_ action:String="order_transition")->[String:Any]{["ID":id,"Actor":account,"Role":"seller","Action":action,"Status":status,"Detail":"","At":now]}
        func makeOrder(_ id:String)->[String:Any]{[
            "ID":id,"Buyer":buyer,"StoreID":store,"Status":"return_approved","Currency":"YNXT","InvoiceID":"invoice_"+id,"PayIntentID":"intent_"+id,"PayMerchant":"merchant_original","PayPayoutAddress":account,
            "SubtotalYNXT":20,"ShippingYNXT":0,"TaxYNXT":0,"TotalYNXT":20,"TaxStatus":"unavailable","LogisticsStatus":"manual","RefundStatus":"unavailable","TrustStatus":"unavailable",
            "Lines":[["ProductID":"product_original","VariantID":"variant_original","Title":"Original goods","VariantName":"Original","Quantity":2,"UnitPriceYNXT":10]],
            "Address":["Recipient":"Buyer","Line1":"Private address","City":"C","Region":"","PostalCode":"","Country":"QA"],
            "Shipment":["Carrier":"Original carrier","TrackingNumber":"Original tracking","Status":"manual","UpdatedAt":now],
            "Resolution":["Kind":"return","Status":"approved","Reason":"Original request","Explanation":""],
            "Settlement":["InvoiceID":"invoice_"+id,"IntentID":"intent_"+id,"Merchant":"merchant_original","PayoutAddress":account,"TransactionHash":"0x"+String(repeating:"a",count:64),"Status":"paid","Payer":buyer,"Currency":"YNXT","AuditHash":String(repeating:"b",count:64),"AmountYNXT":20,"BlockHeight":10,"ConfirmedAt":now],
            "Timeline":[event("return_"+id,"return_requested"),event("approval_"+id,"return_approved")],"ReturnReceipts":[]
        ]}
        func decode(_ raw:[String:Any])throws->SellerOrder{try JSONDecoder().decode(SellerOrder.self,from:CanonicalJSON.data(raw))}
        func received(_ raw:[String:Any],_ id:String,_ count:String="1",_ restocked:Bool=false)->[String:Any]{
            var value=raw;var receipts=value["ReturnReceipts"] as! [[String:Any]]
            var receipt:[String:Any]=["ID":id,"ReturnID":"return_"+(value["ID"] as! String),"ReceivedBy":account,"EvidenceReference":"evidence_"+id,"RequestHash":String(repeating:"c",count:64),"Items":[["ProductID":"product_original","VariantID":"variant_original","Quantity":count]],"ReceivedAt":now]
            if restocked{receipt["RestockedBy"]=account;receipt["RestockedAt"]=now}
            receipts.append(receipt);value["ReturnReceipts"]=receipts
            var timeline=value["Timeline"] as! [[String:Any]];timeline.append(event("received_"+id,"return_approved","return_received"));value["Timeline"]=timeline;return value
        }
        var first=makeOrder("order_first"),second=makeOrder("order_second"),nativeOrder=makeOrder("order_native_terms")
        nativeOrder["Status"]="payment_pending";nativeOrder["PayIntentID"]="npi_"+String(repeating:"d",count:48);nativeOrder["PayMerchant"]="0x"+String(repeating:"e",count:40);nativeOrder["PayPayoutAddress"]="0x"+String(repeating:"f",count:40);nativeOrder["Settlement"]=nil
        let original=try decode(first)
        try check(original.approvedReturnIDs==["return_order_first"] && original.remainingReturnItems?.first?.Quantity=="2" && original.hasOriginalPaidRecord,"original approved sale exposes bounded warehouse quantities")
        var projection=received(first,"receipt_projection")
        try check(try decode(projection).remainingReturnItems?.first?.Quantity=="1" && decode(projection).originalReturnID=="return_order_first","warehouse events retain the original return and reduce only received goods")
        var receipts=projection["ReturnReceipts"] as! [[String:Any]];receipts[0]["Items"]=[["ProductID":"product_original","VariantID":"variant_original","Quantity":"3"]];projection["ReturnReceipts"]=receipts
        try check(try decode(projection).remainingReturnItems==nil,"over-received persisted goods cannot expose a new warehouse action")
        projection=received(first,"receipt_projection","01")
        try check(try decode(projection).remainingReturnItems==nil,"warehouse quantities reject noncanonical integer strings")
        projection=first;projection["Settlement"]=nil
        try check(try !decode(projection).hasOriginalPaidRecord,"status alone does not establish original fulfillment settlement")

        for file in ["native-paid-order.json","native-refunded-order.json"] {
            let base=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:ProcessInfo.processInfo.environment["YNX_SHOP_NATIVE_RECEIPT_FIXTURE"] ?? "apps/shop/native/testdata/native-paid-order.json").deletingLastPathComponent().appendingPathComponent(file))) as! [String:Any]
            var native=makeOrder("native_warehouse");native.merge(base){_,new in new}
            let sale=try decode(native)
            try check(sale.hasOriginalPaidRecord,"accepted native original permits warehouse facts even after full refund "+file)
            var payment=native["NativePayment"] as! [String:Any];payment["ReconciliationRequired"]=true;native["NativePayment"]=payment
            try check(try !decode(native).hasOriginalPaidRecord,"native unresolved reconciliation blocks new warehouse effects "+file)
        }

        var storage=["original-Pay-UNKNOWN":Data("preserve original financial operation".utf8)],allowWrite=true
        let sentinel=storage["original-Pay-UNKNOWN"]
        let journal=SellerMutationJournal(read:{storage[$0]},write:{guard allowWrite else{throw ShopError.security};storage[$0]=$1})
        var pending:[FulfillmentHTTP]=[],sent:[String]=[],permissions=["seller.read","fulfillment.write","inventory.write","returns.resolve","team.read","audit.read","finance.read"]
        FulfillmentHTTP.handler={request in
            let path=request.request.url!.path
            if request.request.httpMethod != "GET"{sent.append(path);pending.append(request);return}
            switch path{
            case "/api/seller/stores":try! request.respond(["stores":[["ID":store,"Owner":account,"Name":"Original store","Description":"","Policy":"Original","TrustURL":"","SettlementAccount":account,"Status":"active"]],"access":[store:["role":"owner","permissions":permissions]]])
            case "/api/seller/products":try! request.respond(["products":[]])
            case "/api/seller/orders":try! request.respond(["orders":[first,second,nativeOrder]])
            case "/api/seller/orders/order_native_terms":sent.append(path);pending.append(request)
            case "/api/seller/stores/"+store+"/roles":try! request.respond(["roles":[account:"owner"],"revocations":[],"invitations":[]])
            case "/api/seller/audit":try! request.respond(["events":[]])
            case "/api/seller/settlements":try! request.respond(["settlements":[]])
            default:preconditionFailure("Unexpected fulfillment route "+path)
            }
        }
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[FulfillmentHTTP.self]
        var reviews:[[String:String]]=[],holdReview=false,reviewContinuation:CheckedContinuation<[String:Any],Never>?
        func reviewReply()->[String:Any]{["ok":true,"value":["clientIndependentFinality":false,"queryOnly":false,"approvalRequired":true,"canRetry":false,"reference":["productId":"shop.order","sourceOrder":"order_native_terms","intentId":nativeOrder["PayIntentID"]!,"merchant":nativeOrder["PayMerchant"]!,"invoiceId":nativeOrder["InvoiceID"]!],"walletRequest":["id":"original-retained-main-review","method":"ynx_signPQNativeAction","approvalRequired":true]]]}
        let navigation=AppleOriginalMainPayNavigation(current:{guard let current=authority.current else{throw ShopError.signedOut};return current},status:{_ in ["ok":true,"value":["normalMainEntry":true,"canRequest":true,"paymentAuthorized":false]]},invoke:{input,expectedOperation,expected in
            guard expectedOperation==nativeOrder["PayIntentID"] as? String else{throw ShopError.security}
            try check(expected==authority.current,"terms review retains exact current Seller session")
            reviews.append(input)
            if holdReview{return await withCheckedContinuation{reviewContinuation=$0}}
            return reviewReply()
        })
        let api=APIClient(session:URLSession(configuration:config),nativePayNavigation:navigation,authorityFactory:{authority})
        let model=ShopSellerModel(api:api,journal:journal,localDraftStore:SellerLocalDraftStore(read:{storage[$0]},write:{storage[$0]=$1}))
        func take(_ path:String)async throws->FulfillmentHTTP{try await until{!pending.isEmpty};let request=pending.removeFirst();try check(request.request.url?.path=="/api/"+path,"original signed Seller route "+path);return request}
        func lookup(_ request:FulfillmentHTTP,_ record:SellerMutationJournal.Record,_ result:[String:Any])throws{let input=try JSONSerialization.jsonObject(with:request.body()) as! [String:Any];try check(input["OriginalBody"] as? String==String(data:record.body,encoding:.utf8),"lookup retains original exact body and key");try request.respond(["Actor":account,"Method":record.method,"Path":record.path,"IdempotencyKey":record.key,"Result":result])}
        model.connect();try await until{model.signedIn && !model.busy && model.orders.count==3}
        let native=model.orders.first(where:{$0.ID=="order_native_terms"})!
        try check(model.canReviewOriginalTerms(native),"finance permission exposes original native terms review")
        let beforeReview=storage
        model.reviewOriginalTerms(native);try await until{!model.busy}
        try check(reviews==[["action":"order-terms-review","productId":"shop.order","sourceOrder":native.ID]] && model.retainedTermsReviews[native.ID]=="original-retained-main-review" && model.state=="native_main_review_pending","normal Seller terms entry reaches existing Main review and retains only pending id")
        try check(storage==beforeReview && model.orders.first(where:{$0.ID==native.ID})?.Status=="payment_pending","terms review cannot confirm payment or mutate Seller journal")
        model.readOriginalOrder(native);let read=try await take("seller/orders/order_native_terms");try check(read.request.httpMethod=="GET","result recovery queries the existing authenticated original order")
        try read.respond(["code":"SELLER_ORIGINAL_AUTHORITY_UNAVAILABLE"],status:503)
        try await until{!model.busy}
        try check(model.state=="seller_order_authority_unavailable" && model.orders.first(where:{$0.ID==native.ID})?.PayIntentID==native.PayIntentID && storage==beforeReview,"normal protected GET reports unavailable seller authority and preserves the original order")
        model.readOriginalOrder(native);let denied=try await take("seller/orders/order_native_terms")
        try denied.respond(["code":"arbitrary"],status:403)
        try await until{!model.busy}
        try check(model.state=="seller_order_access_denied" && model.orders.first(where:{$0.ID==native.ID})?.InvoiceID==native.InvoiceID && storage==beforeReview,"normal protected GET reports seller access denial without changing the original order")
        model.readOriginalOrder(native);let rebound=try await take("seller/orders/order_native_terms")
        var foreign=nativeOrder;foreign["InvoiceID"]="foreign-invoice";try rebound.respond(foreign);try await until{!model.busy}
        try check(model.orders.first(where:{$0.ID==native.ID})?.InvoiceID==native.InvoiceID && model.state=="unavailable","rebound original financial reference cannot replace the current order")
        model.readOriginalOrder(native);let normalRead=try await take("seller/orders/order_native_terms");try normalRead.respond(nativeOrder);try await until{!model.busy}
        try check(model.orders.first(where:{$0.ID==native.ID})?.Status=="payment_pending" && model.state.isEmpty,"independent order read preserves pending money state without inference")
        sent.removeAll()
        let one=SellerReturnItem(ProductID:"product_original",VariantID:"variant_original",Quantity:"1")
        try check(model.canReceiveReturn(model.orders[0]),"normal loaded Seller order permits explicit warehouse receipt")
        model.perform(.receiveReturn(orderID:"order_first",returnID:"return_order_first",evidenceReference:"evidence_receipt_first",items:[SellerReturnItem(ProductID:one.ProductID,VariantID:one.VariantID,Quantity:"3")]))
        try check(sent.isEmpty && !model.busy,"over-receipt is rejected before a durable operation or HTTP")
        allowWrite=false;model.perform(.receiveReturn(orderID:"order_first",returnID:"return_order_first",evidenceReference:"evidence_receipt_first",items:[one]));try check(sent.isEmpty,"failed durable prepare blocks warehouse dispatch");allowWrite=true
        model.perform(.receiveReturn(orderID:"order_first",returnID:"return_order_first",evidenceReference:"evidence_receipt_first",items:[one]))
        let receive=try await take("orders/order_first/return-receipts"),frozen=try receive.body()
        let record=try journal.records(account).values.first(where:{$0.target=="order_first"})!
        try check(record.phase=="unknown" && frozen==record.body,"warehouse original is durable UNKNOWN before dispatch")
        receive.lose();try await until{!model.busy}
        try check(model.pendingOperations(for:"order_first").count==1 && model.pendingOperations(for:"order_first")[0].phase=="unknown" && !model.canReceiveReturn(model.orders[0]),"order detail projects only its original pending receipt")
        model.perform(.receiveReturn(orderID:"order_first",returnID:"return_order_first",evidenceReference:"replacement",items:[one]));try check(sent.count==1,"unknown warehouse mutation cannot be replaced or resent")
        authority.proofFails=true;model.perform(.receiveReturn(orderID:"order_second",returnID:"return_order_second",evidenceReference:"evidence_receipt_second",items:[one]));try await until{!model.busy};authority.proofFails=false
        let prepared=try journal.records(account).values.first(where:{$0.target=="order_second"})!
        try check(prepared.phase=="prepared" && model.pendingOperations(for:"order_second").first?.phase=="prepared","independent object preserves known-unsent operation separately")
        model.retryPreparedOriginals(for:"order_first");try await until{!model.busy};try check(sent.count==1 && model.state=="seller_original_unconfirmed","target retry does not resend UNKNOWN, dispatch another order or falsely confirm it")
        model.recoverOriginals(for:"order_first");let wrong=try await take("seller/mutations/lookup");try lookup(wrong,record,received(first,"wrong_receipt"));try await until{!model.busy}
        try check(try journal.records(account)[record.key]?.phase=="unknown","wrong receipt evidence cannot clear original UNKNOWN")
        first=received(first,"receipt_first")
        model.recoverOriginals(for:"order_first");let recovered=try await take("seller/mutations/lookup");try lookup(recovered,record,first);try await until{!model.busy}
        try check(try journal.records(account)[record.key]?.phase=="confirmed" && model.pendingOperations(for:"order_first").isEmpty && model.pendingOperations(for:"order_second").count==1,"read-only matching lookup confirms only the selected order")
        model.retryPreparedOriginals(for:"order_second");let retry=try await take("orders/order_second/return-receipts");try check(try retry.body()==prepared.body,"explicit known-unsent retry retains exact original bytes")
        second=received(second,"receipt_second");try retry.respond(second);try await until{!model.busy}
        let current=model.orders.first(where:{$0.ID=="order_first"})!,receipt=current.ReturnReceipts!.first!
        try check(model.canRestockReturn(current,receipt),"received goods expose explicit separate stock action")
        model.perform(.restockReturn(orderID:current.ID,receiptID:receipt.ID));let stock=try await take("orders/order_first/return-restock")
        let stockRecord=try journal.records(account).values.first(where:{$0.kind=="restock-return"})!;stock.lose();try await until{!model.busy}
        try check(model.hasPending(current.ID),"unknown stock action remains locked without a second inventory effect")
        var stocked=first;var stockedReceipts=stocked["ReturnReceipts"] as! [[String:Any]];stockedReceipts[0]["RestockedAt"]=now;stockedReceipts[0]["RestockedBy"]=account;stocked["ReturnReceipts"]=stockedReceipts;first=stocked
        model.recoverOriginals(for:current.ID);let stockLookup=try await take("seller/mutations/lookup");try lookup(stockLookup,stockRecord,first);try await until{!model.busy}
        let afterStock=model.orders.first(where:{$0.ID==current.ID})!
        try check(!model.canRestockReturn(afterStock,afterStock.ReturnReceipts!.first!) && afterStock.remainingReturnItems?.first?.Quantity=="1","restock readback neither re-receives goods nor repeats stock")

        // Recovery of an earlier decision must ignore later warehouse events
        // whose status is still return_approved.
        let decision=try journal.prepare(account:account,storeID:store,target:current.ID,kind:"return",path:"/seller/orders/"+current.ID+"/transition",input:["Action":"return_approved","OriginalReturnID":"return_order_first","Explanation":""]);try journal.dispatch(decision)
        model.refresh();try await until{!model.busy};model.recoverOriginals(for:current.ID);let decisionLookup=try await take("seller/mutations/lookup");try lookup(decisionLookup,decision,first);try await until{!model.busy}
        try check(try journal.records(account)[decision.key]?.phase=="confirmed","original return decision recovers after later warehouse timeline events")
        second=makeOrder("order_second");second["Status"]="paid";second["Shipment"]=nil;second["Timeline"]=[];model.refresh();try await until{!model.busy}
        model.perform(.ship(orderID:"order_second",carrier:"Reviewed carrier",trackingNumber:"Reviewed tracking"));let ship=try await take("seller/orders/order_second/transition")
        let shipping=try journal.records(account).values.first(where:{$0.kind=="ship"})!;ship.lose();try await until{!model.busy}
        second["Status"]="delivered";second["Shipment"]=["Carrier":"Reviewed carrier","TrackingNumber":"Reviewed tracking","Status":"manual","UpdatedAt":now]
        model.recoverOriginals(for:"order_second");let shipLookup=try await take("seller/mutations/lookup");try lookup(shipLookup,shipping,second);try await until{!model.busy}
        try check(try journal.records(account)[shipping.key]?.phase=="confirmed","lost shipment acknowledgement recovers original after buyer delivery without another shipment")
        second["Status"]="return_requested";second["Timeline"]=[event("new_return_second","return_requested")];model.refresh();try await until{!model.busy}
        model.perform(.returnDecision(orderID:"order_second",returnID:"new_return_second",approve:true,explanation:"Reviewed original return"));let approve=try await take("seller/orders/order_second/transition")
        let approveInput=try JSONSerialization.jsonObject(with:approve.body()) as! [String:Any]
        try check(approveInput["OriginalReturnID"] as? String=="new_return_second" && approveInput["Action"] as? String=="return_approved","normal return approval binds the server original return event")
        second["Status"]="return_approved";second["Timeline"]=[event("new_return_second","return_requested"),event("new_approval_second","return_approved")];try approve.respond(second);try await until{!model.busy}
        try check(!model.hasPending("order_second") && model.orders.first(where:{$0.ID=="order_second"})?.approvedReturnIDs==["new_return_second"],"normal approved return becomes the next warehouse selection")
        permissions=[];first["Status"]="paid";second["Status"]="return_requested";model.refresh();try await until{!model.busy};let before=sent.count
        model.perform(.ship(orderID:"order_first",carrier:"Carrier",trackingNumber:"Tracking"));model.perform(.returnDecision(orderID:"order_second",returnID:"return_order_second",approve:true,explanation:""))
        model.reviewOriginalTerms(native)
        try check(sent.count==before && !model.busy && reviews.count==1 && !model.canReviewOriginalTerms(native),"revoked fulfillment, returns and finance permissions block normal model actions")
        permissions=["seller.read","fulfillment.write","inventory.write","returns.resolve"];first["Status"]="return_approved";model.refresh();try await until{!model.busy}
        model.perform(.receiveReturn(orderID:"order_first",returnID:"return_order_first",evidenceReference:"evidence_receipt_late",items:[one]));let late=try await take("orders/order_first/return-receipts")
        let uncertain=try journal.records(account).values.first(where:{$0.target=="order_first" && $0.phase=="unknown"})!
        model.disconnect();try late.respond(received(first,"receipt_late"));for _ in 0..<1000{await Task.yield()}
        try check(try model.orders.isEmpty && model.pendingOperations.isEmpty && journal.records(account)[uncertain.key]?.phase=="unknown","logout fences late warehouse response while original journal survives")
        model.connect();try await until{model.signedIn && !model.busy}
        permissions.append("finance.read");model.refresh();try await until{!model.busy}
        holdReview=true;let terms=model.orders.first(where:{$0.ID==native.ID})!;model.reviewOriginalTerms(terms);try await until{reviewContinuation != nil}
        model.disconnect();reviewContinuation?.resume(returning:reviewReply());reviewContinuation=nil;for _ in 0..<1000{await Task.yield()}
        try check(model.retainedTermsReviews.isEmpty && !model.signedIn,"logout suppresses late Main review without adopting pending approval")
        model.connect();try await until{model.signedIn && !model.busy && model.orders.count==3}
        holdReview=false
        let queuedTerms=model.orders.first(where:{$0.ID==native.ID})!,reviewCount=reviews.count
        model.reviewOriginalTerms(queuedTerms)
        let previousSession=authority.current!
        authority.current=ShopSession(account:previousSession.account,token:String(repeating:"u",count:32),expiresAt:previousSession.expiresAt,nativeGeneration:2);api.onSessionChanged?()
        try await until{!model.busy && model.orders.count==3}
        for _ in 0..<1000{await Task.yield()}
        try check(reviews.count==reviewCount && model.retainedTermsReviews.isEmpty,"queued old Seller terms request cannot borrow a renewed session before dispatch")
        let queuedRead=model.orders.first(where:{$0.ID==native.ID})!,sentCount=sent.count
        model.readOriginalOrder(queuedRead)
        authority.current=ShopSession(account:previousSession.account,token:String(repeating:"v",count:32),expiresAt:previousSession.expiresAt,nativeGeneration:3);api.onSessionChanged?()
        try await until{!model.busy && model.orders.count==3}
        for _ in 0..<1000{await Task.yield()}
        try check(sent.count==sentCount && pending.isEmpty,"queued original order read cannot dispatch under a new Seller session")
        try check(storage["original-Pay-UNKNOWN"]==sentinel && !sent.contains(where:{$0.contains("refund") || $0.contains("pay-")}),"warehouse flow preserves financial UNKNOWN and dispatches no payment or refund")
        print("Seller fulfillment checks PASS \(checks); actual model/API with controlled HTTP/authority, no Wallet, physical goods or funds")
    }
}
