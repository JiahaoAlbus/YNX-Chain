import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { canonicalJSON } from "../src/canonical.js";
import { walletIdentity } from "../src/crypto.js";
import { WalletSessionControlClient } from "../src/wallet-session-control-client.js";
import { ProductSessionGatewayKernel } from "../src/product-session-gateway.js";
import { ProductSessionControlNodeHost } from "../src/product-session-control-node-host.js";
import { initializeProductSessionControlState } from "../src/product-session-control-node-store.js";
import { migrateProductSessionControlSnapshotV2 } from "../src/product-session-control-intent.js";
import { WALLET_SESSION_CONTROL_AUDIENCE, WALLET_SESSION_CONTROL_INTENT_PATHS, decodeWalletSessionControlProofHeader, WALLET_SESSION_CONTROL_PROOF_HEADER } from "../src/wallet-session-control.js";
import { walletSessionControlOutboxKey, createWalletSessionControlOutbox, prepareWalletSessionControlOutbox } from "../src/wallet-session-control-outbox.js";

const SECRET = "1".padStart(64, "0"), OTHER_SECRET = "2".padStart(64, "0"); // synthetic public test keys only
const SCOPE = { authority: WALLET_SESSION_CONTROL_AUDIENCE, chainId: "ynx_6423-1", account: walletIdentity(SECRET).account };
const OTHER = { ...SCOPE, account: walletIdentity(OTHER_SECRET).account };
const NOW = Date.parse("2026-09-06T12:30:00.000Z");
const registry = JSON.parse(fs.readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const token = label => createHash("sha256").update(label).digest("base64url");
const copy = value => JSON.parse(canonicalJSON(value));
const key = scope => walletSessionControlOutboxKey(scope).replaceAll(":", ".");
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

// Real temporary encrypted files behind the same getItem/setItem interface as
// Native SecureStorageAdapter. These local fixture keys never represent users.
class EncryptedFixtureStore {
  constructor(directory) { this.directory=directory; this.key=randomBytes(32); this.writes=0; this.reads=0; this.failWrite=0; this.afterWrite=false; this.readbackFailure=false; this.hook=null; }
  path(name) { assert.match(name,/^[A-Za-z0-9._-]+$/); return join(this.directory,`${name}.bin`); }
  async getItem(name) {
    this.reads++;
    if (this.readbackFailure) { this.readbackFailure=false; throw new Error("readback unavailable"); }
    let raw; try { raw=fs.readFileSync(this.path(name)); } catch(e) { if(e.code==='ENOENT') return null; throw e; }
    const decipher=createDecipheriv('aes-256-gcm',this.key,raw.subarray(0,12)); decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(raw.subarray(12,28));
    return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8');
  }
  async setItem(name,text) {
    this.writes++; if(this.writes===this.failWrite&&!this.afterWrite) throw new Error('write failed');
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(Buffer.from(name));
    const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]),bytes=Buffer.concat([nonce,cipher.getAuthTag(),body]);
    const file=this.path(name),temporary=`${file}.tmp`;
    const fd=fs.openSync(temporary,'w',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(temporary,file);
    const dir=fs.openSync(this.directory,'r');fs.fsyncSync(dir);fs.closeSync(dir);
    if(this.hook) await this.hook({name,text,writes:this.writes});
    if(this.writes===this.failWrite) throw new Error('write ACK lost');
  }
}

async function fixture(t, options={}) {
  const dir=fs.mkdtempSync(join(tmpdir(),'ynx-owner-client-'));fs.chmodSync(dir,0o700);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const statePath=join(dir,'authority.json');
  initializeProductSessionControlState(statePath,migrateProductSessionControlSnapshotV2(new ProductSessionGatewayKernel(registry,()=>token('empty')).snapshot()));
  const f={dir,store:new EncryptedFixtureStore(dir),offset:0,mono:1000,authCalls:0,requests:[],postCalls:0,locked:false,lose:false,mutate:null,delay:null,authHook:null};
  let sequence=0,host=new ProductSessionControlNodeHost(registry,{statePath,now:()=>new Date(NOW+f.offset),tokenFactory:()=>token(`server-${++sequence}`)});
  const server=createServer((req,res)=>{
    const end=res.end.bind(res);
    res.end=(...args)=>{
      if(req.method==='POST'&&f.lose){res.destroy();return res;}
      if(req.method==='POST'&&f.holdResponse){f.responseCommitted?.resolve();void f.holdResponse.promise.then(()=>end(...args));return res;}
      return end(...args);
    };
    void host.handler()(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const loopback=`http://127.0.0.1:${server.address().port}`;
  // Test-only transport maps the pinned origin to this real loopback HTTP host.
  // Production TLS trust is not asserted by this mapper; production receives the
  // platform Fetch capability, while all client identity checks still run here.
  f.fetch=async(url,init)=>{
    assert.equal(new URL(url).origin,SCOPE.authority);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.mode,'cors');
    const record={url,method:init.method,headers:{...init.headers},body:init.body??null}; f.requests.push(record);
    if(init.method==='POST'){f.postCalls++;if(f.delay)await f.delay(record);}
    if(options.offline||f.offline)throw new Error('fixture offline');
    let response=await fetch(loopback+new URL(url).pathname,init);
    const overrides={url,redirected:false};
    if(f.mutate) response=await f.mutate(response,record,overrides)??response;
    return new Proxy(response,{get(target,property){if(Object.hasOwn(overrides,property))return overrides[property];const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
  };
  f.authorize=async(scope,purpose,use)=>{
    f.authCalls++; if(f.authHook)await f.authHook(scope,purpose);
    const secret=scope.account===OTHER.account?OTHER_SECRET:SECRET;
    return use({accountSecret:f.wrongOwner?OTHER_SECRET:secret,assertCurrent:()=>{if(f.locked)throw Object.assign(new Error('owner locked'),{code:'OWNER_LOCKED'});}});
  };
  f.client=()=>new WalletSessionControlClient({storage:f.store,withOwner:f.authorize,fetchImpl:f.fetch,monotonicNow:()=>f.mono,...options.client});
  f.host=()=>host; f.restartServer=()=>{host=new ProductSessionControlNodeHost(registry,{statePath,now:()=>new Date(NOW+f.offset),tokenFactory:()=>token(`restart-${++sequence}`)});};
  f.envelope=async(scope=SCOPE)=>JSON.parse(await f.store.getItem(key(scope)));
  return f;
}

test('real HTTP + encrypted file adapter resolves and reloads original receipt, then allows a new intent',async t=>{
  const f=await fixture(t),client=f.client();
  const result=await client.begin(SCOPE,{operation:'account-logout'});
  assert.equal(result.status,'confirmed');assert.equal(result.revocationConfirmed,true);assert.equal(f.postCalls,1);
  const stored=await f.envelope();assert.equal(stored.active,null);assert.equal(stored.history.length,1);
  assert.equal(stored.history[0].record.outbox.records[0].bodyText,f.requests.find(x=>x.method==='POST').body);
  assert.ok(!JSON.stringify(stored).includes('accountSecret'));
  const restarted=f.client(),calls=f.authCalls;
  assert.deepEqual(await restarted.retry(SCOPE,result.intentId),result);assert.equal(f.authCalls,calls);assert.equal(f.postCalls,1);
  f.offset=1;const next=await restarted.begin(SCOPE,{operation:'account-logout'});
  assert.notEqual(next.intentId,result.intentId);assert.equal(next.receipt.cutoff,new Date(NOW+1).toISOString());
  assert.deepEqual(await restarted.retry(SCOPE,result.intentId),result);assert.equal((await f.envelope()).history.length,2);
  assert.equal(fs.statSync(f.store.path(key(SCOPE))).mode&0o777,0o600);
});

test('lost HTTP ACK + client/server restart retries identical old body with a fresh proof and fixed receipt',async t=>{
  const f=await fixture(t);f.lose=true;
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'CONTROL_RESULT_UNKNOWN'});
  const first=await f.envelope(),intentId=first.active.outbox.records[0].intent.body.intentId;
  assert.equal((await f.client().status(SCOPE)).active.status,'unknown');
  f.lose=false;f.offset=700_000;f.restartServer();
  const result=await f.client().retry(SCOPE,intentId),posts=f.requests.filter(x=>x.method==='POST');
  assert.equal(result.status,'confirmed');assert.equal(result.receipt.cutoff,new Date(NOW).toISOString());
  assert.equal(posts[0].body,posts[1].body);
  const proofs=posts.map(x=>decodeWalletSessionControlProofHeader(x.headers[WALLET_SESSION_CONTROL_PROOF_HEADER]));
  assert.notEqual(proofs[0].nonce,proofs[1].nonce);assert.equal(proofs[1].issuedAt,new Date(NOW+700_000).toISOString());
  assert.equal(f.host().snapshot().controlIntents.length,1);assert.equal((await f.envelope()).history[0].record.proofs.length,2);
});

test('unsupported public v2 route / unknown error cannot clear history; exact unapplied expiry terminates truthfully',async t=>{
  const f=await fixture(t);
  f.mutate=async(response,request)=>{
    if(request.method!=='POST')return response;
    return responseJSON(request,{ok:false,error:{code:'DEVICE_NOT_FOUND',message:'Original intent not applied'}},404);
  };
  // The actual fixed Auth saw this request; use a foreign device scope so the
  // real host also does not apply it, before replacing its identical denial.
  const first=await f.client().begin(SCOPE,{operation:'device-logout',deviceBinding:'0'.repeat(64)});
  assert.equal(first.status,'unknown');assert.equal(first.revocationConfirmed,false);
  assert.equal(f.host().snapshot().controlIntents.length,0);
  f.mutate=null;f.offset=700_000;
  const expired=await f.client().retry(SCOPE,first.intentId);
  assert.equal(expired.status,'expired');assert.equal(expired.revocationConfirmed,false);assert.equal(expired.unapplied,true);
  assert.equal((await f.envelope()).history[0].record.outbox.records[0].attempts.length,2);
  assert.equal((await f.client().status(SCOPE)).active,null);
});

test('slow 49.52-second OS confirmation happens before fresh proof time without a second authorization',async t=>{
  const f=await fixture(t);f.authHook=async()=>{f.offset+=49_520;f.mono+=49_520;};
  const result=await f.client().begin(SCOPE,{operation:'account-logout'});
  assert.equal(result.status,'confirmed');assert.equal(f.authCalls,1);
  const proof=decodeWalletSessionControlProofHeader(f.requests.find(x=>x.method==='POST').headers[WALLET_SESSION_CONTROL_PROOF_HEADER]);
  assert.equal(proof.issuedAt,new Date(NOW+49_520).toISOString());
});

for(const slowWrite of [2,3])test(`storage delay at write ${slowWrite} refreshes the clock inside the same OS callback`,async t=>{
  const f=await fixture(t);f.store.hook=async({writes})=>{if(writes===slowWrite){f.offset+=6000;f.mono+=6000;}};
  const result=await f.client().begin(SCOPE,{operation:'account-logout'});
  assert.equal(result.status,'confirmed');assert.equal(f.authCalls,1);assert.equal(f.postCalls,1);
  assert.equal(f.requests.filter(x=>x.method==='GET').length,3);
  assert.equal((await f.envelope()).history[0].record.outbox.records[0].attempts.length,2);
});

for(const write of [1,2,3])for(const afterWrite of [false,true])test(`protected write ${write} ${afterWrite?'lost ACK':'failure'} sends no POST and preserves latest`,async t=>{
  const f=await fixture(t);f.store.failWrite=write;f.store.afterWrite=afterWrite;
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'CONTROL_STORAGE_UNKNOWN'});
  assert.equal(f.postCalls,0);assert.equal(f.authCalls,write===1?0:1);
  const read=await f.client().status(SCOPE);
  if(write===3&&afterWrite)assert.equal(read.active.status,'unknown');
  if(write===1&&afterWrite)assert.equal(read.active.status,'ready');
});

test('resolution write ACK loss preserves new durable receipt and reload completes without new key use',async t=>{
  const f=await fixture(t);f.store.failWrite=4;f.store.afterWrite=true;
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'CONTROL_STORAGE_UNKNOWN'});
  const state=await f.client().status(SCOPE);assert.equal(state.active,null);assert.equal(state.history[0].revocationConfirmed,true);
  const calls=f.authCalls;assert.deepEqual(await f.client().retry(SCOPE,state.history[0].intentId),state.history[0]);assert.equal(f.authCalls,calls);assert.equal(f.postCalls,1);
});

test('readback failure after dispatch marker prevents POST and retains uncertain original attempt',async t=>{
  const f=await fixture(t);f.store.hook=async({writes})=>{if(writes===3)f.store.readbackFailure=true;};
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'CONTROL_STORAGE_UNKNOWN'});
  assert.equal(f.postCalls,0);assert.equal((await f.client().status(SCOPE)).active.status,'unknown');
});

test('cancel while OS prompt waits is local only and a later key callback cannot send',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();f.authHook=async()=>{entered.resolve();await release.promise;};
  const client=f.client(),run=client.begin(SCOPE,{operation:'account-logout'});await entered.promise;
  const current=(await client.status(SCOPE)).active;
  const cancelled=await client.cancel(SCOPE,current.intentId);assert.equal(cancelled.status,'cancelled-before-dispatch');
  release.resolve();await assert.rejects(run,{code:'CONTROL_OPERATION_CANCELLED'});assert.equal(f.postCalls,0);
  f.authHook=null;assert.equal((await client.begin(SCOPE,{operation:'account-logout'})).status,'confirmed');
});

test('cancel while POST waits preserves its late authenticated fact but blocks old UI completion',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();f.delay=async()=>{entered.resolve();await release.promise;};
  const client=f.client(),run=client.begin(SCOPE,{operation:'account-logout'});await entered.promise;
  const original=(await client.status(SCOPE)).active;
  assert.equal((await client.cancel(SCOPE,original.intentId)).status,'unknown');
  release.resolve();await assert.rejects(run,{code:'CONTROL_OPERATION_CANCELLED'});
  const recovered=await f.client().retry(SCOPE,original.intentId);assert.equal(recovered.status,'confirmed');assert.equal(f.postCalls,1);
});

test('lock after protected dispatch write cancels before Fetch and keeps unknown marker',async t=>{
  const f=await fixture(t);f.store.hook=async({writes})=>{if(writes===3)f.locked=true;};
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'OWNER_LOCKED'});
  assert.equal(f.postCalls,0);assert.equal((await f.client().status(SCOPE)).active.status,'unknown');
});

test('different owners proceed concurrently; two clients sharing one adapter serialize one owner operation',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();f.authHook=async(scope)=>{if(scope.account===SCOPE.account){entered.resolve();await release.promise;}};
  const a=f.client(),b=f.client(),pending=a.begin(SCOPE,{operation:'account-logout'});await entered.promise;
  await assert.rejects(b.retry(SCOPE,(await b.status(SCOPE)).active.intentId),{code:'CONTROL_OPERATION_BUSY'});
  const other=await b.begin(OTHER,{operation:'account-logout'});assert.equal(other.receipt.account,OTHER.account);
  release.resolve();assert.equal((await pending).receipt.account,SCOPE.account);
  assert.equal((await f.envelope()).history.length,1);assert.equal((await f.envelope(OTHER)).history.length,1);
});

test('returned wrong account key fails before proof creation and POST',async t=>{
  const f=await fixture(t);f.wrongOwner=true;
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'OUTBOX_OWNER_MISMATCH'});
  assert.equal(f.postCalls,0);assert.equal(f.requests.length,1);assert.equal((await f.client().status(SCOPE)).active.status,'ready');
});

test('transport redirect, missing URL, mismatched request and dual envelope never promote',async t=>{
  const f=await fixture(t);let current='redirect';
  f.mutate=async(response,request,overrides)=>{
    if(request.method!=='POST')return response;
    if(current==='redirect')overrides.redirected=true;
    if(current==='url')overrides.url=undefined;
    if(current==='id')return responseJSON(request,{ok:false,error:{code:'INTENT_EXPIRED',message:'bad'},requestId:'req_wrong_identifier_000'},409);
    if(current==='dual'){const body=await response.json();body.error=null;return new Response(canonicalJSON(body),{status:200,headers:response.headers});}
    return response;
  };
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'CONTROL_RESULT_UNKNOWN'});
  const intentId=(await f.client().status(SCOPE)).active.intentId;
  for(current of ['url','id','dual']){await assert.rejects(f.client().retry(SCOPE,intentId));assert.equal((await f.client().status(SCOPE)).active.status,'unknown');}
  f.mutate=null;assert.equal((await f.client().retry(SCOPE,intentId)).status,'confirmed');
});

test('response byte overflow and exact HTTP error retain original unknown bytes',async t=>{
  const f=await fixture(t);f.mutate=async(response,request)=>request.method==='POST'?new Response('x'.repeat(4*1024*1024+1),{status:200,headers:response.headers}):response;
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'CONTROL_RESULT_UNKNOWN'});
  const state=await f.envelope(),intentId=state.active.outbox.records[0].intent.body.intentId,body=state.active.outbox.records[0].bodyText;
  f.mutate=async(response,request)=>request.method==='POST'?responseJSON(request,{ok:false,error:{code:'IDEMPOTENCY_CONFLICT',message:'Unknown first response'}},409):response;
  const result=await f.client().retry(SCOPE,intentId);assert.equal(result.status,'unknown');assert.equal((await f.envelope()).active.outbox.records[0].bodyText,body);
});

test('timeout after actual server commit remains unknown and exact Retry recovers without changing cutoff',async t=>{
  const f=await fixture(t,{client:{timeoutMs:1000}});f.holdResponse=deferred();f.responseCommitted=deferred();
  const client=f.client(),run=client.begin(SCOPE,{operation:'account-logout'});await f.responseCommitted.promise;
  assert.equal(f.host().snapshot().controlIntents.length,1);
  await assert.rejects(run,{code:'CONTROL_RESULT_UNKNOWN'});
  const original=(await client.status(SCOPE)).active;assert.equal(original.status,'unknown');
  const release=f.holdResponse;f.holdResponse=null;release.resolve();
  assert.equal((await client.retry(SCOPE,original.intentId)).receipt.cutoff,new Date(NOW).toISOString());
});

test('restart revalidates receipt/proof/scope; corrupted protected ciphertext never imports',async t=>{
  const f=await fixture(t),result=await f.client().begin(SCOPE,{operation:'account-logout'}),good=await f.envelope();
  for(const mutate of [
    s=>s.scope.account=OTHER.account,
    s=>s.history[0].record.proofs[0].proof.signature='0'.repeat(128),
    s=>s.history[0].resolution.requestId='req_wrong_request_000',
    s=>{const a=s.history[0].record.outbox.records[0].attempts[0],body=JSON.parse(a.response.bodyText);body.result.receipt.target.account=OTHER.account;a.response.bodyText=canonicalJSON(body);},
    s=>s.history[0].record.outbox.records[0].bodyText+=' ',
  ]){const bad=copy(good);mutate(bad);await f.store.setItem(key(SCOPE),canonicalJSON(bad));await assert.rejects(f.client().status(SCOPE));}
  await f.store.setItem(key(SCOPE),canonicalJSON(good));assert.deepEqual(await f.client().retry(SCOPE,result.intentId),result);
  const path=f.store.path(key(SCOPE)),raw=fs.readFileSync(path);raw[raw.length-1]^=1;fs.writeFileSync(path,raw);
  await assert.rejects(f.client().status(SCOPE));
});

test('no UI method can inject a receipt or promote an arbitrary boolean',async t=>{
  const f=await fixture(t),client=f.client();
  assert.equal(client.promote,undefined);assert.equal(client.observe,undefined);assert.equal(client.resolve,undefined);
  await assert.rejects(client.begin(SCOPE,{operation:'account-logout',revocationConfirmed:true}));
  assert.equal(f.requests.length,0);assert.equal(f.authCalls,0);
  await assert.rejects(client.begin({...SCOPE,authority:'https://other-auth.example'},{operation:'account-logout'}),{code:'UNSUPPORTED_CONTROL_AUTHORITY'});
});

test('reviewed operation data is copied before awaits and cannot silently change the signed target',async t=>{
  const f=await fixture(t),review={operation:'device-logout',deviceBinding:'0'.repeat(64)};
  const run=f.client().begin(SCOPE,review);
  review.operation='account-logout';delete review.deviceBinding;
  const result=await run;assert.equal(result.status,'unknown');
  const post=f.requests.find(value=>value.method==='POST');
  assert.equal(new URL(post.url).pathname,WALLET_SESSION_CONTROL_INTENT_PATHS[1]);assert.equal(JSON.parse(post.body).deviceBinding,'0'.repeat(64));
  assert.equal(f.host().snapshot().controlIntents.length,0);
});

test('a broken private owner host cannot return made-up success or invoke its key callback twice',async t=>{
  const f=await fixture(t);
  const client=new WalletSessionControlClient({storage:f.store,fetchImpl:f.fetch,withOwner:async()=>({status:'confirmed',revocationConfirmed:true}),monotonicNow:()=>f.mono});
  await assert.rejects(client.begin(SCOPE,{operation:'account-logout'}),{code:'INVALID_OWNER_ACCESS'});assert.equal(f.postCalls,0);
  const original=(await client.status(SCOPE)).active;
  const twice=new WalletSessionControlClient({storage:f.store,fetchImpl:f.fetch,withOwner:async(scope,purpose,use)=>{const result=await f.authorize(scope,purpose,use);await f.authorize(scope,purpose,use);return result;},monotonicNow:()=>f.mono});
  await assert.rejects(twice.retry(SCOPE,original.intentId),{code:'INVALID_OWNER_ACCESS'});assert.equal(f.postCalls,1);
  assert.equal((await f.client().retry(SCOPE,original.intentId)).status,'confirmed');
});

test('retained resolved history still prevents nonce reuse; a failed new intent never deletes old receipt',async t=>{
  const f=await fixture(t),first=await f.client().begin(SCOPE,{operation:'account-logout'}),before=await f.envelope();
  const oldNonce=before.history[0].record.outbox.records[0].attempts[0].nonce;
  let count=0;const client=f.client(); // production client has no import/nonce override method
  const maliciousHostClient=new WalletSessionControlClient({storage:f.store,withOwner:f.authorize,fetchImpl:f.fetch,monotonicNow:()=>f.mono,randomBytes:async()=>{count++;return count===6?new Uint8Array(Buffer.from(oldNonce,'hex')):new Uint8Array(createHash('sha256').update(`host-${count}`).digest());}});
  await assert.rejects(maliciousHostClient.begin(SCOPE,{operation:'account-logout'}),{code:'OUTBOX_REPLAY'});
  assert.deepEqual(await client.retry(SCOPE,first.intentId),first);assert.equal((await f.envelope()).history.length,1);
});

test('same-adapter CAS compares exact old bytes again after transition before write',async t=>{
  const f=await fixture(t),originalGet=f.store.getItem.bind(f.store);let calls=0;
  f.store.getItem=async name=>{const text=await originalGet(name);calls++;if(calls===3)return canonicalJSON({foreign:true});return text;};
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'STALE_CONTROL_OUTBOX'});
  assert.equal(f.store.writes,0);assert.equal(f.authCalls,0);assert.equal(f.postCalls,0);
});

test('owner history capacity is explicit and preserves all old recovery without OS access or network',async t=>{
  const f=await fixture(t),history=[];
  for(let index=0;index<128;index++){
    const intent={account:SCOPE.account,operation:'account-logout',body:{intentId:token(`retained-${index}`),intentIssuedAt:new Date(NOW).toISOString(),intentExpiresAt:new Date(NOW+600_000).toISOString()}};
    const ready=prepareWalletSessionControlOutbox(createWalletSessionControlOutbox(SCOPE),SCOPE,{type:'enqueue',intent}).candidate;
    const cancelled=prepareWalletSessionControlOutbox(ready,SCOPE,{type:'cancel',intentId:intent.body.intentId}).candidate;
    history.push({record:{outbox:cancelled,proofs:[]},resolution:{kind:'cancelled',requestId:null}});
  }
  const text=canonicalJSON({version:1,scope:SCOPE,revision:128,active:null,history});await f.store.setItem(key(SCOPE),text);
  await assert.rejects(f.client().begin(SCOPE,{operation:'account-logout'}),{code:'OUTBOX_CAPACITY'});
  assert.equal(f.requests.length,0);assert.equal(f.authCalls,0);assert.equal(await f.store.getItem(key(SCOPE)),text);
  assert.equal((await f.client().retry(SCOPE,history[0].record.outbox.records[0].intent.body.intentId)).status,'cancelled-before-dispatch');
});

function responseJSON(request,payload,status){return new Response(canonicalJSON({schemaVersion:2,requestId:request.headers['x-request-id'],...payload}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-request-id':request.headers['x-request-id']}});}
