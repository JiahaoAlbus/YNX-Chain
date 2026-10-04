import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TransactionSubmissions} from "../src/transaction-submissions.mjs";
const {createTransactionHistoryUI}=await import(process.env.YNX_HISTORY_UI_SOURCE??new URL("../src/transaction-history-ui.mjs",import.meta.url).href);
import {parseFeeModel} from "../src/rpc-capabilities.mjs";
import {CANONICAL_RPC_URL,LEGACY_RPC_URL} from "../src/rpc.mjs";
import {DURABILITY_MODEL} from "../src/transaction-durability.mjs";

// Original history producer and receipt validator with controlled public
// intent/receipt snapshots. No shared WalletAuth, signing, private journal,
// network, OS or real checkpoint authority is executed or claimed.
const literal=JSON.parse(await readFile(new URL("./fixtures/transaction-durability/ethereum-block-marker.json",import.meta.url),"utf8"));
const account=literal.recoveredReceipt.from,to=literal.recoveredReceipt.to;
const model=parseFeeModel({version:"ynx-ethereum-native-v1",enabled:true,chainId:"0x1917",transactionType:"0x0",feeYNXT:"1",feeWei:"0xde0b6b3a7640000",gas:"0x61a8",gasPrice:"0x246139ca8000",decimals:18,amountQuantumWei:"0xde0b6b3a7640000",scope:"whole-YNXT plain native transfers",fullEVM:false,eip1559:false,durability:DURABILITY_MODEL});
function entry(index,origin=CANONICAL_RPC_URL){
  const hash="0x"+index.toString(16).padStart(64,"0"),receipt=structuredClone(literal.recoveredReceipt);receipt.transactionHash=hash;receipt.ynxDurability.transactionHash=hash;
  return{intent:{hash,account,to,nonce:"0x0",value:"0x1bc16d674ec80000",origin,raw:"controlled private bytes never displayed"},receipt,capabilities:model};
}
function composed(initial,limit=20){
  let entries=initial,last;const requests=[],producer=new TransactionSubmissions({intentStore:{resolutions:async()=>structuredClone(entries)}});
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>{requests.push(cursor);return{ok:true,value:await producer.history(account,cursor,limit)}}});
  return{producer,ui,requests,get:()=>last,replace:value=>{entries=value}};
}
test("original inclusive-cursor producer composes all three public pages without losing completed transfers",async()=>{
  const originals=Array.from({length:43},(_,i)=>entry(i+1)),h=composed(originals);await h.ui.refresh();assert.equal(h.get().records.length,20);assert.equal(h.get().nextCursor,originals[22].intent.hash);
  await h.ui.older();assert.equal(h.get().records.length,40);assert.equal(h.get().nextCursor,originals[2].intent.hash);await h.ui.older();
  assert.equal(h.get().error,null);assert.equal(h.get().loaded,true);assert.equal(h.get().nextCursor,null);assert.deepEqual(h.get().records.map(r=>r.hash),originals.map(e=>e.intent.hash).reverse());
  assert.deepEqual(h.requests,[null,originals[22].intent.hash,originals[2].intent.hash]);assert.ok(h.get().records.every(r=>r.amount==="2.0"&&r.actualFee==="1.0"&&r.successful===true&&r.consensusFinality===false&&!Object.hasOwn(r,"raw")));
});
test("a newly completed transfer between pages does not shift the original hash continuation or repeat a row",async()=>{
  const originals=[entry(1),entry(2),entry(3)],h=composed(originals,2);await h.ui.refresh();h.replace([...originals,entry(4)]);await h.ui.older();
  assert.deepEqual(h.get().records.map(r=>r.hash),[entry(3).intent.hash,entry(2).intent.hash,entry(1).intent.hash]);assert.equal(h.get().error,null);
  await h.ui.refresh();assert.deepEqual(h.get().records.map(r=>r.hash),[entry(4).intent.hash,entry(3).intent.hash]);assert.equal(h.get().error,null);
});
test("missing original cursor fails producer read and retains the last verified UI rows",async()=>{
  const originals=[entry(1),entry(2),entry(3)],h=composed(originals,2);await h.ui.refresh();h.replace(originals.slice(1));await h.ui.older();
  assert.equal(h.get().loaded,false);assert.deepEqual(h.get().records.map(r=>r.hash),[entry(3).intent.hash,entry(2).intent.hash]);assert.equal(h.get().nextCursor,entry(1).intent.hash);assert.ok(h.get().error);
});
test("original receipt revalidation rejects incomplete checkpoint evidence without displaying an invented completed result",async()=>{
  const originals=[entry(1),entry(2),entry(3)],h=composed(originals,2);await h.ui.refresh();originals[0].receipt.ynxDurability.status="uncertain";h.replace(originals);await h.ui.older();
  assert.deepEqual(h.get().records.map(r=>r.hash),[entry(3).intent.hash,entry(2).intent.hash]);assert.ok(h.get().error);assert.equal(h.get().nextCursor,entry(1).intent.hash);
});
test("original legacy origin and empty account history keep their supported public shapes",async()=>{
  const h=composed([entry(1,LEGACY_RPC_URL)]);await h.ui.refresh();assert.equal(h.get().error,null);assert.equal(h.get().records[0].origin,LEGACY_RPC_URL);
  h.replace([]);await h.ui.refresh();assert.equal(h.get().loaded,true);assert.equal(h.get().error,null);assert.equal(h.get().records.length,0);assert.equal(h.get().nextCursor,null);
});
