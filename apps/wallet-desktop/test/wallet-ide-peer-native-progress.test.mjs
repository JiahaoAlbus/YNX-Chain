import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WalletIDEIdentityEvidence} from '../src/wallet-ide-identity-evidence.mjs';
import {WalletIDEIdentityPeerKernel} from '../src/wallet-ide-identity-peer-kernel.mjs';
// PUBLIC Native progress assertions are stored DATA, never a Source or grant.
// These tests execute real immutable storage and a fresh cold Main reader.
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ynx-peer-progress-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'evidence'),store=new WalletIDEIdentityEvidence({directory}),account='0x'+'ab'.repeat(20),operationId=randomUUID(),reviewId=randomUUID();
 const record=extra=>({operationId,reviewId,sequence:'1',account,requestOriginal:'PUBLIC original request',invocationOriginal:'PUBLIC original manifest',phase:'failed',decision:'approve',wire:null,sendSelected:false,sendStarted:false,sendReturned:false,closed:false,firstCausePresent:true,firstCause:false,cleanupCausePresent:false,cleanupCause:undefined,storageCausePresent:false,storageCause:undefined,signingSelected:true,nativeSignedResult:true,nativeResultStored:true,nativePhase:'signed-unhanded',...extra});
 const forbidden=()=>assert.fail('cold data must not invoke Source, approval, signer or transport');
 const cold=()=>new WalletIDEIdentityPeerKernel({evidence:new WalletIDEIdentityEvidence({directory}),acquireSource:forbidden,isSource:forbidden,inspect:forbidden,createReview:forbidden,acquirePolicy:forbidden,isPolicy:forbidden,isPolicyCleanupOwner:forbidden}).history({account,assert(){}});
 return {directory,store,record,cold,async files(){const names=await fs.readdir(directory);return Promise.all(names.sort().map(async n=>[n,await fs.readFile(path.join(directory,n))]));}};
}
test('v2 cold progress retains Native signature without a copy and later adds only the same retained public result',async t=>{
 const f=await fixture(t);await f.store.persistPeer(f.record());const before=await f.files(),h=await f.cold();assert.equal(h.records[0].hasSignedResult,true);assert.equal(h.records[0].resultCopyAvailable,false);assert.equal(h.records[0].signatureState,'signed-native-copy-pending');assert.equal(h.records[0].handoffAuthorized,false);
 await f.store.persistPeer(f.record({sequence:'2',wire:Buffer.from([1,2,3]),phase:'closed',closed:true}));const after=await f.cold();assert.equal(after.records[0].signatureState,'signed-result-retained');assert.equal(after.records[0].resultCopyAvailable,true);for(const [name,bytes]of before)assert((await fs.readFile(path.join(f.directory,name))).equals(bytes));assert.doesNotMatch(JSON.stringify(after),/requestOriginal|invocationOriginal|"wire"|sourcePath/);
});
test('legacy v1 records stay readable byte-for-byte and never gain a Native progress or authority claim',async t=>{
 const f=await fixture(t),old=f.record({wire:Buffer.from([7,9])});for(const k of ['signingSelected','nativeSignedResult','nativeResultStored','nativePhase'])delete old[k];await f.store.persistPeer(old);const before=await f.files(),ref=(await f.store.candidates()).candidates[0],row=await new WalletIDEIdentityEvidence({directory:f.directory}).read(ref);assert.equal(row.version,'YNX-WALLET-IDE-PEER-EVIDENCE/v1');assert.equal(row.nativeSignedResult,undefined);const h=await f.cold();assert.equal(h.records[0].hasSignedResult,true);assert.equal(h.records[0].nativeResultStored,false);assert.equal(h.records[0].retryAuthorized,false);assert.deepEqual(await f.files(),before);
});
test('partial, contradictory or permission-shaped Native metadata refuses before writing a directory',async t=>{
 const f=await fixture(t),partial=f.record();delete partial.signingSelected;
 for(const r of [partial,f.record({signingSelected:false}),f.record({nativeSignedResult:'true'}),f.record({nativePhase:'approved'}),f.record({invocationOriginal:null}),f.record({decision:'cancel'}),f.record({nativePhase:'cancelled'}),f.record({nativePhase:'signed-outcome-unknown'}),f.record({issuerGrant:true}),f.record({handoffAuthorized:true})])await assert.rejects(f.store.persistPeer(r),{code:'AUTH_IDENTITY_EVIDENCE_INVALID'});
 await assert.rejects(fs.stat(f.directory),{code:'ENOENT'});f.store.assertSafeToClose();
});
test('definite Native failure and cancelled original choice remain distinct from signing outcome unknown',async t=>{
 for(const [extra,expected]of [[{nativeSignedResult:false,nativePhase:'failed'},'failed-no-result'],[{nativeSignedResult:false,nativeResultStored:false,signingSelected:false,nativePhase:'not-entered',decision:'cancel'},'cancelled'],[{nativeSignedResult:false,nativePhase:'unknown'},'signing-outcome-unknown']]){const f=await fixture(t);await f.store.persistPeer(f.record(extra));const h=await f.cold();assert.equal(h.records[0].hasSignedResult,false);assert.equal(h.records[0].signatureState,expected);}
});
test('cold history refuses signed/storage/send/wire regressions without deleting either original generation',async t=>{
 for(const mode of ['signed','stored','send','wire']){
  const f=await fixture(t),first=f.record(mode==='send'?{wire:Buffer.from([1]),sendSelected:true,sendStarted:true}:mode==='wire'?{wire:Buffer.from([1])}:{});await f.store.persistPeer(first);
  const next={...first,sequence:'2'};
  if(mode==='signed')Object.assign(next,{signingSelected:false,nativeSignedResult:false,nativeResultStored:false,nativePhase:'not-entered'});
  if(mode==='stored')next.nativeResultStored=false;
  if(mode==='send')Object.assign(next,{sendSelected:false,sendStarted:false});
  if(mode==='wire')next.wire=Buffer.from([2]);
  await f.store.persistPeer(next);const before=await f.files();await assert.rejects(f.cold(),{code:'AUTH_IDENTITY_PEER_HISTORY_CONFLICT'});assert.deepEqual(await f.files(),before);
 }
});
test('same-sequence equivocation is rejected even below a later valid sequence',async t=>{
 const f=await fixture(t),early=f.record({signingSelected:false,nativeSignedResult:false,nativeResultStored:false,nativePhase:'not-entered',phase:'decision-selected'});await f.store.persistPeer(early);await f.store.persistPeer(f.record({sequence:'3',wire:Buffer.from([1])}));await f.store.persistPeer({...early,phase:'failed'});const before=await f.files();await assert.rejects(f.cold(),{code:'AUTH_IDENTITY_PEER_HISTORY_CONFLICT'});assert.deepEqual(await f.files(),before);
});
test('later metadata cannot switch the original request, invocation or review to explain away existing progress',async t=>{
 for(const key of ['requestOriginal','invocationOriginal','reviewId']){const f=await fixture(t);await f.store.persistPeer(f.record());await f.store.persistPeer(f.record({sequence:'2',[key]:key==='reviewId'?randomUUID():'PUBLIC different original'}));const before=await f.files();await assert.rejects(f.cold(),{code:'AUTH_IDENTITY_PEER_HISTORY_CONFLICT'});assert.deepEqual(await f.files(),before);}
});
