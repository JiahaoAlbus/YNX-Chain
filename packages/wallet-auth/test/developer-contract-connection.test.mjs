import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as sdk from '../src/walletconnect-dapp-connection.js';
import {registerOriginalContractRelayGuard} from '../src/original-ide-contract-relay-guard-core.js';
const methods=['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
const topic='a'.repeat(64),account='0x'+'1'.repeat(40);
const session=(approved=methods)=>({topic,expiry:Math.floor(Date.now()/1000)+300,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{chains:['eip155:6423'],accounts:[`eip155:6423:${account}`],methods:approved,events:[]}}});
function fixture(approved=methods,deadlineMs=30){
 // Explicit PUBLIC native/current seam: not a production guard or approval.
 const relayContext={projectId:'public-project',projectGeneration:1,callerIdentity:'public-peer'},relayGuard={};
 registerOriginalContractRelayGuard(relayGuard,{scope:()=>({...relayContext,kind:'ide-contract-relay-v1',origin:'https://developer.ynxweb4.com',expiresMS:Date.now()+60000,chainId:'eip155:6423',methods:[...methods],relayURL:'wss://relay.walletconnect.org'}),current:()=>true,observe:()=>()=>{},cancel:async()=>true});
 const events=new Map(),calls=[];
 const client={on:(e,f)=>events.set(e,f),session:{getAll:()=>[session(approved)]},request:input=>{calls.push(input);return new Promise((resolve,reject)=>Object.assign(input,{resolve,reject}));},disconnect:async()=>{},core:{pairing:{disconnect:async()=>{}}}};
 const connection=sdk.createDeveloperContractConnection({clientFactory:async()=>client,deadlineMs,relayGuard,relayContext});
 const sent=(i,id,extra={})=>events.get('session_request_sent')({topic,chainId:'eip155:6423',request:calls[i].request,id,...extra});
 return {connection,client,calls,events,sent};
}
const query=()=>({method:methods[2],params:[{version:1,account,operationId:'op_1',refresh:false}]});
test('dedicated developer profile admits exact three methods without widening generic identity or other origins',async()=>{
 assert.equal(typeof sdk.createDeveloperContractConnection,'function');
 assert.throws(()=>new sdk.WalletConnectDAppConnection({origin:'https://developer.ynxweb4.com',methods}),/CONFIGURATION_INVALID/);
 for(const options of [{origin:'https://social.ynxweb4.com'},{methods:['personal_sign']},{profile:'developer-contract'}])assert.throws(()=>sdk.createDeveloperContractConnection(options),/CONFIGURATION_INVALID/);
 const f=fixture();assert.ok(await f.connection.restore());assert.equal(f.calls.length,0);
 for(const approved of [[...methods,'personal_sign'],[...methods,'ynx_requestProductSessionV2'],methods.slice(1)])assert.equal(await fixture(approved).connection.restore(),null);
 await assert.rejects(f.connection.request({method:'personal_sign',params:[]}),/METHOD_NOT_APPROVED/);
});
test('original sent event supplies exact Main key hash; simultaneous equal payloads remain independent',async()=>{
 const f=fixture();await f.connection.restore();
 const a=f.connection.beginContractRequest(query()),b=f.connection.beginContractRequest(query());
 assert.equal(a.snapshot().origin,'https://developer.ynxweb4.com');
 assert.equal(a.snapshot().requestPayloadSHA256,createHash('sha256').update(JSON.stringify(f.calls[0].request)).digest('hex'));
 assert.equal(a.snapshot().originalRequestKeyHash,null);assert.equal(f.calls.length,2);
 f.sent(1,102);f.sent(0,101);
 for(const [handle,id] of [[a,101],[b,102]])assert.equal(handle.snapshot().originalRequestKeyHash,createHash('sha256').update(JSON.stringify([topic,id])).digest('hex'));
 f.calls[0].resolve({operationId:'op_a'});f.calls[1].resolve({operationId:'op_b'});
 assert.deepEqual(await a.outcome,{operationId:'op_a'});assert.deepEqual(await b.outcome,{operationId:'op_b'});
 assert.equal(a.snapshot().state,'fulfilled');assert.ok(Object.isFrozen(a.snapshot()));assert.ok(!JSON.stringify(a.snapshot()).includes(topic));
});
test('timeout preserves UNKNOWN and late original correlation without resend or late success',async()=>{
 const f=fixture();await f.connection.restore();const handle=f.connection.beginContractRequest(query());
 await assert.rejects(handle.outcome,/TIMEOUT/);assert.equal(handle.snapshot().state,'unknown');
 f.sent(0,103);f.calls[0].resolve({operationId:'late'});await new Promise(r=>setTimeout(r,0));
 assert.match(handle.snapshot().originalRequestKeyHash,/^[a-f0-9]{64}$/);assert.equal(handle.snapshot().state,'unknown');assert.equal(f.calls.length,1);
});
test('missing, mismatched, duplicate-conflicting correlation and revoked session never produce success',async()=>{
 for(const mode of ['missing','wrong-object','wrong-chain','conflict','revoke']){
  const f=fixture();await f.connection.restore();const handle=f.connection.beginContractRequest(query());
  if(mode==='wrong-object')f.sent(0,1,{request:{...f.calls[0].request}});
  if(mode==='wrong-chain')f.sent(0,1,{chainId:'eip155:1'});
  if(mode==='conflict'){f.sent(0,1);f.sent(0,2);}
  if(mode==='revoke'){f.sent(0,1);f.events.get('session_delete')({topic});}
  f.calls[0].resolve({operationId:'unqualified'});await assert.rejects(handle.outcome,/CORRELATION|CONTEXT_CHANGED/);assert.equal(handle.snapshot().state,'unknown');assert.equal(f.calls.length,1);
 }
});
test('closed profile bounds copied JSON before sending and cannot accept caller supplied IDs',async()=>{
 const f=fixture();await f.connection.restore();
 for(const input of [{...query(),id:1},{...query(),topic},{method:methods[0],params:[{value:'x'.repeat(65536)}]},{method:'eth_sendTransaction',params:[]}])assert.throws(()=>f.connection.beginContractRequest(input),/SCHEMA|TOO_LARGE|METHOD_NOT_APPROVED/);
 const input=query(),handle=f.connection.beginContractRequest(input);input.params[0].operationId='changed';assert.equal(f.calls[0].request.params[0].operationId,'op_1');
 assert.ok(Object.isFrozen(f.calls[0].request));assert.ok(Object.isFrozen(f.calls[0].request.params[0]));
 f.sent(0,1);f.calls[0].resolve({});await handle.outcome;
});
test('fresh proposal is exactly contract-only and cold restore preserves unrelated identity sessions',async()=>{
 const f=fixture();f.client.session.getAll=()=>[];
 let proposal;
 f.client.connect=async input=>{proposal=input;return {uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:async()=>session()};};
 await f.connection.connect();assert.deepEqual(proposal.requiredNamespaces.eip155.methods,methods);
 assert.deepEqual(proposal.requiredNamespaces.eip155.chains,['eip155:6423']);assert.equal(f.calls.length,0);
 const identity=session(['ynx_requestProductSessionV2']),valid=session(),cold=fixture();
 cold.client.session.getAll=()=>[identity,valid];assert.ok(await cold.connection.restore());assert.equal(identity.namespaces.eip155.methods[0],'ynx_requestProductSessionV2');
 const expired=fixture();expired.client.session.getAll=()=>[{...session(),expiry:1}];assert.equal(await expired.connection.restore(),null);
});
test('original correlation notifies the owning journal before outcome and late subscribers read it immediately',async()=>{
 const f=fixture();await f.connection.restore();const handle=f.connection.beginContractRequest(query()),seen=[];
 assert.equal(typeof handle.onCorrelation,'function');
 const unsubscribe=handle.onCorrelation(value=>seen.push(value));assert.equal(seen.length,0);
 f.sent(0,110);assert.equal(seen.length,1);assert.equal(seen[0].state,'pending');
 f.sent(0,110);assert.equal(seen.length,1);
 const late=[];handle.onCorrelation(value=>late.push(value));assert.equal(late.length,1);assert.equal(late[0].originalRequestKeyHash,seen[0].originalRequestKeyHash);
 handle.onCorrelation(()=>{throw Error('journal failed');});
 unsubscribe();f.sent(0,111);assert.equal(seen.length,1);assert.equal(late.at(-1).correlation,'conflict');
 f.calls[0].resolve({});await assert.rejects(handle.outcome,/CORRELATION/);assert.equal(f.calls.length,1);
});
