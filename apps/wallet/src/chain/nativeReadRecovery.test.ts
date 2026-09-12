import assert from "node:assert/strict";
import test from "node:test";
import {createSignedNativeTransfer,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {NativeBroadcastUnknown,NativeChainClient,NativeReadError,isNativeReadCancelled,loadNativeChainState} from "./nativeTransfer";

const address="0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",otherAddress="0x"+"f".repeat(40);
const account=ynxAddressFromEVM(address),otherAccount=ynxAddressFromEVM(otherAddress);
const rawCancel="FETCH FAILED OKHTTP3.INTERNAL.HTTP2.STREAMRESETEXCEPTION: STREAM WAS RESET CANCEL";
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const recorded=(owner=address)=>response({account:{address:owner,balance:7,nonce:2}});
async function flush(){for(let i=0;i<24;i++)await Promise.resolve()}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}}

// Synthetic public identities and controlled fetch only. No native/device or network calls.
test("one native CANCEL is recovered by one fresh GET with unchanged account binding",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;const attempts:RequestInit[]=[];
  const client=new NativeChainClient(undefined,async(_url,init)=>{attempts.push(init!);if(++calls===1)throw new TypeError(rawCancel);return recorded()});
  const pending=client.account(account);await flush();assert.equal(calls,1);t.mock.timers.tick(249);await flush();assert.equal(calls,1);t.mock.timers.tick(1);
  assert.deepEqual(await pending,{address,balance:7,nonce:2});assert.equal(calls,2);assert.notEqual(attempts[0]!.signal,attempts[1]!.signal);
  assert.ok(attempts.every(x=>x.method==="GET"&&x.redirect==="error"&&x.signal?.aborted));
});

test("activity read recovers once and still filters by the requested account",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;
  const entry={hash:"0x"+"1".repeat(64),type:"transfer",from:address,to:otherAddress,amount:1,fee:1,nonce:1};
  const client=new NativeChainClient(undefined,async()=>{if(++calls===1)throw new TypeError(rawCancel);return response({transactions:[entry,{...entry,from:otherAddress,to:otherAddress}]})});
  const pending=client.activity(account);await flush();t.mock.timers.tick(250);assert.deepEqual(await pending,[entry]);assert.equal(calls,2);
});

test("persistent native transport error ends after two attempts with sanitized state text",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;
  const client=new NativeChainClient(undefined,async()=>{calls++;throw new TypeError(rawCancel)});
  const pending=loadNativeChainState(client,account);await flush();assert.equal(calls,2);t.mock.timers.tick(250);
  const state=await pending;assert.equal(calls,4);assert.equal(state.phase,"failed");assert.equal(state.account,undefined);assert.equal(state.activityPhase,"failed");
  for(const text of [state.error,state.activityError]){assert.match(text!,/network connection was interrupted/i);assert.doesNotMatch(text!,/OKHTTP|STACK|STREAMRESET|CANCEL|FETCH FAILED/i)}
});

test("a transient HTTP 503 retries once even when the error body is not JSON",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;
  const client=new NativeChainClient(undefined,async()=>++calls===1?new Response("<html>temporary maintenance</html>",{status:503}):recorded());
  const pending=client.account(account);await flush();t.mock.timers.tick(250);assert.equal((await pending).address,address);assert.equal(calls,2);
});

test("a nontransient HTTP error cannot inject node-provided text into the UI",async()=>{
  let calls=0;const client=new NativeChainClient(undefined,async()=>{calls++;return response({error:rawCancel+" sensitive server detail"},403)});
  await assert.rejects(()=>client.account(account),(e:unknown)=>e instanceof NativeReadError&&e.httpStatus===403&&!e.retryable&&/403/.test(e.message)&&!e.message.includes(rawCancel));assert.equal(calls,1);
});

test("invalid JSON, origin change and mismatched account do not become retryable",async()=>{
  for(const make of [()=>new Response("not JSON"),()=>Object.defineProperty(recorded(),"url",{value:"https://foreign.invalid/accounts/other"}),()=>recorded(otherAddress)]){
    let calls=0;const client=new NativeChainClient(undefined,async()=>{calls++;return make()});await assert.rejects(()=>client.account(account));assert.equal(calls,1);
  }
});

test("a pre-aborted caller causes zero reads and aggregate returns typed cancellation",async()=>{
  let calls=0;const control=new AbortController();control.abort(new Error("caller-private-reason"));const client=new NativeChainClient(undefined,async()=>{calls++;return recorded()});
  for(const act of [()=>client.account(account,control.signal),()=>client.activity(account,control.signal),()=>loadNativeChainState(client,account,control.signal)])await assert.rejects(act,isNativeReadCancelled);
  assert.equal(calls,0);
});

test("caller cancellation settles a fetch that ignores abort, with no retry",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;let nativeSignal:AbortSignal|undefined;const control=new AbortController();
  const client=new NativeChainClient(undefined,async(_url,init)=>{calls++;nativeSignal=init!.signal!;return new Promise<Response>(()=>{})});
  const result=assert.rejects(()=>client.account(account,control.signal),isNativeReadCancelled);await flush();control.abort();await result;
  assert.equal(nativeSignal?.aborted,true);t.mock.timers.tick(60000);await flush();assert.equal(calls,1);
});

test("caller cancellation during retry backoff prevents a second request",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;const control=new AbortController();const client=new NativeChainClient(undefined,async()=>{calls++;throw new TypeError(rawCancel)});
  const result=assert.rejects(()=>client.account(account,control.signal),isNativeReadCancelled);await flush();control.abort();await result;t.mock.timers.tick(60000);await flush();assert.equal(calls,1);
});

test("cancelling an in-flight response body rejects its late successful value",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const body=deferred<string>();const control=new AbortController();let calls=0,bodyStarted=false;
  const client=new NativeChainClient(undefined,async()=>{calls++;return{ok:true,status:200,redirected:false,url:"",text:()=>{bodyStarted=true;return body.promise}} as Response});
  const result=assert.rejects(()=>client.account(account,control.signal),isNativeReadCancelled);await flush();assert.equal(bodyStarted,true);control.abort();await result;
  body.resolve(JSON.stringify({account:{address,balance:7,nonce:2}}));await flush();t.mock.timers.tick(60000);assert.equal(calls,1);
});

for(const nativeRejectsOnAbort of [false,true])test(`two true deadlines are bounded and typed; native abort rejection=${nativeRejectsOnAbort}`,async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0;const signals:AbortSignal[]=[];
  const client=new NativeChainClient(undefined,async(_url,init)=>{calls++;signals.push(init!.signal!);return new Promise<Response>((_resolve,reject)=>{if(nativeRejectsOnAbort)init!.signal!.addEventListener("abort",()=>reject(new TypeError(rawCancel)),{once:true})})});
  const result=assert.rejects(()=>client.account(account),(e:unknown)=>e instanceof NativeReadError&&e.code==="NATIVE_READ_TIMEOUT"&&!e.message.includes(rawCancel));
  await flush();t.mock.timers.tick(15000);await flush();assert.equal(calls,1);t.mock.timers.tick(250);await flush();assert.equal(calls,2);t.mock.timers.tick(15000);await result;
  assert.equal(calls,2);assert.ok(signals.every(x=>x.aborted));
});

test("a timed-out old response body cannot replace a newer retry response",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const body=deferred<string>();let calls=0;
  const client=new NativeChainClient(undefined,async()=>++calls===1?{ok:true,status:200,url:"",redirected:false,text:()=>body.promise} as Response:recorded());
  const pending=client.account(account);await flush();t.mock.timers.tick(15000);await flush();t.mock.timers.tick(250);const value=await pending;assert.equal(value.balance,7);
  body.resolve(JSON.stringify({account:{address,balance:999,nonce:999}}));await flush();assert.deepEqual(value,{address,balance:7,nonce:2});assert.equal(calls,2);
});

test("cancelled old-account aggregate cannot publish after a new-account refresh",async()=>{
  const old=deferred<Response>(),control=new AbortController();let calls=0;
  const client=new NativeChainClient(undefined,async url=>{calls++;if(calls<=2)return old.promise;return url.includes("/accounts/")?recorded(otherAddress):response({transactions:[]})});
  const first=assert.rejects(()=>loadNativeChainState(client,account,control.signal),isNativeReadCancelled);await flush();control.abort();
  const latest=await loadNativeChainState(client,otherAccount,new AbortController().signal);assert.equal(latest.phase,"ready");assert.equal(latest.account?.address,otherAddress);await first;
  old.resolve(recorded());await flush();assert.equal(calls,4);assert.equal(latest.account?.address,otherAddress);
});

test("repeated same-account refresh cancellation does not cancel its replacement",async()=>{
  const first=deferred<Response>(),control=new AbortController();let calls=0;
  const client=new NativeChainClient(undefined,async()=>++calls===1?first.promise:recorded());const stale=assert.rejects(()=>client.account(account,control.signal),isNativeReadCancelled);await flush();control.abort();
  assert.equal((await client.account(account,new AbortController().signal)).balance,7);await stale;first.resolve(recorded(otherAddress));await flush();assert.equal(calls,2);
});

test("completed attempts detach caller abort listeners",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let calls=0,added=0,removed=0;const control=new AbortController(),signal=control.signal;
  const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
  t.mock.method(signal,"addEventListener",(...args:Parameters<AbortSignal["addEventListener"]>)=>{added++;add(...args)});
  t.mock.method(signal,"removeEventListener",(...args:Parameters<AbortSignal["removeEventListener"]>)=>{removed++;remove(...args)});
  const client=new NativeChainClient(undefined,async()=>{if(++calls===1)throw new TypeError(rawCancel);return recorded()});
  const pending=client.account(account,signal);await flush();t.mock.timers.tick(250);await pending;assert.equal(added,3);assert.equal(removed,added);control.abort();assert.equal(calls,2);
});

test("signed broadcast and durability RPC POST remain one attempt on transport failure",async()=>{
  const signed=createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to:otherAccount,amount:1,nonce:3});const calls:{url:string;init?:RequestInit}[]=[];
  const client=new NativeChainClient(undefined,async(url,init)=>{calls.push({url,init});throw new TypeError(rawCancel)});
  await assert.rejects(()=>client.broadcast(signed.payload,signed.transaction,signed.hash),NativeBroadcastUnknown);assert.equal(calls.length,1);assert.equal(calls[0]!.init?.body,signed.payload);
  await assert.rejects(()=>client.requireDurabilityCapability());assert.equal(calls.length,2);assert.ok(calls.every(x=>x.init?.method==="POST"));
});

test("an expired attempt refuses to read a fetch response arriving after its retry",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const first=deferred<Response>();let calls=0,lateBodyReads=0;
  const client=new NativeChainClient(undefined,async()=>++calls===1?first.promise:recorded());
  const pending=client.account(account);await flush();t.mock.timers.tick(15000);await flush();t.mock.timers.tick(250);assert.equal((await pending).balance,7);
  first.resolve({ok:true,status:200,url:"",redirected:false,text:async()=>{lateBodyReads++;return JSON.stringify({account:{address,balance:999,nonce:9}})}} as Response);
  await flush();assert.equal(lateBodyReads,0);assert.equal(calls,2);
});
