import {createHash} from "node:crypto";
import {canonicalJSON,createSignedNativeTransfer,createSignedPayPaymentResult,evmAddressFromYNX,parseProductSession,verifyPayPaymentResult} from "@ynx-chain/wallet-auth";
import {verifyWalletPayQuote} from "./wallet-pay-quote.mjs";
const fail=code=>{throw Object.assign(new Error(code),{code})};
const scopes=["account:read","pay:case:create","pay:settlement:submit"];
export function assertDesktopPaySession(session,intent,account){
  if(session.account!==account||session.productId!=="pay"||session.clientId!=="ynx-pay-v1"||session.applicationId!=="com.ynxweb4.pay"||
    session.origin!=="https://pay.ynxweb4.com"||session.callback!=="ynxpay://wallet-auth/callback"||session.serviceConsent||
    canonicalJSON([...session.scopes].sort())!==canonicalJSON([...scopes].sort())||Date.parse(session.expiresAt)-Date.parse(session.issuedAt)>180_000||
    session.sessionBinding!==intent.sessionBinding||session.clientId!==intent.productClientId||session.applicationId!==intent.bundleId)
    fail("PAY_CURRENT_SESSION_BINDING_MISMATCH");
  if(Date.parse(intent.quoteIssuedAt)<Date.parse(session.issuedAt)||Date.parse(intent.quoteExpiresAt)>Date.parse(session.expiresAt))fail("PAY_QUOTE_EXCEEDS_SESSION_LIFETIME");
}
/** Main-process-only preparation inside the existing DesktopKeyLifecycle.run.
 * No new vault, renderer key, unlock fallback, broadcast or settlement. A's
 * protected current session/business lease and exact native chain client are
 * mandatory; the Ethereum sender is NOT a native Pay result producer.
 * The caller must persist/read back the returned public packet in the original
 * private journal before dispatch and revalidate authority at its POST boundary.
 */
export async function prepareDesktopSignedPayTransfer({rawInvoice,rawIntent,reviewedIntentDigest,review,policy,authority,vault,client,guard,now=Date.now}){
  if(!guard||typeof guard.assert!=="function")fail("PAY_PROTECTED_OPERATION_REQUIRED");guard.assert();
  if(!authority||typeof authority.assertCurrent!=="function"||typeof authority.refresh!=="function"||typeof authority.verifyInvoicePayable!=="function")fail("PAY_CURRENT_AUTHORITY_REQUIRED");
  if(!vault||typeof vault.withSecret!=="function"||typeof client?.account!=="function"||typeof client?.requireDurabilityCapability!=="function")fail("PAY_NATIVE_PROTECTED_ADAPTER_REQUIRED");
  // Copy the visible review before any await. The authority remains a live
  // revocation port, never a parsed-session substitute or caller bearer token.
  const request=Object.freeze({...review}),captured=parseProductSession(authority.session),snapshot=canonicalJSON(captured);
  const quote=verifyWalletPayQuote(rawInvoice,rawIntent,policy,()=>{guard.assert();authority.assertCurrent()},now());
  if(guard.account!==evmAddressFromYNX(request.account)||request.account!==captured.account||request.to!==quote.intent.payoutAddress||request.amount!==quote.intent.amount||reviewedIntentDigest!==quote.intentDigest)
    fail("PAY_EXPLICIT_REVIEW_MISMATCH");
  if(quote.invoice.expectedPayerHash&&quote.invoice.expectedPayerHash!==createHash("sha256").update(`YNX_PAY_EXPECTED_PAYER_V1|${request.account}`).digest("hex"))fail("PAY_SIGNED_EXPECTED_PAYER_MISMATCH");
  assertDesktopPaySession(captured,quote.intent,request.account);
  const current=()=>{guard.assert();authority.assertCurrent();const at=now();
    if(canonicalJSON(parseProductSession(authority.session))!==snapshot)fail("PAY_CURRENT_SESSION_CHANGED");
    if(!Number.isFinite(at)||at<Date.parse(captured.issuedAt)||at>=Math.min(Date.parse(captured.expiresAt),Date.parse(quote.intent.quoteExpiresAt)))fail("PAY_CURRENT_AUTHORITY_EXPIRED")};
  const refresh=async()=>{current();const fresh=await authority.refresh();current();if(canonicalJSON(parseProductSession(fresh))!==snapshot)fail("PAY_CURRENT_SESSION_CHANGED")};
  const payable=async()=>{current();await authority.verifyInvoicePayable(quote.invoice,quote.intent);current()};
  await refresh();await payable();
  const remote=await client.account(request.account);current();await refresh();
  if(!remote||remote.address!==evmAddressFromYNX(request.account)||!Number.isSafeInteger(remote.balance)||remote.balance<request.amount+1||!Number.isSafeInteger(remote.nonce)||remote.nonce<0||!Number.isSafeInteger(remote.nonce+1))fail("PAY_NATIVE_ACCOUNT_OR_BALANCE_INVALID");
  await client.requireDurabilityCapability();current();await refresh();
  const prepared=await vault.withSecret(async(secret,identity,keyGuard)=>{
    const keyCurrent=()=>{current();keyGuard.assert()};keyCurrent();
    if(identity.account!==guard.account||identity.ynxAccount!==request.account||identity.publicKey!==request.accountPublicKey)fail("PAY_PROTECTED_IDENTITY_MISMATCH");
    // The real vault has already re-read/decrypted/validated its stored identity
    // and does not expose the key outside this callback. No second key access.
    await refresh();await payable();keyCurrent();
    const signed=createSignedNativeTransfer({accountSecret:secret,to:request.to,amount:request.amount,nonce:remote.nonce+1});keyCurrent();
    const at=now(),result=createSignedPayPaymentResult({accountSecret:secret,intent:quote.intent,transferPayload:signed.payload,issuedAt:new Date(at).toISOString()},new Date(at));keyCurrent();
    const paymentResult=verifyPayPaymentResult(result,quote.intent,request.account,new Date(now()));keyCurrent();
    if(paymentResult.transactionHash!==signed.hash||paymentResult.accountPublicKey!==request.accountPublicKey)fail("PAY_SIGNED_RESULT_MISMATCH");
    return Object.freeze({...signed,paymentResult,invoice:quote.invoice,intent:quote.intent,session:captured});
  });
  current();return prepared;
}
