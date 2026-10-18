import type {FinanceFiniteServiceConsent,ProductSession,RecoverableProductSessionClient} from './index.js';
import type {ProductSessionCompletionRecord} from './product-session-completion-record.js';
import type {ProductSessionAccountPolicyObservation,ProductSessionCommittedPolicyView} from './product-session-account-policy.js';
export type ProductSessionAccountAuthorization=Readonly<NonNullable<ProductSessionCommittedPolicyView['activeRecord']>&{
 policyVersion:'YNX-ACCOUNT-POLICY/v1';algorithmVersion:'YNX-BATCH/v0.1';networkId:string;canonicalOwner:string;
}>;
declare const plan:unique symbol,verified:unique symbol,completion:unique symbol;
/** Main-only review plan; not a permission lease, Source or account grant. */
export interface PQProductSessionSigningPlan {readonly [plan]:never}
/** Actual dual verification bound to the exact request and original policy observation. */
export interface VerifiedPQProductSessionApproval {readonly [verified]:never}
/** Different purpose from live approval: exact historical raw completion,
 * same-current registered pair, fresh original Source. Never issue authority. */
export interface VerifiedPQProductSessionCompletion {readonly [completion]:never}
export interface OriginalProductSessionAccountContextOwner {
 readContext():ProductSessionAccountContext;assertCurrent():undefined;recheck():Promise<void>;
 retire():undefined;join():Promise<void>;close():Promise<void>;
}
export interface OriginalProductSessionAccountContextSource {
 acquire(input:Readonly<{account:string;operation:'approval'|'challenge'|'completion'|'revalidation'|'introspection';request:unknown|null;approval:unknown|null}>):Promise<OriginalProductSessionAccountContextOwner>;
}
export interface PQClientAccountPolicyPorts {
 acquire:OriginalProductSessionAccountContextSource['acquire'];
 verifyCompletion:typeof verifyPQProductSessionCompletionRecord;
}
export type PQProductSessionApproval=Readonly<Record<string,unknown>&{
 version:'3';result:'approved';account:string;accountAuthorization:ProductSessionAccountAuthorization;
 requestDigest:string;scopes:readonly string[];issuedAt:string;expiresAt:string;walletProof:string;
}>;
/** Request-local, borrowed original source. Never serialize or persist this context.
 * Every request/cold recovery reacquires its own normal resource and rechecks it.
 * SDK borrows; original host retains cleanup/UNKNOWN custody. */
export interface ProductSessionAccountContext {
 readonly observation:ProductSessionAccountPolicyObservation|null;
 readonly verifiedApproval:VerifiedPQProductSessionApproval|null;
 readonly required:boolean;
}
export const PQ_PRODUCT_SESSION_PURPOSE:'PRODUCT-SESSION-APPROVAL';
/** Node-only entry. All full request bytes are signed, including purpose and consent.
 * Explicit matching approvedServiceConsent is required for finite service requests. */
export function preparePQProductSessionApproval(registry:unknown,request:unknown,input:{account:string;expiresAt:string;approvedServiceConsent?:FinanceFiniteServiceConsent},observation:ProductSessionAccountPolicyObservation,at?:Date):PQProductSessionSigningPlan;
export function verifyPQProductSessionApproval(registry:unknown,request:unknown,approval:unknown,observation:ProductSessionAccountPolicyObservation,at?:Date):Readonly<{approval:PQProductSessionApproval;verifiedApproval:VerifiedPQProductSessionApproval}>;
/** Node-only: signed time is original, Source time is fresh NOW. R1 supplies
 * current active pair only; a different historical revision is refused. The
 * target is not a session grant; consume verification while the owner is live. */
export function verifyPQProductSessionCompletionRecord(registry:unknown,raw:string,observation:ProductSessionAccountPolicyObservation,at?:Date):Readonly<{record:ProductSessionCompletionRecord;target:ProductSession;verification:VerifiedPQProductSessionCompletion}>;
/** Uses the existing client. Main holds original R15 owner through async work,
 * post-rechecks/cleans it, retains UNKNOWN/debt and never serializes capability. */
export function createPQRecoverableProductSessionClient(config:Readonly<Record<string,unknown>>&{accountPolicySource:OriginalProductSessionAccountContextSource}):RecoverableProductSessionClient;
