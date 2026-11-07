import Foundation
@main struct NativePriceChecks {
 @MainActor static func main()throws {
  var checks=0
  func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
  let file=ProcessInfo.processInfo.environment["YNX_SHOP_NATIVE_PRICE_FIXTURE"]!
  let raw=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:file))) as! [String:Any]
  func decode(_ value:[String:Any])throws->Order{try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(value))}
  let order=try decode(raw),account=order.buyer!
  try order.nativePrice!.validate(order)
  try check(order.nativePrice!.Price.AmountAtoms=="9" && order.totalYNXT==25,"actual Go normal Seller to checkout producer keeps native9 and legacy25 separate")
  var saved:[String:Data]=[:];let journal=NativeInvoicePreparationJournal(read:{saved[$0]},write:{saved[$0]=$1});let original=try journal.prepare(order,account:account,legacyPending:false);try journal.dispatched(original);let before=saved
  var changed=raw;var price=changed["NativePrice"] as! [String:Any];var fields=price["Price"] as! [String:Any];var lines=changed["Lines"] as! [[String:Any]];var unit=lines[0]["NativePrice"] as! [String:Any]
  fields["AmountAtoms"]="10";price["Price"]=fields;unit["AmountAtoms"]="10";lines[0]["NativePrice"]=unit;changed["NativePrice"]=price;changed["Lines"]=lines
  let repriced=try decode(changed);try repriced.nativePrice!.validate(repriced)
  do{_ = try journal.prepare(repriced,account:account,legacyPending:false);throw NSError(domain:"native reprice replaced UNKNOWN",code:1)}catch ShopError.unresolvedMutation{try check(saved==before,"same legacy total cannot replace frozen native price or original UNKNOWN")}
  for key in ["Merchant","Recipient","AmountAtoms","Genesis","NativeChainID","AssetID","UnitVersion","PriceApprovalRef"]{
   var changed=raw;var p=changed["NativePrice"] as! [String:Any];var f=p["Price"] as! [String:Any];f[key]="foreign";p["Price"]=f;changed["NativePrice"]=p
   do{let order=try decode(changed);try order.nativePrice!.validate(order);throw NSError(domain:"invalid price accepted",code:1)}catch ShopError.security{try check(true,"invalid captured native field refused "+key)}
  }
  for value in ["01","-1","1.0","18446744073709551616"]{
   var changed=raw;var rows=changed["Lines"] as! [[String:Any]];var p=rows[0]["NativePrice"] as! [String:Any];p["AmountAtoms"]=value;rows[0]["NativePrice"]=p;changed["Lines"]=rows
   do{let order=try decode(changed);try order.nativePrice!.validate(order);throw NSError(domain:"bad atomic value",code:1)}catch ShopError.security{try check(true,"noncanonical unit amount refused "+value)}
  }
  var maximum=raw;var p=maximum["NativePrice"] as! [String:Any],f=p["Price"] as! [String:Any],rows=maximum["Lines"] as! [[String:Any]],u=rows[0]["NativePrice"] as! [String:Any]
  f["AmountAtoms"]=String(UInt64.max);p["Price"]=f;u["AmountAtoms"]=String(UInt64.max);rows[0]["NativePrice"]=u;maximum["NativePrice"]=p;maximum["Lines"]=rows
  let exact=try decode(maximum);try exact.nativePrice!.validate(exact);try check(exact.nativePrice!.Price.AmountAtoms==String(UInt64.max),"native UInt64 maximum is exact and never uses legacy total or Double")
  rows[0]["Quantity"]=2;maximum["Lines"]=rows
  do{let overflow=try decode(maximum);try overflow.nativePrice!.validate(overflow);throw NSError(domain:"overflow accepted",code:1)}catch ShopError.security{try check(true,"native quantity multiplication overflow is refused")}
  try check(saved==before,"all malformed/refused price reads preserve original journal bytes")
  print("Native price client checks PASS \(checks); actual Go controlled normal-path fixture only, no real merchant/Source/price entry or funds")
 }
}
