import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsAuthorization} from '../web/editor-authorization.js';

const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
function fixture() {
  const listeners = new Map(), events = [], changed = [];
  const client = {current:{status:'guest'}, async beginExplicit(){events.push('begin');return {route:{status:'ready',url:'ynxwallet://request'}};}, async handleReturn(){events.push('return');return client.current={status:'connected'};},async restore(){return client.current;},async disconnect(){events.push('revoke');return client.current={status:'disconnected'};}};
  const provider = {on:(name,fn)=>listeners.set(name,fn),removeListener:(name)=>listeners.delete(name),async request(input){events.push(input.method);return {version:2,returnUrl:'https://docs.ynxweb4.com/wallet-auth/callback?fixture'};}};
  const controller = createDocsAuthorization({adapter:{client,close(){}}, discover:async()=>({ynx:{provider}}),environment:{},changed:s=>changed.push(s.status)});
  return {controller,client,provider,listeners,events,changed};
}
test('explicit YNX approval invokes only canonical V2 and reports confirmed state',async()=>{
  const h=fixture();assert.equal((await h.controller.approve()).status,'connected');
  assert.deepEqual(h.events,['begin','ynx_requestProductSessionV2','return']);assert.equal(h.controller.pending,false);
});
test('cancel before wallet return fences old callback; next explicit click can approve',async()=>{
  const h=fixture(), hold=deferred();h.provider.request=()=>hold.promise;
  const old=h.controller.approve();await new Promise(setImmediate);await h.controller.cancel();
  hold.resolve({version:2,returnUrl:'old'});assert.equal(await old,null);assert.equal(h.events.includes('return'),false);
  h.provider.request=async()=>({version:2,returnUrl:'new'});assert.equal((await h.controller.approve()).status,'connected');
});
test('account change during completion waits for SDK revoke and never renders late grant',async()=>{
  const h=fixture(), hold=deferred();let returning;
  h.client.handleReturn=()=>returning=hold.promise.then(()=>h.client.current={status:'connected'});
  h.client.disconnect=async()=>{await returning;return h.client.current={status:'disconnected'};};
  const old=h.controller.approve();await new Promise(setImmediate);h.listeners.get('accountsChanged')();
  hold.resolve();assert.equal(await old,null);await new Promise(setImmediate);
  assert.equal(h.client.current.status,'disconnected');assert.equal(h.changed.includes('connected'),false);
});
test('unconfirmed revocation survives cancel and blocks new request',async()=>{
  const h=fixture(), hold=deferred();h.provider.request=()=>hold.promise;
  const old=h.controller.approve();await new Promise(setImmediate);
  h.client.disconnect=async()=>h.client.current={status:'retry-required',revocationPending:true};
  await h.controller.cancel();hold.resolve({version:2,returnUrl:'old'});await old;
  await assert.rejects(h.controller.approve(),{code:'REVOCATION_PENDING'});assert.equal(h.events.filter(x=>x==='begin').length,1);
});
test('two retries waiting on same cancellation do not create duplicate requests',async()=>{
  const h=fixture(), hold=deferred();h.client.disconnect=()=>hold.promise;
  const cancelling=h.controller.cancel(true),a=h.controller.approve(),b=h.controller.approve();
  hold.resolve(h.client.current={status:'disconnected'});await cancelling;await Promise.all([a,b]);
  assert.equal(h.events.filter(x=>x==='begin').length,1);
});

test('cancel during discovery never revokes an unrelated previously connected grant',async()=>{
  const hold=deferred(), events=[], client={current:{status:'connected'},disconnect:async()=>events.push('revoke')};
  const controller=createDocsAuthorization({adapter:{client,close(){}},discover:()=>hold.promise,environment:{}});
  const pending=controller.approve();await controller.cancel();hold.resolve({ynx:null});
  assert.equal(await pending,null);assert.deepEqual(events,[]);
});

test('account-change cancellation suspends visible identity before SDK persistence settles',async()=>{
  const h=fixture(), hold=deferred();h.client.current={status:'connected'};h.client.disconnect=()=>hold.promise;
  const cancellation=h.controller.cancel(true);
  assert.equal(h.changed.at(-1),'retry-required');assert.equal(h.controller.revocationPending,true);
  assert.equal(await h.controller.restore(),null);
  hold.resolve(h.client.current={status:'disconnected'});await cancellation;
  assert.equal(h.controller.revocationPending,false);
});

test('cold authoritative restore observes later provider account changes without requesting new approval',async()=>{
  const h=fixture();h.client.current={status:'connected'};
  await h.controller.restore();assert.deepEqual(h.events,[]);
  h.listeners.get('accountsChanged')();await new Promise(setImmediate);
  assert.equal(h.client.current.status,'disconnected');assert.deepEqual(h.events,['revoke']);
});
