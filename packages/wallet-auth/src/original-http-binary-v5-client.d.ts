/** Normal fixed-image Native Source acquisition. No caller-supplied endpoint,
 * provider, hashes, credentials, Root, Source, or peer constructor. Missing
 * Native V5 Source fails closed; acquisition failures may own a partial which
 * must be retained and drained. DATA readback never grants authority. */
export interface OriginalHTTPBinaryAbortContextV5 {readonly signal:AbortSignal}
declare const originalHTTPBinaryRequestV5:unique symbol;
export interface OriginalHTTPBinaryRequestV5 {readonly [originalHTTPBinaryRequestV5]:never}
export interface OriginalHTTPBinaryRequestDATAV5 {
 readonly requestId:string;readonly method:'POST';readonly path:'/api/v1/ide/deployments';readonly url:string;
 readonly contentType:string;readonly bodyOriginal:Uint8Array;readonly expectedSlotRevision:string;readonly rollbackTarget:string;
 readonly proofHeaderName:'x-ynx-product-session-proof-v5';readonly proofHeader:string|null;readonly memberOriginal:Uint8Array|null;readonly unsignedOriginal:string|null;
 readonly proofEntered:boolean;readonly httpEntered:boolean;readonly responseOriginal:Readonly<{status:number;headers:readonly(readonly[string,string])[];bodyOriginal:Uint8Array;complete:boolean}>|null;
 readonly unknown:boolean;readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
export interface OriginalHTTPBinaryClientV5 {
 prepareOriginalRequest(input:Readonly<{requestId:string;expectedSlotRevision:string;rollbackTarget:string;bodySnapshot:Readonly<{bodyOriginal:Uint8Array;contentType:string}>;abortContext:Readonly<OriginalHTTPBinaryAbortContextV5>}>):OriginalHTTPBinaryRequestV5;
 readOriginalRequestDATA(original:OriginalHTTPBinaryRequestV5):OriginalHTTPBinaryRequestDATAV5;
 produceOriginalProof(original:OriginalHTTPBinaryRequestV5):Promise<OriginalHTTPBinaryRequestDATAV5>;
 submitPrepared(original:OriginalHTTPBinaryRequestV5,sameContext:Readonly<OriginalHTTPBinaryAbortContextV5>):Promise<OriginalHTTPBinaryRequestDATAV5>;
 status():Readonly<{closed:boolean;physicalSourceClosed:boolean;cleanupDebt:boolean;firstCausePresent:boolean;firstCause:unknown;SourceAdmission:false;NativeAdmission:false}>;
 retire():void;join():Promise<void>;close():Promise<void>;drainOriginal():Promise<void>;
}
export function openOriginalHTTPBinaryClientV5():Promise<OriginalHTTPBinaryClientV5>;
