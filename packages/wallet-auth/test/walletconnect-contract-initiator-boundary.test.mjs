import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as signModule from '@walletconnect/sign-client';
import {Core,RELAYER_SDK_VERSION} from '@walletconnect/core';
import {engineEvent} from '@walletconnect/utils';
const {installContractInitiatorBoundary}=await import(process.env.YNX_INITIATOR_BOUNDARY_MODULE??'../src/walletconnect-contract-initiator-boundary.js');
import {verifyContractInitiatorRuntime} from '../src/walletconnect-contract-initiator-boundary-node.js';

// Actual locked Core, SignClient, crypto and engine. PUBLIC memory storage and
// no-start transport/Verify sinks only; no Relay, Native, user DB or approval.
async function fixture({install=true,cancel=async()=>true,close}={}){
 const prefix='PUBLIC-initiator-'+randomUUID(),key='_walletConnectCore_'+prefix,countKey=key+'_count';
 assert.equal(globalThis[key],undefined);assert.equal(globalThis[countKey],undefined);
 const store=new Map(),storage={getItem:async k=>store.get(k),setItem:async(k,v)=>{store.set(k,v);},removeItem:async k=>{store.delete(k);},getKeys:async()=>[...store.keys()],getEntries:async()=>[...store.entries()]};
 const core=new Core({customStoragePrefix:prefix,storage,logger:'silent',telemetryEnabled:false});
 assert.equal(core.initialized,false);assert.equal(core.relayer.initialized,false);
 const client=new signModule.SignClient({core,logger:'silent',metadata:{name:'PUBLIC memory/no-start',description:'PUBLIC',url:'https://developer.ynxweb4.com',icons:[]}});
 assert.equal(client.engine.initialized,false);
 await Promise.all([core.crypto.init(),core.history.init(),core.expirer.init(),client.auth.authKeys.init(),client.proposal.init(),client.session.init()]);
 const topic=await core.crypto.setSymKey('22'.repeat(32));
 const calls={decode:0,verify:0,history:0,dispatch:0,emit:0,cancel:0,close:0,open:0};let epoch=1,lastDecoded,hold=null,owned=true,currentAction=null,boundary;
 const actualDecode=core.crypto.decode.bind(core.crypto);
 core.crypto.decode=async(...args)=>{calls.decode++;lastDecoded=await actualDecode(...args);if(hold)await hold;return lastDecoded;};
 // A RED baseline can reach Verify without ever using the real global fetch.
 core.verify.resolve=async()=>{calls.verify++;throw Error('PUBLIC_VERIFY_WOULD_HAVE_FETCHED');};
 core.relayer.transportClose=async()=>{calls.close++;if(close)return close();};
 core.relayer.transportOpen=async()=>{calls.open++;};
 core.relayer.restartTransport=async()=>{calls.open++;};
 core.relayer.messages.ack=async()=>{};
 const actualHistory=core.history.set.bind(core.history);core.history.set=(...args)=>{calls.history++;return actualHistory(...args);};
 const actualDispatch=client.engine.processRequest.bind(client.engine);client.engine.processRequest=(...args)=>{calls.dispatch++;return actualDispatch(...args);};
 client.on('session_proposal',()=>{calls.emit++;});client.on('session_request',()=>{calls.emit++;});client.on('session_authenticate',()=>{calls.emit++;});
 const opts={lockedVersion:RELAYER_SDK_VERSION,current:()=>{currentAction?.();return epoch;},ownsCore:()=>owned&&globalThis[key]===core&&globalThis[countKey]===1,onTerminal:()=>{epoch++;},cancelGuard:()=>{calls.cancel++;return cancel();},drainDeadlineMs:40};
 if(install)boundary=installContractInitiatorBoundary(core,opts);
 const f={core,client,calls,topic,get boundary(){return boundary;},get decoded(){return lastDecoded;},install:()=>boundary=installContractInitiatorBoundary(core,opts),change:()=>{epoch++;},disown:()=>{owned=false;},setCurrentAction:f=>{currentAction=f;},hold:p=>{hold=p;},encode:payload=>core.crypto.encode(topic,payload),route:async payload=>{const message=await core.crypto.encode(topic,payload);await client.engine.onRelayMessage({topic,message,attestation:undefined,transportType:'relay'});},cleanup:()=>{assert.equal(core.initialized,false);assert.equal(core.relayer.initialized,false);assert.equal(client.engine.initialized,false);assert.equal(globalThis[key],core);delete globalThis[key];assert.equal(globalThis[countKey],1);delete globalThis[countKey];}};
 return f;
}
const proposed=()=>({jsonrpc:'2.0',id:17,method:'wc_sessionPropose',params:{relays:[{protocol:'irn'}],requiredNamespaces:{},optionalNamespaces:{eip155:{chains:['eip155:6423'],methods:['ynx_getPQContractOriginal'],events:[]}},proposer:{publicKey:'11'.repeat(32),metadata:{name:'PUBLIC',description:'PUBLIC',url:'https://wallet.ynxweb4.com',icons:[]}},expiryTimestamp:Math.floor(Date.now()/1000)+300}});

test('actual Node CJS named SignClient is the static-init class; CJS default object is not',()=>{
 assert.equal(verifyContractInitiatorRuntime(),true);assert.equal(RELAYER_SDK_VERSION,'2.23.10');
 assert.equal(typeof signModule.default,'object');assert.equal(typeof signModule.default.init,'undefined');
 assert.equal(typeof signModule.SignClient,'function');assert.equal(typeof signModule.SignClient.init,'function');
});
test('actual engine resolver-only throw is caught and still emits proposal (PUBLIC no-fetch RED baseline)',async()=>{
 const f=await fixture({install:false});try{await f.route(proposed());assert.equal(f.calls.verify,1);assert.equal(f.calls.history,1);assert.equal(f.calls.dispatch,1);assert.equal(f.calls.emit,1);}finally{f.cleanup();}
});
test('actual crypto/engine reject all three non-role requests before history/dispatch/emit or Verify',async()=>{
 for(const method of ['wc_sessionPropose','wc_sessionRequest','wc_sessionAuthenticate']){
  const f=await fixture({install:process.env.YNX_INITIATOR_RED!=='1'});try{
   await f.route({...proposed(),method});assert.equal(f.calls.decode,1);assert.equal(f.calls.history,0);assert.equal(f.calls.dispatch,0);assert.equal(f.calls.emit,0);assert.equal(f.calls.verify,0);
   assert.equal(f.boundary.snapshot().terminal,true);await f.boundary.drain();assert.equal(f.calls.cancel,1);assert.equal(f.calls.close,1);
   assert.equal(f.boundary.snapshot().remoteCleanup,'not-proven');assert.equal(f.boundary.snapshot().replayAllowed,false);
  }finally{f.cleanup();}
 }
});
test('actual crypto preserves original response/settle/event objects and original engine settles response',async()=>{
 const f=await fixture();try{
  for(const payload of [{jsonrpc:'2.0',id:3,result:{operationId:'PUBLIC-op'}},{jsonrpc:'2.0',id:4,method:'wc_sessionSettle',params:{PUBLIC:true}},{jsonrpc:'2.0',id:5,method:'wc_sessionEvent',params:{event:{name:'accountsChanged',data:[]}}}]){
   const encoded=await f.encode(payload),decoded=await f.core.crypto.decode(f.topic,encoded);assert.equal(decoded,f.decoded);assert.deepEqual(decoded,payload);
  }
  const id=8,payload={jsonrpc:'2.0',id,result:{operationId:'PUBLIC-original-result'}},seen=[];
  f.core.history.set(f.topic,{jsonrpc:'2.0',id,method:'wc_sessionRequest',params:{}});f.client.engine.events.on(engineEvent('session_request',id),value=>seen.push(value));
  await f.route(payload);assert.equal(seen.length,1);assert.equal(seen[0].result,f.decoded.result);assert.deepEqual(seen[0].result,payload.result);
  assert.equal(f.calls.verify,0);assert.equal(f.calls.cancel,0);assert.equal(f.boundary.snapshot().terminal,false);
 }finally{f.cleanup();}
});
test('actual original decode late return is fenced on current epoch change',async()=>{
 const f=await fixture();try{
  let release;f.hold(new Promise(r=>{release=r;}));const encoded=await f.encode({jsonrpc:'2.0',id:1,result:true}),work=f.core.crypto.decode(f.topic,encoded);
  while(!f.decoded)await new Promise(r=>setImmediate(r));f.change();release();await assert.rejects(work,/CONTEXT_CHANGED/);await f.boundary.drain();assert.equal(f.calls.cancel,1);assert.equal(f.calls.close,1);
 }finally{f.cleanup();}
});
test('synchronous revoke inside original current prevents transportOpen AND original decode from starting',async()=>{
 for(const operation of ['open','decode']){
  const f=await fixture();try{
   const cause=Object.assign(Error('PUBLIC_NATIVE_REVOKED_DURING_CURRENT'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'});f.setCurrentAction(()=>f.boundary.terminate(cause));
   if(operation==='open')assert.throws(()=>f.core.relayer.transportOpen(),e=>e===cause);
   else await assert.rejects(f.core.crypto.decode(f.topic,await f.encode({jsonrpc:'2.0',id:1,result:true})),e=>e===cause);
   await f.boundary.drain();assert.equal(f.calls.open,0);assert.equal(f.calls.decode,0);assert.equal(f.calls.cancel,1);assert.equal(f.calls.close,1);
  }finally{f.cleanup();}
 }
});
test('direct Verify resolve denies without calling original; cancel failure stays UNKNOWN after successful drain',async()=>{
 const f=await fixture({cancel:async()=>{throw Error('PUBLIC_CANCEL_FAILED');}});try{
  await assert.rejects(f.core.verify.resolve({}),/VERIFY_FORBIDDEN/);await f.boundary.drain();await new Promise(r=>setImmediate(r));
  assert.equal(f.calls.verify,0);assert.equal(f.calls.cancel,1);assert.equal(f.calls.close,1);assert.equal(f.boundary.snapshot().cancel,'unknown');assert.equal(f.boundary.snapshot().cleanup,'unknown');
  await assert.rejects(f.core.verify.resolve({}),/VERIFY_FORBIDDEN/);await f.boundary.drain();assert.equal(f.calls.close,1);assert.equal(f.calls.cancel,1);
 }finally{f.cleanup();}
});
test('lost original Core ownership refuses decode and leaves foreign transport untouched',async()=>{
 const f=await fixture();try{f.disown();await assert.rejects(f.core.crypto.decode(f.topic,'PUBLIC-not-decrypted'),/CORE_NOT_OWNED/);await assert.rejects(f.boundary.drain(),/CORE_NOT_OWNED/);assert.equal(f.calls.decode,0);assert.equal(f.calls.close,0);assert.equal(f.boundary.snapshot().cleanup,'unknown');}finally{f.cleanup();}
});
