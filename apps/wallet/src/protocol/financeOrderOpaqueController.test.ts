import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createFinanceOrderOpaqueLaunchURL, financeOrderOpaqueTicketHash, parseFinanceOrderOpaqueCallbackURL,
  createFinanceOrderApprovalRequest, encodeFinanceOrderApprovalWalletURL,
  verifyFinanceOrderOpaqueClaim, verifySignedFinanceOrderLegacyRecovery, createSignedFinanceOrderApproval,
  createSignedFinanceOrderApprovalRevocation,
} from "@ynx-chain/wallet-auth";
import type { FinanceOrderApprovalUnsigned } from "@ynx-chain/wallet-auth";
import { FinanceOrderOpaqueController, FINANCE_ORDER_OPAQUE_REPLAY_KEY } from "./financeOrderOpaqueController";

const fixture=JSON.parse(readFileSync(new URL("../../../../packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json",import.meta.url),"utf8")).positive;
const ticket="ticket_0123456789abcdefghijklmnopqrst",state="state_0123456789abcdefghijklmnopqrstu",code="code_0123456789abcdefghijklmnopqrst";
const unsigned:FinanceOrderApprovalUnsigned={...fixture.unsigned,callbackStateHash:bytesToHex(sha256(utf8ToBytes(state)))};
const legacyUnsigned:FinanceOrderApprovalUnsigned=fixture.unsigned;
const secret=fixture.testOnlyPublicSecretScalarHex as string;
const account={account:unsigned.account,accountPublicKey:unsigned.accountPublicKey,backupConfirmed:true,label:"Finance test"} as any;
const at=new Date("2026-09-19T09:01:00.000Z");

function setup(saved=new Map<string,string>()){
  const events={claimed:0,completed:0,keys:0,opens:[] as string[],now:new Date(at),selected:account,failOpen:false,failComplete:false,
    forceRawState:false,claimMismatch:false,claimGate:null as Promise<void>|null,completeGate:null as Promise<void>|null,
    storageGate:null as Promise<void>|null,storageReads:0,
    legacy:null as null|{request:ReturnType<typeof createFinanceOrderApprovalRequest>;status:"pending"|"approved"|"rejected"|"revoked";approval:any;revocation:any}};
  const storage:any={
    getItem:async(key:string)=>{events.storageReads++;if(events.storageGate)await events.storageGate;return saved.get(key)??null},
    setItem:async(key:string,value:string)=>{saved.set(key,value)},
    deleteItem:async()=>{throw new Error("journal deletion forbidden")},
  };
  const controller=()=>new FinanceOrderOpaqueController({
    storage,selectedAccount:()=>events.selected,
    withAccountSecret:async(_id,check,use)=>{check();events.keys++;return use(secret,check)},
    currentTime:async(check)=>{check();return new Date(events.now)},
    randomToken:async()=>"claim_nonce_0123456789abcdefghijkl",
    claim:async body=>{events.claimed++;verifyFinanceOrderOpaqueClaim(body.claim,{ticket,account:unsigned.account,accountPublicKey:unsigned.accountPublicKey},events.now);
      if(events.claimGate)await events.claimGate;
      return {version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),challenge:events.claimMismatch?unsigned:events.legacy?.request.unsigned??unsigned,serverTime:events.now.toISOString()}},
    complete:async body=>{events.completed++;if(events.completeGate)await events.completeGate;if(events.failComplete)throw new Error("handoff unavailable");
      assert.equal(body.ticket,ticket);assert.deepEqual(Object.keys(body).sort(),["proof","status","ticket"]);
      return {version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),requestId:unsigned.requestId,status:"stored",
        code,state:events.forceRawState?unsigned.callbackStateHash:events.legacy?.request.unsigned.callbackStateHash??state,
        serverTime:events.now.toISOString(),expiresAt:"2026-09-19T09:02:00.000Z"}},
    recoverLegacy:async body=>{if(!events.legacy)throw new Error("Legacy recovery fixture not configured");
      assert.equal(body.requestId,unsigned.requestId);
      verifySignedFinanceOrderLegacyRecovery(body.claim,events.legacy.request.unsigned,new Date("2026-09-19T09:02:00.000Z"),events.now);
      return {version:"2",ticket,ticketHash:financeOrderOpaqueTicketHash(ticket),serverTime:events.now.toISOString()}},
    inspectLegacy:async()=>{if(!events.legacy)throw new Error("Legacy journal fixture not configured");return events.legacy},
    openURL:async url=>{events.opens.push(url);if(events.failOpen)throw new Error("callback unavailable")},
  });
  return {events,saved,controller,url:createFinanceOrderOpaqueLaunchURL(ticket)};
}

function gate(){let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});return {pending,release}}

test("v2 claims with the selected account, reviews exact order, and returns only opaque code",async()=>{
  const f=setup(),c=f.controller(),review=await c.receive(f.url);
  assert.equal(f.events.claimed,1);assert.equal(review.request.unsigned.order.symbol,"ACME");
  assert.equal(f.url.includes(unsigned.brokerAccountId),false);
  await c.approve(review.id);
  assert.equal(f.events.completed,1);assert.equal(f.events.opens.length,1);
  assert.deepEqual(parseFinanceOrderOpaqueCallbackURL(f.events.opens[0]!,{requestId:unsigned.requestId,callbackStateHash:unsigned.callbackStateHash}),{code,state,requestId:unsigned.requestId});
  assert.equal(f.events.opens[0]!.includes(unsigned.orderHash),false);
  assert.equal(f.events.opens[0]!.includes(unsigned.brokerAccountId),false);
  const journal=f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!;
  assert.equal(journal.includes(secret),false);
  assert.equal(JSON.parse(journal).rows[0].status,"approved");
});

test("failed callback restores signed proof without re-signing or exposing it in URL",async()=>{
  const f=setup(),c=f.controller(),review=await c.receive(f.url);
  f.events.failOpen=true;
  await assert.rejects(c.approve(review.id),/callback unavailable/);
  const before=f.events.keys;c.cancel();
  const restored=f.controller(),again=await restored.receive(f.url);
  assert.equal(f.events.claimed,1);assert.equal(again.decision,"approved");
  f.events.failOpen=false;
  await restored.retryReturn(again.id);
  assert.equal(f.events.keys,before);
  assert.equal(f.events.opens.length,2);
  assert.equal(f.events.opens[0],f.events.opens[1]);
});

test("rejection is separately signed and persisted before network delivery",async()=>{
  const f=setup(),c=f.controller(),review=await c.receive(f.url);
  f.events.failComplete=true;
  await assert.rejects(c.reject(review.id),/handoff unavailable/);
  const row=JSON.parse(f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0];
  assert.equal(row.status,"rejected");assert.equal(row.proof.action,"reject");
  assert.equal(f.events.opens.length,0);
  f.events.failComplete=false;await c.retryReturn(review.id);
  assert.equal(f.events.opens.length,1);
});

test("unused approval revocation is a separate signed decision and cannot use the old callback URL",async()=>{
  const f=setup(),c=f.controller(),review=await c.receive(f.url);
  f.events.failOpen=true;
  await assert.rejects(c.approve(review.id),/callback unavailable/);
  assert.equal(c.canRevoke(review.id),true);
  f.events.failOpen=false;
  await c.revokeUnused(review.id);
  const row=JSON.parse(f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0];
  assert.equal(row.status,"revoked");assert.equal(row.proof.reason,"USER_REVOKED");
  assert.equal(f.events.opens.length,2);
  assert.equal(f.events.opens[1]!.includes("financeOrderApprovalResult"),false);
});

test("account changes stop review and wrong claim account cannot reveal order",async()=>{
  const f=setup(),c=f.controller();
  f.events.selected={...account,account:"ynx1"+"q".repeat(38)};
  await assert.rejects(c.receive(f.url));
  assert.equal(f.events.claimed,1);
  assert.equal(f.events.opens.length,0);
});

test("account switch during ticket claim cannot reveal or journal the order",async()=>{
  const f=setup(),wait=gate(),c=f.controller();f.events.claimGate=wait.pending;
  const receiving=c.receive(f.url);
  while(f.events.claimed===0)await new Promise(resolve=>setImmediate(resolve));
  f.events.selected={...account,account:"ynx1"+"q".repeat(38)};
  wait.release();
  await assert.rejects(receiving,/Selected Wallet account changed/);
  assert.equal(c.current,null);assert.equal(f.saved.has(FINANCE_ORDER_OPAQUE_REPLAY_KEY),false);
  assert.equal(f.events.opens.length,0);
});

test("account switch during journal restoration cannot reopen another account's order",async()=>{
  const f=setup(),first=f.controller();await first.receive(f.url);first.cancel();
  const wait=gate(),reads=f.events.storageReads;f.events.storageGate=wait.pending;
  const restored=f.controller(),receiving=restored.receive(f.url);
  while(f.events.storageReads===reads)await new Promise(resolve=>setImmediate(resolve));
  f.events.selected={...account,account:"ynx1"+"q".repeat(38)};
  wait.release();
  await assert.rejects(receiving,/Selected Wallet account changed/);
  assert.equal(restored.current,null);assert.equal(f.events.claimed,1);
  assert.equal(f.events.opens.length,0);
});

test("account switch during result storage stops callback but keeps the signed decision for recovery",async()=>{
  const f=setup(),c=f.controller(),review=await c.receive(f.url),wait=gate();
  f.events.completeGate=wait.pending;
  const approving=c.approve(review.id);
  while(f.events.completed===0)await new Promise(resolve=>setImmediate(resolve));
  f.events.selected={...account,account:"ynx1"+"q".repeat(38)};
  wait.release();
  await assert.rejects(approving,/Selected Wallet account changed/);
  assert.equal(f.events.opens.length,0);
  assert.equal(JSON.parse(f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0].status,"approved");
  f.events.selected=account;f.events.completeGate=null;
  const recovered=f.controller(),again=await recovered.receive(f.url),keys=f.events.keys;
  assert.equal(again.decision,"approved");
  await recovered.retryReturn(again.id);
  assert.equal(f.events.keys,keys);assert.equal(f.events.opens.length,1);
});

test("pre-cutover v1 approved proof migrates through signed recovery and opaque completion without re-signing approval",async()=>{
  const f=setup(),c=f.controller(),request=createFinanceOrderApprovalRequest(legacyUnsigned,at),legacyURL=encodeFinanceOrderApprovalWalletURL(request,at);
  const approval=createSignedFinanceOrderApproval({accountSecret:secret,approval:legacyUnsigned},at);
  f.events.legacy={request,status:"approved",approval,revocation:null};
  const review=await c.receive(legacyURL);
  assert.equal(review.decision,"approved");assert.equal(f.events.claimed,1);assert.equal(c.hasReturn(review.id),true);
  const keys=f.events.keys;
  await c.retryReturn(review.id);
  assert.equal(f.events.keys,keys);
  assert.equal(f.events.opens[0]!.includes("financeOrderApprovalResult"),false);
  assert.equal(f.events.opens[0]!.includes(unsigned.brokerAccountId),false);
  const row=JSON.parse(f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0];
  assert.equal(row.status,"approved");assert.deepEqual(row.proof,approval);assert.equal(row.stateBinding,"raw-v1-random32");
  assert.equal(new URL(f.events.opens[0]!).searchParams.get("state"),legacyUnsigned.callbackStateHash);
});

test("pre-cutover v1 rejection and unused revocation migrate without opening old callback",async()=>{
  const request=createFinanceOrderApprovalRequest(legacyUnsigned,at),legacyURL=encodeFinanceOrderApprovalWalletURL(request,at);
  const rejected=setup();rejected.events.legacy={request,status:"rejected",approval:null,revocation:null};
  const rejectController=rejected.controller(),rejectReview=await rejectController.receive(legacyURL);
  assert.equal(rejectReview.decision,"rejected");
  await rejectController.retryReturn(rejectReview.id);
  assert.equal(rejected.events.opens[0]!.includes("financeOrderApprovalResult"),false);
  assert.equal(JSON.parse(rejected.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0].proof.action,"reject");
  const revoked=setup(),approval=createSignedFinanceOrderApproval({accountSecret:secret,approval:legacyUnsigned},at);
  revoked.events.now=new Date("2026-09-19T09:01:20.000Z");
  const revocation=createSignedFinanceOrderApprovalRevocation({accountSecret:secret,approval},revoked.events.now);
  revoked.events.legacy={request,status:"revoked",approval,revocation};
  const revokeController=revoked.controller(),revokeReview=await revokeController.receive(legacyURL);
  assert.equal(revokeReview.decision,"revoked");
  await revokeController.retryReturn(revokeReview.id);
  assert.equal(revoked.events.opens[0]!.includes("financeOrderApprovalResult"),false);
  assert.deepEqual(JSON.parse(revoked.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0].proof,revocation);
});

test("unknown legacy challenge stays fail closed and never opens a full-proof callback",async()=>{
  const f=setup(),c=f.controller(),legacyURL=encodeFinanceOrderApprovalWalletURL(createFinanceOrderApprovalRequest(legacyUnsigned,at),at);
  await assert.rejects(c.receive(legacyURL),/Legacy journal fixture not configured/);
  assert.equal(f.events.claimed,0);assert.equal(f.events.completed,0);assert.equal(f.events.opens.length,0);
});

test("fresh v2 cannot accept a raw legacy state, and retries from its signed journal",async()=>{
  const f=setup(),c=f.controller(),review=await c.receive(f.url);
  f.events.forceRawState=true;
  await assert.rejects(c.approve(review.id),{code:"STATE_MISMATCH"});
  assert.equal(f.events.opens.length,0);
  assert.equal(JSON.parse(f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!).rows[0].stateBinding,"sha256-v2");
  const keys=f.events.keys;f.events.forceRawState=false;
  await c.retryReturn(review.id);
  assert.equal(f.events.keys,keys);
  assert.equal(f.events.opens.length,1);
});

test("forged recovery ticket cannot select legacy binding without exact claimed challenge",async()=>{
  const f=setup(),request=createFinanceOrderApprovalRequest(legacyUnsigned,at);
  f.events.legacy={request,status:"pending",approval:null,revocation:null};
  f.events.claimMismatch=true;
  await assert.rejects(f.controller().receive(encodeFinanceOrderApprovalWalletURL(request,at)),/differs from legacy challenge/);
  assert.equal(f.events.opens.length,0);
  assert.equal(f.saved.has(FINANCE_ORDER_OPAQUE_REPLAY_KEY),false);
});

test("legacy mode survives cold restart without touching the old signed approval",async()=>{
  const f=setup(),request=createFinanceOrderApprovalRequest(legacyUnsigned,at),url=encodeFinanceOrderApprovalWalletURL(request,at);
  const approval=createSignedFinanceOrderApproval({accountSecret:secret,approval:legacyUnsigned},at);
  f.events.legacy={request,status:"approved",approval,revocation:null};
  const first=f.controller(),review=await first.receive(url);
  f.events.failOpen=true;await assert.rejects(first.retryReturn(review.id),/callback unavailable/);
  const savedBefore=f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY),keys=f.events.keys;
  first.cancel();f.events.failOpen=false;
  const second=f.controller(),restored=await second.receive(url);
  assert.equal(restored.decision,"approved");
  assert.equal(f.saved.get(FINANCE_ORDER_OPAQUE_REPLAY_KEY),savedBefore);
  await second.retryReturn(restored.id);
  assert.equal(f.events.keys,keys+1); // only the read-only legacy recovery claim is newly signed
  assert.equal(new URL(f.events.opens.at(-1)!).searchParams.get("state"),legacyUnsigned.callbackStateHash);
});

test("expired legacy challenge cannot mint a recovery ticket or delete old data",async()=>{
  const f=setup(),request=createFinanceOrderApprovalRequest(legacyUnsigned,at);
  f.events.legacy={request,status:"pending",approval:null,revocation:null};
  f.events.now=new Date(legacyUnsigned.expiresAt);
  const url=encodeFinanceOrderApprovalWalletURL(request,at);
  await assert.rejects(f.controller().receive(url),{code:"EXPIRED"});
  assert.equal(f.events.completed,0);assert.equal(f.events.opens.length,0);
  assert.equal(f.saved.has(FINANCE_ORDER_OPAQUE_REPLAY_KEY),false);
});
