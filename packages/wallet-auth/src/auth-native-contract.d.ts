/** Type-only description of the original fixed Native module's two-phase ABI.
 * Native exports are still being implemented. This SDK module exports no
 * JavaScript constructor, loader, provider, owner or successful wrapper.
 * Types/brands alone never prove Native identity, admission or availability. */
export type OriginalAuthNativePhase='partial'|'ready'|'proof-selected'|'verified'|'completed'|'rejected'|'unknown'|'retired'|'closed'|'disposed-error';
export interface OriginalAuthNativeStatus {
 readonly phase:OriginalAuthNativePhase;readonly ready:boolean;readonly unknown:boolean;
 readonly retired:boolean;readonly cleanupComplete:boolean;readonly disposed:boolean;
 /** Normalized code only; null before any failure. No credential or raw cause. */
 readonly firstCauseCode:string|null;
}
declare const originalNativeOwner:unique symbol;
/** Native's hidden same-env/thread owning instance performs the real checks.
 * A partial must be retained before assertReady or any later status operation.
 * Every method is synchronous; lifecycle/proof methods return undefined or
 * throw the original failure. Unknown/rejected selections are never replayed. */
export interface OriginalAuthNativeOwner<Kind extends 'receive'|'recover'|'protected-key-call'> {
 readonly [originalNativeOwner]:Kind;
 assertReady():undefined;
 /** Canonical R82 JSON from Native's held Source/expected request/nonce/window.
 * The permitted signer uses encodeOriginalAuthIdentityRequest(parsedOriginal)
 * to form the exact E message, not naked UTF-8 JSON. No caller expected/time. */
 copyRequestOriginal():string;
 /** Select once before verification/effect; ordinary owned bounded bytes only.
 * Native checks N1, exact held request/purpose, permissions and current state. */
 completeProof(memberWire:Uint8Array):undefined;
 /** Does not renew the original wall/monotonic challenge window. */
 current():undefined;
 /** Public immutable result only after actual completed/current validation.
 * Shape is deliberately unknown until the actual operation defines a receipt;
 * a verified phase alone does not mean an effect completed. */
 result():unknown;
 retire():undefined;
 /** Throws pending until actual child work has joined; never starts work. */
 join():undefined;
 /** Preserves the first cleanup failure, including disposed-with-error.
 * Retain a live partial. No repeated close or effect retry is authorized. */
 close():undefined;
 status():Readonly<OriginalAuthNativeStatus>;
}
export type OriginalIDEIdentityReceiveOwner=OriginalAuthNativeOwner<'receive'>;
export type OriginalIDEIdentityRecoveryOwner=OriginalAuthNativeOwner<'recover'>;
export interface OriginalIDEProtectedKeyCallOwner extends OriginalAuthNativeOwner<'protected-key-call'> {
 /** Invoke the SAME captured operation once. No selector, key, path, callback
 * or raw private material. Exact public result shape remains unknown. */
 invoke():unknown;
}
/** Describe only the genuine, fixed, original Native binding. Acquiring and
 * validating that binding belongs to original Auth, not to a caller adapter.
 * Constructors return the SAME owning/partial object before late checks; they
 * do not auto-assert, discard it, retry or manufacture a successful receipt.
 * Invalid arguments before resource capture may throw without an owner. */
export interface OriginalAuthIDENativeBinding {
 readonly receiveOriginalIDEIdentity:(actualEntryURL:string)=>OriginalIDEIdentityReceiveOwner;
 readonly recoverOriginalIDEIdentity:(actualEntryURL:string)=>OriginalIDEIdentityRecoveryOwner;
 readonly acquireOriginalIDEProtectedKeyCall:(actualEntryURL:string,invocationOriginal:string)=>OriginalIDEProtectedKeyCallOwner;
}

/** Original R102 NAPI peer: only Native validates the SAME R91 request owner,
 * process/kernel/Source and fixed inherited endpoint. No descriptor or PID API. */
declare const originalIdentityPeerOwner:unique symbol;
export interface OriginalIDEIdentityPeerStatus {
 readonly ready:boolean;readonly retired:boolean;readonly busy:number;
 readonly closed:boolean;readonly selectedReturnBytes:number;
 readonly firstCause:string|null;readonly dataOnly:true;readonly nativeAdmission:false;
}
export type OriginalIDEIdentityPeerReturn=Readonly<
 {decision:'approve';requestId:string;purpose:string;proof:Uint8Array}|
 {decision:'reject';requestId:string;purpose:string;proof:null}>;
export interface OriginalIDEIdentityPeerOwner {
 readonly [originalIdentityPeerOwner]:true;
 current():undefined;
 /** Always exactly three arguments, even when invocation is absent. */
 sendRequest(kind:'receive'|'recover'|'keyCall',requestOriginal:string,invocationOriginal:string|undefined):Promise<undefined>;
 receiveReturn():Promise<OriginalIDEIdentityPeerReturn>;
 retire():undefined;join():undefined;close():undefined;
 status():Readonly<OriginalIDEIdentityPeerStatus>;
}
export interface OriginalAuthIDEIdentityPeerBinding {
 readonly acquireOriginalIDEIdentityPeerChannel:(actualEntryURL:string,sameRequestOwner:OriginalIDEIdentityReceiveOwner|OriginalIDEIdentityRecoveryOwner|OriginalIDEProtectedKeyCallOwner)=>OriginalIDEIdentityPeerOwner;
}

/** Original R114 Wallet identity Source and dedicated transport owner. Its hidden Native tag/env/thread
 * prove identity, never UI approval. This is not the old four-operation parent. */
declare const originalWalletIdentitySource:unique symbol;
export interface OriginalIDEWalletIdentitySourceOwner {
 readonly [originalWalletIdentitySource]:true;
 assertReady():undefined;
 /** Exactly two arguments; use undefined invocation for receive/recover. */
 bindRequest(originalRequest:string,originalInvocation:string|undefined):undefined;
 /** Requires a bound retained original request and fresh Source/current. */
 current():undefined;
 copyRequestOriginal():string;
 /** Immutable signed selection DATA; never an account approval or trust root. */
 copyRegistration():Readonly<Record<string,unknown>>;
 retire():undefined;join():undefined;close():undefined;
 /** Once-only fixed registered App launch; no caller FD/PID/path/provider. */
 launch():undefined;
 /** Native captures and binds the original request. Never call bindRequest again. */
 receiveRequest():Promise<Readonly<{requestRaw:string;invocationRaw:null|string}>>;
 /** Send/current completion only, not Node effect acceptance or user approval. */
 sendDecision(kind:'approve',proof:Uint8Array):Promise<void>;
 sendDecision(kind:'reject'|'cancel',proof:undefined):Promise<void>;
 status():Readonly<{bound:boolean;retired:boolean;closed:boolean;busy:number;firstCause:string|null;dataOnly:true;userApproved:false;transport:Readonly<{launched:boolean;requestCaptured:boolean;decisionSelected:boolean;capturedProofBytes:number;childReaped:boolean;childExitStatus:number|null;retired:boolean;closed:boolean;shutdownSelected:boolean;firstCause:string|null;closeCause:string|null;dataOnly:true;userApproved:false}>|null}>;
}
