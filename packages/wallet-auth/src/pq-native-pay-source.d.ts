export interface OriginalPayNativeTarget {readonly version:1;readonly service:'pay';readonly kind:'invoice_terms'|'invoice_settle'|'invoice_refund';readonly intentId:string|null;readonly merchant:string|null;readonly invoiceId:string|null;readonly requestPath:string;}
export interface OriginalPayNativeBinding {readonly networkId:string;readonly account:string;readonly hash:string;readonly memberHash:string;readonly operationId:string;readonly target:OriginalPayNativeTarget;}
export interface OriginalPayNativePacket {readonly method:'POST'|'GET';readonly requestPath:string;readonly status:number;readonly contentType:string;readonly cacheControl:string;readonly body:Uint8Array;}
/** Metadata selectors only. Original protected Native/Main must independently
 * recognize the SAME actual request/permission/capsule/borrow/current/Member. */
export interface OriginalPayNativeInput {readonly request:object|null;readonly original:Readonly<Record<string,unknown>>&Readonly<{account:string;hash:string;operationId:string;typed:Readonly<Record<string,unknown>>&Readonly<{networkId:string;memberHash:string}>}>;readonly target:OriginalPayNativeTarget;}
export interface OriginalPayNativeSource {readOriginal():OriginalPayNativeBinding;assertCurrent():void;recheck():Promise<void>;retire():void;join():Promise<void>;close():Promise<void>;drainPartial():Promise<void>;readOriginalPacketOutcome():OriginalPayNativePacket|null;submitMerchantMemberPacket(intentId:string,member:Uint8Array,current:()=>void):Promise<OriginalPayNativePacket>;submitSettlementPacket(merchant:string,invoiceId:string,member:Uint8Array,current:()=>void):Promise<OriginalPayNativePacket>;submitRefundPacket(merchant:string,invoiceId:string,member:Uint8Array,current:()=>void):Promise<OriginalPayNativePacket>;readInvoiceIntentPacket(intentId:string,current:()=>void):Promise<OriginalPayNativePacket>;readInvoicePacket(merchant:string,invoiceId:string,current:()=>void):Promise<OriginalPayNativePacket>;}
/** Synchronous NAPI custody transfer in the original fixed image. Adopt the raw
 * unknown result BEFORE independently calling isOriginalPaySource; acquisition
 * deliberately supplies no Source/admission type predicate.
 * Throws SAME native failure/falsy value/partial; no fallback or JS brand.
 * Missing preload/image/Main bridge/producer remain unqualified failures. */
export function acquireOriginalPaySource(input:OriginalPayNativeInput):unknown;
/** Native identity only, not admission/current; never a WeakSet DTO brand. */
export function isOriginalPaySource(value:unknown):value is OriginalPayNativeSource;

/** Actual consumer metadata; identifiers are DATA, never Root permission. */
export interface OriginalProductSourceReference {readonly productId:string;readonly sourceOrder:string;}
/** Caller cancellation/current fence adds a narrowing check, never authority. */
export type OriginalProductSourceCurrentFence=(()=>void)&Readonly<{signal?:AbortSignal}>;
/** Existing preparation/read/reconciliation only. Bodies and outputs remain
 * unknown until independently frozen by owning producers. No Member sending. */
/** Exact existing P06 archive DTOs. Data/independent proof results are not grants. */
export interface OriginalProductArchiveReconciliationReference {readonly productId:'shop.order'|'cloud.ide-usage';readonly sourceOrder:string;readonly merchant:string;readonly invoiceId:string;readonly nativeHash?:never;}
export interface OriginalProductArchiveReceiptReference extends Omit<OriginalProductArchiveReconciliationReference,'nativeHash'> {readonly nativeHash:string;}
export interface OriginalNativePayArchiveBaseData {readonly productId:'shop.order'|'cloud.ide-usage';readonly storeId?:string;readonly sourceOrder:string;readonly merchant:string;readonly invoiceId:string;readonly genesis:string;readonly nativeChainId:string;readonly principalAtoms:string;readonly paidAtoms:string;readonly refundedAtoms:string;readonly netPaidAtoms:string;readonly proofVerification:'original-independent-core-verifier';readonly dataOnly:true;readonly queryOnly:true;readonly canRetry:false;readonly SourceAdmission:false;readonly nativeGrant:false;}
export interface OriginalNativePayArchiveReceiptData extends OriginalNativePayArchiveBaseData {readonly version:'ynx.pay.native.archive-receipt/v1';readonly sessionId:string;readonly nativeHash:string;readonly abciHash:string;readonly kind:'invoice_settle'|'invoice_refund';readonly status:'confirmed'|'confirmed_failed';readonly archiveDigest:string;readonly termsHash:string;readonly settlementNativeHash?:string;readonly eventClaim?:string;readonly executionHeight:string;}
export interface OriginalNativePayArchiveReconciliationData extends OriginalNativePayArchiveBaseData {readonly version:'ynx.pay.native.archive-reconciliation/v1';readonly receipts:readonly OriginalNativePayArchiveReceiptData[];readonly pendingOriginals:readonly string[];readonly completeKnownOriginals:boolean;}
/** Original Native archive adapters must invoke SAME current outside Store locks
 * before/after copied DATA, propagate thrown originals, accept only undefined
 * on success, honor its SAME signal and retain child-before-parent drain.
 * These declarations do not implement a Native factory/loan or proof verifier. */
export interface OriginalProductSourcePay {
 /** Fixed GET only; optional means this image/old12 loan may not expose the port. Admission is independently checked per call. */
 readOriginalArchiveReceipt?(reference:OriginalProductArchiveReceiptReference,current:OriginalProductSourceCurrentFence):OriginalNativePayArchiveReceiptData|Promise<OriginalNativePayArchiveReceiptData>;
 readOriginalArchiveReconciliation?(reference:OriginalProductArchiveReconciliationReference,current:OriginalProductSourceCurrentFence):OriginalNativePayArchiveReconciliationData|Promise<OriginalNativePayArchiveReconciliationData>;

 createInvoiceIntent(original:unknown,current:OriginalProductSourceCurrentFence):unknown;
 lookupInvoiceIntent(original:unknown,current:OriginalProductSourceCurrentFence):unknown;
 merchantTermsReview(intentId:string,current:OriginalProductSourceCurrentFence):unknown;
 readInvoiceIntent(intentId:string,current:OriginalProductSourceCurrentFence):unknown;
 readInvoice(merchant:string,invoiceId:string,current:OriginalProductSourceCurrentFence):unknown;
 readInvoiceEvents(merchant:string,invoiceId:string,current:OriginalProductSourceCurrentFence):unknown;
 reviewSettlement(merchant:string,invoiceId:string,current:OriginalProductSourceCurrentFence):unknown;
 reviewRefund(merchant:string,invoiceId:string,refundId:string,amountAtoms:string,current:OriginalProductSourceCurrentFence):unknown;
 reconcileInvoiceIntent(intentId:string,current:OriginalProductSourceCurrentFence):unknown;
 reconcileOperation(merchant:string,invoiceId:string,originalNativeHash:string,current:OriginalProductSourceCurrentFence):unknown;
 readInvoiceOriginals?(reference:unknown,current:OriginalProductSourceCurrentFence):unknown;
}
/** Native identity denotes custody, not current/Root/product scope permission.
 * Each actual method independently validates its original ProductSource scope. */
export interface OriginalProductSource {
 current():void;retire():void;join():void|Promise<void>;close():void|Promise<void>;
 readonly pay:OriginalProductSourcePay;
 /** Fixed GET only; optional means this image/old12 loan may not expose the port. Admission is independently checked per call. */
 readOriginalArchiveReceipt?(reference:OriginalProductArchiveReceiptReference,current:OriginalProductSourceCurrentFence):OriginalNativePayArchiveReceiptData|Promise<OriginalNativePayArchiveReceiptData>;
 readOriginalArchiveReconciliation?(reference:OriginalProductArchiveReconciliationReference,current:OriginalProductSourceCurrentFence):OriginalNativePayArchiveReconciliationData|Promise<OriginalNativePayArchiveReconciliationData>;

 readOriginalInvoiceIntent?(reference:OriginalProductSourceReference,current:OriginalProductSourceCurrentFence):unknown;
 readOriginalShopNativeInvoiceRequestDATA?(sourceOrder:string,current:OriginalProductSourceCurrentFence):unknown;
 readOriginalCloudBillLocator?(reference:OriginalProductSourceReference,current:OriginalProductSourceCurrentFence):unknown;
 readInvoiceOriginals?(reference:unknown,current:OriginalProductSourceCurrentFence):unknown;
 readonly cloudClient?:Readonly<{nativeInvoiceIntentOriginal(selection:unknown,utcDay:string,reference:Readonly<OriginalProductSourceReference>&Readonly<{signal?:AbortSignal}>):unknown}>;
}
export interface OriginalProductSourceFactories {
 acquireOriginalProductSource():unknown;
 isOriginalProductSource(value:unknown):value is OriginalProductSource;
}
/** Zero input, fixed Native two-export lane. Adopt unknown out/exception partial
 * first. No Root/purpose/Source factory is created by this SDK forwarding call. */
export function acquireOriginalProductSource():unknown;
/** Cached SAME Native custody predicate; not a readiness/current check. */
export function isOriginalProductSource(value:unknown):value is OriginalProductSource;
