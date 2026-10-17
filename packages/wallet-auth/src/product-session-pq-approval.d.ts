import type {FinanceFiniteServiceConsent} from './index.js';
import type {ProductSessionAccountPolicyObservation,ProductSessionCommittedPolicyView} from './product-session-account-policy.js';
export type ProductSessionAccountAuthorization=Readonly<NonNullable<ProductSessionCommittedPolicyView['activeRecord']>&{
 policyVersion:'YNX-ACCOUNT-POLICY/v1';algorithmVersion:'YNX-BATCH/v0.1';networkId:string;canonicalOwner:string;
}>;
declare const plan:unique symbol,verified:unique symbol;
/** Main-only review plan; not a permission lease, Source or account grant. */
export interface PQProductSessionSigningPlan {readonly [plan]:never}
/** Actual dual verification bound to the exact request and original policy observation. */
export interface VerifiedPQProductSessionApproval {readonly [verified]:never}
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
