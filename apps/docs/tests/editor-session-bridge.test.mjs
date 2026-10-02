import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsEditorBridge} from '../web/editor-session-bridge.js';

function harness(responses, write = true) {
  const storage = new Map(), calls = [], proofScopes = [];
  const adapter = {client: {current: {status: 'connected', session: {sessionBinding: 'session-a', account: 'test-account', scopes: ['docs.read','docs.write','files.read','files.write']}}, disconnect: async () => ({status:'disconnected'})}, close() {},
    createIntrospectionProof: async scopes => {proofScopes.push(scopes); return {proofHeader:`proof-${proofScopes.length}`};}};
  const queues = new Map();
  const environment = {navigator: {locks: {request(name, options, run) { const next = (queues.get(name) || Promise.resolve()).catch(() => {}).then(run); queues.set(name, next); return next; }}}, crypto: {randomUUID: () => 'editor_write_00001'}, localStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{calls.push({url,options}); return responses.shift();}};
  const bridge=createDocsEditorBridge({adapter,environment,configuration:{apiReadEnabled:true,apiWriteEnabled:write}});
  return {bridge,storage,calls,proofScopes,environment,adapter};
}

test('main editor consumes paginated v2 data using exact read scopes',async()=>{
  const h=harness([Response.json({items:[],nextCursor:'cursor',limit:50,scanned:50})]);
  const page=await h.bridge.request('/objects?parentId=&q=');
  assert.equal(page.nextCursor,'cursor');
  assert.deepEqual(h.proofScopes[0],['docs.read','files.read']);
  assert.equal(h.calls[0].options.headers.has('Authorization'),false);
});

test('main editor save persists exact pending operation before the request and clears confirmed receipt',async()=>{
  const h=harness([Response.json({id:'one',version:2})]);
  const result=await h.bridge.request('/objects/one/document',{method:'PUT',body:JSON.stringify({baseVersion:1,content:btoa('draft')})});
  assert.equal(result.version,2);
  assert.deepEqual(h.proofScopes[0],['docs.write','files.write']);
  assert.equal(h.calls[0].options.headers.get('Idempotency-Key'),'editor_write_00001');
  assert.equal(h.storage.size,0);
});

test('unsupported main-editor actions fail before a proof or legacy request is issued',async()=>{
  const h=harness([]);
  await assert.rejects(h.bridge.request('/objects/one/presence',{method:'POST',body:'{}'}),{status:403,code:'V2_ROUTE_NOT_ENABLED'});
  assert.equal(h.calls.length,0);
  assert.equal(h.proofScopes.length,0);
});

test('read-only deployment cannot send main-editor writes',async()=>{
  const h=harness([],false);
  await assert.rejects(h.bridge.request('/objects',{method:'POST',body:'{}'}),{status:403,code:'DOCS_EDIT_AUTHORIZATION_REQUIRED'});
  assert.equal(h.calls.length,0);
});

test('version conflict requires a fresh server-content read before explicit conflict resolution',async()=>{
  const h=harness([Response.json({current:{id:'one',version:3}},{status:409}),new Response('server')]);
  await assert.rejects(h.bridge.request('/objects/one/document',{method:'PUT',body:JSON.stringify({baseVersion:1,content:btoa('draft')})}),{status:409});
  await assert.rejects(h.bridge.resolveReviewedConflict(),/actual server document/);
  await h.bridge.request('/objects/one/content?version=3');
  await h.bridge.resolveReviewedConflict();
  assert.equal(h.storage.size,0);
});

const pendingKey = 'ynx.docs.v2.pending.test-account';
const pendingRecord = (id = 'one') => ({operation:{method:'POST',path:`/api/v1/objects/${id}/trash`,idempotencyKey:`pending_operation_${id}`},blocked:false});

test('reload retry uses only the displayed exact operation and preserves absent body', async () => {
  const h=harness([Response.json({id:'one'})]);
  h.storage.set(pendingKey,JSON.stringify(pendingRecord()));
  const shown=h.bridge.getPendingWrite();
  await h.bridge.retryPendingWrite(shown.snapshot);
  assert.equal(h.calls[0].options.body,undefined);
  assert.equal(h.calls[0].options.headers.has('Content-Type'),false);
  assert.equal(h.calls[0].options.headers.get('Idempotency-Key'),'pending_operation_one');
  assert.equal(h.storage.size,0);
});

test('same-account replacement between display and click never sends another operation', async () => {
  const h=harness([]);
  h.storage.set(pendingKey,JSON.stringify(pendingRecord()));
  const shown=h.bridge.getPendingWrite();
  const replacement=JSON.stringify(pendingRecord('two'));
  h.storage.set(pendingKey,replacement);
  await assert.rejects(h.bridge.retryPendingWrite(shown.snapshot),{code:'PENDING_OPERATION_CHANGED'});
  assert.equal(h.storage.get(pendingKey),replacement);
  assert.equal(h.calls.length,0);
  assert.equal(h.proofScopes.length,0);
});

test('replacement while retry waits for another tab lock is checked inside the lock', async () => {
  const h=harness([]);
  h.storage.set(pendingKey,JSON.stringify(pendingRecord()));
  const shown=h.bridge.getPendingWrite();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const otherTab=h.environment.navigator.locks.request(`ynx.docs.pending:${pendingKey}`,{mode:'exclusive'},()=>gate);
  const retry=h.bridge.retryPendingWrite(shown.snapshot);
  h.storage.set(pendingKey,JSON.stringify(pendingRecord('two')));
  release(); await otherTab;
  await assert.rejects(retry,{code:'PENDING_OPERATION_CHANGED'});
  assert.equal(h.calls.length,0);
});

test('missing atomic locking fails closed before a proof or write', async () => {
  const h=harness([]); delete h.environment.navigator.locks;
  await assert.rejects(h.bridge.request('/objects/one',{method:'PATCH',body:'{"name":"new"}'}),{code:'PENDING_LOCK_UNAVAILABLE'});
  assert.equal(h.calls.length,0); assert.equal(h.storage.size,0);
});

test('duplicate uses all four scopes; comment null remains a readable backend result', async () => {
  const h=harness([Response.json({id:'copy'}),Response.json(null)]);
  await h.bridge.request('/objects/one/duplicate',{method:'POST',body:'{"parentId":""}'});
  assert.deepEqual(h.proofScopes[0],['docs.read','docs.write','files.read','files.write']);
  assert.equal(await h.bridge.request('/objects/one/comments'),null);
});

test('a changed pending record cannot be deleted by older conflict review', async () => {
  const h=harness([Response.json({current:{id:'one',version:3}},{status:409}),new Response('current')]);
  await assert.rejects(h.bridge.request('/objects/one/document',{method:'PUT',body:'{"baseVersion":1,"content":""}'}));
  await h.bridge.request('/objects/one/content?version=3');
  const replacement=JSON.stringify(pendingRecord('two')); h.storage.set(pendingKey,replacement);
  await assert.rejects(h.bridge.resolveReviewedConflict(),/actual server document/);
  assert.equal(h.storage.get(pendingKey),replacement);
});

test('late write receipt after account change retains original account operation and never fills new view',async()=>{
  let finish;
  const response={ok:true,status:200,headers:new Headers(),json:()=>new Promise(resolve=>finish=resolve)};
  const f=harness([response]);const writing=f.bridge.request('/objects/one/document',{method:'PUT',body:'{"baseVersion":1,"content":""}'});
  await new Promise(setImmediate);
  f.adapter.client.current={status:'connected',session:{sessionBinding:'session-b',account:'account-b',scopes:['docs.read','docs.write','files.read','files.write']}};
  finish({id:'one',version:2});await assert.rejects(writing,{code:'SESSION_CHANGED'});
  assert.equal(f.storage.has('ynx.docs.v2.pending.test-account'),true);
  assert.equal(f.storage.has('ynx.docs.v2.pending.account-b'),false);
});
