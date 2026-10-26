import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freshPhaseSchema,readGuardedFreshPhasePair,readGuardedFreshPhaseLog,freshTimingQuantiles} from './pq-fresh-phase-readback.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const h=n=>'0x'+n.toString(16).padStart(64,'0');

// Arithmetic/identity fixtures ONLY. No nodes, signatures, approvals, keys or
// cryptographic proof success are created by these unit objects.
function fixture(){
 const expected={protocolCommit:'a'.repeat(40),performanceClientCommit:'70e7e450997a0ae77dbad5a8be3682f482c6ddd8',clientSourceTree:'4866cc3924c060eb6a29939915d39b1c5c625607',clientCodeTree:'19b9fafcfbb3f434b9ff745fb785afb1d0741247',vmBootId:'UNIT_ONLY_VM',clockDomain:'UNIT_ONLY_COORDINATOR',businessPerArm:2,epochs:{before:'e'.repeat(64),after:'f'.repeat(64)},binaries:{node:'1'.repeat(64),signer:'2'.repeat(64),verifier:'3'.repeat(64),client:'4'.repeat(64)},verifierRole:'verifier'};
 const arms=['before','after'].map((name,armIndex)=>{
  const mode=armIndex===0?'decode-index-again':'reuse-validated-index';
  const business=[0,1].map(i=>{
   const native=h(armIndex*10+i+1),abci=h(armIndex*10+i+100),height='100';
   const v={version:'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1',code:'VERIFIED_TRANSACTION_DATA',result:{version:'YNX-PQ-TRANSACTION-PROOF/v1',classification:'data',transactionType:'pq_transfer',transactionHash:abci.slice(2),nativeWireHash:native.slice(2),height,index:String(i),included:true,finalized:true,executionSuccessful:true,executionCode:'0',outcome:'succeeded',nativeGrant:false,block:{commitVerified:true,lightTransitionVerified:true,genesisSha256:expected.epochs[name],headerHeight:height},successor:{commitVerified:true,lightTransitionVerified:true,genesisSha256:expected.epochs[name],headerHeight:'101'}}};
   const raw=Buffer.from(JSON.stringify(v)+'\n');
   const identity={transactionType:'pq_transfer',nativeTransactionHash:native,abciTransactionHash:abci,executionHeight:height,cometIndex:i,readbackIndexMode:mode};
   return {nativeHash:native,abciHash:abci,height,index:i,offeredNs:String(10+i*10),proofVerifiedNs:String(150+i*30),verifierOutput:raw.toString('base64'),observation:{...identity,status:'committed_observed',readbackOnly:false,submissionAttempts:1,effectiveBusinessIncludedObserved:1,submissionToFirstCommittedRPCObservationNs:'60',firstCommittedRPCObservationSource:'post_response',firstCommittedRPCHeight:height,firstCommittedRPCIndex:i},confirmation:{...identity,readbackOnly:true,submissionAttempts:0,independentFinalityVerified:true,proofVerificationStatus:'verified_original_transaction',consensusExecutionOutcome:'succeeded',effectiveBusinessFinalized:1,finalizedBusinessHashes:[native],registrationFinalized:false,verifierProcessStarted:true,verifierInterrupted:false,verifierExitCode:0,proofVerifierSha256:expected.binaries.verifier,trustContextSha256:'5'.repeat(64),verifierEvidenceSha256:hash(raw)}};
  });
  const phaseRows=Array.from({length:4},(_,nodeIndex)=>[
   {arm:name,nodeIndex,height:'100',clockDomain:expected.clockDomain,phase:'finalize',startNs:String(50+nodeIndex*2),endNs:String(60+nodeIndex*2)},
   {arm:name,nodeIndex,height:'100',clockDomain:expected.clockDomain,phase:'commit',startNs:String(70+nodeIndex*2),endNs:String(100+nodeIndex*2),commitTiming:{height:100,storage:'atomic-json',durable:true,elapsedNs:20,payloadBytes:512,stagesNs:{validate:1,json_encode:4,write:2,file_sync:5,directory_sync:1}}}
  ]).flat();
  return {name,epochId:expected.epochs[name],readbackIndexMode:mode,measurementStartNs:'0',measurementEndNs:'200',business,phaseRows};
 });
 const data={schema:freshPhaseSchema,...Object.fromEntries(['protocolCommit','performanceClientCommit','clientSourceTree','clientCodeTree','vmBootId','clockDomain','binaries'].map(k=>[k,structuredClone(expected[k])])),arms};
 return {data,expected};
}
function cleanupScans(f){return f.data.version==='YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1'?[{elapsedMs:1000,hostIdentities:42},{elapsedMs:1051,hostIdentities:43}]:[[],[]];}
function read(f){const raw=Buffer.from(JSON.stringify(f.data));const guard={firstCause:null,child:{code:0,pid:f.expected.sameProcessPID},cleanupComplete:true,emptyOwnedScans:cleanupScans(f),sourceCommit:f.expected.protocolCommit,resultSHA256:hash(raw)};return readGuardedFreshPhasePair(raw,guard,f.expected);}

test('unit-only original per-H phases are not multiplied by transaction count; no authority or TPS qualification',()=>{
 const f=fixture(),r=read(f);
 assert.equal(r.classification,'measurement-data-not-authority');assert.equal(r.independentProofReverifiedHere,false);assert.equal(r.sustainedTPSQualified,false);assert.equal(r.executionAuthorized,false);assert.equal(r.earliestBFTFormationMeasured,false);
 assert.equal(r.arms[0].receiptQualifiedBusiness,2);assert.equal(r.arms[0].nodeBlocks[0].businessBlockCount,1);
 assert.deepEqual(r.arms[0].nodeBlocks[0].stagesNs.json_encode,{samples:1,p50Ns:'4',p95Ns:'4',p99Ns:'4'});
 assert.deepEqual(r.arms[0].latencyNs.independentProofCompletion,{samples:2,p50Ns:'140',p95Ns:'160',p99Ns:'160',missingSamples:0});
 assert.equal(r.arms[0].nodeBlocks[0].unattributedOuterCommitNs.p50Ns,'10');assert.equal(r.arms[0].measurementWindowNs,'200');
});
test('repeat readbacks retain original offer and effect identity without double counting',()=>{
 const f=fixture(),repeat=structuredClone(f.data.arms[0].business[0]);repeat.proofVerifiedNs='190';f.data.arms[0].business.push(repeat);
 const r=read(f);assert.equal(r.arms[0].receiptQualifiedBusiness,2);assert.equal(r.arms[0].repeatedReadbacks,1);assert.equal(r.arms[0].latencyNs.independentProofCompletion.p50Ns,'140');
 repeat.offeredNs='11';assert.throws(()=>read(f),/repeat readback changed/);
});
test('UNKNOWN original submission can reconcile independently; missing local RPC stage stays missing',()=>{
 const f=fixture(),o=f.data.arms[0].business[0].observation;o.status='submission_unknown';o.effectiveBusinessIncludedObserved=0;o.executionHeight='0';delete o.cometIndex;delete o.submissionToFirstCommittedRPCObservationNs;
 const r=read(f);assert.equal(r.arms[0].receiptQualifiedBusiness,2);assert.equal(r.arms[0].latencyNs.clientSubmissionToFirstCommittedRPC.samples,1);assert.equal(r.arms[0].latencyNs.clientSubmissionToFirstCommittedRPC.missingSamples,1);
});
test('receipt/data cannot replace original independent verifier output or a missing node Commit',()=>{
 for(const [name,mutate,error]of [
  ['no verifier',f=>delete f.data.arms[0].business[0].verifierOutput,/verifier output/],
  ['durable only',f=>f.data.arms[0].business[0].confirmation.independentFinalityVerified=false,/independent original/],
  ['birth as business',f=>f.data.arms[0].business[0].confirmation.registrationFinalized=true,/independent original/],
  ['readonly invented offer',f=>f.data.arms[0].business[0].confirmation.submissionToFirstCommittedRPCObservationNs='1',/independent original/],
  ['wrong receipt digest',f=>f.data.arms[0].business[0].confirmation.verifierEvidenceSha256='6'.repeat(64),/digest differs/],
  ['missing node',f=>f.data.arms[0].phaseRows.splice(7,1),/missing four-node/],
  ['overwritten H',f=>f.data.arms[0].phaseRows[1].commitTiming.height=101,/durable Commit/],
  ['memory only',f=>f.data.arms[0].phaseRows[1].commitTiming.durable=false,/durable Commit/],
  ['sum overlap',f=>f.data.arms[0].phaseRows[1].commitTiming.stagesNs.file_sync=100,/overlapping/],
  ['missing fsync',f=>delete f.data.arms[0].phaseRows[1].commitTiming.stagesNs.file_sync,/required original Commit/],
  ['duplicate H',f=>f.data.arms[0].phaseRows.push(structuredClone(f.data.arms[0].phaseRows[1])),/duplicate per-node/],
  ['mixed clock',f=>f.data.arms[0].phaseRows[0].clockDomain='other',/clock phase/],
  ['mixed binaries',f=>f.data.binaries.client='7'.repeat(64),/identity differs/],
  ['outside window',f=>f.data.arms[0].business[0].proofVerifiedNs='201',/outside original/],
 ]){const f=fixture();mutate(f);assert.throws(()=>read(f),error,name);}
});
test('normal guard, external bindings and exact raw digest remain mandatory',()=>{
 const f=fixture(),raw=Buffer.from(JSON.stringify(f.data)),g={firstCause:null,child:{code:0},cleanupComplete:true,emptyOwnedScans:[[],[]],sourceCommit:f.expected.protocolCommit,resultSHA256:hash(raw)};
 assert.throws(()=>readGuardedFreshPhasePair(raw,g),/external original/);
 for(const mutate of [g=>g.cleanupComplete=false,g=>g.child.code=1,g=>g.firstCause='original',g=>g.resultSHA256='8'.repeat(64),g=>g.emptyOwnedScans='xx',g=>g.emptyOwnedScans=[['still running'],[]]]){const changed=structuredClone(g);mutate(changed);assert.throws(()=>readGuardedFreshPhasePair(raw,changed,f.expected),/completed guard/);}
 assert.deepEqual(freshTimingQuantiles([]),{samples:0,p50Ns:null,p95Ns:null,p99Ns:null});
});

for(const makeFixture of [fixture,originalFixture])test('actual read-only CLI preserves source bytes, creates one synced output and refuses overwrite/symlink: '+makeFixture.name,()=>{
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pq-phase-cli-')));
 try{
  const f=makeFixture(),raw=Buffer.from(JSON.stringify(f.data)),guard={firstCause:null,child:{code:0,pid:f.expected.sameProcessPID},cleanupComplete:true,emptyOwnedScans:cleanupScans(f),sourceCommit:f.expected.protocolCommit,resultSHA256:hash(raw)};
  const files={result:raw,guard:Buffer.from(JSON.stringify(guard)),expected:Buffer.from(JSON.stringify(f.expected))};
  for(const [name,bytes]of Object.entries(files))fs.writeFileSync(path.join(parent,name+'.json'),bytes,{mode:0o600,flag:'wx'});
  const output=path.join(parent,'readback.json'),script=new URL('./pq-fresh-phase-readback.mjs',import.meta.url);
  const args=[fileURLToPath(script),'--result',path.join(parent,'result.json'),'--guard',path.join(parent,'guard.json'),'--expected',path.join(parent,'expected.json'),'--output',output];
  let result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
  const summary=fs.readFileSync(output);assert.equal(JSON.parse(summary).executionAuthorized,false);assert.equal(fs.statSync(output).mode&0o777,0o600);
  for(const [name,bytes]of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(parent,name+'.json')),bytes);
  result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});assert.equal(result.status,1);assert.deepEqual(fs.readFileSync(output),summary);
  const link=path.join(parent,'linked-result.json');fs.symlinkSync(path.join(parent,'result.json'),link);
  const linked=[...args];linked[2]=link;linked[8]=path.join(parent,'should-not-exist.json');
  result=spawnSync(process.execPath,linked,{encoding:'utf8',timeout:5000});assert.equal(result.status,1);assert.equal(fs.existsSync(linked[8]),false);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

function originalFixture(){
 const f=fixture(),old=structuredClone(f.data);
 f.expected.businessPerArm=16;f.expected.sameProcessPID=123;f.expected.clockDomain='pq-fresh:123';
 const roles=['consensus.test','ynx-bft-gatewayd','ynx-consensus-perf-client','ynx-consensus-proof-verify'];
 f.expected.verifierRole=roles[3];f.expected.binaries=Object.fromEntries(roles.map((k,i)=>[k,String(i+1).repeat(64)]));
 f.expected.sourceLeaves=Object.fromEntries(['pq_network_e2e_test.go','pq_network_business_test.go','pq_network_fresh_business_test.go'].map((k,i)=>['internal/consensus/'+k,String(i+5).repeat(64)]));
 const arms=old.arms.map((a,ai)=>({name:a.name,genesisSHA256:a.epochId,readbackIndexMode:a.readbackIndexMode,births:Array.from({length:17},()=>({registrationFinalized:true,finalizedBusinessMembers:0})),offeredBusiness:16,finalizedBusiness:16,offeredRatePerSecond:2,maximumInFlight:4,sustainedTPSQualified:false,businessStartNs:0,businessWindowNs:200,rows:Array.from({length:16},(_,i)=>{
  const b=structuredClone(a.business[0]),native=h(1000+ai*100+i),abci=h(2000+ai*100+i);
  for(const r of [b.observation,b.confirmation])Object.assign(r,{nativeTransactionHash:native,abciTransactionHash:abci,cometIndex:i,members:1,rejectedMembers:0,actualOfferToFinalityMeasured:false,sustainedTPSQualified:false});
  for(const r of [b.observation,b.confirmation]){
   r.clientPhases=Object.fromEntries(['inputPreparationNs','intentDurabilityNs','submissionHTTPNs','submissionValidationNs','originalReadbackHTTPNs','originalReadbackValidationNs','proofCollectionHTTPNs','collectorIdentityValidationNs','proofDurabilityNs'].map(k=>[k,'1']));
   for(const k of ['verifierPreparationNs','verifierProcessNs','verifierEvidenceDurabilityNs','verifierResultValidationNs'])r[k]=r.readbackOnly?'2':'0';
   r.proofVerificationNs=r.readbackOnly?'8':'0';
  }
  Object.assign(b.observation,{independentFinalityVerified:false,effectiveBusinessFinalized:0,firstCommittedRPCIndex:i});
  Object.assign(b.confirmation,{status:'committed_observed',effectiveBusinessIncludedObserved:1,originalReadbackAttempts:1,submissionToFirstCommittedRPCObservationNs:null,finalizedBusinessHashes:[native],proofVerifierSha256:f.expected.binaries[f.expected.verifierRole]});
  for(const k of ['verifierProcessStarted','verifierInterrupted','verifierExitCode','verifierEvidenceSha256'])delete b.confirmation[k];
  return {sender:'UNIT_ONLY_'+i,nativeHash:native,abciHash:abci,height:100,index:i,offerOffsetNs:10+i,observedCompletionNs:120,independentCompletionNs:160,offerToIndependentNs:150-i,submission:b.observation,readback:b.confirmation};
 })}));
 f.data={version:'YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1',syntheticOnly:true,protocolCommit:f.expected.protocolCommit,clientCommit:f.expected.performanceClientCommit,clientTree:f.expected.clientSourceTree,binaries:Object.fromEntries(roles.map(k=>[k,{path:'/UNIT_ONLY/'+k,sha256:f.expected.binaries[k],bytes:100,commit:k===roles[2]?f.expected.performanceClientCommit:f.expected.protocolCommit}])),sourceLeaves:structuredClone(f.expected.sourceLeaves),arms,phaseRows:old.arms.flatMap(a=>a.phaseRows.map(r=>({...r,startNs:Number(r.startNs),endNs:Number(r.endNs),clockDomain:f.expected.clockDomain}))),clockDomain:f.expected.clockDomain,sameVM:true,sameProcessPID:123,businessFinalized:32,birthsExcluded:34,sustainedTPSQualified:false,publicDeployment:false,nativeGrant:false};
 return f;
}
test('actual original Go projection consumes numeric phase coordinates without inventing raw verifier output',()=>{
 const f=originalFixture(),r=read(f);
 assert.equal(r.inputEvidence,'original-callee-projected-client-receipts');assert.equal(r.vmIdentityEvidence,'external-runner-binding-only');
 assert.equal(r.independentProofReverifiedHere,false);assert.equal(r.arms[0].receiptQualifiedBusiness,16);
 assert.equal(r.arms[0].nodeBlocks[0].stagesNs.json_encode.samples,1);
 assert.equal(r.arms[0].latencyNs.independentProofCompletion.p95Ns,'150');
 assert.deepEqual(r.arms[0].clientStagesNs.confirmation.verifierProcessNs,{samples:16,p50Ns:'2',p95Ns:'2',p99Ns:'2',notInvokedSamples:0});
 const o=f.data.arms[0].rows[0].submission;
 Object.assign(o,{status:'submission_unknown',initialSubmissionUnknown:true,effectiveBusinessIncludedObserved:0,submissionToFirstCommittedRPCObservationNs:null,firstCommittedRPCObservationSource:'',firstCommittedRPCHeight:'0',firstCommittedRPCIndex:null});
 assert.equal(read(f).arms[0].latencyNs.clientSubmissionToFirstCommittedRPC.missingSamples,1);
});
test('actual callee projection rejects wrong source, clock, numeric shape, counts and projected proof identity',()=>{
 for(const mutate of [
  f=>f.data.sourceLeaves['internal/consensus/pq_network_fresh_business_test.go']='9'.repeat(64),
  f=>f.data.sameProcessPID++,f=>f.data.phaseRows[0].startNs='50',f=>f.data.phaseRows[0].startNs=Number.MAX_SAFE_INTEGER,
  f=>f.data.binaries['ynx-consensus-perf-client'].commit=f.expected.protocolCommit,
  f=>f.data.arms[0].rows[0].offerToIndependentNs++,f=>f.data.businessFinalized++,
  f=>f.data.arms[0].births[0].finalizedBusinessMembers=1,
  f=>f.data.arms[0].rows[0].readback.independentFinalityVerified=false,
  f=>f.data.arms[0].rows[0].readback.finalizedBusinessHashes=[h(1)],
  f=>delete f.data.arms[0].rows[0].readback.clientPhases.proofDurabilityNs,
 ]){const f=originalFixture();mutate(f);assert.throws(()=>read(f));}
});

test('original completed controller cleanup records are consumed without rewriting the guard',()=>{
 const f=originalFixture(),raw=Buffer.from(JSON.stringify(f.data));
 const guard={firstCause:null,child:{code:0,pid:f.expected.sameProcessPID},cleanupComplete:true,emptyOwnedScans:[{elapsedMs:1000,hostIdentities:42},{elapsedMs:1051,hostIdentities:43}],sourceCommit:f.expected.protocolCommit,resultSHA256:hash(raw)};
 assert.equal(readGuardedFreshPhasePair(raw,guard,f.expected).arms[0].receiptQualifiedBusiness,16);
 assert.throws(()=>readGuardedFreshPhasePair(raw,{...guard,child:{code:0,pid:124}},f.expected),/guard child/);
 for(const scans of [[[],[]],[{elapsedMs:1000,hostIdentities:42}],[{elapsedMs:1000,hostIdentities:42},{elapsedMs:999,hostIdentities:43}],[{elapsedMs:1000,hostIdentities:42},{elapsedMs:120001,hostIdentities:43}]]){
  assert.throws(()=>readGuardedFreshPhasePair(raw,{...guard,emptyOwnedScans:scans},f.expected),/completed guard/);
 }
});

function originalLog(f){
 const name='TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming';
 return Buffer.from('=== RUN   '+name+'\n    pq_network_fresh_business_test.go:1089: PQ_NETWORK_FRESH_BUSINESS_SUMMARY '+JSON.stringify(f.data)+'\n--- PASS: '+name+' (12.34s)\nPASS\n');
}
function logGuard(f,raw){return {firstCause:null,child:{code:0,pid:f.expected.sameProcessPID},cleanupComplete:true,emptyOwnedScans:cleanupScans(f),sourceCommit:f.expected.protocolCommit,stdoutSHA256:hash(raw)};}
test('original stdout readback binds exact original log bytes and requires actual fresh test PASS',()=>{
 const f=originalFixture(),raw=originalLog(f),guard=logGuard(f,raw),saved=structuredClone(guard);
 const result=readGuardedFreshPhaseLog(raw,guard,f.expected);
 assert.equal(result.resultSource,'original-go-stdout');assert.equal(result.stdoutSHA256,hash(raw));
 assert.equal(result.rawResultSHA256,hash(Buffer.from(JSON.stringify(f.data))));
 assert.equal(result.arms[0].receiptQualifiedBusiness,16);assert.deepEqual(guard,saved);assert.equal(guard.resultSHA256,undefined);
 assert.throws(()=>readGuardedFreshPhaseLog(Buffer.concat([raw,Buffer.from('changed')]),guard,f.expected),/stdout digest/);
 for(const change of [
  s=>s.replace('--- PASS:','--- SKIP:'),s=>s.replace('--- PASS:','--- FAIL:'),
  s=>s.replace('=== RUN   TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming','=== RUN   OtherTest'),
  s=>s.replace('\nPASS\n','\n'),s=>s+s.split('\n')[1]+'\n',
  s=>s.replace('pq_network_fresh_business_test.go:1089:','other.go:1:'),
  s=>{const lines=s.trimEnd().split('\n');return [lines[0],lines[2],lines[1],lines[3]].join('\n')+'\n';},
  s=>s+'    --- SKIP: hidden-child (0.00s)\n',
 ]){const altered=Buffer.from(change(raw.toString()));assert.throws(()=>readGuardedFreshPhaseLog(altered,logGuard(f,altered),f.expected));}
 const incomplete={...guard,cleanupComplete:false};assert.throws(()=>readGuardedFreshPhaseLog(raw,incomplete,f.expected),/completed guard/);
});
test('actual stdout CLI emits one summary from original logs without synthesizing or changing a guard',()=>{
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pq-phase-log-cli-')));
 try{
  const f=originalFixture(),raw=originalLog(f),g=Buffer.from(JSON.stringify(logGuard(f,raw))),expected=Buffer.from(JSON.stringify(f.expected));
  for(const [name,bytes]of [['stdout',raw],['guard',g],['expected',expected]])fs.writeFileSync(path.join(parent,name),bytes,{flag:'wx',mode:0o600});
  const args=[fileURLToPath(new URL('./pq-fresh-phase-readback.mjs',import.meta.url)),'--stdout',path.join(parent,'stdout'),'--guard',path.join(parent,'guard'),'--expected',path.join(parent,'expected'),'--output',path.join(parent,'summary')];
  const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(parent,'summary'))).resultSource,'original-go-stdout');
  assert.deepEqual(fs.readFileSync(path.join(parent,'guard')),g);assert.deepEqual(fs.readFileSync(path.join(parent,'stdout')),raw);
  const mixed=[...args];mixed[3]='--result';const refused=spawnSync(process.execPath,mixed,{encoding:'utf8',timeout:5000});assert.equal(refused.status,1);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

test('paired phase quantile deltas preserve physical sample counts, missing stages and exact signed ratios',()=>{
 const f=fixture();
 for(const r of f.data.arms[1].phaseRows.filter(r=>r.phase==='commit')){r.commitTiming.stagesNs.json_encode=2;delete r.commitTiming.stagesNs.validate;}
 const r=read(f),c=r.pairedQuantileDeltas;
 assert.equal(c.causalImprovementProven,false);
 assert.deepEqual(c.nodeBlocks[0].stagesNs.json_encode.p95,{beforeNs:'4',afterNs:'2',deltaNs:'-2',relativePercent:{numerator:'-200',denominator:'4'}});
 assert.equal(c.nodeBlocks[0].stagesNs.json_encode.beforeSamples,1);
 assert.equal(c.nodeBlocks[0].stagesNs.validate.afterSamples,0);
 assert.equal(c.nodeBlocks[0].stagesNs.validate.p95.afterNs,null);
 assert.equal(c.nodeBlocks[0].stagesNs.validate.p95.deltaNs,null);
 assert.equal(c.nodeBlocks[0].stagesNs.validate.sampleCountsEqual,false);
 const z=fixture();z.data.arms[0].phaseRows[1].commitTiming.stagesNs.validate=0;
 assert.equal(read(z).pairedQuantileDeltas.nodeBlocks[0].stagesNs.validate.p50.relativePercent,null);
});
test('uninvoked submission verifiers are not zero-duration execution samples; overlapping timing is refused',()=>{
 const f=originalFixture(),r=read(f),stages=r.arms[0].clientStagesNs;
 assert.deepEqual(stages.observation.verifierProcessNs,{samples:0,p50Ns:null,p95Ns:null,p99Ns:null,notInvokedSamples:16});
 assert.equal(r.pairedQuantileDeltas.clientStagesNs.observation.verifierProcessNs.p50.deltaNs,null);
 f.data.arms[0].rows[0].readback.proofVerificationNs='7';assert.throws(()=>read(f),/verifier stages exceed/);
});
test('paired timing cannot compare different persistence profiles as the same condition',()=>{
 const f=fixture();
 for(const r of f.data.arms[1].phaseRows.filter(r=>r.phase==='commit'))r.commitTiming.storage='snapshot-journal-v1';
 assert.throws(()=>read(f),/paired storage profile differs/);
});

test('bounded original result gate refuses mixed tests, trailing diagnostics and over-limit public summaries',()=>{
 const f=originalFixture(),raw=originalLog(f);
 for(const change of [
  s=>'=== RUN   OtherTest\n--- PASS: OtherTest (0.01s)\n'+s,
  s=>s.replace('\nPASS\n','\n--- PASS: OtherTest (0.01s)\nPASS\n'),
  s=>s+'unqualified trailing diagnostic\n',s=>s+'\n',
  s=>'panic: recovered outside original result\n'+s,
  s=>'fatal error: outside original result\n'+s,
 ]){const altered=Buffer.from(change(raw.toString()));assert.throws(()=>readGuardedFreshPhaseLog(altered,logGuard(f,altered),f.expected),/sole RUN\/PASS/);}
 const noFinalNewline=raw.subarray(0,raw.length-1);
 assert.equal(readGuardedFreshPhaseLog(noFinalNewline,logGuard(f,noFinalNewline),f.expected).arms[0].receiptQualifiedBusiness,16);
 f.data.extraUnqualifiedPadding='x'.repeat(256<<10);
 assert.throws(()=>read(f),/summary exceeds 256 KiB/);
 const padded=originalLog(f);assert.throws(()=>readGuardedFreshPhaseLog(padded,logGuard(f,padded),f.expected),/summary exceeds 256 KiB/);
});

test('business flow integrates original backlog exactly and never invents a distinct acceptance rate',()=>{
 const f=originalFixture(),flow=read(f).arms[0].flow;
 assert.equal(flow.acceptedThroughput,null);assert.equal(flow.distinctAcceptanceTimeMeasured,false);
 assert.deepEqual(flow.buckets[0].counts,{offered:16,firstNodeExecutionCompleted:16,firstNodeDurable:16,allNodesDurable:16,independentProofCompleted:16});
 assert.deepEqual(flow.backlog.offeredAwaitingFirstDurable,{peak:16,atEnd:0,timeWeightedMean:{numeratorCountNs:'1320',denominatorNs:'200'}});
 assert.deepEqual(flow.backlog.firstDurableAwaitingIndependentProof,{peak:16,atEnd:0,timeWeightedMean:{numeratorCountNs:'960',denominatorNs:'200'}});
 assert.equal(flow.offerLatenessNs.missingSamples,16);
 assert.equal(flow.buckets[0].observedRates.offered.denominatorNs,'200');
 const legacy=fixture();legacy.data.arms[0].business.push(structuredClone(legacy.data.arms[0].business[0]));
 assert.equal(read(legacy).arms[0].flow.buckets[0].counts.offered,2);
});
test('flow uses left-inclusive second buckets, includes final proof endpoint and retains reconciled UNKNOWN',()=>{
 const f=originalFixture(),scale=10000000;
 for(const a of f.data.arms){
  a.businessWindowNs*=scale;
  for(const r of a.rows){for(const key of ['offerOffsetNs','observedCompletionNs','independentCompletionNs','offerToIndependentNs'])r[key]*=scale;r.offerLatenessNs=0;}
 }
 for(const r of f.data.phaseRows){r.startNs*=scale;r.endNs*=scale;if(r.commitTiming){r.commitTiming.elapsedNs*=scale;for(const k of Object.keys(r.commitTiming.stagesNs))r.commitTiming.stagesNs[k]*=scale;}}
 const last=f.data.arms[0].rows[15];last.independentCompletionNs=200*scale;last.offerToIndependentNs=last.independentCompletionNs-last.offerOffsetNs;
 const o=f.data.arms[0].rows[0].submission;Object.assign(o,{status:'submission_unknown',initialSubmissionUnknown:true,effectiveBusinessIncludedObserved:0,submissionToFirstCommittedRPCObservationNs:null,firstCommittedRPCObservationSource:'',firstCommittedRPCHeight:'0',firstCommittedRPCIndex:null});
 const flow=read(f).arms[0].flow;
 assert.equal(flow.buckets.length,2);assert.equal(flow.buckets[0].counts.offered,16);assert.equal(flow.buckets[0].counts.firstNodeDurable,0);
 assert.equal(flow.buckets[1].counts.firstNodeDurable,16);assert.equal(flow.buckets[1].counts.independentProofCompleted,16);
 assert.equal(flow.buckets[1].backlogAtEnd.offeredAwaitingFirstDurable,0);assert.equal(flow.buckets[1].backlogAtEnd.firstDurableAwaitingIndependentProof,0);
 assert.equal(flow.initialSubmissionUnknown,1);assert.deepEqual(flow.submissionUnknownFraction,{numerator:1,denominator:16});assert.equal(flow.independentlyReconciledUnknownSubmissions,1);assert.equal(flow.offerLatenessNs.samples,16);
});

test('all-node durability keeps a late replica distinct from proof completion and window throughput',()=>{
 for(const end of [200,205]){
  const f=originalFixture();
  for(const phase of f.data.phaseRows)if(phase.nodeIndex===3&&phase.phase==='commit')phase.endNs=end;
  const result=read(f),flow=result.arms[0].flow;
  assert.equal(flow.buckets[0].counts.independentProofCompleted,16);
  assert.equal(flow.buckets[0].counts.allNodesDurable,end===200?16:0);
  assert.deepEqual(flow.afterWindowEvents,{allNodesDurable:end===200?0:16});
  assert.deepEqual(flow.backlog.offeredAwaitingAllNodesDurable,{peak:16,atEnd:end===200?0:16,timeWeightedMean:{numeratorCountNs:'2920',denominatorNs:'200'}});
  assert.equal(flow.buckets[0].backlogAtEnd.offeredAwaitingAllNodesDurable,end===200?0:16);
  assert.equal(result.arms[0].latencyNs.allNodesDurable.samples,16);
  assert.equal(result.earliestBFTFormationMeasured,false);
 }
});

test('original progress spans retain nested inclusive timing without inventing additive wall time',()=>{
 const f=originalFixture(),line=(arm,phase,event,offset,duration)=>`    pq_network_fresh_business_test.go:415: PQ_NETWORK_FRESH_PROGRESS arm=${arm} phase=${phase} node=0 index=-1 event=${event} offsetNs=${offset} durationNs=${duration}\n`;
 const events=line('before','observed-pq-construction','begin',10,0)+line('before','initial-validator-custody','begin',20,0)+line('before','initial-validator-custody','complete',30,10)+line('before','observed-pq-construction','complete',80,70)+line('after','observed-pq-construction','begin',100,0)+line('after','observed-pq-construction','complete',180,80);
 const withEvents=s=>Buffer.from(originalLog(f).toString().replace(/(=== RUN[^\n]*\n)/,'$1'+s));
 const raw=withEvents(events),result=readGuardedFreshPhaseLog(raw,logGuard(f,raw),f.expected);
 assert.equal(result.progressStages.spans.length,3);assert.equal(result.progressStages.additiveWallTimeMeasured,false);
 const construction=result.progressStages.groups.find(g=>g.arm==='before'&&g.phase==='observed-pq-construction');
 assert.equal(construction.durationNs.p50Ns,'70');assert.equal(construction.durationNs.samples,1);
 assert.equal(readGuardedFreshPhaseLog(originalLog(f),logGuard(f,originalLog(f)),f.expected).progressStages,null);
 for(const change of [s=>s.replace('durationNs=70','durationNs=71'),s=>s.replace('event=begin offsetNs=10','event=complete offsetNs=10'),s=>s.replace('offsetNs=180','offsetNs=120000000001'),s=>s.replace('phase=initial-validator-custody','phase=observed-pq-construction'),s=>s.replace(line('after','observed-pq-construction','complete',180,80),'')]){
  const bad=withEvents(change(events));assert.throws(()=>readGuardedFreshPhaseLog(bad,logGuard(f,bad),f.expected),/progress/);
 }
});
