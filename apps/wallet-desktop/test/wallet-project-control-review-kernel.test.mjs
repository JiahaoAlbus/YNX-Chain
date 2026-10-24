import test from 'node:test';
import assert from 'node:assert/strict';
import {WalletProjectControlReviewKernel} from '../src/wallet-project-control-review-kernel.mjs';
function fixture(){
 const at=1800000000000,review={reviewId:'original',account:'owner',networkId:'testnet',command:{RequestID:'request',Action:'project.create',ProjectID:'project',TeamID:'',SubjectAccount:'',PublisherID:'',RuntimeOrigin:'',ExpectedRevision:'0',GrantExpiresMS:'0',Read:false,Publish:false,Runtime:false,Revoke:false,ExpiresMS:String(at+10000),PublicOriginalSHA256:''}};
 const records=[],calls=[];let clock=at,guard={account:'owner',revision:1,locked:false,authenticating:false},persistFail=false,selectFail=false,phase='decision-retained',selected=null,mutate=false,saveHook=()=>{},progress={};
 const owner={assertCurrent(){calls.push('current');},copyOriginalReview(){return structuredClone({...review,command:{...review.command,...(mutate?{ProjectID:'foreign'}:{})}});},selectOriginalDecision(id,d){calls.push('select');selected=d;if(selectFail)throw Error('PUBLIC unknown Native result');},copyOriginalDecision(){calls.push('observe');return {reviewId:review.reviewId,decision:selected,recorded:true,phase,...progress};},retire(){calls.push('retire');}};
 const kernel=new WalletProjectControlReviewKernel({isOwner:x=>x===owner,now:()=>clock,persist:async r=>{calls.push('persist');await saveHook(r);if(persistFail)throw Error('PUBLIC save failure');records.push(r);}});
 return{kernel,owner,review,records,calls,getGuard:()=>({...guard}),guard:x=>{guard={...guard,...x};},clock:v=>{clock=v;},failPersist:()=>{persistFail=true;},failSelect:()=>{selectFail=true;},phase:v=>{phase=v;},mutate:()=>{mutate=true;},onSave:f=>{saveHook=f;},progress:p=>{progress=p;}};
}
test('retains original command and persists choice before sole Native entry; never reports authorization',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);const result=await f.kernel.decide('original','approve',f.getGuard);
 assert(f.calls.indexOf('select')>f.calls.indexOf('persist'));assert(f.records.some(x=>x.phase==='decision-selected'&&!x.nativeEntered));assert.equal(result.phase,'decision-retained');assert.equal(result.approved,false);assert.equal(result.committed,false);await assert.rejects(f.kernel.decide('original','approve',f.getGuard));assert.equal(f.calls.filter(x=>x==='select').length,1);
});
test('storage failure before Native entry reserves choice without signing or replay',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.failPersist();await assert.rejects(f.kernel.decide('original','approve',f.getGuard));assert(!f.calls.includes('select'));assert.equal(f.kernel.status().storageCausePresent,true);await assert.rejects(f.kernel.decide('original','cancel',f.getGuard));
});
test('unknown Native result retires without erasure and original observation never reenters',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.failSelect();await assert.rejects(f.kernel.decide('original','approve',f.getGuard));f.kernel.retire();f.clock(1800000020000);const r=await f.kernel.observeOriginal(f.getGuard);assert.equal(r.phase,'decision-retained');assert.equal(r.retired,true);assert.equal(f.calls.filter(x=>x==='select').length,1);assert.equal(r.retryAuthorized,false);
});
test('changed command, lock, account and expiry require a new review before any decision',async()=>{
 for(const mode of ['command','lock','account','expiry']){const f=fixture();await f.kernel.capture(f.owner,f.getGuard);if(mode==='command')f.mutate();if(mode==='lock')f.guard({locked:true});if(mode==='account')f.guard({account:'foreign'});if(mode==='expiry')f.clock(1800000010000);await assert.rejects(f.kernel.decide('original','approve',f.getGuard));assert(!f.calls.includes('select'));}
});
test('reject and cancel remain distinct; retained terminal result cannot regress',async()=>{
 for(const [choice,phase]of [['reject','rejected'],['cancel','cancelled']]){const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.phase(phase);const r=await f.kernel.decide('original',choice,f.getGuard);assert.equal(r.phase,phase);f.phase('unknown');await assert.rejects(f.kernel.observeOriginal(f.getGuard),/REGRESSION/);assert.equal(f.kernel.status().phase,phase);}
});
test('foreign Native object cannot become a review, and account binding is mandatory',async()=>{
 const f=fixture();await assert.rejects(f.kernel.capture({},f.getGuard));f.guard({account:'foreign'});await assert.rejects(f.kernel.capture(f.owner,f.getGuard),/ACCOUNT_CHANGED/);assert(!f.calls.includes('select'));
});
test('async recognition or decision cannot be mistaken for a completed synchronous Native operation',async()=>{
 const fake=new WalletProjectControlReviewKernel({isOwner:async()=>true,persist:async()=>{}});await assert.rejects(fake.capture({},()=>({})),/NATIVE_REQUIRED/);
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.owner.selectOriginalDecision=async()=>{};await assert.rejects(f.kernel.decide('original','approve',f.getGuard),/DECISION_UNKNOWN/);assert.equal(f.kernel.status().phase,'decision-unknown');await assert.rejects(f.kernel.decide('original','approve',f.getGuard));
});
test('original command changed during durable choice save cannot enter Native',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.onSave(r=>{if(r.phase==='decision-selected')f.mutate();});await assert.rejects(f.kernel.decide('original','approve',f.getGuard),/ORIGINAL_CHANGED/);assert(!f.calls.includes('select'));assert.equal(f.kernel.status().nativeEntered,false);
});
test('storage failure after a definite Native outcome never erases that outcome',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.onSave(r=>{if(r.phase==='decision-retained')throw Error('PUBLIC result save failed');});await assert.rejects(f.kernel.decide('original','approve',f.getGuard));assert.equal(f.kernel.status().phase,'decision-retained');assert.equal(f.kernel.status().storageCausePresent,true);assert.equal(f.calls.filter(x=>x==='select').length,1);
});
test('null and undefined thrown first/storage causes remain present',async()=>{
 for(const thrown of [null,undefined]){const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.onSave(()=>{throw thrown;});let caught=false;try{await f.kernel.decide('original','approve',f.getGuard);}catch{caught=true;}assert(caught);assert.equal(f.kernel.status().firstCausePresent,true);assert.equal(f.kernel.status().storageCausePresent,true);}
});
test('Native partial proof is retained before a thrown callback error, never signed again',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.phase('approval-proof-retained');f.progress({effectSelected:true,effectEntered:true,hasSignedResult:true,resultStored:true,cleanupPending:false});f.failSelect();await assert.rejects(f.kernel.decide('original','approve',f.getGuard));const s=f.kernel.status();assert.equal(s.hasSignedResult,true);assert.equal(s.phase,'approval-proof-retained');assert.equal(s.approved,false);assert.equal(s.firstCausePresent,true);assert.equal(f.calls.filter(v=>v==='select').length,1);assert(f.records.some(v=>v.hasSignedResult===true));
});
test('cancel/reject cannot acquire effect flags or an approval phase from a late result',async()=>{
 for(const [choice,phase]of [['cancel','cancelled'],['reject','rejected']]){const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.phase(phase);await f.kernel.decide('original',choice,f.getGuard);const before=f.kernel.status();f.progress({effectSelected:true,effectEntered:false,hasSignedResult:false,resultStored:false,cleanupPending:true});await assert.rejects(f.kernel.observeOriginal(f.getGuard));const after=f.kernel.status();for(const k of ['phase','effectSelected','effectEntered','hasSignedResult','cleanupPending'])assert.equal(after[k],before[k]);}
});
test('a regressing terminal callback cannot mutate already retained progress before rejection',async()=>{
 const f=fixture();await f.kernel.capture(f.owner,f.getGuard);f.phase('approval-failed');f.progress({effectSelected:true,effectEntered:true,hasSignedResult:false,resultStored:true,cleanupPending:false});await f.kernel.decide('original','approve',f.getGuard);f.phase('approval-outcome-unknown');f.progress({effectSelected:true,effectEntered:true,hasSignedResult:false,resultStored:true,cleanupPending:true});await assert.rejects(f.kernel.observeOriginal(f.getGuard),/REGRESSION/);assert.equal(f.kernel.status().phase,'approval-failed');assert.equal(f.kernel.status().cleanupPending,false);
});
