import assert from "node:assert/strict";
import test from "node:test";
import { createSignedNativeTransfer, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { NativeBroadcastUnknown, NativeChainClient } from "./nativeTransfer";
import { NATIVE_OUTBOX_PREFIX, NativeOutboxBlocked, NativeOutboxStorageError, NativeTransferOutbox } from "./nativeTransferOutbox";
import { WalletOperationLifecycle } from "../security/operationLifecycle";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const account=ynxAddressFromEVM("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"),to=ynxAddressFromEVM("0xffffffffffffffffffffffffffffffffffffffff");
const signed=createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to,amount:25,nonce:7});
const storageKey=NATIVE_OUTBOX_PREFIX+account;
const noGuard=()=>{};
class MemoryStorage implements SecureStorageAdapter {
  values=new Map<string,string>();events:string[]=[];writes=0;failWrite=0;failRead=0;reads=0;afterRead:(key:string)=>void=()=>{};
  async getItem(key:string){this.events.push("read");const value=this.values.get(key)??null;this.afterRead(key);if(++this.reads===this.failRead)throw new Error("synthetic read failure");return value}
  async setItem(key:string,value:string){this.events.push("write");if(++this.writes===this.failWrite)throw new Error("synthetic write failure");this.values.set(key,value)}
  async deleteItem(){throw new Error("Outbox must never delete the record")}
}
function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}})}
function success(replayed=false){return {transaction:{hash:signed.hash,...signed.transaction},replayed,truthfulStatus:"signature-verified-authoritative-native-transfer"}}
function client(fetcher:(url:string,init?:RequestInit)=>Promise<Response>,verify=false){return new NativeChainClient("https://rpc.ynxweb4.com",fetcher,verify?value=>value.fixtureDurabilityProof==="verified-test-checkpoint":undefined)}
function fixtureOutbox(storage:MemoryStorage){return new NativeTransferOutbox(storage,undefined,value=>value.fixtureDurabilityProof==="verified-test-checkpoint")}
function lifecycle(){const operations=new WalletOperationLifecycle();operations.setAccount(account);const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();return operations}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}

test("real 25 YNXT signed bytes and dispatch marker are read back before POST; legacy acceptance stays observed",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage);let calls=0;
  const remote=client(async(url,init)=>{calls++;assert.equal(url,"https://rpc.ynxweb4.com/transactions/broadcast");assert.equal(init?.body,signed.payload);assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");const saved=JSON.parse(storage.values.get(storageKey)!);assert.equal(saved.phase,"unknown");assert.equal(saved.hash,signed.hash);assert.equal(saved.attempts,1);assert.deepEqual(storage.events,["read","write","read","write","read"]);return response(success(),201)});
  const result=await outbox.sendNew(account,remote,noGuard,async()=>signed);
  assert.equal(result.phase,"observed");assert.equal(result.replayed,false);assert.equal(calls,1);
  assert.equal((await fixtureOutbox(storage).read(account))?.payload,signed.payload);
  await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>{throw new Error("must not sign")}),NativeOutboxBlocked);
  await assert.rejects(()=>outbox.acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
});

for(const [name,fetcher] of [
  ["lost ACK",async()=>{throw new Error("connection lost")}],
  ["503 durability uncertainty",async()=>response({error:"needs confirmation",status:"transaction_durability_uncertain",transactionHash:signed.hash},503)],
  ["503 wrong server hash",async()=>response({status:"transaction_durability_uncertain",transactionHash:"0x"+"0".repeat(64)},503)],
  ["non JSON",async()=>new Response("proxy unavailable",{status:502})],
  ["hash mismatch",async()=>response({...success(),transaction:{...signed.transaction,hash:"0x"+"0".repeat(64)}})],
  ["wrong amount",async()=>response({...success(),transaction:{...signed.transaction,hash:signed.hash,amount:26}})],
  ["missing replayed flag",async()=>response({transaction:{...signed.transaction,hash:signed.hash},truthfulStatus:"signature-verified-authoritative-native-transfer"})],
  ["unbound HTTP400",async()=>response({error:"decode signed transaction"},400)],
  ["unbound HTTP403",async()=>response({error:"forbidden"},403)],
  ["nonce rejection",async()=>response({error:"nonce conflicts"},409)],
] as const)test(`${name} retains the original bytes/hash across reload and blocks any new signer`,async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage);let signatures=0;
  const result=await outbox.sendNew(account,client(fetcher),noGuard,async()=>{signatures++;return signed});
  assert.equal(result.phase,"unknown");assert.equal(result.payload,signed.payload);assert.equal(result.hash,signed.hash);
  const restarted=fixtureOutbox(storage);
  assert.deepEqual(await restarted.read(account),result);
  await assert.rejects(()=>restarted.sendNew(account,client(fetcher),noGuard,async()=>{signatures++;return signed}),NativeOutboxBlocked);assert.equal(signatures,1);
});

test("HTTP uncertainty preserves status and reported hash while keeping the expected hash separate",async()=>{
  const reported="0x"+"0".repeat(64);
  await assert.rejects(()=>client(async()=>response({status:"transaction_durability_uncertain",transactionHash:reported},503)).broadcast(signed.payload,signed.transaction,signed.hash),(error:unknown)=>{assert.ok(error instanceof NativeBroadcastUnknown);assert.equal(error.hash,signed.hash);assert.equal(error.reportedHash,reported);assert.equal(error.httpStatus,503);return true});
});

test("retry after unknown authorizes and posts identical body with no new signature or GET; later rejection never clears it",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),calls:string[]=[];let count=0,authorizations=0;
  const remote=client(async(url,init)=>{calls.push(String(init?.body));assert.equal(init?.method,"POST");assert.equal(url.endsWith("/transactions/broadcast"),true);if(++count===1)throw new Error("lost");return response({error:"nonce already used"},409)});
  await outbox.sendNew(account,remote,noGuard,async()=>signed);
  const result=await fixtureOutbox(storage).retry(account,signed.hash,remote,noGuard,async()=>{authorizations++});
  assert.equal(result.phase,"unknown");assert.equal(result.attempts,2);assert.equal(authorizations,1);assert.deepEqual(calls,[signed.payload,signed.payload]);
});

test("closing or locking during POST saves an independently verified outcome despite a cancelled UI lease",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),operations=lifecycle(),lease=operations.scope().begin(),started=deferred<void>(),network=deferred<Response>();
  const remote=client(async()=>{started.resolve();return network.promise},true);
  const pending=outbox.sendNew(account,remote,lease.assert,async()=>signed);await started.promise;operations.lock();network.resolve(response({...success(),fixtureDurabilityProof:"verified-test-checkpoint"},201));
  const result=await pending;assert.equal(result.phase,"accepted");assert.equal(lease.isCurrent(),false);assert.equal((await fixtureOutbox(storage).read(account))?.phase,"accepted");
  await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>signed),NativeOutboxBlocked);
});

test("confirmed result requires explicit Done before any new signature, including after restart",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),remote=client(async()=>response({...success(true),fixtureDurabilityProof:"verified-test-checkpoint"}),true);
  await outbox.sendNew(account,remote,noGuard,async()=>signed);
  const restarted=fixtureOutbox(storage);
  await assert.rejects(()=>restarted.retry(account,signed.hash,remote,noGuard,async()=>{}),NativeOutboxBlocked);
  await assert.rejects(()=>restarted.acknowledge(account,"0x"+"0".repeat(64),noGuard),NativeOutboxBlocked);
  assert.equal((await restarted.acknowledge(account,signed.hash,noGuard)).phase,"done");
  assert.equal((await restarted.read(account))?.hash,signed.hash,"acknowledgement retains the last original receipt");
  let signedAgain=false;await restarted.sendNew(account,remote,noGuard,async()=>{signedAgain=true;return signed});assert.equal(signedAgain,true);
});

test("persisted accepted/done bits without a presently verified proof never release the account",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),remote=client(async()=>response({...success(),fixtureDurabilityProof:"verified-test-checkpoint"}),true);
  await outbox.sendNew(account,remote,noGuard,async()=>signed);
  const good=storage.values.get(storageKey)!;
  for(const phase of ["accepted","done"]){
    for(const durabilityEvidence of [null,{fixtureDurabilityProof:"wrong"}]){
      storage.values.set(storageKey,JSON.stringify({...JSON.parse(good),phase,durabilityEvidence}));
      assert.equal((await fixtureOutbox(storage).read(account))?.phase,"observed");
      await assert.rejects(()=>outbox.acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
      await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>signed),NativeOutboxBlocked);
    }
  }
  storage.values.set(storageKey,good);
  const productionDefault=new NativeTransferOutbox(storage);
  assert.equal((await productionDefault.read(account))?.phase,"observed","the default verifier never accepts a fixture or speculative Core proof");
  await assert.rejects(()=>productionDefault.acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
});

for(const fail of ["prepared write","prepared readback","dispatch write","dispatch readback"] as const)test(`${fail} failure stops network dispatch and does not remove a stored original`,async()=>{
  const storage=new MemoryStorage();if(fail==="prepared write")storage.failWrite=1;if(fail==="dispatch write")storage.failWrite=2;if(fail==="prepared readback")storage.failRead=2;if(fail==="dispatch readback")storage.failRead=3;
  let broadcasts=0;await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,client(async()=>{broadcasts++;return response(success())}),noGuard,async()=>signed),NativeOutboxStorageError);assert.equal(broadcasts,0);
  const record=await fixtureOutbox(storage).read(account);if(fail!=="prepared write"){assert.equal(record?.hash,signed.hash);assert.equal(record?.payload,signed.payload)}
});

test("accepted-result storage failure leaves the durable unknown marker and blocks new signing",async()=>{
  const storage=new MemoryStorage();storage.failWrite=3;const outbox=fixtureOutbox(storage),remote=client(async()=>response({...success(),fixtureDurabilityProof:"verified-test-checkpoint"}),true);
  await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>signed),NativeOutboxStorageError);assert.equal((await fixtureOutbox(storage).read(account))?.phase,"unknown");
  await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>signed),NativeOutboxBlocked);
});

test("readback mismatch stops dispatch, and corrupted signed bytes cannot become a retry",async()=>{
  const storage=new MemoryStorage(),originalGet=storage.getItem.bind(storage);storage.getItem=async key=>{const value=await originalGet(key);return storage.reads===2?"unexpected readback":value};
  let calls=0;const outbox=fixtureOutbox(storage),remote=client(async()=>{calls++;return response(success())});
  await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>signed),NativeOutboxStorageError);assert.equal(calls,0);
  const raw=JSON.parse(storage.values.get(storageKey)!);raw.payload=raw.payload.replace('"amount":25','"amount":26');storage.values.set(storageKey,JSON.stringify(raw));
  await assert.rejects(()=>outbox.read(account),NativeOutboxStorageError);await assert.rejects(()=>outbox.retry(account,signed.hash,remote,noGuard,async()=>{}),NativeOutboxStorageError);assert.equal(calls,0);
});

test("cancel during OS authorization leaves original untouched and never calls network",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),remote=client(async()=>{throw new Error("lost")});await outbox.sendNew(account,remote,noGuard,async()=>signed);
  const before=storage.values.get(storageKey),operations=lifecycle(),lease=operations.scope().begin();let calls=0;
  await assert.rejects(()=>outbox.retry(account,signed.hash,client(async()=>{calls++;return response(success())}),lease.assert,async()=>{operations.lock()}),/cancelled/);
  assert.equal(storage.values.get(storageKey),before);assert.equal(calls,0);
});

test("cancel after a durable save but before dispatch keeps original bytes and never POSTs",async()=>{
  for(const cancelOnRead of [2,3]){
    const storage=new MemoryStorage(),operations=lifecycle(),lease=operations.scope().begin();let calls=0;storage.afterRead=()=>{if(storage.reads+1===cancelOnRead)operations.lock()};
    await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,client(async()=>{calls++;return response(success())}),lease.assert,async()=>signed),/cancelled/);
    assert.equal(calls,0);const result=await fixtureOutbox(storage).read(account);assert.equal(result?.hash,signed.hash);assert.equal(result?.phase,cancelOnRead===2?"prepared":"unknown");
  }
});

test("two controllers sharing storage cannot both sign while one attempt is active",async()=>{
  const storage=new MemoryStorage(),first=fixtureOutbox(storage),second=fixtureOutbox(storage),started=deferred<void>(),gate=deferred<Response>();let signatures=0;
  const remote=client(async()=>{started.resolve();return gate.promise});const one=first.sendNew(account,remote,noGuard,async()=>{signatures++;return signed});await started.promise;
  const two=second.sendNew(account,remote,noGuard,async()=>{signatures++;return signed});gate.resolve(response(success()));await one;await assert.rejects(()=>two,NativeOutboxBlocked);assert.equal(signatures,1);
});

test("a changed RPC origin or stale review hash cannot authorize original replay",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage);await outbox.sendNew(account,client(async()=>{throw new Error("lost")}),noGuard,async()=>signed);let prompts=0;
  await assert.rejects(()=>outbox.retry(account,signed.hash,new NativeChainClient("https://other.example",async()=>response(success())),noGuard,async()=>{prompts++}),/different RPC origin/);
  await assert.rejects(()=>outbox.retry(account,"0x"+"0".repeat(64),client(async()=>response(success())),noGuard,async()=>{prompts++}),NativeOutboxBlocked);assert.equal(prompts,0);
});

test("unsafe whole-YNXT totals and mismatched locally signed identity stop before any POST",async()=>{
  let calls=0;const remote=client(async()=>{calls++;return response(success())});
  const excessive=createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to,amount:Number.MAX_SAFE_INTEGER,nonce:7});
  await assert.rejects(()=>remote.broadcast(excessive.payload,excessive.transaction,excessive.hash),/safe whole-YNXT/);
  await assert.rejects(()=>remote.broadcast(signed.payload,signed.transaction,"0x"+"0".repeat(64)),/reviewed identity/);
  const storage=new MemoryStorage();
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>excessive),/identity/);
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(to,remote,noGuard,async()=>signed),/identity/);
  assert.equal(calls,0);assert.equal(storage.values.size,0);
});

test("body-read timeout remains unknown even if fetch ignores abort",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const remote=client(async()=>({ok:true,status:200,redirected:false,url:"",text:()=>new Promise<string>(()=>{})}) as Response);
  const pending=remote.broadcast(signed.payload,signed.transaction,signed.hash);await Promise.resolve();t.mock.timers.tick(15001);await assert.rejects(()=>pending,NativeBroadcastUnknown);
});
