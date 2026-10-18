import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {DesktopKeyLifecycle} from '../../key-lifecycle.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQTransactionSubmission} from './submission.mjs';

// Register only with the actual frozen Auth kernel supplied by its owner.
// The caller/borrow and transport are explicitly controlled test seams. This
// file does not brand a production permission or claim a real IPC approval.
export function registerPQAuthPermissionCompatibilityTests(TransactionPermissionKernel) {
 const vector=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
 const account=vector.owner,networkId=vector.networkId,row=vector.originals.find(r=>r.name==='transfer-lost-response');
 const original=createPQOriginalRecord({account,kind:'pq-transfer',operationId:'QA-r93-consumer',request:preparePQTransferTransport(Buffer.from(row.wire,'base64'))});
 const response=vector.http.find(r=>r.name==='transfer-original-reconciled');
 const returned={status:response.statusCode,text:Buffer.from(response.bodyWire,'base64').toString('utf8')};
 async function setup(t,options={}) {
  const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-r93-consumer-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const filePath=path.join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath});
  await store.reserveOriginal(account,'pq-transfer');store.captureOriginal(account,original,'pq-transfer');await store.saveOriginal(account,original.hash,()=>{});
  const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(account);await lifecycle.unlock();
  const seen=new WeakSet(),counts={acquire:0,posts:0,gets:0,entry:0,completion:0,completedCurrent:0,retire:0,join:0,close:0};let kernel,binding;
  const controller=createPQTransactionSubmission({intentStore:store,networkId,
   acquireOriginalWalletTransactionPermission:async request=>{
    counts.acquire++;const issuedAt=new Date(Date.now()-1000).toISOString(),expiresAt=new Date(Date.now()+20000).toISOString();let completed=false;
    const peer={
     readOriginal:()=>({request,issuedAt,expiresAt}),
     assertCurrent(){if(completed)throw Error('PREWRITE_CURRENT_REUSED_AFTER_COMPLETION');},
     recheck(){if(options.revoke)throw Object.assign(Error('controlled revoked'),{code:'QA_R93_REVOKED'});},
     enterOriginal(action){assert.equal(action,'broadcast');counts.entry++;},
     completeOriginal(result){completed=true;counts.completion++;assert.equal(result.transportHash,original.hash);},
     assertCompletedCurrent(result){counts.completedCurrent++;assert.equal(result.transportHash,original.hash);if(options.lateCurrent)throw false;},
     retire(){counts.retire++;},join(){counts.join++;if(options.cleanupDebt)throw Object.assign(Error('controlled cleanup debt'),{code:'QA_R93_JOIN'});},close(){counts.close++;},
    };
    kernel=new TransactionPermissionKernel(request,peer);await kernel.initialize();binding=kernel.readOriginal();assert.equal(kernel.readOriginal(),binding);seen.add(kernel);return kernel;
   },isOriginalWalletTransactionPermission:value=>seen.has(value),
   transport:{async submitTransfer(request,assertCurrent){assertCurrent();counts.posts++;assert.deepEqual(request.body,Buffer.from(original.wire,'base64url'));if(options.throwPost)throw false;return returned;},async readOriginal(hash){counts.gets++;assert.equal(hash,original.hash);return returned;}}});
  return {filePath,store,lifecycle,controller,counts,kernel:()=>kernel,binding:()=>binding};
 }
 test('R93 actual kernel binding remains identical through consumer entry and completed-current',async t=>{
  const f=await setup(t);const result=await f.lifecycle.run(g=>f.controller.broadcast(original.hash,g));
  assert.equal(result.status,'inclusion-observed');assert.equal(result.consensusFinality,false);assert.equal(f.kernel().outcome().binding,f.binding());
  assert.equal(f.counts.entry,1);assert.equal(f.counts.posts,1);assert.equal(f.counts.completion,1);assert.ok(f.counts.completedCurrent>0);
  assert.equal(f.counts.retire,1);assert.equal(f.counts.join,1);assert.equal(f.counts.close,1);assert.equal(f.kernel().outcome().phase,'closed');
 });
 test('R93 actual kernel late completed-current failure retains response and forbids replacement POST',async t=>{
  const f=await setup(t,{lateCurrent:true});await assert.rejects(f.lifecycle.run(g=>f.controller.broadcast(original.hash,g)),cause=>cause===false);
  const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.equal((await cold.readPQProgress(account,original.hash,()=>{})).status,'inclusion-observed');
  assert.deepEqual(f.kernel().outcome().result,{outcome:'returned',transportHash:original.hash});assert.equal(f.kernel().outcome().phase,'unknown');
  assert.equal(f.kernel().outcome().firstCause,false);assert.deepEqual((await cold.readPQProgress(account,original.hash,()=>{})).firstCause,{kind:'boolean',value:false,code:null});
  await assert.rejects(f.lifecycle.run(g=>f.controller.broadcast(original.hash,g)),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.counts.posts,1);assert.equal(f.counts.acquire,1);
 });
 test('R93 actual kernel cleanup failure before marker remains a consumer debt and prevents a new acquire',async t=>{
  const f=await setup(t,{revoke:true,cleanupDebt:true});await assert.rejects(f.lifecycle.run(g=>f.controller.broadcast(original.hash,g)),{code:'QA_R93_REVOKED'});
  assert.equal((await f.store.readPQProgress(account,original.hash,()=>{})).status,'signed-unsubmitted');assert.equal(f.counts.posts,0);assert.equal(f.counts.close,0);
  await assert.rejects(f.lifecycle.run(g=>f.controller.broadcast(original.hash,g)),{code:'PQ_TRANSACTION_CLEANUP_PENDING'});assert.equal(f.counts.acquire,1);assert.equal(f.kernel().outcome().phase,'unknown');
 });
 test('R93 effect UNKNOWN with completed cleanup allows GET recovery while still forbidding a second POST',async t=>{
  const f=await setup(t,{throwPost:true});await assert.rejects(f.lifecycle.run(g=>f.controller.broadcast(original.hash,g)),{code:'PQ_TRANSACTION_OUTCOME_UNKNOWN'});
  assert.equal(f.kernel().outcome().phase,'unknown');assert.deepEqual(f.kernel().outcome().result,{outcome:'unknown',transportHash:original.hash});assert.equal(f.counts.close,1);
  await assert.rejects(f.lifecycle.run(g=>f.controller.broadcast(original.hash,g)),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});
  const result=await f.lifecycle.run(g=>f.controller.reconcile(original.hash,g));assert.equal(result.status,'inclusion-observed');assert.equal(f.counts.posts,1);assert.equal(f.counts.gets,1);assert.equal(f.counts.acquire,1);
 });
}
