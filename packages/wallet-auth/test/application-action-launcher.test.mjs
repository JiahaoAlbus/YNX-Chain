import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletIdentity } from "../src/crypto.js";
import { createSignedApplicationAction } from "../src/application-action.js";
import { createApplicationActionRequest, createApplicationActionReturnURL, parseApplicationActionWalletURL, applicationActionRequestDigest } from "../src/application-action-request.js";
import { createApplicationActionLauncher } from "../src/application-action-launcher.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url)));
const clock = new Date("2026-09-12T11:00:00.000Z");
const secret = "0".repeat(63) + "1";
const account = walletIdentity(secret).account;
const input = { productId:"dex", platform:"web", account, action:"dex_swap_exact_input", payload:{poolId:"dex_ynxt_usdt",assetIn:"YNXT",amountIn:10,minAmountOut:1,deadlineUnix:Math.floor(clock.getTime()/1000)+600}, nonce:1, requestId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",state:"s".repeat(32) };
const request = (delta={}) => createApplicationActionRequest(registry,{...input,...delta},clock);
// Explicit browser test double; real trusted-event behavior is tested separately
// in a browser. These fixtures do not constitute an installed Wallet flow.
class BrowserMouseEvent {
  constructor(delta={}) { Object.assign(this,{type:"click",isTrusted:true,defaultPrevented:false,button:0,currentTarget:{},eventPhase:2},delta); }
  preventDefault() { this.defaultPrevented=true; }
}
const click = (delta={}) => new BrowserMouseEvent(delta);
function fixture(pending=request()) {
  const events = new Map(), documentEvents = new Map(), calls = [];
  const f = { pending, account, now:clock, reads:0, calls };
  const environment = {
    MouseEvent:BrowserMouseEvent,
    location:{origin:"https://dex.ynxweb4.com",assign(url){assert.equal(this,environment.location);calls.push(url);f.onNavigate?.();}},
    navigator:{userActivation:{isActive:true}},
    addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key),
    document:{visibilityState:"visible",addEventListener:(key,fn)=>documentEvents.set(key,fn),removeEventListener:key=>documentEvents.delete(key)},
  };
  const options = {productId:"dex",loadPendingRequest:async()=>{f.reads++;return f.pending;},getActiveAccount:()=>f.account,now:()=>f.now,environment};
  const launcher=createApplicationActionLauncher(registry,options);
  return Object.assign(f,{environment,events,documentEvents,options,launcher,open:(event,digest=applicationActionRequestDigest(f.pending??request()))=>launcher.open(event,digest)});
}
test("prepare reads durable original bytes without launching or declaring installation",async()=>{
  const f=fixture(), original=JSON.stringify(f.pending);
  const target=await f.launcher.prepare();
  assert.equal(target.installation,"unknown");assert.equal(target.automatic,false);assert.equal(f.calls.length,0);
  assert.equal(target.downloadURL,"https://www.ynxweb4.com/dapp/download");
  assert.deepEqual(parseApplicationActionWalletURL(registry,target.walletURL,clock),f.pending);
  assert.equal(JSON.stringify(f.pending),original);
  const result=f.open(click());assert.equal(result.status,"launch-attempted");assert.equal(result.installation,"unknown");
  assert.deepEqual(f.calls,[target.walletURL]);assert.equal(JSON.stringify(f.pending),original);
});
test("no pending request, wrong origin, platform or account cannot yield a launch",async()=>{
  const empty=fixture(null);assert.equal((await empty.launcher.prepare()).status,"no-pending-request");assert.throws(()=>empty.launcher.open(click()));
  for(const change of [f=>f.environment.location.origin="https://evil.example",f=>f.account=walletIdentity("0".repeat(63)+"2").account,f=>f.pending=request({platform:"android"})]){
    const f=fixture();change(f);await assert.rejects(f.launcher.prepare());assert.equal(f.calls.length,0);
  }
});
test("only active trusted unmodified clicks launch",async()=>{
  for(const event of [undefined,{type:"click",isTrusted:true},click({type:"load"}),click({isTrusted:false}),click({defaultPrevented:true}),click({ctrlKey:true}),click({button:1}),click({currentTarget:null}),click({eventPhase:0})]){
    const f=fixture();await f.launcher.prepare();assert.throws(()=>f.open(event));assert.equal(f.calls.length,0);
  }
  const f=fixture();await f.launcher.prepare();f.environment.navigator.userActivation.isActive=false;assert.throws(()=>f.open(click()));assert.equal(f.calls.length,0);
});
test("click rechecks expiry, account and origin after asynchronous preparation",async()=>{
  for(const change of [f=>f.now=new Date(f.pending.expiresAt),f=>f.account="changed",f=>f.environment.location.origin="https://other.example"]){
    const f=fixture();await f.launcher.prepare();change(f);assert.throws(()=>f.open(click()));assert.equal(f.calls.length,0);
  }
});
test("pagehide during navigation does not turn a real dispatch into a false failure",async()=>{
  const f=fixture();await f.launcher.prepare();f.onNavigate=()=>f.events.get("pagehide")();
  assert.equal(f.open(click()).status,"launch-attempted");assert.equal(f.calls.length,1);
  assert.throws(()=>f.open(click()));
});
test("late journal reads cannot restore a cancelled or disposed launch",async()=>{
  const f=fixture();let resolve;
  const launcher=createApplicationActionLauncher(registry,{...f.options,loadPendingRequest:()=>new Promise(r=>resolve=r)});
  const preparing=launcher.prepare();launcher.invalidate();resolve(f.pending);await assert.rejects(preparing);
  launcher.dispose();await assert.rejects(launcher.prepare());assert.throws(()=>launcher.open(click()));assert.equal(f.calls.length,0);
});
test("invalidation after reader resolution but before outer prepare continuation cannot expose ready UI",async()=>{
  const f=fixture();let resolve;
  const launcher=createApplicationActionLauncher(registry,{...f.options,loadPendingRequest:()=>new Promise(r=>resolve=r)});
  const preparing=launcher.prepare();resolve(f.pending);queueMicrotask(()=>launcher.invalidate());
  await assert.rejects(preparing,error=>error.code==="APPLICATION_ACTION_CANCELLED");assert.equal(f.calls.length,0);
});
test("a new saved preparation cannot change the action behind an old review button",async()=>{
  const f=fixture();const original=await f.launcher.prepare();
  f.pending=request({state:"t".repeat(32),payload:{...input.payload,amountIn:12}});await f.launcher.prepare();
  assert.throws(()=>f.open(click(),original.requestDigest),error=>error.code==="BINDING_MISMATCH");
  assert.equal(f.calls.length,0);
});
test("hidden document invalidates only transient UI and keeps saved request",async()=>{
  const f=fixture();await f.launcher.prepare();f.environment.document.visibilityState="hidden";f.documentEvents.get("visibilitychange")();
  assert.throws(()=>f.open(click()));assert.ok(f.pending);assert.equal(f.calls.length,0);
  f.launcher.dispose();assert.equal(f.events.size,0);assert.equal(f.documentEvents.size,0);
});
test("a fresh page instance verifies each of the four signed native action returns without navigation or broadcast",async()=>{
  const cases=[{}, {action:"dex_swap_exact_output",payload:{poolId:input.payload.poolId,assetOut:"usdt",amountOut:4,maxAmountIn:10,deadlineUnix:input.payload.deadlineUnix}}, {action:"dex_liquidity_add",payload:{poolId:input.payload.poolId,amount0:3,amount1:4,minShares:1,deadlineUnix:input.payload.deadlineUnix}}, {action:"dex_liquidity_remove",payload:{poolId:input.payload.poolId,shares:3,minAmount0:0,minAmount1:0,deadlineUnix:input.payload.deadlineUnix}}];
  for(const delta of cases){
    const f=fixture(request(delta));
    const signed=createSignedApplicationAction({accountSecret:secret,action:f.pending.action,payload:f.pending.payload,nonce:f.pending.nonce}).payload;
    const url=createApplicationActionReturnURL(registry,f.pending,{status:"approved",signed},clock);
    const result=await f.launcher.handleReturn(url);
    assert.equal(result.status,"approved");assert.equal(result.signed,signed);assert.equal(f.calls.length,0);assert.ok(f.pending);
  }
});
test("callback validates current durable state and never clears it on a mismatch",async()=>{
  const f=fixture();const original=f.pending;
  const url=createApplicationActionReturnURL(registry,original,{status:"rejected",reason:"USER_REJECTED"},clock);
  f.pending=request({state:"t".repeat(32)});await assert.rejects(f.launcher.handleReturn(url));assert.ok(f.pending);
  f.pending=original;const result=await f.launcher.handleReturn(url);assert.equal(result.status,"rejected");assert.equal(Object.hasOwn(result,"signed"),false);assert.equal(f.calls.length,0);
});
test("tampered signed approval is rejected after reloading original pending request",async()=>{
  const f=fixture();const signed=createSignedApplicationAction({accountSecret:secret,action:f.pending.action,payload:f.pending.payload,nonce:1}).payload;
  const url=createApplicationActionReturnURL(registry,f.pending,{status:"approved",signed},clock);
  const data=JSON.parse(Buffer.from(new URL(url).searchParams.get("applicationActionResult"),"base64url"));
  data.signed=data.signed.replace('"amountIn":10','"amountIn":11');
  const bad=f.pending.callback+"?applicationActionResult="+Buffer.from(JSON.stringify(data)).toString("base64url");
  await assert.rejects(f.launcher.handleReturn(bad));assert.equal(f.calls.length,0);assert.ok(f.pending);
});
