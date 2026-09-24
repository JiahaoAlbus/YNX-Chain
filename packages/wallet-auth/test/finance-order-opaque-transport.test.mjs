import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createFinanceOrderOpaqueLaunchURL,parseFinanceOrderOpaqueLaunchURL,financeOrderOpaqueTicketHash,
  createSignedFinanceOrderOpaqueClaim,verifyFinanceOrderOpaqueClaim,createSignedFinanceOrderOpaqueReject,
  verifySignedFinanceOrderOpaqueReject,createFinanceOrderOpaqueCallbackURL,parseFinanceOrderOpaqueCallbackURL,
  parseFinanceOrderOpaqueClaimResponse,createFinanceOrderOpaqueCompleteRequest,parseFinanceOrderOpaqueCompleteResponse,
  createSignedFinanceOrderLegacyRecovery,verifySignedFinanceOrderLegacyRecovery,parseFinanceOrderLegacyRecoveryResponse,
  FINANCE_ORDER_STATE_BINDING_LEGACY_RAW,FINANCE_ORDER_STATE_BINDING_SHA256,
  createSignedFinanceOrderApproval,
} from "../src/index.js";

const vector=JSON.parse(readFileSync(new URL("../testdata/finance-order-approval-v1.vectors.json",import.meta.url))).positive;
const ticket="ticket_0123456789abcdefghijklmnopqrst",state="state_0123456789abcdefghijklmnopqrstu",code="code_0123456789abcdefghijklmnopqrst";
const unsigned={...vector.unsigned,callbackStateHash:bytesToHex(sha256(utf8ToBytes(state)))};
const at=new Date("2026-09-19T09:01:00.000Z");

test("launch URL contains only opaque ticket and rejects full order or extra query",()=>{
  const url=createFinanceOrderOpaqueLaunchURL(ticket);
  assert.deepEqual(parseFinanceOrderOpaqueLaunchURL(url),{ticket});
  assert.equal(url.includes(vector.order.symbol),false);
  assert.equal(url.includes(vector.unsigned.brokerAccountId),false);
  for(const malformed of [url+"&order=secret",url.replace("ticket=","request="),url+"#approval",url.replace("finance-order-approval","other")])
    assert.throws(()=>parseFinanceOrderOpaqueLaunchURL(malformed));
});

test("ticket claim proves selected native account without approving an order",()=>{
  const proof=createSignedFinanceOrderOpaqueClaim({ticket,accountSecret:vector.testOnlyPublicSecretScalarHex,
    nonce:"claim_nonce_0123456789abcdefghijkl",issuedAt:"2026-09-19T09:00:30.000Z",expiresAt:"2026-09-19T09:01:30.000Z"});
  const authority={ticket,account:vector.account,accountPublicKey:vector.accountPublicKey};
  assert.equal(verifyFinanceOrderOpaqueClaim(proof,authority,at).ticketHash,financeOrderOpaqueTicketHash(ticket));
  assert.equal(JSON.stringify(proof).includes(vector.order.symbol),false);
  assert.throws(()=>verifyFinanceOrderOpaqueClaim(proof,{...authority,ticket:"other_0123456789abcdefghijklmnopqrst"},at),{code:"BINDING_MISMATCH"});
  assert.throws(()=>verifyFinanceOrderOpaqueClaim({...proof,signature:"0".repeat(128)},authority,at),{code:"INVALID_SIGNATURE"});
  assert.throws(()=>verifyFinanceOrderOpaqueClaim(proof,authority,new Date(proof.expiresAt)),{code:"EXPIRED"});
});

test("rejection signs exact challenge without authority to submit an order",()=>{
  const rejection=createSignedFinanceOrderOpaqueReject({ticket,challenge:unsigned},at,vector.testOnlyPublicSecretScalarHex);
  assert.equal(verifySignedFinanceOrderOpaqueReject(rejection,ticket,unsigned,at).status,"rejected");
  assert.throws(()=>verifySignedFinanceOrderOpaqueReject(rejection,ticket,{...unsigned,order:{...unsigned.order,symbol:"BETA"}},at));
  assert.throws(()=>verifySignedFinanceOrderOpaqueReject(rejection,"other_0123456789abcdefghijklmnopqrst",unsigned,at),{code:"BINDING_MISMATCH"});
});

test("callback exposes only one-time code and state bound to approved challenge",()=>{
  const input={code,state,requestId:unsigned.requestId,callbackStateHash:unsigned.callbackStateHash};
  const url=createFinanceOrderOpaqueCallbackURL(input);
  assert.deepEqual(parseFinanceOrderOpaqueCallbackURL(url,{requestId:unsigned.requestId,callbackStateHash:unsigned.callbackStateHash}),{code,state,requestId:unsigned.requestId});
  assert.equal(url.includes(unsigned.brokerAccountId),false);
  assert.equal(url.includes(unsigned.orderHash),false);
  assert.throws(()=>parseFinanceOrderOpaqueCallbackURL(url+"&financeOrderApprovalResult=secret",{requestId:unsigned.requestId,callbackStateHash:unsigned.callbackStateHash}),{code:"INVALID_CALLBACK"});
  assert.throws(()=>createFinanceOrderOpaqueCallbackURL({...input,state:"different_state_0123456789abcdefgh"}),{code:"STATE_MISMATCH"});
});

test("claim and completion responses fail closed on account, ticket, order, code and time substitutions",()=>{
  const claim=parseFinanceOrderOpaqueClaimResponse({version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),challenge:unsigned,
    serverTime:at.toISOString()},{ticket,account:unsigned.account,accountPublicKey:unsigned.accountPublicKey});
  assert.equal(claim.challenge.orderHash,unsigned.orderHash);
  assert.throws(()=>parseFinanceOrderOpaqueClaimResponse({...claim,ticketHash:"a".repeat(64)},{ticket,account:unsigned.account,accountPublicKey:unsigned.accountPublicKey}),{code:"BINDING_MISMATCH"});
  assert.throws(()=>parseFinanceOrderOpaqueClaimResponse({...claim,challenge:{...unsigned,brokerAccountId:"other"}},{ticket,account:unsigned.account,accountPublicKey:unsigned.accountPublicKey}));
  const approved=createSignedFinanceOrderApproval({accountSecret:vector.testOnlyPublicSecretScalarHex,approval:unsigned},at);
  const request=createFinanceOrderOpaqueCompleteRequest(ticket,"approved",approved,unsigned,at);
  assert.equal(request.proof.orderHash,unsigned.orderHash);
  assert.deepEqual(Object.keys(request).sort(),["proof","status","ticket"]);
  assert.throws(()=>createFinanceOrderOpaqueCompleteRequest(ticket,"approved",{...approved,orderHash:"a".repeat(64)},unsigned,at));
  const response={version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),requestId:unsigned.requestId,status:"stored",
    code,state,serverTime:at.toISOString(),expiresAt:"2026-09-19T09:02:00.000Z"};
  assert.equal(parseFinanceOrderOpaqueCompleteResponse(response,{ticket,challenge:unsigned}).callbackURL,createFinanceOrderOpaqueCallbackURL({code,state,requestId:unsigned.requestId,callbackStateHash:unsigned.callbackStateHash}));
  assert.throws(()=>parseFinanceOrderOpaqueCompleteResponse({...response,state:"different_state_0123456789abcdefgh"},{ticket,challenge:unsigned}),{code:"STATE_MISMATCH"});
  assert.throws(()=>parseFinanceOrderOpaqueCompleteResponse({...response,expiresAt:"2026-09-19T09:06:00.000Z"},{ticket,challenge:unsigned}),{code:"EXPIRED"});
});

test("legacy recovery signs only a durable pre-cutover challenge and returns an opaque ticket",()=>{
  const proof=createSignedFinanceOrderLegacyRecovery({challenge:unsigned,nonce:"legacy_nonce_0123456789abcdefghijkl"},at,vector.testOnlyPublicSecretScalarHex);
  const cutover=new Date("2026-09-19T09:02:00.000Z");
  assert.equal(verifySignedFinanceOrderLegacyRecovery(proof,unsigned,cutover,at).requestId,unsigned.requestId);
  assert.equal(JSON.stringify(proof).includes(unsigned.brokerAccountId),false);
  assert.throws(()=>verifySignedFinanceOrderLegacyRecovery(proof,unsigned,new Date(unsigned.issuedAt),at),{code:"LEGACY_DISABLED"});
  assert.throws(()=>verifySignedFinanceOrderLegacyRecovery(proof,{...unsigned,order:{...unsigned.order,symbol:"BETA"}},cutover,at));
  assert.throws(()=>verifySignedFinanceOrderLegacyRecovery(proof,unsigned,cutover,new Date(unsigned.expiresAt)),{code:"EXPIRED"});
  const response=parseFinanceOrderLegacyRecoveryResponse({version:"2",ticket,ticketHash:financeOrderOpaqueTicketHash(ticket),serverTime:at.toISOString()},{requestId:unsigned.requestId});
  assert.equal(response.ticket,ticket);
  assert.throws(()=>parseFinanceOrderLegacyRecoveryResponse({version:"2",ticket,ticketHash:"0".repeat(64),serverTime:at.toISOString()},{requestId:unsigned.requestId}),{code:"BINDING_MISMATCH"});
});

test("legacy raw random state is accepted only under explicit local legacy binding",()=>{
  const legacy=vector.unsigned,legacyState=legacy.callbackStateHash;
  assert.equal(legacyState.length,64);
  assert.notEqual(bytesToHex(sha256(utf8ToBytes(legacyState))),legacyState);
  const expected={requestId:legacy.requestId,callbackStateHash:legacy.callbackStateHash};
  const input={code,state:legacyState,...expected};
  const url=createFinanceOrderOpaqueCallbackURL(input,FINANCE_ORDER_STATE_BINDING_LEGACY_RAW);
  assert.deepEqual(parseFinanceOrderOpaqueCallbackURL(url,expected,FINANCE_ORDER_STATE_BINDING_LEGACY_RAW),{code,state:legacyState,requestId:legacy.requestId});
  assert.throws(()=>createFinanceOrderOpaqueCallbackURL(input),{code:"STATE_MISMATCH"});
  assert.throws(()=>parseFinanceOrderOpaqueCallbackURL(url,expected),{code:"STATE_MISMATCH"});
  const response={version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),requestId:legacy.requestId,status:"stored",
    code,state:legacyState,serverTime:at.toISOString(),expiresAt:"2026-09-19T09:02:00.000Z"};
  assert.equal(parseFinanceOrderOpaqueCompleteResponse(response,{ticket,challenge:legacy},FINANCE_ORDER_STATE_BINDING_LEGACY_RAW).callbackURL,url);
  assert.throws(()=>parseFinanceOrderOpaqueCompleteResponse(response,{ticket,challenge:legacy}),{code:"STATE_MISMATCH"});
  assert.throws(()=>parseFinanceOrderOpaqueCompleteResponse({...response,state:"0".repeat(64)},{ticket,challenge:legacy},FINANCE_ORDER_STATE_BINDING_LEGACY_RAW),{code:"STATE_MISMATCH"});
  const fresh={code,state,requestId:unsigned.requestId,callbackStateHash:unsigned.callbackStateHash};
  assert.ok(createFinanceOrderOpaqueCallbackURL(fresh,FINANCE_ORDER_STATE_BINDING_SHA256));
  assert.throws(()=>createFinanceOrderOpaqueCallbackURL(fresh,FINANCE_ORDER_STATE_BINDING_LEGACY_RAW),{code:"STATE_MISMATCH"});
});
