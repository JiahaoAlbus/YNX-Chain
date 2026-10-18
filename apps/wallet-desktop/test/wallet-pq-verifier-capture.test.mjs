import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {decodePQTransferRequest,preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {PQFinalityEvidence} from '../src/wallet-pq-finality-evidence.mjs';
import {createPQFinalityVerifierCapture} from '../src/wallet-pq-verifier-capture.mjs';
import {readPQFinalityVerifierEvidence} from '../src/wallet-pq-verifier-restore.mjs';
import {createPQFinalityCollection} from '../src/wallet-pq-finality-collection.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {preparePQTransferFinalityInvocation} from '../src/features/pq-transaction/finality-invocation.mjs';
import {fixture as hostFixture} from './helpers/pq-host-export.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixtureBytes=readFileSync(new URL('../src/features/pq-transaction/fixtures/finality-c3-public.json.gz',import.meta.url));
assert.equal(sha(fixtureBytes),'ef1562c14a3528e29928dd1889e5fa94416e1223e405fac2a7648829c0b43095');
const row=JSON.parse(gunzipSync(fixtureBytes)).cases.find(x=>x.name==='succeeded-transfer'),wire=Buffer.from(row.expectedTransaction.nativeWire,'base64'),transfer=decodePQTransferRequest(wire).transfer;
const binding={account:transfer.from,networkId:transfer.chainId};
const original=createPQOriginalRecord({account:binding.account,kind:'pq-transfer',operationId:'PUBLIC-capture',request:preparePQTransferTransport(wire)});
const stdout=Buffer.from(JSON.stringify(row.expectedResponse)+'\n');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(tmpdir(),'wallet-pq-capture-')),directory=path.join(root,'evidence');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let creates=0,failAt=0,locked=false,calls=0,partial=false,closed=true,invocation=null,hook=async()=>{};
 const io={...fs,open:async(...args)=>{if(typeof args[1]==='number'&&(args[1]&constants.O_CREAT)){creates++;if(creates===failAt)throw Error('PUBLIC storage failure');}return fs.open(...args);}};
 const evidence=new PQFinalityEvidence({directory,io});
 const guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC lock'),{code:'PUBLIC_LOCKED'});}};
 const verifier={async run(input){calls++;invocation=input;const before=await evidence.candidates(original,binding);assert.equal(before.candidates.length,2);for(const ref of before.candidates)await evidence.read(original,binding,ref);await hook(input);if(partial){closed=false;throw Error('PUBLIC bounded cleanup wait');}},
  snapshot(){return {result:{stdout:Buffer.from(stdout),stderr:Buffer.from([0,255]),exitCode:closed?0:null,signal:null},lifecycle:{started:calls>0,closeObserved:closed,cleanupPending:!closed,interruption:partial?'timeout':null,stdoutTruncated:false,stderrTruncated:false,firstCausePresent:partial,cleanupCausePresent:false,stdinSha256:invocation?sha(Buffer.from(invocation.stdin)):null,stdinByteLength:invocation?Buffer.byteLength(invocation.stdin):0},firstCause:partial?Error('PUBLIC timeout'):undefined};},
  assertSafeToClose(){if(!closed)throw Object.assign(Error('PUBLIC process remains'),{code:'PQ_FINALITY_VERIFIER_CLEANUP_PENDING'});},retire(){},join:async()=>{closed=true;}};
 // Structurally valid PUBLIC context, not real Host provenance or source files.
 const capture=createPQFinalityVerifierCapture({evidence,verifier}),context=Buffer.from(JSON.stringify(hostFixture().context));
 const input={contextPath:path.join(directory,'not-opened-by-this-test'),contextSha256:sha(context),contextBytes:context,expected:row.expectedTransaction,proof:row.request.proof};
 return {root,directory,evidence,capture,input,guard,verifier,calls:()=>calls,failAt:v=>{failAt=v;},lock:v=>{locked=v;},partial:v=>{partial=v;},hook:fn=>{hook=fn;},refs:()=>evidence.candidates(original,binding)};
}
test('original inputs are durable before dispatch; exact stdout/stderr and completion manifest precede DATA parsing',async t=>{
 const f=await fixture(t),result=await f.capture.run(original,binding,f.input,f.guard);assert.equal(f.calls(),1);assert.equal(result.observation.reportedOutcome,'succeeded');assert.equal(result.canRetry,false);assert.equal(result.independentFinality,false);assert.equal(result.records.length,5);
 const refs=(await f.refs()).candidates;assert.equal(refs.length,5);
 const out=refs.find(r=>r.kind==='verifier-stdout');assert.deepEqual(await f.evidence.read(original,binding,out),stdout);
 const manifest=JSON.parse(await f.evidence.read(original,binding,refs.find(r=>r.kind==='verifier-result')));assert.equal(manifest.references.length,4);assert.equal(manifest.contextSha256,f.input.contextSha256);assert.equal(manifest.exitCode,0);f.capture.assertSafeToClose();
 await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PQ_FINALITY_CAPTURE_ALREADY_ENTERED'});
});
test('failed input save keeps zero dispatch and close debt; explicit save resumes once from held original bytes',async t=>{
 const f=await fixture(t);f.failAt(1);await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});assert.equal(f.calls(),0);assert.throws(()=>f.capture.assertSafeToClose());
 f.input.contextBytes.fill(0);f.failAt(0);const result=await f.capture.save(f.guard);assert.equal(result.observation.reportedOutcome,'succeeded');assert.equal(f.calls(),1);f.capture.assertSafeToClose();
});
test('output save failure retains one original process; explicit save persists held result without redispatch',async t=>{
 const f=await fixture(t);f.failAt(3);await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});assert.equal(f.calls(),1);assert.throws(()=>f.capture.assertSafeToClose());f.failAt(0);
 const result=await f.capture.save(f.guard);assert.equal(result.observation.reportedOutcome,'succeeded');assert.equal(f.calls(),1);assert.equal((await f.refs()).candidates.length,5);f.capture.assertSafeToClose();
});
test('lock after process returns cannot drop either stream or manifest and cannot authorize a rerun',async t=>{
 const f=await fixture(t);f.hook(async()=>{f.lock(true);});await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PUBLIC_LOCKED'});assert.equal(f.calls(),1);assert.equal((await f.refs()).candidates.length,5);f.capture.assertSafeToClose();f.lock(false);await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PQ_FINALITY_CAPTURE_ALREADY_ENTERED'});
 const cold=new PQFinalityEvidence({directory:f.directory});const refs=await cold.candidates(original,binding);for(const ref of refs.candidates)await cold.read(original,binding,ref);assert.equal(refs.candidates.length,5);
});
test('lock while inputs are saving prevents initial dispatch and later save still uses the same one-use plan',async t=>{
 const f=await fixture(t),append=f.evidence.append.bind(f.evidence);let n=0;f.evidence.append=async(...args)=>{const result=await append(...args);if(++n===2)f.lock(true);return result;};
 await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PUBLIC_LOCKED'});assert.equal(f.calls(),0);f.lock(false);await f.capture.save(f.guard);assert.equal(f.calls(),1);
});
test('bounded cleanup return saves partial evidence and keeps close debt; late actual close captures another generation but never reruns',async t=>{
 const f=await fixture(t);f.partial(true);await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE'});assert.equal((await f.refs()).candidates.length,5);assert.throws(()=>f.capture.assertSafeToClose());
 await assert.rejects(f.capture.save(f.guard),{code:'PQ_FINALITY_VERIFIER_CLEANUP_PENDING'});await f.capture.join();await assert.rejects(f.capture.save(f.guard),{code:'PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE'});assert.equal(f.calls(),1);assert.equal((await f.refs()).candidates.length,8);f.capture.assertSafeToClose();
});
test('cold manifest retains bounded first error DATA separately from cleanup',async t=>{
 const f=await fixture(t);f.partial(true);await assert.rejects(f.capture.run(original,binding,f.input,f.guard));
 const ref=(await f.refs()).candidates.find(r=>r.kind==='verifier-result'),manifest=JSON.parse(await f.evidence.read(original,binding,ref));
 assert.equal(manifest.firstCause.present,true);assert.equal(manifest.firstCause.type,'error');assert.equal(Buffer.from(manifest.firstCause.fields.message.text,'base64').toString(),'PUBLIC timeout');assert.equal(manifest.cleanupCause.present,false);
 await f.capture.join();await assert.rejects(f.capture.save(f.guard));f.capture.assertSafeToClose();
});
test('falsy process causes remain present and an error message getter is never evaluated for private recording',async t=>{
 const f=await fixture(t),snapshot=f.verifier.snapshot;let getters=0;const cause=Error('not read');Object.defineProperty(cause,'message',{get(){getters++;throw Error('foreign getter');}});
 f.verifier.snapshot=()=>{const p=snapshot();return {...p,lifecycle:{...p.lifecycle,firstCausePresent:true,cleanupCausePresent:true},firstCause:false,cleanupCause:cause};};
 await assert.rejects(f.capture.run(original,binding,f.input,f.guard),{code:'PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE'});
 const ref=(await f.refs()).candidates.find(r=>r.kind==='verifier-result'),manifest=JSON.parse(await f.evidence.read(original,binding,ref));
 assert.deepEqual(manifest.firstCause,{present:true,type:'boolean',value:false});assert.equal(manifest.cleanupCause.present,true);assert.equal(Object.hasOwn(manifest.cleanupCause.fields,'message'),false);assert.equal(getters,0);f.capture.assertSafeToClose();
});
test('cold normal collection restores only bounded result DATA from the same original journal, without any process/query/write',async t=>{
 const f=await fixture(t),filePath=path.join(f.root,'originals.json'),store=new FileTransactionIntentStore({filePath});
 await store.reserveOriginal(binding.account,'pq-transfer');store.captureOriginal(binding.account,original,'pq-transfer');await store.saveOriginal(binding.account,original.hash,()=>{});const before=await fs.readFile(filePath);
 await f.capture.run(original,binding,f.input,f.guard);
 const cold=new PQFinalityEvidence({directory:f.directory}),service=createPQFinalityCollection({intentStore:new FileTransactionIntentStore({filePath}),networkId:binding.networkId,evidence:cold,transport:{readFinalityProof(){throw Error('no GET during restore');}}});
 const result=await service.restore(original.hash,f.guard);assert.equal(result.records.length,1);const row=result.records[0];assert.equal(row.status,'verifier-result-data');assert.equal(row.consensusFinality,false);assert.equal(row.canRetry,false);assert.equal(f.calls(),1);assert.equal(result.unreadable,0);assert.doesNotMatch(JSON.stringify(result),/contextPath|contextBytes|resourceIdentity|PUBLIC timeout|not Host authority/);assert.deepEqual(await fs.readFile(filePath),before);
 const ref=(await cold.candidates(original,binding)).candidates.find(r=>r.kind==='verifier-result');await assert.rejects(readPQFinalityVerifierEvidence({...original,operationId:'foreign'},binding,cold,ref));
});
test('first capture refuses context index1 with stdin index0 before evidence creation or any process dispatch',async t=>{
 const f=await fixture(t),context=hostFixture().context;context.expectedTransaction.index='1';const bytes=Buffer.from(JSON.stringify(context));
 await assert.rejects(f.capture.run(original,binding,{...f.input,contextBytes:bytes,contextSha256:sha(bytes)},f.guard),{code:'PQ_FINALITY_SAVED_INVOCATION_MISMATCH'});assert.equal(f.calls(),0);await assert.rejects(fs.stat(f.directory),{code:'ENOENT'});f.capture.assertSafeToClose();
});
test('actual cold restore rejects the original context1/stdin0/result0 RED while retaining every evidence byte and journal',async t=>{
 const f=await fixture(t),filePath=path.join(f.root,'originals.json'),store=new FileTransactionIntentStore({filePath});await store.reserveOriginal(binding.account,'pq-transfer');store.captureOriginal(binding.account,original,'pq-transfer');await store.saveOriginal(binding.account,original.hash,()=>{});const journal=await fs.readFile(filePath);
 const wrong=hostFixture().context;wrong.expectedTransaction.index='1';const contextBytes=Buffer.from(JSON.stringify(wrong)),invocation=preparePQTransferFinalityInvocation(original,binding,row.expectedTransaction,row.request.proof),stdin=Buffer.from(invocation.stdin),refs=[];
 for(const [kind,body]of [['host-context',contextBytes],['verifier-stdin',stdin],['verifier-stdout',stdout],['verifier-stderr',Buffer.alloc(0)]])refs.push(await f.evidence.append(original,binding,kind,body));
 const lifecycle={started:true,closeObserved:true,cleanupPending:false,interruption:null,stdoutTruncated:false,stderrTruncated:false,firstCausePresent:false,cleanupCausePresent:false,stdinSha256:sha(stdin),stdinByteLength:stdin.length};
 const manifest={version:1,type:'verifier-capture',operationId:original.operationId,hash:original.hash,contextSha256:sha(contextBytes),stdinSha256:sha(stdin),resourceIdentity:null,references:refs,exitCode:0,signal:null,lifecycle,firstCause:{present:false},cleanupCause:{present:false}};
 const ref=await f.evidence.append(original,binding,'verifier-result',Buffer.from(JSON.stringify(manifest))),names=(await fs.readdir(f.directory)).sort();
 assert.equal(names.length,5);const originalFiles=new Map(await Promise.all(names.map(async name=>[name,await fs.readFile(path.join(f.directory,name))])));
 const unchanged=async()=>{assert.deepEqual((await fs.readdir(f.directory)).sort(),names);for(const [name,body]of originalFiles)assert.deepEqual(await fs.readFile(path.join(f.directory,name)),body,name);assert.deepEqual(await fs.readFile(filePath),journal);assert.equal(f.calls(),0);};
 await assert.rejects(readPQFinalityVerifierEvidence(original,binding,f.evidence,ref),{code:'PQ_FINALITY_SAVED_INVOCATION_MISMATCH'});await unchanged();
 let queries=0;const cold=createPQFinalityCollection({intentStore:new FileTransactionIntentStore({filePath}),networkId:binding.networkId,evidence:new PQFinalityEvidence({directory:f.directory}),transport:{readFinalityProof(){queries++;throw Error('must not query');}}}),result=await cold.restore(original.hash,f.guard);
 assert.equal(result.records.length,1);assert.equal(result.records[0].status,'evidence-unverified');assert.equal(result.records[0].rawStored,true);
 for(const field of ['canRetry','clearsOriginal','consensusFinality','independentFinality']){assert.equal(result.records[0][field],false,field);assert.equal(result[field],false,field);}
 assert.equal(queries,0);await unchanged();
});
