import assert from "node:assert/strict";
import test from "node:test";
import { evmAddressFromYNX, walletIdentity } from "@ynx-chain/wallet-auth";
import { DAPP_BROWSER_STATE_KEY, PersistentDappBrowserController } from "./persistentDappBrowserController";
import type { DappBrowserResponse } from "./dappBrowserController";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const NOW=new Date("2026-08-22T06:00:00.000Z"),SECRET=`${"00".repeat(31)}01`,identity=walletIdentity(SECRET),account=evmAddressFromYNX(identity.account).toLowerCase(),origin="https://dapp.example";
const message=(id:number,method:string,params:unknown[]=[])=>JSON.stringify({jsonrpc:"2.0",id,method,params});

class Memory implements SecureStorageAdapter{
  values=new Map<string,string>();events:string[]=[];failSet=false;
  async getItem(key:string){this.events.push(`get:${key}`);return this.values.get(key)??null}
  async setItem(key:string,value:string){this.events.push(`set:${key}`);if(this.failSet){this.failSet=false;throw new Error("storage failed")}this.values.set(key,value)}
  async deleteItem(key:string){this.events.push(`delete:${key}`);this.values.delete(key)}
}
function setup(storage=new Memory()){const responses:DappBrowserResponse[]=[],events:Array<readonly [string,unknown]>=[],controller=new PersistentDappBrowserController({respond:value=>{storage.events.push("respond");responses.push(value)},emit:(name,data)=>{storage.events.push(`emit:${name}`);events.push([name,data])}},storage,()=>NOW);return{storage,responses,events,controller}}
async function restoreAndConnect(value=setup()){await value.controller.restore(identity.account,origin);await value.controller.receive(origin,"External DApp",message(1,"eth_requestAccounts"));await value.controller.approveConnection(identity.account,origin);return value}
function state(storage:Memory){const raw=storage.values.get(DAPP_BROWSER_STATE_KEY);assert.ok(raw);return JSON.parse(raw)}

test("connection approval persists before response and restores the exact origin-bound session",async()=>{
  const first=setup();await first.controller.restore(identity.account,origin);await first.controller.receive(origin,"External DApp",message(1,"eth_requestAccounts"));assert.equal(state(first.storage).pending.kind,"connection");
  const second=setup(first.storage);const restored=await second.controller.restore(identity.account,"https://fallback.example");assert.equal(restored.activeOrigin,origin);assert.equal(second.controller.pendingConnection()?.id,1);assert.equal(second.controller.canApprovePending(),false);await assert.rejects(second.controller.approveConnection(identity.account,origin),/exact request replay/);await assert.rejects(second.controller.receive(origin,"Wrong DApp",message(1,"eth_requestAccounts")),/differs/);await second.controller.receive(origin,"External DApp",message(1,"eth_requestAccounts"));assert.equal(second.controller.canApprovePending(),true);
  await second.controller.approveConnection(identity.account,origin);assert.equal(state(first.storage).pending,null);assert.equal(state(first.storage).sessions[0].account,account);assert.deepEqual(second.responses,[{id:1,jsonrpc:"2.0",result:[account]}]);
  assert.ok(first.storage.events.lastIndexOf(`set:${DAPP_BROWSER_STATE_KEY}`)<first.storage.events.lastIndexOf("respond"));
});

test("pending signing request survives process reconstruction and remains single",async()=>{
  const first=await restoreAndConnect();await first.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));assert.equal(state(first.storage).pending.kind,"request");
  const second=setup(first.storage);const restored=await second.controller.restore(identity.account,origin);assert.equal(restored.restoredPending,true);assert.equal(second.controller.pendingRequest()?.method,"personal_sign");assert.equal(second.controller.canApprovePending(),false);await assert.rejects(second.controller.receive(origin,"External DApp",message(4,"personal_sign",["0x00",account])),/differs/);await second.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));assert.equal(second.controller.canApprovePending(),true);
  const raced=await Promise.allSettled([second.controller.receive(origin,"External DApp",message(3,"eth_chainId")),second.controller.receive(origin,"External DApp",message(4,"personal_sign",["0x00",account]))]);assert.equal(raced[0].status,"rejected");assert.equal(raced[1].status,"rejected");assert.equal(second.controller.pendingRequest()?.requestId,"n:2");
});

test("approval writes an executing tombstone before key use and never replays a failed attempt",async()=>{
  const value=await restoreAndConnect();await value.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));let sawExecuting=false;
  await assert.rejects(value.controller.approveRequest(origin,{authorize:async()=>{sawExecuting=state(value.storage).pending.kind==="executing";throw new Error("biometric cancelled")},readAccountSecret:async()=>SECRET,assertActive:()=>{},broadcastSignedTransaction:async()=>{throw new Error("not used")},now:()=>NOW}),/biometric cancelled/);
  assert.equal(sawExecuting,true);assert.equal(state(value.storage).pending,null);assert.equal(value.responses.at(-1)?.error?.code,4001);
  const restarted=setup(value.storage);const restored=await restarted.controller.restore(identity.account,origin);assert.equal(restored.restoredPending,false);assert.equal(restarted.controller.pendingRequest(),null);
});

test("process death with an executing tombstone discards it without signing or callback replay",async()=>{
  const first=await restoreAndConnect();await first.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));const stored=state(first.storage);stored.pending.kind="executing";first.storage.values.set(DAPP_BROWSER_STATE_KEY,JSON.stringify(stored));
  const second=setup(first.storage),restored=await second.controller.restore(identity.account,origin);assert.equal(restored.restoredPending,false);assert.equal(second.controller.pendingRequest(),null);assert.equal(state(first.storage).pending,null);assert.equal(second.responses.length,0);
});

test("successful signing and transaction broadcast clear durable pending state before the exact response",async()=>{
  const value=await restoreAndConnect();await value.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));await value.controller.approveRequest(origin,{authorize:async()=>{},readAccountSecret:async()=>SECRET,assertActive:()=>{},broadcastSignedTransaction:async()=>{throw new Error("not used")},now:()=>NOW});assert.match(String(value.responses.at(-1)?.result),/^0x[0-9a-f]{130}$/);assert.equal(state(value.storage).pending,null);
  const tx={from:account,to:"0x3333333333333333333333333333333333333333",chainId:"0x1917",nonce:"0x0",gas:"0x5208",maxFeePerGas:"0x3b9aca00",maxPriorityFeePerGas:"0x3b9aca00",value:"0x0",data:"0x",type:"0x2"};let broadcasts=0;await value.controller.receive(origin,"External DApp",message(3,"eth_sendTransaction",[tx]));await value.controller.approveRequest(origin,{authorize:async()=>{},readAccountSecret:async()=>SECRET,assertActive:()=>{},broadcastSignedTransaction:async()=>{broadcasts++;return`0x${"ab".repeat(32)}`},now:()=>NOW});assert.equal(broadcasts,1);assert.equal(value.responses.at(-1)?.result,`0x${"ab".repeat(32)}`);assert.equal(state(value.storage).pending,null);
  const restarted=setup(value.storage);assert.equal((await restarted.controller.restore(identity.account,origin)).restoredPending,false);assert.equal(restarted.controller.pendingRequest(),null);
});

test("account drift, tamper, origin drift and expired pending state all fail closed",async()=>{
  const drift=await restoreAndConnect();const other=walletIdentity(`${"00".repeat(31)}02`).account;const next=setup(drift.storage);await next.controller.restore(other,origin);assert.equal(drift.storage.values.has(DAPP_BROWSER_STATE_KEY),false);assert.equal(next.controller.activeOrigins().length,0);
  const tampered=await restoreAndConnect();const widened=state(tampered.storage);widened.extra=true;tampered.storage.values.set(DAPP_BROWSER_STATE_KEY,JSON.stringify(widened));await assert.rejects(setup(tampered.storage).controller.restore(identity.account,origin),/failed verification/);assert.equal(tampered.storage.values.has(DAPP_BROWSER_STATE_KEY),false);
  const originDrift=await restoreAndConnect();await originDrift.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));const wrong=state(originDrift.storage);wrong.activeOrigin="https://other.example";originDrift.storage.values.set(DAPP_BROWSER_STATE_KEY,JSON.stringify(wrong));await assert.rejects(setup(originDrift.storage).controller.restore(identity.account,origin));assert.equal(originDrift.storage.values.has(DAPP_BROWSER_STATE_KEY),false);
  const expired=setup();await expired.controller.restore(identity.account,origin);await expired.controller.receive(origin,"External DApp",message(1,"eth_requestAccounts"));const old=state(expired.storage);old.pending.value.issuedAt="2026-08-22T05:54:59.000Z";old.pending.value.expiresAt="2026-08-22T05:59:59.000Z";expired.storage.values.set(DAPP_BROWSER_STATE_KEY,JSON.stringify(old));const recovered=setup(expired.storage);assert.equal((await recovered.controller.restore(identity.account,origin)).restoredPending,false);assert.equal(state(expired.storage).pending,null);
});

test("navigation cancellation and disconnect persist before rejection and account revocation events",async()=>{
  const value=await restoreAndConnect();await value.controller.receive(origin,"External DApp",message(2,"personal_sign",["0x6869",account]));await value.controller.navigated("https://other.example");assert.equal(value.responses.at(-1)?.error?.code,4001);assert.equal(state(value.storage).activeOrigin,"https://other.example");assert.equal(state(value.storage).pending,null);
  await value.controller.navigated(origin);await value.controller.disconnect(origin);assert.equal(state(value.storage).sessions.length,0);assert.deepEqual(value.events.at(-1),["accountsChanged",[]]);
});

test("secure persistence failure emits no approval response and poisons further use",async()=>{
  const value=setup();await value.controller.restore(identity.account,origin);value.storage.failSet=true;await assert.rejects(value.controller.receive(origin,"External DApp",message(1,"eth_requestAccounts")),/storage failed/);assert.equal(value.responses.length,0);await assert.rejects(value.controller.receive(origin,"External DApp",message(2,"eth_requestAccounts")),/persistence failed/);
});
