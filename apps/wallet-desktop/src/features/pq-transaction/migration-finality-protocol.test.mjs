import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {decodePQMigrationRequest,preparePQMigrationTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {preparePQFinalityInvocation,bindSavedPQFinalityInvocation,parsePQFinalityVerifierResult} from '../../wallet-pq-finality-original.mjs';
import {PQFinalityEvidence} from '../../wallet-pq-finality-evidence.mjs';
import {createPQFinalityCollection} from '../../wallet-pq-finality-collection.mjs';
import {PQFinalityVerifierProcessKernel} from '../../wallet-pq-verifier-process.mjs';
import {createPQFinalityVerification} from '../../wallet-pq-finality-verification.mjs';
import {readPQFinalityVerifierEvidence} from '../../wallet-pq-verifier-restore.mjs';
import {pqFinalityRecordGeneration,createPQFinalityRecord} from '../../wallet-pq-finality-record.mjs';
import {createPQVerifiedFinalityTerminal,parsePQFinalityTerminalData} from '../../wallet-pq-finality-terminal.mjs';
import {originalPQVerifierReceipt} from '../../wallet-pq-runtime-component.mjs';
import {createPQFinalityHistoryProtection} from '../../wallet-pq-finality-history-protection.mjs';
import {createPQTransactionSubmission} from './submission.mjs';
import {parsePQTransferFinalityCollector} from './finality-collector.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),copy=v=>structuredClone(v);
const packed=readFileSync(new URL('./fixtures/migration-finality-0fe-public.json.gz',import.meta.url));assert.equal(sha(packed),'9cf71b3bebc7894ed1ab6629fc00e3538cc6f2e465e784fda8cb829de92aeee1');
const unpacked=gunzipSync(packed,{maxOutputLength:8<<20});assert.equal(sha(unpacked),'41fe690249a01983cea35f48d5eb7861489d8efc7797d73aac6a3f6995afc743');
const fixture=JSON.parse(unpacked),receiptBytes=readFileSync(new URL('./fixtures/migration-finality-0fe-cli-receipt.json',import.meta.url));assert.equal(sha(receiptBytes),'6557cd49dded9080092e48c4039ae92f16cf946453e9385cb5899adbeb7278ef');
const receipt=JSON.parse(receiptBytes),row=fixture.cases[0],wire=Buffer.from(row.expectedTransaction.nativeWire,'base64'),decoded=decodePQMigrationRequest(wire),binding={account:decoded.intent.owner,networkId:decoded.intent.chainId},original=createPQOriginalRecord({account:binding.account,kind:'pq-migration',operationId:'PUBLIC-0fe-saved-migration',request:preparePQMigrationTransport(wire)});
const cli=name=>{const r=receipt.cases.find(x=>x.name===name),stdout=Buffer.from(r.stdoutBase64,'base64');assert.equal(sha(stdout),r.stdoutSHA256);return{stdout,stderr:Buffer.alloc(0),exitCode:r.exitCode,signal:null}};
const collectorBytes=()=>Buffer.from(JSON.stringify({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'collected',observedExecutionStatus:'committed',nativeTransactionHash:original.hash,abciTransactionHash:'0x'+row.expectedTransaction.transactionHash,executionHeight:'9',cometIndex:0,independentFinality:false,proofVerification:'not-performed',proof:row.request.proof}));
async function directory(t){const root=await fs.mkdtemp(path.join(tmpdir(),'ynx-migration-0fe-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
async function publicContext(root){
 const light={...fixture.trustContextParameters};
 for(const [field,name]of Object.entries(fixture.trustContextFiles)){const m=fixture.materials.find(x=>x.name===name),bytes=Buffer.from(m.bytes,'base64');assert.equal(String(bytes.length),m.byteLength);assert.equal(sha(bytes),m.sha256);const file=path.join(root,name);await fs.writeFile(file,bytes,{mode:0o600});light[field]=file;}
 return{version:'YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',lightTrust:light,expectedTransaction:copy(row.expectedTransaction)};
}
// Original Protocol fixture and actual recorded Linux CLI stdout. HTTP and
// child-process boundaries below are CONTROLLED. No fresh CLI/clock/Host grant,
// account keys, Root, live transaction or current public-chain finality runs.
test('migration proof is an independently produced E6 fixture with exact normal CLI success and three recorded refusals',()=>{
 assert.equal(receipt.commit,'0fe63a38691bc6681a578df161c557506532963b');assert.equal(receipt.runId,'40225482283');assert.equal(receipt.normalCLIExecuted,true);assert.equal(receipt.fixtureSHA256,sha(unpacked));assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.actualCometNode,false);assert.equal(fixture.nativeRootAuthorized,false);assert.equal(fixture.dataAuthorized,false);assert.equal(fixture.trustContextParameters.trustingPeriodNanoseconds,'3600000000000');
 const run=cli(row.name);assert.equal(run.exitCode,0);assert.deepEqual(JSON.parse(run.stdout),row.expectedResponse);assert.equal(row.expectedTransaction.transactionType,'account_migration');assert.equal(sha(wire),row.expectedTransaction.nativeWireHash);assert.notEqual(row.expectedTransaction.nativeWireHash,row.expectedTransaction.transactionHash);assert.equal(row.expectedTransaction.block.headerHeight,'9');assert.equal(row.expectedTransaction.successor.headerHeight,'10');assert.equal(row.expectedTransaction.index,'0');assert.equal(Buffer.from(row.expectedResponse.result.executionData,'base64').toString(),'0x'+row.expectedTransaction.transactionHash);
 for(const negative of fixture.negativeCases){const r=receipt.cases.find(x=>x.name===negative.name);assert.equal(r.exitCode,1);assert.equal(JSON.parse(cli(negative.name).stdout).code,negative.cliExpectedCode);}
});
test('migration actual proof collector, saved context and verifier result bind the complete original, H/index and H+1',async t=>{
 const root=await directory(t),context=await publicContext(root),raw=collectorBytes(),collected=parsePQTransferFinalityCollector(original,binding,200,raw),invocation=preparePQFinalityInvocation(original,binding,row.expectedTransaction,collected.proof),contextBytes=Buffer.from(JSON.stringify(context));assert.deepEqual(JSON.parse(invocation.stdin),row.request);assert.equal(invocation.stdinSha256,sha(Buffer.from(invocation.stdin)));const saved=bindSavedPQFinalityInvocation(original,binding,contextBytes,Buffer.from(invocation.stdin));assert.equal(saved.expected.transactionType,'account_migration');assert.equal(saved.contextSha256,sha(contextBytes));assert.equal(saved.consensusFinality,false);
 const result=parsePQFinalityVerifierResult(original,binding,row.expectedTransaction,cli(row.name));assert.equal(result.observation.kind,'pq-migration');assert.equal(result.observation.reportedOutcome,'succeeded');assert.equal(result.observation.consensusFinality,false);assert.equal(result.observation.nativeGrant,false);assert.equal(result.stdoutSha256,receipt.cases[0].stdoutSHA256);
 for(const negative of fixture.negativeCases){const r=parsePQFinalityVerifierResult(original,binding,row.expectedTransaction,cli(negative.name));assert.equal(r.observation.status,'verifier-error-data');assert.equal(r.observation.reportedOutcome,null);assert.equal(r.observation.canRetry,false);}
 for(const edit of [{transactionType:'pq_transfer'},{nativeWireHash:row.expectedTransaction.transactionHash},{successor:{...row.expectedTransaction.successor,headerHeight:'11'}}])assert.throws(()=>preparePQFinalityInvocation(original,binding,{...row.expectedTransaction,...edit},row.request.proof));
 // Index is independently supplied Host DATA until proof/result verification;
 // a valid index-one target cannot reuse the index-zero successful stdout.
 assert.throws(()=>parsePQFinalityVerifierResult(original,binding,{...row.expectedTransaction,index:'1'},cli(row.name)));
});
test('migration full proof evidence cold restore retains the original and refuses a missing genuine Host',async t=>{
 const root=await directory(t),filePath=path.join(root,'journal.json'),store=new FileTransactionIntentStore({filePath}),evidence=new PQFinalityEvidence({directory:path.join(root,'evidence')});await store.reserveOriginal(binding.account,'pq-migration');store.captureOriginal(binding.account,original,'pq-migration');await store.saveOriginal(binding.account,original.hash,()=>{});let reads=0;
 const service=createPQFinalityCollection({intentStore:store,networkId:binding.networkId,evidence,transport:{async readFinalityProof(){reads++;return{status:200,rawBytes:collectorBytes()}}}}),guard={account:binding.account,assert(){}};const out=await service.collect(original.hash,guard);assert.equal(out.kind,'pq-migration');assert.equal(out.proofCollected,true);assert.equal(out.consensusFinality,false);assert.deepEqual(await evidence.read(original,binding,out.evidence),collectorBytes());
 const cold=createPQFinalityCollection({intentStore:new FileTransactionIntentStore({filePath}),networkId:binding.networkId,evidence:new PQFinalityEvidence({directory:path.join(root,'evidence')}),transport:{readFinalityProof(){assert.fail('no repeated GET')}}});assert.equal((await cold.restore(original.hash,guard)).records.length,1);await assert.rejects(cold.verify(original.hash,guard),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});assert.equal(reads,1);assert.deepEqual(await store.readPQOriginals(binding.account,()=>{}),[original]);
});
test('migration original Host/process/evidence/journal DATA pipeline consumes recorded stdout and cold-restores without minting terminal authority',async t=>{
 const root=await directory(t),context=await publicContext(root),contextBytes=Buffer.from(JSON.stringify(context)),sourceId='PUBLIC.migration:0fe',epoch='1',light=context.lightTrust,lifecycle={version:'YNX-CONSENSUS-PROOF-HOST-LIFECYCLE/v1',sourceId,epoch,status:'current'},lifecycleBytes=Buffer.from(JSON.stringify(lifecycle));
 const materials=Object.fromEntries(fixture.materials.map(x=>[x.name,x])),source={version:'YNX-CONSENSUS-PROOF-HOST-SOURCE/v1',sourceId,epoch,contextFile:path.join(root,'context.json'),contextSHA256:sha(contextBytes),lifecycleFile:path.join(root,'lifecycle.json'),lifecycleSHA256:sha(lifecycleBytes),migrationSHA256:materials['migration.json'].sha256,genesisSHA256:materials['genesis.json'].sha256,stateSHA256:materials['committed-state.json'].sha256,scheduleSHA256:materials['schedule.json'].sha256,runtimePlanSHA256:'',trustedLightBlockSHA256:materials['trusted-light-block.json'].sha256},sourceBytes=Buffer.from(JSON.stringify(source));
 const trusted=JSON.parse(Buffer.from(materials['trusted-light-block.json'].bytes,'base64')),time=trusted.signed_header.header.time,expiresAt=new Date(Date.parse(time)+3600000).toISOString().slice(0,19)+time.slice(19); // Exact original one-hour window. No Date.now override or extension.
 const exported={version:'YNX-CONSENSUS-PROOF-HOST-CONTEXT/v1',classification:'data',sourceId,epoch,sourceFingerprint:sha(sourceBytes),sourceBytes:sourceBytes.toString('base64'),sourceSHA256:sha(sourceBytes),lifecycleBytes:lifecycleBytes.toString('base64'),lifecycleSHA256:sha(lifecycleBytes),contextVersion:context.version,contextPath:source.contextFile,contextBytes:contextBytes.toString('base64'),contextSHA256:sha(contextBytes),expectedTransaction:row.expectedTransaction,chainId:light.chainId,engineHeight:light.engineHeight,engineAppHash:light.engineAppHash,trustedLightBlockSHA256:light.trustedLightBlockSHA256,expiresAt,currentChecked:true,nativeRootAuthorized:false,sourceDeploymentQualified:false,proofVerified:false},selection={sourcePath:path.join(root,'source.json'),sourceSha256:sha(sourceBytes),sourceId,epoch};
 const hostStdout=Buffer.from(JSON.stringify({version:'YNX-CONSENSUS-PROOF-HOST-RESULT/v1',code:'EXPORTED_PROOF_TRUST_DATA',context:exported})+'\n'),evidence=new PQFinalityEvidence({directory:path.join(root,'evidence')}),filePath=path.join(root,'journal.json'),store=new FileTransactionIntentStore({filePath});await store.reserveOriginal(binding.account,'pq-migration');store.captureOriginal(binding.account,original,'pq-migration');await store.saveOriginal(binding.account,original.hash,()=>{});let hostCalls=0,proofCalls=0;
 const kernel=mode=>new PQFinalityVerifierProcessKernel({mode,prepare:async input=>({executable:'/PUBLIC/controlled-not-a-binary',contextPath:mode==='proof'?input.contextPath:input.sourcePath,contextSha256:mode==='proof'?input.contextSha256:input.sourceSha256,stdin:input.stdin}),spawn:()=>{const child=new EventEmitter();for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{}}child.kill=()=>true;child.stdin.end=()=>queueMicrotask(()=>{if(mode==='proof')proofCalls++;else hostCalls++;child.stdout.emit('data',mode==='proof'?cli(row.name).stdout:hostStdout);child.emit('close',0,null)});return child}});
 const service=createPQFinalityVerification({evidence,selectSource:async()=>selection,createProducer:()=>kernel('host-producer'),createVerifier:()=>kernel('proof'),persistObservation:(o,r)=>store.savePQFinalityObservation(o,r),flushObservation:(o,r,g)=>store.flushPQFinalityObservation(o.account,o.hash,pqFinalityRecordGeneration(r),()=>g.assert())}),guard={account:binding.account,assert(){}};
 const out=await service.verify(original,binding,row.request.proof,guard);assert.equal(out.status,'verifier-result-data');assert.equal(out.consensusFinality,false);assert.equal(out.observationStored,true);assert.equal(hostCalls,3);assert.equal(proofCalls,1);
 const records=await new FileTransactionIntentStore({filePath}).readPQFinalityObservations(binding.account,original.hash,()=>{});assert.equal(records.length,1);assert.equal(records[0].observation.kind,'pq-migration');assert.equal(records[0].target.index,'0');const cold=await readPQFinalityVerifierEvidence(original,binding,new PQFinalityEvidence({directory:path.join(root,'evidence')}),records[0].references.manifest);assert.equal(cold.kind,'pq-migration');assert.equal(cold.reportedOutcome,'succeeded');assert.equal(cold.consensusFinality,false);assert.deepEqual(await store.readPQOriginals(binding.account,()=>{}),[original]);service.assertSafeToClose();
 await assert.rejects(createPQVerifiedFinalityTerminal({original,binding,result:out,host:{},selection:{},verifier:kernel('proof'),evidence,guard}),{code:'PQ_FINALITY_ORIGINAL_CALLER_REQUIRED'});assert.equal(hostCalls,3);assert.equal(proofCalls,1);
});
// Same existing journal-test seam: substitute ONLY the opaque token unwrapping
// dependency. The production class and token registry above stay unmodified.
// This tests local atomic archival, not actual Host/Native/OS qualification.
async function controlledStoreClass(readToken){
 const url=import.meta.resolve('../../transaction-intent-store.mjs'),raw=await fs.readFile(new URL(url),'utf8'),bindings={};
 for(const match of raw.matchAll(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];$/gm)){
  const spec=match[2],module=await import(spec.startsWith('.')?new URL(spec,url).href:spec),clause=match[1].trim();
  if(clause.startsWith('* as '))bindings[clause.slice(5)]=module;
  else if(clause.startsWith('{'))for(const field of clause.slice(1,-1).split(',')){const [name,alias]=field.trim().split(/\s+as\s+/);bindings[alias??name]=module[name]}
  else bindings[clause]=module.default;
 }
 bindings.readPQVerifiedFinalityTerminal=readToken;return Function(...Object.keys(bindings),raw.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nreturn FileTransactionIntentStore;')(...Object.values(bindings));
}
function publicProtection(){
 const key=Buffer.alloc(32,0x42);let sequence=0;
 return createPQFinalityHistoryProtection({isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'PUBLIC_CONTROLLED_TEST_ONLY',encryptString:text=>{const nonce=Buffer.alloc(12);nonce.writeUInt32BE(++sequence,8);const c=createCipheriv('aes-256-gcm',key,nonce),body=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body])},decryptString:bytes=>{const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8')}});
}
async function terminalFixture(t){
 const root=await directory(t),context=await publicContext(root),invocation=preparePQFinalityInvocation(original,binding,row.expectedTransaction,row.request.proof),run=cli(row.name),parsed=parsePQFinalityVerifierResult(original,binding,row.expectedTransaction,run),ref=(kind,b)=>({eventId:randomUUID(),attemptId:randomUUID(),kind,bytes:b.length,sha256:sha(b)}),record=createPQFinalityRecord(original,binding,row.expectedTransaction,{...parsed,records:[ref('host-context',Buffer.from(JSON.stringify(context))),ref('verifier-stdin',Buffer.from(invocation.stdin)),ref('verifier-stdout',run.stdout),ref('verifier-stderr',run.stderr),ref('verifier-result',Buffer.from('PUBLIC controlled manifest'))]});
 // Existing Main receipt is grammar DATA here, never relabelled as the 0fe CLI
 // binary. Its production caller/Host admission is deliberately not minted.
 const finality=parsePQFinalityTerminalData({version:1,record,generation:pqFinalityRecordGeneration(record),host:{sourceId:'PUBLIC.migration-terminal',epoch:'1',sourceFingerprint:'a'.repeat(64),sourceSha256:'b'.repeat(64),lifecycleSha256:'c'.repeat(64),contextSha256:record.references.context.sha256},verifier:originalPQVerifierReceipt,status:'finalized-succeeded',nativeGrant:false},original),token=Object.freeze({PUBLIC:'controlled unwrap only'}),Store=await controlledStoreClass((given,selected)=>{assert.equal(given,token);assert.deepEqual(selected,original);return copy(finality)}),filePath=path.join(root,'terminal.json'),protection=publicProtection(),store=new Store({filePath,finalityProtection:protection});
 await store.reserveOriginal(binding.account,'pq-migration');store.captureOriginal(binding.account,original,'pq-migration');await store.saveOriginal(binding.account,original.hash,()=>{});await store.beginPQSubmission(binding.account,original.hash,()=>{});await store.savePQSubmissionFailure(binding.account,original.hash,false);await store.savePQFinalityObservation(original,record);
 return{store,Store,filePath,protection,token,finality,record};
}
test('migration recorded CLI DTO cannot mint production terminal authority; controlled atomic archive and cold query preserve full E6',async t=>{
 const f=await terminalFixture(t),actual=new FileTransactionIntentStore({filePath:f.filePath,finalityProtection:f.protection}),before=await fs.readFile(f.filePath);
 for(const token of [f.token,copy(f.finality),{...copy(f.finality),consensusFinality:true,nativeGrant:true}])assert.throws(()=>actual.adoptPQFinalityTerminal(original,token,()=>{}),{code:'PQ_FINALITY_TERMINAL_UNVERIFIED'});assert.deepEqual(await fs.readFile(f.filePath),before);
 const done=await f.store.adoptPQFinalityTerminal(original,f.token,()=>{});assert.equal(done.status,'finalized-succeeded');assert.equal(done.nativeGrant,false);const saved=await fs.readFile(f.filePath),state=JSON.parse(saved);assert.equal(state.pqOriginals.length,0);assert.equal(state.pqHistory.length,1);assert.deepEqual(state.pqHistory[0].original,original);assert.equal(state.pqHistory[0].finality.record.observation.transactionType,'account_migration');
 const cold=new f.Store({filePath:f.filePath,finalityProtection:f.protection}),controller=createPQTransactionSubmission({intentStore:cold,networkId:binding.networkId,transport:{readOriginal(){assert.fail('terminal query cannot fetch, sign or send')},submitMigration(){assert.fail('no resend')}}}),progress=await controller.reconcile(original.hash,{account:binding.account,assert(){}});assert.equal(progress.kind,'pq-migration');assert.equal(progress.status,'finalized-succeeded');assert.equal(progress.canRetry,false);assert.deepEqual(await cold.readPQOriginals(binding.account,()=>{}),[original]);await f.store.adoptPQFinalityTerminal(original,f.token,()=>{});assert.deepEqual(await fs.readFile(f.filePath),saved);await cold.assertPQProgressSafeToClose();
});
test('migration raw response capture debt blocks even controlled terminal archival and preserves the original bytes',async t=>{
 const f=await terminalFixture(t),response={method:'POST',requestPath:preparePQMigrationTransport(wire).path,status:202,contentType:'application/json',cacheControl:'no-store',body:new Uint8Array([255,192,0])};await assert.rejects(f.store.savePQMigrationSubmissionResult(binding.account,original.hash,response));await f.store.savePQSubmissionFailure(binding.account,original.hash,false);
 await assert.rejects(f.store.adoptPQFinalityTerminal(original,f.token,()=>{}),e=>e.data?.code==='PQ_FINALITY_SUBMISSION_RESULT_UNCONFIRMED');const state=JSON.parse(await fs.readFile(f.filePath));assert.deepEqual(state.pqOriginals,[original]);assert.equal((state.pqHistory??[]).length,0);f.store.selectPQProgressOutcome(binding.account,original.hash,slot=>{assert.equal(slot.migrationResponseUncaptured,true);assert.deepEqual(Buffer.from(slot.firstTypedSubmissionResponse.body),Buffer.from(response.body))});await assert.rejects(f.store.assertPQProgressSafeToClose());
});
