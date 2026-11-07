import Foundation
@MainActor final class ProfileAuthority:AppleNativeAuthority {
    var current:ShopSession?
    let account="ynx1"+String(repeating:"q",count:38)
    func restore()async throws{}
    func connect()async throws{current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)}
    func disconnect()throws{current=nil}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};_ = try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller);return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class ProfileHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((ProfileHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ body:Any)throws{client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:try JSONSerialization.data(withJSONObject:body));client?.urlProtocolDidFinishLoading(self)}
    func lost(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
    func body()throws->[String:Any]{var data=request.httpBody ?? Data();if data.isEmpty,let stream=request.httpBodyStream{stream.open();defer{stream.close()};var b=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&b,maxLength:b.count);guard n>=0 else{throw ShopError.security};if n==0{break};data.append(contentsOf:b.prefix(n))}};return try JSONSerialization.jsonObject(with:data) as! [String:Any]}
}
@main struct SellerStoreProfileChecks {
 @MainActor static func main()async throws {
  var checks=0
  func check(_ value:Bool,_ label:String)throws{guard value else{throw NSError(domain:label,code:1)};checks+=1;print("PASS "+label)}
  func until(_ value:()->Bool)async throws{for _ in 0..<200_000{if value(){return};await Task.yield()};throw NSError(domain:"bounded profile flow",code:1)}
  let auth=ProfileAuthority(),id="original_profile_store",time="2026-11-07T00:00:00Z"
  let initial:[String:Any]=["ID":id,"Owner":auth.account,"Name":"Original shop","Description":"Original description","Policy":"Original policy","TrustURL":"","SettlementAccount":auth.account,"Status":"onboarding","CreatedAt":time,"UpdatedAt":time]
  var store=initial,pending:[ProfileHTTP]=[],writes=0
  ProfileHTTP.handler={r in
   if r.request.httpMethod != "GET"{writes+=1;pending.append(r);return}
   switch r.request.url!.path {
   case "/api/seller/stores":try! r.respond(["stores":[store],"access":[id:["role":"owner","permissions":["seller.read","team.read"]]]])
   case "/api/seller/products":try! r.respond(["products":[]])
   case "/api/seller/orders":try! r.respond(["orders":[]])
   case "/api/seller/stores/"+id+"/roles":try! r.respond(["roles":[auth.account:"owner"],"revocations":[],"invitations":[]])
   case "/api/seller/audit":try! r.respond(["events":[]])
   case "/api/seller/settlements":try! r.respond(["settlements":[]])
   default:preconditionFailure(r.request.url!.path)
   }
  }
  let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[ProfileHTTP.self]
  let api=APIClient(session:URLSession(configuration:config),authority:auth)
  var saved=["original-pay-UNKNOWN":Data("preserved".utf8)]
  let journal=SellerMutationJournal(read:{saved[$0]},write:{saved[$0]=$1});let model=ShopSellerModel(api:api,journal:journal)
  model.connect();try await until{model.signedIn && !model.busy};let snapshot=model.stores[0]
  try check(writes==0 && model.canManageMembers,"reading the actual owner profile creates no edit")
  store["Policy"]="Unseen policy at same timestamp";model.refresh();try await until{!model.busy}
  model.perform(.updateStore(snapshot,name:"Reviewed",description:"Reviewed description",policy:"Reviewed policy",trustURL:"",settlementAccount:auth.account))
  try check(writes==0 && (try journal.records(auth.account)).isEmpty,"changed original snapshot is refused before preparation and HTTP even at same timestamp")
  store=initial;model.refresh();try await until{!model.busy}
  model.perform(.updateStore(snapshot,name:"Reviewed",description:"",policy:"Reviewed policy",trustURL:"https://user:secret@example.com/evidence",settlementAccount:auth.account))
  try check(writes==0,"userinfo trust URLs are rejected before HTTP")
  model.perform(.updateStore(snapshot,name:"Reviewed",description:"Reviewed description",policy:"Reviewed policy",trustURL:"https://example.com/evidence",settlementAccount:auth.account));try await until{pending.count==1}
  let edit=pending.removeFirst(),body=try edit.body(),original=try journal.records(auth.account).values.first!
  try check(edit.request.url!.path=="/api/seller/stores/"+id+"/native-profile" && original.kind=="update-store" && original.phase=="unknown","profile uses exact original route and durable UNKNOWN before dispatch")
  let expected=body["Expected"] as! [String:Any],update=body["Update"] as! [String:Any]
  try check(expected["Policy"] as? String=="Original policy" && expected["Status"] as? String=="onboarding" && expected["Owner"] as? String==auth.account && expected["UpdatedAt"] as? String==time,"review freezes actual original owner profile status and timestamps")
  try check(update["Name"] as? String=="Reviewed" && update["IdempotencyKey"] as? String=="","new reviewed values use only the outer original operation key")
  edit.lost();try await until{!model.busy};try check(model.hasPending(id) && model.stores[0].Name=="Original shop","lost receipt preserves pending target and old displayed read")
  model.perform(.updateStore(snapshot,name:"Replacement after loss",description:"",policy:"Replacement",trustURL:"",settlementAccount:auth.account));try check(pending.isEmpty && writes==1,"UNKNOWN cannot be replaced or replayed by a new form")
  // Original edit happened, then a newer independent owner edit happened.
  store["Name"]="Newer current shop";store["Policy"]="Newer current terms"
  model.recoverOriginals();try await until{pending.count==1};let query=pending.removeFirst(),queryBody=try query.body()
  try check(query.request.url!.path=="/api/seller/mutations/lookup" && queryBody["OriginalBody"] as? String==String(data:original.body,encoding:.utf8),"recovery queries the frozen original without mutation replay")
  try query.respond(["Actor":auth.account,"Method":"POST","Path":original.path,"IdempotencyKey":original.key,"Result":["Store":store,"Applied":update,"OriginalApplied":true,"QueryOnly":true]])
  try await until{!model.busy && !model.hasPending(id)}
  try check(model.stores[0].Name=="Newer current shop" && model.stores[0].Policy=="Newer current terms","historical applied fields never overwrite newer actual Store data")
  try check(try journal.records(auth.account)[original.key]?.phase=="confirmed","matching original profile receipt resolves durable journal")
  try check(writes==2 && pending.isEmpty && saved["original-pay-UNKNOWN"]==Data("preserved".utf8),"one dispatch one lookup and unrelated original payment UNKNOWN retained")
  print("Actual Seller Store profile checks PASS \(checks); controlled fixture, no actual merchant authorization or payout")
 }
}
