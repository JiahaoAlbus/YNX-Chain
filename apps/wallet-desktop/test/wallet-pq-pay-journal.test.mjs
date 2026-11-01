import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from '../src/features/pq-transaction/typed-action-caller.mjs';
import {createPQTypedOriginalFromMember} from '../src/wallet-pq-typed-original.mjs';
import vectors from '../src/features/pq-transaction/invoice-review-data.fixture.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {projectPQTransactionProgress} from '../src/features/pq-transaction/progress-view.mjs';
import {createPQTransactionSubmission} from '../src/features/pq-transaction/submission.mjs';
import {PRIVATE_FILE_MAX_BYTES,TRANSACTION_JOURNAL_MAX_BYTES,readBoundedPrivateFile,readBoundedTransactionJournal} from '../src/bounded-private-file-read.mjs';
// PUBLIC ephemeral signer and actual original codec/store. No custody, approval,
// network, real funds, or installed-app acceptance is supplied by these tests.
let original,ref;
before(async()=>{
 const owner=vectors.envelope.owner,chainId=vectors.envelope.networkHex,handle=await createPQWalletKeyHandle({chainId,owner});
 try{
  const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
  const dto={owner,executionHeight:'100',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
  const snapshot=parsePQAccountAuthorization(dto,{owner,chainId,nativeChainId:'6423'}),at=Date.now();
  const action={chainId,nativeChainId:'6423',owner,nonce:'2',fee:'1',kind:'invoice_terms',payload:{...vectors.vectors.find(v=>v.kind==='invoice_terms').input,keyEpoch:'1',payer:'0x'+'22'.repeat(20)}};
  const review=preparePQTypedActionReview(snapshot,action,{account:owner,networkId:chainId,operationId:'PUBLIC-pay-journal',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()});
  const member=signPQReviewedTypedAction(review,snapshot,handle,{account:owner,networkId:chainId},at);
  original=createPQTypedOriginalFromMember(member,{review,reviewSnapshot:dto,signingSnapshot:dto});
  ref={hash:original.hash,kind:'invoice_terms',intentId:'npi_'+'ab'.repeat(24)};
 }finally{assert.equal(destroyPQWalletKeyHandle(handle),true);}
});
const guard=()=>{};
const code=expected=>e=>e?.code===expected||e?.data?.code===expected;
const packet=(body=Buffer.from([0,255,254,123]),extra={})=>({method:'GET',requestPath:'/wrong/actual/path',status:503,contentType:undefined,cacheControl:'no-store',body,...extra});
async function fixture(t){
 const directory=await fs.mkdtemp(join(tmpdir(),'ynx-pay-journal-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const filePath=join(directory,'journal.json');let armed=false;
 const store=new FileTransactionIntentStore({filePath,io:{...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){armed=false;throw false;}}}});
 await store.reserveOriginal(original.account,original.kind);store.captureOriginal(original.account,original,original.kind);await store.saveOriginal(original.account,original.hash,guard);
 return {store,filePath,arm(){armed=true;},cold:()=>new FileTransactionIntentStore({filePath}),read:()=>fs.readFile(filePath,'utf8')};
}
test('Pay target survives cancellation/reopen, Core cannot enter it, full 2 MiB response is durable and never a Core receipt',async t=>{
 const f=await fixture(t),bound=await f.store.bindPQPaySubmissionTarget(original.account,original.hash,ref,guard);
 assert.equal(bound.status,'signed-unsubmitted');assert.deepEqual(await f.cold().readPQPaySubmissionTarget(original.account,original.hash,guard),bound.target);
 assert.equal((await f.store.reconcilePQOriginal(original.account,original.hash,guard)).submitted,false);
 const p=await f.cold().readPQProgress(original.account,original.hash,guard);
 assert.equal(projectPQTransactionProgress(p,{account:original.account,hash:original.hash,kind:original.kind}).submitted,false);
 let acquires=0,coreCalls=0;
 const controller=createPQTransactionSubmission({intentStore:f.store,networkId:original.typed.networkId,acquireOriginalWalletTransactionPermission(){acquires++;throw Error('MUST_NOT_ACQUIRE');},isOriginalWalletTransactionPermission:()=>false,transport:{submitTypedAction(){coreCalls++;throw Error('MUST_NOT_POST');}},readTypedOriginal(){coreCalls++;throw Error('MUST_NOT_QUERY_CORE');}});
 const localGuard={account:original.account,assert:guard,assertEffectCurrent:guard,submit:fn=>fn()};
 await assert.rejects(controller.broadcast(original.hash,localGuard),code('PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED'));
 await assert.rejects(controller.reconcile(original.hash,localGuard),code('PQ_PAY_QUERY_SOURCE_NOT_SUPPLIED'));
 assert.equal(acquires,0);assert.equal(coreCalls,0);
 await assert.rejects(f.store.beginPQSubmission(original.account,original.hash,guard),code('PQ_PAY_TARGET_REQUIRED'));
 assert.equal((await f.store.beginPQSubmission(original.account,original.hash,guard,bound.target)).created,true);
 const body=Buffer.alloc(2*1024*1024,255),raw=packet(body);await f.store.savePQPaySubmissionPacket(original.account,original.hash,raw);body.fill(0);
 const before=await f.read(),journal=JSON.parse(before),saved=journal.pqProgress[0];
 assert.equal(saved.version,2);assert.equal(saved.status,'submission-unknown');assert.equal(saved.result.status,503);assert.equal(saved.result.bodyBytes,2097152);assert.equal(Buffer.from(saved.result.bodyBase64url,'base64url')[0],255);
 assert.ok(Buffer.byteLength(before)>PRIVATE_FILE_MAX_BYTES);assert.ok(Buffer.byteLength(before)<TRANSACTION_JOURNAL_MAX_BYTES);
 const cold=await f.cold().readPQProgress(original.account,original.hash,guard);assert.equal(cold.status,'submission-unknown');assert.equal(cold.submissionService,'pay');assert.equal(cold.storageConfirmed,true);
 await f.store.savePQPaySubmissionPacket(original.account,original.hash,packet(Buffer.alloc(2097152,255)));assert.equal(await f.read(),before);
 await assert.rejects(f.store.savePQPaySubmissionPacket(original.account,original.hash,packet(Buffer.from([7]))),code('PQ_PAY_RESPONSE_CONFLICT'));
 assert.equal(await f.read(),before);await assert.rejects(f.store.assertPQProgressSafeToClose(),code('PQ_PROGRESS_CLOSE_UNCONFIRMED'));
 assert.equal((await f.cold().beginPQSubmission(original.account,original.hash,guard,bound.target)).created,false);
});
test('prior Core UNKNOWN cannot be retargeted to Pay and its journal stays byte-identical',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(original.account,original.hash,guard);const before=await f.read();
 await assert.rejects(f.store.bindPQPaySubmissionTarget(original.account,original.hash,ref,guard),code('PQ_PAY_TARGET_CONFLICT'));
 assert.equal(await f.read(),before);assert.equal(await f.cold().readPQPaySubmissionTarget(original.account,original.hash,guard),null);
});
test('target write lost acknowledgement retains storage cause, blocks admission and recovers only by local flush',async t=>{
 const f=await fixture(t);f.arm();await assert.rejects(f.store.bindPQPaySubmissionTarget(original.account,original.hash,ref,guard),e=>e===false||e.cause===false);
 const target=await f.cold().readPQPaySubmissionTarget(original.account,original.hash,guard);assert.ok(target);
 await assert.rejects(f.store.beginPQSubmission(original.account,original.hash,guard,target),code('PQ_ORIGINAL_RECONCILE_REQUIRED'));
 await assert.rejects(f.store.assertPQProgressSafeToClose(),code('PQ_PROGRESS_CLOSE_UNCONFIRMED'));
 await f.store.flushPQProgressResult(original.account,original.hash,guard);
 assert.equal((await f.cold().beginPQSubmission(original.account,original.hash,guard,target)).created,true);
});
test('uncapturable first packet cannot be replaced by a later valid callback or release the close barrier',async t=>{
 const f=await fixture(t),{target}=await f.store.bindPQPaySubmissionTarget(original.account,original.hash,ref,guard);
 await f.store.beginPQSubmission(original.account,original.hash,guard,target);
 const first=packet(Buffer.alloc(2097153));assert.throws(()=>f.store.savePQPaySubmissionPacket(original.account,original.hash,first),code('PQ_PAY_PACKET_TOO_LARGE'));
 assert.throws(()=>f.store.savePQPaySubmissionPacket(original.account,original.hash,packet()),code('PQ_PAY_RESPONSE_CAPTURE_UNCONFIRMED'));
 assert.equal(f.store.selectPQProgressOutcome(original.account,original.hash,s=>s.firstPayResponse),first);
 await f.store.savePQSubmissionFailure(original.account,original.hash,false);
 const p=await f.store.readPQProgress(original.account,original.hash,guard);assert.equal(p.storageConfirmed,false);assert.equal(p.localResultHeld,true);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),code('PQ_PROGRESS_CLOSE_UNCONFIRMED'));
});
test('journal reader alone gets 8 MiB budget; vault/default 1 MiB reader remains bounded',async()=>{
 function handle(size){return {async read({buffer,offset,length,position}){const n=Math.min(length,Math.max(0,size-position));buffer.fill(32,offset,offset+n);return {bytesRead:n};}};}
 await assert.rejects(readBoundedPrivateFile(handle(PRIVATE_FILE_MAX_BYTES+1)),code('PRIVATE_FILE_READ_TOO_LARGE'));
 assert.equal((await readBoundedTransactionJournal(handle(PRIVATE_FILE_MAX_BYTES+1))).length,PRIVATE_FILE_MAX_BYTES+1);
 await assert.rejects(readBoundedTransactionJournal(handle(TRANSACTION_JOURNAL_MAX_BYTES+1)),code('PRIVATE_FILE_READ_TOO_LARGE'));
});
test('Pay query original GET and submission responses each retain 2 MiB in the same bounded cold journal',async t=>{
 const f=await fixture(t),{target}=await f.store.bindPQPaySubmissionTarget(original.account,original.hash,ref,guard);await f.store.beginPQSubmission(original.account,original.hash,guard,target);
 await f.store.savePQPaySubmissionPacket(original.account,original.hash,packet(Buffer.alloc(2097152,255)));const submission=JSON.parse(await f.read()).pqProgress[0].result;
 const query=await f.store.beginPQPayQuery(original.account,original.hash,guard);assert.equal(query.request.method,'GET');assert.equal(query.stored,false);
 const response=packet(Buffer.alloc(2097152,254),{method:'GET',requestPath:query.request.requestPath});await f.store.savePQPayQueryPacket(original.account,original.hash,response);
 const before=await f.read(),state=JSON.parse(before);assert.deepEqual(state.pqProgress[0].result,submission);assert.equal(state.pqProgress[0].queryResult.bodyBytes,2097152);assert.ok(Buffer.byteLength(before)<TRANSACTION_JOURNAL_MAX_BYTES);
 const cold=f.cold(),p=await cold.readPQProgress(original.account,original.hash,guard);assert.equal(p.storageConfirmed,true);assert.equal(p.metadataConfirmed,true);assert.equal(p.status,'submission-unknown');assert.equal((await cold.readPQPayQueryPacket(original.account,original.hash)).body[0],254);
 await f.store.savePQPayQueryPacket(original.account,original.hash,response);assert.equal(await f.read(),before);
 await assert.rejects(f.store.savePQPayQueryPacket(original.account,original.hash,packet(Buffer.from([1]),{method:'GET',requestPath:query.request.requestPath})),code('PQ_PAY_QUERY_RESPONSE_CONFLICT'));
 assert.equal(await f.read(),before);await assert.rejects(f.store.assertPQProgressSafeToClose(),code('PQ_PROGRESS_CLOSE_UNCONFIRMED'));
});
test('Pay query uncapturable first response stays owned; valid later callback cannot erase it',async t=>{
 const f=await fixture(t),{target}=await f.store.bindPQPaySubmissionTarget(original.account,original.hash,ref,guard);await f.store.beginPQSubmission(original.account,original.hash,guard,target);
 const query=await f.store.beginPQPayQuery(original.account,original.hash,guard),first=packet(Buffer.alloc(2097153),{method:'GET',requestPath:query.request.requestPath});
 assert.throws(()=>f.store.savePQPayQueryPacket(original.account,original.hash,first),code('PQ_PAY_PACKET_TOO_LARGE'));
 assert.throws(()=>f.store.savePQPayQueryPacket(original.account,original.hash,packet()),code('PQ_PAY_QUERY_CAPTURE_UNCONFIRMED'));
 assert.equal(f.store.selectPQProgressOutcome(original.account,original.hash,s=>s.firstPayQueryResponse),first);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),code('PQ_PROGRESS_CLOSE_UNCONFIRMED'));assert.equal((await f.store.readPQProgress(original.account,original.hash,guard)).storageConfirmed,false);
});
