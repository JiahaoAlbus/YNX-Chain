import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freshPhaseSchema,readGuardedFreshPhasePair,readGuardedFreshPhaseLog,freshTimingQuantiles,readFreshPhaseDiagnostics,freshValidationPhases} from './pq-fresh-phase-readback.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const h=n=>'0x'+n.toString(16).padStart(64,'0');

function diagnosticFixture(){
 const sourceLeaves=Object.fromEntries(['pq_network_e2e_test.go','pq_network_business_test.go','pq_network_fresh_business_test.go'].map((k,i)=>['internal/consensus/'+k,String(i+1).repeat(64)]));
 const expected={protocolCommit:'a'.repeat(40),sameProcessPID:123,clockDomain:'pq-fresh:123',sourceLeaves,consensusBinarySHA256:'b'.repeat(64),validationPhaseMapping:[...freshValidationPhases]};
 const guard={sourceCommit:expected.protocolCommit,child:{pid:123,code:-15},sourcePins:Object.fromEntries(Object.entries(sourceLeaves).map(([k,v])=>[k,{sha256:v}])),binaryPin:{sha256:expected.consensusBinarySHA256},firstCause:'105s active deadline',cleanupComplete:true,emptyOwnedScans:[{elapsedMs:105001,hostIdentities:3},{elapsedMs:105201,hostIdentities:3}]};
 const records=[];
 for(let n=0;n<4;n++){
  records.push(['PQ_NETWORK_FRESH_COMMIT_OBSERVATION',{classification:'local-persistence-observation',arm:'before',nodeIndex:n,pid:123,clockDomain:expected.clockDomain,height:'1',finalizeStartNs:100,finalizeEndNs:110,finalizeOK:true,commitStartNs:110,commitEndNs:170,commitCallNs:60,commitOK:true,timingAvailable:true,commitTiming:{height:1,storage:'atomic-json',durable:true,elapsedNs:50,stagesNs:{validate:40,json_encode:1,write:1,file_sync:1,directory_sync:1}}}]);
  records.push(['PQ_VALIDATE',{a:'before',n,h:'1',f:-1,p:Array(34).fill(1),d:0,x:1}]);
 }
 records.push(['PQ_FRESH_TX',{kind:'validated-readback',arm:'before',nativeHash:'c'.repeat(64),abciHash:'d'.repeat(64),height:'1',index:0,offerOffsetNs:90,independentCompletionNs:200,offerToIndependentNs:110,firstRPCNs:'2',firstRPCClock:'client-duration',clockDomain:expected.clockDomain}]);
 return {expected,guard,records};
}
function diagnosticRead(f){
 const stdout=diagnosticStdout(f);
 return readFreshPhaseDiagnostics(stdout,f.guard,{...f.expected,stdoutSHA256:hash(stdout)});
}
function diagnosticStdout(f){return Buffer.from('=== RUN   TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming\n'+(f.progress??'')+f.records.map(([tag,x])=>tag+' '+JSON.stringify(x)).join('\n')+'\n');}
test('failed original window diagnostics retain observed phases/transactions without qualifying the pair',()=>{
 const r=diagnosticRead(diagnosticFixture());
 assert.equal(r.fullPairQualified,false);assert.equal(r.sustainedTPSQualified,false);assert.equal(r.independentProofReverifiedHere,false);
 assert.equal(r.firstCause,'105s active deadline');assert.equal(r.arms[0].physicalCommitObservations,4);assert.equal(r.arms[0].validatedCallbackObservations,1);
 assert.equal(r.transactions[0].firstNodeFinalizeNs,'20');assert.equal(r.transactions[0].allNodesDurableNs,'80');
 assert.equal(r.arms[0].outerCommitNs.p50Ns,'60');assert.equal(r.arms[0].persistenceStagesNs.json_encode.samples,4);assert.equal(r.arms[0].hashChildNs.encodeDigest.p50Ns,'1');
 assert.equal(r.arms[0].phases[33].durationNs.samples,4);assert.deepEqual(r.arms[0].phases[33].summedTimerShare,{numeratorNs:'4',denominatorNs:'136'});
 assert.equal(r.arms[1].latencyNs.allNodesDurableNs.p50Ns,null);
});
test('diagnostic missing replica and failed validation suffix remain unmeasured',()=>{
 const f=diagnosticFixture();f.records=f.records.filter(([tag,x])=>tag==='PQ_FRESH_TX'||(x.nodeIndex??x.n)!==3);
 const validation=f.records.find(([tag])=>tag==='PQ_VALIDATE')[1],commit=f.records[0][1];
 validation.f=4;validation.p=validation.p.map((_,i)=>i<=4?1:0);validation.x=0;commit.commitOK=false;commit.commitTiming.durable=false;delete commit.commitTiming.stagesNs.validate;
 const r=diagnosticRead(f);assert.equal(r.transactions[0].observedDurableNodes,2);assert.equal(r.transactions[0].allNodesDurableNs,null);
 assert.equal(r.arms[0].latencyNs.allNodesDurableNs.samples,0);assert.equal(r.arms[0].latencyNs.allNodesDurableNs.missingSamples,1);
 assert.equal(r.arms[0].phases[4].durationNs.samples,3);assert.equal(r.arms[0].phases[5].durationNs.samples,2);
});
function proposalFixture(){
 const f=diagnosticFixture();f.expected.inclusionObservationRequired=true;
 f.records.push(['PQ_FRESH_INCLUSION',{a:'before',c:f.expected.clockDomain,t:'d'.repeat(64),h:'1',i:0,b:'e'.repeat(64),p:[[92,94],[93,95],null,null]}]);return f;
}
test('accepted final-block proposal receipt stays distinct from execution and missing replicas',()=>{
 const r=diagnosticRead(proposalFixture());assert.equal(r.transactions[0].finalBlockHash,'e'.repeat(64));
 assert.equal(r.transactions[0].firstNodeProposalReceiptNs,'2');assert.equal(r.transactions[0].firstNodeProposalAcceptedNs,'4');assert.equal(r.transactions[0].firstNodeFinalizeNs,'20');
 assert.deepEqual(r.transactions[0].acceptedProposalNodeObservations,[[92,94],[93,95],null,null]);assert.equal(r.sustainedTPSQualified,false);
 const old=diagnosticRead(diagnosticFixture());assert.equal(old.transactions[0].firstNodeProposalReceiptNs,null);assert.equal(old.arms[0].latencyNs.firstNodeProposalReceiptNs.samples,0);assert.equal(old.arms[0].latencyNs.firstNodeProposalReceiptNs.missingSamples,1);
});
test('proposal callbacks reject changed coordinates, clocks, missing required lines and non-durable joins',()=>{
 for(const mutate of [
  f=>f.records.pop(),f=>f.records.unshift(f.records.pop()),f=>f.records.push(structuredClone(f.records.at(-1))),
  f=>f.records.at(-1)[1].a='after',f=>f.records.at(-1)[1].h='2',f=>f.records.at(-1)[1].i=1,f=>f.records.at(-1)[1].t='f'.repeat(64),
  f=>f.records.at(-1)[1].c='pq-fresh:124',f=>f.records.at(-1)[1].b='0'.repeat(64),
  f=>f.records.at(-1)[1].p[0]=[89,94],f=>f.records.at(-1)[1].p[0]=[92,101],f=>f.records.at(-1)[1].p[0]=[94,92],
  f=>f.records.at(-1)[1].p[0]=['92',94],f=>f.records.at(-1)[1].p[0]=[92,94,95],f=>f.records.at(-1)[1].p.push(null),
  f=>f.records[0][1].commitOK=false,
 ]){const f=proposalFixture();mutate(f);assert.throws(()=>diagnosticRead(f));}
 const f=proposalFixture();f.records.at(-1)[1].p=[null,null,null,null];const r=diagnosticRead(f);assert.equal(r.transactions[0].firstNodeProposalReceiptNs,null);
});
test('coordinator call work separates actual accumulated calls, reuse and unpublished physical samples',()=>{
 const f=proposalFixture();f.expected.inclusionWorkTimingsRequired=true;f.records.at(-1)[1].w=[2,4,0,0,8];
 const r=diagnosticRead(f);assert.equal(r.arms[0].coordinatorCalls.inclusionProbe.observedCalls,'2');assert.equal(r.arms[0].coordinatorCalls.inclusionProbe.perCallbackAccumulatedNs.p50Ns,'4');
 assert.equal(r.arms[0].coordinatorCalls.fullCommitCheck.perCallbackAccumulatedNs.samples,0);assert.equal(r.arms[0].coordinatorCalls.fullCommitCheck.notInvokedCallbacks,1);assert.equal(r.arms[0].coordinatorCalls.hostContext.perCallbackAccumulatedNs.p50Ns,'8');
 for(const work of [undefined,[0,4,0,0,8],[1,4,0,1,8],[1,100,1,100,8],[1,-1,0,0,8],[1,2]]){const bad=proposalFixture();bad.expected.inclusionWorkTimingsRequired=true;bad.records.at(-1)[1].w=work;assert.throws(()=>diagnosticRead(bad));}
 const partial=proposalFixture();partial.records=partial.records.filter(([tag,x])=>!(tag==='PQ_NETWORK_FRESH_COMMIT_OBSERVATION'&&x.nodeIndex===0||tag==='PQ_VALIDATE'&&x.n===0));
 const p=diagnosticRead(partial);assert.equal(p.transactions[0].unboundProposalNodes,1);assert.equal(p.transactions[0].firstNodeProposalReceiptNs,'3');assert.equal(p.transactions[0].allNodesDurableNs,null);assert.equal(p.fullPairQualified,false);
 const old=diagnosticRead(diagnosticFixture());assert.equal(old.arms[0].coordinatorCalls.hostContext.perCallbackAccumulatedNs.samples,0);assert.equal(old.arms[0].coordinatorCalls.hostContext.missingCallbacks,1);
});
test('diagnostic source, partitions, clocks, duplicate physical samples and callbacks fail closed',()=>{
 for(const mutate of [
  f=>f.guard.child.pid++,f=>f.guard.cleanupComplete=false,f=>f.guard.emptyOwnedScans=[],
  f=>f.expected.sourceLeaves['internal/consensus/pq_network_fresh_business_test.go']='9'.repeat(64),
  f=>f.expected.validationPhaseMapping.reverse(),f=>f.guard.binaryPin.sha256='9'.repeat(64),
  f=>f.records.push(structuredClone(f.records[0])),f=>f.records.push(structuredClone(f.records[1])),f=>f.records.push(structuredClone(f.records.at(-1))),
  f=>f.records[1][1].p[0]=41,f=>f.records[1][1].x=2,
  f=>{f.records[1][1].f=2;},f=>{f.records[1][1].f=33;},
  f=>f.records.at(-1)[1].offerToIndependentNs++,f=>f.records.at(-1)[1].clockDomain='client-duration',
  f=>f.records.at(-1)[1].firstRPCNs=2,f=>f.records.at(-1)[1].offerOffsetNs=101,
  f=>f.records[0][1].commitTiming.stagesNs.not_source_phase=1,
 ]){const f=diagnosticFixture();mutate(f);assert.throws(()=>diagnosticRead(f));}
 const f=diagnosticFixture();assert.throws(()=>readFreshPhaseDiagnostics(Buffer.from('changed'),f.guard,{...f.expected,stdoutSHA256:'1'.repeat(64)}),/digest/);
 const afterTerminal=Buffer.from(diagnosticStdout(f).toString().replace('\n','\nPASS\n'));
 assert.throws(()=>readFreshPhaseDiagnostics(afterTerminal,f.guard,{...f.expected,stdoutSHA256:hash(afterTerminal)}),/terminal order/);
});
test('explicit diagnostic CLI reads the unchanged failed guard; successful-pair entry still refuses it',()=>{
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pq-diagnostic-cli-')));
 try{
  const f=diagnosticFixture(),stdout=diagnosticStdout(f),expected={...f.expected,stdoutSHA256:hash(stdout)},guard=Buffer.from(JSON.stringify(f.guard));
  for(const [name,bytes]of Object.entries({stdout,guard,expected:Buffer.from(JSON.stringify(expected))}))fs.writeFileSync(path.join(parent,name),bytes,{mode:0o600,flag:'wx'});
  const script=fileURLToPath(new URL('./pq-fresh-phase-readback.mjs',import.meta.url)),out=path.join(parent,'diagnostic.json');
  const args=[script,'--diagnostic-stdout',path.join(parent,'stdout'),'--guard',path.join(parent,'guard'),'--expected',path.join(parent,'expected'),'--output',out];
  let r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(out)).fullPairQualified,false);assert.equal(fs.statSync(out).mode&0o777,0o600);
  r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});assert.notEqual(r.status,0);assert.match(r.stderr,/EEXIST/);
  assert.deepEqual(fs.readFileSync(path.join(parent,'guard')),guard);assert.deepEqual(fs.readFileSync(path.join(parent,'stdout')),stdout);
  assert.throws(()=>readGuardedFreshPhaseLog(stdout,{...f.guard,stdoutSHA256:hash(stdout)},expected),/sole RUN\/PASS/);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

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
test('original guard stays unchanged when stdout pin is external and boot identity was never measured',()=>{
 const f=originalFixture();f.expected.vmBootId=null;const raw=originalLog(f),guard=logGuard(f,raw);delete guard.stdoutSHA256;
 f.expected.stdoutSHA256=hash(raw);const saved=structuredClone(guard),result=readGuardedFreshPhaseLog(raw,guard,f.expected);
 assert.equal(result.vmBootId,null);assert.equal(result.vmIdentityEvidence,'boot-id-unmeasured; original-callee-process-binding');assert.equal(result.arms[0].receiptQualifiedBusiness,16);assert.deepEqual(guard,saved);
 assert.throws(()=>readGuardedFreshPhaseLog(raw,{...guard,stdoutSHA256:'1'.repeat(64)},f.expected),/digest/);
 assert.throws(()=>readGuardedFreshPhaseLog(raw,guard,{...f.expected,stdoutSHA256:'1'.repeat(64)}),/digest/);
 assert.throws(()=>readGuardedFreshPhaseLog(raw,guard,{...f.expected,stdoutSHA256:undefined}),/digest/);
 assert.throws(()=>readGuardedFreshPhaseLog(raw,{...guard,firstCause:'original failed',child:{code:-15,pid:123}},f.expected),/completed guard/);
 assert.throws(()=>readGuardedFreshPhaseLog(raw,guard,{...f.expected,vmBootId:undefined}),/external original/);
 const direct=fixture();direct.expected.vmBootId=direct.data.vmBootId=null;assert.throws(()=>read(direct),/external original/);
 const bytes=Buffer.from(JSON.stringify(f.data));f.expected.resultSHA256=hash(bytes);assert.equal(readGuardedFreshPhasePair(bytes,guard,f.expected).vmBootId,null);
 assert.throws(()=>readGuardedFreshPhasePair(bytes,{...guard,resultSHA256:'1'.repeat(64)},f.expected),/completed guard/);
});
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

function hostProgress(arm,index,phase,event,offset,duration,values){return `    pq_network_fresh_business_test.go:1550: PQ_NETWORK_FRESH_PROGRESS arm=${arm} phase=${phase} node=-1 index=${index} event=${event} offsetNs=${offset} durationNs=${duration}${values===undefined?'':' hostNs='+JSON.stringify(values)}\n`;}
function hostDiagnosticFixture(){
 const f=proposalFixture();f.expected.inclusionWorkTimingsRequired=true;f.expected.hostPreparationTimingsRequired=true;f.records.at(-1)[1].w=[2,4,0,0,12];
 f.progress=hostProgress('before',0,'business-offer','begin',89,0)+hostProgress('before',0,'business-offer','complete',95,6)+hostProgress('before',0,'business-host-context','begin',171,0)+hostProgress('before',0,'business-host-context','complete',190,19,[10,1,1,1,1,1,1,1,1,1]);return f;
}
test('Host wall coverage preserves exact residuals without attributing them to queue or CPU',()=>{
 const f=hostDiagnosticFixture();
 // A completed preparation without a verified callback is diagnostic DATA too.
 f.progress+=hostProgress('after',0,'business-host-context','begin',195,0)+hostProgress('after',0,'business-host-context','complete',199,4,[3,0,0,0,0,0,0,0,0,0]);
 f.progress+=hostProgress('after',1,'business-host-context','begin',200,0);
 const r=diagnosticRead(f),w=r.hostPreparationStages.wallCoverage;
 assert.deepEqual(w.observations.map(s=>[s.arm,s.progressSpanNs,s.helperTotalNs,s.helperChildrenNs,s.outsideHelperWallNs,s.insideHelperUnattributedWallNs]),[['before','19','10','9','9','1'],['after','4','3','0','1','3']]);
 assert.equal(w.arms[0].outsideHelperWallNs.p95Ns,'9');assert.equal(w.arms[1].insideHelperUnattributedWallNs.p50Ns,'3');
 assert.equal(w.arms[1].completedPreparations,1);assert.equal(r.transactions.length,1);assert.equal(r.fullPairQualified,false);assert.equal(r.sustainedTPSQualified,false);
 assert.match(w.interpretation,/not a direct queue-wait measurement/);assert.match(w.interpretation,/quantiles must not be subtracted/);
});
test('missing legacy Host timers never invent residual samples and measured zero stays zero',()=>{
 const legacy=hostDiagnosticFixture();legacy.expected.hostPreparationTimingsRequired=false;legacy.progress=legacy.progress.replace(' hostNs=[10,1,1,1,1,1,1,1,1,1]','');
 const missing=diagnosticRead(legacy).hostPreparationStages.wallCoverage;assert.deepEqual(missing.observations,[]);assert.equal(missing.arms[0].outsideHelperWallNs.samples,0);assert.equal(missing.arms[0].outsideHelperWallNs.p50Ns,null);
 const zero=hostDiagnosticFixture();zero.progress=zero.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[19,19,0,0,0,0,0,0,0,0]');zero.records.at(-1)[1].w=[2,4,0,0,19];
 const measured=diagnosticRead(zero).hostPreparationStages.wallCoverage.arms[0];assert.equal(measured.outsideHelperWallNs.samples,1);assert.equal(measured.outsideHelperWallNs.p50Ns,'0');assert.equal(measured.insideHelperUnattributedWallNs.p99Ns,'0');
});
test('all ten actual Host helper wall stages survive failed-window diagnostics without proof credit',()=>{
 const r=diagnosticRead(hostDiagnosticFixture()),h=r.hostPreparationStages;
 assert.equal(h.observations.length,1);assert.equal(h.childrenAreIncludedInTotal,true);assert.equal(h.arms[0].phases.totalWallNs.p50Ns,'10');
 assert.equal(h.arms[0].phases.checkpointValidateWallNs.p50Ns,'1');assert.equal(h.arms[0].phases.checkpointRetryWaitNs.p50Ns,'1');assert.equal(h.arms[1].phases.totalWallNs.p50Ns,null);
 assert.equal(r.fullPairQualified,false);assert.equal(r.sustainedTPSQualified,false);assert.equal(h.independentProofReverifiedHere,false);
 const noRetry=hostDiagnosticFixture();noRetry.progress=noRetry.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[10,1,1,1,1,1,1,0,1,1]');const retry=diagnosticRead(noRetry).hostPreparationStages.arms[0].phases.checkpointRetryWaitNs;assert.equal(retry.samples,0);assert.equal(retry.p50Ns,null);assert.equal(retry.notInvokedSamples,1);
 const partial=hostDiagnosticFixture();partial.progress+=hostProgress('after',0,'business-host-context','begin',195,0);const p=diagnosticRead(partial);
 assert.equal(p.progressStages.unfinished.length,1);assert.equal(p.hostPreparationStages.unfinished.length,1);assert.equal(p.hostPreparationStages.arms[1].completedPreparations,0);
});
test('Host stage source requirement rejects missing, foreign, reordered, excessive and mixed-clock data',()=>{
 for(const mutate of [
  f=>f.progress='',f=>f.progress=f.progress.replace(/ hostNs=\[[^\n]+/,' '),f=>f.progress=f.progress.replace('event=complete offsetNs=190','event=begin offsetNs=190'),
  f=>f.progress=f.progress.replace('phase=business-host-context','phase=business-offer'),
  f=>f.progress=f.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[10,2,2,2,2,2,2,2,2,2]'),
  f=>f.progress=f.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[20,1,1,1,1,1,1,1,1,1]'),
  f=>f.progress=f.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[10,1,1,1,1,1,1,1,1]'),
  f=>f.progress=f.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[10,1,1,1,1,1,1,1,1,"1"]'),
  f=>f.progress=f.progress.replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=[10,-1,1,1,1,1,1,1,1,1]'),
  f=>f.progress=f.progress.replace('offsetNs=190 durationNs=19','offsetNs=201 durationNs=30'),
  f=>f.records.at(-1)[1].w=[2,4,0,0,9],
  f=>f.progress=f.progress.replaceAll('index=0','index=1').replace('index=1 event=begin offsetNs=89','index=0 event=begin offsetNs=89').replace('index=1 event=complete offsetNs=95','index=0 event=complete offsetNs=95'),
 ]){const f=hostDiagnosticFixture();mutate(f);assert.throws(()=>diagnosticRead(f));}
});
test('successful source-bound stdout requires one complete Host timing per original row when requested',()=>{
 const f=originalFixture();f.expected.hostPreparationTimingsRequired=true;
 const events=f.data.arms.flatMap(arm=>arm.rows.map((row,i)=>hostProgress(arm.name,i,'business-host-context','begin',40,0)+hostProgress(arm.name,i,'business-host-context','complete',60,20,[10,1,1,1,1,1,1,1,1,1]))).join('');
 const raw=Buffer.from(originalLog(f).toString().replace(/(=== RUN[^\n]*\n)/,'$1'+events)),r=readGuardedFreshPhaseLog(raw,logGuard(f,raw),f.expected);
 assert.equal(r.hostPreparationStages.observations.length,32);assert.equal(r.hostPreparationStages.arms[1].completedPreparations,16);assert.equal(r.sustainedTPSQualified,false);
 const missing=Buffer.from(raw.toString().replace(' hostNs=[10,1,1,1,1,1,1,1,1,1]',''));assert.throws(()=>readGuardedFreshPhaseLog(missing,logGuard(f,missing),f.expected),/Host/);
 const overflow=Buffer.from(raw.toString().replace('hostNs=[10,1,1,1,1,1,1,1,1,1]','hostNs=['+'0,'.repeat(240)+'0]'));assert.throws(()=>readGuardedFreshPhaseLog(overflow,logGuard(f,overflow),f.expected),/progress|Host/);
});
