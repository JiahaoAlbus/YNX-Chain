import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WalletIDEIdentityEvidence,isWalletIDEIdentityEvidence} from '../src/wallet-ide-identity-evidence.mjs';
import {encodeIDEIdentityPeerDecision} from '../src/wallet-ide-identity-peer-wire.mjs';
import {WalletIDEIdentityReviewKernel} from '../src/wallet-ide-identity-review-kernel.mjs';
// PUBLIC controlled records exercise actual private files, not Native grants.
function record(decision='approve'){
 const raw='PUBLIC original request',wire=decision==='approve'?Buffer.from([7,9,0,255]):null,p=encodeIDEIdentityPeerDecision({decision,requestRaw:raw,proof:wire});
 return {reviewId:randomUUID(),requestOriginal:raw,expectedOriginal:raw,purpose:'AUTH-IDENTITY-RECEIVE',decision,phase:'recorded-unhanded',wire,payload:{kind:p.kind,bytes:p.payload},firstCausePresent:false,firstCause:undefined,handoffAuthorized:false};
}
async function fixture(t,io=fs){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ynx-ide-evidence-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const directory=path.join(root,'private');return {root,directory,store:new WalletIDEIdentityEvidence({directory,io})};}
const target=(directory,ref)=>path.join(directory,ref.eventId+'.'+ref.attemptId+'.ideid');
test('actual private immutable file survives cold read as DATA only for approve, reject and cancel',async t=>{
 const {directory,store}=await fixture(t);assert.equal(isWalletIDEIdentityEvidence(store),true);assert.equal(isWalletIDEIdentityEvidence({...store}),false);
 for(const decision of ['approve','reject','cancel']){const input=record(decision);assert.equal(await store.persist(input),undefined);store.assertSafeToClose();const cold=new WalletIDEIdentityEvidence({directory}),found=await cold.candidates(),ref=found.candidates.find(x=>x.reviewId===input.reviewId);assert.ok(ref);assert.equal(found.unreadable,0);const saved=await cold.read(ref);assert.equal(saved.decision,decision);assert.equal(saved.requestOriginal,input.requestOriginal);assert.equal(saved.wire,input.wire?.toString('base64')??null);assert.equal(saved.handoffAuthorized,false);assert.equal(saved.retryAuthorized,false);assert.equal(saved.dataOnly,true);assert.equal((await fs.stat(target(directory,ref))).mode&0o777,0o600);}
 assert.equal((await fs.stat(directory)).mode&0o777,0o700);
});
test('failed durable sync retains original attempt and falsy cause; explicit save uses fresh attempt, no overwrite',async t=>{
 let fault=true,syncs=0;const io={...fs,async open(file,flags,...rest){const h=await fs.open(file,flags,...rest);if(typeof flags==='number'&&(flags&1))return new Proxy(h,{get(o,k){if(k==='sync')return async()=>{syncs++;if(fault)throw false;return o.sync();};const v=Reflect.get(o,k);return typeof v==='function'?v.bind(o):v;}});return h;}};
 const {directory,store}=await fixture(t,io),input=record();await assert.rejects(store.persist(input),e=>e.code==='AUTH_IDENTITY_EVIDENCE_UNCONFIRMED'&&e.cause===false);const held=store.pending();assert.ok(held);assert.equal(syncs,1);assert.throws(()=>store.assertSafeToClose());const originalNames=await fs.readdir(directory),original=await fs.readFile(path.join(directory,originalNames[0]));await assert.rejects(store.persist(record()),{code:'AUTH_IDENTITY_EVIDENCE_UNCONFIRMED'});assert.equal(syncs,1);fault=false;await store.persist(input);assert.equal(syncs,2);store.assertSafeToClose();assert.equal(store.pending(),null);assert.equal((await fs.readdir(directory)).length,2);assert.deepEqual(await fs.readFile(path.join(directory,originalNames[0])),original);const refs=(await store.candidates()).candidates;assert.equal(new Set(refs.map(x=>x.eventId)).size,1);assert.equal(new Set(refs.map(x=>x.attemptId)).size,2);
});
test('pending write blocks close, reentrant persistence and reads until fsync returns',async t=>{
 let release,entered;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});const io={...fs,async open(file,flags,...rest){const h=await fs.open(file,flags,...rest);if(typeof flags==='number'&&(flags&1))return new Proxy(h,{get(o,k){if(k==='sync')return async()=>{entered();await gate;return o.sync();};const v=Reflect.get(o,k);return typeof v==='function'?v.bind(o):v;}});return h;}};
 const {store}=await fixture(t,io),input=record(),pending=store.persist(input);await ready;assert.throws(()=>store.assertSafeToClose());await assert.rejects(store.persist(input));await assert.rejects(store.candidates());release();await pending;store.assertSafeToClose();
});
test('uncertain handle close stays fenced without a second close or automatic retry',async t=>{
 let closes=0;const io={...fs,async open(file,flags,...rest){const h=await fs.open(file,flags,...rest);if(typeof flags==='number'&&(flags&1))return new Proxy(h,{get(o,k){if(k==='close')return async()=>{closes++;await o.close();throw null;};const v=Reflect.get(o,k);return typeof v==='function'?v.bind(o):v;}});return h;}};
 const {store}=await fixture(t,io),input=record();await assert.rejects(store.persist(input),e=>e.cause===null&&e.cleanupCausePresent&&e.cleanupCause===null);assert.equal(closes,1);assert.equal(store.pending().closeUnknown,true);await assert.rejects(store.persist(input));assert.equal(closes,1);assert.throws(()=>store.assertSafeToClose());
});
test('cold tampering, hardlink and unsafe permission refuse without modifying original evidence',async t=>{
 const {directory,root,store}=await fixture(t);await store.persist(record());const ref=(await store.candidates()).candidates[0],file=target(directory,ref),original=await fs.readFile(file);const altered=Buffer.from(original);altered[altered.length-2]^=1;await fs.writeFile(file,altered);await assert.rejects(store.read(ref));assert.deepEqual(await fs.readFile(file),altered);await fs.writeFile(file,original);await fs.link(file,path.join(root,'hardlink'));await assert.rejects(store.read(ref));await fs.unlink(path.join(root,'hardlink'));await fs.chmod(file,0o644);await assert.rejects(store.read(ref));
});
test('invalid record, foreign choice payload and mismatched original refuse before any filesystem write',async t=>{
 const {directory,store}=await fixture(t);for(const input of [{...record(),handoffAuthorized:true},{...record(),expectedOriginal:'other'},{...record(),payload:{kind:3,bytes:Buffer.alloc(32)}}])await assert.rejects(store.persist(input));await assert.rejects(fs.stat(directory),{code:'ENOENT'});store.assertSafeToClose();
});
test('cold reads use bounded reads, fence close while pending and reject a file growing after stat',async t=>{
 const {directory,store}=await fixture(t);await store.persist(record());const ref=(await store.candidates()).candidates[0],file=target(directory,ref);let unbounded=0,release,entered,armed=true;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
 const io={...fs,async open(...args){const h=await fs.open(...args);return new Proxy(h,{get(o,k){if(k==='readFile')return async()=>{unbounded++;throw Error('PUBLIC unbounded allocation');};if(k==='read')return async(...a)=>{if(armed){armed=false;entered();await gate;}return o.read(...a);};const v=Reflect.get(o,k);return typeof v==='function'?v.bind(o):v;}});}};
 const cold=new WalletIDEIdentityEvidence({directory,io}),pending=cold.read(ref);pending.catch(()=>{});const reached=await Promise.race([ready.then(()=>true),pending.then(()=>false,()=>false)]);assert.equal(reached,true);assert.throws(()=>cold.assertSafeToClose());await fs.appendFile(file,Buffer.alloc(64));release();await assert.rejects(pending);assert.equal(unbounded,0);cold.assertSafeToClose();
});
test('real store plus public review kernel preserves late-lock proof and never signs a second time after cold recovery',async t=>{
 const {directory,store}=await fixture(t);let locked=false,signs=0;const raw='PUBLIC original request',purpose='AUTH-IDENTITY-RECEIVE',guard={account:'PUBLIC-owner',assert(){if(locked)throw Error('PUBLIC locked');}};
 const review=new WalletIDEIdentityReviewKernel({vault:{PUBLIC:true},requestOriginal:raw,expectedOriginal:raw,purpose,snapshot:{PUBLIC:true},assertCurrent:()=>{},now:()=>1000,inspect:()=>({body:{owner:guard.account,networkId:'PUBLIC-network',requestId:'PUBLIC-id',expiresAtMs:'30000'}}),persistOriginal:r=>store.persist(r),createAction:()=>({async sign(){signs++;locked=true;throw false;},readOriginalResult:()=>({wire:Buffer.from([7,9,0,255])}),retire(){}})});
 let first='unset';try{await review.decide(review.describe().reviewId,'approve',guard);}catch(e){first=e;}assert.equal(first,false);assert.equal(signs,1);review.assertSafeToClose();store.assertSafeToClose();const cold=new WalletIDEIdentityEvidence({directory}),ref=(await cold.candidates()).candidates[0],saved=await cold.read(ref);assert.equal(saved.phase,'signed-outcome-unknown');assert.equal(saved.firstCause.present,true);assert.equal(saved.firstCause.value,false);assert.equal(saved.wire,Buffer.from([7,9,0,255]).toString('base64'));assert.equal(saved.handoffAuthorized,false);locked=false;await assert.rejects(review.decide(review.describe().reviewId,'approve',guard));assert.equal(signs,1);
});
