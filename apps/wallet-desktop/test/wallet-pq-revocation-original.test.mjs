import test from 'node:test';
import assert from 'node:assert/strict';
import {keyGen,destroyKey,batchSign,extract,encodeMember,discardBatch} from '@ynx/batch-v01-candidate';
import {encodePQRevocationIntent,encodePQRevocationRequest,preparePQRevocationTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord,parsePQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {projectPendingTransactions} from '../src/transaction-resolution-display.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {TransactionSubmissions} from '../src/transaction-submissions.mjs';
// Fresh synthetic QA signature only. No wallet, network or user key access.
test('revocation original retains exact detached wire and identity without submission authority',async t=>{
 const key=keyGen({provider:'portable'});let batch;
 try{
  const account='0x'+'11'.repeat(20),intent={chainId:'01'.repeat(32),owner:account,algorithmVersion:'YNX-BATCH/v0.1',pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex'),authorizingRevision:'1',throughRevision:'2',ledgerNonce:'9007199254740994',executeAt:'25',revokeAt:'26'};
  const signed=batchSign(key.privateKey,{chainId:Buffer.from(intent.chainId,'hex'),owner:account,purpose:'ACCOUNT-REVOCATION'},[encodePQRevocationIntent(intent)]);batch=signed.batch;
  const request=preparePQRevocationTransport(encodePQRevocationRequest({intent,currentPQMember:encodeMember(extract(batch,0))}));
  const record=createPQOriginalRecord({account,kind:'pq-revocation',operationId:'QA-revoke-original',request});
  assert.equal(record.status,'signed-unsubmitted');assert.equal(record.hash,request.transportHash);assert.deepEqual(Buffer.from(record.wire,'base64url'),request.body);
  request.body.fill(0);assert.deepEqual(parsePQOriginalRecord(JSON.parse(JSON.stringify(record))),record);
  for(const kind of ['pq-transfer','pq-migration'])assert.throws(()=>parsePQOriginalRecord({...record,kind}),{code:'PQ_ORIGINAL_RECORD_INVALID'});
  for(const patch of [{account:'0x'+'22'.repeat(20)},{hash:'0'.repeat(64)},{status:'submitted'},{wire:record.wire+'='},{retryAuthorized:true}])assert.throws(()=>parsePQOriginalRecord({...record,...patch}),{code:'PQ_ORIGINAL_RECORD_INVALID'});
  assert.throws(()=>createPQOriginalRecord({account,kind:'pq-revocation',operationId:'QA-wrong-route',request:{...request,path:'/transactions/pq/broadcast'}}),{code:'PQ_ORIGINAL_RECORD_INVALID'});
  assert.equal(Object.hasOwn(record,'submitted'),false);assert.equal(Object.hasOwn(record,'retryAuthorized'),false);
  await t.test('lock retains original; explicit save and cold reopen preserve exact identity',async t=>{
   const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-revocation-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
   const filePath=path.join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath});
   await store.reserveOriginal(account,'pq-revocation');store.captureOriginal(account,record,'pq-revocation');
   await assert.rejects(store.saveOriginal(account,record.hash,()=>{throw Error('QA_LOCKED');}));
   assert.equal(store.localOriginal(account).pq.wire,record.wire);
   const submissions=new TransactionSubmissions({intentStore:store});
   const held=projectPendingTransactions({ok:true,value:await submissions.list(account)},account);
   assert.equal(held[0].status,'pq-save-unconfirmed');assert.equal(held[0].kind,'pq-revocation');assert.equal(held[0].canRetryExact,false);
   await assert.rejects(submissions.recoverPQOriginal(record.hash,account,{account:'0x'+'22'.repeat(20),assert(){}}));
   await assert.rejects(submissions.recoverPQOriginal('0x'+'00'.repeat(32),account,{account,assert(){}}));
   const result=await submissions.recoverPQOriginal(record.hash,account,{account,assert(){}});assert.equal(result.submitted,false);assert.equal(result.confirmed,false);
   const cold=new FileTransactionIntentStore({filePath});assert.deepEqual(await cold.readPQOriginals(account,()=>{}),[record]);
   const before=await fs.readFile(filePath,'utf8');await cold.saveOriginal(account,record.hash,()=>{});assert.equal(await fs.readFile(filePath,'utf8'),before);
   await assert.rejects(cold.reserveOriginal(account,'pq-revocation'));await assert.rejects(cold.reserveOriginal(account,'pq-transfer'));
  });
  await t.test('lost save acknowledgement reconciles original without another write',async t=>{
   const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-revocation-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
   let armed=false,writes=0;const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw Error('QA_ACK_LOST');}}};
   const filePath=path.join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath,io});
   await store.reserveOriginal(account,'pq-revocation');store.captureOriginal(account,record,'pq-revocation');armed=true;
   const submissions=new TransactionSubmissions({intentStore:store}),guard={account,assert(){}};
   await assert.rejects(submissions.recoverPQOriginal(record.hash,account,guard));assert.equal(writes,1);assert.equal(store.localOriginal(account).pq.hash,record.hash);
   await assert.rejects(submissions.recoverPQOriginal(record.hash,account,guard),{data:{code:'PQ_ORIGINAL_RECONCILE_REQUIRED'}});
   await submissions.recoverPQOriginal(record.hash,account,guard,{readOnly:true});assert.equal(writes,1);assert.equal(store.localOriginal(account),null);
   assert.deepEqual(await new FileTransactionIntentStore({filePath}).readPQOriginals(account,()=>{}),[record]);
  });
 }finally{if(batch)discardBatch(batch);destroyKey(key.privateKey);}
});
test('PQ recovery cannot clear a cold UNKNOWN reservation without an original',async t=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-revocation-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const account='0x'+'11'.repeat(20),filePath=path.join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath});
 await store.reserveOriginal(account,'pq-revocation');const before=await fs.readFile(filePath,'utf8'),cold=new FileTransactionIntentStore({filePath}),submissions=new TransactionSubmissions({intentStore:cold});
 for(const readOnly of [false,true])await assert.rejects(submissions.recoverPQOriginal('0x'+'01'.repeat(32),account,{account,assert(){}},{readOnly}));
 assert.equal(await fs.readFile(filePath,'utf8'),before);assert.equal((await cold.unresolvedPreparation(account)).kind,'pq-revocation');
});
test('revocation pending display distinguishes retained and persisted originals without wire or retry',()=>{
 const account='0x'+'11'.repeat(20);
 for(const status of ['pq-save-unconfirmed','pq-signed-unsubmitted']){
  const row={hash:'0x'+'01'.repeat(32),account,status,canRetryExact:false,kind:'pq-revocation',operationId:'QA-revoke-original'};
  assert.deepEqual(projectPendingTransactions({ok:true,value:[row]},account),[row]);
  assert.throws(()=>projectPendingTransactions({ok:true,value:[{...row,canRetryExact:true}]},account));
  assert.throws(()=>projectPendingTransactions({ok:true,value:[{...row,wire:'replayable'}]},account));
  assert.throws(()=>projectPendingTransactions({ok:true,value:[{...row,status:'confirmed'}]},account));
 }
});
