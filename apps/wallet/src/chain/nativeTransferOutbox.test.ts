import assert from "node:assert/strict";
import test from "node:test";
import { createSignedNativeTransfer, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { NativeBroadcastUnknown, NativeChainClient } from "./nativeTransfer";
import { NATIVE_DURABILITY_MODEL } from "./nativeDurability";
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
const blockHash="0x"+"a".repeat(64);
function receipt(){return {transactionHash:signed.hash,from:signed.transaction.from,to:signed.transaction.to,blockNumber:"0x2",blockHash,status:"0x1",contractAddress:null,transactionIndex:"0x0",gasUsed:"0x5208",ynxNativeTransaction:{type:"transfer",amountYNXT:"25",feeYNXT:"1",nonce:"0x7"},ynxDurability:{version:NATIVE_DURABILITY_MODEL.version,scope:"local-snapshot",status:"durable",transactionHash:signed.hash,blockNumber:"0x2",blockHash,checkpointBlockNumber:"0x2",checkpointBlockHash:blockHash,snapshotIntegrity:"0x"+"b".repeat(64)}}}
function client(fetcher:(url:string,init?:RequestInit)=>Promise<Response>,verify=false,rpcPassthrough=false){return new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{if(rpcPassthrough||!url.endsWith("/evm"))return fetcher(url,init);const {id,method}=JSON.parse(String(init?.body));const value=method==="eth_chainId"?"0x1917":method==="ynx_getDurabilityModel"?NATIVE_DURABILITY_MODEL:verify&&method==="ynx_getTransactionDurability"?receipt().ynxDurability:verify&&method==="eth_getTransactionReceipt"?receipt():undefined;if(value===undefined)return fetcher(url,init);return response({jsonrpc:"2.0",id,result:value})})}
function fixtureOutbox(storage:MemoryStorage){return new NativeTransferOutbox(storage)}
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

test("closing or locking during POST preserves observed ACK despite a cancelled UI lease and never promotes it to mined confirmation",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),operations=lifecycle(),lease=operations.scope().begin(),started=deferred<void>(),network=deferred<Response>();
  const remote=client(async()=>{started.resolve();return network.promise},true);
  const pending=outbox.sendNew(account,remote,lease.assert,async()=>signed);await started.promise;operations.lock();network.resolve(response({...success(),fixtureDurabilityProof:"verified-test-checkpoint"},201));
  const result=await pending;assert.equal(result.phase,"observed");assert.equal(lease.isCurrent(),false);assert.equal((await fixtureOutbox(storage).read(account))?.phase,"observed");
  await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>signed),NativeOutboxBlocked);
});

test("confirmed result requires explicit Done before any new signature, including after restart",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),remote=client(async()=>response({...success(true),fixtureDurabilityProof:"verified-test-checkpoint"}),true);
  await outbox.sendNew(account,remote,noGuard,async()=>signed);
  await outbox.checkStatus(account,signed.hash,remote,noGuard);
  const restarted=fixtureOutbox(storage);
  await assert.rejects(()=>restarted.retry(account,signed.hash,remote,noGuard,async()=>{}),NativeOutboxBlocked);
  await assert.rejects(()=>restarted.acknowledge(account,"0x"+"0".repeat(64),noGuard),NativeOutboxBlocked);
  assert.equal((await restarted.acknowledge(account,signed.hash,noGuard)).phase,"done");
  assert.equal((await restarted.read(account))?.hash,signed.hash,"acknowledgement retains the last original receipt");
  let signedAgain=false;await restarted.sendNew(account,remote,noGuard,async()=>{signedAgain=true;return signed});assert.equal(signedAgain,true);
});

test("identity-extended receipt recovers a saved transfer, survives restart, and Done releases the next preparation without rebroadcast",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage);
  await outbox.sendNew(account,client(async()=>{throw new Error("lost ACK")}),noGuard,async()=>signed);
  const original=await outbox.read(account);let broadcasts=0;
  const r={...receipt(),ynxNativeTransaction:{...receipt().ynxNativeTransaction,from:signed.transaction.from,to:signed.transaction.to,identityProjection:{version:"ynx-native-identity-projection-v1",fromSystemIdentity:false,toSystemIdentity:false,systemAddressDomain:"YNX_NATIVE_IDENTITY_PROJECTION_V1",systemAddressScheme:"last-20-bytes-sha256-nul-domain-exact-native-identity",systemAddressesAreDisplayOnly:true}}};
  const remote=client(async(url,init)=>{
    if(!url.endsWith("/evm")){broadcasts++;throw new Error("unexpected broadcast")}
    const {id,method}=JSON.parse(String(init?.body));
    const values:Record<string,unknown>={eth_chainId:"0x1917",ynx_getDurabilityModel:NATIVE_DURABILITY_MODEL,ynx_getTransactionDurability:r.ynxDurability,eth_getTransactionReceipt:r};
    assert.ok(Object.hasOwn(values,method));return response({jsonrpc:"2.0",id,result:values[method]});
  },false,true);
  const recovered=await fixtureOutbox(storage).checkStatus(account,signed.hash,remote,noGuard);
  assert.equal(recovered.phase,"accepted");assert.equal(recovered.payload,original?.payload);assert.equal(recovered.attempts,1);
  const restarted=fixtureOutbox(storage);assert.equal((await restarted.read(account))?.phase,"accepted");
  assert.equal((await restarted.acknowledge(account,signed.hash,noGuard)).phase,"done");
  let preparations=0;const stop=new Error("stop at next preparation; do not sign or send");
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>{preparations++;throw stop}),error=>error===stop);
  assert.equal(preparations,1);assert.equal(broadcasts,0);assert.equal((await restarted.read(account))?.hash,signed.hash);
});

test("persisted accepted/done bits without a presently verified proof never release the account",async()=>{
  const storage=new MemoryStorage(),outbox=fixtureOutbox(storage),remote=client(async()=>response({...success(),fixtureDurabilityProof:"verified-test-checkpoint"}),true);
  await outbox.sendNew(account,remote,noGuard,async()=>signed);
  await outbox.checkStatus(account,signed.hash,remote,noGuard);
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
  assert.equal((await productionDefault.read(account))?.phase,"accepted","the production verifier revalidates the saved exact capability and receipt");
  const wrong=JSON.parse(good);wrong.durabilityEvidence.capability.version="unknown-future-version";storage.values.set(storageKey,JSON.stringify(wrong));
  await assert.rejects(()=>productionDefault.acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
});

for(const fail of ["prepared write","prepared readback","dispatch write","dispatch readback"] as const)test(`${fail} failure stops network dispatch and does not remove a stored original`,async()=>{
  const storage=new MemoryStorage();if(fail==="prepared write")storage.failWrite=1;if(fail==="dispatch write")storage.failWrite=2;if(fail==="prepared readback")storage.failRead=2;if(fail==="dispatch readback")storage.failRead=3;
  let broadcasts=0;await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,client(async()=>{broadcasts++;return response(success())}),noGuard,async()=>signed),NativeOutboxStorageError);assert.equal(broadcasts,0);
  const record=await fixtureOutbox(storage).read(account);if(fail!=="prepared write"){assert.equal(record?.hash,signed.hash);assert.equal(record?.payload,signed.payload)}
});

test("observed ACK storage failure leaves the durable unknown marker and blocks new signing",async()=>{
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

function rpcClient(options:{state?:any;receipt?:any;model?:any;error?:(method:string)=>any;envelope?:(value:any,method:string)=>any;before?:(method:string)=>Promise<void>}={},methods:string[]=[]){
  return client(async(url,init)=>{
    assert.equal(url,"https://rpc.ynxweb4.com/evm");assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");
    const request=JSON.parse(String(init?.body));methods.push(request.method);await options.before?.(request.method);
    assert.deepEqual(request.params,request.method==="eth_chainId"||request.method==="ynx_getDurabilityModel"?[]:[signed.hash]);
    const values:Record<string,unknown>={eth_chainId:"0x1917",ynx_getDurabilityModel:options.model??NATIVE_DURABILITY_MODEL,ynx_getTransactionDurability:options.state??receipt().ynxDurability,eth_getTransactionReceipt:Object.hasOwn(options,"receipt")?options.receipt:receipt()};
    assert.equal(Object.hasOwn(values,request.method),true,"check must not call nonce, key or broadcast methods");
    const error=options.error?.(request.method),value={jsonrpc:"2.0",id:request.id,...(error?{error}:{result:values[request.method]})};
    return response(options.envelope?options.envelope(value,request.method):value);
  },false,true);
}
async function unknown(storage:MemoryStorage){await fixtureOutbox(storage).sendNew(account,client(async()=>{throw new Error("lost ACK")}),noGuard,async()=>signed)}

test("lost ACK recovers through public receipt checks with no authorization, broadcast, nonce or new signature, including restart and Done",async()=>{
  const storage=new MemoryStorage();await unknown(storage);const methods:string[]=[];
  const result=await fixtureOutbox(storage).checkStatus(account,signed.hash,rpcClient({},methods),noGuard);
  assert.equal(result.phase,"accepted");assert.equal(result.replayed,null);assert.equal(result.attempts,1);assert.equal(result.payload,signed.payload);
  assert.deepEqual(methods,["eth_chainId","ynx_getDurabilityModel","ynx_getTransactionDurability","eth_getTransactionReceipt","eth_chainId","ynx_getDurabilityModel","eth_chainId"]);
  const restarted=fixtureOutbox(storage);assert.equal((await restarted.read(account))?.phase,"accepted");
  await assert.rejects(()=>restarted.sendNew(account,rpcClient(),noGuard,async()=>{throw new Error("must not sign before Done")}),NativeOutboxBlocked);
  assert.equal((await restarted.acknowledge(account,signed.hash,noGuard)).phase,"done");assert.equal((await fixtureOutbox(storage).read(account))?.phase,"done");
});

for(const status of ["pending_durable","uncertain","memory_only","not_found","unsupported"] as const)test(`${status} remains stored across restart and cannot authorize Done or replacement`,async()=>{
  const storage=new MemoryStorage();await unknown(storage);const methods:string[]=[];
  const state={version:NATIVE_DURABILITY_MODEL.version,scope:"local-snapshot",status,transactionHash:signed.hash,...(status==="pending_durable"?{checkpointBlockNumber:"0x0",checkpointBlockHash:blockHash,snapshotIntegrity:"0x"+"b".repeat(64)}:{})};
  const remote=rpcClient({state,...(status==="unsupported"?{error:(method:string)=>method==="ynx_getDurabilityModel"?{code:-32601,message:"Method not found"}:null}:{})},methods);
  const result=await fixtureOutbox(storage).checkStatus(account,signed.hash,remote,noGuard);
  assert.equal(result.phase,status);assert.equal(result.payload,signed.payload);assert.equal(result.durabilityEvidence,null);assert.equal(methods.includes("eth_getTransactionReceipt"),false);
  const restarted=fixtureOutbox(storage);assert.equal((await restarted.read(account))?.phase,status);
  await assert.rejects(()=>restarted.acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
  await assert.rejects(()=>restarted.sendNew(account,remote,noGuard,async()=>{throw new Error("must not sign")}),NativeOutboxBlocked);
});

test("query accepts a later snapshot checkpoint only when it still covers the identical mined inclusion",async()=>{
  const later=receipt();later.ynxDurability.checkpointBlockNumber="0x3";later.ynxDurability.checkpointBlockHash="0x"+"c".repeat(64);later.ynxDurability.snapshotIntegrity="0x"+"d".repeat(64);
  assert.equal((await rpcClient({receipt:later}).checkTransferDurability(signed.transaction,signed.hash)).status,"durable");
  const wrong=receipt();wrong.blockNumber="0x3";wrong.ynxDurability.blockNumber="0x3";wrong.ynxDurability.checkpointBlockNumber="0x3";
  await assert.rejects(()=>rpcClient({receipt:wrong}).checkTransferDurability(signed.transaction,signed.hash),/could not be verified/);
});

test("null and request-bound durability RPC errors remain nonterminal even after a prior durable state read",async()=>{
  assert.equal((await rpcClient({receipt:null}).checkTransferDurability(signed.transaction,signed.hash)).status,"uncertain");
  for(const [code,status,wire] of [[-32002,"uncertain","transaction_durability_uncertain"],[-32004,"memory_only","transaction_durability_unavailable"]] as const){
    const data={status:wire,transactionHash:signed.hash,durabilityVersion:NATIVE_DURABILITY_MODEL.version,ynxDurability:{version:NATIVE_DURABILITY_MODEL.version,scope:"local-snapshot",status,transactionHash:signed.hash}};
    const error=(method:string)=>method==="eth_getTransactionReceipt"?{code,message:"Checkpoint unavailable",data}:null;
    assert.equal((await rpcClient({error}).checkTransferDurability(signed.transaction,signed.hash)).status,status);
    for(const patch of [{transactionHash:"0x"+"0".repeat(64)},{durabilityVersion:"future"},{ynxDurability:{...data.ynxDurability,status:"not_found"}}])await assert.rejects(()=>rpcClient({error:method=>method==="eth_getTransactionReceipt"?{code,message:"Unavailable",data:{...data,...patch}}:null}).checkTransferDurability(signed.transaction,signed.hash));
  }
});

test("malformed capability, RPC envelopes, receipt and wrong-chain replies preserve the prior unknown bytes",async()=>{
  const cases=[
    {model:{...NATIVE_DURABILITY_MODEL,version:"future"}},
    {envelope:(value:any)=>({...value,id:"unmatched"})},
    {envelope:(value:any)=>({...value,error:{code:-1,message:"conflicting"}})},
    {envelope:(value:any,method:string)=>method==="eth_chainId"?{...value,result:"0x1"}:value},
    {receipt:{...receipt(),ynxNativeTransaction:{type:"transfer",amountYNXT:"25",feeYNXT:"0",nonce:"0x7"}}},
    {receipt:{...receipt(),ynxDurability:null}},
  ];
  for(const options of cases){const storage=new MemoryStorage();await unknown(storage);const original=storage.values.get(storageKey);
    await assert.rejects(()=>fixtureOutbox(storage).checkStatus(account,signed.hash,rpcClient(options),noGuard));assert.equal(storage.values.get(storageKey),original);
    await assert.rejects(()=>fixtureOutbox(storage).acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
  }
});

test("a chain or model change during receipt I/O keeps original bytes and never saves accepted proof",async()=>{
  for(const change of ["chain","model"]){
    const storage=new MemoryStorage();await unknown(storage);const before=storage.values.get(storageKey);let receiptRead=false;
    const remote=rpcClient({envelope:(value,method)=>{
      if(method==="eth_getTransactionReceipt")receiptRead=true;
      if(receiptRead&&change==="chain"&&method==="eth_chainId")return {...value,result:"0x1"};
      if(receiptRead&&change==="model"&&method==="ynx_getDurabilityModel")return {...value,result:{...NATIVE_DURABILITY_MODEL,version:"future"}};
      return value;
    }});
    await assert.rejects(()=>fixtureOutbox(storage).checkStatus(account,signed.hash,remote,noGuard),/could not be verified/);
    assert.equal(receiptRead,true);assert.equal(storage.values.get(storageKey),before);
    await assert.rejects(()=>fixtureOutbox(storage).acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
  }
});

test("a chain change while the final model response awaits cannot save accepted proof or permit Done",async()=>{
  const storage=new MemoryStorage();await unknown(storage);const before=storage.values.get(storageKey);
  const started=deferred<void>(),gate=deferred<void>();let models=0,chain="0x1917";
  const remote=rpcClient({before:async method=>{if(method==="ynx_getDurabilityModel"&&++models===2){started.resolve();await gate.promise}},envelope:(value,method)=>method==="eth_chainId"?{...value,result:chain}:value});
  const pending=fixtureOutbox(storage).checkStatus(account,signed.hash,remote,noGuard);await started.promise;chain="0x1";gate.resolve();
  await assert.rejects(()=>pending,/could not be verified/);assert.equal(storage.values.get(storageKey),before);
  await assert.rejects(()=>fixtureOutbox(storage).acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
});

test("a query begun before lock saves the exact public proof after lock; a queued replacement still cannot sign",async()=>{
  const storage=new MemoryStorage();await unknown(storage);const operations=lifecycle(),lease=operations.scope().begin(),started=deferred<void>(),gate=deferred<void>();
  const remote=rpcClient({before:async method=>{if(method==="eth_getTransactionReceipt"){started.resolve();await gate.promise}}});
  const pending=fixtureOutbox(storage).checkStatus(account,signed.hash,remote,lease.assert);await started.promise;operations.lock();
  const replacement=fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>{throw new Error("must not sign")});gate.resolve();
  assert.equal((await pending).phase,"accepted");assert.equal(lease.isCurrent(),false);await assert.rejects(()=>replacement,NativeOutboxBlocked);
  assert.equal((await fixtureOutbox(storage).read(account))?.phase,"accepted");
});

test("cancellation before status dispatch and stale account/hash/origin reviews issue no RPC",async()=>{
  const storage=new MemoryStorage();await unknown(storage);const before=storage.values.get(storageKey),methods:string[]=[],remote=rpcClient({},methods);
  const operations=lifecycle(),lease=operations.scope().begin();operations.lock();
  await assert.rejects(()=>fixtureOutbox(storage).checkStatus(account,signed.hash,remote,lease.assert),/cancelled/);
  await assert.rejects(()=>fixtureOutbox(storage).checkStatus(to,signed.hash,remote,noGuard),NativeOutboxBlocked);
  await assert.rejects(()=>fixtureOutbox(storage).checkStatus(account,"0x"+"0".repeat(64),remote,noGuard),NativeOutboxBlocked);
  await assert.rejects(()=>fixtureOutbox(storage).checkStatus(account,signed.hash,new NativeChainClient("https://other.example"),noGuard),/different RPC origin/);
  assert.deepEqual(methods,[]);assert.equal(storage.values.get(storageKey),before);
});

test("proof write/readback and Done failures never lose original bytes or permit unacknowledged replacement",async()=>{
  for(const failure of ["write","readback"]){
    const storage=new MemoryStorage();await unknown(storage);
    if(failure==="write")storage.failWrite=storage.writes+1;else storage.failRead=storage.reads+2;
    await assert.rejects(()=>fixtureOutbox(storage).checkStatus(account,signed.hash,rpcClient(),noGuard),NativeOutboxStorageError);
    const loaded=await fixtureOutbox(storage).read(account);assert.equal(loaded?.payload,signed.payload);assert.equal(loaded?.phase,failure==="write"?"unknown":"accepted");
    await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,rpcClient(),noGuard,async()=>signed),NativeOutboxBlocked);
  }
  const storage=new MemoryStorage();await unknown(storage);await fixtureOutbox(storage).checkStatus(account,signed.hash,rpcClient(),noGuard);
  storage.failWrite=storage.writes+1;await assert.rejects(()=>fixtureOutbox(storage).acknowledge(account,signed.hash,noGuard),NativeOutboxStorageError);
  assert.equal((await fixtureOutbox(storage).read(account))?.phase,"accepted");
});

test("tampered saved mined evidence cannot release an unknown-ACK transfer through reload or Done",async()=>{
  const storage=new MemoryStorage();await unknown(storage);await fixtureOutbox(storage).checkStatus(account,signed.hash,rpcClient(),noGuard);const good=storage.values.get(storageKey)!;
  for(const mutate of [(e:any)=>{e.origin="https://other.example"},(e:any)=>{e.capability.consensusFinality=true},(e:any)=>{e.receipt.from=e.receipt.to},(e:any)=>{e.receipt.ynxNativeTransaction.nonce="0x6"},(e:any)=>{e.receipt.ynxDurability.snapshotIntegrity="bad"},(e:any)=>{delete e.receipt.ynxNativeTransaction}]){
    const entry=JSON.parse(good);entry.phase="done";mutate(entry.durabilityEvidence);storage.values.set(storageKey,JSON.stringify(entry));
    assert.equal((await fixtureOutbox(storage).read(account))?.phase,"uncertain");
    await assert.rejects(()=>fixtureOutbox(storage).acknowledge(account,signed.hash,noGuard),NativeOutboxBlocked);
    await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,rpcClient(),noGuard,async()=>signed),NativeOutboxBlocked);
  }
});

for(const failure of ["missing model","unknown model","wrong chain","chain changes during model read"] as const)test(`new send with ${failure} never enters key preparation, signing or POST`,async()=>{
  const storage=new MemoryStorage();let prepares=0,posts=0,modelRead=false;
  const remote=new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{
    if(url.endsWith("/transactions/broadcast")){posts++;return response(success())}
    const {id,method}=JSON.parse(String(init?.body));assert.equal(url,"https://rpc.ynxweb4.com/evm");
    if(method==="ynx_getDurabilityModel"){
      modelRead=true;
      return response({jsonrpc:"2.0",id,...(failure==="missing model"?{error:{code:-32601,message:"Method not found"}}:{result:failure==="unknown model"?{...NATIVE_DURABILITY_MODEL,version:"future"}:NATIVE_DURABILITY_MODEL})});
    }
    assert.equal(method,"eth_chainId");return response({jsonrpc:"2.0",id,result:failure==="wrong chain"||failure==="chain changes during model read"&&modelRead?"0x1":"0x1917"});
  });
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>{prepares++;return createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to,amount:25,nonce:7})}));
  assert.equal(prepares,0,"the callback that would authorize, read a secret and sign is never entered");assert.equal(posts,0);assert.equal(storage.values.size,0);
});

for(const failure of ["missing model","unknown model","wrong chain"] as const)test(`${failure} after signing preserves read-back original bytes and blocks dispatch`,async()=>{
  const storage=new MemoryStorage();let prepares=0,posts=0,afterSign=false;
  const remote=new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{
    if(url.endsWith("/transactions/broadcast")){posts++;return response(success())}
    const {id,method}=JSON.parse(String(init?.body));
    if(afterSign){const saved=JSON.parse(storage.values.get(storageKey)!);assert.equal(saved.phase,"unknown");assert.equal(saved.payload,signed.payload);assert.equal(storage.events.at(-1),"read","exact final dispatch marker readback must precede post-sign capability I/O")}
    if(method==="eth_chainId")return response({jsonrpc:"2.0",id,result:afterSign&&failure==="wrong chain"?"0x1":"0x1917"});
    assert.equal(method,"ynx_getDurabilityModel");
    return response({jsonrpc:"2.0",id,...(afterSign&&failure==="missing model"?{error:{code:-32601,message:"Method not found"}}:{result:afterSign&&failure==="unknown model"?{...NATIVE_DURABILITY_MODEL,version:"future"}:NATIVE_DURABILITY_MODEL})});
  });
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>{prepares++;const prepared=createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to,amount:25,nonce:7});afterSign=true;return prepared}));
  assert.equal(prepares,1);assert.equal(posts,0);const restored=await fixtureOutbox(storage).read(account);
  assert.equal(restored?.phase,"unknown");assert.equal(restored?.attempts,1);assert.equal(restored?.payload,signed.payload);assert.equal(restored?.hash,signed.hash);
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>{prepares++;return signed}),NativeOutboxBlocked);assert.equal(prepares,1);
});

test("missing new-send capability never hides existing queries or explicitly authorized original-byte replay",async()=>{
  const storage=new MemoryStorage();await unknown(storage);const original=storage.values.get(storageKey);let posts=0,prompts=0,modelReads=0;
  const remote=new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{
    if(url.endsWith("/transactions/broadcast")){posts++;assert.equal(init?.body,signed.payload);return response(success(true))}
    const {id,method}=JSON.parse(String(init?.body));if(method==="eth_chainId")return response({jsonrpc:"2.0",id,result:"0x1917"});
    assert.equal(method,"ynx_getDurabilityModel");modelReads++;return response({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}});
  });
  const outbox=fixtureOutbox(storage);await assert.rejects(()=>outbox.sendNew(account,remote,noGuard,async()=>{throw new Error("must never sign replacement")}),NativeOutboxBlocked);assert.equal(storage.values.get(storageKey),original);
  const checked=await outbox.checkStatus(account,signed.hash,remote,noGuard);assert.equal(checked.phase,"unsupported");assert.equal(checked.payload,signed.payload);
  const result=await fixtureOutbox(storage).retry(account,signed.hash,remote,noGuard,async()=>{prompts++});assert.equal(result.phase,"observed");assert.equal(result.payload,signed.payload);assert.equal(posts,1);assert.equal(prompts,1);assert.equal(modelReads,1,"the existing reviewed replay does not depend on the new-send gate");
});

test("capability change during final dispatch-marker storage readback stops the new-send POST",async()=>{
  const storage=new MemoryStorage();let downgraded=false,posts=0,signatures=0;
  storage.afterRead=key=>{const raw=storage.values.get(key);if(raw&&JSON.parse(raw).phase==="unknown")downgraded=true};
  const remote=new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{
    if(url.endsWith("/transactions/broadcast")){posts++;return response(success())}
    const {id,method}=JSON.parse(String(init?.body));return response({jsonrpc:"2.0",id,result:method==="eth_chainId"?"0x1917":downgraded?{...NATIVE_DURABILITY_MODEL,version:"future"}:NATIVE_DURABILITY_MODEL});
  });
  await assert.rejects(()=>fixtureOutbox(storage).sendNew(account,remote,noGuard,async()=>{signatures++;return createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to,amount:25,nonce:7})}));
  assert.equal(downgraded,true);assert.equal(signatures,1);assert.equal(posts,0);
  const original=await fixtureOutbox(storage).read(account);assert.equal(original?.phase,"unknown");assert.equal(original?.payload,signed.payload);assert.equal(original?.hash,signed.hash);
});
