import Foundation
import CoreFoundation

// Prices named *YNXT are integer legacy Shop units, not a fiat quote or
// an inferred native-atom denomination. Preserve the protocol and every digit.
enum ShopMoneyDisplay {
    static let legacySymbol="YNXT" // internal/commerce/model.go NativeSymbol
    static func legacyYNXT(_ amount:Int64,locale:Locale = .current)->String {
        guard amount>=0 else{return String(localized:"unavailable",locale:locale)}
        return amount.formatted(.number.locale(locale))+" "+legacySymbol
    }
    static func order(_ order:Order,locale:Locale = .current)->String? {
        guard order.totalYNXT>=0,order.currency==nil || order.currency==legacySymbol else{return nil}
        return legacyYNXT(order.totalYNXT,locale:locale)
    }
    static func atoms(_ text:String,locale:Locale = .current)->String? {
        guard let amount=UInt64(text),String(amount)==text else{return nil}
        return amount.formatted(.number.locale(locale))+" "+String(localized:"native_atoms_unit",locale:locale)
    }
}

struct ShopAgentJob:Codable,Identifiable,Equatable {
    let jobID:String;let actor:String;let walletActor:String?
    let workflow:String;let status:String;let providerStatus:String
    let contextSummary:String;let contextClasses:[String];let allowedActions:[String]
    let estimateUnits:Int64;let permissionGranted:Bool
    let result:String;let failure:String;let applied:Bool;let rejected:Bool;let cancelled:Bool
    let runAttemptID:String?
    var id:String{jobID}
    var terminal:Bool{["applied_draft","rejected","cancelled","failed"].contains(status)}
    enum CodingKeys:String,CodingKey {
        case jobID="ID",actor="Actor",walletActor="WalletActor",workflow="Workflow",status="Status",providerStatus="ProviderStatus"
        case contextSummary="ContextSummary",contextClasses="ContextClasses",allowedActions="AllowedActions",estimateUnits="EstimateUnits",permissionGranted="PermissionGranted"
        case result="Result",failure="Failure",applied="Applied",rejected="Rejected",cancelled="Cancelled",runAttemptID="RunAttemptID"
    }
    func validate(account:String,original:ShopComparisonJournal.Record?=nil)throws {
        guard actor==account || walletActor==account,NativeWire.matches(jobID,"^ai_[a-f0-9]{24}$"),workflow=="search_comparison",
              contextClasses==["public_catalog"],allowedActions==["draft_comparison"],permissionGranted,estimateUnits==1,
              ["permission_granted","running","failed","review_required","applied_draft","rejected","cancelled"].contains(status),
              applied==(status=="applied_draft"),rejected==(status=="rejected"),cancelled==(status=="cancelled") else{throw ShopError.security}
        if let original {guard original.account==account,original.jobID==nil || original.jobID==jobID,original.contextSummary==contextSummary else{throw ShopError.security}}
    }
}
struct ShopAgentJobsResponse:Decodable {let jobs:[ShopAgentJob];let Limit:Int}
struct ShopAgentLookupResponse:Decodable {let Actor:String;let IdempotencyKey:String;let QueryOnly:Bool;let Job:ShopAgentJob}
struct AgentComparisonPresentation:Identifiable {
    let id:String;let query:String;let contextSummary:String;let products:[Product]
    let processingUnits:Int64=1
    // This proposal grants no spending authority, budget or validity interval.
}

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
    var available: Int {guard inventory>=0,reserved>=0,reserved<=inventory else{return 0};return inventory-reserved}
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
    var nativePayment:NativePaymentProjection? = nil
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
        case walletBuyer="WalletBuyer",invoiceID="InvoiceID",payIntentID="PayIntentID",payMerchant="PayMerchant",payPayoutAddress="PayPayoutAddress",nativePayment="NativePayment",settlement="Settlement",cartConsumption="CartConsumption"
    }
}
// Display consistency on the authenticated Shop response; proof verification stays on the server.
struct NativePaymentProjection:Codable {
    let InvoiceID:String;let SessionID:String;let TermsHash:String;let SettlementNativeHash:String
    let PrincipalAtoms:String;let PaidAtoms:String;let RefundedAtoms:String;let NetPaidAtoms:String
    let ReconciliationRequired:Bool;let Receipts:[NativePaymentClaim]
    let PendingOriginals:[String]?;let CompleteKnownOriginals:Bool
    private static func sameHexBuyer(_ a:String?,_ b:String?)->Bool {
        guard let a,let b else{return false}
        return a==b || (NativeWire.matches(a,"^0x[a-fA-F0-9]{40}$") && NativeWire.matches(b,"^0x[a-fA-F0-9]{40}$") && a.lowercased()==b.lowercased())
    }
    func validate(_ order:Order)throws {
        func atoms(_ text:String)throws->UInt64 {guard let n=UInt64(text),String(n)==text else{throw ShopError.security};return n}
        let principal=try atoms(PrincipalAtoms),paid=try atoms(PaidAtoms),refunded=try atoms(RefundedAtoms),net=try atoms(NetPaidAtoms)
        guard !ReconciliationRequired,InvoiceID==order.invoiceID,!SessionID.isEmpty,NativeWire.matches(TermsHash,"^[a-f0-9]{64}$"),NativeWire.matches(SettlementNativeHash,"^0x[a-f0-9]{64}$"),principal>0,paid==principal,refunded<=paid,net==paid-refunded,!Receipts.isEmpty else{throw ShopError.security}
        var settlementCount=0
        for receipt in Receipts {
            guard receipt.productId=="shop.order",receipt.storeId==order.storeID,receipt.sourceOrder==order.orderID,receipt.invoiceId==InvoiceID,receipt.sessionId==SessionID,receipt.termsHash==TermsHash,receipt.merchant==order.payMerchant,receipt.settlementNativeHash==SettlementNativeHash else{throw ShopError.security}
            if receipt.kind=="invoice_settle" && receipt.status=="confirmed" {
                guard receipt.nativeHash==SettlementNativeHash,Self.sameHexBuyer(receipt.payer,order.buyer),receipt.recipient==order.payPayoutAddress else{throw ShopError.security};settlementCount+=1
            }
        }
        guard settlementCount==1 else{throw ShopError.security}
    }
}
struct NativePaymentClaim:Codable {
    let productId:String;let storeId:String;let sourceOrder:String;let merchant:String;let invoiceId:String;let sessionId:String;let termsHash:String
    let nativeHash:String;let settlementNativeHash:String;let kind:String;let status:String;let payer:String?;let recipient:String?
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
// Supplied by the original qualified Main/Pay navigation owner. It opens the
// existing Main intent entry; no URL, JSON capsule, approve or send is accepted.
@MainActor protocol AppleOriginalNativePayNavigation:AnyObject {
    func openOriginalIntent(_ operation:String,expected:ShopSession)async throws
}
extension AppleNativeAuthority {func openInvoice(_ url:URL,expected:ShopSession)async throws {throw ShopError.unavailable}}
@MainActor final class APIClient {
    let base:URL
    private let session:URLSession
    private var authority:AppleNativeAuthority?
    private let authorityFactory:@MainActor ()throws->AppleNativeAuthority
	private let nativePayNavigation:AppleOriginalNativePayNavigation?
	let nativeInvoiceMode:Bool
    private var revision=0
    var onSessionChanged:(()->Void)?
    init(base:URL=URL(string:"https://shop-api.ynxweb4.com/api")!,session:URLSession?=nil,authority:AppleNativeAuthority?=nil,nativeInvoiceMode:Bool=true,nativePayNavigation:AppleOriginalNativePayNavigation?=nil,authorityFactory:@escaping @MainActor ()throws->AppleNativeAuthority={try AppleNativeSessionBridge()}){self.nativeInvoiceMode=nativeInvoiceMode;self.nativePayNavigation=nativePayNavigation;self.base=base;self.session=session ?? URLSession(configuration:.ephemeral,delegate:ShopRedirectPolicy(),delegateQueue:nil);self.authority=authority;self.authorityFactory=authorityFactory;if let bridge=self.authority as? AppleNativeSessionBridge{bridge.changed={[weak self] in self?.onSessionChanged?()}}}
    var currentSession:ShopSession?{authority?.current}
    func reviewInvoice(_ url:URL,expected:ShopSession)async throws {let check=try capture();guard currentSession==expected,let authority else{throw ShopError.contextChanged};try await authority.openInvoice(url,expected:expected);try check()}
    func openOriginalNativePay(_ operation:String)async throws {
        let check=try capture();guard NativeWire.matches(operation,"^npi_[a-f0-9]{48}$"),let current=currentSession,let navigation=nativePayNavigation else{throw ShopError.unavailable}
        try await navigation.openOriginalIntent(operation,expected:current);try check()
    }
    func invalidate(){revision+=1}
    func restoreNative()async throws{guard let authority else{throw ShopError.unavailable};try await authority.restore()}
    var nativeAccessLocked:Bool{authority==nil}
    private func openAuthorityForUserAction()throws->AppleNativeAuthority {
        if let authority{return authority}
        let opened=try authorityFactory();authority=opened
        if let bridge=opened as? AppleNativeSessionBridge{bridge.changed={[weak self] in self?.onSessionChanged?()}}
        return opened
    }
    func connectNative()async throws{
        // Cold restore stays locked. Only explicit sign-in may start OS UI.
        let authority=try openAuthorityForUserAction()
        try await authority.restore();if authority.current==nil{try await authority.connect()}
    }
    func resumeNativeReturnByUser(_ url:URL)async throws {
        // Resume the retained original callback, never create another connect request.
        let epoch=revision;let authority=try openAuthorityForUserAction();try await authority.handleReturn(url);guard revision==epoch else{throw ShopError.contextChanged}
    }
    func returnNative(_ url:URL)async throws{guard let authority else{throw ShopError.unavailable};try await authority.handleReturn(url)}
    func disconnectNative()throws{invalidate();try authority?.disconnect()}
    func capture(requireSession:Bool=true)throws->()throws->Void{
        let current=currentSession;if requireSession && current==nil{throw ShopError.signedOut};let at=revision
        return {guard at==self.revision,self.currentSession==current else{throw ShopError.contextChanged}}
    }
    private func transmit(_ path:String,method:String,body:Data?,beforeDispatch:(()throws->Void)?=nil)async throws->Data{
        guard base.scheme=="https",!path.hasPrefix("/"),let url=URL(string:path,relativeTo:base.appendingPathComponent("/"))?.absoluteURL,
              url.scheme==base.scheme,url.host==base.host,url.port==base.port,url.path.hasPrefix(base.path+"/"),url.user==nil,url.password==nil,url.fragment==nil else{throw ShopError.unavailable}
        let publicRead=method=="GET" && (url.path==base.path+"/products" || NativeWire.matches(path,"^products/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"))
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
    // Resolve the whole original cart independently of the current catalog filter.
    // Public listing facts are preflight only; the Store still atomically freezes
    // current prices and reserves all rows under the original cart revision.
    func checkoutStore(_ items:[CartItem],current:()throws->Void)async throws->String {
        guard !items.isEmpty,items.count<=100,Set(items.map(\.id)).count==items.count else{throw ShopError.security}
        var resolved:[String:Product]=[:],store:String?
        for item in items {
            try current()
            guard NativeWire.matches(item.productID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),NativeWire.matches(item.variantID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),(1...20).contains(item.quantity) else{throw ShopError.security}
            let product:Product
            if let prior=resolved[item.productID]{product=prior}else{product=try await request("products/\(item.productID)");try current();resolved[item.productID]=product}
            let variants=product.variants.filter{$0.variantID==item.variantID}
            guard product.productID==item.productID,NativeWire.matches(product.storeID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),variants.count==1,let variant=variants.first,variant.priceYNXT>0,variant.reserved>=0,variant.inventory>=variant.reserved,variant.available>=item.quantity,store==nil || store==product.storeID else{throw ShopError.security}
            store=product.storeID
        }
        try current();guard let store else{throw ShopError.security};return store
    }
    func data(_ path:String,method:String="GET",body:Data?=nil)async throws->Data{try await transmit(path,method:method,body:body)}
    func raw(_ path:String,method:String="POST",json:[String:Any],beforeDispatch:(()throws->Void)?=nil)async throws->[String:Any]{let data=try await transmit(path,method:method,body:CanonicalJSON.data(json),beforeDispatch:beforeDispatch);guard let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw ShopError.invalidResponse};return value}
    // Signed Shop action reads verified original Pay receipts; no funds dispatch.
    func confirmOriginalPayment(_ order:Order,beforeDispatch:(()throws->Void)?=nil)async throws {
        let check=try capture();guard let account=currentSession?.account else{throw ShopError.signedOut}
        try AppleBuyerReceipt.validate(order,account:account)
        if let operation=order.payIntentID,operation.hasPrefix("npi_") {
            guard NativeWire.matches(operation,"^npi_[a-f0-9]{48}$") else{throw ShopError.security}
        }
        _ = try await raw("orders/\(order.orderID)/confirm-payment",json:[:],beforeDispatch:beforeDispatch);try check()
        // The model refreshes the order independently rather than trusting this response.
    }
	func readOriginalNativeIntent(_ order:Order)async throws {
		let check=try capture();guard let account=currentSession?.account else{throw ShopError.signedOut}
		try AppleBuyerReceipt.validate(order,account:account)
		guard let operation=order.payIntentID,NativeWire.matches(operation,"^npi_[a-f0-9]{48}$") else{throw ShopError.security}
		let result=try await raw("orders/\(order.orderID)/native-pay-intent",method:"GET",json:[:]);try check()
		guard result["orderId"] as? String==order.orderID,result["originalOperation"] as? String==operation,
		      let query=result["queryOnly"] as? NSNumber,CFGetTypeID(query)==CFBooleanGetTypeID(),query.boolValue,
		      let funds=result["fundsVerified"] as? NSNumber,CFGetTypeID(funds)==CFBooleanGetTypeID(),!funds.boolValue,
		      let state=result["state"] as? String,["PREPARED","ISSUED"].contains(state),
		      let phase=result["phase"] as? String,NativeWire.matches(phase,"^[A-Za-z0-9._:-]{1,96}$") else{throw ShopError.security}
		// An observation never mutates the order or confirms funds. The model
		// refreshes the original order through its independent normal read path.
	}
}
