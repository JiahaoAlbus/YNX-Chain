import Foundation
@main struct OriginalMainPayReconciliationChecks {
 @MainActor static func main()async throws {
  var checks=0
  func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
  let expected=ShopSession(account:"ynx1"+String(repeating:"q",count:38),token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
  let order="order_original",intent="npi_"+String(repeating:"a",count:48),hash="0x"+String(repeating:"b",count:64),abci="0x"+String(repeating:"c",count:64),merchant="0x"+String(repeating:"d",count:40)
  var current=expected,inputs:[[String:String]]=[],fault="",kind="invoice_refund",status="confirmed",drift=false
  let nav=AppleOriginalMainPayNavigation(current:{current},status:{_ in ["ok":true,"value":["normalMainEntry":true,"canRequest":true,"paymentAuthorized":false]]},invoke:{input,expectedOperation,_ in
   guard expectedOperation==intent else{throw ShopError.security}
   inputs.append(input)
   if drift{current=ShopSession(account:expected.account,token:expected.token,expiresAt:expected.expiresAt,nativeGeneration:2)}
   var ref:[String:Any]=["productId":"shop.order","sourceOrder":order,"intentId":intent,"nativeHash":hash,"merchant":merchant,"invoiceId":"invoice_original"]
   var original:[String:Any]=["merchant":merchant,"invoiceId":"invoice_original","nativeHash":hash,"abciHash":abci,"kind":kind,"owner":kind=="invoice_settle" ? "0x"+String(repeating:"e",count:40):merchant,"status":status]
   var bill:[String:Any]=["merchant":merchant,"invoiceId":"invoice_original","sourceOrder":order]
   var result:[String:Any]=["clientIndependentFinality":false,"canRetry":false,"approvalRequired":false,"queryOnly":true]
   switch fault{
   case "order":ref["sourceOrder"]="foreign"
   case "intent":ref["intentId"]="npi_"+String(repeating:"f",count:48)
   case "hash":ref["nativeHash"]=abci
   case "abci":original["abciHash"]="malformed"
   case "owner":original["owner"]=kind=="invoice_settle" ? merchant:"0x"+String(repeating:"e",count:40)
   case "kind":original["kind"]="invoice_cancel"
   case "status":original["status"]="paid"
   case "bill":bill["invoiceId"]="other"
   case "query":result["queryOnly"]=false
   case "retry":result["canRetry"]=true
   case "review":result["walletRequest"]=["id":"bad"]
   case "approval":result["approvalRequired"]=true
   case "finality":result["clientIndependentFinality"]=true
   default:break
   }
   result["reference"]=ref;result["reconciledOriginal"]=original;result["bill"]=bill
   var operations=[original]
   if fault=="duplicate"{operations.append(original)}
   if fault=="operation"{var other=original;other["abciHash"]=hash;operations=[other]}
   result["operations"]=operations
   return ["ok":true,"value":result]
  })
  for actionKind in ["invoice_terms","invoice_settle","invoice_refund"]{
   kind=actionKind
   for value in ["unknown","submitted","confirmed","confirmed_failed"]{status=value;try await nav.reconcileOriginalOrderOperation(order,originalOperation:intent,nativeHash:hash,expected:expected);try check(inputs.last==["action":"order-reconcile-operation","productId":"shop.order","sourceOrder":order,"nativeHash":hash],"existing same-hash action accepted as nonfinancial observation "+kind+"/"+status)}
  }
  for value in ["order","intent","hash","abci","owner","kind","status","bill","query","retry","review","approval","finality","duplicate","operation"]{
   fault=value
   do{try await nav.reconcileOriginalOrderOperation(order,originalOperation:intent,nativeHash:hash,expected:expected);throw NSError(domain:"rebound operation accepted",code:1)}catch ShopError.security{try check(true,"rebound original or false success refused "+value)}
  }
  fault="";let count=inputs.count
  do{try await nav.reconcileOriginalOrderOperation(order,originalOperation:intent,nativeHash:"../another",expected:expected);throw NSError(domain:"malformed selected hash accepted",code:1)}catch ShopError.security{try check(inputs.count==count,"malformed original hash is rejected before Main")}
  drift=true
  do{try await nav.reconcileOriginalOrderOperation(order,originalOperation:intent,nativeHash:hash,expected:expected);throw NSError(domain:"late context accepted",code:1)}catch ShopError.contextChanged{try check(true,"retired context cannot adopt reconciliation or replay")}
  print("Original Main reconciliation checks PASS \(checks); controlled fixed action only, no real host, Core proof execution, signing or funds")
 }
}
