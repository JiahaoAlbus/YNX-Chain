import Foundation

@MainActor final class NativeCreationAuthority:AppleNativeAuthority {
 var current:ShopSession?
 func restore()async throws{};func connect()async throws{};func handleReturn(_ url:URL)async throws{throw ShopError.security};func disconnect()throws{current=nil}
 func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
@MainActor final class NativeCreationNavigation:AppleOriginalNativePayNavigation {
 var references:[String]=[]
 func openOriginalIntent(_ operation:String,expected:ShopSession)async throws{references.append(operation);throw ShopError.unavailable}
}
final class NativeCreationHTTP:URLProtocol,@unchecked Sendable {
 @MainActor static var handle:((NativeCreationHTTP)->Void)?
 override class func canInit(with request:URLRequest)->Bool{true};override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
 override func startLoading(){Task{@MainActor in Self.handle?(self)}};override func stopLoading(){}
 func respond(_ value:Any){let data=try! CanonicalJSON.data(value);client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)}
}
@main struct NativeInvoiceJourneyChecks {
 @MainActor static func main()async throws {
  func check(_ yes:Bool,_ name:String)throws{guard yes else{throw NSError(domain:name,code:1)};print("PASS "+name)}
  func wait(_ predicate:()->Bool)async throws{for _ in 0..<300{if predicate(){return};try await Task.sleep(nanoseconds:10_000_000)};throw NSError(domain:"native model timeout",code:1)}
  let account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38),operation="npi_"+String(repeating:"ab",count:24)
  var saved:[String:Data]=[:],draft:[String:Data]=[:],queue:Data?,creates=0,lookups=0;var originalKey:String?
  let journal=NativeInvoicePreparationJournal(read:{saved[$0]},write:{saved[$0]=$1})
  let orderJSON:[String:Any]=["ID":"ord_native","Buyer":account,"StoreID":"store_original","Status":"payment_pending","TotalYNXT":8,"Currency":"YNXT"]
  let order=try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(orderJSON))
  let session=ShopSession(account:account,token:String(repeating:"t",count:43),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)))
  let authority=NativeCreationAuthority();authority.current=session;let nav=NativeCreationNavigation()
  let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[NativeCreationHTTP.self];let http=URLSession(configuration:config)
  NativeCreationHTTP.handle={request in let path=request.request.url!.path
   if path=="/api/products"{request.respond(["products":[]])}
   else if path=="/api/orders"{request.respond(["orders":[orderJSON]])}
   else if path=="/api/orders/ord_native/native-pay-intent"{creates+=1;let raw=request.request.httpBody ?? request.request.httpBodyStream.flatMap{stream->Data? in stream.open();defer{stream.close()};var result=Data();var b=[UInt8](repeating:0,count:1024);while stream.hasBytesAvailable{let n=stream.read(&b,maxLength:b.count);if n<=0{break};result.append(contentsOf:b.prefix(n))};return result} ?? Data();originalKey=(try? JSONSerialization.jsonObject(with:raw) as? [String:Any])?["IdempotencyKey"] as? String;request.client?.urlProtocol(request,didFailWithError:URLError(.networkConnectionLost))}
   else if path=="/api/orders/ord_native/native-pay-intent-lookup"{lookups+=1;request.respond(["orderId":"ord_native","originalOperation":operation,"state":"PREPARED","phase":"awaiting_merchant_approval","queryOnly":true,"fundsVerified":false])}
   else{request.respond(orderJSON)}
  }
  func model(_ value:NativeInvoicePreparationJournal)->ShopModel{ShopModel(api:APIClient(base:URL(string:"https://shop-api.ynxweb4.com/api")!,session:http,authority:authority,nativePayNavigation:nav),queue:OfflineQueue(read:{queue},write:{queue=$0}),invoiceHandoffs:InvoiceHandoffJournal(read:{draft[$0]},write:{draft[$0]=$1}),journey:AppleBuyerJourney(read:{draft[$0]},write:{draft[$0]=$1}),nativeInvoices:value)}
  let first=model(journal);try await wait{first.signedIn};first.pay(order);try await wait{!first.mutationBusy && creates==1}
  let pending=try journal.records(account)[order.orderID]!;try check(pending.phase=="unknown" && pending.key==originalKey,"actual model persists original key and UNKNOWN before losing create response")
  let cold=NativeInvoicePreparationJournal(read:{saved[$0]},write:{saved[$0]=$1});let second=model(cold);try await wait{second.signedIn};second.sceneActive();try await wait{(try? cold.records(account)[order.orderID]?.phase)=="reference"}
  try check(creates==1 && lookups>=1 && nav.references.isEmpty,"cold model performs original lookup only and never opens Main or recreates")
  second.pay(order);try await wait{!second.mutationBusy && nav.references.count==1}
  try check(try cold.records(account)[order.orderID]?.originalOperation==operation && nav.references==[operation] && creates==1,"explicit original Main navigation unavailable preserves same persisted intent and no resend")
  try check(try cold.records(other).isEmpty,"Native intent references isolated from another account")
  let prior=saved;var changed=orderJSON;changed["TotalYNXT"]=9;let repriced=try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(changed));do{_ = try cold.prepare(repriced,account:account,legacyPending:false);throw NSError(domain:"reprice accepted",code:1)}catch ShopError.unresolvedMutation{try check(saved==prior,"changed checkout cannot replace original Native bill/key")}
  http.invalidateAndCancel();print("Actual product persistence/API/model/navigation port checks PASS; no real Main approval/Source/funds")
 }
}
