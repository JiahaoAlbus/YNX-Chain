import test from 'node:test';
import assert from 'node:assert/strict';
import {registerOriginalContractRelayGuard,CONTRACT_RELAY_METHODS} from '../src/original-ide-contract-relay-guard-core.js';
const sdk=await import(process.env.CONTRACT_RELAY_TEST_SOURCE??'../src/walletconnect-dapp-connection.js');
// PUBLIC DATA/native seam only: no Native issuer, Root, live Relay or approval.
const context=Object.freeze({projectId:'project-public',projectGeneration:1,callerIdentity:'public-original-peer'});
const scopeExpiresMS=Date.now()+60000;
const scope=()=>({...context,kind:'ide-contract-relay-v1',origin:'https://developer.ynxweb4.com',expiresMS:scopeExpiresMS,chainId:'eip155:6423',methods:[...CONTRACT_RELAY_METHODS],relayURL:'wss://relay.walletconnect.org'});
const account='0x'+'1'.repeat(40),topic='a'.repeat(64);
const session=()=>({topic,expiry:Math.floor(Date.now()/1000)+300,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{chains:['eip155:6423'],methods:[...CONTRACT_RELAY_METHODS],accounts:[`eip155:6423:${account}`],events:[]}}});
const query=()=>({method:CONTRACT_RELAY_METHODS[2],params:[{version:1,account,operationId:'public-op',refresh:false}]});
function fixture(changes={}){
  let active=true,notify=()=>{},factories=0,options,pending,cancels=0,unsubscribes=0;
  const guard=Object.freeze({}),events=new Map();
  registerOriginalContractRelayGuard(guard,{scope:()=>({...scope(),...changes}),current:()=>active,observe:f=>{notify=f;return()=>{unsubscribes++;};},cancel:async()=>{cancels++;active=false;return true;}});
  const client={on:(e,f)=>events.set(e,f),session:{getAll:()=>[session()]},request:input=>new Promise(resolve=>{pending={input,resolve};}),disconnect:async()=>{},core:{pairing:{disconnect:async()=>{}}}};
  const connection=sdk.createDeveloperContractConnection({relayGuard:guard,relayContext:context,clientFactory:async opts=>{factories++;options=opts;return client;},deadlineMs:100});
  return {connection,client,guard,events,get factories(){return factories;},get cancels(){return cancels;},get unsubscribes(){return unsubscribes;},get options(){return options;},get pending(){return pending;},revoke:()=>{active=false;notify();}};
}
test('default denies missing and fabricated guards before actual factory or store reads',async()=>{
  for(const relayGuard of [undefined,{},Object.freeze({current:true,granted:true})]){
    let io=0;const connection=sdk.createDeveloperContractConnection({...(relayGuard===undefined?{}:{relayGuard,relayContext:context}),clientFactory:async()=>{io++;throw Error('PUBLIC_FACTORY_WAS_REACHED');}});
    assert.equal(io,0);assert.equal(connection.cleanupSnapshot().initialization,'not-started');
    await assert.rejects(connection.initialize(),/YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE/);assert.equal(io,0);
    await assert.rejects(connection.restore(),/YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE/);assert.equal(io,0);
  }
});
test('DATA seam rejects changed scope, expiry, extra methods and non-original current before IO',async()=>{
  for(const changes of [{projectId:'other'},{projectGeneration:2},{callerIdentity:'other'},{origin:'https://social.ynxweb4.com'},{chainId:'eip155:1'},{relayURL:'wss://other.invalid'},{methods:[...CONTRACT_RELAY_METHODS,'personal_sign']},{expiresMS:1}]){
    const f=fixture(changes);await assert.rejects(f.connection.restore(),/GUARD_SCOPE_INVALID/);assert.equal(f.factories,0);
  }
  const f=fixture();f.revoke();await assert.rejects(f.connection.restore(),/GUARD_UNAVAILABLE/);assert.equal(f.factories,0);
});
test('DATA current guard constrains exact endpoint and telemetry, hides raw client and partitions project store',async()=>{
  const f=fixture();assert.equal(f.factories,0);assert.equal(await f.connection.initialize(),undefined);
  assert.equal(f.options.relayUrl,'wss://relay.walletconnect.org');assert.equal(f.options.telemetryEnabled,false);
  assert.match(f.options.storageOptions.database,/^ynx-contract-[0-9a-f]{64}$/);
  assert.ok(await f.connection.restore());assert.deepEqual(await f.connection.request({method:'eth_accounts'}),[account]);assert.equal(f.factories,1);
});
test('DATA revocation fences pending outcome, retains original correlation and never resends',async()=>{
  const f=fixture();await f.connection.restore();const handle=f.connection.beginContractRequest(query());
  f.events.get('session_request_sent')({topic,chainId:'eip155:6423',id:1,request:f.pending.input.request});
  const original=handle.snapshot().originalRequestKeyHash;assert.match(original,/^[0-9a-f]{64}$/);
  f.revoke();f.pending.resolve({unqualified:true});await assert.rejects(handle.outcome,/CONTEXT_CHANGED/);
  assert.equal(handle.snapshot().state,'unknown');assert.equal(handle.snapshot().originalRequestKeyHash,original);assert.equal(handle.snapshot().replayAllowed,false);
  assert.throws(()=>f.connection.beginContractRequest(query()),/GUARD_UNAVAILABLE/);assert.equal(f.factories,1);
});
test('DATA current checks are repeated after asynchronous factory initialization',async()=>{
  let settle,active=true,io=0;const guard={};
  registerOriginalContractRelayGuard(guard,{scope,current:()=>active,observe:()=>()=>{},cancel:async()=>true});
  const connection=sdk.createDeveloperContractConnection({relayGuard:guard,relayContext:context,clientFactory:()=>{io++;return new Promise(resolve=>{settle=resolve;});}});
  const work=connection.initialize();while(!settle)await new Promise(r=>setImmediate(r));active=false;settle({});
  await assert.rejects(work,/GUARD_UNAVAILABLE/);assert.equal(io,1);
});
test('PUBLIC rejected transport disconnect still invalidates original Native guard once and preserves first failure',async()=>{
  const f=fixture();await f.connection.restore();let remoteCalls=0;
  const original=Object.assign(Error('PUBLIC_TRANSPORT_DISCONNECT_REJECTED'),{code:'YNX_PAIR_CLEANUP_UNAVAILABLE'});
  f.client.disconnect=async()=>{remoteCalls++;throw original;};
  await assert.rejects(f.connection.disconnect(),error=>error===original);
  assert.equal(remoteCalls,1);assert.equal(f.cancels,1);assert.equal(f.unsubscribes,1);
  assert.equal(f.connection.cleanupSnapshot().cleanup,'unknown');assert.equal(f.connection.cleanupSnapshot().firstCause.code,'YNX_PAIR_CLEANUP_UNAVAILABLE');
  await assert.rejects(f.connection.restore(),/GUARD_UNAVAILABLE/);assert.equal(remoteCalls,1);
});
test('PUBLIC secondary Native cancellation or observer failure cannot replace original disconnect error',async()=>{
  for(const failAt of ['cancel','unsubscribe']){
    let cancels=0,off=0;const f=fixture(),original=Object.assign(Error('PUBLIC_ORIGINAL_TRANSPORT_FAILURE'),{code:'YNX_PAIR_CLEANUP_UNAVAILABLE'});
    registerOriginalContractRelayGuard(f.guard,{scope,current:()=>true,observe:()=>()=>{off++;if(failAt==='unsubscribe')throw Error('PUBLIC_OBSERVER_FAILURE');},cancel:async()=>{cancels++;if(failAt==='cancel')throw Error('PUBLIC_NATIVE_CANCEL_FAILURE');return true;}});
    await f.connection.restore();f.client.disconnect=async()=>{throw original;};
    await assert.rejects(f.connection.disconnect(),error=>error===original);assert.equal(cancels,1);assert.equal(off,1);
    assert.equal(f.connection.cleanupSnapshot().cleanup,'unknown');assert.equal(f.connection.cleanupSnapshot().firstCause.code,'YNX_PAIR_CLEANUP_UNAVAILABLE');
  }
});
