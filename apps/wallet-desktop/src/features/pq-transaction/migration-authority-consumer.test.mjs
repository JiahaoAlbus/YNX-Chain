import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {preparePQMigrationTransport,decodePQMigrationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {DesktopWalletAuthority,MemoryPermissionStore,isOriginalPQMigrationBroadcastReviewBorrow,isOriginalPQTransactionReviewBorrow} from '../../desktop-wallet-authority.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
const f=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)))),decode=name=>decodePQMigrationRequest(Buffer.from(f.originals.find(x=>x.name===name).wire,'base64'));
const previous=decode('initial-migration').intent,current=decode('rotation').intent,wire=Buffer.from(f.originals.find(x=>x.name==='rotation').wire,'base64'),account=current.owner,networkId=current.chainId;
// Existing PUBLIC E6 and explicitly CONTROLLED policy/approval peer. No keys,
// real Source, IPC grant, signer, live node or production admission is created.
async function setup(t,policyDelta={},broadcast=null){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-migration-preview-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=new FileTransactionIntentStore({filePath:path.join(dir,'journal.json')}),original=createPQOriginalRecord({account,kind:'pq-migration',operationId:'PUBLIC-original-migration-sign',request:preparePQMigrationTransport(wire)});
 await store.reserveOriginal(account,'pq-migration');store.captureOriginal(account,original,'pq-migration');await store.saveOriginal(account,original.hash,()=>{});
 const authorization=parsePQAccountAuthorization({owner:account,executionHeight:'4',ledgerNonce:'2',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'1',activeRevision:'1',records:[{algorithmVersion:previous.algorithmVersion,owner:account,pkA:previous.pkA,pkB:previous.pkB,revision:'1',registeredAt:'2',activeFrom:'3',ledgerNonce:'1'}],...policyDelta},{owner:account,chainId:networkId,nativeChainId:'6423'});
 const guard={account,assert(){},assertEffectCurrent(){}},vault={authorization:{current:()=>guard,status:()=>({revision:1})},status:async()=>({account,initialized:true})};
 const peers=new WeakSet(),counts={source:0,close:0,permission:0,send:0};const source=async request=>{counts.source++;assert.equal(request.operation,'migration');const view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId,nativeChainId:'6423',canonicalOwner:account,authorization,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+30000).toISOString()}),resource={assertCurrent(){},readOriginal:()=>view,recheck(){},retire(){},join(){},close(){counts.close++}};peers.add(resource);return resource};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:source,pqPolicyRecognized:x=>peers.has(x),pqNetworkId:networkId,pqTransactionPermissionSource:()=>{counts.permission++;throw Error('NO_REAL_AUTH')},pqTransactionPermissionRecognized:()=>false,pqBroadcastSource:broadcast??(()=>{counts.send++;throw Error('NO_SEND')})});t.after(()=>authority.shutdownPQReviews());
 return {authority,store,original,counts};
}
test('stored migration enters its distinct Main broadcast preview from fresh policy, without permission or effect',async t=>{
 const f=await setup(t),out=await f.authority.requestPQBroadcast(f.original.hash);assert.equal(out.status,'approval-required');assert.equal(out.request.method,'ynx_broadcastPQMigration');assert.notEqual(out.request.id,f.original.operationId);assert.equal(out.request.review.originalOperationId,f.original.operationId);assert.equal(out.request.review.operationId,out.request.id);assert.equal(out.request.review.hash,f.original.hash);assert.equal(out.request.review.policyRevision,'1');assert.equal(out.request.review.executionHeight,'4');assert.equal(f.authority.isPendingPQBroadcastReview(out.request.id),true);assert.equal(f.counts.source,1);assert.equal(f.counts.permission,0);assert.equal(f.counts.send,0);assert.equal((await f.store.readPQProgress(account,f.original.hash,()=>{})).status,'signed-unsubmitted');
 assert.throws(()=>f.authority.reject(out.request.id));await f.authority.shutdownPQReviews();assert.equal(f.counts.close,1);assert.equal(f.counts.send,0);
});
test('Main rejects an UNKNOWN migration before policy reacquisition or another preview',async t=>{
 const f=await setup(t);await f.store.beginPQSubmission(account,f.original.hash,()=>{});await assert.rejects(f.authority.requestPQBroadcast(f.original.hash),e=>e.data?.code==='PQ_TRANSACTION_ALREADY_ENTERED');assert.equal(f.counts.source,0);assert.equal(f.counts.send,0);
});
test('Main migration preview rechecks current nonce and activation H rather than admitting saved E6 alone',async t=>{
 for(const changed of [{ledgerNonce:'3'},{executionHeight:'5'}]){
  const f=await setup(t,changed);await assert.rejects(f.authority.requestPQBroadcast(f.original.hash),{code:'PQ_MIGRATION_REVIEW_MISMATCH'});assert.equal(f.authority.pending.size,0);assert.equal(f.counts.source,1);assert.equal(f.counts.close,1);assert.equal(f.counts.permission,0);assert.equal(f.counts.send,0);assert.equal((await f.store.readPQProgress(account,f.original.hash,()=>{})).status,'signed-unsubmitted');
 }
});
test('Main migration private borrow has a separate brand and retains both completion hashes without transport',async t=>{
 let borrowed,request;const f=await setup(t,{},async value=>{
  borrowed=value.borrow;request=value.request;assert.equal(isOriginalPQMigrationBroadcastReviewBorrow(borrowed),true);assert.equal(isOriginalPQTransactionReviewBorrow(borrowed),false);const packet=borrowed.readOriginal();assert.equal(packet.request,request);assert.deepEqual(Object.keys(packet).sort(),['expiresAt','issuedAt','request','source']);assert.deepEqual(Object.keys(packet.source).sort(),['original','snapshot']);assert.equal(packet.source.original.operationId,f.original.operationId);assert.deepEqual(Buffer.from(packet.source.original.wire,'base64url'),wire);assert.equal(packet.source.snapshot.executionHeight,'4');assert.deepEqual(borrowed.readApprovalIdentity(),{kind:'pq-migration',action:'broadcast',operationId:request.operationId,originalOperationId:f.original.operationId,reviewId:request.operationId});await borrowed.recheck();borrowed.enterOriginal('broadcast');
  assert.throws(()=>borrowed.completeOriginal({outcome:'returned',transportHash:request.transportHash,abciTransactionHash:request.transportHash}),e=>e.data?.code==='PQ_TRANSACTION_RESULT_BINDING');
  const completion={outcome:'unknown',transportHash:request.transportHash,abciTransactionHash:request.abciTransactionHash};borrowed.completeOriginal(completion);borrowed.assertCompletedCurrent(completion);return{controlledReviewOnly:true};
 });
 const preview=await f.authority.requestPQBroadcast(f.original.hash);await f.authority.approve(preview.request.id,Object.freeze({controlledTestOnly:true}));assert.notEqual(request.operationId,f.original.operationId);assert.throws(()=>borrowed.readOriginal(),e=>e.data?.code==='PQ_TRANSACTION_REVIEW_RETIRED');assert.equal(f.counts.permission,0);assert.equal(f.counts.send,0);assert.equal(f.counts.close,1);assert.equal((await f.store.readPQProgress(account,f.original.hash,()=>{})).status,'signed-unsubmitted');
});
