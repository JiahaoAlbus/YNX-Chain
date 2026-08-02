import Foundation

struct Product: Codable, Identifiable {
    let productID: String
    let storeID: String
    let name: String
    let description: String?
    let category: String?
    let variants: [Variant]
    var id: String { productID }

    enum CodingKeys: String, CodingKey {
        case productID = "ID"
        case storeID = "StoreID"
        case name = "Name"
        case description = "Description"
        case category = "Category"
        case variants = "Variants"
    }
}

struct Variant: Codable, Identifiable {
    let variantID: String
    let name: String
    let priceYNXT: Int64
    let available: Int
    var id: String { variantID }

    enum CodingKeys: String, CodingKey {
        case variantID = "ID"
        case name = "Name"
        case priceYNXT = "PriceYNXT"
        case available = "Available"
    }
}

struct CartItem: Codable, Identifiable {
    let productID: String
    let variantID: String
    var quantity: Int
    var id: String { productID + variantID }

    enum CodingKeys: String, CodingKey {
        case productID = "ProductID"
        case variantID = "VariantID"
        case quantity = "Quantity"
    }
}

struct Order: Codable, Identifiable {
    let orderID: String
    let status: String
    let totalYNXT: Int64
    let refundStatus: String?
    let trustStatus: String?
    let payDeepLink: String?
    var id: String { orderID }

    enum CodingKeys: String, CodingKey {
        case orderID = "ID"
        case status = "Status"
        case totalYNXT = "TotalYNXT"
        case refundStatus = "RefundStatus"
        case trustStatus = "TrustStatus"
        case payDeepLink = "PayDeepLink"
    }
}
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
    func data(_ path:String,method:String="GET",body:Data?=nil) async throws->Data{
        guard let url=URL(string:path,relativeTo:base.appendingPathComponent("/")) else{throw ShopError.unavailable};var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=body;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let token=Vault.text("product-session"){req.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")}
        let(data,response)=try await URLSession.shared.data(for:req);guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode) else{throw ShopError.invalidResponse};return data
    }
    func raw(_ path:String,method:String="POST",json:[String:Any]) async throws->[String:Any]{
        let body=try CanonicalJSON.data(json);guard let url=URL(string:path,relativeTo:base.appendingPathComponent("/")) else{throw ShopError.unavailable};var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=method=="GET" ? nil:body;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let token=Vault.text("product-session"){req.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")}
        let(data,response)=try await URLSession.shared.data(for:req);guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode),let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.invalidResponse};return value
    }
}
