import Foundation

final class StubProtocol:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((StubProtocol)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ status:Int=200,_ body:String="{}"){let response=HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!;client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)}
}
@main struct BoundaryTests {
    @MainActor static func main()async throws{
        let account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38)
        func metadata(_ actor:String,expiry:Date=Date().addingTimeInterval(3600))throws->Data{try JSONEncoder().encode(ShopSession(account:actor,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:expiry)))}
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};print("PASS "+name)}
        try check(ShopSession.parse(Data("original-bare-token".utf8))==nil,"bare token cannot create active session")
        try check(ShopSession.parse(try metadata(account))?.account==account,"actual typed account and expiry context")
        try check(ShopSession.parse(try metadata(account,expiry:Date().addingTimeInterval(-1)))==nil,"expired context rejected")
        let pending=Data("original approved request".utf8),fresh=Data("fresh explicit request".utf8)
        try check(!PendingApproval.permits(pending,active:nil,cancelled:nil),"unbound legacy pending cannot be silently adopted")
        try check(!PendingApproval.permits(pending,active:PendingApproval.digest(pending),cancelled:PendingApproval.digest(pending)),"signed-out original callback remains cancelled after restart")
        try check(PendingApproval.permits(fresh,active:PendingApproval.digest(fresh),cancelled:PendingApproval.digest(pending)),"fresh explicit pending remains distinct from cancelled original")
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
        var current:Data?=try metadata(account);let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[StubProtocol.self];let urlSession=URLSession(configuration:config);let api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:urlSession,readSession:{current})
        StubProtocol.handler={request in precondition(request.request.value(forHTTPHeaderField:"Authorization")==nil);request.respond(200,"{\"products\":[]}")};_ = try await api.data("products");print("PASS public catalog sends no bearer")
        StubProtocol.handler={request in precondition(request.request.value(forHTTPHeaderField:"Authorization")=="Bearer "+String(repeating:"t",count:32));request.respond()};_ = try await api.data("orders");print("PASS private request uses only validated typed context")
        var deferred:StubProtocol?;var ready:CheckedContinuation<Void,Never>?
        StubProtocol.handler={request in deferred=request;ready?.resume();ready=nil}
        let late=Task{try await api.data("orders")};await withCheckedContinuation{ready=$0};current=try metadata(other);deferred?.respond(200,"{\"oldActor\":true}")
        do{_ = try await late.value;throw NSError(domain:"old actor adopted",code:1)}catch ShopError.contextChanged{print("PASS late response after account change rejected")}
        let logout=Task{try await api.data("orders")};await withCheckedContinuation{ready=$0};api.invalidate();deferred?.respond()
        do{_ = try await logout.value;throw NSError(domain:"late logout adopted",code:1)}catch ShopError.contextChanged{print("PASS late response after logout rejected")}
        StubProtocol.handler={request in request.respond(401,"{\"error\":\"expired\"}")};do{_ = try await api.data("orders");throw NSError(domain:"401 adopted",code:1)}catch ShopError.signedOut{print("PASS authoritative 401 remains signout signal")}
        current=nil;do{_ = try await api.data("orders");throw NSError(domain:"unauthorized dispatch",code:1)}catch ShopError.signedOut{print("PASS missing account context prevents private dispatch")}
        for path in ["../orders","https://foreign.invalid/api/orders","/orders"]{do{_ = try await api.data(path);throw NSError(domain:"foreign route",code:1)}catch ShopError.unavailable{print("PASS route boundary "+path)}}
        let redirect=ShopRedirectPolicy();var redirectResult:URLRequest?=URLRequest(url:URL(string:"https://foreign.invalid/")!);redirect.urlSession(urlSession,task:urlSession.dataTask(with:URL(string:"https://shop.ynxweb4.com/api/orders")!),willPerformHTTPRedirection:HTTPURLResponse(url:URL(string:"https://shop.ynxweb4.com/api/orders")!,statusCode:307,httpVersion:nil,headerFields:nil)!,newRequest:URLRequest(url:URL(string:"https://foreign.invalid/")!),completionHandler:{redirectResult=$0});try check(redirectResult==nil,"redirect cannot forward credentials or private body")
        urlSession.invalidateAndCancel();print("22 boundary checks PASS; controlled compatibility transport, not canonical Native approval or installed app acceptance")
    }
}
