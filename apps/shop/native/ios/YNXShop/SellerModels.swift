import Foundation

// These names and amounts follow the existing commerce wire. No example rows
// or inferred totals are added to the seller projection.
struct SellerStore:Codable,Identifiable {let ID,Owner,Name,Description,Policy,TrustURL,SettlementAccount,Status:String;let CreatedAt,UpdatedAt:String?;var NativeCharges:SellerNativeCharges?=nil;var NativeChargesApprovalRef:String?=nil;var id:String{self.ID}}
struct SellerVariant:Codable,Identifiable {let ID,Name,SKU:String;let PriceYNXT,Inventory,Reserved:Int64;var NativePrice:SellerNativePriceDATA?=nil;var id:String{self.ID};var available:Int64{guard Inventory>=0,Reserved>=0,Reserved<=Inventory else{return 0};return Inventory-Reserved}}
struct SellerProduct:Codable,Identifiable {let ID,StoreID,Title,Description,Category:String;let Published:Bool;let Revision:Int64;let Variants:[SellerVariant];let Media:[ProductMedia]?;var id:String{self.ID}}
struct SellerShipment:Codable {let Carrier,TrackingNumber,Status,UpdatedAt:String}
struct SellerAddress:Codable {let Recipient,Line1,City,Region,PostalCode,Country:String}
struct SellerOrderLine:Codable,Identifiable {let ProductID,VariantID,Title,VariantName:String;let Quantity,UnitPriceYNXT:Int64;var NativePrice:NativeCheckoutUnitPrice?=nil;var id:String{String(ProductID.utf8.count)+":"+ProductID+VariantID}}
struct SellerTimelineEvent:Codable,Identifiable {let ID,Actor,Role,Action,Status,Detail,At:String;var id:String{self.ID}}
struct SellerSettlement:Codable,Identifiable {let InvoiceID,IntentID,Merchant,PayoutAddress,TransactionHash,Status,Payer,Currency,AuditHash:String;let AmountYNXT:Int64;let BlockHeight:UInt64;let ConfirmedAt:String;var id:String{InvoiceID}}
struct SellerRefund:Codable {let ID,Signer,Merchant,IntentID,Currency,Reason,Status,IdempotencyKey,RequestHash,TransactionHash,AuditHash:String;let AmountYNXT:Int64;let BlockHeight:UInt64;let RecordedAt:String}
struct SellerResolution:Codable {let Kind,Status,Reason,Explanation:String}
struct SellerReturnItem:Codable,Equatable,Identifiable {let ProductID,VariantID,Quantity:String;var id:String{String(ProductID.utf8.count)+":"+ProductID+VariantID}}
struct SellerReturnReceipt:Codable,Identifiable {let ID,ReturnID,ReceivedBy,EvidenceReference,RequestHash:String;let Items:[SellerReturnItem];let ReceivedAt:String;let RestockedBy,RestockedAt:String?;var id:String{self.ID}}
struct SellerPendingOperation:Identifiable {let id,kind,phase,storeID,target:String}
// Presentation of Main's original review only. Main retains the authoritative
// operation; this is never encoded into the Seller mutation/funds journal.
struct SellerRefundReview {
    let refundID,amountAtoms:String
    var reviewID:String?
    var phase:String
    private let orderID, storeID, buyer, intentID, invoiceID, sessionID, termsHash:String
    private let merchant, payout:String?

    init(order:SellerOrder,payment:NativePaymentProjection,refundID:String,amountAtoms:String) {
        self.refundID=refundID;self.amountAtoms=amountAtoms;phase="unknown"
        orderID=order.ID;storeID=order.StoreID;buyer=order.Buyer;intentID=order.PayIntentID;invoiceID=order.InvoiceID
        sessionID=payment.SessionID;termsHash=payment.TermsHash;merchant=order.PayMerchant;payout=order.PayPayoutAddress
    }

    func confirmed(in order:SellerOrder)->Bool {
        guard order.ID==orderID, order.StoreID==storeID, order.Buyer==buyer, order.PayIntentID==intentID,
              order.InvoiceID==invoiceID, order.PayMerchant==merchant, order.PayPayoutAddress==payout,
              let payment=order.NativePayment, payment.SessionID==sessionID, payment.TermsHash==termsHash,
              payment.CompleteKnownOriginals, !payment.ReconciliationRequired,
              (try? payment.validate(order.paymentOrder,requirePaid:false)) != nil else{return false}
        return payment.Receipts.contains{
            $0.kind=="invoice_refund" && $0.status=="confirmed" && $0.refundId==refundID && $0.principalAtoms==amountAtoms
        }
    }
}
struct SellerOrder:Codable,Identifiable {let ID,Buyer,StoreID,Status,Currency,InvoiceID,PayIntentID:String;let SubtotalYNXT,ShippingYNXT,TaxYNXT,TotalYNXT:Int64;let TaxStatus,LogisticsStatus,RefundStatus,TrustStatus:String;let Lines:[SellerOrderLine];let Address:SellerAddress;let Shipment:SellerShipment?;let Resolution:SellerResolution?;let Settlement:SellerSettlement?;let Refund:SellerRefund?;let Timeline:[SellerTimelineEvent];var PayMerchant:String?=nil;var PayPayoutAddress:String?=nil;var NativePayment:NativePaymentProjection?=nil;var NativePrice:NativeCheckoutPrice?=nil;var ReturnReceipts:[SellerReturnReceipt]?=nil;var id:String{self.ID};var originalReturnID:String?{Timeline.last(where:{$0.Action=="order_transition" && $0.Status=="return_requested"})?.ID}}
struct SellerMember:Identifiable {let Account,Role:String;var id:String{Account}}
struct SellerAudit:Codable,Identifiable {let ID,Actor,Role,Action,ObjectType,ObjectID,Outcome,Detail,At:String;var id:String{self.ID}}
struct SellerVariantDraft:Codable,Identifiable {var ID,Name,SKU,PriceYNXT,Inventory:String;var nativePrice:SellerNativePriceDraft?=nil;var id:String{self.ID};init(ID:String="",Name:String="",SKU:String="",PriceYNXT:String="",Inventory:String="",nativePrice:SellerNativePriceDraft?=nil){self.ID=ID;self.Name=Name;self.SKU=SKU;self.PriceYNXT=PriceYNXT;self.Inventory=Inventory;self.nativePrice=nativePrice}}
struct SellerListingDraft:Codable {var productID,expectedRevision,title,description,category:String;var variants:[SellerVariantDraft];init(productID:String,expectedRevision:String,title:String,description:String,category:String,variants:[SellerVariantDraft]){self.productID=productID;self.expectedRevision=expectedRevision;self.title=title;self.description=description;self.category=category;self.variants=variants};init(_ product:SellerProduct){self.init(productID:product.ID,expectedRevision:String(product.Revision),title:product.Title,description:product.Description,category:product.Category,variants:product.Variants.map{SellerVariantDraft(ID:$0.ID,Name:$0.Name,SKU:$0.SKU,PriceYNXT:String($0.PriceYNXT),Inventory:String($0.Inventory),nativePrice:$0.NativePrice.map{SellerNativePriceDraft(genesis:$0.Genesis,nativeChainID:$0.NativeChainID,amountAtoms:$0.AmountAtoms)})})}}
enum SellerCommand {
    case updateStore(SellerStore,name:String,description:String,policy:String,trustURL:String,settlementAccount:String,nativeCharges:SellerNativeCharges?=nil)
    case createStore(name:String,description:String,policy:String,trustURL:String,settlementAccount:String)
    case createProduct(SellerListingDraft)
    case activateStore(expectedUpdatedAt:String,expectedPolicy:String,expectedSettlementAccount:String)
    case invitationDecision(SellerInvitation,accept:Bool,reason:String)
    case invite(account:String,role:String,ttlSeconds:String)
    case publish(SellerListingDraft)
    case inventory(productID:String,variantID:String,expectedRevision:String,inventory:String)
    case ship(orderID:String,carrier:String,trackingNumber:String)
    case returnDecision(orderID:String,returnID:String,approve:Bool,explanation:String)
    case receiveReturn(orderID:String,returnID:String,evidenceReference:String,items:[SellerReturnItem])
    case restockReturn(orderID:String,receiptID:String)
    case revoke(account:String,reason:String)
}

struct SellerRevocation:Codable,Identifiable {let ID,StoreID,Account,PreviousRole,Reason,SessionStatus,SessionRevocationID,LastError,RequestedAt,UpdatedAt:String;let SessionCount:Int;var id:String{self.ID}}

struct SellerInvitation:Codable,Identifiable {let ID,StoreID,Account,Role,CreatedBy,Status,Reason,CreatedAt,ExpiresAt,UpdatedAt,AcceptedAt,CancelledAt:String;var id:String{self.ID}}

extension SellerOrder {
    var originalRefundRequestID:String? {
        guard Status=="refund_requested",Set(Timeline.map(\.ID)).count==Timeline.count,
              let event=Timeline.last(where:{$0.Action=="order_transition"}),event.Status=="refund_requested",
              event.Role=="buyer",event.Actor==Buyer,
              NativeWire.matches(event.ID,"^event_[a-f0-9]{24}$"),
              !(NativePayment?.Receipts.contains(where:{$0.refundId==event.ID}) ?? false) else{return nil}
        return event.ID
    }
    var validatedNetPaidAtoms:String? {
        guard let payment=NativePayment,(try? payment.validate(paymentOrder)) != nil,
              payment.CompleteKnownOriginals,(payment.PendingOriginals ?? []).isEmpty,
              let amount=UInt64(payment.NetPaidAtoms),amount>0,String(amount)==payment.NetPaidAtoms else{return nil}
        return payment.NetPaidAtoms
    }
    // Warehouse quantities come from the original lines minus every accepted
    // receipt. Refunding money never implicitly receives or restocks goods.
    var approvedReturnIDs:[String] {
        var requested:String?,approved:[String]=[]
        for event in Timeline where event.Action=="order_transition" {
            if event.Status=="return_requested"{requested=event.ID}
            else if event.Status=="return_rejected"{requested=nil}
            else if event.Status=="return_approved",let id=requested{if !approved.contains(id){approved.append(id)};requested=nil}
        }
        return approved
    }
    static func validWarehouseID(_ value:String)->Bool{NativeWire.matches(value,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")}
    static func positiveQuantity(_ value:String)->Int64?{guard let n=Int64(value),n>0,String(n)==value else{return nil};return n}
    static func recordedTime(_ value:String)->Bool {
        guard !value.hasPrefix("0001-") else{return false}
        let parser=ISO8601DateFormatter();if parser.date(from:value) != nil{return true};parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return parser.date(from:value) != nil
    }
    var remainingReturnItems:[SellerReturnItem]? {
        guard !Lines.isEmpty,Lines.count<=50,(ReturnReceipts ?? []).count<=1000,Set(Timeline.map(\.ID)).count==Timeline.count else{return nil}
        var remaining:[String:Int64]=[:],receiptIDs=Set<String>(),references=Set<String>()
        for line in Lines{guard Self.validWarehouseID(line.ProductID),Self.validWarehouseID(line.VariantID),line.Quantity>0,remaining[line.id]==nil else{return nil};remaining[line.id]=line.Quantity}
        for receipt in ReturnReceipts ?? [] {
            guard Self.validWarehouseID(receipt.ID),receiptIDs.insert(receipt.ID).inserted,approvedReturnIDs.contains(receipt.ReturnID),!receipt.ReceivedBy.isEmpty,Self.recordedTime(receipt.ReceivedAt),Self.validWarehouseID(receipt.EvidenceReference),references.insert(receipt.EvidenceReference).inserted,NativeWire.matches(receipt.RequestHash,"^[a-f0-9]{64}$"),(1...50).contains(receipt.Items.count) else{return nil}
            if let date=receipt.RestockedAt{guard Self.recordedTime(date),!(receipt.RestockedBy ?? "").isEmpty else{return nil}}
            else if !(receipt.RestockedBy ?? "").isEmpty{return nil}
            var seen=Set<String>()
            for item in receipt.Items{guard seen.insert(item.id).inserted,let count=Self.positiveQuantity(item.Quantity),let left=remaining[item.id],count<=left else{return nil};remaining[item.id]=left-count}
        }
        return Lines.compactMap{line in guard let n=remaining[line.id],n>0 else{return nil};return SellerReturnItem(ProductID:line.ProductID,VariantID:line.VariantID,Quantity:String(n))}
    }
    var hasOriginalPaidRecord:Bool {
        if PayIntentID.hasPrefix("npi_"){guard let payment=NativePayment else{return false};return (try? payment.validate(paymentOrder)) != nil}
        guard let proof=Settlement else{return false}
        func sameAccount(_ a:String,_ b:String?)->Bool{guard let b else{return false};return a==b || (NativeWire.matches(a,"^0x[a-fA-F0-9]{40}$") && NativeWire.matches(b,"^0x[a-fA-F0-9]{40}$") && a.lowercased()==b.lowercased())}
        return Self.validWarehouseID(InvoiceID) && Self.validWarehouseID(PayIntentID) && !(PayMerchant ?? "").isEmpty && !(PayPayoutAddress ?? "").isEmpty && proof.InvoiceID==InvoiceID && proof.IntentID==PayIntentID && proof.Merchant==PayMerchant && sameAccount(proof.PayoutAddress,PayPayoutAddress) && sameAccount(proof.Payer,Buyer) && Currency=="YNXT" && proof.Currency==Currency && TotalYNXT>0 && proof.AmountYNXT==TotalYNXT && proof.BlockHeight>0 && proof.Status=="paid" && NativeWire.matches(proof.TransactionHash,"^0x[a-fA-F0-9]{64}$") && NativeWire.matches(proof.AuditHash,"^[a-fA-F0-9]{64}$") && Self.recordedTime(proof.ConfirmedAt)
    }
    var paymentOrder:Order {var order=Order(orderID:self.ID,status:Status,totalYNXT:TotalYNXT,refundStatus:RefundStatus,trustStatus:TrustStatus,payDeepLink:nil,buyer:Buyer,storeID:StoreID,currency:Currency);order.invoiceID=InvoiceID;order.payIntentID=PayIntentID;order.payMerchant=PayMerchant;order.payPayoutAddress=PayPayoutAddress;order.nativePayment=NativePayment;order.nativePrice=NativePrice;order.nativeLines=Lines.map{NativeCheckoutLine(ProductID:$0.ProductID,VariantID:$0.VariantID,Quantity:$0.Quantity,NativePrice:$0.NativePrice)};return order}
    var paymentDisplayState:String {
        guard PayIntentID.hasPrefix("npi_") else{return Settlement?.Status ?? "unavailable"}
        guard let payment=NativePayment,(try? payment.validate(paymentOrder,requirePaid:false)) != nil else{return "native_receipt_unavailable"}
        if payment.ReconciliationRequired{return "native_reconcile_required"}
        if payment.PaidAtoms=="0"{return "native_unpaid"}
        if payment.RefundedAtoms=="0"{return "native_paid"}
        return payment.RefundedAtoms==payment.PaidAtoms ? "native_refunded":"native_partial_refund"
    }
}

struct SellerNativePriceDATA:Codable {let Genesis,NativeChainID,AssetID,UnitVersion,AmountAtoms:String}
struct SellerNativePriceDraft:Codable {var genesis,nativeChainID,amountAtoms:String;var assetID="YNXT",unitVersion="1"}
struct SellerNativeCharges:Codable {var Genesis,NativeChainID,AssetID,UnitVersion,ShippingAtoms,TaxAtoms:String}
