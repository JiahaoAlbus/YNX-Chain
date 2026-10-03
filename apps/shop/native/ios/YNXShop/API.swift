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
    let buyer: String?
    let storeID: String?
    let currency: String?
    var id: String { orderID }

    enum CodingKeys: String, CodingKey {
        case orderID = "ID"
        case status = "Status"
        case totalYNXT = "TotalYNXT"
        case refundStatus = "RefundStatus"
        case trustStatus = "TrustStatus"
        case payDeepLink = "PayDeepLink"
        case buyer = "Buyer"
        case storeID = "StoreID"
        case currency = "Currency"
    }
}
struct CatalogResponse:Codable { let products:[Product] }
struct OrdersResponse:Codable { let orders:[Order] }

final class ShopRedirectPolicy:NSObject,URLSessionTaskDelegate,@unchecked Sendable {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?)->Void){completionHandler(nil)}
}
@MainActor protocol AppleNativeAuthority:AnyObject {
    var current:ShopSession? {get}
    func restore()async throws
    func connect()async throws
    func handleReturn(_ url:URL)async throws
    func disconnect()throws
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]
}
@MainActor final class APIClient {
    let base:URL
    private let session:URLSession
    private let authority:AppleNativeAuthority?
    private var revision=0
    var onSessionChanged:(()->Void)?
    init(base:URL=URL(string:"https://shop-api.ynxweb4.com/api")!,session:URLSession?=nil,authority:AppleNativeAuthority?=nil){self.base=base;self.session=session ?? URLSession(configuration:.ephemeral,delegate:ShopRedirectPolicy(),delegateQueue:nil);self.authority=authority ?? (try? AppleNativeSessionBridge());if let bridge=self.authority as? AppleNativeSessionBridge{bridge.changed={[weak self] in self?.onSessionChanged?()}}}
    var currentSession:ShopSession?{authority?.current}
    func invalidate(){revision+=1}
    func restoreNative()async throws{guard let authority else{throw ShopError.unavailable};try await authority.restore()}
    func connectNative()async throws{guard let authority else{throw ShopError.unavailable};try await authority.restore();if authority.current==nil{try await authority.connect()}}
    func returnNative(_ url:URL)async throws{guard let authority else{throw ShopError.unavailable};try await authority.handleReturn(url)}
    func disconnectNative()throws{invalidate();try authority?.disconnect()}
    func capture(requireSession:Bool=true)throws->()throws->Void{
        let current=currentSession;if requireSession && current==nil{throw ShopError.signedOut};let at=revision
        return {guard at==self.revision,self.currentSession==current else{throw ShopError.contextChanged}}
    }
    private func transmit(_ path:String,method:String,body:Data?)async throws->Data{
        guard base.scheme=="https",!path.hasPrefix("/"),let url=URL(string:path,relativeTo:base.appendingPathComponent("/"))?.absoluteURL,
              url.scheme==base.scheme,url.host==base.host,url.port==base.port,url.path.hasPrefix(base.path+"/"),url.user==nil,url.password==nil,url.fragment==nil else{throw ShopError.unavailable}
        let publicRead=method=="GET" && url.path==base.path+"/products"
        let at=revision,active=currentSession
        if !publicRead && active==nil{throw ShopError.signedOut}
        let assertCurrent={guard at==self.revision,publicRead || self.currentSession==active else{throw ShopError.contextChanged}}
        let wire=method=="GET" ? Data():body ?? Data();guard wire.count<=1_048_576,let text=String(data:wire,encoding:.utf8) else{throw ShopError.security}
        var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=method=="GET" ? nil:wire;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type");req.setValue("application/json",forHTTPHeaderField:"Accept")
        if !publicRead {guard url.query==nil,url.path==base.path+"/"+path,let active,let authority else{throw ShopError.security};let proof=try await authority.proof(method:method,path:url.path,body:text,expected:active);try assertCurrent();guard proof["body"] as? String==text,let identity=proof["identityHeader"] as? String,let action=proof["actionHeader"] as? String,NativeWire.matches(identity,"^[A-Za-z0-9_-]{32,32768}$"),NativeWire.matches(action,"^[A-Za-z0-9_-]{32,32768}$") else{throw ShopError.security};req.setValue(identity,forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2");req.setValue(action,forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2")}
        do{let(data,response)=try await session.data(for:req);try assertCurrent();guard let http=response as? HTTPURLResponse,data.count<=1_048_576 else{throw ShopError.invalidResponse};if http.statusCode==401{if !publicRead{try authority?.disconnect();onSessionChanged?()};throw ShopError.signedOut};guard (200..<300).contains(http.statusCode) else{throw ShopError.invalidResponse};return data}catch{try assertCurrent();throw error}
    }
    func request<T:Decodable>(_ path:String,method:String="GET",body:Data?=nil)async throws->T{let data=try await transmit(path,method:method,body:body);return try JSONDecoder().decode(T.self,from:data)}
    func data(_ path:String,method:String="GET",body:Data?=nil)async throws->Data{try await transmit(path,method:method,body:body)}
    func raw(_ path:String,method:String="POST",json:[String:Any])async throws->[String:Any]{let data=try await transmit(path,method:method,body:CanonicalJSON.data(json));guard let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.invalidResponse};return value}
}
