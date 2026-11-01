export interface OriginalPayNativeTarget {readonly version:1;readonly service:'pay';readonly kind:'invoice_terms'|'invoice_settle'|'invoice_refund';readonly intentId:string|null;readonly merchant:string|null;readonly invoiceId:string|null;readonly requestPath:string;}
export interface OriginalPayNativeBinding {readonly networkId:string;readonly account:string;readonly hash:string;readonly memberHash:string;readonly operationId:string;readonly target:OriginalPayNativeTarget;}
export interface OriginalPayNativePacket {readonly method:'POST'|'GET';readonly requestPath:string;readonly status:number;readonly contentType:string;readonly cacheControl:string;readonly body:Uint8Array;}
/** Metadata selectors only. Original protected Native/Main must independently
 * recognize the SAME actual request/permission/capsule/borrow/current/Member. */
export interface OriginalPayNativeInput {readonly request:object|null;readonly original:Readonly<Record<string,unknown>>&Readonly<{account:string;hash:string;operationId:string;typed:Readonly<Record<string,unknown>>&Readonly<{networkId:string;memberHash:string}>}>;readonly target:OriginalPayNativeTarget;}
export interface OriginalPayNativeSource {readOriginal():OriginalPayNativeBinding;assertCurrent():void;recheck():Promise<void>;retire():void;join():Promise<void>;close():Promise<void>;drainPartial():Promise<void>;readOriginalPacketOutcome():OriginalPayNativePacket|null;submitMerchantMemberPacket(intentId:string,member:Uint8Array,current:()=>void):Promise<OriginalPayNativePacket>;submitSettlementPacket(merchant:string,invoiceId:string,member:Uint8Array,current:()=>void):Promise<OriginalPayNativePacket>;submitRefundPacket(merchant:string,invoiceId:string,member:Uint8Array,current:()=>void):Promise<OriginalPayNativePacket>;readInvoiceIntentPacket(intentId:string,current:()=>void):Promise<OriginalPayNativePacket>;readInvoicePacket(merchant:string,invoiceId:string,current:()=>void):Promise<OriginalPayNativePacket>;}
/** Synchronous exact registered NAPI acquisition in the original fixed image.
 * Throws SAME native failure/falsy value/partial; no fallback or JS brand.
 * Missing preload/image/Main bridge/producer remain unqualified failures. */
export function acquireOriginalPaySource(input:OriginalPayNativeInput):OriginalPayNativeSource;
/** Native identity only, not admission/current; never a WeakSet DTO brand. */
export function isOriginalPaySource(value:unknown):value is OriginalPayNativeSource;
