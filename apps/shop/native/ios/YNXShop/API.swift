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
    var nativePrice:SellerNativePriceDATA?=nil
    var available: Int {guard inventory>=0,reserved>=0,reserved<=inventory else{return 0};return inventory-reserved}
    var id: String { variantID }

    init(from decoder:Decoder)throws {let c=try decoder.container(keyedBy:CodingKeys.self);variantID=try c.decode(String.self,forKey:.variantID);name=try c.decode(String.self,forKey:.name);priceYNXT=try c.decode(Int64.self,forKey:.priceYNXT);inventory=try c.decode(Int.self,forKey:.inventory);reserved=try c.decodeIfPresent(Int.self,forKey:.reserved) ?? 0;nativePrice=try c.decodeIfPresent(SellerNativePriceDATA.self,forKey:.nativePrice)}
    enum CodingKeys: String, CodingKey {
        case variantID = "ID"
        case name = "Name"
        case priceYNXT = "PriceYNXT"
        case inventory = "Inventory"
        case reserved = "Reserved"
        case nativePrice="NativePrice"
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
    var nativePrice:NativeCheckoutPrice?=nil
    var nativeLines:[NativeCheckoutLine]?=nil
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
        case nativePrice="NativePrice",nativeLines="Lines"
        case walletBuyer="WalletBuyer",invoiceID="InvoiceID",payIntentID="PayIntentID",payMerchant="PayMerchant",payPayoutAddress="PayPayoutAddress",nativePayment="NativePayment",settlement="Settlement",cartConsumption="CartConsumption"
    }
}
// Frozen native pricing from actual existing seller/profile mutations. Display
// and journal binding only; approval/Source verification stays with the owners.
struct NativeCheckoutUnitPrice:Codable {let Genesis,NativeChainID,AssetID,UnitVersion,AmountAtoms,ApprovalRef:String}
struct NativeCheckoutLine:Codable {let ProductID,VariantID:String;let Quantity:Int64;let NativePrice:NativeCheckoutUnitPrice?}
struct NativeCheckoutPriceFields:Codable {let Merchant,Recipient,Genesis,NativeChainID,AssetID,UnitVersion,AmountAtoms,PriceApprovalRef:String}
struct NativeCheckoutPrice:Codable {
    let Price:NativeCheckoutPriceFields;let Charges:SellerNativeCharges;let ChargesApprovalRef,OrderMutationHash:String
    func validate(_ order:Order)throws {
        func atom(_ text:String)throws->UInt64{guard let n=UInt64(text),String(n)==text else{throw ShopError.security};return n}
        let amount=try atom(Price.AmountAtoms),chain=try atom(Price.NativeChainID)
        guard amount>0,chain>0,NativeWire.matches(Price.Genesis,"^[a-f0-9]{64}$"),Price.AssetID=="YNXT",Price.UnitVersion=="1",NativeWire.matches(Price.Merchant,"^0x[a-f0-9]{40}$"),NativeWire.matches(Price.Recipient,"^0x[a-f0-9]{40}$"),NativeWire.matches(OrderMutationHash,"^[a-f0-9]{64}$"),Charges.Genesis==Price.Genesis,Charges.NativeChainID==Price.NativeChainID,Charges.AssetID==Price.AssetID,Charges.UnitVersion==Price.UnitVersion,let lines=order.nativeLines,!lines.isEmpty,lines.count<=50 else{throw ShopError.security}
        let priceRef=Price.PriceApprovalRef.split(separator:"/"),chargeRef=ChargesApprovalRef.split(separator:"/")
        guard priceRef.count==3,priceRef[0]=="shop.order.price",String(priceRef[1])==order.orderID,NativeWire.matches(String(priceRef[2]),"^[a-f0-9]{64}$"),chargeRef.count==3,chargeRef[0]=="shop.charges",String(chargeRef[1])==order.storeID,NativeWire.matches(String(chargeRef[2]),"^[a-f0-9]{64}$") else{throw ShopError.security}
        if let merchant=order.payMerchant,!merchant.isEmpty{guard merchant==Price.Merchant else{throw ShopError.security}}
        if let recipient=order.payPayoutAddress,!recipient.isEmpty{guard recipient==Price.Recipient else{throw ShopError.security}}
        var sum:UInt64=0,seen=Set<String>()
        for line in lines {
            guard (1...20).contains(line.Quantity),seen.insert(line.ProductID+"/"+line.VariantID).inserted,let price=line.NativePrice,price.Genesis==Price.Genesis,price.NativeChainID==Price.NativeChainID,price.AssetID==Price.AssetID,price.UnitVersion==Price.UnitVersion else{throw ShopError.security}
            let ref=price.ApprovalRef.split(separator:"/")
            guard ref.count==4,ref[0]=="shop.price",String(ref[1])==line.ProductID,let revision=Int64(ref[2]),revision>0,String(revision)==ref[2],NativeWire.matches(String(ref[3]),"^[a-f0-9]{64}$") else{throw ShopError.security}
            let unit=try atom(price.AmountAtoms);guard unit>0 else{throw ShopError.security};let product=unit.multipliedReportingOverflow(by:UInt64(line.Quantity));let next=sum.addingReportingOverflow(product.partialValue);guard !product.overflow,!next.overflow else{throw ShopError.security};sum=next.partialValue
        }
        for text in [Charges.ShippingAtoms,Charges.TaxAtoms]{let next=sum.addingReportingOverflow(try atom(text));guard !next.overflow else{throw ShopError.security};sum=next.partialValue}
        guard sum==amount else{throw ShopError.security}
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
    func validate(_ order:Order,requirePaid:Bool=true)throws {
        if let quote=order.nativePrice{try quote.validate(order);guard quote.Price.AmountAtoms==PrincipalAtoms else{throw ShopError.security}}
        func atoms(_ text:String)throws->UInt64 {guard let n=UInt64(text),String(n)==text else{throw ShopError.security};return n}
        func hex(_ text:String,_ prefix:Bool=false)->Bool{NativeWire.matches(text,prefix ? "^0x[a-f0-9]{64}$":"^[a-f0-9]{64}$")}
        let pending=PendingOriginals ?? []
        let principal=try atoms(PrincipalAtoms),paid=try atoms(PaidAtoms),refunded=try atoms(RefundedAtoms),net=try atoms(NetPaidAtoms)
        guard NativeWire.matches(order.payIntentID ?? "","^npi_[a-f0-9]{48}$"),InvoiceID==order.invoiceID,!InvoiceID.isEmpty,!SessionID.isEmpty,hex(TermsHash),principal>0,refunded<=paid,net==paid-refunded,(paid==0 || paid==principal),Receipts.count<=1024,pending.count<=1024,CompleteKnownOriginals==pending.isEmpty else{throw ShopError.security}
        if requirePaid {guard !ReconciliationRequired,paid==principal else{throw ShopError.security}}
        var seen=Set<String>(),claims=Set<String>(),refunds=Set<String>(),settlement="",genesis:String?,chain:String?
        var observedPaid:UInt64=0,observedRefunded:UInt64=0,previous:[UInt64]?
        for receipt in Receipts {
            guard receipt.version=="ynx.pay.native.archive-receipt/v1",receipt.productId=="shop.order",receipt.storeId==order.storeID,receipt.sourceOrder==order.orderID,receipt.invoiceId==InvoiceID,receipt.sessionId==SessionID,receipt.termsHash==TermsHash,receipt.merchant==order.payMerchant,hex(receipt.nativeHash,true),hex(receipt.abciHash,true),hex(receipt.archiveDigest),seen.insert(receipt.nativeHash).inserted,hex(receipt.genesis),receipt.assetId=="YNXT",receipt.unitVersion=="1",(order.nativePrice==nil || (receipt.genesis==order.nativePrice!.Price.Genesis && receipt.nativeChainId==order.nativePrice!.Price.NativeChainID)),receipt.proofVerification=="original-independent-core-verifier",receipt.dataOnly,receipt.queryOnly,!receipt.canRetry,!receipt.SourceAdmission,!receipt.nativeGrant else{throw ShopError.security}
            _ = try atoms(receipt.nativeChainId)
            if let genesis,let chain {guard receipt.genesis==genesis,receipt.nativeChainId==chain else{throw ShopError.security}}else{genesis=receipt.genesis;chain=receipt.nativeChainId}
            let coordinate=try [receipt.executionHeight,receipt.executionIndex,receipt.executionMember,receipt.executionEvent].map{try atoms($0)}
            guard coordinate[0]>0,coordinate[3]==0,previous==nil || previous!.lexicographicallyPrecedes(coordinate) else{throw ShopError.security};previous=coordinate
            let amount=try atoms(receipt.principalAtoms),claimPaid=try atoms(receipt.paidAtoms),claimRefunded=try atoms(receipt.refundedAtoms),claimNet=try atoms(receipt.netPaidAtoms)
            guard ["invoice_settle","invoice_refund"].contains(receipt.kind) else{throw ShopError.security}
            if receipt.status=="confirmed_failed" {
                guard (receipt.eventClaim ?? "").isEmpty,(receipt.refundId ?? "").isEmpty,(receipt.payer ?? "").isEmpty,(receipt.recipient ?? "").isEmpty,amount==0,claimPaid==0,claimRefunded==0,claimNet==0 else{throw ShopError.security}
                continue
            }
            guard receipt.status=="confirmed",Self.sameHexBuyer(receipt.payer,order.buyer),let event=receipt.eventClaim,hex(event),claims.insert(event).inserted else{throw ShopError.security}
            if receipt.kind=="invoice_settle" {
                guard settlement.isEmpty,receipt.nativeHash==receipt.settlementNativeHash,receipt.recipient==order.payPayoutAddress,(receipt.refundId ?? "").isEmpty,amount==principal,claimPaid==principal,claimRefunded==0,claimNet==principal else{throw ShopError.security}
                settlement=receipt.nativeHash;observedPaid=principal
            }else{
                guard !settlement.isEmpty,receipt.settlementNativeHash==settlement,Self.sameHexBuyer(receipt.recipient,order.buyer),let refund=receipt.refundId,NativeWire.matches(refund,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),refunds.insert(refund).inserted,amount>0,amount<=observedPaid-observedRefunded else{throw ShopError.security}
                observedRefunded+=amount
                guard claimPaid==observedPaid,claimRefunded==observedRefunded,claimNet==observedPaid-observedRefunded else{throw ShopError.security}
            }
        }
        for hash in pending {guard hex(hash,true),seen.insert(hash).inserted else{throw ShopError.security}}
        guard settlement==SettlementNativeHash,paid==observedPaid,refunded==observedRefunded else{throw ShopError.security}
        if order.refundStatus=="native_partial_refund"{guard refunded>0,refunded<paid else{throw ShopError.security}}
        if order.refundStatus=="native_refunded" || order.status=="refunded"{guard refunded>0,refunded==paid else{throw ShopError.security}}
    }
}
struct NativePaymentClaim:Codable {
    let productId:String;let storeId:String;let sourceOrder:String;let merchant:String;let invoiceId:String;let sessionId:String;let termsHash:String
    let nativeHash:String;let settlementNativeHash:String;let kind:String;let status:String;let payer:String?;let recipient:String?
    let version:String;let genesis:String;let nativeChainId:String;let abciHash:String;let archiveDigest:String
    let refundId:String?;let assetId:String;let unitVersion:String;let eventClaim:String?
    let executionHeight:String;let executionIndex:String;let executionMember:String;let executionEvent:String
    let principalAtoms:String;let paidAtoms:String;let refundedAtoms:String;let netPaidAtoms:String
    let proofVerification:String;let dataOnly:Bool;let queryOnly:Bool;let canRetry:Bool;let SourceAdmission:Bool;let nativeGrant:Bool
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
    func openOriginalOrder(_ orderID:String,originalOperation:String,expected:ShopSession)async throws
}
extension AppleOriginalNativePayNavigation {
    func openOriginalOrder(_ orderID:String,originalOperation:String,expected:ShopSession)async throws{throw ShopError.unavailable}
}
// Concrete Shop consumer of the EXISTING normal Main IPC shape. The original
// Main/SDK hosting owner supplies authenticated calls plus same-account/current
// association. These closures are not obtained from URL/ENV or caller JSON.
// No method serializes a Shop token or creates a transport/approval/Pay effect.
struct OriginalMainPayRefusal:Error {let code:String}
@MainActor final class AppleOriginalMainPayNavigation:AppleOriginalNativePayNavigation {
    typealias StatusCall=(ShopSession)async throws->[String:Any]
    typealias InvokeCall=([String:String],ShopSession)async throws->[String:Any]
    private let current:()throws->ShopSession
    private let status:StatusCall,invoke:InvokeCall
    private var active=false
    init(current:@escaping ()throws->ShopSession,status:@escaping StatusCall,invoke:@escaping InvokeCall){self.current=current;self.status=status;self.invoke=invoke}
    private func check(_ expected:ShopSession)throws{guard try current()==expected,let generation=expected.nativeGeneration,generation>0,ShopSession.parse(try JSONEncoder().encode(expected))==expected else{throw ShopError.contextChanged}}
    private func value(_ envelope:[String:Any])throws->[String:Any]{
        guard envelope["ok"] as? Bool==true,let value=envelope["value"] as? [String:Any] else{
            if let error=envelope["error"] as? [String:Any],let code=error["code"] as? String,NativeWire.matches(code,"^[A-Za-z0-9_:-]{1,128}$"){throw OriginalMainPayRefusal(code:code)}
            throw ShopError.unavailable
        };return value
    }
    private func request(_ input:[String:String],operation:String,expected:ShopSession)async throws->[String:Any]{
        guard !active,NativeWire.matches(operation,"^npi_[a-f0-9]{48}$") else{throw ShopError.unresolvedMutation}
        active=true;defer{active=false}
        try check(expected);let ready=try await status(expected);try check(expected);let state=try value(ready)
        guard state["normalMainEntry"] as? Bool==true,state["paymentAuthorized"] as? Bool==false,state["canRequest"] as? Bool != false,(state["available"] as? Bool==true || state["canRequest"] as? Bool==true) else{throw ShopError.unavailable}
        let envelope=try await invoke(input,expected);try check(expected);let result=try value(envelope)
        if result["ok"] as? Bool==false,let code=result["code"] as? String,NativeWire.matches(code,"^[A-Za-z0-9_:-]{1,128}$"){throw OriginalMainPayRefusal(code:code)}
        guard result["ok"] as? Bool != false,result["clientIndependentFinality"] as? Bool==false,let reference=result["reference"] as? [String:Any],reference["intentId"] as? String==operation,let intent=result["intent"] as? [String:Any],intent["intentId"] as? String==operation,intent["originalOperation"] as? String==operation,["PREPARED","ISSUED"].contains(intent["state"] as? String ?? "") else{throw ShopError.security}
        return result
    }
    func openOriginalIntent(_ operation:String,expected:ShopSession)async throws{
        _ = try await request(["action":"intent","intentId":operation],operation:operation,expected:expected)
    }
    func openOriginalOrder(_ orderID:String,originalOperation:String,expected:ShopSession)async throws{
        guard NativeWire.matches(orderID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") else{throw ShopError.security}
        let result=try await request(["action":"order-invoice","productId":"shop.order","sourceOrder":orderID],operation:originalOperation,expected:expected)
        guard result["queryOnly"] as? Bool==true,result["approvalRequired"] as? Bool==false,result["canRetry"] as? Bool==false,result["walletRequest"]==nil,let reference=result["reference"] as? [String:Any],reference["productId"] as? String=="shop.order",reference["sourceOrder"] as? String==orderID,let merchant=reference["merchant"] as? String,NativeWire.matches(merchant,"^0x[a-f0-9]{40}$"),let invoice=reference["invoiceId"] as? String,NativeWire.matches(invoice,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") else{throw ShopError.security}
        if let bill=result["bill"] as? [String:Any]{guard bill["sourceOrder"] as? String==orderID,bill["merchant"] as? String==merchant,bill["invoiceId"] as? String==invoice else{throw ShopError.security}}
    }
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
    func openOriginalNativePay(_ operation:String,orderID:String?=nil)async throws {
        let check=try capture();guard NativeWire.matches(operation,"^npi_[a-f0-9]{48}$"),let current=currentSession,let navigation=nativePayNavigation else{throw ShopError.unavailable}
        if let orderID{try await navigation.openOriginalOrder(orderID,originalOperation:operation,expected:current)}else{try await navigation.openOriginalIntent(operation,expected:current)};try check()
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
