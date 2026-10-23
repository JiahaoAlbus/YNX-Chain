import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
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
import {PQFinalityEvidence} from './wallet-pq-finality-evidence.mjs';
import {createPQFinalityVerifierCapture} from './wallet-pq-verifier-capture.mjs';
import {readPQFinalityVerifierEvidence} from './wallet-pq-verifier-restore.mjs';
import {createPQFinalityCollection} from './wallet-pq-finality-collection.mjs';
import {createPQFinalityVerification} from './wallet-pq-finality-verification.mjs';
import {legacyPQVerifierReceipt591,originalPQVerifierReceipt} from './wallet-pq-verifier-receipt.mjs';
import {parsePQTransferHostContext} from './wallet-pq-host-context.mjs';
import {installOriginalProofHostDelivery,readInstalledOriginalProofHostDelivery} from './original-proof-host-delivery.mjs';
import {fixture as publicHostFixture} from '../test/helpers/pq-host-export.mjs';
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
test('typed finality raw evidence uses exact dual-hash identity and survives cold recovery without grant',async t=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-typed-proof-custody-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const evidence=new PQFinalityEvidence({directory}),binding={account:record.account,networkId:record.typed.networkId};
 const bytes=Buffer.from('synthetic unparsed collector response'),expected=Buffer.from(bytes);
 const http={method:'GET',requestPath:'/txs/'+record.hash+'/pq-action-finality-proof',contentType:'application/json; charset=utf-8',cacheControl:'no-store'},observed={...http};
 const saving=evidence.append(record,binding,'collector-http',bytes,{httpStatus:202,http});bytes.fill(0);http.cacheControl='mutated';const ref=await saving;
 assert.deepEqual(ref.http,observed);assert.equal(Object.isFrozen(ref.http),true);
 const cold=new PQFinalityEvidence({directory});assert.deepEqual(await cold.read(record,binding,ref),expected);
 assert.deepEqual(await cold.candidates(record,binding),{candidates:[ref],unreadable:0});
 assert.equal(ref.consensusFinality,undefined);assert.equal(ref.permissionGranted,undefined);
 for(const wrong of [{...record,operationId:'foreign-operation'}, {...record,typed:{...record.typed,memberHash:record.hash}}, {...record,hash:record.typed.memberHash}]){
  await assert.rejects(cold.read(wrong,binding,ref));
 }
 const files=await fs.readdir(directory);assert.equal(files.length,1);
 const metadata=await fs.readFile(path.join(directory,files[0]));
 assert.ok(metadata.includes(Buffer.from(record.hash)));assert.ok(metadata.includes(Buffer.from(record.typed.memberHash)));
 evidence.assertSafeToClose();assert.equal(evidence.pending(),null);
});
test('typed finality storage failure holds exact bytes and first cause until explicit local save',async t=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-typed-proof-debt-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let fault=true;const io={...fs,open:async(...args)=>{if(fault&&typeof args[1]==='number'&&(args[1]&constants.O_CREAT))throw false;return fs.open(...args);}};
 const evidence=new PQFinalityEvidence({directory,io}),binding={account:record.account,networkId:record.typed.networkId};
 const bytes=Buffer.from('synthetic typed response arriving after lock'),expected=Buffer.from(bytes);
 const http={method:'GET',requestPath:'/txs/'+record.hash+'/pq-action-finality-proof',contentType:'observed-invalid-type',cacheControl:'observed-invalid-cache'};
 await assert.rejects(evidence.append(record,binding,'collector-http',bytes,{httpStatus:202,http}),e=>e.cause===false);bytes.fill(0);
 const held=evidence.pending();assert.equal(held.causePresent,true);assert.throws(()=>evidence.assertSafeToClose());
 await assert.rejects(evidence.append(record,binding,'collector-http',Buffer.from('replacement'),{httpStatus:200}));
 assert.equal(evidence.pending().eventId,held.eventId);fault=false;
 const ref=await evidence.flush(held.eventId),cold=new PQFinalityEvidence({directory});
 assert.deepEqual(await cold.read(record,binding,ref),expected);assert.equal(ref.httpStatus,202);assert.deepEqual(ref.http,http);assert.equal(evidence.pending(),null);
 evidence.assertSafeToClose();assert.equal(record.status,'signed-unsubmitted');
});
test('typed finality HTTP metadata cannot substitute Member hash or execute header accessors',async t=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-typed-proof-http-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const evidence=new PQFinalityEvidence({directory}),binding={account:record.account,networkId:record.typed.networkId};let hits=0;
 const http={method:'GET',requestPath:'/txs/'+record.hash+'/pq-action-finality-proof',contentType:'application/json',cacheControl:'no-store'};
 await assert.rejects(evidence.append(record,binding,'collector-http',Buffer.from('DATA'),{httpStatus:202,http:{...http,requestPath:'/txs/'+record.typed.memberHash+'/pq-action-finality-proof'}}));
 const exotic={...http};Object.defineProperty(exotic,'cacheControl',{enumerable:true,get(){hits++;throw Error('must not run')}});
 await assert.rejects(evidence.append(record,binding,'collector-http',Buffer.from('DATA'),{httpStatus:202,http:exotic}));
 assert.equal(hits,0);assert.equal(evidence.pending(),null);assert.deepEqual(await fs.readdir(directory),[]);
});
async function typedCaptureFixture(t,{lockAfter=false,failOutput=false}={}){
 const f=await setup(t),directory=path.join(path.dirname(f.filePath),'evidence');
 const vector=JSON.parse(gunzipSync(readFileSync(new URL('./features/pq-transaction/fixtures/finality-c3-public.json.gz',import.meta.url)))).cases.find(r=>r.name==='succeeded-transfer');
 const target={...copy(vector.expectedTransaction),transactionType:'pq_action',envelope:Buffer.from(record.wire,'base64url').toString('base64'),nativeWire:memberBytes.toString('base64'),transactionHash:record.hash.slice(2),nativeWireHash:record.typed.memberHash.slice(2)};
 // Controlled Host/CLI DATA only; the reused proof is NOT a typed Go proof.
 const context=publicHostFixture().context;context.expectedTransaction=target;context.lightTrust.originalGenesisHash=record.typed.networkId;
 const contextBytes=Buffer.from(JSON.stringify(context)),output=copy(vector.expectedResponse);
 Object.assign(output.result,{transactionType:'pq_action',transactionHash:target.transactionHash,nativeWireHash:target.nativeWireHash,executionData:Buffer.from(record.hash).toString('base64')});
 let calls=0,invocation=null,locked=false,creates=0,fault=failOutput;
 const io={...fs,open:async(...args)=>{if(typeof args[1]==='number'&&(args[1]&constants.O_CREAT)&&++creates===3&&fault)throw false;return fs.open(...args)}};
 const evidence=new PQFinalityEvidence({directory,io}),guard={account:record.account,assert(){if(locked)throw Object.assign(Error('controlled lock'),{code:'CONTROLLED_LOCK'})}};
 const verifier={async run(input){calls++;invocation=input;locked=lockAfter},snapshot(){return {result:{stdout:Buffer.from(JSON.stringify(output)),stderr:Buffer.alloc(0),exitCode:0,signal:null},lifecycle:{started:calls>0,closeObserved:true,cleanupPending:false,interruption:null,stdoutTruncated:false,stderrTruncated:false,firstCausePresent:false,cleanupCausePresent:false,stdinSha256:invocation?sha(Buffer.from(invocation.stdin)).slice(2):null,stdinByteLength:invocation?Buffer.byteLength(invocation.stdin):0},firstCause:undefined,cleanupCause:undefined}},assertSafeToClose(){},retire(){},async join(){}};
 const capture=createPQFinalityVerifierCapture({evidence,verifier});
 return {...f,directory,evidence,capture,guard,binding:{account:record.account,networkId:record.typed.networkId},input:{contextPath:path.join(directory,'controlled-not-opened'),contextBytes,contextSha256:sha(contextBytes).slice(2),expected:target,proof:vector.request.proof},calls:()=>calls,unlock:()=>{locked=false},repair:()=>{fault=false}};
}
test('actual Main typed capture and journal cold restore preserve Member versus transport identity without finality',async t=>{
 const f=await typedCaptureFixture(t),result=await f.capture.run(record,f.binding,f.input,f.guard);assert.equal(f.calls(),1);
 assert.equal(result.observation.kind,'pq-typed-action');assert.equal(result.observation.nativeTransactionHash,record.typed.memberHash);assert.equal(result.observation.abciTransactionHash,record.hash);
 for(const key of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'])assert.equal(result.observation[key],false);
 await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 await f.store.savePQFinalityObservation(record,result.journalRecord);
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),rows=await cold.readPQFinalityObservations(record.account,record.hash,()=>{});
 assert.equal(rows.length,1);assert.deepEqual(rows[0],result.journalRecord);assert.deepEqual((await cold.readPQOriginals(record.account,()=>{}))[0],record);
 const evidence=new PQFinalityEvidence({directory:f.directory}),ref=result.records.find(r=>r.kind==='verifier-result');
 const restored=await readPQFinalityVerifierEvidence(record,f.binding,evidence,ref);assert.equal(restored.nativeTransactionHash,record.typed.memberHash);assert.equal(restored.consensusFinality,false);
 f.capture.assertSafeToClose();await assert.rejects(f.capture.run(record,f.binding,f.input,f.guard));assert.equal(f.calls(),1);
});
test('actual Main typed capture keeps returned evidence through late lock and never re-enters the producer',async t=>{
 const f=await typedCaptureFixture(t,{lockAfter:true});await assert.rejects(f.capture.run(record,f.binding,f.input,f.guard),{code:'CONTROLLED_LOCK'});
 assert.equal(f.calls(),1);f.capture.assertSafeToClose();f.unlock();
 const cold=new PQFinalityEvidence({directory:f.directory}),refs=await cold.candidates(record,f.binding);assert.equal(refs.candidates.length,5);
 const result=await readPQFinalityVerifierEvidence(record,f.binding,cold,refs.candidates.find(r=>r.kind==='verifier-result'));assert.equal(result.status,'verifier-result-data');assert.equal(result.consensusFinality,false);
 await assert.rejects(f.capture.run(record,f.binding,f.input,f.guard));assert.equal(f.calls(),1);
});
test('actual Main typed capture local flush preserves a failed output save without redispatch',async t=>{
 const f=await typedCaptureFixture(t,{failOutput:true});await assert.rejects(f.capture.run(record,f.binding,f.input,f.guard),e=>e.cause===false);
 assert.equal(f.calls(),1);assert.throws(()=>f.capture.assertSafeToClose());f.repair();
 const result=await f.capture.save(f.guard);assert.equal(f.calls(),1);assert.equal(result.observation.nativeTransactionHash,record.typed.memberHash);assert.equal(result.observation.canRetry,false);f.capture.assertSafeToClose();
});
test('actual Main typed Host context adapter keeps bounded DATA and independent original coordinates',async t=>{
 const f=await typedCaptureFixture(t),host=publicHostFixture();host.context.expectedTransaction=f.input.expected;host.light.originalGenesisHash=record.typed.networkId;host.exported.expectedTransaction=f.input.expected;
 const result=parsePQTransferHostContext(record,f.binding,host.selection,host.encode());
 assert.equal(result.expected.transactionType,'pq_action');assert.equal(result.expected.transactionHash,record.hash.slice(2));assert.equal(result.expected.nativeWireHash,record.typed.memberHash.slice(2));
 assert.equal(result.nativeRootAuthorized,false);assert.equal(result.sourceDeploymentQualified,false);assert.equal(result.independentFinality,false);
 host.exported.expectedTransaction={...f.input.expected,nativeWireHash:record.hash.slice(2)};
 assert.throws(()=>parsePQTransferHostContext(record,f.binding,host.selection,host.encode()));
});
test('actual Main typed collector persists actual HTTP response before late lock and cold restore never queries',async t=>{
 const f=await typedCaptureFixture(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 let locked=false,reads=0;const guard={account:record.account,assert(){if(locked)throw Object.assign(Error('controlled lock'),{code:'CONTROLLED_LOCK'})}};
 const body=Buffer.from(JSON.stringify({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'pending',observedExecutionStatus:'committed',nativeTransactionHash:record.typed.memberHash,abciTransactionHash:record.hash,executionHeight:'9',cometIndex:0,independentFinality:false,proofVerification:'not-performed'}));
 const http={method:'GET',requestPath:'/txs/'+record.hash+'/pq-action-finality-proof',status:202,contentType:'application/json; charset=utf-8',cacheControl:'no-store',body};
 const service=createPQFinalityCollection({intentStore:f.store,networkId:f.binding.networkId,evidence:f.evidence,transport:{readFinalityProof(){throw Error('typed must not use Transfer route')}},typedTransport:{async readOriginalProof(review,raw,original){reads++;assert.equal(review.operationId,record.operationId);assert.equal(original.memberHash,record.typed.memberHash);assert.equal(original.transportHash,record.hash);assert.deepEqual(Buffer.from(raw),Buffer.from(record.wire,'base64url'));locked=true;return http}}});
 await assert.rejects(service.collect(record.hash,guard),{code:'CONTROLLED_LOCK'});assert.equal(reads,1);service.assertSafeToClose();locked=false;
 const cold=new PQFinalityEvidence({directory:f.directory}),restored=createPQFinalityCollection({intentStore:new FileTransactionIntentStore({filePath:f.filePath}),networkId:f.binding.networkId,evidence:cold,transport:{readFinalityProof(){throw Error('cold restore cannot query')}}});
 const result=await restored.restore(record.hash,guard);assert.equal(result.records.length,1);assert.equal(result.records[0].kind,'pq-typed-action');assert.equal(result.records[0].proofCollected,false);assert.equal(result.records[0].memberHash,record.typed.memberHash);assert.equal(result.records[0].transportHash,record.hash);assert.equal(result.consensusFinality,false);assert.equal(reads,1);
 const ref=result.records[0].evidence;assert.equal(ref.http.contentType,http.contentType);assert.equal(ref.http.cacheControl,http.cacheControl);assert.deepEqual(await cold.read(record,f.binding,ref),body);
});
test('normal typed verification refuses unqualified packaged capability before selecting any Host or process',async t=>{
 const f=await typedCaptureFixture(t);let effects=0;const fail=()=>{effects++;throw Error('no Host or process permitted')};
 const normal=createPQFinalityVerification({evidence:f.evidence,selectSource:fail,createProducer:fail,createVerifier:fail,persistObservation:fail,flushObservation:fail,verifierReceipt:legacyPQVerifierReceipt591});
 await assert.rejects(normal.verify(record,f.binding,f.input.proof,f.guard),{code:'PQ_TYPED_VERIFIER_ASSET_NOT_SUPPLIED'});assert.equal(effects,0);assert.equal(normal.pending(),false);normal.assertSafeToClose();
});
test('closed fbec typed component still requires the genuine original Host and cannot treat signed assets as authority',async t=>{
 const f=await typedCaptureFixture(t);let sources=0,effects=0;
 const fail=()=>{effects++;throw Error('no producer/process/persist permitted')};
 const normal=createPQFinalityVerification({evidence:f.evidence,selectSource:()=>{sources++;throw Object.assign(Error('actual Host absent'),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'})},createProducer:fail,createVerifier:fail,persistObservation:fail,flushObservation:fail,verifierReceipt:originalPQVerifierReceipt});
 await assert.rejects(normal.verify(record,f.binding,f.input.proof,f.guard),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});
 assert.equal(sources,1);assert.equal(effects,0);assert.equal(normal.pending(),false);normal.assertSafeToClose();
});
test('mutating a private legacy receipt after controller construction cannot promote its typed capability',async t=>{
 const f=await typedCaptureFixture(t);let effects=0;const fail=()=>{effects++;throw Error('no effect')},receipt=structuredClone(legacyPQVerifierReceipt591);
 const normal=createPQFinalityVerification({evidence:f.evidence,selectSource:fail,createProducer:fail,createVerifier:fail,persistObservation:fail,flushObservation:fail,verifierReceipt:receipt});
 Object.assign(receipt,structuredClone(originalPQVerifierReceipt));
 await assert.rejects(normal.verify(record,f.binding,f.input.proof,f.guard),{code:'PQ_TYPED_VERIFIER_ASSET_NOT_SUPPLIED'});
 assert.equal(effects,0);assert.equal(normal.pending(),false);normal.assertSafeToClose();
});
test('typed original with a stripped review is rejected before selecting a Host even with fixed fbec assets',async t=>{
 const f=await typedCaptureFixture(t);let effects=0;const fail=()=>{effects++;throw Error('no effect')};
 const normal=createPQFinalityVerification({evidence:f.evidence,selectSource:fail,createProducer:fail,createVerifier:fail,persistObservation:fail,flushObservation:fail});
 const bad=structuredClone(record);delete bad.typed.review;
 await assert.rejects(normal.verify(bad,f.binding,f.input.proof,f.guard));
 assert.equal(effects,0);assert.equal(normal.pending(),false);normal.assertSafeToClose();
});
test('actual typed Host delivery preserves Protocol Member originalHash separately from Wallet transport journal key',async t=>{
 const f=await typedCaptureFixture(t),root=await fs.realpath(path.dirname(f.filePath)),incoming=path.join(root,'incoming'),destination=path.join(root,'installed');await fs.mkdir(incoming,{mode:0o700});
 const host=publicHostFixture();host.context.expectedTransaction=f.input.expected;host.light.originalGenesisHash=record.typed.networkId;
 const layout=[['migration','migration.json'],['genesis','genesis.json'],['state','committed-state.json'],['schedule','schedule.json'],['trustedLightBlock','trusted-light-block.json'],['context','trust-context.json'],['lifecycle','lifecycle.json'],['source','host-source.json']],body=new Map();
 for(const [role]of layout)if(!['context','lifecycle','source'].includes(role))body.set(role,Buffer.from(JSON.stringify({syntheticOnly:role})));
 const origin='/CONTROLLED-NOT-A-HOST/typed-delivery';
 for(const [field,role]of Object.entries({migrationFile:'migration',genesisFile:'genesis',stateFile:'state',scheduleFile:'schedule',trustedLightBlockFile:'trustedLightBlock'}))host.light[field]=path.join(origin,layout.find(x=>x[0]===role)[1]);
 host.light.trustedLightBlockSHA256=sha(body.get('trustedLightBlock')).slice(2);body.set('context',Buffer.from(JSON.stringify(host.context)));body.set('lifecycle',Buffer.from(JSON.stringify(host.lifecycle)));
 for(const [field,role]of Object.entries({migrationSHA256:'migration',genesisSHA256:'genesis',stateSHA256:'state',scheduleSHA256:'schedule',trustedLightBlockSHA256:'trustedLightBlock',contextSHA256:'context',lifecycleSHA256:'lifecycle'}))host.source[field]=sha(body.get(role)).slice(2);
 host.source.contextFile=path.join(origin,'trust-context.json');host.source.lifecycleFile=path.join(origin,'lifecycle.json');body.set('source',Buffer.from(JSON.stringify(host.source)));
 const manifest={version:'YNX-CONSENSUS-PROOF-HOST-DELIVERY/v1',sourceId:host.selection.sourceId,epoch:host.selection.epoch,binding:{operationId:record.operationId,account:record.account,networkId:record.typed.networkId,originalHash:record.typed.memberHash,nativeWireHash:record.typed.memberHash.slice(2),transactionHash:record.hash.slice(2)},sourceFile:'host-source.json',sourceSHA256:sha(body.get('source')).slice(2),files:layout.map(([role,name])=>({role,name,bytes:String(body.get(role).length),sha256:sha(body.get(role)).slice(2)})),totalBytes:String([...body.values()].reduce((n,b)=>n+b.length,0))};
 for(const [role,name]of layout)await fs.writeFile(path.join(incoming,name),body.get(role),{mode:0o600});
 const raw=Buffer.from(JSON.stringify(manifest));await fs.writeFile(path.join(incoming,'delivery.json'),raw,{mode:0o600});
 const args={deliveryDirectory:incoming,deliverySha256:sha(raw).slice(2),destinationDirectory:destination,original:record,binding:f.binding,guard:f.guard};
 const selected=await installOriginalProofHostDelivery(args),cold=await readInstalledOriginalProofHostDelivery({directory:destination,deliverySha256:args.deliverySha256,original:record,binding:f.binding,guard:f.guard});
 assert.deepEqual(cold,selected);assert.deepEqual(await fs.readFile(path.join(destination,'original/delivery.json')),raw);
 const context=JSON.parse(await fs.readFile(path.join(destination,'trust-context.json'),'utf8'));assert.equal(context.expectedTransaction.transactionType,'pq_action');assert.equal(context.expectedTransaction.transactionHash,record.hash.slice(2));assert.equal(context.expectedTransaction.nativeWireHash,record.typed.memberHash.slice(2));
 manifest.binding.originalHash=record.hash;const bad=Buffer.from(JSON.stringify(manifest));await fs.writeFile(path.join(incoming,'delivery.json'),bad,{mode:0o600});
 await assert.rejects(installOriginalProofHostDelivery({...args,deliverySha256:sha(bad).slice(2),destinationDirectory:destination+'-wrong'}));await assert.rejects(fs.stat(destination+'-wrong'),{code:'ENOENT'});
 assert.deepEqual(await fs.readFile(path.join(destination,'original/delivery.json')),raw);
});
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
function postResponse(status='committed'){
 const response=nodeResponse('committed'),view=JSON.parse(response.body);let code=200;
 if(status==='unknown'||status.startsWith('rejected')){
  view.status=status==='unknown'?'unknown':'rejected';view.committed=false;view.amount='0';view.error='controlled outcome';delete view.effects;delete view.to;
  code=status==='unknown'?202:422;
  if(status==='unknown'||status==='rejected-check'){view.executionHeight='0';delete view.cometIndex;}
 }
 return {...response,method:'POST',requestPath:'/transactions/pq/actions/broadcast',status:code,body:Buffer.from(JSON.stringify(view))};
}
// Controlled transport honors the same explicit capture-before-late-check
// contract as the real pinned reader. It never performs network I/O.
const capturingRead=read=>async(review,raw,original,assertCurrent,capture)=>{assertCurrent();const response=await read(review,raw,original,assertCurrent);await capture(response);assertCurrent();return response;};
test('actual Main checkPQ reads retained original under cold store and projects three node observations without resolving custody',async t=>{
 let reads=0,legacy=0;
 for(const [status,outcome] of [['committed','typed-commit-observed'],['rejected','typed-rejection-observed'],['unknown','typed-outcome-unknown']]){
  const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
  const before=await fs.readFile(f.filePath,'utf8'),cold=new FileTransactionIntentStore({filePath:f.filePath});
  const query=new TransactionSubmissions({intentStore:cold,pqReadOriginal:async()=>{legacy++;throw Error('wrong transport')},pqReadTypedOriginal:capturingRead(async(review,raw,original,assertCurrent)=>{
   reads++;assertCurrent();assert.deepEqual(review,record.typed.review);assert.equal(Buffer.from(raw).toString('base64url'),record.wire);assert.equal(original.memberHash,record.typed.memberHash);assert.equal(original.transportHash,record.hash);return nodeResponse(status);
  })});
  const observed=await query.checkPQ(record.hash,record.account,{account:record.account,assert(){}});assert.equal(observed.outcome,outcome);assert.equal(observed.networkQueryPerformed,true);
  assert.equal(observed.status,status==='committed'?'pq-inclusion-observed':status==='rejected'?'pq-rejection-observed':'pq-signed-unsubmitted');
  for(const key of ['submitted','canRetry','clearsOriginal','consensusFinality','permissionGranted'])assert.equal(observed[key],false);
  assert.deepEqual(projectPQOriginalObservation({ok:true,value:observed},{account:record.account,hash:record.hash,kind:record.kind}),{outcome});
  if(status!=='unknown')assert.throws(()=>projectPQOriginalObservation({ok:true,value:{...observed,status:'pq-signed-unsubmitted'}},{account:record.account,hash:record.hash,kind:record.kind}));
  if(status==='unknown')assert.equal(await fs.readFile(f.filePath,'utf8'),before);
  else {const progress=await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(record.account,record.hash,()=>{});assert.equal(progress.status,status==='committed'?'inclusion-observed':'rejection-observed');assert.equal(progress.storageConfirmed,true);}
  assert.deepEqual((await cold.readPQOriginals(record.account,()=>{}))[0],record);await assert.rejects(cold.reserveOriginal(record.account,record.kind));
 }
 assert.equal(reads,3);assert.equal(legacy,0);
});
test('actual Main typed query suppresses an in-flight late-lock result, preserving exact journal',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8');let live=true,release,entered;
 const started=new Promise(resolve=>{entered=resolve}),query=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(()=>new Promise(resolve=>{release=()=>resolve(nodeResponse());entered();}))});
 const pending=query.checkPQ(record.hash,record.account,{account:record.account,assert(){if(!live)throw Error('QA_LOCKED_DURING_QUERY')}}),rejected=assert.rejects(pending,/QA_LOCKED_DURING_QUERY/);
 await started;live=false;release();await rejected;assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('actual Main typed query refuses unavailable reader or mismatched node original without legacy fallback or disk changes',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8'),guard={account:record.account,assert(){}};
 const absent=new TransactionSubmissions({intentStore:f.store});await assert.rejects(absent.checkPQ(record.hash,record.account,guard),e=>e.data?.code==='PQ_READ_SOURCE_UNAVAILABLE');
 const swapped=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(async()=>({...nodeResponse(),requestPath:'/transactions/pq/actions/0x'+'ab'.repeat(32)}))});
 await assert.rejects(swapped.checkPQ(record.hash,record.account,guard));assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('node query after actual save lost acknowledgement neither clears held first cause nor repeats write',async t=>{
 const f=await setup(t);let armed=false,writes=0;
 const store=new FileTransactionIntentStore({filePath:f.filePath,io:{...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw false}}}});
 await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);armed=true;await assert.rejects(store.saveOriginal(record.account,record.hash,()=>{}));
 const held=store.localOriginal(record.account),before=await fs.readFile(f.filePath,'utf8'),query=new TransactionSubmissions({intentStore:store,pqReadTypedOriginal:capturingRead(async()=>nodeResponse())});
 const first=held.storageCause,observed=await query.checkPQ(record.hash,record.account,{account:record.account,assert(){}});assert.equal(observed.outcome,'typed-outcome-unknown');assert.equal(store.localOriginal(record.account),held);assert.equal(held.storageCausePresent,true);assert.equal(held.storageCause,first);assert.equal(first.cause,false);assert.equal(writes,1);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('actual Main typed node query works after fresh process restart using only retained private original',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8'),response=nodeResponse();
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import{readFileSync}from'node:fs';import{FileTransactionIntentStore}from'./src/transaction-intent-store.mjs';import{TransactionSubmissions}from'./src/transaction-submissions.mjs';
  const p=JSON.parse(readFileSync(0,'utf8')),store=new FileTransactionIntentStore({filePath:p.filePath});let reads=0;
  const query=new TransactionSubmissions({intentStore:store,pqReadTypedOriginal:async(review,raw,original,guard,capture)=>{reads++;guard();const response={...p.response,body:Buffer.from(p.body,'base64')};await capture(response);guard();return response;}});
  const observed=await query.checkPQ(p.hash,p.account,{account:p.account,assert(){}});console.log(JSON.stringify({observed,reads}));
 `],{cwd:new URL('../',import.meta.url),input:JSON.stringify({filePath:f.filePath,hash:record.hash,account:record.account,response:{...response,body:undefined},body:response.body.toString('base64')}),encoding:'utf8',timeout:30000,maxBuffer:65536});
 assert.equal(child.status,0,child.stderr);const output=JSON.parse(child.stdout);assert.equal(output.reads,1);assert.equal(output.observed.outcome,'typed-outcome-unknown');assert.equal(output.observed.memberHash,record.typed.memberHash);assert.equal(output.observed.hash,record.hash);assert.equal(output.observed.consensusFinality,false);assert.equal(output.observed.canRetry,false);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('typed known node progress persists across restart and never regresses to later UNKNOWN or permits a new submission',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const guard={account:record.account,assert(){}},known=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(async()=>nodeResponse('committed'))});
 assert.equal((await known.checkPQ(record.hash,record.account,guard)).outcome,'typed-commit-observed');const before=await fs.readFile(f.filePath,'utf8');
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),unknown=new TransactionSubmissions({intentStore:cold,pqReadTypedOriginal:capturingRead(async()=>nodeResponse())});
 assert.equal((await unknown.checkPQ(record.hash,record.account,guard)).outcome,'typed-commit-observed');assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 const marker=await cold.beginPQSubmission(record.account,record.hash,()=>{});assert.equal(marker.created,false);assert.equal(marker.status,'inclusion-observed');
 const identity=JSON.parse(before).pqProgress[0];assert.equal(identity.nativeTransactionHash,record.typed.memberHash);assert.equal(identity.abciTransactionHash,record.hash);assert.equal(identity.hash,record.hash);
});
test('a pre-submission UNKNOWN query does not invent broadcast admission or block a later independently approved first submission',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 await new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(async()=>nodeResponse())}).checkPQ(record.hash,record.account,{account:record.account,assert(){}});
 assert.equal((await f.store.readPQProgress(record.account,record.hash,()=>{})).status,'signed-unsubmitted');
 const marker=await f.store.beginPQSubmission(record.account,record.hash,()=>{});assert.equal(marker.created,true);assert.equal(marker.status,'submission-unknown');
 // A journal marker is only a durable fence, never consent or a POST.
 assert.equal((await f.store.beginPQSubmission(record.account,record.hash,()=>{})).created,false);
});
test('a read-only early UNKNOWN leaves normal shutdown safe without inventing a submit record',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 await new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(async()=>nodeResponse())}).checkPQ(record.hash,record.account,{account:record.account,assert(){}});
 assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('typed node observation storage failure retains the exact response and flushes locally without a second query',async t=>{
 const f=await setup(t);let armed=false,reads=0;
 const store=new FileTransactionIntentStore({filePath:f.filePath,io:{...fs,rename:async(...args)=>{if(armed)throw Error('QA_TYPED_PROGRESS_WRITE_REFUSED');return fs.rename(...args)}}});
 await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);await store.saveOriginal(record.account,record.hash,()=>{});armed=true;
 const query=new TransactionSubmissions({intentStore:store,pqReadTypedOriginal:capturingRead(async()=>{reads++;return nodeResponse('committed')})});
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
 let live=true;const query=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(async()=>{live=false;return nodeResponse('committed')})});
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
 const query=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:capturingRead(async()=>nodeResponse('committed'))});
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
test('actual Main typed POST response is captured and persisted after one durable admission, never parsed as GET',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 assert.equal((await f.store.beginPQSubmission(record.account,record.hash,()=>{})).created,true);
 const response=postResponse(),expected=Buffer.from(response.body),saved=f.store.savePQSubmissionResult(record.account,record.hash,{phase:'submission',response});response.body.fill(0);assert.equal((await saved).status,'inclusion-observed');
 f.store.selectPQProgressOutcome(record.account,record.hash,held=>assert.deepEqual(held.firstTypedSubmissionResponse.body,expected));
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),progress=await cold.readPQProgress(record.account,record.hash,()=>{});assert.equal(progress.status,'inclusion-observed');assert.equal(progress.storageConfirmed,true);
 const state=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.equal(state.pqProgress[0].result.phase,'submission');assert.equal(state.pqProgress[0].result.method,'POST');assert.equal(state.pqProgress[0].result.requestPath,'/transactions/pq/actions/broadcast');assert.deepEqual((await cold.readPQOriginals(record.account,()=>{}))[0],record);assert.equal((await cold.beginPQSubmission(record.account,record.hash,()=>{})).created,false);
});
test('actual Main typed POST stores both rejection classes and error-only UNKNOWN without retry permission',async t=>{
 for(const kind of ['rejected-check','rejected-indexed','unknown','error-only']){
  const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});await f.store.beginPQSubmission(record.account,record.hash,()=>{});
  const response=kind==='error-only'?{...postResponse(),status:415,body:Buffer.from(JSON.stringify({error:'controlled media refusal'}))}:postResponse(kind);
  const result=await f.store.savePQSubmissionResult(record.account,record.hash,{phase:'submission',response});assert.equal(result.status,kind.startsWith('rejected')?'rejection-observed':'submission-unknown');
  const progress=await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(record.account,record.hash,()=>{});assert.equal(progress.status,result.status);assert.equal(progress.retryAuthorized,false);assert.equal(progress.clearsOriginal,false);assert.equal(progress.consensusFinality,false);assert.equal((await f.store.beginPQSubmission(record.account,record.hash,()=>{})).created,false);
 }
});
test('typed POST first raw response remains distinct from an earlier read and malformed or mismatched callbacks do not erase it',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 await f.store.savePQTypedReadResult(record.account,record.hash,nodeResponse());await f.store.beginPQSubmission(record.account,record.hash,()=>{});
 const response={...postResponse(),body:Buffer.from([0xff])},pending=f.store.savePQSubmissionResult(record.account,record.hash,{phase:'submission',response});response.body.fill(0);await assert.rejects(pending);
 const second={...postResponse(),method:'GET'};await assert.rejects(f.store.savePQSubmissionResult(record.account,record.hash,{phase:'submission',response:second}));
 f.store.selectPQProgressOutcome(record.account,record.hash,held=>{assert.deepEqual([...held.firstTypedSubmissionResponse.body],[0xff]);assert.equal(held.firstTypedResponse.method,'GET');assert.equal(held.firstRawPresent,true);assert.ok(held.unparsedResult)});
 assert.equal((await f.store.readPQProgress(record.account,record.hash,()=>{})).status,'submission-unknown');await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='PQ_PROGRESS_CLOSE_UNCONFIRMED');
});
test('normal Main query refuses missing or duplicate capture instead of adopting a late return as the original',async t=>{
 const f=await setup(t);await f.store.reserveOriginal(record.account,record.kind);f.store.captureOriginal(record.account,record,record.kind);await f.store.saveOriginal(record.account,record.hash,()=>{});
 const before=await fs.readFile(f.filePath,'utf8'),guard={account:record.account,assert(){}};
 const missing=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async()=>nodeResponse()});await assert.rejects(missing.checkPQ(record.hash,record.account,guard),e=>e.data?.code==='PQ_READ_CAPTURE_REQUIRED');
 const duplicate=new TransactionSubmissions({intentStore:f.store,pqReadTypedOriginal:async(_review,_raw,_original,_guard,capture)=>{const response=nodeResponse();await capture(response);await capture(response);return response}});await assert.rejects(duplicate.checkPQ(record.hash,record.account,guard),e=>e.data?.code==='PQ_READ_CAPTURE_DUPLICATE');
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.deepEqual((await f.store.readPQOriginals(record.account,()=>{}))[0],record);
});
