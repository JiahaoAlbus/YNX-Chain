import type {ProductSession} from './index.js';
import type {VerifiedPQProductSessionApproval,VerifiedPQProductSessionCompletion} from './product-session-pq-approval.js';
export interface ProductSessionCompletionRecord {
 readonly request:Readonly<Record<string,unknown>>;
 readonly approval:Readonly<Record<string,unknown>>;
 readonly completion:Readonly<{challenge:Readonly<Record<string,unknown>>;deviceSignature:string}>;
}
/** Protected pending-data inspection, not Source/current account admission. */
export interface ProductSessionReferenceCompletionRecord {
 readonly version:'YNX-PRODUCT-SESSION-RETURN-REFERENCE/v1';
 readonly reference:string;
 readonly request:Readonly<Record<string,unknown>>;
 readonly completion:Readonly<{challenge:Readonly<Record<string,unknown>>;deviceSignature:string|null}>;
 readonly accountVerified:false;
}
export function inspectCompletionRecord(registry:unknown,raw:string):(ProductSessionCompletionRecord&Readonly<{accountVerified:boolean}>)|ProductSessionReferenceCompletionRecord;
/** V2 retains 16KiB. Full V3 needs the fresh original current approval capability
 * or a completion-only verification tied to these exact raw bytes. */
export function parseCompletionRecord(registry:unknown,raw:string,at:Date,verifiedApproval?:VerifiedPQProductSessionApproval|null,verifiedCompletion?:VerifiedPQProductSessionCompletion|null):ProductSessionCompletionRecord;
/** Possible original target only. No Authority issuance, nonce consumption,
 * current grant, commit or permission to retry an UNKNOWN completion. */
export function deriveCompletionTarget(registry:unknown,raw:string,at?:Date,verifiedCompletion?:VerifiedPQProductSessionCompletion|null):ProductSession;
