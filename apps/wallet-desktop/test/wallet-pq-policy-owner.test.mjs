import test from 'node:test';
import assert from 'node:assert/strict';
import {retainPQPolicyResource} from '../src/wallet-pq-policy-owner.mjs';
// Explicit PUBLIC supplier-contract stand-ins, not a normal registered Source.
const account='0x'+'1'.repeat(40),networkId='a'.repeat(64);
function fixture(){
 let time=new Date('2026-10-18T00:00:00.000Z'),retired=false;
 let view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId,nativeChainId:'6423',canonicalOwner:account,authorization:Object.freeze({owner:account,executionHeight:'1',ledgerNonce:'0',algorithmVersion:'legacy',enabled:false,records:Object.freeze([])}),observedAt:'2026-10-17T23:59:59.000Z',expiresAt:'2026-10-18T00:01:00.000Z'});
 const counts={retire:0,join:0,close:0},resource={assertCurrent(){if(retired)throw Error('PUBLIC_RETIRED');},readOriginal(){return view;},async recheck(){},retire(){counts.retire++;retired=true;},async join(){counts.join++;},async close(){counts.close++;}};
 const owner=retainPQPolicyResource(resource,{networkId,account,now:()=>time});return {owner,resource,counts,replace:next=>{view=next;},view:()=>view,setTime:next=>{time=new Date(next);}};
}
test('policy consumer preserves the same first observation and finite deadline',async()=>{
 const f=fixture(),first=f.owner.read();await f.owner.recheck();assert.equal(f.owner.read().snapshot,first.snapshot);assert.equal(f.owner.read().expiresAt,'2026-10-18T00:01:00.000Z');
 f.setTime('2026-10-18T00:01:00.000Z');assert.throws(()=>f.owner.read(),{code:'PQ_POLICY_REVIEW_EXPIRED'});await f.owner.close();assert.deepEqual(f.counts,{retire:1,join:1,close:1});
});
test('policy resource cannot silently replace its observation or extend a review',async()=>{
 const f=fixture();f.owner.read();f.resource.recheck=async()=>{f.replace(Object.freeze({...f.view(),expiresAt:'2026-10-18T00:10:00.000Z'}));};
 await assert.rejects(f.owner.recheck(),{code:'PQ_POLICY_ORIGINAL_CHANGED'});await f.owner.close();
});
test('session wrappers and policy getters cannot substitute transaction-source data',async()=>{
 for(const mutation of ['session','getter']){
  const f=fixture();let reads=0,next={...f.view()};if(mutation==='session')next.version='YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1';else Object.defineProperty(next,'authorization',{get(){reads++;return f.view().authorization;},enumerable:true});f.replace(Object.freeze(next));
  assert.throws(()=>f.owner.read());assert.equal(reads,0);await f.owner.close();
 }
});
test('policy recheck non-undefined returns are refusals, not grants',async()=>{
 const f=fixture();f.owner.read();f.resource.recheck=async()=>false;await assert.rejects(f.owner.recheck(),{code:'PQ_POLICY_RECHECK_INVALID'});await f.owner.close();
});
test('failed join retains cleanup debt and exact first cause without a second close',async()=>{
 const f=fixture();f.owner.read();f.owner.retire(null);f.resource.join=async()=>{f.counts.join++;throw false;};const pass=f.owner.close();assert.equal(pass,f.owner.close());
 let caught='not caught';try{await pass;}catch(error){caught=error;}assert.equal(caught,false);assert.equal(f.owner.outcome().firstCausePresent,true);assert.equal(f.owner.outcome().firstCause,null);assert.equal(f.owner.outcome().cleanupCause,false);assert.equal(f.owner.status().cleanupDebt,true);assert.deepEqual(f.counts,{retire:1,join:1,close:0});
});
