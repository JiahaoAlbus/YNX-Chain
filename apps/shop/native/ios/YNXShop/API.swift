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

final class ShopRedirectPolicy:NSObject,URLSessionTaskDelegate,@unchecked Sendable {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?)->Void){completionHandler(nil)}
}
@MainActor final class APIClient {
    let base:URL
    private let session:URLSession
    private let readSession:()->Data?
    private var revision=0
    init(base:URL=URL(string:"https://shop-api.ynxweb4.com/api")!,session:URLSession?=nil,readSession:@escaping ()->Data?={Vault.get("apple-commerce-negative-authority-v1")==nil ? Vault.get(ShopSession.storageKey):nil}){self.base=base;self.session=session ?? URLSession(configuration:.ephemeral,delegate:ShopRedirectPolicy(),delegateQueue:nil);self.readSession=readSession}
    var currentSession:ShopSession?{ShopSession.parse(readSession())}
    func invalidate(){revision+=1}
    func capture(requireSession:Bool=true)throws->()throws->Void{
        let current=currentSession;if requireSession && current==nil{throw ShopError.signedOut};let at=revision,original=readSession()
        return {guard at==self.revision,original==self.readSession(),self.currentSession==current else{throw ShopError.contextChanged}}
    }
    private func transmit(_ path:String,method:String,body:Data?)async throws->Data{
        guard base.scheme=="https",!path.hasPrefix("/"),let url=URL(string:path,relativeTo:base.appendingPathComponent("/"))?.absoluteURL,
              url.scheme==base.scheme,url.host==base.host,url.port==base.port,url.path.hasPrefix(base.path+"/"),url.user==nil,url.password==nil,url.fragment==nil else{throw ShopError.unavailable}
        let publicRead=(method=="GET" && (url.path==base.path+"/products" || url.path==base.path+"/auth/config")) || (method=="POST" && [base.path+"/auth/gateway/challenges",base.path+"/auth/gateway/sessions"].contains(url.path))
        let at=revision,original=readSession(),active=currentSession
        if !publicRead && active==nil{throw ShopError.signedOut}
        let assertCurrent={guard at==self.revision,original==self.readSession(),publicRead || self.currentSession==active else{throw ShopError.contextChanged}}
        var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=method=="GET" ? nil:body;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if !publicRead,let active{req.setValue("Bearer \(active.token)",forHTTPHeaderField:"Authorization")}
        do{let(data,response)=try await session.data(for:req);try assertCurrent();guard let http=response as? HTTPURLResponse else{throw ShopError.invalidResponse};if http.statusCode==401{throw ShopError.signedOut};guard (200..<300).contains(http.statusCode) else{throw ShopError.invalidResponse};return data}catch{try assertCurrent();throw error}
    }
    func request<T:Decodable>(_ path:String,method:String="GET",body:Data?=nil)async throws->T{let data=try await transmit(path,method:method,body:body);return try JSONDecoder().decode(T.self,from:data)}
    func data(_ path:String,method:String="GET",body:Data?=nil)async throws->Data{try await transmit(path,method:method,body:body)}
    func raw(_ path:String,method:String="POST",json:[String:Any])async throws->[String:Any]{let data=try await transmit(path,method:method,body:CanonicalJSON.data(json));guard let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.invalidResponse};return value}
}
