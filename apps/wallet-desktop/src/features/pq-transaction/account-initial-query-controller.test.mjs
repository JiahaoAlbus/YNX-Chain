import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fixture from '../../../test/fixtures/pq-account-initial-public.json' with {type:'json'};
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {parsePQBFTOriginalResponse} from '../../wallet-pq-bft-evidence.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQAccountInitialTransport,preparePQOriginalLookup} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQTransactionSubmission} from './submission.mjs';
import {projectPQTransactionProgress} from './progress-view.mjs';
const member=Buffer.from(fixture.wire,'base64url'),account=fixture.expected.owner,networkId=fixture.expected.chainId;
const record=()=>createPQOriginalRecord({account,kind:'pq-account-initial',operationId:'PUBLIC-birth-query',expected:fixture.expected,request:preparePQAccountInitialTransport(member,fixture.expected)});
function response(committed=false){
 const r=record(),H=fixture.expected.executionHeight;
 const view={status:committed?'committed':'unknown',committed,source:'comet-rpc',nativeTransactionHash:r.hash,executionHeight:committed?H:'0',amount:'0',fee:'0',nonce:committed?'1':'0',readbackUrl:'/transactions/pq/originals/'+r.hash};
 if(committed)Object.assign(view,{type:'account_initial',abciTransactionHash:r.abciTransactionHash,wire:member.toString('base64'),cometIndex:0,from:account,to:account,transaction:{hash:r.hash,type:'account_initial',from:account,to:account,amount:0,fee:0,nonce:1,blockNumber:Number(H),timestamp:'2026-10-25T00:00:00Z',memo:'ynx-pq-account-initial-v1:'+member.toString('hex')}});
 else view.error='original not found';
 let text=JSON.stringify(view);if(committed)text=text.replace('\"blockNumber\":'+String(Number(H)),'\"blockNumber\":'+H);
 return {status:committed?200:202,text};
}
async function setup(t,{marked=true,packet=response(),lateLock=false,readGate=null,readFailure=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-public-initial-query-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath}),original=record();
 await store.reserveOriginal(account,'pq-account-initial');store.capturePQAccountInitialMember(account,member,{expected:fixture.expected,operationId:original.operationId});await store.saveOriginal(account,original.hash,()=>{});if(marked)await store.beginPQSubmission(account,original.hash,()=>{});
 const calls=[],counts={permission:0,transferPOST:0,initialPOST:0};let current=true;
 const guard={account,assert(){if(!current)throw Error('CONTROLLED_LATE_LOCK')},assertEffectCurrent(){if(!current)throw Error('CONTROLLED_LATE_LOCK')},submit:fn=>fn()};
 const transport={async readOriginal(hash){calls.push(preparePQOriginalLookup(hash));if(readGate)await readGate();if(readFailure)throw false;if(lateLock)current=false;return packet;},async submitTransfer(){counts.transferPOST++;throw Error('NEVER_TRANSFER')},async submitAccountInitial(){counts.initialPOST++;throw Error('NEVER_BIRTH_POST')}};
 const create=(s=store,selectedNetwork=networkId)=>createPQTransactionSubmission({intentStore:s,networkId:selectedNetwork,transport,acquireOriginalWalletTransactionPermission:async()=>{counts.permission++;throw Error('NEVER_PERMISSION')},isOriginalWalletTransactionPermission:()=>true});
 return{store,filePath,original,guard,create,calls,counts,cold:()=>new FileTransactionIntentStore({filePath})};
}
test('birth cold UNKNOWN controller queries the native original only and keeps the original signing H',async t=>{
 const f=await setup(t),out=await f.create(f.cold()).reconcile(f.original.hash,f.guard);
 assert.equal(out.kind,'pq-account-initial');assert.equal(out.status,'submission-unknown');assert.equal(out.canRetry,false);assert.equal(out.consensusFinality,false);
 assert.deepEqual(f.calls,[{method:'GET',path:'/transactions/pq/originals/'+f.original.hash}]);assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});
 assert.deepEqual(await f.cold().readPQOriginals(account,()=>{}),[f.original]);assert.equal((await f.cold().readPQOriginals(account,()=>{}))[0].initialBinding.executionHeight,fixture.expected.executionHeight);
 const progress=await f.cold().readPQProgress(account,f.original.hash,()=>{});assert.equal(progress.status,'submission-unknown');assert.equal(progress.storageConfirmed,true);assert.equal(progress.retryAuthorized,false);
});

test('birth committed observation survives late lock and preserves wide execution H after cold reopen',async t=>{
 const f=await setup(t,{packet:response(true),lateLock:true});await assert.rejects(f.create().reconcile(f.original.hash,f.guard),/CONTROLLED_LATE_LOCK/);
 const cold=f.cold(),progress=await cold.readPQProgress(account,f.original.hash,()=>{});assert.equal(progress.status,'inclusion-observed');assert.equal(progress.consensusFinality,false);assert.deepEqual(await cold.readPQOriginals(account,()=>{}),[f.original]);
 const saved=JSON.parse(await fs.readFile(f.filePath,'utf8')).pqProgress[0];assert.equal(JSON.parse(saved.result.text).executionHeight,fixture.expected.executionHeight);assert.equal(saved.nativeTransactionHash,f.original.hash);assert.equal(saved.abciTransactionHash,f.original.abciTransactionHash);assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});assert.equal(f.calls.length,1);
});
test('birth inclusion does not regress when a later native lookup is UNKNOWN',async t=>{
 const f=await setup(t,{packet:response(true)}),out=await f.create().reconcile(f.original.hash,f.guard);assert.equal(out.status,'inclusion-observed');
 const cold=f.cold(),controller=createPQTransactionSubmission({intentStore:cold,networkId,transport:{async readOriginal(hash){assert.equal(hash,f.original.hash);return response();}}});
 const later=await controller.reconcile(f.original.hash,f.guard);assert.equal(later.status,'inclusion-observed');assert.equal(later.canRetry,false);assert.equal(later.consensusFinality,false);assert.deepEqual(await f.cold().readPQOriginals(account,()=>{}),[f.original]);
});
test('birth response hash, zero fee, nonce and activation bounds refuse without state advance',async t=>{
 for(const mutate of [v=>v.nativeTransactionHash='0x'+'ab'.repeat(32),v=>v.abciTransactionHash=v.nativeTransactionHash,v=>v.fee='1',v=>v.nonce='2',v=>v.executionHeight=fixture.intent.activateAt,v=>v.transaction.from='0x'+'33'.repeat(20)]){
  const packet=response(true),view=JSON.parse(packet.text);mutate(view);packet.text=JSON.stringify(view);const f=await setup(t,{packet});await assert.rejects(f.create().reconcile(f.original.hash,f.guard),{code:'PQ_BFT_RESPONSE_INVALID'});
  const progress=await f.cold().readPQProgress(account,f.original.hash,()=>{});assert.equal(progress.status,'submission-unknown');assert.equal(progress.firstCause.code,'PQ_BFT_RESPONSE_INVALID');assert.equal(progress.retryAuthorized,false);assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});assert.deepEqual(await f.cold().readPQOriginals(account,()=>{}),[f.original]);
 }
});
test('birth unsubmitted query creates no marker and broadcast cannot enter the transfer permission branch',async t=>{
 const f=await setup(t,{marked:false});await assert.rejects(f.create().reconcile(f.original.hash,f.guard),{code:'PQ_TRANSACTION_NOT_ENTERED'});assert.equal(f.calls.length,0);assert.equal((JSON.parse(await fs.readFile(f.filePath,'utf8')).pqProgress??[]).length,0);
 await assert.rejects(f.create().broadcast(f.original.hash,f.guard),{code:'PQ_ACCOUNT_INITIAL_BROADCAST_PERMISSION_REQUIRED'});assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});assert.equal((await f.cold().readPQProgress(account,f.original.hash,()=>{})).status,'signed-unsubmitted');
});
test('birth readonly owner holds the original close barrier until complete response custody',async t=>{
 let release,entered;const gate=new Promise(r=>{release=r}),reading=new Promise(r=>{entered=r});const f=await setup(t,{readGate:async()=>{entered();await gate;}}),pending=f.create().reconcile(f.original.hash,f.guard);
 await reading;await assert.rejects(f.store.assertPQProgressSafeToClose(),error=>error.data?.code==='PQ_PROGRESS_CLOSE_UNCONFIRMED');release();const out=await pending;assert.equal(out.status,'submission-unknown');assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);assert.equal(f.calls.length,1);assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});
});
test('birth readonly falsy failure retains its first cause across cold reopen',async t=>{
 const f=await setup(t,{readFailure:true});await assert.rejects(f.create().reconcile(f.original.hash,f.guard),error=>error===false);
 const progress=await f.cold().readPQProgress(account,f.original.hash,()=>{});assert.equal(progress.status,'submission-unknown');assert.deepEqual(progress.firstCause,{kind:'boolean',value:false,code:null});assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});assert.equal(f.calls.length,1);
});
test('birth closed progress accepts only zero-value inclusion and never terminal finality',async()=>{
 const original=record(),packet=response(true),binding={account,hash:original.hash,kind:original.kind},observed=parsePQBFTOriginalResponse(original,packet.status,packet.text),view=projectPQTransactionProgress(observed,binding);
 assert.equal(view.status,'inclusion-observed');assert.equal(view.consensusFinality,false);assert.equal(view.canRetry,false);for(const key of ['wire','initialBinding','pkA','pkB','effects','nativeGrant'])assert.equal(key in view,false);
 for(const decimals of [{amount:'1',fee:'0',nonce:'1'},{amount:'0',fee:'1',nonce:'1'},{amount:'0',fee:'0',nonce:'2'}])assert.throws(()=>projectPQTransactionProgress({...observed,decimalFields:decimals},binding),{code:'PQ_TRANSACTION_PROGRESS_INVALID'});
 for(const status of ['finality-save-unknown','finalized-succeeded','finalized-rejected'])assert.throws(()=>projectPQTransactionProgress({account,hash:original.hash,kind:original.kind,status,storageConfirmed:true,metadataConfirmed:true,localResultHeld:false,firstCause:null,storageCause:null,retryAuthorized:false,clearsOriginal:false,consensusFinality:status.startsWith('finalized')},binding),{code:'PQ_TRANSACTION_PROGRESS_INVALID'});
});
test('birth controller refuses a different selected network before original GET',async t=>{
 const f=await setup(t);await assert.rejects(f.create(f.store,'ab'.repeat(32)).reconcile(f.original.hash,f.guard),{code:'PQ_TRANSACTION_ORIGINAL_BINDING'});assert.equal(f.calls.length,0);assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});
});

test('birth duplicate comparison preserves wide JSON integer tokens and still rejects conflicting observations',async t=>{
 const packet=response(true),f=await setup(t,{packet});await f.create().reconcile(f.original.hash,f.guard);
 const reordered=Object.fromEntries(Object.entries(JSON.parse(packet.text)).reverse());let cosmetic=JSON.stringify(reordered,null,2);cosmetic=cosmetic.replace('"blockNumber": '+String(Number(fixture.expected.executionHeight)),'"blockNumber": '+fixture.expected.executionHeight);
 const read=next=>createPQTransactionSubmission({intentStore:f.cold(),networkId,transport:{async readOriginal(hash){assert.equal(hash,f.original.hash);return {status:200,text:next};}}}).reconcile(f.original.hash,f.guard);
 assert.equal((await read(cosmetic)).status,'inclusion-observed');assert.equal(JSON.parse(await fs.readFile(f.filePath,'utf8')).pqProgress[0].result.text,packet.text);
 const changed=packet.text.replace('"blockNumber":'+fixture.expected.executionHeight,'"blockNumber":'+String(Number(fixture.expected.executionHeight)));
 assert.notEqual(changed,packet.text);await assert.rejects(read(changed),{code:'PQ_PROGRESS_OBSERVATION_CONFLICT'});const progress=await f.cold().readPQProgress(account,f.original.hash,()=>{});assert.equal(progress.status,'inclusion-observed');assert.equal(progress.firstCause.code,'PQ_PROGRESS_OBSERVATION_CONFLICT');assert.equal(progress.consensusFinality,false);
 assert.deepEqual(await f.cold().readPQOriginals(account,()=>{}),[f.original]);assert.deepEqual(f.counts,{permission:0,transferPOST:0,initialPOST:0});
});
