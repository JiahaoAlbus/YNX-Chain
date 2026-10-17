export interface ProductSessionCommittedPolicyView {
  readonly version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1'; readonly networkId:string; readonly canonicalOwner:string;
  readonly checkpoint:Readonly<{kind:'trusted-node-committed/v1';height:string;blockHash:string}>;
  readonly policyVersion:'YNX-ACCOUNT-POLICY/v1'|null; readonly algorithmVersion:'legacy'|'YNX-BATCH/v0.1';
  readonly activeRecord:Readonly<{revision:string;registeredAt:string;activeFrom:string;pkA:string;pkB:string}>|null;
  readonly observedAt:string;readonly expiresAt:string;
}
/** Normal server-only ORIGINAL producer. readOriginal is one immutable committed view;
 * recheck verifies the same owner/policy/checkpoint lineage without extending expiry.
 * assertCurrent is synchronous local retirement/expiry/generation fencing. No JSON
 * field or self-reported pubkey establishes trusted origin, commitment or finality. */
export interface OriginalProductSessionAccountPolicyResource {
  readOriginal():ProductSessionCommittedPolicyView; assertCurrent():undefined; recheck():Promise<undefined>;
  retire():undefined;join():Promise<undefined>;close():Promise<undefined>;
}
declare const observation:unique symbol;
export interface ProductSessionAccountPolicyObservation {readonly [observation]:never}
/** Borrows resource: original owner separately rechecks, retires, joins/closes and retains UNKNOWN. */
export function captureProductSessionAccountPolicy(resource:OriginalProductSessionAccountPolicyResource,expected:{networkId:string;account:string},at?:Date):ProductSessionAccountPolicyObservation;
export function readProductSessionAccountPolicy(ref:ProductSessionAccountPolicyObservation,account:string,at?:Date):ProductSessionCommittedPolicyView;
