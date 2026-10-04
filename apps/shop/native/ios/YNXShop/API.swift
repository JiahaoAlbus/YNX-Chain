import Foundation

struct Product: Codable, Identifiable {
    let productID: String
    let storeID: String
    let name: String
    let description: String?
    let category: String?
    let variants: [Variant]
    let media: [ProductMedia]
    var id: String { productID }

    init(from decoder:Decoder)throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        productID=try c.decode(String.self,forKey:.productID)
        storeID=try c.decode(String.self,forKey:.storeID)
        name=try c.decode(String.self,forKey:.name)
        description=try c.decodeIfPresent(String.self,forKey:.description)
        category=try c.decodeIfPresent(String.self,forKey:.category)
        variants=try c.decode([Variant].self,forKey:.variants)
        // Optional presentation metadata cannot make an original listing vanish.
        media=(try? c.decode([ProductMedia].self,forKey:.media)) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case productID = "ID"
        case storeID = "StoreID"
        case name = "Title"
        case description = "Description"
        case category = "Category"
        case variants = "Variants"
        case media = "Media"
    }
}

struct ProductMedia:Codable {
    let url:String
    let altText:String?
    let kind:String?
    enum CodingKeys:String,CodingKey {case url="URL",altText="AltText",kind="Kind"}
    var imageURL:URL? {
        guard kind==nil || kind=="image",let components=URLComponents(string:url),components.scheme=="https",
              let host=components.host,!host.isEmpty,components.user==nil,components.password==nil else{return nil}
        return components.url
    }
}

struct Variant: Codable, Identifiable {
    let variantID: String
    let name: String
    let priceYNXT: Int64
    let inventory: Int
    var reserved: Int = 0
    var available: Int {max(0,inventory-reserved)}
    var id: String { variantID }

    init(from decoder:Decoder)throws {let c=try decoder.container(keyedBy:CodingKeys.self);variantID=try c.decode(String.self,forKey:.variantID);name=try c.decode(String.self,forKey:.name);priceYNXT=try c.decode(Int64.self,forKey:.priceYNXT);inventory=try c.decode(Int.self,forKey:.inventory);reserved=try c.decodeIfPresent(Int.self,forKey:.reserved) ?? 0}
    enum CodingKeys: String, CodingKey {
        case variantID = "ID"
        case name = "Name"
        case priceYNXT = "PriceYNXT"
        case inventory = "Inventory"
        case reserved = "Reserved"
    }
}

struct CartItem: Codable, Identifiable {
    let productID: String
    let variantID: String
    var quantity: Int
    var id: String { "\(productID.utf8.count):\(productID)\(variantID.utf8.count):\(variantID)" }

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
    var walletBuyer:String? = nil
    var invoiceID:String? = nil
    var payIntentID:String? = nil
    var payMerchant:String? = nil
    var payPayoutAddress:String? = nil
    var settlement:SettlementReceipt? = nil
    var cartConsumption:CartReceipt? = nil
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
        case walletBuyer="WalletBuyer",invoiceID="InvoiceID",payIntentID="PayIntentID",payMerchant="PayMerchant",payPayoutAddress="PayPayoutAddress",settlement="Settlement",cartConsumption="CartConsumption"
    }
}
struct CartReceipt:Codable {let PreviousRevision:String;let Revision:String}
struct SettlementReceipt:Codable {let Status:String;let InvoiceID:String;let IntentID:String;let Merchant:String;let PayoutAddress:String;let Payer:String;let Currency:String;let AmountYNXT:Int64;let BlockHeight:UInt64;let TransactionHash:String}
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
    func openInvoice(_ url:URL,expected:ShopSession)async throws
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]
}
extension AppleNativeAuthority {func openInvoice(_ url:URL,expected:ShopSession)async throws {throw ShopError.unavailable}}
@MainActor final class APIClient {
    let base:URL
    private let session:URLSession
    private let authority:AppleNativeAuthority?
    private var revision=0
    var onSessionChanged:(()->Void)?
    init(base:URL=URL(string:"https://shop-api.ynxweb4.com/api")!,session:URLSession?=nil,authority:AppleNativeAuthority?=nil){self.base=base;self.session=session ?? URLSession(configuration:.ephemeral,delegate:ShopRedirectPolicy(),delegateQueue:nil);self.authority=authority ?? (try? AppleNativeSessionBridge());if let bridge=self.authority as? AppleNativeSessionBridge{bridge.changed={[weak self] in self?.onSessionChanged?()}}}
    var currentSession:ShopSession?{authority?.current}
    func reviewInvoice(_ url:URL,expected:ShopSession)async throws {let check=try capture();guard currentSession==expected,let authority else{throw ShopError.contextChanged};try await authority.openInvoice(url,expected:expected);try check()}
    func invalidate(){revision+=1}
    func restoreNative()async throws{guard let authority else{throw ShopError.unavailable};try await authority.restore()}
    func connectNative()async throws{guard let authority else{throw ShopError.unavailable};try await authority.restore();if authority.current==nil{try await authority.connect()}}
    func returnNative(_ url:URL)async throws{guard let authority else{throw ShopError.unavailable};try await authority.handleReturn(url)}
    func disconnectNative()throws{invalidate();try authority?.disconnect()}
    func capture(requireSession:Bool=true)throws->()throws->Void{
        let current=currentSession;if requireSession && current==nil{throw ShopError.signedOut};let at=revision
        return {guard at==self.revision,self.currentSession==current else{throw ShopError.contextChanged}}
    }
    private func transmit(_ path:String,method:String,body:Data?,beforeDispatch:(()throws->Void)?=nil)async throws->Data{
        guard base.scheme=="https",!path.hasPrefix("/"),let url=URL(string:path,relativeTo:base.appendingPathComponent("/"))?.absoluteURL,
              url.scheme==base.scheme,url.host==base.host,url.port==base.port,url.path.hasPrefix(base.path+"/"),url.user==nil,url.password==nil,url.fragment==nil else{throw ShopError.unavailable}
        let publicRead=method=="GET" && url.path==base.path+"/products"
        let at=revision,active=currentSession
        if !publicRead && active==nil{throw ShopError.signedOut}
        let assertCurrent={guard at==self.revision,publicRead || self.currentSession==active else{throw ShopError.contextChanged}}
        let wire=method=="GET" ? Data():body ?? Data();guard wire.count<=1_048_576,let text=String(data:wire,encoding:.utf8) else{throw ShopError.security}
        var req=URLRequest(url:url);req.httpMethod=method;req.httpBody=method=="GET" ? nil:wire;req.timeoutInterval=12;req.setValue("application/json",forHTTPHeaderField:"Content-Type");req.setValue("application/json",forHTTPHeaderField:"Accept")
        if !publicRead {guard url.query==nil,url.path==base.path+"/"+path,let active,let authority else{throw ShopError.security};let proof=try await authority.proof(method:method,path:url.path,body:text,expected:active);try assertCurrent();guard proof["body"] as? String==text,let identity=proof["identityHeader"] as? String,let action=proof["actionHeader"] as? String,NativeWire.matches(identity,"^[A-Za-z0-9_-]{32,32768}$"),NativeWire.matches(action,"^[A-Za-z0-9_-]{32,32768}$") else{throw ShopError.security};req.setValue(identity,forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2");req.setValue(action,forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2")}
        try assertCurrent();try beforeDispatch?();try assertCurrent()
        do{let(data,response)=try await session.data(for:req);try assertCurrent();guard let http=response as? HTTPURLResponse,data.count<=1_048_576 else{throw ShopError.invalidResponse};if http.statusCode==401{if !publicRead{try authority?.disconnect();onSessionChanged?()};throw ShopError.signedOut};guard (200..<300).contains(http.statusCode) else{throw ShopError.invalidResponse};return data}catch{try assertCurrent();throw error}
    }
    func request<T:Decodable>(_ path:String,method:String="GET",body:Data?=nil)async throws->T{let data=try await transmit(path,method:method,body:body);return try JSONDecoder().decode(T.self,from:data)}
    func data(_ path:String,method:String="GET",body:Data?=nil)async throws->Data{try await transmit(path,method:method,body:body)}
    func raw(_ path:String,method:String="POST",json:[String:Any],beforeDispatch:(()throws->Void)?=nil)async throws->[String:Any]{let data=try await transmit(path,method:method,body:CanonicalJSON.data(json),beforeDispatch:beforeDispatch);guard let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.invalidResponse};return value}
}
