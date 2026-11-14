import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalIDEHeldRead} from '../src/original-held-session-read.mjs';
const request=()=>({method:'GET',path:'/PUBLIC/original',body:'',requiredScopes:['PUBLIC.read']});
const success=owner=>({owner,error:null,failed:false,errorPresent:false,cleanupOnly:false});
const failure=(owner,error)=>({owner,error,failed:true,errorPresent:true,cleanupOnly:true});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function rejected(promise,cause){let caught=false;try{await promise;}catch(error){caught=true;assert.equal(error,cause);}assert.equal(caught,true);}
function fixture({outcome,acquire,proof,current,close,retire}={}){
 const calls={acquire:0,proof:0,current:0,retire:0,close:0,inputs:[]},opaque=Object.freeze({PUBLIC:'opaque proof DATA'});
 const owner=Object.freeze({assertCurrent(){calls.current++;return current?.();},createBusinessProof(input){calls.proof++;calls.inputs.push(input);return proof?proof(input):opaque;},retire(){calls.retire++;return retire?.();},status(){return {};},close(){calls.close++;return close?.();}});
 const client=createOriginalIDEHeldRead({originalSDK:{async acquireOriginalIDEHeldSessionRead(...args){calls.acquire++;assert.equal(args.length,0);return acquire?acquire(owner):outcome?outcome(owner):success(owner);}}});
 return {client,owner,calls,opaque};
}
test('lazy original factory is called once with zero inputs and original proof is returned unchanged',async()=>{
 const h=fixture();assert.equal(h.calls.acquire,0);
 assert.equal(await h.client.createBusinessProof(request()),h.opaque);assert.equal(await h.client.createBusinessProof(request()),h.opaque);
 assert.equal(h.calls.acquire,1);assert.equal(h.calls.current,4);assert.equal(h.client.status().RootAdmission,false);
 const p=h.client.close();assert.equal(h.client.close(),p);await p;assert.equal(h.calls.close,1);assert.equal(h.client.status().closed,true);
});
test('request is captured before asynchronous acquisition, without a second helper or mutable scopes',async()=>{
 const gate=deferred(),entered=deferred(),h=fixture({acquire:async owner=>{entered.resolve();await gate.promise;return success(owner);}}),input=request();
 const pending=h.client.createBusinessProof(input);await entered.promise;input.path='/CHANGED';input.requiredScopes[0]='CHANGED';gate.resolve();await pending;
 assert.equal(h.calls.inputs[0].path,'/PUBLIC/original');assert.deepEqual(h.calls.inputs[0].requiredScopes,['PUBLIC.read']);assert.equal(Object.isFrozen(h.calls.inputs[0].requiredScopes),true);await h.client.close();
});
test('all falsy acquisition failures remain failures and partial owners retain cleanup custody',async()=>{
 for(const cause of [null,undefined,false,0,'',NaN]){
  const h=fixture({outcome:owner=>failure(owner,cause)});await rejected(h.client.createBusinessProof(request()),cause);
  assert.equal(h.calls.proof,0);assert.equal(h.client.status().ready,false);assert.equal(h.client.status().firstCausePresent,true);assert.equal(h.client.status().ownerRetained,true);
  await h.client.close();assert.equal(h.calls.close,1);
 }
});
test('a cleanup-only full-shaped owner cannot make proofs and ambiguous flags refuse',async()=>{
 const failed=fixture({outcome:owner=>failure(owner,null)});await rejected(failed.client.createBusinessProof(request()),null);await failed.client.close();
 const inconsistent=fixture({outcome:owner=>({...success(owner),cleanupOnly:true})});await assert.rejects(inconsistent.client.createBusinessProof(request()),{code:'IDE_HELD_READ_OUTCOME_INVALID'});assert.equal(inconsistent.calls.proof,0);await inconsistent.client.close();
});
test('close during acquisition adopts and drains the late owner without using it',async()=>{
 const entered=deferred(),gate=deferred(),h=fixture({acquire:async owner=>{entered.resolve();await gate.promise;return success(owner);}});
 const pending=h.client.createBusinessProof(request());await entered.promise;const done=h.client.close();gate.resolve();
 await assert.rejects(pending,{code:'IDE_HELD_READ_RETIRED'});await done;assert.equal(h.calls.proof,0);assert.equal(h.calls.retire,1);assert.equal(h.calls.close,1);
});
test('retirement drains an in-flight proof and rejects its late result before physical close',async()=>{
 const entered=deferred(),gate=deferred(),h=fixture({proof:async()=>{entered.resolve();await gate.promise;return {PUBLIC:'late'};}});
 const pending=h.client.createBusinessProof(request());await entered.promise;const done=h.client.close();assert.equal(h.calls.close,0);gate.resolve();await assert.rejects(pending,{code:'IDE_HELD_READ_RETIRED'});await done;assert.equal(h.calls.close,1);
});
test('falsy cleanup errors are sticky and ambiguous close is never retried',async()=>{
 const h=fixture({close:()=>{throw false;}});await h.client.createBusinessProof(request());const first=h.client.close();await rejected(first,false);assert.equal(h.client.close(),first);await rejected(first,false);assert.equal(h.calls.close,1);assert.equal(h.client.status().cleanupFailed,true);assert.equal(h.client.status().closed,false);
});
test('failed retirement blocks physical parent close and preserves debt',async()=>{
 const h=fixture({retire:()=>{throw 0;}});await h.client.createBusinessProof(request());await rejected(h.client.close(),0);assert.equal(h.calls.close,0);assert.equal(h.client.status().cleanupPending,true);
});
test('a rejected factory partial is adopted before its error, without a retry',async()=>{
 const cause=Object.assign(Error('PUBLIC acquisition failed'),{});const h=fixture({acquire:owner=>{cause.partial=owner;throw cause;}});
 await rejected(h.client.createBusinessProof(request()),cause);await h.client.close();assert.equal(h.calls.acquire,1);assert.equal(h.calls.close,1);assert.equal(h.calls.proof,0);
});
test('writes, accessors, proxy owners and requests after retirement never enter proof',async()=>{
 const h=fixture();assert.throws(()=>h.client.createBusinessProof({...request(),method:'POST'}),{code:'IDE_HELD_READ_REQUEST_INVALID'});
 const input=request();Object.defineProperty(input,'path',{get(){throw Error('getter must not run');}});assert.throws(()=>h.client.createBusinessProof(input),{code:'IDE_HELD_READ_REQUEST_INVALID'});assert.equal(h.calls.acquire,0);h.client.retire();assert.throws(()=>h.client.createBusinessProof(request()),{code:'IDE_HELD_READ_RETIRED'});await h.client.close();
 let trapped=0;const proxy=new Proxy({},{get(){trapped++;throw Error('trap');}}),p=fixture({outcome:()=>success(proxy)});await assert.rejects(p.client.createBusinessProof(request()),{code:'IDE_HELD_READ_OUTCOME_INVALID'});assert.equal(trapped,0);await assert.rejects(p.client.close(),{code:'IDE_HELD_READ_RETIRE_UNCONFIRMED'});assert.equal(trapped,0);
});
