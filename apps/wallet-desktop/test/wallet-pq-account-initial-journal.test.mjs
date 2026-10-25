import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {preparePQAccountInitialTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord,parsePQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {pqSubmissionIdentity} from '../src/wallet-pq-progress.mjs';
import {TransactionSubmissions} from '../src/transaction-submissions.mjs';
import {inspectRetainedPQOriginal} from '../src/wallet-pq-local-original.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/pq-account-initial-public.json',import.meta.url))),member=Buffer.from(fixture.wire,'base64url'),account=fixture.expected.owner;
const make=()=>createPQOriginalRecord({account,kind:'pq-account-initial',operationId:'PUBLIC-birth-once',expected:fixture.expected,request:preparePQAccountInitialTransport(member,fixture.expected)});
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-public-birth-journal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const filePath=path.join(root,'original.json'),store=new FileTransactionIntentStore({filePath});return{store,filePath,cold:()=>new FileTransactionIntentStore({filePath})};}
test('birth uses original SDK42 Member parser and distinct native/ABCI journal identities, not migration',()=>{
 assert.equal(fixture.realAccount,false);assert.equal(fixture.SourceAdmission,false);const record=make();assert.equal(record.hash,fixture.transportHash);assert.equal(record.abciTransactionHash,fixture.abciTransactionHash);assert.notEqual(record.hash,record.abciTransactionHash);assert.deepEqual(record.initialBinding,fixture.expected);assert.equal(record.wire,fixture.wire);assert.equal(pqSubmissionIdentity(record).abciTransactionHash,fixture.abciTransactionHash);
 for(const change of [r=>r.hash=r.abciTransactionHash,r=>r.abciTransactionHash=r.hash,r=>r.initialBinding={...r.initialBinding,executionHeight:fixture.intent.activateAt},r=>r.initialBinding={...r.initialBinding,Root:true},r=>r.kind='pq-migration']){const r=structuredClone(record);change(r);assert.throws(()=>parsePQOriginalRecord(r));}
});
test('birth original is captured before late lock, saved once and read back unchanged after reopen',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(account,'pq-account-initial');const out=f.store.capturePQAccountInitialMember(account,member,{expected:fixture.expected,operationId:'PUBLIC-birth-once'});assert.equal(out.transportHash,fixture.transportHash);assert.equal(out.abciTransactionHash,fixture.abciTransactionHash);
 await assert.rejects(f.store.saveOriginal(account,out.transportHash,()=>{throw Error('CONTROLLED_LOCK');}),/CONTROLLED_LOCK/);assert.equal(f.store.localOriginal(account).pq.wire,fixture.wire);
 const saved=await f.store.saveOriginal(account,out.transportHash,()=>{});assert.equal(saved.savedLocally,true);assert.equal(saved.submitted,false);const cold=f.cold(),records=await cold.readPQOriginals(account,()=>{});assert.deepEqual(records,[make()]);assert.equal((await cold.readPQProgress(account,out.transportHash,()=>{})).status,'signed-unsubmitted');
 const local=await inspectRetainedPQOriginal({intentStore:cold},out.transportHash,account,{account,assert(){}});assert.equal(local.outcome,'original-retained-locally');assert.equal(local.networkQueryPerformed,false);assert.equal(local.signatureVerified,false);
});
test('birth UNKNOWN survives cold reopen and never permits a replacement reservation',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(account,'pq-account-initial');f.store.capturePQAccountInitialMember(account,member,{expected:fixture.expected,operationId:'PUBLIC-birth-once'});await f.store.saveOriginal(account,fixture.transportHash,()=>{});await f.store.beginPQSubmission(account,fixture.transportHash,()=>{});
 const cold=f.cold(),view=await cold.readPQProgress(account,fixture.transportHash,()=>{});assert.equal(view.status,'submission-unknown');assert.equal(view.retryAuthorized,false);assert.equal(view.consensusFinality,false);await assert.rejects(cold.reserveOriginal(account,'pq-account-initial'));assert.deepEqual(await f.cold().readPQOriginals(account,()=>{}),[make()]);
 await assert.rejects(inspectRetainedPQOriginal({intentStore:cold},fixture.transportHash,account,{account,assert(){}}),{code:'PQ_ORIGINAL_PROGRESS_QUERY_REQUIRED'});
});
test('malformed birth output is held before validation, first cause stays and recapture is refused',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(account,'pq-account-initial');const broken=Buffer.from(member);broken[broken.length-1]^=1;
 assert.throws(()=>f.store.capturePQAccountInitialMember(account,broken,{expected:fixture.expected,operationId:'PUBLIC-birth-once'}));const slot=f.store.localOriginal(account);assert.deepEqual(slot.pqMemberData,broken);assert.equal(slot.originalCausePresent,true);const cause=slot.originalCause;
 assert.throws(()=>f.store.capturePQAccountInitialMember(account,member,{expected:fixture.expected,operationId:'PUBLIC-birth-once'}));assert.equal(f.store.localOriginal(account).originalCause,cause);await assert.rejects(f.cold().reserveOriginal(account,'pq-account-initial'));await assert.rejects(f.store.assertPQProgressSafeToClose(),error=>error.data?.code==='PQ_ACCOUNT_INITIAL_CLOSE_UNCONFIRMED');
 const rows=await new TransactionSubmissions({intentStore:f.store}).list(account);assert.equal(rows[0].signingUnknown,true);assert.equal(rows[0].hash,null);assert.equal(rows[0].canRetryExact,false);assert.equal('wire' in rows[0],false);
});
