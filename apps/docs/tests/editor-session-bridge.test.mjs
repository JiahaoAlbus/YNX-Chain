import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsEditorBridge} from '../web/editor-session-bridge.js';

function harness(responses, write = true) {
  const storage = new Map(), calls = [], proofScopes = [];
  const adapter = {client: {current: {status: 'connected', session: {sessionBinding: 'session-a', account: 'test-account', scopes: ['docs.read','docs.write','files.read','files.write']}}, disconnect: async () => ({status:'disconnected'})}, close() {},
    createIntrospectionProof: async scopes => {proofScopes.push(scopes); return {proofHeader:`proof-${proofScopes.length}`};}};
  const environment = {crypto: {randomUUID: () => 'editor_write_00001'}, localStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{calls.push({url,options}); return responses.shift();}};
  const bridge=createDocsEditorBridge({adapter,environment,configuration:{apiReadEnabled:true,apiWriteEnabled:write}});
  return {bridge,storage,calls,proofScopes};
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
  await assert.rejects(h.bridge.request('/objects/one',{method:'PATCH',body:'{}'}),{status:403,code:'V2_ROUTE_NOT_ENABLED'});
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
  assert.throws(()=>h.bridge.resolveReviewedConflict(),/actual server document/);
  await h.bridge.request('/objects/one/content?version=3');
  h.bridge.resolveReviewedConflict();
  assert.equal(h.storage.size,0);
});
