import assert from "node:assert/strict";
import test from "node:test";
import { createCardApplicationApprovalRequest, encodeCardApplicationApprovalWalletURL, parseCardApplicationApprovalReturnURL, cardApplicationDetailsHash, walletIdentity } from "@ynx-chain/wallet-auth";
import { CardApplicationApprovalController, CARD_APPLICATION_APPROVAL_REPLAY_KEY } from "./cardApplicationApprovalController";
import { PRODUCT_SESSION_REGISTRY as registry } from "./registry";
import { createProductSessionKeyAccess } from "../security/productSessionKeyAccess";
import { WalletOperationLifecycle } from "../security/operationLifecycle";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";

const NOW = Date.parse("2026-09-12T10:00:00.000Z");
const SECRET = "0".repeat(63) + "1", OTHER = "0".repeat(63) + "2";
const account: WalletAccount = {...walletIdentity(SECRET),label:"Synthetic account",backupConfirmed:true,createdAt:new Date(NOW).toISOString()};
const other: WalletAccount = {...walletIdentity(OTHER),label:"Other synthetic",backupConfirmed:true,createdAt:new Date(NOW).toISOString()};
const details = { nickname: "Travel card", useCase: "Testnet travel spending", limitWei: "10000000000000000000", riskAccepted: true as const, termsVersion: "card-testnet-v1" as const };
const challenge = { id: "challenge_11111111-1111-4111-8111-111111111111", applicationId: "application_22222222-2222-4222-8222-222222222222", owner: account.account, chainId: "0x1917" as const, purpose: "create-testnet-card" as const, payloadHash: cardApplicationDetailsHash(details), nonce: "33333333-3333-4333-8333-333333333333", issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW+300000).toISOString() };
const base: Parameters<typeof createCardApplicationApprovalRequest>[1] = { productId:"card",platform:"android",account:account.account,challenge,details,requestId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",state:"s".repeat(32) };
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
function fixture(values=new Map<string,string>()) {
  const state={now:NOW,selected:account as WalletAccount|null,secret:SECRET,keys:0,checks:0,failOS:false,failOpen:false,opens:[] as string[],writes:[] as string[],beforeGet:null as null|(()=>Promise<void>),beforeSet:null as null|((value:string)=>Promise<void>),afterSet:null as null|((value:string)=>Promise<void>),keyGate:null as ReturnType<typeof deferred>|null,keyStarted:deferred(),dropWrite:false};
  const storage: SecureStorageAdapter={
    async getItem(key){assert.equal(key,CARD_APPLICATION_APPROVAL_REPLAY_KEY);await state.beforeGet?.();return values.get(key)??null;},
    async setItem(key,value){assert.equal(key,CARD_APPLICATION_APPROVAL_REPLAY_KEY);await state.beforeSet?.(value);state.writes.push(value);if(!state.dropWrite)values.set(key,value);await state.afterSet?.(value);},
    async deleteItem(){throw new Error("Controller must not delete protected data");},
  };
  const operations=new WalletOperationLifecycle(()=>state.now);operations.setAccount(account.account);
  const withAccountSecret=createProductSessionKeyAccess({operations,repository:{async accountSecret(id,guard){assert.equal(id,account.account);state.keys++;state.keyStarted.resolve();await state.keyGate?.promise;guard?.();return state.secret;}},checkBiometrics:async guard=>{guard();state.checks++;if(state.failOS)throw new Error("OS user cancellation");},authorizeLegacyMigration:async()=>{throw new Error("No legacy key in this model");}});
  const controller=()=>new CardApplicationApprovalController({platform:"android",storage,selectedAccount:()=>state.selected,withAccountSecret,now:()=>new Date(state.now),openURL:async url=>{state.opens.push(url);if(state.failOpen)throw new Error("Callback unavailable");}});
  const make=(change:Partial<Parameters<typeof createCardApplicationApprovalRequest>[1]>={})=>createCardApplicationApprovalRequest(registry,{...base,...change},new Date(state.now));
  const url=(request=make())=>encodeCardApplicationApprovalWalletURL(registry,request,new Date(state.now));
  return{state,values,storage,operations,controller,make,url};
}
const fresh={requestId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",state:"t".repeat(32)};

test("actual signer + key-access lease: explicit approve persists consumption before signed result and returns no broadcast",async()=>{
  const f=fixture(),c=f.controller(),request=f.make(),r=await c.receive(f.url(request));
  assert.equal(f.state.keys,0);assert.equal(f.state.checks,0);assert.equal(c.current,r);assert.equal(c.hasReturn(r.id),false);
  assert.deepEqual(r.request.challenge,challenge);assert.deepEqual(r.request.details,details);
  await c.approve(r.id);
  assert.equal(f.state.keys,1);assert.equal(f.state.checks,1);assert.equal(f.state.opens.length,1);assert.equal(c.current,null);
  const writes=f.state.writes.map(raw=>JSON.parse(raw).records[0]);
  assert.deepEqual(writes.map(row=>row.status),["consumed","approved"]);assert.equal(writes[0].returnURL,null);
  const result=parseCardApplicationApprovalReturnURL(registry,f.state.opens[0]!,request,new Date(f.state.now));
  assert.equal(result.status,"approved");assert.equal(result.requestDigest,r.id);
  if (result.status !== "approved") assert.fail("Expected signed approval");
  assert.deepEqual(result.approval.details,details);assert.deepEqual(result.approval.challenge,challenge);assert.equal(result.approval.account,account.account);assert.equal(result.approval.accountPublicKey,account.accountPublicKey);
  assert.equal(f.state.writes.some(raw=>raw.includes(SECRET)),false);
});

test("confirmed reject consumes correlation but releases nonce for an explicitly fresh request",async()=>{
  const f=fixture(),c=f.controller(),a=await c.receive(f.url());await c.reject(a.id);
  assert.equal(f.state.keys,0);assert.equal(f.state.checks,0);
  const request=f.make(fresh),b=await c.receive(f.url(request));await c.approve(b.id);
  assert.equal(f.state.keys,1);assert.equal(parseCardApplicationApprovalReturnURL(registry,f.state.opens[1]!,request,new Date(NOW)).status,"approved");
  const replay=f.controller(),old=await replay.receive(f.url());assert.equal(replay.hasReturn(old.id),true);
  await assert.rejects(replay.approve(old.id),/consumed/);await assert.rejects(replay.reject(old.id),/consumed/);
  await replay.retryReturn(old.id);assert.equal(f.state.opens[2],f.state.opens[0]);
});

test("approved and uncertain consumed records reserve the Card challenge nonce",async()=>{
  for(const consumedOnly of [false,true]){
    const f=fixture(),c=f.controller(),r=await c.receive(f.url());
    if(consumedOnly){f.state.afterSet=async raw=>{if(JSON.parse(raw).records[0].status==="consumed")c.cancel();};await assert.rejects(c.approve(r.id),/cancelled/);}else await c.approve(r.id);
    await assert.rejects(f.controller().receive(f.url(f.make(fresh))),/consumed/);
    if(consumedOnly){await assert.rejects(f.controller().receive(f.url()),/consumed/);assert.equal(f.state.opens.length,0);assert.equal(JSON.parse(f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!).records[0].returnURL,null);}
  }
});

test("failed approved callback retries only original durable URL, including a new controller",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());f.state.failOpen=true;
  await assert.rejects(c.approve(r.id),/Callback/);assert.equal(c.hasReturn(r.id),true);
  await assert.rejects(c.approve(r.id),/consumed/);await assert.rejects(c.reject(r.id),/consumed/);
  c.cancel();const next=f.controller(),restored=await next.receive(f.url());assert.equal(next.hasReturn(restored.id),true);
  f.state.failOpen=false;await next.retryReturn(restored.id);
  assert.equal(f.state.opens[0],f.state.opens[1]);assert.equal(f.state.keys,1);assert.equal(f.state.writes.length,2);
});

test("failed rejection callback survives restart without any key access",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());f.state.failOpen=true;await assert.rejects(c.reject(r.id),/Callback/);
  const next=f.controller(),restored=await next.receive(f.url());f.state.failOpen=false;await next.retryReturn(restored.id);
  assert.equal(f.state.opens[0],f.state.opens[1]);assert.equal(f.state.keys,0);assert.equal(f.state.checks,0);
});

test("selected account, backup and decrypted public-key identity must all match review",async()=>{
  const f=fixture();f.state.selected=other;await assert.rejects(f.controller().receive(f.url()),/exact account/);
  f.state.selected=null;await assert.rejects(f.controller().receive(f.url()),/exact account/);
  f.state.selected={...account,backupConfirmed:false};const c=f.controller(),r=await c.receive(f.url());await assert.rejects(c.approve(r.id),/backup/);assert.equal(f.state.keys,0);await c.reject(r.id);
  const wrong=fixture();wrong.state.secret=OTHER;const wc=wrong.controller(),wr=await wc.receive(wrong.url());await assert.rejects(wc.approve(wr.id),/Stored signing account/);assert.equal(wrong.state.writes.length,0);assert.equal(wrong.state.opens.length,0);
});

test("OS cancellation remains retryable before consumption; no automatic reauthorization",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());f.state.failOS=true;
  await assert.rejects(c.approve(r.id),/OS user/);assert.equal(f.state.keys,0);assert.equal(f.state.writes.length,0);assert.equal(c.current,r);
  f.state.failOS=false;await c.approve(r.id);assert.equal(f.state.keys,1);assert.equal(f.state.checks,2);
});

for(const change of ["close","lock","background","account","expiry"] as const)test(`late native key read after ${change} cannot sign or return`,async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());f.state.keyGate=deferred();
  const pending=c.approve(r.id);await f.state.keyStarted.promise;
  if(change==="close")c.cancel();
  if(change==="lock")f.operations.lock();
  if(change==="background")f.operations.setAppState("background");
  if(change==="account"){f.state.selected=other;f.operations.setAccount(other.account);}
  if(change==="expiry")f.state.now+=300000;
  f.state.keyGate.resolve();await assert.rejects(pending);assert.equal(f.state.writes.length,0);assert.equal(f.state.opens.length,0);
});

test("lock after durable consumption preserves unknown record and prevents signing",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());
  f.state.afterSet=async raw=>{if(JSON.parse(raw).records[0].status==="consumed")f.operations.lock();};
  await assert.rejects(c.approve(r.id));assert.equal(f.state.writes.length,1);assert.equal(f.state.opens.length,0);
  assert.equal(JSON.parse(f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!).records[0].status,"consumed");
});

test("late receive storage read after close cannot publish stale review",async()=>{
  const f=fixture(),c=f.controller(),started=deferred(),gate=deferred();f.state.beforeGet=async()=>{started.resolve();await gate.promise;};
  const promise=c.receive(f.url());await started.promise;c.cancel();gate.resolve();await assert.rejects(promise,/cancelled/);assert.equal(c.current,null);assert.equal(f.state.keys,0);
});

test("single flight, duplicate pending and adapter-shared queues prevent two signatures",async()=>{
  const f=fixture(),a=f.controller(),b=f.controller(),url=f.url(),ar=await a.receive(url),br=await b.receive(url);
  assert.equal(await a.receive(url),ar);await assert.rejects(a.receive(f.url(f.make(fresh))),/Finish/);
  f.state.keyGate=deferred();const ap=a.approve(ar.id);await f.state.keyStarted.promise;await assert.rejects(a.reject(ar.id),/progress/);
  const bp=b.approve(br.id);f.state.keyGate.resolve();const results=await Promise.allSettled([ap,bp]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.state.opens.length,1);assert.equal(f.state.writes.length,2);
});

test("resolved-drop or cache-then-reject consume write blocks all further signing on this adapter",async()=>{
  for(const model of ["drop","cache-reject"]){
    const f=fixture(),c=f.controller(),r=await c.receive(f.url());
    if(model==="drop")f.state.dropWrite=true;else f.state.afterSet=async()=>{throw new Error("Synthetic disk failure after cache write");};
    await assert.rejects(c.approve(r.id));assert.equal(f.state.opens.length,0);assert.equal(c.hasReturn(r.id),false);
    f.state.dropWrite=false;f.state.afterSet=null;
    await assert.rejects(c.approve(r.id),/uncertain/);await assert.rejects(f.controller().receive(f.url()),/uncertain/);assert.equal(f.state.keys,1);
    if(model==="cache-reject"){const restarted=fixture(f.values);await assert.rejects(restarted.controller().receive(restarted.url()),/consumed/);}
  }
});

test("signed-result write failure retains consumed record and never opens an unstored result",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());
  f.state.beforeSet=async raw=>{if(JSON.parse(raw).records[0].status==="approved")throw new Error("Result disk failure");};
  await assert.rejects(c.approve(r.id),/Result disk/);assert.equal(f.state.opens.length,0);assert.equal(c.hasReturn(r.id),false);
  const restart=fixture(f.values);await assert.rejects(restart.controller().receive(restart.url()),/consumed/);
});

test("durable return tamper, invalid schema and read errors fail closed before key access",async()=>{
  for(const raw of ["broken",JSON.stringify({schemaVersion:1,records:[],extra:true}),JSON.stringify({schemaVersion:1,records:[{}]})]){
    const f=fixture(new Map([[CARD_APPLICATION_APPROVAL_REPLAY_KEY,raw]]));await assert.rejects(f.controller().receive(f.url()));assert.equal(f.state.keys,0);
  }
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());f.state.failOpen=true;await assert.rejects(c.approve(r.id));
  const row=JSON.parse(f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!);row.records[0].request.challenge.nonce="44444444-4444-4444-8444-444444444444";f.values.set(CARD_APPLICATION_APPROVAL_REPLAY_KEY,JSON.stringify(row));await assert.rejects(c.retryReturn(r.id));assert.equal(f.state.opens.length,1);
  const read=fixture();read.state.beforeGet=async()=>{throw new Error("Storage inaccessible");};await assert.rejects(read.controller().receive(read.url()),/inaccessible/);assert.equal(read.state.keys,0);
});

test("reused requestId/state and foreign platform cannot reach key access",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());await c.reject(r.id);
  for(const delta of [{...fresh,state:base.state},{...fresh,requestId:base.requestId}])await assert.rejects(f.controller().receive(f.url(f.make(delta))),/consumed/);
  await assert.rejects(f.controller().receive(f.url(f.make({platform:"ios"}))),/platform/);
  assert.equal(f.state.keys,0);
});

test("return delivery rereads durable record and cannot cross an account/expiry cancellation",async()=>{
  for(const mode of ["account","expiry","close"]){
    const f=fixture(),c=f.controller(),r=await c.receive(f.url());f.state.failOpen=true;await assert.rejects(c.approve(r.id));f.state.failOpen=false;
    if(mode==="account")f.state.selected=other;if(mode==="expiry")f.state.now+=300000;if(mode==="close")c.cancel();
    await assert.rejects(c.retryReturn(r.id));assert.equal(f.state.opens.length,1);assert.equal(f.state.keys,1);
  }
});

test("selected account is snapshotted before receive's first storage await",async()=>{
  const f=fixture(),c=f.controller(),started=deferred(),gate=deferred();
  const mutable={...account};f.state.selected=mutable;
  f.state.beforeGet=async()=>{started.resolve();await gate.promise;};
  const p=c.receive(f.url());await started.promise;Object.assign(mutable,other);gate.resolve();
  await assert.rejects(p,/account changed/);assert.equal(c.current,null);assert.equal(f.state.keys,0);
});

test("a failed signed-result readback may recover only its exact already written result in a fresh process model",async()=>{
  const f=fixture(),c=f.controller(),r=await c.receive(f.url());
  f.state.afterSet=async raw=>{if(JSON.parse(raw).records[0].status==="approved")throw new Error("Uncertain result write after cache");};
  await assert.rejects(c.approve(r.id));assert.equal(f.state.opens.length,0);
  const restart=fixture(f.values),next=restart.controller(),old=await next.receive(restart.url());
  await assert.rejects(next.approve(old.id),/consumed/);await next.retryReturn(old.id);
  assert.equal(restart.state.keys,0);assert.equal(restart.state.writes.length,0);assert.equal(restart.state.opens.length,1);
});

test("approval after review issuance reloads using its verified proof time and returns the exact original URL",async()=>{
  const f=fixture(),c=f.controller(),request=f.make(),r=await c.receive(f.url(request));
  f.state.now+=45000;f.state.failOpen=true;await assert.rejects(c.approve(r.id),/Callback/);
  const saved=JSON.parse(f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!).records[0];
  assert.equal(saved.approval.issuedAt,new Date(NOW+45000).toISOString());
  assert.notEqual(saved.approval.issuedAt,request.issuedAt);
  const restarted=fixture(f.values);restarted.state.now=NOW+60000;
  const next=restarted.controller(),review=await next.receive(restarted.url(request));
  await next.retryReturn(review.id);
  assert.equal(restarted.state.opens[0],saved.returnURL);assert.equal(restarted.state.keys,0);
  assert.equal(restarted.state.writes.length,0);
});

for(const status of ["approved","consumed"] as const)test(`short request expiry does not release an unexpired ${status} Card challenge`,async()=>{
  const f=fixture(),c=f.controller();
  const short={...f.make(),expiresAt:new Date(NOW+60000).toISOString()};
  const shortURL=f.url(short),review=await c.receive(shortURL);
  if(status==="consumed"){
    f.state.afterSet=async raw=>{if(JSON.parse(raw).records[0].status==="consumed")c.cancel();};
    await assert.rejects(c.approve(review.id),/cancelled/);
  }else await c.approve(review.id);
  f.state.now=NOW+61000;
  await assert.rejects(f.controller().receive(shortURL),/current|expired/i);
  const newRequest=f.make(fresh);
  await assert.rejects(f.controller().receive(f.url(newRequest)),/consumed/);
  assert.equal(f.state.keys,1);
  assert.equal(JSON.parse(f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!).records[0].status,status);
});

test("rejection of a short request still allows explicit approval of the same unexpired challenge",async()=>{
  const f=fixture(),c=f.controller();
  const short={...f.make(),expiresAt:new Date(NOW+60000).toISOString()};
  await c.reject((await c.receive(f.url(short))).id);
  f.state.now=NOW+61000;
  const request=f.make(fresh),review=await c.receive(f.url(request));await c.approve(review.id);
  assert.equal(f.state.keys,1);
  assert.equal(parseCardApplicationApprovalReturnURL(registry,f.state.opens[1]!,request,new Date(f.state.now)).status,"approved");
});

test("both consumed challenge id and nonce remain reserved across altered fresh request correlation",async()=>{
  const f=fixture(),c=f.controller();await c.approve((await c.receive(f.url())).id);
  for(const delta of [{nonce:"44444444-4444-4444-8444-444444444444"},{id:"challenge_44444444-4444-4444-8444-444444444444"}]){
    const request=f.make({...fresh,challenge:{...challenge,...delta}});
    await assert.rejects(f.controller().receive(f.url(request)),/consumed/);
  }
  assert.equal(f.state.keys,1);
});

test("historical persisted proof must still match signature and the exact encoded return",async()=>{
  const f=fixture(),c=f.controller();f.state.now+=10000;
  const request=f.make(),review=await c.receive(f.url(request));f.state.failOpen=true;await assert.rejects(c.approve(review.id));
  const original=f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!;
  for(const change of ["signature","details","issuedAt"]){
    const data=JSON.parse(original),row=data.records[0];
    if(change==="signature")row.approval.signature="0".repeat(128);
    if(change==="details")row.approval.details.nickname="Changed";
    if(change==="issuedAt")row.approval.issuedAt=new Date(NOW+11000).toISOString();
    const restarted=fixture(new Map([[CARD_APPLICATION_APPROVAL_REPLAY_KEY,JSON.stringify(data)]]));restarted.state.now=NOW+20000;
    await assert.rejects(restarted.controller().receive(restarted.url(request)));
    assert.equal(restarted.state.keys,0);assert.equal(restarted.state.opens.length,0);assert.equal(restarted.state.writes.length,0);
  }
});

test("128 distinct rejected correlations fill the bounded journal without authorizing a further key access",async()=>{
  const f=fixture(),c=f.controller();
  for(let i=0;i<128;i++){
    const suffix=i.toString(16).padStart(12,"0");
    const request=f.make({requestId:`aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,state:`${"s".repeat(32)}${suffix}`});
    await c.reject((await c.receive(f.url(request))).id);
  }
  const bytes=f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY)!;
  assert.equal(JSON.parse(bytes).records.length,128);
  const next=await c.receive(f.url(f.make(fresh)));
  await assert.rejects(c.approve(next.id),/full/);
  assert.equal(f.state.keys,0);assert.equal(f.state.checks,0);
  assert.equal(f.values.get(CARD_APPLICATION_APPROVAL_REPLAY_KEY),bytes);
});
