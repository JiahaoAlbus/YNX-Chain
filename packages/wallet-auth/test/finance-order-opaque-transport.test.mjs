import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createFinanceOrderOpaqueLaunchURL,parseFinanceOrderOpaqueLaunchURL,financeOrderOpaqueTicketHash,
  createSignedFinanceOrderOpaqueClaim,verifyFinanceOrderOpaqueClaim,createSignedFinanceOrderOpaqueReject,
  verifySignedFinanceOrderOpaqueReject,createFinanceOrderOpaqueCallbackURL,parseFinanceOrderOpaqueCallbackURL,
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
