import Foundation

final class StubProtocol:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((StubProtocol)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ status:Int=200,_ body:String="{}"){let response=HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!;client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)}
}
@MainActor final class ControlledAuthority:AppleNativeAuthority {
 var current:ShopSession?
 var beforeProof:(()async throws->Void)?
 var proofBody:String?,proofPath:String?
 var corruptBody=false,proofFailure=false,disconnects=0
 func restore()async throws {}
 func connect()async throws {throw ShopError.unavailable}
 func handleReturn(_ url:URL)async throws {throw ShopError.security}
 func disconnect()throws {disconnects+=1;current=nil}
 func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};proofBody=body;proofPath=path;try await beforeProof?();if proofFailure{throw ShopError.unavailable};return ["body":corruptBody ? body+" ":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
@main struct BoundaryTests {
    @MainActor static func main()async throws{
        let account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38)
        func metadata(_ actor:String,expiry:Date=Date().addingTimeInterval(3600))throws->Data{try JSONEncoder().encode(ShopSession(account:actor,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:expiry)))}
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};print("PASS "+name)}
        try check(ShopSession.parse(Data("original-bare-token".utf8))==nil,"bare token cannot create active session")
        try check(ShopSession.parse(try metadata(account))?.account==account,"actual typed account and expiry context")
        try check(ShopSession.parse(try metadata(account,expiry:Date().addingTimeInterval(-1)))==nil,"expired context rejected")
        var saved:Data?;let read={saved};let write:(Data)throws->Void={saved=$0}
        let first=OfflineQueue(read:read,write:write),second=OfflineQueue(read:read,write:write)
        let input:[String:Any]=["Amount":8,"Address":"original private content"]
        let original=try first.prepare(account:account,path:"orders",input:input)
        try check(try second.prepare(account:account,path:"orders",input:input)==original,"restart retains exact original wire request and key")
        do{_ = try second.prepare(account:account,path:"orders",input:["Amount":9]);throw NSError(domain:"replacement sent",code:1)}catch ShopError.unresolvedMutation{print("PASS changed request cannot replace unresolved original")}
        try check(try second.load(account:other).isEmpty,"new account cannot replay original account request")
        let foreign=try second.prepare(account:other,path:"orders",input:input);try first.confirmed(original)
        try check(try first.load(account:account).isEmpty && first.load(account:other)==[foreign],"confirmation removes only exact original target")
        let before=saved;let failing=OfflineQueue(read:read,write:{_ in throw ShopError.security});do{_ = try failing.prepare(account:account,path:"orders",input:input);throw NSError(domain:"write accepted",code:1)}catch ShopError.security{try check(saved==before,"storage failure preserves original evidence")}
        saved=Data("broken original evidence".utf8);do{_ = try first.load(account:account);throw NSError(domain:"invalid queue adopted",code:1)}catch{try check(saved==Data("broken original evidence".utf8),"malformed records are retained and never silently emptied")}
        let authority=ControlledAuthority();authority.current=ShopSession.parse(try metadata(account));let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[StubProtocol.self];let urlSession=URLSession(configuration:config);let api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:urlSession,authority:authority)
        StubProtocol.handler={request in precondition(request.request.value(forHTTPHeaderField:"Authorization")==nil);request.respond(200,"{\"products\":[]}")};_ = try await api.data("products");print("PASS public catalog sends no bearer")
        StubProtocol.handler={request in precondition(request.request.value(forHTTPHeaderField:"Authorization")==nil);precondition(request.request.value(forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2")==String(repeating:"i",count:43));precondition(request.request.value(forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2")==String(repeating:"a",count:43));request.respond()};_ = try await api.data("orders");print("PASS private request uses exact two proof headers and no legacy bearer")
        var deferred:StubProtocol?;var ready:CheckedContinuation<Void,Never>?
        StubProtocol.handler={request in deferred=request;ready?.resume();ready=nil}
        let late=Task{try await api.data("orders")};await withCheckedContinuation{ready=$0};authority.current=ShopSession.parse(try metadata(other));deferred?.respond(200,"{\"oldActor\":true}")
        do{_ = try await late.value;throw NSError(domain:"old actor adopted",code:1)}catch ShopError.contextChanged{print("PASS late response after account change rejected")}
        let logout=Task{try await api.data("orders")};await withCheckedContinuation{ready=$0};api.invalidate();deferred?.respond()
        do{_ = try await logout.value;throw NSError(domain:"late logout adopted",code:1)}catch ShopError.contextChanged{print("PASS late response after logout rejected")}
        StubProtocol.handler={request in request.respond(401,"{\"error\":\"expired\"}")};do{_ = try await api.data("orders");throw NSError(domain:"401 adopted",code:1)}catch{try check(authority.current==nil && authority.disconnects==1,"authoritative private 401 synchronously clears Native authority")}
        authority.current=nil;do{_ = try await api.data("orders");throw NSError(domain:"unauthorized dispatch",code:1)}catch ShopError.signedOut{print("PASS missing account context prevents private dispatch")}
        for path in ["../orders","https://foreign.invalid/api/orders","/orders"]{do{_ = try await api.data(path);throw NSError(domain:"foreign route",code:1)}catch ShopError.unavailable{print("PASS route boundary "+path)}}
        authority.current=ShopSession.parse(try metadata(account));var dispatched=0
        StubProtocol.handler={request in dispatched+=1;request.respond()}
        let body=Data("{\"IdempotencyKey\":\"original-byte-order\",\"Address\":\"原始\"}".utf8)
        _ = try await api.data("orders",method:"POST",body:body)
        try check(authority.proofBody==String(data:body,encoding:.utf8) && authority.proofPath=="/api/orders" && dispatched==1,"proof commits actual original wire body and path")
        authority.corruptBody=true;do{_ = try await api.data("orders",method:"POST",body:body);throw NSError(domain:"body substitution",code:1)}catch ShopError.security{try check(dispatched==1,"changed SDK wire body cannot dispatch")};authority.corruptBody=false
        authority.proofFailure=true;do{_ = try await api.data("orders",method:"POST",body:body);throw NSError(domain:"unprepared dispatch",code:1)}catch ShopError.unavailable{try check(dispatched==1,"failed authority proof never starts business HTTP")};authority.proofFailure=false
        authority.beforeProof={authority.current=nil};do{_ = try await api.data("orders",method:"POST",body:body);throw NSError(domain:"late proof dispatch",code:1)}catch ShopError.contextChanged{try check(dispatched==1,"context change during awaited proof prevents HTTP")};authority.beforeProof=nil
        authority.current=ShopSession.parse(try metadata(account));for path in ["orders?alias=1","orders/../profile"]{do{_ = try await api.data(path);throw NSError(domain:"private alias",code:1)}catch ShopError.security{print("PASS exact private route rejects "+path)}}
        for pair in [("PUT","/api/orders"),("GET","/api/seller/products"),("POST","/api/profile"),("GET","/api/orders/../profile")]{do{_ = try AppleNativeBusinessPolicy.scopes(pair.0,pair.1);throw NSError(domain:"scope broadened",code:1)}catch ShopError.security{print("PASS fixed Buyer scope route refuses "+pair.1)}}
        try check(try AppleNativeBusinessPolicy.scopes("POST","/api/orders/id/pay-handoff")==["account:read","shop:orders:write"],"payment preparation uses original Buyer scopes")
        try check(try AppleNativeBusinessPolicy.scopes("GET","/api/orders/id/native-pay-intent")==["account:read","shop:orders:write"],"original Native intent uses narrow read action")
        do{_ = try AppleNativeBusinessPolicy.scopes("DELETE","/api/orders/id/native-pay-intent");throw NSError(domain:"intent mutation permitted",code:1)}catch ShopError.security{print("PASS Native intent cannot authorize DELETE")}
        var nativeOrder=Order(orderID:"ord_original",status:"payment_pending",totalYNXT:10,refundStatus:nil,trustStatus:nil,payDeepLink:nil,buyer:account,storeID:"store_original",currency:"YNXT")
        nativeOrder.payIntentID="npi_"+String(repeating:"ab",count:24)
        var intentCalls=0
        StubProtocol.handler={request in intentCalls+=1;precondition(request.request.httpMethod=="GET" && request.request.url?.path=="/api/orders/ord_original/native-pay-intent");precondition(request.request.httpBody==nil);request.respond(200,"{\"orderId\":\"ord_original\",\"originalOperation\":\"\(nativeOrder.payIntentID!)\",\"state\":\"PREPARED\",\"phase\":\"signed_not_submitted\",\"queryOnly\":true,\"fundsVerified\":false}")}
        try await api.readOriginalNativeIntent(nativeOrder);try check(intentCalls==1,"actual API reads retained intent without payment POST")
        StubProtocol.handler={request in request.respond(200,"{\"orderId\":\"ord_original\",\"originalOperation\":\"foreign\",\"state\":\"ISSUED\",\"phase\":\"terms_registered\",\"queryOnly\":true,\"fundsVerified\":false}")}
        do{try await api.readOriginalNativeIntent(nativeOrder);throw NSError(domain:"intent rebound",code:1)}catch ShopError.security{print("PASS foreign original operation cannot be adopted")}
        let fixtureURL=URL(fileURLWithPath:ProcessInfo.processInfo.environment["YNX_SHOP_NATIVE_RECEIPT_FIXTURE"]!)
        let originalNative=try JSONSerialization.jsonObject(with:Data(contentsOf:fixtureURL)) as! [String:Any]
        let nativeBuyer=originalNative["Buyer"] as! String
        let acceptedNative=try AppleBuyerReceipt.decode(originalNative,account:nativeBuyer)
        try check(acceptedNative.nativePayment?.RefundedAtoms=="30" && acceptedNative.nativePayment?.NetPaidAtoms=="70","actual dual-process Native return receipt renders exact partial refund")
        for key in ["InvoiceID","NetPaidAtoms","PaidAtoms","TermsHash"] {
            var changed=originalNative;var payment=changed["NativePayment"] as! [String:Any];payment[key]="foreign";changed["NativePayment"]=payment
            do{_ = try AppleBuyerReceipt.decode(changed,account:nativeBuyer);throw NSError(domain:"rebound Native projection",code:1)}catch ShopError.security{print("PASS Native projection rejects "+key)}
        }
        var missingNative=originalNative;missingNative.removeValue(forKey:"NativePayment")
        do{_ = try AppleBuyerReceipt.decode(missingNative,account:nativeBuyer);throw NSError(domain:"missing Native receipt",code:1)}catch ShopError.security{print("PASS Native paid state requires original projection")}
        var receiptCalls=0
        StubProtocol.handler={request in receiptCalls+=1;precondition(request.request.httpMethod=="POST" && request.request.url?.path=="/api/orders/ord_original/confirm-payment");precondition(request.request.value(forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2") != nil);request.respond()}
        try await api.confirmOriginalPayment(nativeOrder)
        try check(receiptCalls==1 && nativeOrder.status=="payment_pending","signed original receipt action awaits independent order refresh")
        authority.current=ShopSession.parse(try metadata(other))
        do{try await api.confirmOriginalPayment(nativeOrder);throw NSError(domain:"foreign receipt read",code:1)}catch ShopError.security{try check(receiptCalls==1,"foreign buyer cannot dispatch receipt confirmation")}
        authority.current=ShopSession.parse(try metadata(account))
        StubProtocol.handler={request in receiptCalls+=1;request.respond(409)}
        do{try await api.confirmOriginalPayment(nativeOrder);throw NSError(domain:"missing receipt accepted",code:1)}catch ShopError.invalidResponse{try check(nativeOrder.status=="payment_pending","missing receipt cannot confirm payment")}
        authority.current=ShopSession.parse(try metadata(account));let dispatchBaseline=dispatched
        do{_ = try await api.raw("orders",json:["IdempotencyKey":"original-admission"],beforeDispatch:{throw ShopError.security});throw NSError(domain:"admission dispatched",code:1)}catch ShopError.security{try check(dispatched==dispatchBaseline,"durable dispatch admission failure cannot send HTTP")}
        do{_ = try await api.raw("orders",json:["IdempotencyKey":"original-admission"],beforeDispatch:{api.invalidate()});throw NSError(domain:"late admission dispatched",code:1)}catch ShopError.contextChanged{try check(dispatched==dispatchBaseline,"context change in dispatch admission prevents HTTP")}
        urlSession.invalidateAndCancel();print("Controlled actual API source checks PASS; no real Native approval/device/public business")
    }
}
