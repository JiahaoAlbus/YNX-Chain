import Foundation

// These names and amounts follow the existing commerce wire. No example rows
// or inferred totals are added to the seller projection.
struct SellerStore:Codable,Identifiable {let ID,Owner,Name,Description,Policy,TrustURL,SettlementAccount,Status:String;let CreatedAt,UpdatedAt:String?;var id:String{self.ID}}
struct SellerVariant:Codable,Identifiable {let ID,Name,SKU:String;let PriceYNXT,Inventory,Reserved:Int64;var id:String{self.ID};var available:Int64{guard Inventory>=0,Reserved>=0,Reserved<=Inventory else{return 0};return Inventory-Reserved}}
struct SellerProduct:Codable,Identifiable {let ID,StoreID,Title,Description,Category:String;let Published:Bool;let Revision:Int64;let Variants:[SellerVariant];let Media:[ProductMedia]?;var id:String{self.ID}}
struct SellerShipment:Codable {let Carrier,TrackingNumber,Status,UpdatedAt:String}
struct SellerAddress:Codable {let Recipient,Line1,City,Region,PostalCode,Country:String}
struct SellerOrderLine:Codable,Identifiable {let ProductID,VariantID,Title,VariantName:String;let Quantity,UnitPriceYNXT:Int64;var id:String{String(ProductID.utf8.count)+":"+ProductID+VariantID}}
struct SellerTimelineEvent:Codable,Identifiable {let ID,Actor,Role,Action,Status,Detail,At:String;var id:String{self.ID}}
struct SellerSettlement:Codable,Identifiable {let InvoiceID,IntentID,Merchant,PayoutAddress,TransactionHash,Status,Payer,Currency,AuditHash:String;let AmountYNXT:Int64;let BlockHeight:UInt64;let ConfirmedAt:String;var id:String{InvoiceID}}
struct SellerRefund:Codable {let ID,Signer,Merchant,IntentID,Currency,Reason,Status,IdempotencyKey,RequestHash,TransactionHash,AuditHash:String;let AmountYNXT:Int64;let BlockHeight:UInt64;let RecordedAt:String}
struct SellerResolution:Codable {let Kind,Status,Reason,Explanation:String}
struct SellerOrder:Codable,Identifiable {let ID,Buyer,StoreID,Status,Currency,InvoiceID,PayIntentID:String;let SubtotalYNXT,ShippingYNXT,TaxYNXT,TotalYNXT:Int64;let TaxStatus,LogisticsStatus,RefundStatus,TrustStatus:String;let Lines:[SellerOrderLine];let Address:SellerAddress;let Shipment:SellerShipment?;let Resolution:SellerResolution?;let Settlement:SellerSettlement?;let Refund:SellerRefund?;let Timeline:[SellerTimelineEvent];var PayMerchant:String?=nil;var PayPayoutAddress:String?=nil;var NativePayment:NativePaymentProjection?=nil;var id:String{self.ID};var originalReturnID:String?{Timeline.last(where:{$0.Status=="return_requested"})?.ID}}
struct SellerMember:Identifiable {let Account,Role:String;var id:String{Account}}
struct SellerAudit:Codable,Identifiable {let ID,Actor,Role,Action,ObjectType,ObjectID,Outcome,Detail,At:String;var id:String{self.ID}}
struct SellerVariantDraft:Codable,Identifiable {var ID,Name,SKU,PriceYNXT,Inventory:String;var id:String{self.ID};init(ID:String="",Name:String="",SKU:String="",PriceYNXT:String="",Inventory:String=""){self.ID=ID;self.Name=Name;self.SKU=SKU;self.PriceYNXT=PriceYNXT;self.Inventory=Inventory}}
struct SellerListingDraft:Codable {var productID,expectedRevision,title,description,category:String;var variants:[SellerVariantDraft];init(productID:String,expectedRevision:String,title:String,description:String,category:String,variants:[SellerVariantDraft]){self.productID=productID;self.expectedRevision=expectedRevision;self.title=title;self.description=description;self.category=category;self.variants=variants};init(_ product:SellerProduct){self.init(productID:product.ID,expectedRevision:String(product.Revision),title:product.Title,description:product.Description,category:product.Category,variants:product.Variants.map{SellerVariantDraft(ID:$0.ID,Name:$0.Name,SKU:$0.SKU,PriceYNXT:String($0.PriceYNXT),Inventory:String($0.Inventory))})}}
enum SellerCommand {
    case updateStore(SellerStore,name:String,description:String,policy:String,trustURL:String,settlementAccount:String)
    case createStore(name:String,description:String,policy:String,trustURL:String,settlementAccount:String)
    case createProduct(SellerListingDraft)
    case activateStore(expectedUpdatedAt:String,expectedPolicy:String,expectedSettlementAccount:String)
    case invitationDecision(SellerInvitation,accept:Bool,reason:String)
    case invite(account:String,role:String,ttlSeconds:String)
    case publish(SellerListingDraft)
    case inventory(productID:String,variantID:String,expectedRevision:String,inventory:String)
    case ship(orderID:String,carrier:String,trackingNumber:String)
    case returnDecision(orderID:String,returnID:String,approve:Bool,explanation:String)
    case revoke(account:String,reason:String)
}

struct SellerRevocation:Codable,Identifiable {let ID,StoreID,Account,PreviousRole,Reason,SessionStatus,SessionRevocationID,LastError,RequestedAt,UpdatedAt:String;let SessionCount:Int;var id:String{self.ID}}

struct SellerInvitation:Codable,Identifiable {let ID,StoreID,Account,Role,CreatedBy,Status,Reason,CreatedAt,ExpiresAt,UpdatedAt,AcceptedAt,CancelledAt:String;var id:String{self.ID}}

extension SellerOrder {
    var paymentOrder:Order {var order=Order(orderID:self.ID,status:Status,totalYNXT:TotalYNXT,refundStatus:RefundStatus,trustStatus:TrustStatus,payDeepLink:nil,buyer:Buyer,storeID:StoreID,currency:Currency);order.invoiceID=InvoiceID;order.payIntentID=PayIntentID;order.payMerchant=PayMerchant;order.payPayoutAddress=PayPayoutAddress;order.nativePayment=NativePayment;return order}
    var paymentDisplayState:String {
        guard PayIntentID.hasPrefix("npi_") else{return Settlement?.Status ?? "unavailable"}
        guard let payment=NativePayment,(try? payment.validate(paymentOrder,requirePaid:false)) != nil else{return "native_receipt_unavailable"}
        if payment.ReconciliationRequired{return "native_reconcile_required"}
        if payment.PaidAtoms=="0"{return "native_unpaid"}
        if payment.RefundedAtoms=="0"{return "native_paid"}
        return payment.RefundedAtoms==payment.PaidAtoms ? "native_refunded":"native_partial_refund"
    }
}
