import test from 'node:test';
import assert from 'node:assert/strict';
import {WalletIDEIdentityReviewKernel} from '../src/wallet-ide-identity-review-kernel.mjs';
function fixture(){
 const requestOriginal='PUBLIC-original-identity-request',purpose='AUTH-IDENTITY-RECEIVE',body={owner:'PUBLIC-owner',networkId:'PUBLIC-network',requestId:'PUBLIC-request',expiresAtMs:'30000'};let live=true,locked=false,signs=0,saves=0,fault=false,late=false,first=false,currentHook=null,afterSave=()=>{};const records=[];
 const guard={account:body.owner,assert(){if(locked)throw Object.assign(Error('PUBLIC locked'),{code:'PUBLIC_LOCKED'});}},current=()=>{const hook=currentHook;currentHook=null;hook?.();if(!live)throw Object.assign(Error('PUBLIC Source no longer current'),{code:'PUBLIC_SOURCE_REVOKED'});};
 const review=new WalletIDEIdentityReviewKernel({vault:{PUBLIC:'not real custody'},requestOriginal,expectedOriginal:requestOriginal,purpose,snapshot:{PUBLIC:'not a qualified policy'},now:()=>1000,assertCurrent:current,inspect:(raw,expected,p)=>{assert.equal(raw,expected);assert.equal(p,purpose);return {body};},persistOriginal:async record=>{saves++;if(fault)throw Object.assign(Error('PUBLIC storage failure'),{code:'PUBLIC_STORAGE'});records.push(record);afterSave();},createAction:args=>{let wire=null;return{async sign(){signs++;args.permission.assertOriginalAuthIdentity(requestOriginal,purpose);wire=new Uint8Array([7,9,0,255]);if(first)throw false;if(late)locked=true;args.permission.assertOriginalAuthIdentity(requestOriginal,purpose);},readOriginalResult:()=>({wire,handoffAuthorized:false}),retire(){}};}});
 return {review,guard,records,counts:()=>({signs,saves}),lock:x=>{locked=x;},revoke:()=>{live=false;},fault:x=>{fault=x;},late:()=>{late=true;},falsy:()=>{first=true;},onCurrent:fn=>{currentHook=fn;},afterSave:fn=>{afterSave=fn;}};
}
test('request-specific Main permission signs once, persists before public response and never exports wire to the view',async()=>{
 const f=fixture(),v=f.review.describe();assert.equal(v.account,f.guard.account);const done=await f.review.decide(v.reviewId,'approve',f.guard);assert.deepEqual(done,{reviewId:v.reviewId,decision:'approve',recorded:true});assert.deepEqual(f.counts(),{signs:1,saves:1});assert.equal(f.records[0].handoffAuthorized,false);assert.equal(f.records[0].wire[0],7);assert.equal(f.review.readOriginalResult().payload.kind,2);assert.doesNotMatch(JSON.stringify(done),/wire|proof|requestOriginal/);await assert.rejects(f.review.decide(v.reviewId,'approve',f.guard),{code:'AUTH_IDENTITY_PROOF_ALREADY_ENTERED'});f.review.assertSafeToClose();
});
test('reject and R111 cancellation retain distinct frame kinds without entering the key action',async()=>{
 for(const [decision,kind]of [['reject',3],['cancel',4]]){const f=fixture();await f.review.decide(f.review.describe().reviewId,decision,f.guard);assert.deepEqual(f.counts(),{signs:0,saves:1});const saved=f.review.readOriginalResult();assert.equal(saved.payload.kind,kind);assert.equal(saved.payload.bytes.length,32);assert.equal(saved.wire,null);assert.equal(saved.handoffAuthorized,false);}
});
test('late lock after signing preserves the original proof and first error without a second sign or lost result',async()=>{
 const f=fixture();f.late();await assert.rejects(f.review.decide(f.review.describe().reviewId,'approve',f.guard),{code:'PUBLIC_LOCKED'});assert.equal(f.review.status().hasSignedResult,true);assert.equal(f.records.length,1);assert.equal(f.records[0].wire[0],7);assert.equal(f.records[0].handoffAuthorized,false);f.lock(false);await assert.rejects(f.review.decide(f.review.describe().reviewId,'approve',f.guard));assert.deepEqual(f.counts(),{signs:1,saves:1});
});
test('lost storage callback cannot trigger an automatic second write or signature; explicit save preserves old error metadata',async()=>{
 const f=fixture();f.fault(true);await assert.rejects(f.review.decide(f.review.describe().reviewId,'approve',f.guard),{code:'PUBLIC_STORAGE'});assert.deepEqual(f.counts(),{signs:1,saves:1});assert.throws(()=>f.review.assertSafeToClose());f.fault(false);const saved=await f.review.save(f.guard);assert.equal(saved.handoffAuthorized,false);assert.deepEqual(f.counts(),{signs:1,saves:2});assert.equal(f.records[0].firstCausePresent,true);f.review.assertSafeToClose();
});
test('foreign review/account, locked and revoked Source refuse before keys or persistence',async()=>{
 const f=fixture(),id=f.review.describe().reviewId;await assert.rejects(f.review.decide('foreign','approve',f.guard));await assert.rejects(f.review.decide(id,'approve',{...f.guard,account:'foreign'}));f.lock(true);await assert.rejects(f.review.decide(id,'approve',f.guard));f.lock(false);f.revoke();await assert.rejects(f.review.decide(id,'approve',f.guard));assert.deepEqual(f.counts(),{signs:0,saves:0});
});
test('a falsy signing failure remains first while the already returned proof is retained',async()=>{
 const f=fixture();f.falsy();let caught='unset';try{await f.review.decide(f.review.describe().reviewId,'approve',f.guard);}catch(e){caught=e;}assert.equal(caught,false);assert.equal(f.review.readOriginalResult().firstCause,false);assert.equal(f.review.status().firstCausePresent,true);assert.equal(f.records[0].wire[0],7);assert.deepEqual(f.counts(),{signs:1,saves:1});
});
test('reserve decision before a current callback can reenter the same original review',async()=>{
 const f=fixture(),id=f.review.describe().reviewId;let nested;f.onCurrent(()=>{nested=assert.rejects(f.review.decide(id,'approve',f.guard),{code:'AUTH_IDENTITY_PROOF_ALREADY_ENTERED'});});await f.review.decide(id,'approve',f.guard);await nested;assert.deepEqual(f.counts(),{signs:1,saves:1});
});
test('post-save Source revocation retains the first original and requires only explicit local metadata saving, not another proof',async()=>{
 const f=fixture();f.afterSave(()=>f.revoke());await assert.rejects(f.review.decide(f.review.describe().reviewId,'approve',f.guard),{code:'PUBLIC_SOURCE_REVOKED'});assert.deepEqual(f.counts(),{signs:1,saves:1});assert.equal(f.records.length,1);assert.throws(()=>f.review.assertSafeToClose());const saved=await f.review.save(f.guard);assert.equal(saved.handoffAuthorized,false);assert.equal(f.records[1].firstCausePresent,true);assert.deepEqual(f.counts(),{signs:1,saves:2});f.review.assertSafeToClose();
});
