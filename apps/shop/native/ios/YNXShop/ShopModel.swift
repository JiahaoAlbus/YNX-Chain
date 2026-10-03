import Foundation
import SwiftUI

@MainActor final class ShopModel:ObservableObject {
    @Published var products:[Product]=[]
    @Published var cart:[CartItem]=[]
    @Published var orders:[Order]=[]
    @Published var state="loading"
    @Published var search=""
    @Published var selected:Product?
    @Published var signedIn=false
    @Published var privacyRevision=0
    @Published var privacyExportURL:URL?
    @Published var appLanguage=UserDefaults.standard.string(forKey:"app-language") ?? Locale.current.identifier
    @Published var aiLanguage=UserDefaults.standard.string(forKey:"ai-language") ?? Locale.current.language.languageCode?.identifier ?? "en"
    let api=APIClient(),queue=OfflineQueue()
    private var operationRevision=0,mutationBusy=false
    init(){signedIn=api.currentSession != nil;Task{await loadCatalog()};Task{[weak self] in while !Task.isCancelled{try? await Task.sleep(for:.seconds(1));guard let self else{return};if self.signedIn && self.api.currentSession==nil{self.signOut()}}}}
    func setLanguage(_ value:String){appLanguage=value;UserDefaults.standard.set(value,forKey:"app-language")}
    func setAILanguage(_ value:String){aiLanguage=value;UserDefaults.standard.set(value,forKey:"ai-language")}
    private func failure(_ error:Error){if let error=error as? ShopError{if error == .contextChanged{if signedIn && api.currentSession==nil{signOut()};return};if error == .signedOut{signOut();return}};state="unavailable"}
    func signOut(){api.invalidate();operationRevision+=1;mutationBusy=false;signedIn=false;cart=[];orders=[];selected=nil;privacyRevision+=1;if let url=privacyExportURL{try? FileManager.default.removeItem(at:url)};privacyExportURL=nil;do{try Vault.put("apple-commerce-negative-authority-v1",PendingApproval.digest(Vault.get("wallet-pending") ?? Data()));state=""}catch{state="security_error"}}
    func loadCatalog()async{state="loading";do{let r:CatalogResponse=try await api.request("products?q=\(search.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed) ?? "")");products=r.products;state=products.isEmpty ? "empty_catalog":""}catch{failure(error)}}
    func loadOrders()async{guard signedIn else{return};do{let check=try api.capture();let r:OrdersResponse=try await api.request("orders");try check();orders=r.orders}catch{failure(error)}}
    func add(_ product:Product,_ variant:Variant){if let index=cart.firstIndex(where:{$0.variantID==variant.variantID}){cart[index].quantity+=1}else{cart.append(.init(productID:product.productID,variantID:variant.variantID,quantity:1))}}
    func signIn(){api.invalidate();operationRevision+=1;Task{do{try await WalletAuth.begin(api:api)}catch{failure(error)}}}
    func walletCallback(_ url:URL){let previous=api.currentSession?.account;Task{do{try await WalletAuth.complete(url,api:api);if previous != api.currentSession?.account{operationRevision+=1;mutationBusy=false;cart=[];orders=[];selected=nil;if let url=privacyExportURL{try? FileManager.default.removeItem(at:url)};privacyExportURL=nil};signedIn=api.currentSession != nil;privacyRevision+=1;state=signedIn ? "wallet_active":"security_error";await loadOrders()}catch{failure(error)}}}
    private func mutation(path:String,input:[String:Any],receipt:@escaping ([String:Any])throws->Void){
        guard signedIn,!mutationBusy else{return}
        do{let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut};let item=try queue.prepare(account:account,path:path,input:input);mutationBusy=true;let revision=operationRevision
            Task{defer{if revision==operationRevision{mutationBusy=false}};do{let json=try JSONSerialization.jsonObject(with:item.body) as? [String:Any];guard let json else{throw ShopError.security};let result=try await api.raw(item.path,method:item.method,json:json);try check();try receipt(result);try queue.confirmed(item);await loadOrders()}catch{if let err=error as? ShopError,err == .contextChanged || err == .signedOut{failure(error)}else{state="queued_offline"}}}
        }catch{failure(error)}
    }
    func checkout(recipient:String,address:String,city:String,country:String){guard signedIn else{signIn();return};let items=cart.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]};guard let store=products.first(where:{$0.productID==cart.first?.productID})?.storeID else{state="cart_empty";return};let account=api.currentSession?.account
        mutation(path:"orders",input:["StoreID":store,"Items":items,"Address":["Recipient":recipient,"Line1":address,"City":city,"Country":country]]){result in guard result["Buyer"] as? String==account,let id=result["ID"] as? String,!id.isEmpty else{throw ShopError.security};self.cart=[]}
    }
    func transition(_ order:Order,_ action:String,reason:String){mutation(path:"orders/\(order.orderID)/transition",input:["Action":action,"Reason":reason,"Explanation":reason,"Body":reason,"Rating":action=="reviewed" ? 5:0]){_ in}}
    func checkPayment(_ order:Order){guard signedIn else{return};Task{do{let check=try api.capture();_ = try await api.raw("orders/\(order.orderID)/settlement",method:"GET",json:[:]);try check();await loadOrders()}catch{failure(error)}}}
    func pay(_ order:Order){mutation(path:"orders/\(order.orderID)/pay-handoff",input:[:]){result in guard let text=result["deepLink"] as? String,let url=URL(string:text),url.scheme=="ynxpay",url.host=="invoice" else{throw ShopError.security};let check=try self.api.capture();Task{do{try check();try await WalletOpening.open(url)}catch{self.failure(error)}}}}
    func retryPending(){guard signedIn,!mutationBusy else{return};do{let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut};let items=try queue.load(account:account);mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false}};for item in items{do{try check();guard let json=try JSONSerialization.jsonObject(with:item.body) as? [String:Any] else{throw ShopError.security};let result=try await api.raw(item.path,method:item.method,json:json);try check();if item.path=="orders"{guard result["Buyer"] as? String==account,let id=result["ID"] as? String,!id.isEmpty else{throw ShopError.security};cart=[]};try queue.confirmed(item)}catch{failure(error);return}};state="";await loadOrders()}}catch{failure(error)}}
    func exportPrivacyData(){guard signedIn else{signIn();return};Task{do{let check=try api.capture();let data=try await api.data("privacy/export");try check();let url=FileManager.default.temporaryDirectory.appendingPathComponent("ynx-shop-data-\(UUID().uuidString).json");try data.write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);privacyExportURL=url;state="privacy_export_ready"}catch{failure(error)}}}
    func deletePrivacyData(_ confirmation:String){guard signedIn else{signIn();return};guard confirmation=="DELETE_MY_SHOP_DATA" else{state="privacy_exact_required";return};guard !mutationBusy else{state="queued_offline";return};mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false}};do{let check=try api.capture();guard let account=api.currentSession?.account,try queue.load(account:account).isEmpty else{throw ShopError.unresolvedMutation};_ = try await api.raw("privacy/delete",json:["confirmation":confirmation]);try check();cart=[];orders=[];if let url=privacyExportURL{try? FileManager.default.removeItem(at:url)};privacyExportURL=nil;privacyRevision+=1;state="privacy_deleted"}catch{if let error=error as? ShopError,error == .contextChanged || error == .signedOut{failure(error)}else{state="privacy_delete_failed"}}}}
    func runAI(workflow:String,summary:String){guard signedIn else{signIn();return};Task{do{let check=try api.capture();let job=try await api.raw("ai/jobs",json:["Workflow":workflow,"ContextClasses":["public_catalog"],"ContextSummary":"\(summary); outputLanguage=\(aiLanguage)","EstimateUnits":1,"PermissionGranted":true,"IdempotencyKey":UUID().uuidString]);try check();guard let id=job["ID"] as? String else{throw ShopError.invalidResponse};let result=try await api.raw("ai/jobs/\(id)/run",json:[:]);try check();state=(result["Result"] as? String) ?? "unavailable"}catch{failure(error)}}}
}
