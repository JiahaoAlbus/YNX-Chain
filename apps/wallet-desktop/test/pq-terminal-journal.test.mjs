import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {original,binding,row} from './helpers/pq-host-export.mjs';
import {parsePQTransferFinalityVerifierResult} from '../src/features/pq-transaction/finality-verifier-result.mjs';
import {createPQFinalityRecord,pqFinalityRecordGeneration} from '../src/wallet-pq-finality-record.mjs';
import {parsePQFinalityTerminalData} from '../src/wallet-pq-finality-terminal.mjs';
import {createPQVerifiedFinalityTerminal} from '../src/wallet-pq-finality-terminal.mjs';
import {readCompletedPackagedPQCaller,createPackagedPQFinalityVerifier} from '../src/wallet-pq-verifier-assets.mjs';
import {createPQFinalityHistoryProtection} from '../src/wallet-pq-finality-history-protection.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {initialPQProgress} from '../src/wallet-pq-progress.mjs';
import {projectPQTransactionProgress} from '../src/features/pq-transaction/progress-view.mjs';
import {createPQTransactionSubmission} from '../src/features/pq-transaction/submission.mjs';
import {createPQFinalityCollection} from '../src/wallet-pq-finality-collection.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),copy=x=>structuredClone(x);
// Controlled store-adoption seam ONLY. Real production token recognition is
// separately tested below and remains unmodified. This same-realm evaluation
// replaces ONLY token unwrapping, never journal/fs/crypto/record validation.
async function controlledStoreClass(readToken){
 const url=new URL('../src/transaction-intent-store.mjs',import.meta.url),raw=await fs.readFile(url,'utf8'),bindings={};
 for(const match of raw.matchAll(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];$/gm)){
  const spec=match[2],module=await import(spec.startsWith('.')?new URL(spec,url).href:spec),clause=match[1].trim();
  if(clause.startsWith('* as '))bindings[clause.slice(5)]=module;
  else if(clause.startsWith('{'))for(const field of clause.slice(1,-1).split(',')){const [name,alias]=field.trim().split(/\s+as\s+/);bindings[alias??name]=module[name];}
  else bindings[clause]=module.default;
 }
 bindings.readPQVerifiedFinalityTerminal=readToken;
 return Function(...Object.keys(bindings),raw.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nreturn FileTransactionIntentStore;')(...Object.values(bindings));
}
function publicProtection(){
 const key=randomBytes(32);return createPQFinalityHistoryProtection({isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'PUBLIC_TEST_ONLY',encryptString:text=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce),body=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body]);},decryptString:bytes=>{const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');}});
}
function publicRecord(outcome){
 const response=copy(row.expectedResponse);if(outcome==='rejected'){response.code='VERIFIED_TRANSACTION_REJECTED_DATA';Object.assign(response.result,{outcome:'rejected',executionSuccessful:false,executionCode:'7',executionData:null});}
 const stdout=Buffer.from(JSON.stringify(response)),stderr=Buffer.alloc(0),parsed=parsePQTransferFinalityVerifierResult(original,binding,row.expectedTransaction,{stdout,stderr,exitCode:0,signal:null}),ref=(kind,b)=>({eventId:randomUUID(),attemptId:randomUUID(),kind,bytes:b.length,sha256:sha(b)});
 return createPQFinalityRecord(original,binding,row.expectedTransaction,{...parsed,records:[ref('host-context',Buffer.from('PUBLIC context')),ref('verifier-stdin',Buffer.from('PUBLIC stdin')),ref('verifier-stdout',stdout),ref('verifier-stderr',stderr),ref('verifier-result',Buffer.from('PUBLIC manifest'))]});
}
async function fixture(t,{outcome='succeeded',io=fs,protection=publicProtection()}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-terminal-public-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const filePath=path.join(root,'journal.json'),record=publicRecord(outcome),receipt=(await import('../src/wallet-pq-runtime-component.mjs')).originalPQVerifierReceipt;
 const finality=parsePQFinalityTerminalData({version:1,record,generation:pqFinalityRecordGeneration(record),host:{sourceId:'PUBLIC-no-real-Host',epoch:'1',sourceFingerprint:'a'.repeat(64),sourceSha256:'b'.repeat(64),lifecycleSha256:'c'.repeat(64),contextSha256:record.references.context.sha256},verifier:receipt,status:outcome==='succeeded'?'finalized-succeeded':'finalized-rejected',nativeGrant:false},original);
 const token=Object.freeze({PUBLIC:'controlled token seam, no authority'});let reads=0;
 const Store=await controlledStoreClass((given,selected)=>{reads++;assert.equal(given,token);assert.deepEqual(selected,original);return copy(finality);});
 const state={schemaVersion:10,records:[],rejections:[],resolutions:[],signedPayments:[],payProgress:[],payHistory:[],preparations:[],pqOriginals:[original],sessionOriginals:[],sessionPublications:[],pqProgress:[initialPQProgress(original)],pqFinalityObservations:[record]};
 await fs.writeFile(filePath,JSON.stringify(state),{mode:0o600});const store=new Store({filePath,io,finalityProtection:protection});
 return {root,filePath,record,finality,token,Store,store,protection,reads:()=>reads,adopt:()=>store.adoptPQFinalityTerminal(original,token,()=>{})};
}
test('controlled private adoption atomically archives succeeded and on-chain rejected originals; cold progress is terminal without Native authority',async t=>{
 for(const outcome of ['succeeded','rejected']){
  const f=await fixture(t,{outcome}),done=await f.adopt();assert.equal(done.consensusFinality,true);assert.equal(done.nativeGrant,false);assert.equal(done.outboxRetired,true);
  const state=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.equal(state.schemaVersion,11);assert.equal(state.pqOriginals.length,0);assert.equal(state.pqProgress.length,0);assert.deepEqual(state.pqHistory[0].original,original);assert.deepEqual(state.pqFinalityObservations,[f.record]);assert.equal(state.pqHistory[0].progress.status,'submission-unknown');
  const cold=new f.Store({filePath:f.filePath,finalityProtection:f.protection}),progress=await cold.readPQProgress(binding.account,original.hash,()=>{}),view=projectPQTransactionProgress(progress,{account:original.account,hash:original.hash,kind:original.kind});
  assert.equal(view.status,'finalized-'+outcome);assert.equal(view.consensusFinality,true);assert.equal(view.nativeGrant,false);assert.equal(view.canRetry,false);assert.equal(view.clearsOriginal,false);assert.deepEqual(await cold.readPQOriginals(binding.account,()=>{}),[original]);assert.equal((await cold.pqSummaries(binding.account))[0].status,'pq-finalized-'+outcome);await cold.assertNoPreparation(binding.account);await cold.reserveOriginal(binding.account,'pq-transfer');
 }
});
test('production journal rejects public DTOs, copied receipts and authority booleans before any terminal mutation',async t=>{
 const f=await fixture(t),actual=new FileTransactionIntentStore({filePath:f.filePath,finalityProtection:f.protection}),before=await fs.readFile(f.filePath);
 for(const token of [f.token,copy(f.finality),{...f.finality,consensusFinality:true,nativeGrant:true}])assert.throws(()=>actual.adoptPQFinalityTerminal(original,token,()=>{}),{code:'PQ_FINALITY_TERMINAL_UNVERIFIED'});
 assert.deepEqual(await fs.readFile(f.filePath),before);
});
test('complete JSON tampering or unavailable OS protection cannot qualify cold terminal history',async t=>{
 const f=await fixture(t);await f.adopt();const bytes=await fs.readFile(f.filePath),state=JSON.parse(bytes);
 state.pqHistory[0].progress.firstCause={kind:'boolean',value:false,code:null};await fs.writeFile(f.filePath,JSON.stringify(state));
 const cold=new f.Store({filePath:f.filePath,finalityProtection:f.protection});await assert.rejects(cold.readPQProgress(binding.account,original.hash,()=>{}));await assert.rejects(cold.assertNoPreparation(binding.account));assert.deepEqual(JSON.parse(await fs.readFile(f.filePath)),state);
 await fs.writeFile(f.filePath,bytes);await assert.rejects(new f.Store({filePath:f.filePath}).readPQProgress(binding.account,original.hash,()=>{}));assert.equal((await cold.readPQProgress(binding.account,original.hash,()=>{})).consensusFinality,true);
});
test('rename failure retains UNKNOWN, original and evidence; local continuation uses the same token without a verifier or broadcast',async t=>{
 let fault=true,renames=0;const io={...fs,async rename(...args){renames++;if(fault)throw false;return fs.rename(...args);}},f=await fixture(t,{io});
 await assert.rejects(f.adopt(),e=>e.data?.code==='TRANSACTION_JOURNAL_WRITE_FAILED'&&e.cause===false);const state=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.deepEqual(state.pqOriginals,[original]);assert.equal(state.pqHistory,undefined);assert.deepEqual(state.pqFinalityObservations,[f.record]);
 assert.equal((await f.store.readPQProgress(binding.account,original.hash,()=>{})).status,'finality-save-unknown');await assert.rejects(f.store.reserveOriginal(binding.account,'pq-transfer'));await assert.rejects(f.store.assertPQProgressSafeToClose());
 fault=false;assert.equal((await f.adopt()).stored,true);assert.equal(renames,2);assert.equal(f.reads(),2);assert.deepEqual(JSON.parse(await fs.readFile(f.filePath,'utf8')).pqHistory[0].storageCause,{kind:'boolean',value:false,code:null});await f.store.assertPQProgressSafeToClose();
});
test('UNKNOWN after actual atomic replacement recovers the same fact and retains its first sealed receipt plus storage error, without another proof',async t=>{
 let fault=true,renames=0;const io={...fs,async rename(...args){renames++;await fs.rename(...args);if(fault){fault=false;throw false;}}},f=await fixture(t,{io});
 await assert.rejects(f.adopt());assert.equal((await f.store.readPQProgress(binding.account,original.hash,()=>{})).consensusFinality,false);
 const cold=new f.Store({filePath:f.filePath,finalityProtection:f.protection});assert.equal((await cold.readPQProgress(binding.account,original.hash,()=>{})).status,'finalized-succeeded');
 const initialSeal=JSON.parse(await fs.readFile(f.filePath,'utf8')).pqHistory[0].seal;assert.equal((await f.adopt()).stored,true);assert.equal(renames,2);const history=JSON.parse(await fs.readFile(f.filePath,'utf8')).pqHistory[0];assert.equal(history.previousSeal,initialSeal);assert.deepEqual(history.storageCause,{kind:'boolean',value:false,code:null});await f.store.assertPQProgressSafeToClose();
});
test('weak/basic_text storage refuses before terminal write and preserves the original',async t=>{
 const protection=createPQFinalityHistoryProtection({isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text'}),f=await fixture(t,{protection}),before=await fs.readFile(f.filePath);
 await assert.rejects(f.adopt(),{code:'PQ_FINALITY_HISTORY_PROTECTION_UNAVAILABLE'});assert.deepEqual(await fs.readFile(f.filePath),before);assert.equal((await f.store.readPQProgress(binding.account,original.hash,()=>{})).consensusFinality,false);
});
test('copied source identity, successful-looking lifecycle and an unstarted original factory cannot mint a production token',async()=>{
 const receipt=(await import('../src/wallet-pq-runtime-component.mjs')).originalPQVerifierReceipt;
 const fake={identity:()=>receipt,snapshot:()=>({lifecycle:{started:true,closeObserved:true,cleanupPending:false},result:{exitCode:0,signal:null}})};
 assert.throws(()=>readCompletedPackagedPQCaller(fake,'proof'),{code:'PQ_FINALITY_ORIGINAL_CALLER_REQUIRED'});
 await assert.rejects(createPQVerifiedFinalityTerminal({original,binding,result:{},host:{},selection:{},verifier:fake,evidence:{},guard:{account:original.account,assert(){}}}),{code:'PQ_FINALITY_ORIGINAL_CALLER_REQUIRED'});
 const unstarted=createPackagedPQFinalityVerifier({app:{isPackaged:false},independentReceipt:receipt});assert.throws(()=>readCompletedPackagedPQCaller(unstarted,'proof'),{code:'PQ_FINALITY_ORIGINAL_CALLER_INCOMPLETE'});unstarted.retire();await unstarted.join();unstarted.assertSafeToClose();
});
test('partial temporary write cannot retire the old outbox; exact local save and duplicate callback do not replace history',async t=>{
 let fault=true,writes=0;const io={...fs,async open(file,...args){const handle=await fs.open(file,...args);if(file.endsWith('.tmp')&&typeof args[0]==='number')return new Proxy(handle,{get(target,key){if(key==='writeFile')return async value=>{writes++;if(fault){await target.writeFile(value.slice(0,24));throw false;}return target.writeFile(value);};const member=Reflect.get(target,key,target);return typeof member==='function'?member.bind(target):member;}});return handle;}},f=await fixture(t,{io});
 await assert.rejects(f.adopt());let state=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.deepEqual(state.pqOriginals,[original]);assert.equal(state.pqHistory,undefined);await assert.rejects(f.store.beginPQSubmission(binding.account,original.hash,()=>{}));
 fault=false;await f.adopt();const before=await fs.readFile(f.filePath);await f.adopt();assert.deepEqual(await fs.readFile(f.filePath),before);state=JSON.parse(before);assert.equal(state.pqHistory.length,1);assert.equal(writes,2);
});
test('different execution occurrences cannot use a later rejection to replace a retained success or silently retire its original',async t=>{
 const f=await fixture(t),state=JSON.parse(await fs.readFile(f.filePath,'utf8')),other=copy(f.record);other.target.index='1';Object.assign(other.observation,{cometIndex:1,reportedOutcome:'rejected',reportedExecutionSuccessful:false,executionCode:'7',verifierCode:'VERIFIED_TRANSACTION_REJECTED_DATA'});state.pqFinalityObservations.push(other);await fs.writeFile(f.filePath,JSON.stringify(state));
 await assert.rejects(f.adopt(),e=>e.data?.code==='PQ_FINALITY_TARGET_CONFLICT');assert.deepEqual(JSON.parse(await fs.readFile(f.filePath)),state);assert.equal((await f.store.readPQProgress(binding.account,original.hash,()=>{})).consensusFinality,false);
});
test('observation save recovery preserves its first storage failure without invalidating the already accepted fact token',async t=>{
 const f=await fixture(t),state=JSON.parse(await fs.readFile(f.filePath,'utf8'));state.pqFinalityObservations[0].storageCause={kind:'boolean',value:false,code:null};await fs.writeFile(f.filePath,JSON.stringify(state));
 const generation=f.finality.generation;await f.adopt();const history=JSON.parse(await fs.readFile(f.filePath,'utf8')).pqHistory[0];assert.equal(history.finality.generation,generation);assert.deepEqual(history.finality.record.storageCause,{kind:'boolean',value:false,code:null});assert.equal((await f.store.readPQProgress(binding.account,original.hash,()=>{})).consensusFinality,true);await f.adopt();
});
test('cold terminal cache projects through normal reconcile and finality entries offline without another transport, Host or proof',async t=>{
 const f=await fixture(t);await f.adopt();const cold=new f.Store({filePath:f.filePath,finalityProtection:f.protection}),guard={account:binding.account,assert(){}};
 const submission=createPQTransactionSubmission({intentStore:cold,networkId:binding.networkId});const progress=await submission.reconcile(original.hash,guard);assert.equal(progress.consensusFinality,true);assert.equal(progress.nativeGrant,false);
 const collection=createPQFinalityCollection({intentStore:cold,networkId:binding.networkId,evidence:{},transport:null,verification:null}),cached=await collection.verify(original.hash,guard);assert.equal(cached.status,'finalized-succeeded');assert.equal(cached.consensusFinality,true);assert.equal(cached.originalRetained,true);assert.equal(cached.nativeGrant,false);
 await assert.rejects(collection.verify(original.hash,{account:'0x'+'f'.repeat(40),assert(){}}));
});
test('in-flight readonly response capture fences archival; its late diagnostic is retained before local terminal continuation',async t=>{
 const f=await fixture(t);let release,entered;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
 const reading=f.store.withPQReadObservation(binding.account,original.hash,()=>{},async()=>{entered();await gate;await f.store.savePQSubmissionFailure(binding.account,original.hash,false);});await ready;
 await assert.rejects(f.adopt(),e=>e.data?.code==='PQ_FINALITY_SUBMISSION_RESULT_UNCONFIRMED');assert.equal(JSON.parse(await fs.readFile(f.filePath,'utf8')).pqOriginals.length,1);release();await reading;await f.adopt();
 const history=JSON.parse(await fs.readFile(f.filePath,'utf8')).pqHistory[0];assert.deepEqual(history.progress.firstCause,{kind:'boolean',value:false,code:null});assert.equal(history.storageCause.code,'PQ_FINALITY_SUBMISSION_RESULT_UNCONFIRMED');await f.store.assertPQProgressSafeToClose();
});
