import Foundation

final class LinkHTTP:URLProtocol,@unchecked Sendable {
 @MainActor static var handler:((LinkHTTP)->Void)?
 override class func canInit(with request:URLRequest)->Bool{true}
 override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
 override func startLoading(){Task{@MainActor in Self.handler?(self)}}
 override func stopLoading(){}
 func respond(_ body:String,_ status:Int=200){client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)}
}
@MainActor final class LinkAuthority:AppleNativeAuthority {
 var current:ShopSession?
 var beforeProof:(()throws->Void)?
 func restore()async throws{}
 func connect()async throws{throw ShopError.unavailable}
 func handleReturn(_ url:URL)async throws{throw ShopError.security}
 func disconnect()throws{current=nil}
 func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};try beforeProof?();return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
@main struct OriginalOrderLinkChecks {
 @MainActor static func main()async throws {
  let account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38)
  func link(_ id:String,_ actor:String)->String{"ynxshop://orders/\(id)?account=\(actor)&chainId=ynx_6423-1"}
  func check(_ yes:Bool,_ label:String)throws{guard yes else{throw NSError(domain:label,code:1)};print("PASS "+label)}
  func wait(_ predicate:()->Bool)async throws{for _ in 0..<500{if predicate(){return};try await Task.sleep(for:.milliseconds(5))};throw NSError(domain:"link response timeout",code:1)}
  try check(try OriginalOrderLink.parse(link("order:original",account)).orderID=="order:original","canonical colon original order accepted")
  for raw in [link("order%3Aoriginal",account),link("../order",account),link("a/b",account),link("o",account)+"&paid=true",link("o",account)+"#approved",link("o",account).replacingOccurrences(of:"6423",with:"1"),link("o",account).replacingOccurrences(of:"?account=",with:"?account=\(other)&account="),link("o",account).replacingOccurrences(of:"orders/",with:"user@orders/"),link("o",account).replacingOccurrences(of:"orders/",with:"orders:443/"),"ynxshop://orders/","ynxshop://orders",link("o",account).replacingOccurrences(of:"ynxshop",with:"https"),link("o",account)+"\n"] {
   do{_ = try OriginalOrderLink.parse(raw);throw NSError(domain:"alias accepted",code:1)}catch ShopError.security{}
  }
  print("PASS encoded aliases, injected authority/amount, other network, duplicate fields and fragments refused")
  let authority=LinkAuthority();authority.current=ShopSession(account:account,token:String(repeating:"a",count:43),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
  let cfg=URLSessionConfiguration.ephemeral;cfg.protocolClasses=[LinkHTTP.self];let http=URLSession(configuration:cfg);let api=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:http,authority:authority)
  var rows:[String:Data]=[:];let queue=OfflineQueue(read:{rows["queue"]},write:{rows["queue"]=$0},readPhase:{rows["phase"]},writePhase:{rows["phase"]=$0});let pending=try queue.prepareUnsent(account:account,path:"orders/original/transition",input:["Status":"cancelled"]);try queue.beginDispatch(pending);try queue.markUnknown(pending)
  let saved=rows;let journal=InvoiceHandoffJournal(read:{rows[$0]},write:{rows[$0]=$1});let journey=AppleBuyerJourney(read:{rows[$0]},write:{rows[$0]=$1})
  var requests:[LinkHTTP]=[]
  LinkHTTP.handler={request in
   if request.request.url!.path=="/api/products"{request.respond("{\"products\":[]}");return}
   if request.request.url!.path=="/api/orders"{request.respond("{\"orders\":[]}");return}
   precondition(request.request.httpMethod=="GET" && request.request.httpBody==nil && request.request.value(forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2") != nil);requests.append(request)
  }
  let model=ShopModel(api:api,queue:queue,invoiceHandoffs:journal,journey:journey);try await wait{model.signedIn}
  let fixture=try Data(contentsOf:URL(fileURLWithPath:ProcessInfo.processInfo.environment["YNX_SHOP_NATIVE_RECEIPT_FIXTURE"]!));var json=try JSONSerialization.jsonObject(with:fixture) as! [String:Any];json["WalletBuyer"]=account;let id=json["ID"] as! String;let body=String(data:try JSONSerialization.data(withJSONObject:json),encoding:.utf8)!
  model.walletCallback(URL(string:link(id,account))!);try await wait{requests.count==1};try check(requests[0].request.url!.path=="/api/orders/\(id)","normal Model target invokes original exact signed Shop GET without local review")
  requests[0].respond(body);try await wait{model.linkedOriginalOrder != nil};try check(model.linkedOriginalOrder?.nativePayment?.RefundedAtoms=="30" && rows==saved,"real Native partial-refund readback preserves all UNKNOWN journals without POST")
  model.closeOriginalOrderLink();model.walletCallback(URL(string:link(id,other))!);try await Task.sleep(for:.milliseconds(20));try check(requests.count==1 && model.originalOrderLink==nil,"foreign account link cannot dispatch")
  model.walletCallback(URL(string:link("wrong",account))!);try await wait{requests.count==2};requests[1].respond(body);try await wait{!model.originalOrderLoading};try check(model.linkedOriginalOrder==nil,"owned but rebound target cannot be displayed")
  model.walletCallback(URL(string:link("old",account))!);try await wait{requests.count==3};model.walletCallback(URL(string:link(id,account))!);try await wait{requests.count==4};requests[3].respond(body);try await wait{model.linkedOriginalOrder != nil};requests[2].respond(body);try await Task.sleep(for:.milliseconds(20));try check(model.linkedOriginalOrder?.orderID==id,"late previous link cannot replace current original target")
  model.walletCallback(URL(string:link(id,account))!);try await wait{requests.count==5};authority.current=ShopSession(account:other,token:String(repeating:"b",count:43),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:2);api.onSessionChanged?();requests[4].respond(body);try await Task.sleep(for:.milliseconds(20));try check(model.originalOrderLink==nil && model.linkedOriginalOrder==nil && rows==saved,"account replacement drops late private read while original UNKNOWN bytes survive")
  authority.current=ShopSession(account:account,token:String(repeating:"a",count:43),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:3);api.onSessionChanged?();authority.beforeProof={model.closeOriginalOrderLink()};model.walletCallback(URL(string:link(id,account))!);try await Task.sleep(for:.milliseconds(30));try check(requests.count==5 && model.originalOrderLink==nil,"dismissal during original proof prevents HTTP dispatch")
  authority.beforeProof=nil;model.signOut();model.walletCallback(URL(string:link(id,account))!);try await Task.sleep(for:.milliseconds(20));try check(requests.count==5 && model.originalOrderLink==nil,"signed-out link cannot establish session or fetch order")
  let coldAuthority=LinkAuthority();coldAuthority.current=ShopSession(account:account,token:String(repeating:"c",count:43),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:4)
  let coldAPI=APIClient(base:URL(string:"https://shop.ynxweb4.com/api")!,session:http,authority:coldAuthority)
  let cold=ShopModel(api:coldAPI,queue:queue,invoiceHandoffs:journal,journey:journey)
  cold.walletCallback(URL(string:link(id,account))!)
  try await wait{requests.count==6};requests[5].respond(body);try await wait{cold.linkedOriginalOrder != nil}
  try check(cold.linkedOriginalOrder?.orderID==id && rows==saved,"cold launch queues only navigation until original Native session restore then GETs original order")
  cold.signOut()
  http.invalidateAndCancel();print("Original Shop link actual Model/API checks PASS; protected Native installation and Root admission not supplied")
 }
}
