import Foundation
@MainActor final class InvitationAuthority:AppleNativeAuthority {
    var current:ShopSession?
    let account="ynx1"+String(repeating:"q",count:38)
    func restore()async throws{}
    func connect()async throws{current=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)}
    func disconnect()throws{current=nil}
    func handleReturn(_ url:URL)async throws{throw ShopError.unavailable}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};_ = try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller);return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class InvitationHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var handler:((InvitationHTTP)->Void)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in Self.handler?(self)}}
    override func stopLoading(){}
    func respond(_ body:Any)throws{client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:try JSONSerialization.data(withJSONObject:body));client?.urlProtocolDidFinishLoading(self)}
    func lost(){client?.urlProtocol(self,didFailWithError:URLError(.networkConnectionLost))}
    func body()throws->[String:Any]{var data=request.httpBody ?? Data();if data.isEmpty,let stream=request.httpBodyStream{stream.open();defer{stream.close()};var b=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&b,maxLength:b.count);guard n>=0 else{throw ShopError.security};if n==0{break};data.append(contentsOf:b.prefix(n))}};return try JSONSerialization.jsonObject(with:data) as! [String:Any]}
}
@main struct SellerInvitationChecks {
 @MainActor static func main() async throws {
  var checks=0
  func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
  func until(_ value:()->Bool)async throws{for _ in 0..<200_000{if value(){return};await Task.yield()};throw NSError(domain:"invitation flow timeout",code:1)}
  let auth=InvitationAuthority(),storeID="invitation_store_original",time="2026-11-07T00:00:00Z"
  var inbox:[[String:Any]]=[],stores:[[String:Any]]=[],pending:[InvitationHTTP]=[],writes=0
  var row:[String:Any]=["ID":"invitation_original","StoreID":storeID,"Account":auth.account,"Role":"support","CreatedBy":"original-owner","Status":"pending","Reason":"","CreatedAt":time,"UpdatedAt":time,"ExpiresAt":"2099-01-01T00:00:00Z","AcceptedAt":"0001-01-01T00:00:00Z","CancelledAt":"0001-01-01T00:00:00Z"]
  inbox=[row]
  InvitationHTTP.handler={r in
   let path=r.request.url!.path
   if r.request.httpMethod != "GET"{writes+=1;pending.append(r);return}
   switch path {
   case "/api/seller/invitations":try! r.respond(["invitations":inbox])
   case "/api/seller/stores":try! r.respond(["stores":stores,"access":stores.isEmpty ? [:]:[storeID:["role":"support","permissions":["seller.read","team.read"]]]])
   case "/api/seller/products":try! r.respond(["products":[]])
   case "/api/seller/orders":try! r.respond(["orders":[]])
   case "/api/seller/stores/"+storeID+"/roles":try! r.respond(["roles":[auth.account:"support"],"revocations":[],"invitations":[]])
   case "/api/seller/audit":try! r.respond(["events":[]])
   case "/api/seller/settlements":try! r.respond(["settlements":[]])
   default:preconditionFailure(path)
   }
  }
  let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[InvitationHTTP.self]
  let api=APIClient(session:URLSession(configuration:config),authority:auth)
  var saved=[String:Data]();let journal=SellerMutationJournal(read:{saved[$0]},write:{saved[$0]=$1})
  let model=ShopSellerModel(api:api,journal:journal)
  model.connect();try await until{model.signedIn && !model.busy};try check(model.stores.isEmpty && writes==0,"no-store target is not assigned a role automatically")
  model.loadInvitationInbox();try await until{!model.busy};try check(model.receivedInvitations.count==1 && writes==0,"actual account invitation read works before any Store membership")
  let invitation=model.receivedInvitations[0]
  model.perform(.invitationDecision(invitation,accept:false,reason:"Not an owner"));try check(writes==0,"invited target cannot cancel as owner")
  model.perform(.invitationDecision(invitation,accept:true,reason:""));try await until{pending.count==1}
  let request=pending.removeFirst(),body=try request.body(),original=try journal.records(auth.account).values.first!
  try check(request.request.url!.path=="/api/seller/stores/"+storeID+"/invitations/"+invitation.ID+"/native-accept","explicit decision uses the actual fixed original invitation route")
  try check(body["ExpectedAccount"] as? String==auth.account && body["ExpectedRole"] as? String=="support" && body["ExpectedUpdatedAt"] as? String==time && original.storeID==storeID && original.phase=="unknown","immutable decision freezes reviewed account role Store and version before HTTP")
  request.lost();try await until{!model.busy};try check(model.stores.isEmpty && model.invitationPending(invitation),"lost acknowledgement does not grant local membership")
  model.perform(.invitationDecision(invitation,accept:true,reason:""));try check(pending.isEmpty && writes==1,"UNKNOWN cannot be dispatched again from invitation controls")
  let cold=ShopSellerModel(api:api,journal:SellerMutationJournal(read:{saved[$0]},write:{saved[$0]=$1}))
  cold.connect();try await until{cold.signedIn && !cold.busy};cold.recoverOriginals();try await until{pending.count==1}
  let lookup=pending.removeFirst(),query=try lookup.body()
  try check(lookup.request.url!.path=="/api/seller/mutations/lookup" && query["OriginalBody"] as? String==String(data:original.body,encoding:.utf8),"cold recovery queries only the retained original body with no replay")
  row["Status"]="accepted";row["AcceptedAt"]=time;row["UpdatedAt"]=time;inbox=[row]
  stores=[["ID":storeID,"Owner":"original-owner","Name":"Inviting Store","Description":"","Policy":"Actual terms","TrustURL":"","SettlementAccount":"","Status":"active","CreatedAt":time,"UpdatedAt":time]]
  try lookup.respond(["Actor":auth.account,"Method":"POST","Path":original.path,"IdempotencyKey":original.key,"Result":["Invitation":row,"OriginalApplied":true,"QueryOnly":true]])
  try await until{!cold.busy && cold.stores.count==1}
  try check(cold.storeRole=="support" && !cold.canManageMembers && cold.pendingOriginalCount==0,"recovered acceptance adopts only the fresh real Store role without owner escalation")
  try check(try journal.records(auth.account)[original.key]?.phase=="confirmed","actual original confirmation durably resolves the journal")
  try check(writes==2 && pending.isEmpty,"only one decision dispatch and one original lookup occurred")
  cold.loadInvitationInbox();try await until{!cold.busy};try check(cold.receivedInvitations.first?.Status=="accepted","inbox keeps the actual accepted history")
  inbox=[row.merging(["Account":"foreign-account"]){_,new in new}];cold.loadInvitationInbox();try await until{!cold.busy};try check(cold.receivedInvitations.isEmpty && cold.state=="unavailable","foreign account rows are refused rather than displayed")
  cold.disconnect();try check(cold.receivedInvitations.isEmpty && !cold.signedIn,"signout clears invitation views without deleting original history")
  print("Actual Seller invitation checks PASS \(checks); controlled fixture only, no real membership or Wallet authorization")
 }
}
