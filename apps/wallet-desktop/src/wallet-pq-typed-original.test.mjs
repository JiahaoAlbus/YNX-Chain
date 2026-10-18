import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './features/pq-transaction/typed-action-caller.mjs';
import {FileTransactionIntentStore} from './transaction-intent-store.mjs';
import {TransactionSubmissions} from './transaction-submissions.mjs';
import {parsePQTypedOriginalRecord} from './wallet-pq-typed-original.mjs';
import {projectPendingTransactions,projectPQOriginalObservation} from './transaction-resolution-display.mjs';
const sha=b=>'0x'+createHash('sha256').update(b).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
let handle,record;
before(async()=>{
 const input=JSON.parse(readFileSync(new URL('./features/pq-transaction/fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(row=>row.kind==='resource_delegation_create');
 handle=await createPQWalletKeyHandle({owner:input.owner,chainId:input.chainId});
 const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const reviewDTO={owner:input.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const signingDTO={...reviewDTO,executionHeight:'9007199254740994'},network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},selected={account:input.owner,networkId:input.chainId},now=1800000000000;
 const review=preparePQTypedActionReview(parsePQAccountAuthorization(reviewDTO,network),input,{...selected,operationId:'main-journal-controlled-1',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()});
 const member=signPQReviewedTypedAction(review,parsePQAccountAuthorization(signingDTO,network),handle,selected,now),raw=encodePQActionTransportData({member,originals:[]});
 record={version:2,account:input.owner,kind:'pq-typed-action',operationId:review.operationId,hash:sha(raw),wire:Buffer.from(raw).toString('base64url'),status:'signed-unsubmitted',typed:{networkId:input.chainId,memberHash:sha(member),review:copy(review),reviewSnapshot:reviewDTO,signingSnapshot:signingDTO}};
});
after(()=>{if(handle)destroyPQWalletKeyHandle(handle)});
async function setup(t){const dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-main-typed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'original-journal.json');return{filePath,store:new FileTransactionIntentStore({filePath})}}
test('normal Main journal retains exact typed raw/review/two snapshots and cold query never calls a sender or latest policy',async t=>{
 const f=await setup(t),account=record.account;await f.store.reserveOriginal(account,record.kind);f.store.captureOriginal(account,record,record.kind);await f.store.saveOriginal(account,record.hash,()=>{});
 const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.deepEqual((await cold.readPQOriginals(account,()=>{}))[0],record);
 let network=0;const submissions=new TransactionSubmissions({intentStore:cold,pqReadOriginal:async()=>{network++;throw Error('typed local read must not use legacy HTTP contract')}}),guard={account,assert(){}};
 const list=await submissions.list(account);assert.equal(list[0].kind,record.kind);assert.equal(list[0].canRetryExact,false);
 assert.equal(projectPendingTransactions({ok:true,value:list},account)[0].kind,record.kind);
 const observed=await submissions.checkPQ(record.hash,account,guard);assert.equal(observed.operationId,record.operationId);assert.equal(observed.memberHash,record.typed.memberHash);assert.equal(observed.nonce,record.typed.review.action.nonce);assert.equal(observed.signatureVerified,true);assert.equal(observed.networkQueryPerformed,false);assert.equal(network,0);
 for(const field of ['permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(observed[field],false);
 assert.deepEqual(projectPQOriginalObservation({ok:true,value:observed},{account,hash:record.hash,kind:record.kind}),{outcome:'original-verified-locally'});
 for(const key of ['permissionGranted','submitted','networkQueryPerformed','consensusFinality'])assert.throws(()=>projectPQOriginalObservation({ok:true,value:{...observed,[key]:true}},{account,hash:record.hash,kind:record.kind}));
 assert.ok(!JSON.stringify(observed).includes(record.wire));await assert.rejects(cold.reserveOriginal(account,record.kind));
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import{readFileSync}from'node:fs';import{FileTransactionIntentStore}from'./src/transaction-intent-store.mjs';import{TransactionSubmissions}from'./src/transaction-submissions.mjs';
  const p=JSON.parse(readFileSync(0,'utf8')),store=new FileTransactionIntentStore({filePath:p.filePath}),query=new TransactionSubmissions({intentStore:store});
  console.log(JSON.stringify(await query.checkPQ(p.hash,p.account,{account:p.account,assert(){}})));
 `],{cwd:new URL('../',import.meta.url),input:JSON.stringify({filePath:f.filePath,account,hash:record.hash}),encoding:'utf8',timeout:30000,maxBuffer:65536});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),observed);
});
test('latest consumed nonce or missing original snapshot refuses without overwriting the private record',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const saved=JSON.parse(await fs.readFile(f.filePath,'utf8'));
 for(const mutate of [r=>r.typed.signingSnapshot.ledgerNonce='2',r=>delete r.typed.reviewSnapshot,r=>r.typed.memberHash=record.hash]){
  const altered=copy(saved);mutate(altered.pqOriginals[0]);const raw=JSON.stringify(altered);await fs.writeFile(f.filePath,raw,{mode:0o600});
  await assert.rejects(new FileTransactionIntentStore({filePath:f.filePath}).readPQOriginals(record.account,()=>{}));assert.equal(await fs.readFile(f.filePath,'utf8'),raw);
 }
});
test('invalid typed output is retained as original UNKNOWN before parsing refuses it',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);const invalid=copy(record);delete invalid.typed.signingSnapshot;
 assert.throws(()=>f.store.captureOriginal(record.account,invalid,record.kind));assert.equal(f.store.localOriginal(record.account).pqRawUnverified.value,invalid);
 invalid.wire='changed-after-failure';assert.equal(f.store.localOriginal(record.account).pqRawUnverified.wire,record.wire);
 assert.equal(f.store.localOriginal(record.account).originalCausePresent,true);
 assert.throws(()=>f.store.captureOriginal(record.account,record,record.kind));
 await assert.rejects(f.store.reserveOriginal(record.account,record.kind));assert.equal((await f.store.unresolvedPreparation(record.account)).kind,record.kind);
 assert.throws(()=>parsePQTypedOriginalRecord(invalid));
});
test('typed save lost acknowledgement reconciles the exact original without a second save or producer',async t=>{
 const f=await setup(t);let armed=false,writes=0;
 const store=new FileTransactionIntentStore({filePath:f.filePath,io:{...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw false}}}});
 await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);armed=true;
 await assert.rejects(store.saveOriginal(record.account,record.hash,()=>{}));
 const held=store.localOriginal(record.account);assert.equal(held.pq.wire,record.wire);assert.equal(held.storageCausePresent,true);
 await assert.rejects(store.saveOriginal(record.account,record.hash,()=>{}),error=>error.data?.code==='PQ_ORIGINAL_RECONCILE_REQUIRED');
 const reconciled=await store.reconcilePQOriginal(record.account,record.hash,()=>{});assert.equal(reconciled.savedLocally,true);assert.equal(reconciled.submitted,false);assert.equal(writes,1);
 assert.equal((await new FileTransactionIntentStore({filePath:f.filePath}).readPQOriginals(record.account,()=>{}))[0].wire,record.wire);
});
test('late lock rejects typed local observation without mutating the original journal',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8');let assertions=0;
 await assert.rejects(f.store.inspectPQTypedOriginal(record.account,record.hash,()=>{if(++assertions>1)throw Error('QA_LOCKED')}),/QA_LOCKED/);
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
