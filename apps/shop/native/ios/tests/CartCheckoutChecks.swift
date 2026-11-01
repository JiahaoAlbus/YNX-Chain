import Foundation
@MainActor final class CartAuthority:AppleNativeAuthority {
 var current:ShopSession?
 var beforeProof:(()throws->Void)?
 var openings=0
 func restore()async throws{};func connect()async throws{};func handleReturn(_ url:URL)async throws{throw ShopError.security};func disconnect()throws{current=nil}
 func openInvoice(_ url:URL,expected:ShopSession)async throws{guard current==expected,url.absoluteString=="ynxpay://invoice/inv_original" else{throw ShopError.contextChanged};openings+=1}
 func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{guard current==expected else{throw ShopError.contextChanged};try beforeProof?();return ["body":body,"identityHeader":String(repeating:"i",count:43),"actionHeader":String(repeating:"a",count:43)]}
}
final class CartHTTP:URLProtocol,@unchecked Sendable {
 @MainActor static var handler:((CartHTTP)->Void)?
 override class func canInit(with request:URLRequest)->Bool{true};override class func canonicalRequest(for request:URLRequest)->URLRequest{request};override func startLoading(){Task{@MainActor in Self.handler?(self)}};override func stopLoading(){}
 func respond(_ json:Any,status:Int=200){let body=try! CanonicalJSON.data(json);client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:body);client?.urlProtocolDidFinishLoading(self)}
}
@main struct CartCheckoutChecks {
 @MainActor static func main()async throws {
 let account="ynx1"+String(repeating:"q",count:38),buyer="0x"+String(repeating:"1",count:40)
 func check(_ ok:Bool,_ why:String)throws{guard ok else{throw NSError(domain:why,code:1)};print("PASS \(why)")}
 func listing(_ id:String,_ store:String="store-original",_ variants:[String]=["v"])->[String:Any]{["ID":id,"StoreID":store,"Title":id,"Variants":variants.map{["ID":$0,"Name":$0,"PriceYNXT":8,"Inventory":4,"Reserved":1] as [String:Any]}]}
 let authority=CartAuthority();authority.current=ShopSession(account:account,token:String(repeating:"a",count:64),expiresAt:ISO8601DateFormatter().string(from:Date().addingTimeInterval(300)),nativeGeneration:0)
 let cfg=URLSessionConfiguration.ephemeral;cfg.protocolClasses=[CartHTTP.self];let api=APIClient(session:URLSession(configuration:cfg),authority:authority)
 var products:[String:[String:Any]]=["p":listing("p"),"p2":listing("p2","store-original",["v2"])],paths:[String]=[],posts=0,afterRead:(()->Void)?,observedBody:[String:Any]=[:]
 var saved:[String:Data]=[:],queueBytes:Data?,phaseBytes:Data?
 let journey=AppleBuyerJourney(read:{saved[$0]},write:{saved[$0]=$1}),queue=OfflineQueue(read:{queueBytes},write:{queueBytes=$0},readPhase:{phaseBytes},writePhase:{phaseBytes=$0})
 let items=[CartItem(productID:"p",variantID:"v",quantity:1),CartItem(productID:"p2",variantID:"v2",quantity:2)]
 let receipt:[String:Any]=["ID":"order-original","Buyer":buyer,"WalletBuyer":account,"StoreID":"store-original","TotalYNXT":24,"Currency":"YNXT","Status":"payment_pending","CartConsumption":["PreviousRevision":"cart-r3","Revision":"consumed"]]
 CartHTTP.handler={request in
   let url=request.request.url!,path=url.path,method=request.request.httpMethod!;paths.append(method+" "+path)
   if path=="/api/products"{request.respond(["products":[]]);return}
   if path.hasPrefix("/api/products/"){let id=String(path.dropFirst("/api/products/".count));let value=products[id];afterRead?();if let value{request.respond(value)}else{request.respond(["error":"missing"],status:404)};return}
   if path=="/api/orders",method=="GET"{request.respond(["orders":posts==0 ? []:[receipt]]);return}
   if path=="/api/orders",method=="POST"{
     posts+=1;var bytes=request.request.httpBody ?? Data();if bytes.isEmpty,let stream=request.request.httpBodyStream{stream.open();defer{stream.close()};var b=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable{let n=stream.read(&b,maxLength:b.count);if n<=0{break};bytes.append(b,count:n)}}
     observedBody=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:];request.respond(receipt);return
   }
   request.respond(["error":"not configured"],status:404)
 }
 func wait(_ predicate:()->Bool)async throws{for _ in 0..<300{if predicate(){return};try await Task.sleep(nanoseconds:10_000_000)};throw NSError(domain:"cart wait timeout",code:1)}
 let model=ShopModel(api:api,queue:queue,journey:journey)
 try await wait{model.signedIn && paths.contains("GET /api/products")}
 try journey.reconcileCart(["Buyer":buyer,"WalletBuyer":account,"Revision":"cart-r3","Items":items.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]}],account:account)
 model.cart=items;model.products=[];model.search="other filtered results"
 model.checkout(recipient:"Original",address:"Address",city:"City",country:"QA");try await wait{!model.mutationBusy}
 try check(posts==1 && model.cart.isEmpty && model.orders.count==1,"actual Model cold multi-SKU checkout works with no displayed catalog products")
 try check(observedBody["CartRevision"] as? String=="cart-r3" && observedBody["StoreID"] as? String=="store-original" && (observedBody["Items"] as? [[String:Any]])?.count==2,"same complete cart revision and store reach one normal checkout")
 try check(paths.filter{$0=="GET /api/products/p"}.count==1 && paths.filter{$0=="GET /api/products/p2"}.count==1,"all original product IDs read independently of search query")
 let originalSaved=saved,originalQueue=queueBytes;let current=try api.capture()
 for mode in ["foreign","missing","wrong-id","unavailable","ambiguous"]{
   products["p2"]=listing("p2","store-original",["v2"])
   if mode=="foreign"{products["p2"]?["StoreID"]="other-store"}
   if mode=="missing"{products.removeValue(forKey:"p2")}
   if mode=="wrong-id"{products["p2"]?["ID"]="other"}
   if mode=="unavailable"{products["p2"]?["Variants"]=[["ID":"v2","Name":"v2","PriceYNXT":8,"Inventory":1,"Reserved":1]]}
   if mode=="ambiguous"{products["p2"]=listing("p2","store-original",["v2","v2"])}
   do{_ = try await api.checkoutStore(items,current:current);throw NSError(domain:"accepted "+mode,code:1)}catch let e as NSError{if e.domain.hasPrefix("accepted "){throw e}}
   try check(posts==1 && saved==originalSaved && queueBytes==originalQueue,"invalid whole-cart "+mode+" leaves original journal and funds untouched")
 }
 products["p"]=listing("p","store-original",["v","v2"]);paths=[]
 _ = try await api.checkoutStore([items[0],CartItem(productID:"p",variantID:"v2",quantity:1)],current:current)
 try check(paths==["GET /api/products/p"],"two SKUs on one product share one original public read")
 products["p"]=listing("p");products["p2"]=listing("p2","store-original",["v2"])
 try journey.reconcileCart(["Buyer":buyer,"WalletBuyer":account,"Revision":"cart-r3","Items":items.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]}],account:account)
 afterRead={try! journey.edit(account,items:[items[0]])};let before=queueBytes
 model.checkout(recipient:"Original",address:"Address",city:"City",country:"QA");try await wait{!model.mutationBusy};afterRead=nil
 try check(posts==1 && queueBytes==before && (try journey.load(account)).items.count==1,"draft replacement during public read cannot prepare or dispatch another order")
 print("PASS Native whole-cart catalog checkout checks")
 }
}
