import Foundation
@main struct NativePaymentProjectionChecks {
 static func main() throws {
  var checks=0
  func check(_ v:Bool,_ label:String)throws{guard v else{throw NSError(domain:label,code:1)};checks+=1;print("PASS "+label)}
  let fixture=URL(fileURLWithPath:ProcessInfo.processInfo.environment["YNX_SHOP_NATIVE_RECEIPT_FIXTURE"] ?? "apps/shop/native/testdata/native-paid-order.json")
  let source=try JSONSerialization.jsonObject(with:Data(contentsOf:fixture)) as! [String:Any]
  func order(_ value:[String:Any])throws->Order{try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(value))}
  func mutate(_ edit:(inout [String:Any])->Void)->[String:Any]{var out=source;var payment=out["NativePayment"] as! [String:Any];edit(&payment);out["NativePayment"]=payment;return out}
  func denied(_ raw:[String:Any],_ label:String)throws {let o=try order(raw);do{try o.nativePayment!.validate(o,requirePaid:false)}catch ShopError.security{try check(true,label);return};throw NSError(domain:label,code:1)}
  let original=try order(source);try original.nativePayment!.validate(original);try check(original.nativePayment!.RefundedAtoms=="30","actual accepted partial projection validates complete receipt accounting")
  for field in ["PrincipalAtoms","PaidAtoms","RefundedAtoms","NetPaidAtoms"]{try denied(mutate{$0[field]="01"},"noncanonical amount refused "+field)}
  for field in ["storeId","sourceOrder","merchant","invoiceId","sessionId","termsHash","assetId","unitVersion","genesis"] {
   try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1][field]="foreign";p["Receipts"]=rows},"foreign receipt binding refused "+field)
  }
  try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1]["recipient"]="0x"+String(repeating:"e",count:40);p["Receipts"]=rows},"refund cannot name foreign recipient")
  try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1]["principalAtoms"]="31";p["Receipts"]=rows},"claimed refund amount must equal the cumulative difference")
  try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1]["nativeHash"]=rows[0]["nativeHash"];p["Receipts"]=rows},"duplicate receipt cannot be counted twice")
  try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows.reverse();p["Receipts"]=rows},"refund before settlement or reversed execution order refused")
  try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1]["executionHeight"]=rows[0]["executionHeight"];rows[1]["executionIndex"]=rows[0]["executionIndex"];p["Receipts"]=rows},"duplicate execution coordinate refused")
  for flag in ["canRetry","SourceAdmission","nativeGrant"] {
   try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1][flag]=true;p["Receipts"]=rows},"DATA projection cannot claim authority "+flag)
  }
  let pending="0x"+String(repeating:"d",count:64)
  try denied(mutate{$0["PendingOriginals"]=[pending]},"pending original requires incomplete-history state")
  try denied(mutate{$0["PendingOriginals"]=[pending,pending];$0["CompleteKnownOriginals"]=false},"duplicate pending original refused")
  let incomplete=try order(mutate{$0["PendingOriginals"]=[pending];$0["CompleteKnownOriginals"]=false});try incomplete.nativePayment!.validate(incomplete);try check(!incomplete.nativePayment!.CompleteKnownOriginals,"known accepted payment retains unresolved originals without replay")
  var unpaid=source;unpaid["Status"]="payment_pending";unpaid["RefundStatus"]="";unpaid["NativePayment"]=(source["NativePayment"] as! [String:Any]).merging(["PaidAtoms":"0","RefundedAtoms":"0","NetPaidAtoms":"0","SettlementNativeHash":"","Receipts":[],"PendingOriginals":[pending],"CompleteKnownOriginals":false]){_,n in n}
  let zero=try order(unpaid);try zero.nativePayment!.validate(zero,requirePaid:false);try check(zero.nativePayment!.PaidAtoms=="0","real zero-paid pending projection is readable without fake settlement")
  do{try zero.nativePayment!.validate(zero)}catch ShopError.security{try check(true,"unpaid projection cannot authorize paid workflow")}
  let reconcile=try order(mutate{$0["ReconciliationRequired"]=true});try reconcile.nativePayment!.validate(reconcile,requirePaid:false)
  do{try reconcile.nativePayment!.validate(reconcile)}catch ShopError.security{try check(true,"accepted atoms needing reconciliation cannot authorize fulfillment")}
  // The authenticated Seller wire contains the same original financial fields.
  var sellerRaw=source;sellerRaw.merge(["SubtotalYNXT":100,"ShippingYNXT":0,"TaxYNXT":0,"TaxStatus":"","LogisticsStatus":"","TrustStatus":"","Lines":[],"Address":["Recipient":"","Line1":"","City":"","Region":"","PostalCode":"","Country":""],"Timeline":[]]){_,v in v}
  let seller=try JSONDecoder().decode(SellerOrder.self,from:CanonicalJSON.data(sellerRaw));try check(seller.paymentDisplayState=="native_partial_refund" && seller.paymentOrder.nativePayment!.NetPaidAtoms=="70","Seller uses original native atoms instead of missing legacy settlement")
  var full=source;var p=full["NativePayment"] as! [String:Any];var rows=p["Receipts"] as! [[String:Any]];rows[1]["principalAtoms"]="100";rows[1]["refundedAtoms"]="100";rows[1]["netPaidAtoms"]="0";p["Receipts"]=rows;p["RefundedAtoms"]="100";p["NetPaidAtoms"]="0";full["NativePayment"]=p;full["Status"]="refunded";full["RefundStatus"]="native_refunded"
  let refunded=try order(full);try refunded.nativePayment!.validate(refunded);try check(refunded.nativePayment!.NetPaidAtoms=="0","complete original refund remains exact zero net without a new payment")
  var maximum=source;var maxPayment=maximum["NativePayment"] as! [String:Any];var maxRows=maxPayment["Receipts"] as! [[String:Any]];let max=String(UInt64.max)
  maxRows[0]["principalAtoms"]=max;maxRows[0]["paidAtoms"]=max;maxRows[0]["netPaidAtoms"]=max
  maxRows[1]["paidAtoms"]=max;maxRows[1]["netPaidAtoms"]=String(UInt64.max-30)
  maxPayment["PrincipalAtoms"]=max;maxPayment["PaidAtoms"]=max;maxPayment["NetPaidAtoms"]=String(UInt64.max-30);maxPayment["Receipts"]=maxRows;maximum["NativePayment"]=maxPayment
  let exact=try order(maximum);try exact.nativePayment!.validate(exact);try check(exact.nativePayment!.PaidAtoms==max,"UInt64 maximum stays exact without Double or legacy total conversion")
  try denied(mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1]["principalAtoms"]=String(UInt64.max);p["Receipts"]=rows},"refund above paid principal is refused without unsigned overflow")
  for state in ["return_rejected","refund_rejected","disputed"] {
   var bad=mutate{p in var rows=p["Receipts"] as! [[String:Any]];rows[1]["recipient"]="foreign";p["Receipts"]=rows};bad["Status"]=state
   do{_ = try AppleBuyerReceipt.decode(bad,account:source["Buyer"] as! String)}catch ShopError.security{try check(true,"post-payment "+state+" cannot bypass receipt validation")}
  }
  print("Native payment projection checks PASS \(checks); actual stored fixture DATA consistency only, no Source or funds")
 }
}
