import assert from 'node:assert/strict';
import test from 'node:test';
import {AIPrivateSession} from '../web/private-session.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(fetcher=async()=>new Response('{}')){
 const calls=[],proofs=[];
 const client={
  current:{status:'connected',session:{sessionBinding:'ai-session-1'}},
  disconnect:async()=>{client.current={status:'disconnected'};return {status:'disconnected',revocationConfirmed:true}},
 };
 let closed=false;
 const adapter={client,close(){closed=true},async createIntrospectionProof(scopes){
  proofs.push(scopes);return {proofHeader:'fresh-proof-'+proofs.length};
 }};
 const session=new AIPrivateSession(adapter,async(url,options)=>{calls.push({url,options});return fetcher(url,options)});
 return {session,adapter,client,calls,proofs,get closed(){return closed}};
}

test('private requests use fresh proofs without legacy credentials, cookies or redirects',async()=>{
 const f=fixture();
 const options={method:'POST',credentials:'include',redirect:'follow',headers:{
  Authorization:'Bearer old-token','X-YNX-Device-ID':'old-device',
  'X-YNX-Product-Session-Proof':'old-proof','X-YNX-Product-Session-Proof-V2':'reused-proof',
  'Content-Type':'application/json',
 },body:JSON.stringify({title:'A conversation'})};
 await f.session.request('/api/conversations','ai:conversations',options);
 await f.session.request('/api/conversations','ai:conversations',options);
 assert.deepEqual(f.proofs,[['ai:conversations'],['ai:conversations']]);
 for(const [index,call] of f.calls.entries()){
  assert.equal(call.url,'https://assistant.ynxweb4.com/api/conversations');
  assert.equal(call.options.headers.get('Authorization'),null);
  assert.equal(call.options.headers.get('X-YNX-Device-ID'),null);
  assert.equal(call.options.headers.get('X-YNX-Product-Session-Proof'),null);
  assert.equal(call.options.headers.get('X-YNX-Product-Session-Proof-V2'),'fresh-proof-'+(index+1));
  assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');
  assert.equal(call.options.cache,'no-store');assert.equal(call.options.body,options.body);
 }
 assert.equal(options.headers.Authorization,'Bearer old-token');
});

test('untrusted destinations and unsupported scopes never mint a proof',async()=>{
 const f=fixture();
 for(const path of ['https://example.com/api/conversations','//example.com/api/conversations','/other','/api/conversations#fragment','https://user@assistant.ynxweb4.com/api/conversations']){
  await assert.rejects(f.session.request(path,'ai:conversations'),/Invalid AI private API request/);
 }
 await assert.rejects(f.session.request('/api/conversations','wallet:sign'),/Invalid AI private API request/);
 assert.equal(f.calls.length,0);assert.equal(f.proofs.length,0);
});

test('a failed write is not retried automatically',async()=>{
 const f=fixture(async()=>{throw new TypeError('network unavailable')});
 await assert.rejects(f.session.request('/api/conversations','ai:conversations',{method:'POST',body:'{}'}),/network unavailable/);
 assert.equal(f.calls.length,1);assert.equal(f.proofs.length,1);
});

test('disconnect during proof creation prevents the later business request',async()=>{
 const proof=deferred(),f=fixture();
 f.adapter.createIntrospectionProof=()=>proof.promise;
 const pending=f.session.request('/api/conversations','ai:conversations');
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await f.session.disconnect();proof.resolve({proofHeader:'late-proof'});
 await rejected;assert.equal(f.calls.length,0);
});

test('disconnect aborts in-flight reads and rejects even a consumer ignoring cancellation',async()=>{
 const data=deferred(),started=deferred(),f=fixture();
 const pending=f.session.request('/api/conversations','ai:conversations',{},async()=>{started.resolve();return data.promise});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await started.promise;await f.session.disconnect();
 assert.equal(f.calls[0].options.signal.aborted,true);
 data.resolve({privateContent:'must not be published'});await rejected;
});

test('session-binding replacement while parsing cannot return old private data',async()=>{
 const f=fixture();
 await assert.rejects(f.session.request('/api/conversations','ai:conversations',{},async()=>{
  f.client.current={status:'connected',session:{sessionBinding:'different-account-session'}};
  return {privateContent:'old-account'};
 }),{name:'AbortError'});
});

test('explicit request cancellation reaches the fetch without consuming another proof',async()=>{
 const f=fixture(async(url,{signal})=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
 }));
 const controller=new AbortController();
 const pending=f.session.request('/api/conversations','ai:conversations',{signal:controller.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await tick();controller.abort();await rejected;
 assert.equal(f.proofs.length,1);assert.equal(f.calls[0].options.signal.aborted,true);
});

test('close releases storage without claiming remote revocation',async()=>{
 const f=fixture();let revoked=false;
 f.client.disconnect=async()=>{revoked=true};
 f.session.close();assert.equal(f.closed,true);assert.equal(revoked,false);
 await assert.rejects(f.session.request('/api/conversations','ai:conversations'),/connected AI private session is required/);
 assert.equal(f.proofs.length,0);
});
