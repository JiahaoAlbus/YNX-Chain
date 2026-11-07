import Foundation

@MainActor final class ComparisonAuthority:AppleNativeAuthority {
    var current:ShopSession?
    func restore()async throws{}
    func connect()async throws{throw ShopError.unavailable}
    func disconnect()throws{current=nil}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class ComparisonHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((ComparisonHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ value:Any)throws{let body=try JSONSerialization.data(withJSONObject:value);client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:body);client?.urlProtocolDidFinishLoading(self)}
    func loseAcknowledgement(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
    func body()throws->Data{if let body=request.httpBody{return body};guard let stream=request.httpBodyStream else{return Data()};stream.open();defer{stream.close()};var result=Data(),buffer=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&buffer,maxLength:buffer.count);guard n>=0 else{throw ShopError.invalidResponse};if n==0{break};result.append(contentsOf:buffer.prefix(n))};return result}
}
@main struct AgentModelChecks {
    @MainActor static func main()async throws {
        var checks=0
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func until(_ predicate:()->Bool)async throws{for _ in 0..<200_000{if predicate(){return};await Task.yield()};throw NSError(domain:"bounded asynchronous condition",code:1)}
        let account="ynx1"+String(repeating:"q",count:38)
        let authority=ComparisonAuthority();authority.current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
        var pending:[ComparisonHTTP]=[],paths:[String]=[]
        ComparisonHTTP.handler={request in
            let path=request.request.url!.path
            if path=="/api/products"{try! request.respond(["products":[["ID":"p","StoreID":"s","Title":"Real fixture","Variants":[["ID":"v","Name":"Original","PriceYNXT":9007199254740993,"Inventory":5]]]]]);return}
            if path=="/api/orders"{try! request.respond(["orders":[]]);return}
            precondition(path.hasPrefix("/api/ai/jobs"),"comparison attempted an unexpected business effect")
            precondition(request.request.value(forHTTPHeaderField:"Authorization")==nil)
            paths.append(request.request.httpMethod!+" "+path);pending.append(request)
        }
        func take(_ method:String,_ path:String)async throws->ComparisonHTTP{try await until{!pending.isEmpty};let value=pending.removeFirst();try check(value.request.httpMethod==method && value.request.url?.path=="/api/"+path,"dispatch uses exact original route "+method+" "+path);return value}
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[ComparisonHTTP.self]
        let api=APIClient(session:URLSession(configuration:configuration),authority:authority)
        var storage=["original-UNKNOWN":Data("original pending payment".utf8)],allowWrite=true
        let sentinel=storage["original-UNKNOWN"]
        let journal=ShopComparisonJournal(read:{storage[$0]},write:{guard allowWrite else{throw ShopError.security};storage[$0]=$1})
        let model=ShopModel(api:api,queue:OfflineQueue(read:{nil},write:{_ in},readPhase:{nil},writePhase:{_ in}),invoiceHandoffs:InvoiceHandoffJournal(read:{_ in nil},write:{_,_ in}),journey:AppleBuyerJourney(read:{storage[$0]},write:{storage[$0]=$1}),nativeInvoices:NativeInvoicePreparationJournal(read:{_ in nil},write:{_,_ in}),comparisonJournal:journal,localDataInitiallyLocked:false)
        try await until{model.signedIn && !model.products.isEmpty}
        model.prepareComparison()
        try check(model.agentPresentation != nil && paths.isEmpty,"opening comparison only proposes disclosure and never contacts AI")
        model.authorizeComparison();let create=try await take("POST","ai/jobs")
        let first=try journal.active(account)!,body=try create.body()
        try check(first.phase=="creation_unknown" && first.requestBody==body,"durable original body and UNKNOWN precede actual creation dispatch")
        create.loseAcknowledgement();try await until{!model.agentBusy}
        model.prepareComparison(ids:["p"])
        try check(model.agentWorkspaceVisible && model.agentPhase=="creation_unknown" && model.agentPresentation==nil,"reopening an unresolved original cannot mix new products with its disclosure")
        model.authorizeComparison();try check(paths.count==1,"missing new consent cannot resend unresolved creation")
        func job(_ phase:String,_ original:ShopComparisonJournal.Record,_ id:String)->[String:Any]{["ID":id,"Actor":account,"Workflow":"search_comparison","Status":phase,"ProviderStatus":"fixture","ContextSummary":original.contextSummary,"ContextClasses":["public_catalog"],"AllowedActions":["draft_comparison"],"EstimateUnits":1,"PermissionGranted":true,"Result":phase=="review_required" ? "Draft only":"","Failure":"","Applied":phase=="applied_draft","Rejected":phase=="rejected","Cancelled":phase=="cancelled"]}
        let id="ai_"+String(repeating:"a",count:24)
        model.refreshComparison();let lookup=try await take("POST","ai/jobs/intent-lookup")
        try check(try lookup.body()==body,"lost creation acknowledgement queries exact original frozen body")
        try lookup.respond(["Actor":account,"IdempotencyKey":first.key,"QueryOnly":true,"Job":job("permission_granted",first,id)])
        let list=try await take("GET","ai/jobs");try list.respond(["jobs":[job("permission_granted",first,id)],"Limit":50]);try await until{!model.agentBusy}
        try check(model.agentPhase=="permission_granted" && paths.filter{$0=="POST /api/ai/jobs"}.count==1,"recovery finds original creation without new create or implicit generation")
        model.runComparison();let run=try await take("POST","ai/jobs/"+id+"/run");run.loseAcknowledgement();try await until{!model.agentBusy}
        try check(model.agentPhase=="run_unknown","lost generation acknowledgement retains run UNKNOWN")
        func refresh(_ phase:String)async throws{model.refreshComparison();let read=try await take("GET","ai/jobs/"+id);try read.respond(job(phase,first,id));let recent=try await take("GET","ai/jobs");try recent.respond(["jobs":[job(phase,first,id)],"Limit":50]);try await until{!model.agentBusy}}
        try await refresh("permission_granted");try check(model.agentPhase=="run_unknown","read of old server state cannot enable another generation")
        model.runComparison();try await until{!model.agentBusy};try check(paths.filter{$0.hasSuffix("/run")}.count==1,"uncertain run cannot be repeated")
        try await refresh("review_required")
        model.decideComparison(apply:true);let decision=try await take("POST","ai/jobs/"+id+"/decision")
        try check(try JSONSerialization.jsonObject(with:decision.body()) as? [String:String]==["Decision":"apply"],"explicit decision sends only draft acceptance")
        decision.loseAcknowledgement();try await until{!model.agentBusy};try await refresh("applied_draft")
        try check(model.agentPhase=="applied_draft" && model.cart.isEmpty && model.orders.isEmpty,"recovered acceptance applies only draft and creates no cart, order or payment")
        model.prepareComparison();try check(model.agentJob==nil && model.agentPresentation != nil && model.agentPhase=="proposal","new proposal after completion clears previous job context")
        model.authorizeComparison();let secondCreate=try await take("POST","ai/jobs");let second=try journal.active(account)!,secondID="ai_"+String(repeating:"b",count:24)
        try secondCreate.respond(job("permission_granted",second,secondID));try await until{!model.agentBusy}
        model.runComparison();let held=try await take("POST","ai/jobs/"+secondID+"/run")
        model.cancelComparison();let cancel=try await take("POST","ai/jobs/"+secondID+"/cancel");try cancel.respond(job("cancelled",second,secondID));try await until{!model.agentBusy}
        try held.respond(job("review_required",second,secondID));for _ in 0..<1000{await Task.yield()}
        try check(model.agentPhase=="cancelled" && journal.records(account)[second.key]?.phase=="cancelled","cancel wins over late provider result without reviving generation")
        model.selectComparisonJob(try JSONDecoder().decode(ShopAgentJob.self,from:JSONSerialization.data(withJSONObject:job("applied_draft",first,id))))
        try check(model.agentPresentation==nil && model.agentJob?.jobID==id,"history selection clears unrelated current product proposal")
        model.prepareComparison();allowWrite=false;let before=paths.count;model.authorizeComparison();try await until{!model.agentBusy}
        try check(paths.count==before,"durable storage refusal prevents HTTP dispatch")
        allowWrite=true
        let unsent=try journal.prepare(account:account,summary:"Known undispatched disclosure")
        model.prepareComparison();model.discardPreparedComparison()
        try check(try journal.records(account)[unsent.key]?.phase=="cancelled" && model.agentPhase=="cancelled" && paths.count==before,"explicitly cancelling a known unsent disclosure preserves its record and sends no HTTP")
        let products=model.products;model.products=[];model.prepareComparison()
        try check(model.agentWorkspaceVisible && model.agentPresentation?.products.isEmpty==true,"empty catalog still opens original task history without fabricated products")
        model.authorizeComparison();try await until{!model.agentBusy};try check(paths.count==before,"empty comparison cannot authorize a generated job")
        model.products=products
        let prepared=try journal.prepare(account:account,summary:"Frozen original prepared context")
        model.agentWorkspaceVisible=false;model.prepareComparison()
        try check(model.agentWorkspaceVisible && model.agentPhase=="prepared" && model.agentPresentation?.contextSummary==prepared.contextSummary && model.agentPresentation?.products.isEmpty==true,"undispatched prepared proposal reopens its exact disclosure without fabricating product snapshots")
        model.authorizeComparison();let resumed=try await take("POST","ai/jobs")
        try check(try resumed.body()==prepared.requestBody,"explicit prepared recovery sends the existing frozen body and key")
        try resumed.respond(job("permission_granted",prepared,"ai_"+String(repeating:"c",count:24)));try await until{!model.agentBusy}
        let thirdID="ai_"+String(repeating:"c",count:24)
        model.runComparison();let completedRun=try await take("POST","ai/jobs/"+thirdID+"/run")
        model.cancelComparison();let uncertainCancel=try await take("POST","ai/jobs/"+thirdID+"/cancel")
        uncertainCancel.loseAcknowledgement();try await until{!model.agentBusy}
        try completedRun.respond(job("review_required",prepared,thirdID));for _ in 0..<1000{await Task.yield()}
        try check(model.agentPhase=="cancel_unknown","late run response leaves the original cancellation unconfirmed")
        model.refreshComparison();let completedRead=try await take("GET","ai/jobs/"+thirdID);try completedRead.respond(job("review_required",prepared,thirdID));let completedList=try await take("GET","ai/jobs");try completedList.respond(["jobs":[job("review_required",prepared,thirdID)],"Limit":50]);try await until{!model.agentBusy}
        try check(model.agentPhase=="review_required" && model.agentJob?.cancelled==false,"fresh original-job read recovers review after generation beat cancellation, without claiming cancellation succeeded")
        model.signOut()
        try check(!model.agentWorkspaceVisible && model.agentPresentation==nil && model.agentJob==nil,"sign-out closes the workspace and clears private presentation only")
        try check(try journal.active(account)?.jobID=="ai_"+String(repeating:"c",count:24),"sign-out retains the original durable comparison")
        try check(storage["original-UNKNOWN"]==sentinel && pending.isEmpty,"model preserves original payment UNKNOWN and issues no unrelated side effects")
        print("Actual Agent Model/API checks PASS \(checks); controlled fixtures only, no real provider, Keychain, Wallet or money")
    }
}
