import Foundation
import CryptoKit
@main struct OriginalMainPayReviewChecks {
 @MainActor static func main() async throws {
  var count=0
  func check(_ value:Bool,_ text:String)throws{guard value else{throw NSError(domain:text,code:1)};count+=1;print("PASS "+text)}
  let operation="npi_"+String(repeating:"a",count:48),order="order_original",merchant="0x"+String(repeating:"b",count:40)
  let expected=ShopSession(account:"ynx1"+String(repeating:"q",count:38),token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
  var current=expected,inputs:[[String:String]]=[],fault="",drift=false
  let nav=AppleOriginalMainPayNavigation(current:{current},status:{_ in ["ok":true,"value":["normalMainEntry":true,"canRequest":true,"available":false,"paymentAuthorized":false]]},invoke:{input,session in
   guard session==expected else{throw ShopError.contextChanged};inputs.append(input)
   if drift{current=ShopSession(account:expected.account,token:expected.token,expiresAt:expected.expiresAt,nativeGeneration:2)}
   var ref:[String:Any]=["productId":"shop.order","sourceOrder":order,"intentId":operation,"merchant":merchant,"invoiceId":"invoice_original"]
   if let refund=input["refundId"]{ref["refundId"]=refund}
   var result:[String:Any]=["reference":ref,"clientIndependentFinality":false,"canRetry":false,"queryOnly":false,"approvalRequired":true,"walletRequest":["id":"original-main-review","method":"ynx_signPQNativeAction","approvalRequired":true]]
   switch fault{
   case "order":ref["sourceOrder"]="foreign";result["reference"]=ref
   case "intent":ref["intentId"]="npi_"+String(repeating:"c",count:48);result["reference"]=ref
   case "merchant":ref["merchant"]="not-an-account";result["reference"]=ref
   case "refund":ref["refundId"]="different-refund";result["reference"]=ref
   case "query":result["queryOnly"]=true
   case "approval":result["approvalRequired"]=false
   case "retry":result["canRetry"]=true
   case "finality":result["clientIndependentFinality"]=true
   case "empty":result["walletRequest"]=["id":"","method":"ynx_signPQNativeAction","approvalRequired":true]
   case "method":result["walletRequest"]=["id":"bad","method":"approve","approvalRequired":true]
   default:break
   }
   return ["ok":true,"value":result]
  })
  let terms=try await nav.reviewOriginalOrderTerms(order,originalOperation:operation,expected:expected)
  try check(terms=="original-main-review" && inputs.last==["action":"order-terms-review","productId":"shop.order","sourceOrder":order],"terms review forwards only existing fixed selector and retains pending id")
  let payment=try await nav.reviewOriginalOrderPayment(order,originalOperation:operation,expected:expected)
  try check(payment==terms && inputs.last?["action"]=="order-pay-review","payment uses existing Main typed review without intent body or approval")
  let refund=try await nav.reviewOriginalOrderRefund(order,originalOperation:operation,refundID:"refund_original",amountAtoms:String(UInt64.max),expected:expected)
  try check(refund==terms && inputs.last==["action":"order-refund-review","productId":"shop.order","sourceOrder":order,"refundId":"refund_original","amountAtoms":"18446744073709551615"],"refund review keeps explicit original id and exact UInt64 amount")
  for bad in ["0","01","-1","1.0","18446744073709551616"]{
   let before=inputs.count
   do{_ = try await nav.reviewOriginalOrderRefund(order,originalOperation:operation,refundID:"refund_original",amountAtoms:bad,expected:expected);throw NSError(domain:"bad atoms accepted",code:1)}catch ShopError.security{try check(inputs.count==before,"invalid native review atoms rejected before Main "+bad)}
  }
  for bad in ["order","intent","merchant","refund","query","approval","retry","finality","empty","method"]{
   fault=bad
   do{_ = try await nav.reviewOriginalOrderRefund(order,originalOperation:operation,refundID:"refund_original",amountAtoms:"1",expected:expected);throw NSError(domain:"bad review accepted",code:1)}catch ShopError.security{try check(true,"rebound/false review rejected "+bad)}
  }
  fault="";drift=true
  do{_ = try await nav.reviewOriginalOrderPayment(order,originalOperation:operation,expected:expected);throw NSError(domain:"late drift accepted",code:1)}catch ShopError.contextChanged{try check(true,"late account generation change cannot adopt a pending review")}
  // Display DTO growth must not change historical a40 invoice journal bytes.
  let line=NativeCheckoutLine(ProductID:"product_original",VariantID:"variant_original",Quantity:1,NativePrice:nil,Title:"actual title",VariantName:"actual variant",UnitPriceYNXT:25)
  let actual=try JSONSerialization.jsonObject(with:JSONEncoder().encode(NativeCheckoutLineBinding(line))) as! [String:Any]
  try check(try CanonicalJSON.data(actual)==CanonicalJSON.data(["ProductID":"product_original","VariantID":"variant_original","Quantity":1]),"new display fields preserve the historical frozen-line binding representation")
  try check(!inputs.contains{$0.keys.contains("token") || $0.keys.contains("account") || $0.keys.contains("signer")} ,"no review request serializes Shop authority or signer")
  print("Original Main review checks PASS \(count); controlled authenticated closures only, no actual host/Source/sign/funds")
 }
}
