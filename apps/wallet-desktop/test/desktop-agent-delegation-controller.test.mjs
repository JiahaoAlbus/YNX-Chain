import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopAgentDelegationController as create} from '../src/desktop-agent-delegation-controller.mjs';
const active=()=>({account:'PUBLIC-A',revision:1,locked:false});
const code=expected=>error=>error?.code===expected;
const deferred=()=>Promise.withResolvers();

test('unavailable management stays unavailable rather than a successful empty list',async()=>{
 const api=create({getContext:active});assert.deepEqual(await api.readProjection(),{state:'unavailable'});
});
test('locked context never calls management, and a successful empty projection is preserved',async()=>{
 let c={...active(),locked:true},calls=0;const empty={account:c.account,delegations:[],operations:[]};
 const api=create({getContext:()=>c,management:{readProjection:async()=>{calls++;return empty}}});
 assert.deepEqual(await api.readProjection(),{state:'locked'});assert.equal(calls,0);
 c=active();assert.equal(await api.readProjection(),empty);assert.equal(calls,1);
});
test('late account-switch result is discarded and must clean up before another account reads',async()=>{
 let c=active();const d=deferred();const api=create({getContext:()=>c,management:{readProjection:()=>d.promise,cancelView:async()=>true}});
 const pending=api.readProjection();c={...c,account:'PUBLIC-B'};d.resolve({account:'PUBLIC-A',delegations:[]});
 await assert.rejects(pending,code('AGENT_CONTEXT_CHANGED'));await assert.rejects(api.readProjection(),code('AGENT_CLEANUP_REQUIRED'));
 assert.equal(await api.cancelView(),true);
});
test('late mutation retains its original UNKNOWN reference without allowing replacement issue',async()=>{
 let c=active();const d=deferred();let issues=0,recovered;
 const api=create({getContext:()=>c,management:{reviewDraft:()=>{issues++;return d.promise},cancelView:async()=>true,recoverOperation:async id=>(recovered=id,{state:'unknown',operationId:id})}});
 const pending=api.reviewDraft({agent:'PUBLIC-agent'});c={...c,locked:true};d.resolve({state:'unknown',operationId:'PUBLIC-original'});
 await assert.rejects(pending,code('AGENT_CONTEXT_CHANGED'));await api.cancelView();c=active();
 await assert.rejects(api.reviewDraft({}),code('AGENT_ORIGINAL_RECOVERY_REQUIRED'));
 assert.equal((await api.recoverOperation('PUBLIC-original')).state,'unknown');assert.equal(recovered,'PUBLIC-original');assert.equal(issues,1);
});
test('only exact retained original can be recovered and another account cannot query it',async()=>{
 let c=active(),queries=0;const api=create({getContext:()=>c,management:{readProjection:async()=>({account:'PUBLIC-A',delegations:[],operations:[{id:'PUBLIC-original',state:'unknown',recoverable:true}]}),recoverOperation:async()=>{queries++;return{state:'unknown',operationId:'PUBLIC-original'}}}});
 await api.readProjection();assert.throws(()=>api.recoverOperation('replacement'),code('AGENT_ORIGINAL_OPERATION_REQUIRED'));
 c={...c,account:'PUBLIC-B'};assert.throws(()=>api.recoverOperation('PUBLIC-original'),code('AGENT_ORIGINAL_OPERATION_REQUIRED'));assert.equal(queries,0);
});
test('a staged original review is not success and blocks duplicate staging until clean cancellation',async()=>{
 let requests=0;const api=create({getContext:active,management:{reviewAction:async()=>{requests++;return{state:'review',operationId:'PUBLIC-review'}},cancelView:async()=>true}});
 assert.equal((await api.reviewAction({rowId:'PUBLIC-grant',action:'pause'})).state,'review');
 await assert.rejects(api.reviewAction({rowId:'PUBLIC-grant',action:'revoke'}),code('AGENT_REVIEW_IN_PROGRESS'));assert.equal(requests,1);
 await api.cancelView();assert.equal((await api.reviewAction({rowId:'PUBLIC-grant',action:'revoke'})).state,'review');
});
test('cleanup debt and cleanup exceptions cannot reopen the action path',async()=>{
 for(const result of [false,undefined]){
  const api=create({getContext:active,management:{readProjection:async()=>({delegations:[]}),cancelView:async()=>result}});
  assert.equal(await api.cancelView(),false);await assert.rejects(api.readProjection(),code('AGENT_CLEANUP_REQUIRED'));
 }
 const api=create({getContext:active,management:{readProjection:async()=>({}),cancelView:async()=>{throw Error('cleanup failed')}}});
 await assert.rejects(api.cancelView(),/cleanup failed/);await assert.rejects(api.readProjection(),code('AGENT_CLEANUP_REQUIRED'));
});
test('absent authority is distinct from a transport failure',async()=>{
 const missing=create({getContext:active,management:{readProjection:async()=>{throw Object.assign(Error('missing'),{code:'REVIEWED_RELEASE_NOT_SUPPLIED'})}}});
 assert.deepEqual(await missing.readProjection(),{state:'unavailable'});
 const failed=create({getContext:active,management:{readProjection:async()=>{throw Error('offline')}}});await assert.rejects(failed.readProjection(),/offline/);
});
test('UNKNOWN is removed only by matching explicit resolved readback',async()=>{
 let resolved=false;const api=create({getContext:active,management:{reviewDraft:async()=>({state:'unknown',operationId:'PUBLIC-op'}),recoverOperation:async()=>resolved?{state:'resolved',operationId:'PUBLIC-op'}:{state:'review',operationId:'PUBLIC-op'}}});
 await api.reviewDraft({});await api.recoverOperation('PUBLIC-op');await assert.rejects(api.reviewDraft({}),code('AGENT_ORIGINAL_RECOVERY_REQUIRED'));
 resolved=true;await api.recoverOperation('PUBLIC-op');assert.equal((await api.reviewDraft({})).state,'unknown');
});
test('closed controller cannot acquire new requests and invalid actions never enter management',async()=>{
 let calls=0;const api=create({getContext:active,management:{reviewAction:async()=>{calls++},cancelView:async()=>true}});
 assert.throws(()=>api.reviewAction({rowId:'PUBLIC-grant',action:'resume'}),code('AGENT_SELECTION_INVALID'));
 await api.close();await assert.rejects(api.readProjection(),code('AGENT_VIEW_CLOSED'));assert.equal(calls,0);
});
test('a projection for a different account never exposes rows or seeds recovery',async()=>{
 const api=create({getContext:active,management:{readProjection:async()=>({account:'PUBLIC-B',delegations:[],operations:[{id:'other-account-op',state:'unknown',recoverable:true}]})}});
 await assert.rejects(api.readProjection(),code('AGENT_PROJECTION_ACCOUNT_MISMATCH'));
 assert.throws(()=>api.recoverOperation('other-account-op'),code('AGENT_ORIGINAL_OPERATION_REQUIRED'));
});
test('same-context concurrent reads cannot start a second original request',async()=>{
 const d=deferred();let reads=0;const api=create({getContext:active,management:{readProjection:()=>{reads++;return d.promise}}});
 const first=api.readProjection();await assert.rejects(api.readProjection(),code('AGENT_OPERATION_IN_PROGRESS'));
 d.resolve({account:'PUBLIC-A',delegations:[],operations:[]});await first;assert.equal(reads,1);
});
test('relock and unlock keep account-bound UNKNOWN recoverable, with reused IDs isolated by account',async()=>{
 let c=active(),mutations=0;const queried=[];
 const api=create({getContext:()=>c,management:{reviewDraft:async()=>{mutations++;return{state:'unknown',operationId:'PUBLIC-same-id'}},cancelView:async()=>true,recoverOperation:async id=>{queried.push(c.account);return{state:'unknown',operationId:id}}}});
 await api.reviewDraft({});await api.cancelView();c={...c,account:'PUBLIC-B',revision:2};await api.reviewDraft({});await api.cancelView();
 c={...c,account:'PUBLIC-A',revision:3};await assert.rejects(api.reviewDraft({}),code('AGENT_ORIGINAL_RECOVERY_REQUIRED'));await api.recoverOperation('PUBLIC-same-id');
 c={...c,account:'PUBLIC-B',revision:4};await api.cancelView();await api.recoverOperation('PUBLIC-same-id');
 assert.deepEqual(queried,['PUBLIC-A','PUBLIC-B']);assert.equal(mutations,2);
});
test('normal close reports actual cleanup debt and duplicate closes join the same cancellation',async()=>{
 let closes=0;const d=deferred();const api=create({getContext:active,management:{cancelView:()=>{closes++;return d.promise}}});
 const first=api.close(),second=api.close();assert.equal(first,second);d.resolve(false);
 assert.equal(await first,false);assert.equal(closes,1);await assert.rejects(api.readProjection(),code('AGENT_VIEW_CLOSED'));
});
