import Foundation
@main struct InvoiceHandoffTests {
 @MainActor static func main()throws{
  let a="ynx1"+String(repeating:"q",count:38),b="ynx1"+String(repeating:"p",count:38)
  var count=0
  func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};count+=1;print("PASS "+name)}
  func rejected(_ name:String,_ work:()throws->Void)throws{do{try work()}catch{count+=1;print("PASS "+name);return};throw NSError(domain:name,code:1)}
  func raw(_ account:String,_ amount:Int64=8)->[String:Any]{["ID":"ord_original","Buyer":account,"StoreID":"store_original","TotalYNXT":amount,"Currency":"YNXT","Status":"payment_pending"]}
  func order(_ account:String,_ amount:Int64=8)throws->Order{try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(raw(account,amount)))}
  func receipt(_ account:String,_ amount:Int64=8)->[String:Any]{var value=raw(account,amount);value["InvoiceID"]="inv_original";return ["order":value,"invoiceId":"inv_original","deepLink":"ynxpay://invoice/inv_original"]}
  var saved:[String:Data]=[:];let read:(String)->Data?={saved[$0]},write:(String,Data)throws->Void={saved[$0]=$1};let journal=InvoiceHandoffJournal(read:read,write:write)
  let original=try journal.prepare(account:a,order:order(a));let before=saved
  try check(try InvoiceHandoffJournal(read:read,write:write).prepare(account:a,order:order(a)).record==original.record,"restart keeps original opaque request key")
  try check(!String(decoding:saved[original.namespace]!,as:UTF8.self).contains(a) && !String(decoding:saved[original.namespace]!,as:UTF8.self).contains("ord_original"),"journal contains only opaque target key and digest")
  try rejected("another actor cannot prepare original order"){_ = try journal.prepare(account:b,order:order(a))}
  try rejected("changed amount cannot rotate unknown original"){_ = try journal.prepare(account:a,order:order(a,9))}
  try check(saved==before,"refused changes preserve original evidence")
  let other=try journal.prepare(account:b,order:order(b));try check(other.namespace != original.namespace && other.record.key != original.record.key,"actors retain independent original keys")
  for i in 0..<7{var r=receipt(a);if i==0{r=receipt(b)};if i==1{r=receipt(a,9)};if i==2{r["invoiceId"]="inv_other"};if i==3{r["deepLink"]="https://foreign.invalid/invoice/inv_original"};if i==4{r["deepLink"]="ynxpay://invoice/inv_original?execute=true"};if i==5{r["deepLink"]="ynxpay://invoice/inv_original#execute"};if i==6{r["deepLink"]="ynxpay://invoice:443/inv_original"};let before=saved;try rejected("mismatched receipt/link \(i) refused"){_ = try journal.reviewURL(original,response:r)};try check(saved==before,"mismatched receipt \(i) preserves original")}
  try check(try journal.reviewURL(original,response:receipt(a)).absoluteString=="ynxpay://invoice/inv_original","exact original invoice receipt accepted for explicit review")
  try check(try journal.hasPending(account:a),"review alone never clears original; failed OS open remains recoverable")
  let failing=InvoiceHandoffJournal(read:read,write:{_,_ in throw ShopError.security});let beforeClear=saved;try rejected("failed clear remains unresolved"){try failing.confirmed(original)};try check(saved==beforeClear,"failed clear preserves opaque evidence")
  try journal.confirmed(original);try check(try !journal.hasPending(account:a) && journal.hasPending(account:b),"confirmation removes only original account intent")
  saved[other.namespace]=Data("broken original evidence".utf8);try rejected("malformed journal refuses adoption"){_ = try journal.prepare(account:b,order:order(b))};try check(saved[other.namespace]==Data("broken original evidence".utf8),"malformed journal evidence retained")
  let inheritedKey="original-inherited-invoice-key";let legacy=OfflineEnvelope(id:"original-envelope",account:a,method:"POST",path:"orders/ord_original/pay-handoff",body:try CanonicalJSON.data(["IdempotencyKey":inheritedKey]),createdAt:Date());var queueData:Data?=try JSONEncoder().encode([legacy]);let queue=OfflineQueue(read:{queueData},write:{queueData=$0})
  try check(try queue.load(account:a).isEmpty && queue.hasPending(account:a),"historical handoff retained but excluded from batch retry")
  try check(try queue.originalHandoff(account:a,path:legacy.path)==legacy,"explicit original order retrieves exact inherited account-bound envelope")
  try rejected("new handoff cannot enter offline queue"){_ = try queue.prepare(account:a,path:legacy.path,input:[:])}
  try check(try queue.originalHandoff(account:b,path:legacy.path)==nil,"another actor cannot retrieve inherited key")
  let adopted=try journal.prepare(account:a,order:order(a),originalKey:inheritedKey);try check(adopted.record.key==inheritedKey,"explicit original order preserves inherited wire request key")
  try rejected("contradictory inherited key cannot replace journal"){_ = try journal.prepare(account:a,order:order(a),originalKey:"different-original-key")}
  try check(try queue.hasPending(account:a) && journal.hasPending(account:a),"handoff journal preparation leaves inherited recovery intact")
  try queue.confirmed(legacy);try journal.confirmed(adopted);try check(try !queue.hasPending(account:a) && !journal.hasPending(account:a),"exact explicit receipt cleanup removes both original recovery records")
  let missing:[String:Any]=["ID":"ord_legacy","TotalYNXT":8,"Status":"payment_pending"];let unbound=try JSONDecoder().decode(Order.self,from:CanonicalJSON.data(missing));try rejected("unbound historical order cannot prepare invoice"){_ = try journal.prepare(account:a,order:unbound)}
  print("\(count) boundary checks PASS; memory storage and original source, no Wallet or canonical Native authority")
 }
}
