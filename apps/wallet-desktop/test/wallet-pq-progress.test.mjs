import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {readFileSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {gunzipSync} from 'node:zlib';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {FileTransactionIntentStore as OldStore} from '/Users/huangjiahao/.ynx-build-capacity-20261011/wallet-r33-payload-consumer-20261018/apps/wallet-desktop/src/transaction-intent-store.mjs';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {projectPendingTransactions} from '../src/transaction-resolution-display.mjs';
import {TransactionSubmissions} from '../src/transaction-submissions.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletNativeTransfer} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
const vector=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)),{maxOutputLength:8*1024*1024})),v=vector.originals.find(r=>r.name==='transfer-lost-response'),account=vector.owner;
const original=createPQOriginalRecord({account,kind:'pq-transfer',operationId:'QA-progress-original',request:preparePQTransferTransport(Buffer.from(v.wire,'base64'))});
const packet=name=>{const row=vector.http.find(r=>r.name===name);return {phase:row.method==='POST'?'submission':'read',statusCode:row.statusCode,text:Buffer.from(row.bodyWire,'base64').toString('utf8')};};
const unknown=packet('transfer-outcome-unknown'),committed=packet('transfer-original-reconciled'),guard=()=>{};
// Actual private journal + exact producer public fixtures, not a live sender,
// user account, transport grant, source qualification or chain finality.
async function fixture(t,record=original){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-progress-')),filePath=path.join(directory,'journal.json'),fault={armed:false,mode:null,writes:0};t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const io={...fs,rename:async(...args)=>{if(fault.armed){fault.writes++;if(fault.mode==='before')throw false;}await fs.rename(...args);if(fault.armed&&fault.mode==='after')throw false;}};
 const store=new FileTransactionIntentStore({filePath,io});await store.reserveOriginal(account,'pq-transfer');store.captureOriginal(account,record,'pq-transfer');await store.saveOriginal(account,record.hash,guard);fault.writes=0;fault.armed=true;
 return {directory,filePath,store,fault,cold:()=>new FileTransactionIntentStore({filePath}),read:()=>fs.readFile(filePath,'utf8')};
}
test('PQ submission marker is durable before acknowledgement and cold status never returns to unsubmitted',async t=>{
 const f=await fixture(t),before=await f.read();assert.equal((await f.store.pqSummaries(account))[0].status,'pq-signed-unsubmitted');assert.equal(await f.read(),before);
 assert.deepEqual(await f.store.beginPQSubmission(account,original.hash,guard),{created:true,status:'submission-unknown'});assert.equal(JSON.parse(await f.read()).schemaVersion,9);
 assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'submission-unknown');assert.equal((await f.cold().pqSummaries(account))[0].status,'pq-submission-unknown');assert.equal((await f.store.beginPQSubmission(account,original.hash,guard)).created,false);assert.equal(f.fault.writes,1);
 await assert.rejects(f.cold().reserveOriginal(account,'pq-transfer'));assert.deepEqual(await f.cold().readPQOriginals(account,guard),[original]);
});
test('late result after lock saves original inclusion observation without a live key lease or replay',async t=>{
 const f=await fixture(t),lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(account);await lifecycle.unlock();
 await lifecycle.run(g=>f.store.beginPQSubmission(account,original.hash,()=>g.assert()));lifecycle.setFocused(false);assert.equal(lifecycle.status().locked,true);
 // Storage continuation after returned effect is intentionally guard-free;
 // neither a signer nor transport can be selected through this method.
 await f.store.savePQSubmissionResult(account,original.hash,committed);
 const cold=f.cold(),result=await cold.readPQProgress(account,original.hash,guard);assert.equal(result.status,'inclusion-observed');assert.equal(result.storageConfirmed,true);assert.equal(result.retryAuthorized,false);assert.equal(result.consensusFinality,false);assert.equal((await cold.pqSummaries(account))[0].status,'pq-inclusion-observed');
 assert.equal((await cold.saveOriginal(account,original.hash,guard)).submitted,true);assert.equal((await cold.reconcilePQOriginal(account,original.hash,guard)).submissionStatus,'inclusion-observed');assert.deepEqual(await cold.readPQOriginals(account,guard),[original]);
});
test('actual producer rejection stays distinct from unsubmitted/unknown and never permits a replay',async t=>{
 const v=vector.originals.find(row=>row.name==='transfer-after-revocation'),rejected=createPQOriginalRecord({account,kind:'pq-transfer',operationId:'QA-rejected-original',request:preparePQTransferTransport(Buffer.from(v.wire,'base64'))}),f=await fixture(t,rejected);
 await f.store.beginPQSubmission(account,rejected.hash,guard);await f.store.savePQSubmissionResult(account,rejected.hash,packet('transfer-rejected-after-revocation'));
 const result=await f.cold().readPQProgress(account,rejected.hash,guard);assert.equal(result.status,'rejection-observed');assert.equal(result.retryAuthorized,false);assert.equal(result.clearsOriginal,false);assert.equal((await f.cold().pqSummaries(account))[0].status,'pq-rejection-observed');assert.equal((await f.store.beginPQSubmission(account,rejected.hash,guard)).created,false);
 const before=await f.read();await f.store.savePQSubmissionResult(account,rejected.hash,{phase:'read',statusCode:202,text:JSON.stringify({status:'unknown',committed:false,source:'comet-rpc',nativeTransactionHash:rejected.hash,readbackUrl:'/transactions/pq/originals/'+rejected.hash,amount:'0',fee:'0',nonce:'0',executionHeight:'0'})});assert.equal(await f.read(),before);
});
test('real 202 then GET inclusion advances same original; duplicate callbacks and later UNKNOWN do not rewrite or regress',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);await f.store.savePQSubmissionResult(account,original.hash,unknown);assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'submission-unknown');
 await f.store.savePQSubmissionResult(account,original.hash,committed);const before=await f.read(),writes=f.fault.writes;
 assert.equal((await f.store.savePQSubmissionResult(account,original.hash,committed)).changed,false);await f.store.savePQSubmissionResult(account,original.hash,unknown);assert.equal(await f.read(),before);assert.equal(f.fault.writes,writes);assert.equal((await f.store.readPQProgress(account,original.hash,guard)).status,'inclusion-observed');
});
test('marker write lost ACK never admits a second outward attempt, even after cold reopen',async t=>{
 const f=await fixture(t);f.fault.mode='after';await assert.rejects(f.store.beginPQSubmission(account,original.hash,guard));f.fault.mode=null;
 assert.equal((await f.store.readPQProgress(account,original.hash,guard)).status,'submission-unknown');assert.equal((await f.store.beginPQSubmission(account,original.hash,guard)).created,false);assert.equal((await f.cold().beginPQSubmission(account,original.hash,guard)).created,false);assert.equal(f.fault.writes,1);
});
test('marker write before commit fails closed in process and cannot manufacture successful admission',async t=>{
 const f=await fixture(t),before=await f.read();f.fault.mode='before';await assert.rejects(f.store.beginPQSubmission(account,original.hash,guard));f.fault.mode=null;assert.equal(await f.read(),before);
 await assert.rejects(f.store.beginPQSubmission(account,original.hash,guard),{data:{code:'PQ_SUBMISSION_RECONCILE_REQUIRED'}});assert.equal((await f.store.readPQProgress(account,original.hash,guard)).storageConfirmed,false);assert.equal(f.fault.writes,1);
});
test('result save lost ACK reconciles readonly, preserving raw result and distinct falsy storage cause',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);f.fault.mode='after';await assert.rejects(f.store.savePQSubmissionResult(account,original.hash,committed));f.fault.mode=null;const writes=f.fault.writes,before=await f.read();
 const result=await f.store.readPQProgress(account,original.hash,guard);assert.equal(result.storageConfirmed,true);assert.equal(result.status,'inclusion-observed');assert.deepEqual(result.storageCause,{kind:'boolean',value:false,code:null});assert.equal(f.fault.writes,writes);assert.equal(await f.read(),before);
 f.store.selectPQProgressOutcome(account,original.hash,slot=>{assert.equal(slot.storageRawPresent,true);assert.equal(slot.storageRaw,false);assert.equal(slot.latestResult.text,committed.text);});
 await f.store.savePQSubmissionResult(account,original.hash,committed);assert.equal(f.fault.writes,writes);
});
test('failed result save retains complete response in memory; explicit local flush writes it without another submission',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);f.fault.mode='before';await assert.rejects(f.store.savePQSubmissionResult(account,original.hash,committed));f.fault.mode=null;
 const held=await f.store.readPQProgress(account,original.hash,guard);assert.equal(held.status,'inclusion-observed');assert.equal(held.storageConfirmed,false);assert.equal(held.localResultHeld,true);assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'submission-unknown');
 const result=await f.store.flushPQProgressResult(account,original.hash,guard);assert.equal(result.status,'inclusion-observed');assert.equal(result.retryAuthorized,false);assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'inclusion-observed');assert.equal((await f.cold().beginPQSubmission(account,original.hash,guard)).created,false);
});
test('read IO failure after returned response keeps raw bytes before validation and explicit flush binds the same original',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);const open=f.store.io.open;let armed=true;f.store.io.open=async(file,...args)=>{if(armed&&file===f.filePath){armed=false;throw Error('QA_READ_IO_FAILURE');}return open(file,...args);};
 await assert.rejects(f.store.savePQSubmissionResult(account,original.hash,committed));f.store.io.open=open;f.store.selectPQProgressOutcome(account,original.hash,slot=>{assert.equal(slot.latestResult.text,committed.text);assert.equal(slot.unparsedResult.text,committed.text);assert.equal(slot.storageRawPresent,true);});
 assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'submission-unknown');await f.store.flushPQProgressResult(account,original.hash,guard);assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'inclusion-observed');assert.equal((await f.store.beginPQSubmission(account,original.hash,guard)).created,false);
});
test('fresh durable inclusion wins over stale in-process UNKNOWN during later callback and failure metadata',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);await f.cold().savePQSubmissionResult(account,original.hash,committed);const before=await f.read();assert.equal((await f.store.readPQProgress(account,original.hash,guard)).status,'inclusion-observed');
 await f.store.savePQSubmissionResult(account,original.hash,unknown);assert.equal(await f.read(),before);await f.store.savePQSubmissionFailure(account,original.hash,false);assert.equal((await f.cold().readPQProgress(account,original.hash,guard)).status,'inclusion-observed');assert.equal((await f.store.pqSummaries(account))[0].status,'pq-inclusion-observed');
});
test('unreconciled signing save cannot enter submission even when its original bytes reached disk',async t=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-sign-save-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filePath=path.join(directory,'journal.json');let armed=false;const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed)throw false;}};
 const store=new FileTransactionIntentStore({filePath,io});await store.reserveOriginal(account,'pq-transfer');store.captureOriginal(account,original,'pq-transfer');armed=true;await assert.rejects(store.saveOriginal(account,original.hash,guard));armed=false;await assert.rejects(store.beginPQSubmission(account,original.hash,guard),{data:{code:'PQ_ORIGINAL_RECONCILE_REQUIRED'}});
 const before=JSON.parse(await fs.readFile(filePath,'utf8'));assert.equal(before.schemaVersion,6);assert.equal('pqProgress' in before,false);await store.reconcilePQOriginal(account,original.hash,guard);assert.equal((await store.beginPQSubmission(account,original.hash,guard)).created,true);
});
test('private response capacity is checked before another submission marker without pruning originals',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);const padded={...committed,text:committed.text+' '.repeat(500000-Buffer.byteLength(committed.text))};await f.store.savePQSubmissionResult(account,original.hash,padded);
 const other='0x'+'22'.repeat(20),handle=await createPQWalletKeyHandle({chainId:vector.networkId,owner:other});t.after(()=>destroyPQWalletKeyHandle(handle));const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle)),snapshot=parsePQAccountAuthorization({owner:other,executionHeight:'30',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:vector.networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:pair.algorithmVersion,owner:other,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]},{chainId:vector.networkId,nativeChainId:'6423',owner:other});
 const record=createPQOriginalRecord({account:other,kind:'pq-transfer',operationId:'QA-capacity-other',request:signPQWalletNativeTransfer(handle,{chainId:vector.networkId,nativeChainId:'6423',from:other,to:'0x'+'33'.repeat(20),amount:'1',fee:'1',nonce:'2'},snapshot)});await f.store.reserveOriginal(other,'pq-transfer');f.store.captureOriginal(other,record,'pq-transfer');await f.store.saveOriginal(other,record.hash,guard);const before=await f.read(),writes=f.fault.writes;
 await assert.rejects(f.store.beginPQSubmission(other,record.hash,guard),{data:{code:'PQ_SUBMISSION_STORAGE_CAPACITY'}});assert.equal(await f.read(),before);assert.equal(f.fault.writes,writes);assert.deepEqual(await f.store.readPQOriginals(other,guard),[record]);assert.deepEqual(await f.store.readPQOriginals(account,guard),[original]);
});
test('first falsy operation cause stays separate from later storage cause and never exposes error payload',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);await f.store.savePQSubmissionFailure(account,original.hash,false);f.fault.mode='before';await assert.rejects(f.store.savePQSubmissionResult(account,original.hash,committed));f.fault.mode=null;
 const state=await f.store.readPQProgress(account,original.hash,guard);assert.deepEqual(state.firstCause,{kind:'boolean',value:false,code:null});assert.deepEqual(state.storageCause,{kind:'boolean',value:false,code:null});await f.store.flushPQProgressResult(account,original.hash,guard);
 const before=await f.read();await f.store.savePQSubmissionFailure(account,original.hash,'QA-secret-message-not-for-journal');assert.equal((await f.store.readPQProgress(account,original.hash,guard)).firstCause.value,false);assert.equal((await f.read()).includes('QA-secret-message'),false);assert.equal(await f.read(),before);
});
test('wrong hash/wire or conflicting inclusion cannot replace the observed original',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);await f.store.savePQSubmissionResult(account,original.hash,committed);const before=await f.read(),body=JSON.parse(committed.text);body.executionHeight=String(Number(body.executionHeight)+1);body.transaction.blockNumber++;
 await assert.rejects(f.store.savePQSubmissionResult(account,original.hash,{...committed,text:JSON.stringify(body)}),{code:'PQ_PROGRESS_OBSERVATION_CONFLICT'});assert.equal(await f.read(),before);assert.equal((await f.store.readPQProgress(account,original.hash,guard)).status,'inclusion-observed');
 const bad=JSON.parse(committed.text);bad.nativeTransactionHash='0x'+'00'.repeat(32);await assert.rejects(f.store.savePQSubmissionResult(account,original.hash,{...committed,text:JSON.stringify(bad)}));assert.equal(await f.read(),before);
});
test('cold journal tampering fails closed; previous reader refuses v9 without rewriting it',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);await f.store.savePQSubmissionResult(account,original.hash,committed);const before=await f.read();await assert.rejects(new OldStore({filePath:f.filePath}).readPQOriginals(account,guard));assert.equal(await f.read(),before);
 const changed=JSON.parse(before);changed.pqProgress[0].abciTransactionHash=changed.pqProgress[0].nativeTransactionHash;await fs.writeFile(f.filePath,JSON.stringify(changed)+'\n',{mode:0o600});const corrupt=await f.read();await assert.rejects(f.cold().readPQProgress(account,original.hash,guard));assert.equal(await f.read(),corrupt);
});
test('normal pending caller displays real progress rather than calling an entered submission unsubmitted',async t=>{
 const f=await fixture(t);await f.store.beginPQSubmission(account,original.hash,guard);const service=new TransactionSubmissions({intentStore:f.store});let rows=projectPendingTransactions({ok:true,value:await service.list(account)},account);assert.equal(rows[0].status,'pq-submission-unknown');
 await f.store.savePQSubmissionResult(account,original.hash,committed);rows=projectPendingTransactions({ok:true,value:await service.list(account)},account);assert.equal(rows[0].status,'pq-inclusion-observed');assert.equal(rows[0].canRetryExact,false);assert.equal('wire' in rows[0],false);assert.equal('text' in rows[0],false);
});
