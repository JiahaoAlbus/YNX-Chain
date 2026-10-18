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
import {retainPQTypedHTTPResponse} from './wallet-pq-typed-progress.mjs';
import {pqTypedBroadcastPermissionRequest} from './wallet-pq-typed-permission.mjs';
import {projectPendingTransactions,projectPQOriginalObservation} from './transaction-resolution-display.mjs';
const sha=b=>'0x'+createHash('sha256').update(b).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
let handle,record,memberBytes;
before(async()=>{
 const input=JSON.parse(readFileSync(new URL('./features/pq-transaction/fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(row=>row.kind==='resource_delegation_create');
 handle=await createPQWalletKeyHandle({owner:input.owner,chainId:input.chainId});
 const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const reviewDTO={owner:input.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const signingDTO={...reviewDTO,executionHeight:'9007199254740994'},network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},selected={account:input.owner,networkId:input.chainId},now=1800000000000;
 const review=preparePQTypedActionReview(parsePQAccountAuthorization(reviewDTO,network),input,{...selected,operationId:'main-journal-controlled-1',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()});
 const member=signPQReviewedTypedAction(review,parsePQAccountAuthorization(signingDTO,network),handle,selected,now),raw=encodePQActionTransportData({member,originals:[]});
 memberBytes=Buffer.from(member);
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
 const observed=await cold.inspectPQTypedOriginal(account,record.hash,()=>guard.assert());assert.equal(observed.operationId,record.operationId);assert.equal(observed.memberHash,record.typed.memberHash);assert.equal(observed.nonce,record.typed.review.action.nonce);assert.equal(observed.signatureVerified,true);assert.equal(observed.networkQueryPerformed,false);assert.equal(network,0);
 for(const field of ['permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(observed[field],false);
 assert.deepEqual(projectPQOriginalObservation({ok:true,value:observed},{account,hash:record.hash,kind:record.kind}),{outcome:'original-verified-locally'});
 for(const key of ['permissionGranted','submitted','networkQueryPerformed','consensusFinality'])assert.throws(()=>projectPQOriginalObservation({ok:true,value:{...observed,[key]:true}},{account,hash:record.hash,kind:record.kind}));
 assert.ok(!JSON.stringify(observed).includes(record.wire));await assert.rejects(cold.reserveOriginal(account,record.kind));
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import{readFileSync}from'node:fs';import{FileTransactionIntentStore}from'./src/transaction-intent-store.mjs';import{TransactionSubmissions}from'./src/transaction-submissions.mjs';
  const p=JSON.parse(readFileSync(0,'utf8')),store=new FileTransactionIntentStore({filePath:p.filePath}),query=new TransactionSubmissions({intentStore:store});
  console.log(JSON.stringify(await store.inspectPQTypedOriginal(p.account,p.hash,()=>{})));
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
test('typed save preserves another outstanding protected output budget before writing',async t=>{
 const f=await setup(t),other='0x'+'ab'.repeat(20);
 await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);
 const state=JSON.parse(await fs.readFile(f.filePath,'utf8'));
 // Controlled disk state models an older unresolved operation; its reservation
 // is not permission to sign and cannot be consumed by this account's save.
 state.preparations.push({account:other,kind:record.kind,maxBytes:1048576});
 await fs.writeFile(f.filePath,JSON.stringify(state),{mode:0o600});const before=await fs.readFile(f.filePath,'utf8');
 await assert.rejects(f.store.saveOriginal(record.account,record.hash,()=>{}),e=>e.data?.code==='PQ_ORIGINAL_STORAGE_CAPACITY');
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(f.store.localOriginal(record.account).pq.wire,record.wire);
 assert.equal(f.store.localOriginal(record.account).pqSaveAttempted,undefined);
 assert.equal(f.store.localOriginal(record.account).storageCausePresent,true);
});
test('typed pre-sign reservation persists exact output budget and rejects an oversized concurrent claim',async t=>{
 const f=await setup(t),budget=700000,other='0x'+'ab'.repeat(20);
 await f.store.reserveOriginal(record.account,record.kind,{reserveBytes:budget});
 assert.deepEqual(await f.store.unresolvedPreparation(record.account),{account:record.account,kind:record.kind,maxBytes:budget});
 await assert.rejects(f.store.reserveOriginal(other,record.kind,{reserveBytes:350000}));
 assert.equal(f.store.localOriginal(other),null);assert.equal(await f.store.unresolvedPreparation(other),null);
 assert.deepEqual(await new FileTransactionIntentStore({filePath:f.filePath}).unresolvedPreparation(record.account),{account:record.account,kind:record.kind,maxBytes:budget});
});
function nodeResponse(status='unknown'){
 const path='/transactions/pq/actions/'+record.hash,action=record.typed.review.action;
 const base={type:'',status:'unknown',committed:false,source:'comet-rpc',nativeTransactionHash:'',abciTransactionHash:record.hash,executionHeight:'0',amount:'0',fee:'0',nonce:'0',readbackUrl:'',abciReadbackUrl:path,error:'controlled unknown'};
 if(status!=='unknown')Object.assign(base,{type:action.kind,status,committed:status==='committed',nativeTransactionHash:record.typed.memberHash,wire:memberBytes.toString('base64'),transport:Buffer.from(record.wire,'base64url').toString('base64'),executionHeight:'9007199254740995',cometIndex:17,from:record.account,fee:action.fee,nonce:action.nonce,readbackUrl:'/transactions/pq/actions/originals/'+record.typed.memberHash});
 if(status==='committed'){delete base.error;base.effects={controlled:true};base.amount=action.payload.amountYNXT;base.to=action.payload.beneficiary;}
 return {method:'GET',requestPath:path,status:status==='unknown'?202:200,contentType:'application/json',cacheControl:'no-store',body:Buffer.from(JSON.stringify(base))};
}
test('actual Main checkPQ reads retained original under cold store and projects three node observations without resolving custody',async t=>{
 let reads=0,legacy=0;
 for(const [status,outcome] of [['committed','typed-commit-observed'],['rejected','typed-rejection-observed'],['unknown','typed-outcome-unknown']]){
  const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
  const before=await fs.readFile(f.filePath,'utf8'),cold=new FileTransactionIntentStore({filePath:f.filePath});
  const query=new TransactionSubmissions({intentStore:cold,pqReadOriginal:async()=>{legacy++;throw Error('wrong transport')},pqReadTypedOriginal:async(review,raw,original,assertCurrent)=>{
   reads++;assertCurrent();assert.deepEqual(review,record.typed.review);assert.equal(Buffer.from(raw).toString('base64url'),record.wire);assert.equal(original.memberHash,record.typed.memberHash);assert.equal(original.transportHash,record.hash);return nodeResponse(status);
  }});
  const observed=await query.checkPQ(record.hash,record.account,{account:record.account,assert(){}});assert.equal(observed.outcome,outcome);assert.equal(observed.networkQueryPerformed,true);
  for(const key of ['submitted','canRetry','clearsOriginal','consensusFinality','permissionGranted'])assert.equal(observed[key],false);
  assert.deepEqual(projectPQOriginalObservation({ok:true,value:observed},{account:record.account,hash:record.hash,kind:record.kind}),{outcome});
  if(status==='unknown')assert.equal(await fs.readFile(f.filePath,'utf8'),before);
  else {const progress=await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(record.account,record.hash,()=>{});assert.equal(progress.status,status==='committed'?'inclusion-observed':'rejection-observed');assert.equal(progress.storageConfirmed,true);}
  assert.deepEqual((await cold.readPQOriginals(record.account,()=>{}))[0],record);await assert.rejects(cold.reserveOriginal(record.account,record.kind));
 }
 assert.equal(reads,3);assert.equal(legacy,0);
});
test('actual Main typed query suppresses an in-flight late-lock result, preserving exact journal',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8');let live=true,release,entered;
 const started=new Promise(resolve=>{entered=resolve}),query=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:()=>new Promise(resolve=>{release=()=>resolve(nodeResponse());entered();})});
 const pending=query.checkPQ(record.hash,record.account,{account:record.account,assert(){if(!live)throw Error('QA_LOCKED_DURING_QUERY')}}),rejected=assert.rejects(pending,/QA_LOCKED_DURING_QUERY/);
 await started;live=false;release();await rejected;assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('actual Main typed query refuses unavailable reader or mismatched node original without legacy fallback or disk changes',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8'),guard={account:record.account,assert(){}};
 const absent=new TransactionSubmissions({intentStore:f.store});await assert.rejects(absent.checkPQ(record.hash,record.account,guard),e=>e.data?.code==='PQ_READ_SOURCE_UNAVAILABLE');
 const swapped=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>({...nodeResponse(),requestPath:'/transactions/pq/actions/0x'+'ab'.repeat(32)})});
 await assert.rejects(swapped.checkPQ(record.hash,record.account,guard));assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('node query after actual save lost acknowledgement neither clears held first cause nor repeats write',async t=>{
 const f=await setup(t);let armed=false,writes=0;
 const store=new FileTransactionIntentStore({filePath:f.filePath,io:{...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw false}}}});
 await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);armed=true;await assert.rejects(store.saveOriginal(record.account,record.hash,()=>{}));
 const held=store.localOriginal(record.account),before=await fs.readFile(f.filePath,'utf8'),query=new TransactionSubmissions({intentStore:store,pqReadTypedOriginal:async()=>nodeResponse()});
 const first=held.storageCause,observed=await query.checkPQ(record.hash,record.account,{account:record.account,assert(){}});assert.equal(observed.outcome,'typed-outcome-unknown');assert.equal(store.localOriginal(record.account),held);assert.equal(held.storageCausePresent,true);assert.equal(held.storageCause,first);assert.equal(first.cause,false);assert.equal(writes,1);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('actual Main typed node query works after fresh process restart using only retained private original',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8'),response=nodeResponse();
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import{readFileSync}from'node:fs';import{FileTransactionIntentStore}from'./src/transaction-intent-store.mjs';import{TransactionSubmissions}from'./src/transaction-submissions.mjs';
  const p=JSON.parse(readFileSync(0,'utf8')),store=new FileTransactionIntentStore({filePath:p.filePath});let reads=0;
  const query=new TransactionSubmissions({intentStore:store,pqReadTypedOriginal:async(review,raw,original,guard)=>{reads++;guard();return{...p.response,body:Buffer.from(p.body,'base64')}}});
  const observed=await query.checkPQ(p.hash,p.account,{account:p.account,assert(){}});console.log(JSON.stringify({observed,reads}));
 `],{cwd:new URL('../',import.meta.url),input:JSON.stringify({filePath:f.filePath,hash:record.hash,account:record.account,response:{...response,body:undefined},body:response.body.toString('base64')}),encoding:'utf8',timeout:30000,maxBuffer:65536});
 assert.equal(child.status,0,child.stderr);const output=JSON.parse(child.stdout);assert.equal(output.reads,1);assert.equal(output.observed.outcome,'typed-outcome-unknown');assert.equal(output.observed.memberHash,record.typed.memberHash);assert.equal(output.observed.hash,record.hash);assert.equal(output.observed.consensusFinality,false);assert.equal(output.observed.canRetry,false);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('typed known node progress persists across restart and never regresses to later UNKNOWN or permits a new submission',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const guard={account:record.account,assert(){}},known=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>nodeResponse('committed')});
 assert.equal((await known.checkPQ(record.hash,record.account,guard)).outcome,'typed-commit-observed');const before=await fs.readFile(f.filePath,'utf8');
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),unknown=new TransactionSubmissions({intentStore:cold,pqReadTypedOriginal:async()=>nodeResponse()});
 assert.equal((await unknown.checkPQ(record.hash,record.account,guard)).outcome,'typed-commit-observed');assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 const marker=await cold.beginPQSubmission(record.account,record.hash,()=>{});assert.equal(marker.created,false);assert.equal(marker.status,'inclusion-observed');
 const identity=JSON.parse(before).pqProgress[0];assert.equal(identity.nativeTransactionHash,record.typed.memberHash);assert.equal(identity.abciTransactionHash,record.hash);assert.equal(identity.hash,record.hash);
});
test('a pre-submission UNKNOWN query does not invent broadcast admission or block a later independently approved first submission',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 await new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>nodeResponse()}).checkPQ(record.hash,record.account,{account:record.account,assert(){}});
 assert.equal((await f.store.readPQProgress(record.account,record.hash,()=>{})).status,'signed-unsubmitted');
 const marker=await f.store.beginPQSubmission(record.account,record.hash,()=>{});assert.equal(marker.created,true);assert.equal(marker.status,'submission-unknown');
 // A journal marker is only a durable fence, never consent or a POST.
 assert.equal((await f.store.beginPQSubmission(record.account,record.hash,()=>{})).created,false);
});
test('a read-only early UNKNOWN leaves normal shutdown safe without inventing a submit record',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 await new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>nodeResponse()}).checkPQ(record.hash,record.account,{account:record.account,assert(){}});
 assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('typed node observation storage failure retains the exact response and flushes locally without a second query',async t=>{
 const f=await setup(t);let armed=false,reads=0;
 const store=new FileTransactionIntentStore({filePath:f.filePath,io:{...fs,rename:async(...args)=>{if(armed)throw Error('QA_TYPED_PROGRESS_WRITE_REFUSED');return fs.rename(...args)}}});
 await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);await store.saveOriginal(record.account,record.hash,()=>{});armed=true;
 const query=new TransactionSubmissions({intentStore:store,pqReadTypedOriginal:async()=>{reads++;return nodeResponse('committed')}});
 await assert.rejects(query.checkPQ(record.hash,record.account,{account:record.account,assert(){}}));
 const held=await store.readPQProgress(record.account,record.hash,()=>{});assert.equal(held.status,'inclusion-observed');assert.equal(held.storageConfirmed,false);assert.equal(held.localResultHeld,true);
 const summary=(await store.pqSummaries(record.account))[0];assert.equal(summary.status,'pq-inclusion-observed');assert.equal(summary.resultHeldInMemory,true);
 await assert.rejects(store.assertPQProgressSafeToClose(),e=>e.data?.code==='PQ_PROGRESS_CLOSE_UNCONFIRMED');
 armed=false;assert.equal((await store.flushPQProgressResult(record.account,record.hash,()=>{})).stored,true);assert.equal(reads,1);
 assert.equal((await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(record.account,record.hash,()=>{})).status,'inclusion-observed');
 assert.equal((await store.assertPQProgressSafeToClose()).safe,true);
});
test('typed response is adopted before a late lock, while the public query result remains cancelled',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 let live=true;const query=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>{live=false;return nodeResponse('committed')}});
 await assert.rejects(query.checkPQ(record.hash,record.account,{account:record.account,assert(){if(!live)throw Error('QA_LATE_LOCK')}}),/QA_LATE_LOCK/);
 const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.equal((await cold.readPQProgress(record.account,record.hash,()=>{})).status,'inclusion-observed');assert.deepEqual((await cold.readPQOriginals(record.account,()=>{}))[0],record);
});
test('typed response capture copies bytes without invoking overridden buffer getters or accepting shared memory',()=>{
 const response=nodeResponse(),expected=Buffer.from(response.body);let accessed=false;
 Object.defineProperty(response.body,'buffer',{get(){accessed=true;throw Error('QA_GETTER_MUST_NOT_RUN')}});
 const held=retainPQTypedHTTPResponse(response);assert.equal(accessed,false);response.body.fill(0);assert.deepEqual(held.body,expected);
 assert.throws(()=>retainPQTypedHTTPResponse({...nodeResponse(),body:new Uint8Array(new SharedArrayBuffer(8))}));
});
test('invalid UTF8 typed result is held before decoding failure and original bytes are never replaced',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8'),response={...nodeResponse(),body:Buffer.from([0xff])},pending=f.store.savePQTypedReadResult(record.account,record.hash,response);response.body.fill(0);
 await assert.rejects(pending);f.store.selectPQProgressOutcome(record.account,record.hash,held=>{assert.deepEqual([...held.firstTypedResponse.body],[0xff]);assert.equal(held.firstRawPresent,true)});assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('typed observation and explicit flush preserve another signer reserved output capacity',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const other='0x'+'b3'.repeat(20),budget=1048576-Buffer.byteLength(await fs.readFile(f.filePath,'utf8'))-1024;
 await f.store.reserveOriginal(other,record.kind,{reserveBytes:budget});const before=await fs.readFile(f.filePath,'utf8');
 const query=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>nodeResponse('committed')});
 await assert.rejects(query.checkPQ(record.hash,record.account,{account:record.account,assert(){}}),e=>e.data?.code==='PQ_SUBMISSION_STORAGE_CAPACITY');
 await assert.rejects(f.store.flushPQProgressResult(record.account,record.hash,()=>{}),e=>e.data?.code==='PQ_SUBMISSION_STORAGE_CAPACITY');
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal((await f.store.unresolvedPreparation(other)).maxBytes,budget);assert.equal((await f.store.readPQProgress(record.account,record.hash,()=>{})).localResultHeld,true);
});
test('new independent typed broadcast request binds the exact original dual hashes and current policy, never extends sign consent',()=>{
 const at=Date.parse(record.typed.review.expiresAt)+1000,expiresAt=new Date(at+30000).toISOString(),dto={...record.typed.signingSnapshot,executionHeight:'9007199254740995'},network={owner:record.account,chainId:record.typed.networkId,nativeChainId:'6423'};
 const request=pqTypedBroadcastPermissionRequest(record,parsePQAccountAuthorization(dto,network),{at,expiresAt});
 assert.equal(Object.keys(request).length,18);assert.equal(request.action,'broadcast');assert.equal(request.transportHash,record.hash);assert.equal(request.memberHash,record.typed.memberHash);assert.equal(request.requestDigest,record.typed.review.requestDigest);assert.equal(request.operationId,record.operationId);assert.equal(request.reviewExecutionHeight,record.typed.review.executionHeight);assert.equal(request.executionHeight,dto.executionHeight);assert.equal(request.expiresAt,expiresAt);assert.ok(Object.isFrozen(request.typedAction));assert.equal(Object.hasOwn(request,'approved'),false);
});
test('typed broadcast request refuses consumed nonce, regressed signing height and unbounded review expiry',()=>{
 const at=Date.parse(record.typed.review.expiresAt)+1000,expiresAt=new Date(at+30000).toISOString(),network={owner:record.account,chainId:record.typed.networkId,nativeChainId:'6423'};
 for(const mutation of [{ledgerNonce:'9007199254740994'},{executionHeight:record.typed.reviewSnapshot.executionHeight}])assert.throws(()=>pqTypedBroadcastPermissionRequest(record,parsePQAccountAuthorization({...record.typed.signingSnapshot,...mutation},network),{at,expiresAt}));
 const snapshot=parsePQAccountAuthorization(record.typed.signingSnapshot,network);
 for(const expiry of [new Date(at).toISOString(),new Date(at+30001).toISOString(),'not-a-date'])assert.throws(()=>pqTypedBroadcastPermissionRequest(record,snapshot,{at,expiresAt:expiry}));
});
