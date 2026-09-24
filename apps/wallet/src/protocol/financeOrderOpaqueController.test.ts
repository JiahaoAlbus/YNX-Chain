import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createFinanceOrderOpaqueLaunchURL, financeOrderOpaqueTicketHash, parseFinanceOrderOpaqueCallbackURL,
  verifyFinanceOrderOpaqueClaim,
} from "@ynx-chain/wallet-auth";
import type { FinanceOrderApprovalUnsigned } from "@ynx-chain/wallet-auth";
import { FinanceOrderOpaqueController, FINANCE_ORDER_OPAQUE_REPLAY_KEY } from "./financeOrderOpaqueController";

const fixture=JSON.parse(readFileSync(new URL("../../../../packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json",import.meta.url),"utf8")).positive;
const ticket="ticket_0123456789abcdefghijklmnopqrst",state="state_0123456789abcdefghijklmnopqrstu",code="code_0123456789abcdefghijklmnopqrst";
const unsigned:FinanceOrderApprovalUnsigned={...fixture.unsigned,callbackStateHash:bytesToHex(sha256(utf8ToBytes(state)))};
const secret=fixture.testOnlyPublicSecretScalarHex as string;
const account={account:unsigned.account,accountPublicKey:unsigned.accountPublicKey,backupConfirmed:true,label:"Finance test"} as any;
const at=new Date("2026-09-19T09:01:00.000Z");

function setup(saved=new Map<string,string>()){
  const events={claimed:0,completed:0,keys:0,opens:[] as string[],now:new Date(at),selected:account,failOpen:false,failComplete:false};
  const storage:any={
    getItem:async(key:string)=>saved.get(key)??null,
    setItem:async(key:string,value:string)=>{saved.set(key,value)},
    deleteItem:async()=>{throw new Error("journal deletion forbidden")},
  };
  const controller=()=>new FinanceOrderOpaqueController({
    storage,selectedAccount:()=>events.selected,
    withAccountSecret:async(_id,check,use)=>{check();events.keys++;return use(secret,check)},
    currentTime:async(check)=>{check();return new Date(events.now)},
    randomToken:async()=>"claim_nonce_0123456789abcdefghijkl",
    claim:async body=>{events.claimed++;verifyFinanceOrderOpaqueClaim(body.claim,{ticket,account:unsigned.account,accountPublicKey:unsigned.accountPublicKey},events.now);
      return {version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),challenge:unsigned,serverTime:events.now.toISOString()}},
    complete:async body=>{events.completed++;if(events.failComplete)throw new Error("handoff unavailable");
      assert.equal(body.ticket,ticket);assert.equal(body.requestId,unsigned.requestId);
      return {version:"2",ticketHash:financeOrderOpaqueTicketHash(ticket),requestId:unsigned.requestId,status:"stored",
        code,state,serverTime:events.now.toISOString(),expiresAt:"2026-09-19T09:02:00.000Z"}},
    openURL:async url=>{events.opens.push(url);if(events.failOpen)throw new Error("callback unavailable")},
  });
  return {events,saved,controller,url:createFinanceOrderOpaqueLaunchURL(ticket)};
}

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
