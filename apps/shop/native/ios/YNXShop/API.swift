import Foundation

struct Product:Codable,Identifiable { let ID:String; let StoreID:String; let Name:String; let Description:String?; let Category:String?; let Variants:[Variant]; var id:String{ID} }
struct Variant:Codable,Identifiable { let ID:String; let Name:String; let PriceYNXT:Int64; let Available:Int; var id:String{ID} }
struct CartItem:Codable,Identifiable { let ProductID:String; let VariantID:String; var Quantity:Int; var id:String{ProductID+VariantID} }
struct Order:Codable,Identifiable { let ID:String; let Status:String; let TotalYNXT:Int64; let RefundStatus:String?; let TrustStatus:String?; let PayDeepLink:String?; var id:String{ID} }
struct CatalogResponse:Codable { let products:[Product] }
struct OrdersResponse:Codable { let orders:[Order] }

final class APIClient {
    let base:URL
    init(base:URL=URL(string:"https://shop-api.ynxweb4.com/api")!){self.base=base}
    func request<T:Decodable>(_ path:String,method:String="GET",body:Data?=nil) async throws -> T {
        guard base.scheme=="https" || base.host=="127.0.0.1" || base.host=="localhost" else {throw ShopError.unavailable}
        guard let url=URL(string:path,relativeTo:base.appendingPathComponent("/")) else{throw ShopError.unavailable};var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=body;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let token=Vault.text("product-session"){req.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")}
        let(data,response)=try await URLSession.shared.data(for:req);guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode) else{throw ShopError.invalidResponse}
        return try JSONDecoder().decode(T.self,from:data)
    }
    func raw(_ path:String,method:String="POST",json:[String:Any]) async throws->[String:Any]{
        let body=try CanonicalJSON.data(json);guard let url=URL(string:path,relativeTo:base.appendingPathComponent("/")) else{throw ShopError.unavailable};var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=method=="GET" ? nil:body;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let token=Vault.text("product-session"){req.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")}
        let(data,response)=try await URLSession.shared.data(for:req);guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode),let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.invalidResponse};return value
    }
}
