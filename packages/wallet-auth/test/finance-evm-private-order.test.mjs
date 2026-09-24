import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON } from "../src/canonical.js";
import { encodeBase64url } from "../src/base64url.js";
import {
  createFinanceEvmSubjectLoginProof, financeEvmSubjectMessage, financeEvmSubjectSigningRequest, issueFinanceEvmSubjectSession,
  createFinanceEvmSubjectHttpProof, createFinanceEvmSubjectRevokeProof, verifyAndConsumeFinanceEvmSubjectRead, verifyAndConsumeFinanceEvmSubjectRevoke,
  parseFinanceEvmSubjectChallenge, parseFinanceEvmOrderChallenge, financeEvmOrderMessage, financeEvmOrderSigningRequest,
  createFinanceEvmOrderApproval, verifyAndConsumeFinanceEvmOrderApproval, createFinanceEvmOrderReject,
  createFinanceEvmOrderCallbackURL, parseFinanceEvmOrderCallbackURL,
  verifyAndConsumeFinanceEvmOrderReject, financeEvmOrderRevokeMessage, createFinanceEvmOrderUnusedRevocation,
  verifyAndConsumeFinanceEvmOrderUnusedRevocation, financeOrderHash, ethereumPersonalMessageDigest,
} from "../src/index.js";

const fixture=JSON.parse(readFileSync(new URL("../testdata/finance-order-approval-v1.vectors.json",import.meta.url))).positive;
const vectors=JSON.parse(readFileSync(new URL("../testdata/finance-evm-private-order-v1.vectors.json",import.meta.url)));
const walletSecret=new Uint8Array(32).fill(7), deviceSecret=new Uint8Array(32).fill(9);
const account="0x"+bytesToHex(keccak_256(secp256k1.getPublicKey(walletSecret,false).slice(1)).slice(-20));
const key=encodeBase64url(p256.getPublicKey(deviceSecret,true)), secret=encodeBase64url(deviceSecret);
const now=new Date("2026-09-25T00:01:00.000Z"), t="2026-09-25T00:00:00.000Z", end="2026-09-25T00:05:00.000Z";
const subjectId="evm_subject_"+"a".repeat(64);
const sign=message=>{const s=secp256k1.sign(ethereumPersonalMessageDigest(message),walletSecret,{prehash:false,format:"recovered"});return "0x"+bytesToHex(concatBytes(s.slice(1),Uint8Array.of(s[0]+27)));};
const c=parseFinanceEvmSubjectChallenge({version:"1",productId:"finance",subjectNamespace:"evm",origin:"https://finance.ynxweb4.com",
  callback:"https://finance.ynxweb4.com/wallet-auth/callback",chainId:6423,account,accountType:"eoa",scope:"finance.evm.private.read",
  deviceId:"test_device_01234567",deviceAlgorithm:"p256-sha256",deviceKey:key,nonce:"login_nonce_0123456789abcdefghijkl",
  state:"callback_state_0123456789abcdefghijkl",requestId:"request_0123456789abcdefghijkl",issuedAt:t,expiresAt:end});
const login=createFinanceEvmSubjectLoginProof(c,sign(financeEvmSubjectMessage(c)),secret);
const issue={sessionId:"session_0123456789abcdefghijklmnop",subjectId,expiresAt:end};
const request={method:"GET",target:"/api/private/account?view=balances",bodyDigest:"0".repeat(64),nonce:"read_nonce_0123456789abcdefghijklmnop",
  issuedAt:"2026-09-25T00:01:00.000Z",expiresAt:"2026-09-25T00:02:00.000Z"};
const context={origin:c.origin,method:"GET",target:request.target,bodyDigest:request.bodyDigest,requiredScope:"finance.evm.private.read",allowedTargets:["/api/private/account"]};
const orderChallenge=parseFinanceEvmOrderChallenge({version:"1",productId:"finance",subjectNamespace:"evm",origin:c.origin,chainId:6423,subjectId,
  account,accountType:"eoa",brokerAccountId:fixture.unsigned.brokerAccountId,provider:"alpaca_broker",tradingEnvironment:"sandbox",
  chainEnvironment:"testnet",sessionBinding:"session_binding_0123456789abcdef",requestId:"request_1234567890abcdefghijk",
  challengeId:"challenge_1234567890abcdefghijk",nonce:"order_nonce_0123456789abcdefghijkl",callbackStateHash:"b".repeat(64),
  order:fixture.order,orderHash:financeOrderHash(fixture.order),issuedAt:t,expiresAt:end});
const orderAuthority={subjectId,account,accountType:"eoa",brokerAccountId:orderChallenge.brokerAccountId,
  sessionBinding:orderChallenge.sessionBinding,deviceKey:key,revoked:false};

test("published EVM-only vectors freeze canonical bytes and order fields",()=>{
  const hash=value=>bytesToHex(sha256(utf8ToBytes(value)));
  assert.equal(canonicalJSON(c),vectors.login.canonical);
  assert.equal(hash(financeEvmSubjectMessage(c)),vectors.login.messageSha256);
  assert.equal(canonicalJSON(orderChallenge),vectors.order.canonical);
  assert.equal(hash(financeEvmOrderMessage(orderChallenge)),vectors.order.messageSha256);
  assert.equal(vectors.order.challenge.orderHash,fixture.orderHash);
});

test("order callback URL exposes only opaque code and bound state",()=>{
  const state="callback_state_0123456789abcdefghijklmnop",code="one_time_code_0123456789abcdefghijklmnop";
  const challenge=parseFinanceEvmOrderChallenge({...orderChallenge,callbackStateHash:bytesToHex(sha256(utf8ToBytes(state)))});
  const url=createFinanceEvmOrderCallbackURL(challenge,code,state);
  assert.deepEqual(parseFinanceEvmOrderCallbackURL(url,challenge),{code,state,requestId:challenge.requestId});
  assert.equal(url.includes(challenge.brokerAccountId),false);
  assert.equal(url.includes(challenge.orderHash),false);
  assert.throws(()=>parseFinanceEvmOrderCallbackURL(url+"&order="+encodeURIComponent(JSON.stringify(challenge.order)),challenge),{code:"INVALID_CALLBACK"});
  assert.throws(()=>createFinanceEvmOrderCallbackURL(challenge,code,"wrong_state_0123456789abcdefghijklmnop"),{code:"STATE_MISMATCH"});
});

test("EVM-only private Finance subject has an independent exact login and atomic read/revoke boundary",async()=>{
  assert.equal(Buffer.from(financeEvmSubjectSigningRequest(c).params[0].slice(2),"hex").toString(),financeEvmSubjectMessage(c));
  let issued=false,revoked=false;const used=new Set();
  const session=await issueFinanceEvmSubjectSession(login,c,issue,async()=>{if(issued)return false;issued=true;return true;},now);
  assert.equal(session.nativeAccount,null);assert.equal(session.subjectNamespace,"evm");
  await assert.rejects(issueFinanceEvmSubjectSession(login,c,issue,async()=>false,now),{code:"REPLAY_OR_STORE_FAILURE"});
  const proof=createFinanceEvmSubjectHttpProof(session,request,secret);
  const consume=async ({nonce})=>{if(revoked||used.has(nonce))return false;used.add(nonce);return true;};
  assert.equal((await verifyAndConsumeFinanceEvmSubjectRead(proof,async()=>session,context,consume,now)).subjectId,subjectId);
  await assert.rejects(verifyAndConsumeFinanceEvmSubjectRead(proof,async()=>session,context,consume,now),{code:"REPLAY_OR_REVOKED"});
  await assert.rejects(verifyAndConsumeFinanceEvmSubjectRead(proof,async()=>session,{...context,method:"POST"},consume,now),{code:"SCOPE_DENIED"});
  await assert.rejects(verifyAndConsumeFinanceEvmSubjectRead(proof,async()=>session,{...context,target:"/api/private/orders"},consume,now),{code:"ROUTE_DENIED"});
  const revoke=createFinanceEvmSubjectRevokeProof(session,{bodyDigest:"c".repeat(64),nonce:"revoke_nonce_0123456789abcdefghijklmnop",
    issuedAt:request.issuedAt,expiresAt:request.expiresAt},secret);
  assert.equal((await verifyAndConsumeFinanceEvmSubjectRevoke(revoke,async()=>session,{origin:c.origin,method:"POST",target:"/api/evm-subject/revoke",bodyDigest:"c".repeat(64)},async()=>{revoked=true;return true;},now)).revoked,true);
  const fresh=createFinanceEvmSubjectHttpProof(session,{...request,nonce:"fresh_nonce_0123456789abcdefghijklmnop"},secret);
  await assert.rejects(verifyAndConsumeFinanceEvmSubjectRead(fresh,async()=>session,context,consume,now),{code:"REPLAY_OR_REVOKED"});
});

test("subject login rejects changed challenge, key, expiry and unverified contract account",async()=>{
  await assert.rejects(issueFinanceEvmSubjectSession(login,{...c,account:"0x"+"1".repeat(40)},issue,async()=>true,now),{code:"CHALLENGE_MISMATCH"});
  await assert.rejects(issueFinanceEvmSubjectSession({...login,deviceSignature:login.deviceSignature.slice(0,-2)+"aa"},c,issue,async()=>true,now));
  await assert.rejects(issueFinanceEvmSubjectSession(login,c,issue,async()=>true,new Date(end)),{code:"EXPIRED"});
  const contract={...c,accountType:"contract"},proof={...login,challenge:contract,message:financeEvmSubjectMessage(contract)};
  await assert.rejects(issueFinanceEvmSubjectSession(proof,contract,issue,async()=>true,now),{code:"CONTRACT_ACCOUNT_UNSUPPORTED"});
});

test("EIP-1271 contract account requires the exact chain-bound verifier for login and every order",async()=>{
  const contract={...c,accountType:"contract"};
  const contractSig="0x"+"ab".repeat(96);
  const login=createFinanceEvmSubjectLoginProof(contract,contractSig,secret);
  const checked=[];
  const verify=async input=>{checked.push(input);return input.chainId===6423&&input.account===account&&input.signature===contractSig;};
  const session=await issueFinanceEvmSubjectSession(login,contract,issue,async()=>true,now,verify);
  assert.equal(session.accountType,"contract");
  const challenge={...orderChallenge,accountType:"contract"};
  const approval=createFinanceEvmOrderApproval(challenge,contractSig,secret,key);
  const authority={...orderAuthority,accountType:"contract"};
  await assert.rejects(verifyAndConsumeFinanceEvmOrderApproval(approval,challenge,authority,async()=>true,now),{code:"CONTRACT_ACCOUNT_UNSUPPORTED"});
  let recheck=false;
  const result=await verifyAndConsumeFinanceEvmOrderApproval(approval,challenge,authority,async input=>{recheck=input.contractSignatureRecheckRequired;return true;},now,verify);
  assert.equal(result.verified,true);assert.equal(recheck,true);assert.equal(checked.length,2);
  await assert.rejects(verifyAndConsumeFinanceEvmOrderApproval(approval,challenge,authority,async()=>true,now,async()=>false),{code:"INVALID_SIGNATURE"});
});

test("EVM order approval requires exact wallet and device signatures and one atomic provider order",async()=>{
  assert.equal(Buffer.from(financeEvmOrderSigningRequest(orderChallenge).params[0].slice(2),"hex").toString(),financeEvmOrderMessage(orderChallenge));
  const approval=createFinanceEvmOrderApproval(orderChallenge,sign(financeEvmOrderMessage(orderChallenge)),secret,key);
  let logicalOrders=0;
  const commit=async()=>{if(logicalOrders)return false;logicalOrders++;return true;};
  const result=await verifyAndConsumeFinanceEvmOrderApproval(approval,orderChallenge,orderAuthority,commit,now);
  assert.equal(result.orderHash,financeOrderHash(fixture.order));
  await assert.rejects(verifyAndConsumeFinanceEvmOrderApproval(approval,orderChallenge,orderAuthority,commit,now),{code:"REPLAY_OR_REVOKED"});
  assert.equal(logicalOrders,1);
  await assert.rejects(verifyAndConsumeFinanceEvmOrderApproval(approval,{...orderChallenge,order:{...fixture.order,qty:"3"}},orderAuthority,async()=>true,now));
  await assert.rejects(verifyAndConsumeFinanceEvmOrderApproval(approval,orderChallenge,{...orderAuthority,brokerAccountId:"other_broker_0123456789"},async()=>true,now),{code:"AUTHORITY_MISMATCH"});
  await assert.rejects(verifyAndConsumeFinanceEvmOrderApproval(approval,orderChallenge,{...orderAuthority,revoked:true},async()=>true,now),{code:"AUTHORITY_MISMATCH"});
});

test("reject and unused-approval revoke race approval; neither is an order grant",async()=>{
  const reject=createFinanceEvmOrderReject(orderChallenge,"reject_nonce_0123456789abcdefghijklmnop",t,end,secret,key);
  let consumed=false;const consume=async()=>{if(consumed)return false;consumed=true;return true;};
  assert.equal((await verifyAndConsumeFinanceEvmOrderReject(reject,orderChallenge,{subjectId,account,sessionBinding:orderChallenge.sessionBinding,deviceKey:key,revoked:false},consume,now)).rejected,true);
  await assert.rejects(verifyAndConsumeFinanceEvmOrderReject(reject,orderChallenge,{subjectId,account,sessionBinding:orderChallenge.sessionBinding,deviceKey:key,revoked:false},consume,now),{code:"REPLAY_OR_REVOKED"});
  const unsigned={version:"1",approvalId:"a".repeat(64),challengeId:orderChallenge.challengeId,requestId:orderChallenge.requestId,
    subjectId,account,orderHash:orderChallenge.orderHash,nonce:"unused_nonce_0123456789abcdefghijklmnop",issuedAt:t,expiresAt:end};
  const revoke=createFinanceEvmOrderUnusedRevocation(orderChallenge,unsigned.approvalId,unsigned.nonce,t,end,sign(financeEvmOrderRevokeMessage(unsigned)));
  assert.equal((await verifyAndConsumeFinanceEvmOrderUnusedRevocation(revoke,orderChallenge,{subjectId,account,brokerAccountId:orderChallenge.brokerAccountId,
    sessionBinding:orderChallenge.sessionBinding,revoked:false},async()=>true,now)).revoked,true);
});
