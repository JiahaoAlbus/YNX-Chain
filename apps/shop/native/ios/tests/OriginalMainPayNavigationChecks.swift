import Foundation
@main struct OriginalMainPayNavigationChecks {
 @MainActor static func main() async throws {
  var checks=0
  func check(_ v:Bool,_ name:String)throws{guard v else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
  let operation="npi_"+String(repeating:"a",count:48),order="order_original",account="ynx1"+String(repeating:"q",count:38)
  let expected=ShopSession(account:account,token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
  var current=expected,statusCalls=0,invokes:[[String:String]]=[],failStatus=false,withdrawStatus=false,withdrawInvoke=false,wrongOperation=false,wrongOrder=false,fakeReview=false
  var retainedTermsFault:Int?
  let navigation=AppleOriginalMainPayNavigation(current:{current},status:{same in
   try check(same==expected,"status retains exact original Shop session outside wire input");statusCalls+=1
   if withdrawStatus{current=ShopSession(account:account,token:expected.token,expiresAt:expected.expiresAt,nativeGeneration:2)}
   if failStatus{return ["ok":false,"error":["code":"AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED"]]}
   return ["ok":true,"value":["normalMainEntry":true,"available":false,"canRequest":true,"paymentAuthorized":false]]
  },invoke:{input,same in
   try check(same==expected,"invoke retains same original session and never derives account aliases");invokes.append(input)
   if withdrawInvoke{current=ShopSession(account:account,token:expected.token,expiresAt:expected.expiresAt,nativeGeneration:3)}
   let merchant="0x"+String(repeating:"b",count:40)
   var reply:[String:Any]=["reference":["productId":"shop.order","sourceOrder":wrongOrder ? "foreign":order,"intentId":wrongOperation ? "npi_"+String(repeating:"c",count:48):operation,"merchant":merchant,"invoiceId":"invoice_original"],"intent":["intentId":operation,"originalOperation":operation,"state":"PREPARED"],"clientIndependentFinality":false,"queryOnly":true,"approvalRequired":false,"canRetry":false]
   if fakeReview{reply["walletRequest"]=["id":"not-a-read"]}
   if let fault=retainedTermsFault {
    let hash="0x"+String(repeating:"4",count:64),foreign="0x"+String(repeating:"5",count:64)
    var reference=reply["reference"] as! [String:String]
    reference["kind"]=fault==4 ? "invoice_settle":"invoice_terms"
    reference["nativeHash"]=fault==3 ? foreign:hash
    reply["reference"]=reference
    reply["intent"]=["intentId":operation,"originalOperation":operation,"state":"PREPARED","termsNativeHash":hash]
    reply["bill"]=["sourceOrder":fault==1 ? "foreign":order,"merchant":merchant,"invoiceId":"invoice_original","termsNativeHash":fault==2 ? foreign:hash]
    reply["recoveryOnly"]=fault != 5
    if fault==6{reply["paymentAuthorized"]=true}
   }
   return ["ok":true,"value":reply]
  })
  try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected)
  try check(invokes==[["action":"order-invoice","productId":"shop.order","sourceOrder":order]],"normal Swift consumer sends only fixed original order selector, no token merchant invoice or amount")
  try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected)
  try check(invokes.count==2 && invokes.last?["action"]=="order-invoice","explicit original recovery remains read-only without reconcile or resend")
  failStatus=true
  do{try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected);throw NSError(domain:"missing source accepted",code:1)}catch let error as OriginalMainPayRefusal{try check(error.code=="AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED" && invokes.count==2,"normal IPC protected refusal preserves exact code without invoke")};failStatus=false
  withdrawStatus=true
  do{try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected);throw NSError(domain:"status change accepted",code:1)}catch ShopError.contextChanged{try check(invokes.count==2,"generation drift during status prevents dispatch")};withdrawStatus=false;current=expected
  withdrawInvoke=true
  do{try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected);throw NSError(domain:"late change accepted",code:1)}catch ShopError.contextChanged{try check(invokes.count==3,"late original current withdrawal cannot adopt read result or retry")};withdrawInvoke=false;current=expected
  for fault in 0..<3 {
   wrongOperation=fault==0;wrongOrder=fault==1;fakeReview=fault==2
   do{try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected);throw NSError(domain:"rebound reply",code:1)}catch ShopError.security{try check(true,"wrong npi/order or unexpected review cannot become navigation success \(fault)")}
  }
  wrongOperation=false;wrongOrder=false;fakeReview=false
  retainedTermsFault=0
  try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected)
  try check(invokes.last?["action"]=="order-invoice","prepared original with retained terms opens read-only")
  for fault in 1...6 {
   retainedTermsFault=fault
   let before=invokes.count
   do{try await navigation.openOriginalOrder(order,originalOperation:operation,expected:expected);throw NSError(domain:"wrong retained terms accepted",code:1)}catch ShopError.security{try check(invokes.count==before+1,"retained terms mismatch or authorization is refused without retry \(fault)")}
  }
  retainedTermsFault=nil
  let before=invokes.count,calls=statusCalls
  do{try await navigation.openOriginalOrder("../foreign",originalOperation:operation,expected:expected);throw NSError(domain:"bad order sent",code:1)}catch ShopError.security{try check(invokes.count==before && statusCalls==calls,"malformed original selector is rejected before Main")}
  current=ShopSession(account:account,token:expected.token,expiresAt:"2000-01-01T00:00:00Z",nativeGeneration:1)
  do{try await navigation.openOriginalOrder(order,originalOperation:operation,expected:current);throw NSError(domain:"expired accepted",code:1)}catch ShopError.contextChanged{try check(invokes.count==before,"expired Shop context cannot call status or Main")}
  print("Original Main Swift navigation checks PASS \(checks); controlled authenticated-port fixture only, no actual standalone Main transport or Source approval")
 }
}
