import Foundation
import CryptoKit
@MainActor private final class MainReviewChild: AppleOriginalMainPayChild {
    var calls: [String] = []
    var onStatus: () -> Void = {}
    var onInvoke: () -> Void = {}
    var onClose: () -> Void = {}
    var closeFails = false
    let reply: [String: Any]

    init(reply: [String: Any]) { self.reply = reply }
    func status() async throws -> [String: Any] {
        calls.append("status")
        onStatus()
        return ["ok": true, "value": ["normalMainEntry": true, "canRequest": true, "paymentAuthorized": false]]
    }
    func invoke() async throws -> [String: Any] {
        calls.append("invoke")
        onInvoke()
        return reply
    }
    func close() async throws {
        calls.append("close")
        onClose()
        if closeFails { throw ShopError.unavailable }
    }
}
@main struct OriginalMainPayReviewChecks {
 @MainActor static func main() async throws {
  var count=0
  func check(_ value:Bool,_ text:String)throws{guard value else{throw NSError(domain:text,code:1)};count+=1;print("PASS "+text)}
  let operation="npi_"+String(repeating:"a",count:48),order="order_original",merchant="0x"+String(repeating:"b",count:40)
  let originalHash="0x"+String(repeating:"a",count:64),memberHash="0x"+String(repeating:"b",count:64)
  let expected=ShopSession(account:"ynx1"+String(repeating:"q",count:38),token:String(repeating:"t",count:32),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)),nativeGeneration:1)
  var current=expected,inputs:[[String:String]]=[],fault="",drift=false,protectedCalls=0
  let nav=AppleOriginalMainPayNavigation(current:{current},status:{_ in ["ok":true,"value":["normalMainEntry":true,"canRequest":true,"available":false,"paymentAuthorized":false]]},invoke:{input,expectedOperation,session in
   guard session==expected else{throw ShopError.contextChanged}
   protectedCalls+=1
   guard expectedOperation==operation else{throw OriginalMainPayRefusal(code:"NATIVE_PAY_ORIGINAL_OPERATION_CHANGED")}
   inputs.append(input)
   if drift{current=ShopSession(account:expected.account,token:expected.token,expiresAt:expected.expiresAt,nativeGeneration:2)}
   var ref:[String:Any]=["productId":"shop.order","sourceOrder":order,"intentId":operation,"merchant":merchant,"invoiceId":"invoice_original"]
   if let refund=input["refundId"]{ref["refundId"]=refund}
   var result:[String:Any]=["reference":ref,"clientIndependentFinality":false,"canRetry":false,"queryOnly":false,"approvalRequired":true,"walletRequest":["id":"original-main-review","method":"ynx_signPQNativeAction","approvalRequired":true]]
   if let kind=input["kind"],let hash=input["originalHash"] {
    ref["kind"]=kind;ref["originalHash"]=hash
    result["reference"]=ref
    result["recovery"]=["kind":kind,"originalHash":hash,"abciHash":hash,"nativeHash":memberHash]
    result["walletRequest"]=["id":"original-main-review","method":"ynx_broadcastPQNativeAction","approvalRequired":true]
   }
   switch fault{
   case "broadcast-kind":ref["kind"]="invoice_settle";result["reference"]=ref
   case "broadcast-original":ref["originalHash"]=memberHash;result["reference"]=ref
   case "broadcast-archive":result["recovery"]=["kind":"invoice_terms","originalHash":originalHash,"abciHash":memberHash,"nativeHash":memberHash]

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
  let beforeWrong=inputs.count,protectedBeforeWrong=protectedCalls
  do{
   _ = try await nav.reviewOriginalOrderPayment(order,originalOperation:"npi_"+String(repeating:"c",count:48),expected:expected)
   throw NSError(domain:"foreign operation accepted",code:1)
  }catch let error as OriginalMainPayRefusal{
   try check(error.code=="NATIVE_PAY_ORIGINAL_OPERATION_CHANGED" && protectedCalls==protectedBeforeWrong+1 && inputs.count==beforeWrong,"host rejects another operation before issuing a review or retry")
  }
  for bad in ["0","01","-1","1.0","18446744073709551616"]{
   let before=inputs.count
   do{_ = try await nav.reviewOriginalOrderRefund(order,originalOperation:operation,refundID:"refund_original",amountAtoms:bad,expected:expected);throw NSError(domain:"bad atoms accepted",code:1)}catch ShopError.security{try check(inputs.count==before,"invalid native review atoms rejected before Main "+bad)}
  }
  for bad in ["order","intent","merchant","refund","query","approval","retry","finality","empty","method"]{
   fault=bad
   do{_ = try await nav.reviewOriginalOrderRefund(order,originalOperation:operation,refundID:"refund_original",amountAtoms:"1",expected:expected);throw NSError(domain:"bad review accepted",code:1)}catch ShopError.security{try check(true,"rebound/false review rejected "+bad)}
  }
  fault=""
  for kind in [OriginalMainPayBroadcastKind.terms,.settlement,.refund] {
   let id=try await nav.reviewOriginalOrderBroadcast(order,originalOperation:operation,kind:kind,originalHash:originalHash,expected:expected)
   try check(id==terms && inputs.last==["action":"order-broadcast-review","productId":"shop.order","sourceOrder":order,"kind":kind.rawValue,"originalHash":originalHash],"broadcast review binds same original operation, kind and exact Main hash "+kind.rawValue)
  }
  let beforeInvalidHash=inputs.count
  do{_ = try await nav.reviewOriginalOrderBroadcast(order,originalOperation:operation,kind:.terms,originalHash:"0x123",expected:expected);throw NSError(domain:"malformed broadcast hash accepted",code:1)}catch ShopError.security{try check(inputs.count==beforeInvalidHash,"malformed Main hash refused before dispatch")}
  for bad in ["broadcast-kind","broadcast-original","broadcast-archive","method"] {
   fault=bad
   do{_ = try await nav.reviewOriginalOrderBroadcast(order,originalOperation:operation,kind:.terms,originalHash:originalHash,expected:expected);throw NSError(domain:"mismatched broadcast review accepted",code:1)}catch ShopError.security{try check(true,"mismatched original broadcast review refused "+bad)}
  }
  fault="";drift=true
  do{_ = try await nav.reviewOriginalOrderPayment(order,originalOperation:operation,expected:expected);throw NSError(domain:"late drift accepted",code:1)}catch ShopError.contextChanged{try check(true,"late account generation change cannot adopt a pending review")}
  current=expected
  let beforeDrift=inputs.count
  do{_ = try await nav.reviewOriginalOrderBroadcast(order,originalOperation:operation,kind:.refund,originalHash:originalHash,expected:expected);throw NSError(domain:"revoked broadcast published",code:1)}catch ShopError.contextChanged{try check(inputs.count==beforeDrift+1,"same-session revocation discards a late broadcast review without retry")}
  let recovery=["kind":"invoice_refund","originalHash":originalHash,"abciHash":originalHash,"nativeHash":memberHash]
  let ownedReference=["productId":"shop.order","sourceOrder":order,"intentId":operation,"merchant":merchant,"invoiceId":"invoice_original","kind":"invoice_refund","originalHash":originalHash]
  let ownedValue:[String:Any]=["reference":ownedReference,"recovery":recovery,"clientIndependentFinality":false,"canRetry":false,"queryOnly":false,"approvalRequired":true,"walletRequest":["id":"owned-review","method":"ynx_broadcastPQNativeAction","approvalRequired":true]]
  for retirement in ["none","acquire","status","invoke","close","close error"] {
   var ownedCurrent=expected,acquisitions=0
   let retired=ShopSession(account:expected.account,token:expected.token,expiresAt:expected.expiresAt,nativeGeneration:2)
   let child=MainReviewChild(reply:["ok":true,"value":ownedValue])
   if retirement=="status"{child.onStatus={ownedCurrent=retired}}
   if retirement=="invoke"{child.onInvoke={ownedCurrent=retired}}
   if retirement=="close"{child.onClose={ownedCurrent=retired}}
   child.closeFails=retirement=="close error"
   let owned=AppleOriginalMainPayNavigation(current:{ownedCurrent},acquireOriginalOrder:{ action,args,selected,session in
    acquisitions+=1
    try check(action=="order-broadcast-review" && args==[order,"invoice_refund",originalHash] && selected==operation && session==expected,"Main acquisition receives the exact session and original reference "+retirement)
    if retirement=="acquire"{ownedCurrent=retired}
    return child
   })
   do {
    let id=try await owned.reviewOriginalOrderBroadcast(order,originalOperation:operation,kind:.refund,originalHash:originalHash,expected:expected)
    try check(retirement=="none" && id=="owned-review","valid owned review is returned after close")
   } catch ShopError.contextChanged {
    try check(["acquire","status","invoke","close"].contains(retirement),"revoked original session refuses the reply "+retirement)
   } catch ShopError.unavailable {
    try check(retirement=="close error","original close failure refuses publication")
   }
   let expectedCalls=retirement=="acquire" ? ["close"]:retirement=="status" ? ["status","close"]:["status","invoke","close"]
   try check(child.calls==expectedCalls && acquisitions==1,"one Main child is drained without retry "+retirement)
   if retirement=="close error" {
    do{_ = try await owned.reviewOriginalOrderBroadcast(order,originalOperation:operation,kind:.refund,originalHash:originalHash,expected:expected);throw NSError(domain:"replaced original Main child despite unresolved close",code:1)}catch ShopError.unresolvedMutation{try check(child.calls==expectedCalls && acquisitions==1,"unresolved close keeps the original child and blocks replacement")}
   }
  }
  // Display DTO growth must not change historical a40 invoice journal bytes.
  let line=NativeCheckoutLine(ProductID:"product_original",VariantID:"variant_original",Quantity:1,NativePrice:nil,Title:"actual title",VariantName:"actual variant",UnitPriceYNXT:25)
  let actual=try JSONSerialization.jsonObject(with:JSONEncoder().encode(NativeCheckoutLineBinding(line))) as! [String:Any]
  try check(try CanonicalJSON.data(actual)==CanonicalJSON.data(["ProductID":"product_original","VariantID":"variant_original","Quantity":1]),"new display fields preserve the historical frozen-line binding representation")
  try check(!inputs.contains{$0.keys.contains("token") || $0.keys.contains("account") || $0.keys.contains("signer") || $0.keys.contains("intentId")} ,"no review request serializes Shop authority or signer")
  print("Original Main review checks PASS \(count); controlled authenticated closures only, no actual host/Source/sign/funds")
 }
}
