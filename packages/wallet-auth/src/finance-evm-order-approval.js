import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJSON, exactFields } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { parseFinanceOrder, financeOrderHash } from "./finance-order-approval.js";
import { FINANCE_EVM_ORIGIN, FINANCE_EVM_CALLBACK, FINANCE_EVM_CHAIN_ID, FINANCE_EVM_MAX_LIFETIME_MS, fail, literal, pattern, evmAccount, evmAccountType, token, digest, subjectId, time, authorityTime, activeWindow, deviceKey, deviceSignature, normalizeDeviceSignature, signDevice, verifyDevice, walletSignature, verifyWalletSignature } from "./finance-evm-common.js";

const CHALLENGE=["version","productId","subjectNamespace","origin","chainId","subjectId","account","accountType","brokerAccountId","provider","tradingEnvironment","chainEnvironment","sessionBinding","requestId","challengeId","nonce","callbackStateHash","order","orderHash","issuedAt","expiresAt"];
const LOGIN=["challenge","message","walletSignature","deviceSignature"];
const REJECT=["version","challengeId","requestId","subjectId","account","decision","nonce","issuedAt","expiresAt"];
const REVOKE=["version","approvalId","challengeId","requestId","subjectId","account","orderHash","nonce","issuedAt","expiresAt"];
const hash = value=>bytesToHex(sha256(utf8ToBytes(value)));
const same=(a,b)=>{if(canonicalJSON(a)!==canonicalJSON(b)) fail("CHALLENGE_MISMATCH","Order challenge differs from server record");};
const id=(value,label)=>pattern(value,label,/^[A-Za-z0-9._:-]{16,128}$/);

export function parseFinanceEvmOrderChallenge(input) {
  exactFields(input,CHALLENGE,"Finance EVM order challenge");
  const order=parseFinanceOrder(input.order);
  const v=Object.freeze({version:literal(input.version,"1"),productId:literal(input.productId,"finance"),subjectNamespace:literal(input.subjectNamespace,"evm"),
    origin:literal(input.origin,FINANCE_EVM_ORIGIN),chainId:literal(input.chainId,FINANCE_EVM_CHAIN_ID),subjectId:subjectId(input.subjectId),
    account:evmAccount(input.account),accountType:evmAccountType(input.accountType),brokerAccountId:id(input.brokerAccountId,"brokerAccountId"),
    provider:literal(input.provider,"alpaca_broker"),tradingEnvironment:literal(input.tradingEnvironment,"sandbox"),chainEnvironment:literal(input.chainEnvironment,"testnet"),
    sessionBinding:token(input.sessionBinding,"sessionBinding"),requestId:id(input.requestId,"requestId"),challengeId:id(input.challengeId,"challengeId"),
    nonce:token(input.nonce,"nonce"),callbackStateHash:digest(input.callbackStateHash),order,orderHash:digest(input.orderHash),
    issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")});
  if(v.orderHash!==financeOrderHash(order)) fail("ORDER_HASH_MISMATCH","Reviewed order hash changed");
  if(Date.parse(v.expiresAt)<=Date.parse(v.issuedAt)||Date.parse(v.expiresAt)-Date.parse(v.issuedAt)>FINANCE_EVM_MAX_LIFETIME_MS) fail("INVALID_EXPIRY","Order challenge lifetime invalid");
  return v;
}
export function financeEvmOrderMessage(input) { return "YNX_FINANCE_EVM_ORDER_APPROVAL_V1\n"+canonicalJSON(parseFinanceEvmOrderChallenge(input)); }
export function financeEvmOrderSigningRequest(input) {
  const challenge=parseFinanceEvmOrderChallenge(input),message=financeEvmOrderMessage(challenge);
  return Object.freeze({method:"personal_sign",params:Object.freeze(["0x"+bytesToHex(utf8ToBytes(message)),challenge.account]),message});
}
// The full signed order is stored server-side under code. Only opaque correlation leaves in the URL.
export function createFinanceEvmOrderCallbackURL(challengeInput,code,state) {
  const challenge=parseFinanceEvmOrderChallenge(challengeInput);
  const ref=token(code,"code"),callbackState=token(state,"state");
  if(hash(callbackState)!==challenge.callbackStateHash) fail("STATE_MISMATCH","Callback state is not bound to challenge");
  return FINANCE_EVM_CALLBACK+"?code="+encodeURIComponent(ref)+"&state="+encodeURIComponent(callbackState);
}
export function parseFinanceEvmOrderCallbackURL(value,expectedChallenge) {
  if(typeof value!=="string") fail("INVALID_CALLBACK","Callback URL required");
  let parsed;try{parsed=new URL(value);}catch{fail("INVALID_CALLBACK","Callback URL invalid");}
  if(parsed.origin!==FINANCE_EVM_ORIGIN||parsed.pathname!=="/wallet-auth/callback"||parsed.hash||
    [...parsed.searchParams.keys()].join(",")!=="code,state") fail("INVALID_CALLBACK","Callback route or fields changed");
  const code=token(parsed.searchParams.get("code"),"code"),state=token(parsed.searchParams.get("state"),"state");
  if(value!==createFinanceEvmOrderCallbackURL(expectedChallenge,code,state)) fail("INVALID_CALLBACK","Callback is not canonical");
  return Object.freeze({code,state,requestId:parseFinanceEvmOrderChallenge(expectedChallenge).requestId});
}
export function financeEvmOrderDeviceMessage(input) { return "YNX_FINANCE_EVM_ORDER_DEVICE_V1\n"+canonicalJSON(parseFinanceEvmOrderChallenge(input)); }
export function parseFinanceEvmOrderApproval(input) {
  exactFields(input,LOGIN,"Finance EVM order approval");
  const challenge=parseFinanceEvmOrderChallenge(input.challenge),message=financeEvmOrderMessage(challenge);
  if(input.message!==message) fail("MESSAGE_MISMATCH","Order wallet message changed");
  return Object.freeze({challenge,message,walletSignature:walletSignature(input.walletSignature,challenge.accountType),deviceSignature:deviceSignature(input.deviceSignature)});
}
export function createFinanceEvmOrderApproval(challengeInput,signature,deviceSecret,deviceKeyInput) {
  const challenge=parseFinanceEvmOrderChallenge(challengeInput);
  return parseFinanceEvmOrderApproval({challenge,message:financeEvmOrderMessage(challenge),walletSignature:signature,
    deviceSignature:signDevice(financeEvmOrderDeviceMessage(challenge),deviceSecret,deviceKeyInput)});
}
export async function createFinanceEvmOrderApprovalWith(challengeInput,signature,deviceKeyInput,signer) {
  const challenge=parseFinanceEvmOrderChallenge(challengeInput), key=deviceKey(deviceKeyInput);
  if(typeof signer!=="function") fail("INVALID_DEVICE","Device signer required");
  const message=financeEvmOrderDeviceMessage(challenge);
  const signed=normalizeDeviceSignature(await signer(Object.freeze({purpose:"finance-evm-order-approval",algorithm:"p256-sha256",deviceKey:key,payload:encodeBase64url(utf8ToBytes(message))})));
  verifyDevice(signed,message,key);
  return parseFinanceEvmOrderApproval({challenge,message:financeEvmOrderMessage(challenge),walletSignature:signature,deviceSignature:signed});
}
export async function verifyFinanceEvmOrderApproval(input,serverChallenge,authority,at,verifyContractSignature) {
  const proof=parseFinanceEvmOrderApproval(input),challenge=parseFinanceEvmOrderChallenge(serverChallenge);
  same(proof.challenge,challenge);
  exactFields(authority,["subjectId","account","accountType","brokerAccountId","sessionBinding","deviceKey","revoked"],"Finance order server authority");
  if(authority.revoked!==false||authority.subjectId!==challenge.subjectId||authority.account!==challenge.account||
    authority.accountType!==challenge.accountType||authority.brokerAccountId!==challenge.brokerAccountId||
    authority.sessionBinding!==challenge.sessionBinding) fail("AUTHORITY_MISMATCH","Subject or broker ownership changed");
  activeWindow(challenge.issuedAt,challenge.expiresAt,FINANCE_EVM_MAX_LIFETIME_MS,at);
  await verifyWalletSignature(proof.message,proof.walletSignature,challenge.account,challenge.accountType,verifyContractSignature);
  verifyDevice(proof.deviceSignature,financeEvmOrderDeviceMessage(challenge),deviceKey(authority.deviceKey));
  return Object.freeze({verified:true,challengeId:challenge.challengeId,requestId:challenge.requestId,subjectId:challenge.subjectId,
    account:challenge.account,brokerAccountId:challenge.brokerAccountId,sessionBinding:challenge.sessionBinding,orderHash:challenge.orderHash,
    order:challenge.order,approvalId:hash(proof.message+"\n"+proof.walletSignature)});
}
// commit MUST atomically recheck active subject/session, broker ownership, unused challenge, and provider idempotency.
// For EIP-1271 it MUST also recheck contract validity on chain 6423 immediately before order submission.
export async function verifyAndConsumeFinanceEvmOrderApproval(input,serverChallenge,authority,commit,at,verifyContractSignature) {
  if(typeof commit!=="function") fail("AUTHORITY_STORE_REQUIRED","Atomic order transaction required");
  const verified=await verifyFinanceEvmOrderApproval(input,serverChallenge,authority,at,verifyContractSignature);
  if(await commit(Object.freeze({...verified,asOf:new Date(authorityTime(at)).toISOString(),contractSignatureRecheckRequired:parseFinanceEvmOrderChallenge(serverChallenge).accountType==="contract"}))!==true)
    fail("REPLAY_OR_REVOKED","Order challenge consumed, revoked or subject inactive");
  return verified;
}
function parseDecision(input,fields,decision) {
  exactFields(input,fields,decision+" decision");
  const base={version:literal(input.version,"1"),challengeId:id(input.challengeId,"challengeId"),requestId:id(input.requestId,"requestId"),
    subjectId:subjectId(input.subjectId),account:evmAccount(input.account),nonce:token(input.nonce,"nonce"),issuedAt:time(input.issuedAt,"issuedAt"),
    expiresAt:time(input.expiresAt,"expiresAt")};
  if(decision==="reject") base.decision=literal(input.decision,"reject");
  else {base.approvalId=digest(input.approvalId);base.orderHash=digest(input.orderHash);}
  if(Date.parse(base.expiresAt)<=Date.parse(base.issuedAt)||Date.parse(base.expiresAt)-Date.parse(base.issuedAt)>FINANCE_EVM_MAX_LIFETIME_MS) fail("INVALID_EXPIRY","Decision lifetime invalid");
  return Object.freeze(base);
}
export function financeEvmOrderRejectMessage(input) { return "YNX_FINANCE_EVM_ORDER_REJECT_V1\n"+canonicalJSON(parseDecision(input,REJECT,"reject")); }
export function financeEvmOrderRevokeMessage(input) { return "YNX_FINANCE_EVM_ORDER_REVOKE_UNUSED_V1\n"+canonicalJSON(parseDecision(input,REVOKE,"revoke")); }
export function createFinanceEvmOrderReject(challengeInput,nonce,at,expiresAt,deviceSecret,deviceKeyInput) {
  const c=parseFinanceEvmOrderChallenge(challengeInput);
  const decision=parseDecision({version:"1",challengeId:c.challengeId,requestId:c.requestId,subjectId:c.subjectId,account:c.account,decision:"reject",nonce,issuedAt:time(at,"issuedAt"),expiresAt},REJECT,"reject");
  return Object.freeze({...decision,deviceSignature:signDevice(financeEvmOrderRejectMessage(decision),deviceSecret,deviceKeyInput)});
}
export async function createFinanceEvmOrderRejectWith(challengeInput,nonce,at,expiresAt,deviceKeyInput,signer) {
  const c=parseFinanceEvmOrderChallenge(challengeInput),key=deviceKey(deviceKeyInput);
  if(typeof signer!=="function") fail("INVALID_DEVICE","Device signer required");
  const decision=parseDecision({version:"1",challengeId:c.challengeId,requestId:c.requestId,subjectId:c.subjectId,account:c.account,
    decision:"reject",nonce,issuedAt:time(at,"issuedAt"),expiresAt},REJECT,"reject");
  const message=financeEvmOrderRejectMessage(decision);
  const signed=normalizeDeviceSignature(await signer(Object.freeze({purpose:"finance-evm-order-reject",algorithm:"p256-sha256",deviceKey:key,payload:encodeBase64url(utf8ToBytes(message))})));
  verifyDevice(signed,message,key);
  return Object.freeze({...decision,deviceSignature:signed});
}
// consume MUST atomically race reject against approval; a rejected challenge cannot submit any order.
export async function verifyAndConsumeFinanceEvmOrderReject(input,serverChallenge,authority,consume,at) {
  if(typeof consume!=="function") fail("AUTHORITY_STORE_REQUIRED","Atomic rejection transaction required");
  const c=parseFinanceEvmOrderChallenge(serverChallenge);
  exactFields(input,[...REJECT,"deviceSignature"],"Signed Finance order rejection");
  const {deviceSignature:signed,...unsigned}=input,decision=parseDecision(unsigned,REJECT,"reject");
  exactFields(authority,["subjectId","account","sessionBinding","deviceKey","revoked"],"Finance order rejection authority");
  if(authority.revoked!==false||authority.subjectId!==c.subjectId||authority.account!==c.account||authority.sessionBinding!==c.sessionBinding||
    decision.challengeId!==c.challengeId||decision.requestId!==c.requestId||decision.subjectId!==c.subjectId||decision.account!==c.account) fail("AUTHORITY_MISMATCH","Rejection subject or challenge changed");
  activeWindow(c.issuedAt,c.expiresAt,FINANCE_EVM_MAX_LIFETIME_MS,at);
  activeWindow(decision.issuedAt,decision.expiresAt,FINANCE_EVM_MAX_LIFETIME_MS,at);
  verifyDevice(deviceSignature(signed),financeEvmOrderRejectMessage(decision),deviceKey(authority.deviceKey));
  if(await consume(Object.freeze({challengeId:c.challengeId,requestId:c.requestId,subjectId:c.subjectId,sessionBinding:c.sessionBinding,nonce:decision.nonce,asOf:new Date(authorityTime(at)).toISOString()}))!==true) fail("REPLAY_OR_REVOKED","Challenge already used or revoked");
  return Object.freeze({rejected:true,challengeId:c.challengeId,requestId:c.requestId});
}
export function createFinanceEvmOrderUnusedRevocation(challengeInput,approvalId,nonce,at,expiresAt,walletSig) {
  const c=parseFinanceEvmOrderChallenge(challengeInput);
  const revocation=parseDecision({version:"1",approvalId,challengeId:c.challengeId,requestId:c.requestId,subjectId:c.subjectId,
    account:c.account,orderHash:c.orderHash,nonce,issuedAt:time(at,"issuedAt"),expiresAt},REVOKE,"revoke");
  return Object.freeze({...revocation,walletSignature:walletSignature(walletSig,c.accountType)});
}
// revoke MUST atomically race order consumption; submitted orders require a separate broker cancellation flow.
export async function verifyAndConsumeFinanceEvmOrderUnusedRevocation(input,serverChallenge,authority,revoke,at,verifyContractSignature) {
  if(typeof revoke!=="function") fail("AUTHORITY_STORE_REQUIRED","Atomic unused approval revocation required");
  exactFields(input,[...REVOKE,"walletSignature"],"Signed unused approval revocation");
  const {walletSignature:signed,...unsigned}=input,r=parseDecision(unsigned,REVOKE,"revoke"),c=parseFinanceEvmOrderChallenge(serverChallenge);
  exactFields(authority,["subjectId","account","brokerAccountId","sessionBinding","revoked"],"Unused approval server authority");
  if(authority.revoked!==false||authority.subjectId!==c.subjectId||authority.account!==c.account||authority.brokerAccountId!==c.brokerAccountId||
    authority.sessionBinding!==c.sessionBinding||r.challengeId!==c.challengeId||r.requestId!==c.requestId||
    r.subjectId!==c.subjectId||r.account!==c.account||r.orderHash!==c.orderHash) fail("AUTHORITY_MISMATCH","Revocation subject or order changed");
  activeWindow(c.issuedAt,c.expiresAt,FINANCE_EVM_MAX_LIFETIME_MS,at);
  activeWindow(r.issuedAt,r.expiresAt,FINANCE_EVM_MAX_LIFETIME_MS,at);
  await verifyWalletSignature(financeEvmOrderRevokeMessage(r),walletSignature(signed,c.accountType),c.account,c.accountType,verifyContractSignature);
  if(await revoke(Object.freeze({approvalId:r.approvalId,challengeId:c.challengeId,requestId:c.requestId,subjectId:c.subjectId,
    orderHash:c.orderHash,nonce:r.nonce,asOf:new Date(authorityTime(at)).toISOString()}))!==true) fail("REPLAY_OR_SUBMITTED","Approval used, revoked or submitted");
  return Object.freeze({revoked:true,approvalId:r.approvalId,challengeId:c.challengeId});
}
