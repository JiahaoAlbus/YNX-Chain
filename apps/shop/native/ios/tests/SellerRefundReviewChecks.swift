import Foundation

@MainActor final class RefundReviewAuthority:AppleNativeAuthority {
    var current:ShopSession?
    let account="ynx1"+String(repeating:"q",count:38)
    func restore()async throws{}
    func connect()async throws{current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func disconnect()throws{current=nil}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};_ = try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller);return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class RefundReviewHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((RefundReviewHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ value:Any,status:Int=200)throws{let data=try JSONSerialization.data(withJSONObject:value);client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)}
    func lose(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
}
@MainActor final class UnavailableOrderChild: AppleOriginalMainPayChild {
    func status() async throws -> [String: Any] { throw URLError(.networkConnectionLost) }
    func invoke() async throws -> [String: Any] { throw ShopError.security }
    func close() async throws {}
}
@main struct SellerRefundReviewChecks {
    @MainActor static func main()async throws {
        var checks=0
        let explicitRecoveryOnly=CommandLine.arguments.contains("--explicit-reconcile-recovery")
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func until(_ predicate:()->Bool)async throws{for _ in 0..<200_000{if predicate(){return};await Task.yield()};throw NSError(domain:"bounded refund review async condition",code:1)}
        func settle()async{for _ in 0..<1000{await Task.yield()}}
        let authority=RefundReviewAuthority(),eventID="event_"+String(repeating:"a",count:24),nextID="event_"+String(repeating:"b",count:24),pendingHash="0x"+String(repeating:"d",count:64)
        let fixture=URL(fileURLWithPath:ProcessInfo.processInfo.environment["YNX_SHOP_NATIVE_RECEIPT_FIXTURE"] ?? "apps/shop/native/testdata/native-paid-order.json")
        var base=try JSONSerialization.jsonObject(with:Data(contentsOf:fixture)) as! [String:Any]
        let orderID=base["ID"] as! String,storeID=base["StoreID"] as! String,account=authority.account
        func event(_ id:String,_ status:String="refund_requested",_ action:String="order_transition")->[String:Any]{["ID":id,"Actor":base["Buyer"]!,"Role":"buyer","Action":action,"Status":status,"Detail":"Original refund request","At":"2026-11-08T12:00:00Z"]}
        base.merge(["Status":"refund_requested","SubtotalYNXT":25,"ShippingYNXT":0,"TaxYNXT":0,"TaxStatus":"unavailable","LogisticsStatus":"manual","TrustStatus":"unavailable","Lines":[["ProductID":"product_original","VariantID":"variant_original","Title":"Original goods","VariantName":"Original","Quantity":1,"UnitPriceYNXT":25]],"Address":["Recipient":"Buyer","Line1":"Original address","City":"C","Region":"","PostalCode":"","Country":"QA"],"Timeline":[event(eventID)]]){_,new in new}
        func decode(_ raw:[String:Any])throws->SellerOrder{try JSONDecoder().decode(SellerOrder.self,from:CanonicalJSON.data(raw))}
        func payment(_ raw:[String:Any],_ change:(inout [String:Any])->Void)->[String:Any]{var value=raw,projection=raw["NativePayment"] as! [String:Any];change(&projection);value["NativePayment"]=projection;return value}
        func pending(_ raw:[String:Any])->[String:Any]{payment(raw){$0["PendingOriginals"]=[pendingHash];$0["CompleteKnownOriginals"]=false;$0["ReconciliationRequired"]=true}}
        let original=try decode(base)
        var used=base;var usedPayment=used["NativePayment"] as! [String:Any],usedReceipts=usedPayment["Receipts"] as! [[String:Any]];usedReceipts[1]["refundId"]=eventID;usedPayment["Receipts"]=usedReceipts;used["NativePayment"]=usedPayment
        if !explicitRecoveryOnly {
        try check(original.originalRefundRequestID==eventID && original.validatedNetPaidAtoms=="70","current real refund event and accepted net balance form the review selection")
        for (label,alter) in [("wrong action",{(row:inout [String:Any]) in row["Timeline"]=[event(eventID,"refund_requested","refund_receipt")]}),("wrong actor",{row in var forged=event(eventID);forged["Actor"]=account;row["Timeline"]=[forged]}),("wrong role",{row in var forged=event(eventID);forged["Role"]="seller";row["Timeline"]=[forged]}),("duplicate event",{row in row["Timeline"]=[event(eventID),event(eventID)]}),("noncanonical event",{row in row["Timeline"]=[event("event_"+String(repeating:"A",count:24))]}),("superseded request",{row in row["Timeline"]=[event(eventID),event(nextID,"refund_rejected")]}),("wrong current status",{row in row["Status"]="return_approved"})] {
            var value=base;alter(&value);try check(try decode(value).originalRefundRequestID==nil,"refund selector rejects "+label)
        }
        try check(try decode(used).originalRefundRequestID==nil,"accepted receipt consumes the existing refund event")
        for (label,row) in [("pending original",pending(base)),("unknown completeness",payment(base){$0["CompleteKnownOriginals"]=false}),("required reconciliation",payment(base){$0["ReconciliationRequired"]=true}),("unbound balance",payment(base){$0["NetPaidAtoms"]="71"}),("noncanonical balance",payment(base){$0["NetPaidAtoms"]="070"})] {
            try check(try decode(row).validatedNetPaidAtoms==nil,"refund eligibility rejects "+label)
        }
        }
        var endpointOrder=base,permissions=["seller.read","finance.read","refund.approve"],role="owner",pendingHTTP:[RefundReviewHTTP]=[],requests:[String]=[]
        var storage=["original-UNKNOWN":Data("preserve original request".utf8)]
        let journal=SellerMutationJournal(read:{storage[$0]},write:{storage[$0]=$1})
        RefundReviewHTTP.handler={request in
            let path=request.request.url!.path;requests.append((request.request.httpMethod ?? "")+" "+path)
            guard request.request.httpMethod=="GET" else{preconditionFailure("Unexpected Seller financial mutation "+path)}
            switch path{
            case "/api/seller/stores":try! request.respond(["stores":[["ID":storeID,"Owner":account,"Name":"Original store","Description":"","Policy":"Original","TrustURL":"","SettlementAccount":account,"Status":"active"]],"access":[storeID:["role":role,"permissions":permissions]]])
            case "/api/seller/products":try! request.respond(["products":[]])
            case "/api/seller/orders":try! request.respond(["orders":[endpointOrder]])
            case "/api/seller/orders/"+orderID:pendingHTTP.append(request)
            case "/api/seller/stores/"+storeID+"/roles":try! request.respond(["roles":[account:role],"revocations":[],"invitations":[]])
            case "/api/seller/audit":try! request.respond(["events":[]])
            case "/api/seller/settlements":try! request.respond(["settlements":[]])
            default:preconditionFailure("Unexpected refund route "+path)
            }
        }
        var inputs:[[String:String]]=[],holdMain=false,failMain=false,held:CheckedContinuation<[String:Any],Error>?
        func reviewReply(_ id:String=eventID)->[String:Any]{["ok":true,"value":["clientIndependentFinality":false,"queryOnly":false,"approvalRequired":true,"canRetry":false,"reference":["productId":"shop.order","sourceOrder":orderID,"intentId":base["PayIntentID"]!,"merchant":base["PayMerchant"]!,"invoiceId":base["InvoiceID"]!,"refundId":id],"walletRequest":["id":"main-original-review","method":"ynx_signPQNativeAction","approvalRequired":true]]]}
        func reconcileReply()->[String:Any]{
            let ref:[String:Any]=["productId":"shop.order","sourceOrder":orderID,"intentId":base["PayIntentID"]!,"merchant":base["PayMerchant"]!,"invoiceId":base["InvoiceID"]!,"nativeHash":pendingHash]
            let original:[String:Any]=["merchant":base["PayMerchant"]!,"invoiceId":base["InvoiceID"]!,"nativeHash":pendingHash,"abciHash":"0x"+String(repeating:"c",count:64),"kind":"invoice_refund","owner":base["PayMerchant"]!,"status":"confirmed"]
            return ["ok":true,"value":["clientIndependentFinality":false,"queryOnly":true,"approvalRequired":false,"canRetry":false,"reference":ref,"reconciledOriginal":original,"bill":["sourceOrder":orderID,"merchant":base["PayMerchant"]!,"invoiceId":base["InvoiceID"]!],"operations":[original]]]
        }
        let navigation=AppleOriginalMainPayNavigation(current:{guard let value=authority.current else{throw ShopError.signedOut};return value},status:{_ in ["ok":true,"value":["normalMainEntry":true,"canRequest":true,"paymentAuthorized":false]]},invoke:{input,expectedOperation,expected in
            guard expectedOperation==base["PayIntentID"] as? String else{throw ShopError.security}
            guard expected==authority.current else{throw ShopError.contextChanged};inputs.append(input)
            if holdMain{return try await withCheckedThrowingContinuation{held=$0}}
            if failMain{throw URLError(.networkConnectionLost)}
            return input["action"]=="order-refund-review" ? reviewReply(input["refundId"]!):reconcileReply()
        })
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[RefundReviewHTTP.self]
        let api=APIClient(session:URLSession(configuration:configuration),nativePayNavigation:navigation,authorityFactory:{authority})
        let model=ShopSellerModel(api:api,journal:journal,localDraftStore:SellerLocalDraftStore(read:{storage[$0]},write:{storage[$0]=$1}))
        func refresh()async throws{model.refresh();try await until{!model.busy && model.orders.count==1}}
        func connect()async throws{model.connect();try await until{model.signedIn && !model.busy && model.orders.count==1}}
        func take()async throws->RefundReviewHTTP{try await until{!pendingHTTP.isEmpty};return pendingHTTP.removeFirst()}
        if !explicitRecoveryOnly {
            let fallbackAuthority=RefundReviewAuthority()
            let fallbackAPI=APIClient(session:URLSession(configuration:configuration),authority:fallbackAuthority,
                                      acquireOriginalOrder:{_,_,_,_ in UnavailableOrderChild()})
            let fallback=ShopSellerModel(api:fallbackAPI,journal:SellerMutationJournal(read:{_ in nil},write:{_,_ in}),
                                         localDraftStore:SellerLocalDraftStore(read:{_ in nil},write:{_,_ in}))
            fallback.connect()
            try await until{fallback.signedIn && !fallback.busy && fallback.orders.count==1}
            let before=fallback.orders[0]
            fallback.readOriginalOrder(before)
            let read=try await take()
            var updated=base;updated["LogisticsStatus"]="same-order-refresh"
            try read.respond(updated);try await until{!fallback.busy}
            try check(fallback.orders[0].LogisticsStatus=="same-order-refresh" && fallback.state=="unavailable",
                      "failed Pay read preserves failure while refreshing same-order nonfinancial data")
            fallback.readOriginalOrder(fallback.orders[0])
            let changed=try await take()
            var forbidden=base;forbidden["RefundStatus"]="changed"
            try changed.respond(forbidden);try await until{!fallback.busy}
            try check(fallback.orders[0].LogisticsStatus=="same-order-refresh" && fallback.orders[0].RefundStatus==before.RefundStatus,
                      "failed Pay read cannot adopt changed financial status")
            fallback.disconnect()
        }
        func explicitRecoveryChecks()async throws {
            func require(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)}}
            endpointOrder=pending(base);permissions=["seller.read","finance.read"];role="finance";holdMain=false;failMain=true
            try await connect();let saved=storage
            model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);let automatic=try await take()
            try require(model.busy && !model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"lost invoke stays busy until independent automatic read")
            try automatic.respond(endpointOrder);try await until{!model.busy};let invoked=inputs.count
            model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);await settle()
            try check(inputs.count==invoked && !model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash) && model.orders[0].NativePayment?.PendingOriginals==[pendingHash],"explicit recovery delta: lost invoke and automatic GET cannot enable another reconciliation")

            // Failed/foreign reads and even a self-consistent rebound native
            // tuple cannot unlock the originally attempted identity.
            model.readOriginalOrder(model.orders[0]);let failed=try await take();failed.lose();try await until{!model.busy}
            try require(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"failed explicit GET cannot enable retry")
            model.readOriginalOrder(model.orders[0]);let archive=try await take();try archive.respond(["code":"PUBLIC_ARCHIVE_UNKNOWN"],status:409);try await until{!model.busy}
            try require(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"archive 409 cannot enable retry")
            var foreign=endpointOrder;foreign["InvoiceID"]="foreign-invoice"
            var missing=endpointOrder;missing["NativePayment"]=nil
            func rebound(_ field:String,_ value:String)->[String:Any]{payment(pending(base)){projection in projection[field]=value;var receipts=projection["Receipts"] as! [[String:Any]];for index in receipts.indices{receipts[index][field=="SessionID" ? "sessionId":"termsHash"]=value};projection["Receipts"]=receipts}}
            for value in [foreign,missing,rebound("SessionID","session_changed"),rebound("TermsHash",String(repeating:"e",count:64))] {
                model.readOriginalOrder(model.orders[0]);let read=try await take();try read.respond(value);try await until{!model.busy}
                try require(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"foreign or missing original native identity cannot enable retry")
            }
            endpointOrder=rebound("TermsHash",String(repeating:"e",count:64));try await refresh()
            model.readOriginalOrder(model.orders[0]);let reboundAgain=try await take();try reboundAgain.respond(endpointOrder);try await until{!model.busy}
            try check(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash) && inputs.count==invoked,"explicit recovery delta: failed foreign missing and refreshed rebound tuple remain blocked")

            endpointOrder=pending(base);try await refresh()
            try require(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"ordinary list refresh cannot enable retry")
            model.readOriginalOrder(model.orders[0]);let explicit=try await take();try explicit.respond(endpointOrder);try await until{!model.busy}
            try require(model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash) && inputs.count==invoked,"successful user query only enables a later explicit action")
            failMain=false;model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);let subsequent=try await take()
            try require(model.busy && inputs.count==invoked+1 && inputs.last?["nativeHash"]==pendingHash,"later user action uses same original hash while busy")
            try subsequent.respond(endpointOrder);try await until{!model.busy}
            try check(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash) && model.orders[0].NativePayment?.PendingOriginals==[pendingHash] && storage==saved,"explicit recovery delta: matching independent user GET permits one same-hash action without funds or journal mutation")
            model.disconnect()
        }
        if explicitRecoveryOnly {
            try await explicitRecoveryChecks()
            print("Seller explicit reconciliation recovery delta PASS \(checks); original same-hash controlled Main/HTTP, no signing, broadcast or funds")
            return
        }
        try await connect()
        try check(model.canReviewOriginalRefund(model.orders[0]),"normal owner with both permissions may review the selected original")
        for (newRole,newPermissions) in [("finance",permissions),("owner",["seller.read","finance.read"]),("owner",["seller.read","refund.approve"])]{
            role=newRole;permissions=newPermissions;try await refresh();let before=inputs.count
            model.reviewOriginalRefund(model.orders[0],refundID:eventID,amountAtoms:"1");try check(!model.canReviewOriginalRefund(model.orders[0]) && inputs.count==before && !model.busy,"role and independent permissions prevent review "+newRole+":"+newPermissions.joined(separator:","))
        }
        role="owner";permissions=["seller.read","finance.read","refund.approve"];try await refresh()
        let stale=model.orders[0];endpointOrder["Timeline"]=[event(nextID)];try await refresh()
        try check(!model.canReviewOriginalRefund(stale) && model.refundableOriginalEvent(model.orders[0])?.ID==nextID,"stale form cannot reuse prior event against a refreshed same-order snapshot")
        endpointOrder=base;try await refresh();let selected=model.orders[0],beforeInvalid=inputs.count
        for amount in ["0","-1","+1","01"," 1","1.0","1e1","71","18446744073709551616"]{model.reviewOriginalRefund(selected,refundID:eventID,amountAtoms:amount)}
        model.reviewOriginalRefund(selected,refundID:nextID,amountAtoms:"1")
        try check(inputs.count==beforeInvalid && !model.busy && model.retainedRefundReviews.isEmpty,"malformed, excessive or rebound input never reaches Main or reserves a review")
        let beforeStorage=storage
        model.reviewOriginalRefund(selected,refundID:eventID,amountAtoms:"70");try await until{!model.busy}
        try check(inputs.last==["action":"order-refund-review","productId":"shop.order","sourceOrder":orderID,"refundId":eventID,"amountAtoms":"70"],"normal refund review binds actual event and canonical full remaining amount")
        try check(model.retainedRefundReviews[orderID]?.reviewID=="main-original-review" && model.retainedRefundReviews[orderID]?.phase=="pending" && model.state=="native_main_review_pending","Main review acknowledgement is retained as pending approval only")
        try check(storage==beforeStorage && model.orders[0].NativePayment?.NetPaidAtoms=="70" && model.orders[0].Status=="refund_requested","review writes no Seller funds journal and cannot infer a refund")
        let reviewed=inputs.count;try await refresh();model.reviewOriginalRefund(model.orders[0],refundID:eventID,amountAtoms:"1");await settle()
        try check(inputs.count==reviewed && model.retainedRefundReviews[orderID]?.amountAtoms=="70" && !model.canReviewOriginalRefund(model.orders[0]),"refresh preserves review selection and blocks replacement amount")
        // Main is authoritative across new sessions. This new controlled case
        // starts without a retained local presentation, then loses its reply.
        model.disconnect();try await connect();failMain=true
        model.reviewOriginalRefund(model.orders[0],refundID:eventID,amountAtoms:"5");try await until{!model.busy}
        try check(model.retainedRefundReviews[orderID]?.phase=="unknown" && model.retainedRefundReviews[orderID]?.amountAtoms=="5" && model.retainedRefundReviews[orderID]?.reviewID==nil,"lost Main reply retains exact original refund selection as unknown")
        let unknownCount=inputs.count;failMain=false;model.reviewOriginalRefund(model.orders[0],refundID:eventID,amountAtoms:"6");await settle()
        try check(inputs.count==unknownCount && !model.canReviewOriginalRefund(model.orders[0]),"unknown review is not redispatched with new amount or fake operation")
        var mismatched=used;mismatched["Timeline"]=[event(eventID),event(nextID)]
        model.readOriginalOrder(model.orders[0]);let mismatchRead=try await take();try mismatchRead.respond(mismatched);try await until{!model.busy}
        try check(!model.canReviewOriginalRefund(model.orders[0]) && model.retainedRefundReviews[orderID]?.phase=="unknown","receipt for the same event but another amount cannot retire the original review")
        model.reviewOriginalRefund(model.orders[0],refundID:nextID,amountAtoms:"1");await settle()
        try check(inputs.count==unknownCount,"mismatched readback never allows another Main review")
        var matched=payment(mismatched){projection in
            var receipts=projection["Receipts"] as! [[String:Any]]
            receipts[1]["principalAtoms"]="5";receipts[1]["refundedAtoms"]="5";receipts[1]["netPaidAtoms"]="95"
            projection["Receipts"]=receipts;projection["RefundedAtoms"]="5";projection["NetPaidAtoms"]="95"
        }
        matched["RefundStatus"]="native_partial_refund"
        model.readOriginalOrder(model.orders[0]);let pendingRead=try await take();try pendingRead.respond(pending(matched));try await until{!model.busy}
        try check(!model.canReviewOriginalRefund(model.orders[0]) && model.retainedRefundReviews[orderID]?.phase=="unknown","incomplete payment readback retains original refund review")
        let rebound=payment(matched){projection in
            projection["SessionID"]="another_payment_session"
            var receipts=projection["Receipts"] as! [[String:Any]]
            for index in receipts.indices{receipts[index]["sessionId"]="another_payment_session"}
            projection["Receipts"]=receipts
        }
        model.readOriginalOrder(model.orders[0]);let foreignSession=try await take();try foreignSession.respond(rebound);try await until{!model.busy}
        try check(!model.canReviewOriginalRefund(model.orders[0]) && model.retainedRefundReviews[orderID]?.phase=="unknown","matching refund amount from another payment session cannot retire the original")
        try check(model.orders[0].NativePayment?.SessionID==original.NativePayment?.SessionID &&
                  model.orders[0].NativePayment?.PendingOriginals==[pendingHash] &&
                  model.state=="unavailable","original order read refuses rebound payment identity without publishing its balances")
        model.readOriginalOrder(model.orders[0]);let accepted=try await take();try accepted.respond(matched);try await until{!model.busy}
        try check(model.canReviewOriginalRefund(model.orders[0]) && model.refundableOriginalEvent(model.orders[0])?.ID==nextID,"only confirmed receipt for the exact original amount admits a later refund event")
        endpointOrder=base;model.disconnect();try await connect()
        let queued=model.orders[0],queuedCount=inputs.count,oldSession=authority.current!
        model.reviewOriginalRefund(queued,refundID:eventID,amountAtoms:"5")
        authority.current=ShopSession(account:oldSession.account,token:String(repeating:"u",count:32),expiresAt:oldSession.expiresAt,nativeGeneration:2);api.onSessionChanged?();try await until{!model.busy && model.orders.count==1};await settle()
        try check(inputs.count==queuedCount && model.retainedRefundReviews.isEmpty,"queued refund review cannot borrow renewed session before Main call")
        let beforeUnannounced=inputs.count,visible=model.orders[0]
        authority.current=ShopSession(account:"ynx1"+String(repeating:"r",count:38),token:String(repeating:"r",count:32),expiresAt:oldSession.expiresAt,nativeGeneration:4)
        model.reviewOriginalRefund(visible,refundID:eventID,amountAtoms:"5")
        try check(!model.canReviewOriginalRefund(visible) && inputs.count==beforeUnannounced && !model.busy,"account changed before notification cannot reuse old Seller role or order")
        authority.current=oldSession;api.onSessionChanged?();try await until{!model.busy && model.orders.count==1}
        holdMain=true;model.reviewOriginalRefund(model.orders[0],refundID:eventID,amountAtoms:"5");try await until{held != nil}
        model.disconnect();held?.resume(returning:reviewReply());held=nil;await settle()
        try check(model.retainedRefundReviews.isEmpty && model.orders.isEmpty && !model.signedIn,"logout drops late review presentation without adopting funds")
        holdMain=false;endpointOrder=pending(base);try await connect();let pendingOrder=model.orders[0]
        try check(!model.canReviewOriginalRefund(pendingOrder) && model.canReconcileOriginalPayment(pendingOrder,nativeHash:pendingHash),"actual unresolved original blocks refund while exposing explicit same-hash reconciliation")
        try check(!model.canReconcileOriginalPayment(pendingOrder,nativeHash:"0x"+String(repeating:"e",count:64)) && !model.canReconcileOriginalPayment(pendingOrder,nativeHash:"../other"),"only validated pending hash is selectable for reconciliation")
        let noAuto=inputs.count;try await refresh();try check(inputs.count==noAuto,"ordinary Seller refresh never auto-reconciles the original")
        role="finance";permissions=["seller.read","finance.read"];try await refresh()
        try check(model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"finance reader may reconcile without acquiring refund approval permission")
        permissions=["seller.read"];try await refresh()
        try check(!model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"revoked finance permission blocks explicit reconciliation")
        permissions=["seller.read","finance.read"];try await refresh()
        let beforeGet=requests.filter{$0=="GET /api/seller/orders/"+orderID}.count
        model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);let query=try await take()
        try check(inputs.last==["action":"order-reconcile-operation","productId":"shop.order","sourceOrder":orderID,"nativeHash":pendingHash] && model.busy,"explicit reconciliation retains exact original hash and busy boundary through independent GET")
        try check(model.orders[0].NativePayment?.PendingOriginals==[pendingHash] && requests.filter{$0=="GET /api/seller/orders/"+orderID}.count==beforeGet+1,"confirmed Main observation cannot remove Shop pending before its own receipt read")
        try query.respond(endpointOrder);try await until{!model.busy}
        try check(model.orders[0].NativePayment?.PendingOriginals==[pendingHash] && !model.canReviewOriginalRefund(model.orders[0]),"Shop still-pending readback remains unresolved despite Main confirmed observation")
        let attemptedCount=inputs.count;model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);await settle()
        try check(inputs.count==attemptedCount && !model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"attempted same-hash reconciliation becomes query-only recovery within session")
        model.readOriginalOrder(model.orders[0]);let failedRead=try await take();failedRead.lose();try await until{!model.busy}
        try check(model.orders[0].NativePayment?.PendingOriginals==[pendingHash] && model.state=="unavailable","failed independent receipt read preserves original pending hash")
        model.readOriginalOrder(model.orders[0]);let foreignRead=try await take();var foreign=base;foreign["InvoiceID"]="foreign-invoice";try foreignRead.respond(foreign);try await until{!model.busy}
        try check(model.orders[0].InvoiceID==original.InvoiceID && model.orders[0].NativePayment?.PendingOriginals==[pendingHash],"foreign receipt binding cannot replace original after reconciliation")
        model.readOriginalOrder(model.orders[0]);let missingRead=try await take();var missing=base;missing["NativePayment"]=nil;try missingRead.respond(missing);try await until{!model.busy}
        try check(model.orders[0].NativePayment?.PendingOriginals==[pendingHash] && model.state=="unavailable","missing native projection cannot erase original unresolved payment")
        model.readOriginalOrder(model.orders[0]);let acceptedRead=try await take();try acceptedRead.respond(base);try await until{!model.busy}
        try check(model.orders[0].NativePayment?.CompleteKnownOriginals==true && model.orders[0].NativePayment?.NetPaidAtoms=="70" && !model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"only independent accepted Shop projection retires selected pending hash")
        endpointOrder=pending(base);model.disconnect();try await connect();failMain=true
        model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);let lossRead=try await take();try lossRead.respond(endpointOrder);try await until{!model.busy}
        try check(model.orders[0].NativePayment?.PendingOriginals==[pendingHash] && model.state=="unavailable" && !model.canReconcileOriginalPayment(model.orders[0],nativeHash:pendingHash),"lost reconciliation reply still reads Shop while retaining unknown and query-only recovery")
        let lostCount=inputs.count;model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);await settle()
        try check(inputs.count==lostCount && pendingHTTP.isEmpty,"lost reconciliation cannot invoke the same original again through the model button")
        failMain=false;model.disconnect();try await connect();let reconcileQueued=model.orders[0],reconcileCount=inputs.count,session=authority.current!
        model.reconcileOriginalPayment(reconcileQueued,nativeHash:pendingHash)
        authority.current=ShopSession(account:session.account,token:String(repeating:"v",count:32),expiresAt:session.expiresAt,nativeGeneration:3);api.onSessionChanged?();try await until{!model.busy && model.orders.count==1};await settle()
        try check(inputs.count==reconcileCount,"queued reconciliation cannot run with a replacement session")
        holdMain=true;let detailBefore=requests.filter{$0=="GET /api/seller/orders/"+orderID}.count
        model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);try await until{held != nil};model.disconnect();held?.resume(returning:reconcileReply());held=nil;await settle()
        try check(requests.filter{$0=="GET /api/seller/orders/"+orderID}.count==detailBefore && model.orders.isEmpty,"logout during Main reconciliation prevents follow-up private receipt query")
        holdMain=false;try await connect();model.reconcileOriginalPayment(model.orders[0],nativeHash:pendingHash);let lateRead=try await take();model.disconnect();try lateRead.respond(base);await settle()
        try check(model.orders.isEmpty && model.retainedRefundReviews.isEmpty && !model.signedIn,"logout fences late independent receipt read after Main returned")
        try check(storage==beforeStorage && requests.allSatisfy{$0.hasPrefix("GET ")},"complete review and reconciliation lifecycle preserves journal and never posts Seller funds")
        try await explicitRecoveryChecks()
        print("Seller refund review and reconciliation checks PASS \(checks); controlled model/Main/HTTP only, no live Main, signing, broadcast or funds")
    }
}
