import {
  canonicalJSON,createSignedPayPaymentResult,parseProductSession,verifyPayPaymentResult,
  type ProductSessionV2,type PayPaymentIntent,type PayPaymentResult,type createPayInvoiceSignerPolicy,
} from "@ynx-chain/wallet-auth";
import type {WalletOperationLease} from "./operationLifecycle";
import {prepareNativeTransferWithBinding,type NativeTransferReview} from "./prepareNativeTransfer";
import type {NativeChainClient} from "../chain/nativeTransfer";
import type {NativeTransferPrepared} from "../chain/nativeTransferOutbox";
import type {WalletRepository} from "../storage/walletRepository";
import {verifyWalletPayQuote} from "../chain/walletPayQuote";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";

/** Supplied ONLY by A's protected, registered canonical authority adapter.
 * refresh must introspect actor/device/origin/revocation against that authority;
 * assertCurrent must invalidate on any actor/session/device/transport change.
 * Parsing a session, a bearer token, QR or identity-only connection is NOT an
 * implementation of this port. There is intentionally no default adapter. */
export type WalletPayAuthorityLease=Readonly<{
  session:ProductSessionV2;
  assertCurrent:()=>void;
  refresh:()=>Promise<ProductSessionV2>;
}>;
export type SignedPayTransferPrepared=Readonly<NativeTransferPrepared&{paymentResult:PayPaymentResult}>;
export class SignedPayAuthorityError extends Error{constructor(readonly code:string){super(code);this.name="SignedPayAuthorityError"}}
const fail=(code:string):never=>{throw new SignedPayAuthorityError(code)};
const approvedScopes=["account:read","pay:case:create","pay:settlement:submit"];

/** Structural narrowing of an ALREADY authority-verified full session. This
 * cannot authenticate a session or grant registration from persisted fields. */
export function assertSignedPaySessionBinding(captured:ProductSessionV2,intent:PayPaymentIntent,account:string){
  if(captured.account!==account||captured.productId!=="pay"||captured.clientId!==intent.productClientId||captured.applicationId!==intent.bundleId||
    captured.origin!=="https://pay.ynxweb4.com"||captured.callback!=="ynxpay://wallet-auth/callback"||captured.serviceConsent||
    canonicalJSON([...captured.scopes].sort())!==canonicalJSON([...approvedScopes].sort())||
    Date.parse(captured.expiresAt)-Date.parse(captured.issuedAt)>180_000||captured.sessionBinding!==intent.sessionBinding)
    return fail("PAY_CURRENT_SESSION_BINDING_MISMATCH");
  if(Date.parse(intent.quoteIssuedAt)<Date.parse(captured.issuedAt)||Date.parse(intent.quoteExpiresAt)>Date.parse(captured.expiresAt))
    return fail("PAY_QUOTE_EXCEEDS_SESSION_LIFETIME");
}

/** Explicit-review preparation only, called within the original outbox prepare
 * callback. Never broadcasts, settles, creates a session or returns a key. */
export async function prepareSignedPayTransfer(input:Readonly<{
  rawInvoice:unknown;rawIntent:unknown;reviewedIntentDigest:string;review:NativeTransferReview;
  policy:ReturnType<typeof createPayInvoiceSignerPolicy>;authority:WalletPayAuthorityLease|null;
  lease:WalletOperationLease;client:Pick<NativeChainClient,"account"|"requireDurabilityCapability">;
  repository:Pick<WalletRepository,"accountSecret">;authorize:()=>Promise<void>;now?:()=>number;
}>):Promise<SignedPayTransferPrepared>{
  const {lease,authority}=input,now=input.now??Date.now;
  lease.assert();if(!authority||typeof authority.refresh!=="function"||typeof authority.assertCurrent!=="function")return fail("PAY_CURRENT_AUTHORITY_REQUIRED");
  const captured=parseProductSession(authority.session),snapshot=canonicalJSON(captured);
  const quote=verifyWalletPayQuote(input.rawInvoice,input.rawIntent,input.policy,()=>{lease.assert();authority.assertCurrent()},now());
  const review=Object.freeze({...input.review});
  if(input.reviewedIntentDigest!==quote.intentDigest||lease.account!==review.account||review.account!==captured.account||review.to!==quote.intent.payoutAddress||review.amount!==quote.intent.amount)
    return fail("PAY_EXPLICIT_REVIEW_MISMATCH");
  // Original Pay53eb service.go:375,910 domain/order. A signed V4/V5 payer
  // restriction is narrower than a matching session, never an authority grant.
  if(quote.invoice.expectedPayerHash&&quote.invoice.expectedPayerHash!==bytesToHex(sha256(new TextEncoder().encode(`YNX_PAY_EXPECTED_PAYER_V1|${review.account}`))))
    return fail("PAY_SIGNED_EXPECTED_PAYER_MISMATCH");
  // Only the CURRENT approved three-scope/180s Pay policy. Never resurrect the
  // legacy five-scope contract, widen scopes, extend time or grant registration.
  assertSignedPaySessionBinding(captured,quote.intent,review.account);
  const guard=()=>{
    lease.assert();authority.assertCurrent();
    if(canonicalJSON(parseProductSession(authority.session))!==snapshot)return fail("PAY_CURRENT_SESSION_CHANGED");
    const at=now();
    if(!Number.isFinite(at)||at<Date.parse(captured.issuedAt)||at>=Date.parse(captured.expiresAt)||at>=Date.parse(quote.intent.quoteExpiresAt))
      return fail("PAY_CURRENT_AUTHORITY_EXPIRED");
  };
  const refresh=async()=>{guard();const fresh=await authority.refresh();guard();if(canonicalJSON(parseProductSession(fresh))!==snapshot)return fail("PAY_CURRENT_SESSION_CHANGED")};
  await refresh();
  const client={
    account:async(account:string)=>{await refresh();const result=await input.client.account(account);guard();await refresh();return result},
    requireDurabilityCapability:async()=>{await refresh();const result=await input.client.requireDurabilityCapability();guard();await refresh();return result},
  };
  return prepareNativeTransferWithBinding(review,lease,client,input.repository,async()=>{await refresh();await input.authorize();guard();await refresh()},guard,
    async(signed,secret,keyGuard)=>{
      // Re-introspect after the protected storage await, before a result is
      // signed. Both signatures use the same existing key read and lease.
      await refresh();keyGuard();
      const result=createSignedPayPaymentResult({accountSecret:secret,intent:quote.intent,transferPayload:signed.payload,issuedAt:new Date(now()).toISOString()},new Date(now()));
      keyGuard();const paymentResult=verifyPayPaymentResult(result,quote.intent,review.account,new Date(now()));keyGuard();
      if(paymentResult.transactionHash!==signed.hash||paymentResult.accountPublicKey!==review.accountPublicKey)return fail("PAY_SIGNED_RESULT_MISMATCH");
      return Object.freeze({...signed,paymentResult});
    });
}
