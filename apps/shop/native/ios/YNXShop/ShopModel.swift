import Foundation
import SwiftUI

@MainActor final class ShopModel:ObservableObject {
    @Published var products:[Product]=[],cart:[CartItem]=[],orders:[Order]=[]
    @Published var state="loading",search="",selected:Product?,signedIn=false
    @Published var appLanguage=UserDefaults.standard.string(forKey:"app-language") ?? Locale.current.identifier
    @Published var aiLanguage=UserDefaults.standard.string(forKey:"ai-language") ?? Locale.current.language.languageCode?.identifier ?? "en"
    let api=APIClient(),queue=OfflineQueue()
    init(){signedIn=Vault.get("product-session") != nil;Task{await loadCatalog()}}
    func setLanguage(_ value:String){appLanguage=value;UserDefaults.standard.set(value,forKey:"app-language")}
    func setAILanguage(_ value:String){aiLanguage=value;UserDefaults.standard.set(value,forKey:"ai-language")}
    func loadCatalog() async {state="loading";do{let r:CatalogResponse=try await api.request("products?q=\(search.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed) ?? "")");products=r.products;state=products.isEmpty ? "empty_catalog":""}catch{state="unavailable"}}
    func loadOrders() async {guard signedIn else{return};do{let r:OrdersResponse=try await api.request("orders");orders=r.orders}catch{state="unavailable"}}
    func add(_ product:Product,_ variant:Variant){if let index=cart.firstIndex(where:{$0.VariantID==variant.ID}){cart[index].Quantity+=1}else{cart.append(.init(ProductID:product.ID,VariantID:variant.ID,Quantity:1))}}
    func signIn(){Task{do{try await WalletAuth.begin(api:api)}catch{state="security_error"}}}
    func walletCallback(_ url:URL){Task{do{try await WalletAuth.complete(url,api:api);signedIn=true;state="wallet_active";await loadOrders()}catch{state="security_error"}}}
    func checkout(recipient:String,address:String,city:String,country:String){guard signedIn else{signIn();return};let id=UUID().uuidString.lowercased();let items=cart.map{["ProductID":$0.ProductID,"VariantID":$0.VariantID,"Quantity":$0.Quantity] as [String:Any]};guard let store=products.first(where:{$0.ID==cart.first?.ProductID})?.StoreID else{state="cart_empty";return};let json:[String:Any]=["StoreID":store,"Items":items,"Address":["Recipient":recipient,"Line1":address,"City":city,"Country":country],"IdempotencyKey":id];Task{do{_ = try await api.raw("orders",json:json);cart=[];await loadOrders()}catch{do{try queue.append(method:"POST",path:"orders",body:try CanonicalJSON.data(json));state="queued_offline"}catch{state="security_error"}}}}
    func transition(_ order:Order,_ action:String,reason:String){let json:[String:Any]=["Action":action,"Reason":reason,"Explanation":reason,"Body":reason,"Rating":action=="reviewed" ? 5:0,"IdempotencyKey":UUID().uuidString.lowercased()];Task{do{_ = try await api.raw("orders/\(order.ID)/transition",json:json);await loadOrders()}catch{do{try queue.append(method:"POST",path:"orders/\(order.ID)/transition",body:try CanonicalJSON.data(json));state="queued_offline"}catch{state="security_error"}}}}
    func pay(_ order:Order){Task{do{let r=try await api.raw("orders/\(order.ID)/pay-handoff",json:["IdempotencyKey":UUID().uuidString.lowercased()]);if let text=r["deepLink"] as? String,let url=URL(string:text){await UIApplication.shared.open(url)}else{state="unavailable"}}catch{state="unavailable"}}}
    func retryPending(){Task{var remaining:[OfflineEnvelope]=[];for item in queue.load(){do{let json=(try JSONSerialization.jsonObject(with:item.body) as? [String:Any]) ?? [:];_ = try await api.raw(item.path,method:item.method,json:json)}catch{remaining.append(item)}};try? queue.replace(remaining);state=remaining.isEmpty ? "":"queued_offline";await loadOrders()}}
    func runAI(workflow:String,summary:String){Task{do{let job=try await api.raw("ai/jobs",json:["Workflow":workflow,"ContextClasses":["public_catalog"],"ContextSummary":"\(summary); outputLanguage=\(aiLanguage)","EstimateUnits":1,"PermissionGranted":true,"IdempotencyKey":UUID().uuidString]);guard let id=job["ID"] as? String else{throw ShopError.invalidResponse};let result=try await api.raw("ai/jobs/\(id)/run",json:[:]);state=(result["Result"] as? String) ?? "unavailable"}catch{state="unavailable"}}}
}
