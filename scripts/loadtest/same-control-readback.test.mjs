import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {qualifySameControlReadback,compareSameControlReadbacks,measureFinalCohort,measureOriginalFinalCohort} from './same-control-readback.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Deliberately unsigned format fixtures: these test refusal/binding, never crypto.
function fixture(){
 const manifestRaw=Buffer.from(JSON.stringify({chainId:'ynx_6423-1',genesisHash:'genesis',migrationStateHash:'migration'}));
 const transactions=[],journal=[JSON.stringify({kind:'YNX_LOCAL_READY_SENDER_V1',manifestSha256:hash(manifestRaw),migrationHash:'migration',genesisHash:'genesis'})];
 for(let index=0;index<2;index++){
  const bytes=Buffer.from(JSON.stringify({version:1,chainId:6423,type:'transfer',from:'from',to:'to',publicKey:'fixture',signature:'00',nonce:index+1,amount:1,fee:1})),h=hash(bytes).toUpperCase();
  journal.push(JSON.stringify({index,sender:0,round:index+1,hash:h,transaction:bytes.toString('base64')}));
  transactions.push({index,round:index+1,hash:h,signedTransaction:bytes.toString('base64'),height:index+1,executionCode:0,quorumVerified:true,transactionProofVerified:true,durableStateVerified:true,durableStateHeight:index+1,durableSnapshotSha256:'fixture',durableStoreFormat:'block-journal',durableInfoVerified:true,durableInfoHeight:index+1,blockHash:'block'+index,blockTxIndex:0,blockTxTotal:1,inclusionMs:10+index,confirmationMs:20+index,queueDelayMs:2,status:'confirmed',confirmedObservedAt:'fixture',checkTxIdentityVerified:true,checkTxCode:0});
 }
 return {manifestRaw,journalRaw:Buffer.from(journal.join('\n')+'\n'),receipt:{firstCause:null,allGroupsGone:true,processes:[{exited:true,groupGone:true}],count:1,rounds:2,senderMode:'ready-pool',inclusionMode:'block-scan'},report:{chainId:'ynx_6423-1',genesisSha256:'genesis',roundsRequested:2,roundsCompleted:2,setupErrors:[],transactions,summary:{input:2,effectiveBusinessIncluded:2,finalSubmitted:2,measurementWindowSeconds:1,finalSubmittedPerMeasurementSecond:2}}};
}
test('complete byte identities qualify only report-level counts with independent proof unknown',()=>{const r=qualifySameControlReadback(fixture());assert.equal(r.qualifiedClientFinal,2);assert.equal(r.independentBFTReverification,null);assert.equal(r.steadyStateTPS,null);assert.equal(r.offerToClientFinalMs.p95,23);});
test('duplicate, mismatched, incomplete and late-publication evidence cannot inflate finals',()=>{
 const mutations=[x=>x.report.transactions[1]=x.report.transactions[0],x=>x.report.transactions[0].signedTransaction=x.report.transactions[1].signedTransaction,x=>x.report.transactions[0].checkTxIdentityVerified=false,x=>x.report.transactions[0].executionCode=1,x=>x.report.transactions[0].quorumVerified=false,x=>x.report.transactions[0].durableInfoHeight=0,x=>x.report.transactions[0].durableSnapshotSha256='',x=>x.report.transactions[0].confirmationMs=NaN,x=>x.report.transactions[0].queueDelayMs=-1,x=>x.journalRaw=x.journalRaw.subarray(0,-1),x=>x.manifestRaw=Buffer.from('{}'),x=>x.receipt.allGroupsGone=false];
 for(const mutate of mutations){const x=fixture();mutate(x);assert.throws(()=>qualifySameControlReadback(x));}
});

test('comparison refuses changed workload controls and incomplete business windows',()=>{
 const before=qualifySameControlReadback(fixture()),after=structuredClone(before);
 after.fullWindowClientFinalTPS=3;
 assert.equal(compareSameControlReadbacks(before,after).fullWindowRateChangePercent,50);
 after.controls.offeredRate=1000;
 assert.throws(()=>compareSameControlReadbacks(before,after),/controls differ/);
 after.controls=before.controls;after.qualifiedClientFinal=1;
 assert.throws(()=>compareSameControlReadbacks(before,after),/complete business windows/);
});

test('baseline proof binding refuses another observation, changed bytes or incomplete actual verifier',async()=>{
 const {bindBaselineStoppedProof}=await import('./same-control-readback.mjs');
 const observationRaw=Buffer.from(JSON.stringify({chainId:'chain',roundsRequested:2,roundsCompleted:2,summary:{input:2,finalSubmitted:2}}));
 const nodes=Array.from({length:4},(_,i)=>({name:'n'+i,height:3,appHash:'app',snapshotSha256:'snapshot',storeSha256:'store',readOnlyBlockstore:true,exactStateEqual:true,replayedTransactions:2}));
 const accountsRaw=Buffer.from(JSON.stringify(nodes.map(n=>({name:n.name,height:3,snapshotSha256:'snapshot',storeSha256:'store',sendersVerified:1,expectedNonce:2,feeEvents:2}))));
 const replayRaw=Buffer.from(JSON.stringify({observationSha256:hash(observationRaw),nodes,publicSignedBlocks:[{height:3,header:{height:'3',chain_id:'chain'},commit:{height:'3',signatures:[]},transactions:['unsigned-format-fixture1','unsigned-format-fixture2']}]}));
 const guard={admissionCase:'offline-baseline-stopped-01',plan:{mode:'stopped_replay',binarySHA256:'a77ce29169a4277df163a4cb4b156e32f7a7d3cf2b99bb75d1a6ae66853a19cc'},firstCause:null,groupGone:true,go:{code:0,signal:null,exited:true,stdout:'--- PASS: TestStoppedNetworkReplay (0.1s)\n--- PASS: TestStoppedReadySenderAccountReadback (0.1s)\nPASS\n'},originalsUnchanged:true,offlineBefore:{rows:[{inode:'original'}]},offlineAfter:{rows:[{inode:'original'}]},offlineOwnerChecks:Array.from({length:4},()=>({code:1,stdout:'',stderr:''})),proofArtifacts:[{source:'/window/stopped-replay.json',sha256:hash(replayRaw)},{source:'/window/ready-account-readback.json',sha256:hash(accountsRaw)}]};
 const args=()=>{const guardRaw=Buffer.from(JSON.stringify(guard));return {observationRaw,replayRaw,accountsRaw,guardRaw,expectedGuardSHA256:hash(guardRaw)};};
 assert.equal(bindBaselineStoppedProof(args()).newThroughputOrLatencySamples,false);
 const wrong=args();wrong.observationRaw=Buffer.from('{}');assert.throws(()=>bindBaselineStoppedProof(wrong),/another transaction report/);
 const corrupt=args();corrupt.replayRaw=Buffer.from('{}');assert.throws(()=>bindBaselineStoppedProof(corrupt),/proof bytes/);
 const missing=args();missing.expectedGuardSHA256='0'.repeat(64);assert.throws(()=>bindBaselineStoppedProof(missing),/guard digest/);
 guard.offlineAfter.rows[0].inode='replacement';assert.throws(()=>bindBaselineStoppedProof(args()),/identities/);
 guard.offlineAfter=guard.offlineBefore;guard.go.code=1;assert.throws(()=>bindBaselineStoppedProof(args()),/did not complete/);
});

// T-REL-05: unsigned arithmetic fixtures, never independent ledger proof.
function cohortFixture(){
 const second=1000000000n,ctx={run:'fixture-run',clockDomain:'fixture-parent-monotonic',isolatedNetwork:true,loadModel:'open_loop',windowStartNs:'0',windowEndNs:String(10n*second),observedUntilNs:String(20n*second),plan:[],records:[]};
 for(let i=0;i<4;i++){
  const id='request-'+i;ctx.plan.push({id,generatedAtNs:String(BigInt(i)*second),signingMode:i<2?'online_signed':'pre_signed'});
  ctx.records.push({id,clockDomain:ctx.clockDomain,submittedAtNs:String(BigInt(i)*second),acceptedAtNs:String(BigInt(i)*second+1n),includedAtNs:String(BigInt(i+1)*second),finalCommitAtNs:String(BigInt(i+2)*second),height:String(i+1),executionCode:0,businessKind:'transfer',memberId:(i+1).toString(16).padStart(64,'0')});
 }
 return ctx;
}
const cohortRead=ctx=>measureFinalCohort(ctx,'1','99',ctx.plan.filter(p=>BigInt(p.generatedAtNs)>=BigInt(ctx.windowStartNs)&&BigInt(p.generatedAtNs)<BigInt(ctx.windowEndNs)).map(p=>p.id),ctx.run);
test('T-REL-05 complete terminal partition keeps rejection timeout lost rows and signing groups',()=>{
 const c=cohortFixture();c.records[1]={id:'request-1',clockDomain:c.clockDomain,rejectedBeforeAdmission:true,sourceRequestFailed:true};c.records[2]={id:'request-2',clockDomain:c.clockDomain,submittedAtNs:'2000000000',acceptedAtNs:'2000000001',timedOut:true};c.records.pop();
 const r=cohortRead(c),n=r.cohort.counts;assert.equal(n.offered,4);assert.equal(n.committed_success,1);assert.equal(n.rejected_before_admission,1);assert.equal(n.unknown_or_unfinished,2);assert.equal(n.measurementLost,1);assert.equal(n.sourceRequestFailed,1);assert.equal(n.accepted,2);assert.equal(n.committed_success+n.rejected_before_admission+n.final_failed+n.unknown_or_unfinished,n.offered);
 assert.equal(r.signingGroups.online_signed.counts.offered,2);assert.equal(r.signingGroups.pre_signed.counts.offered,2);assert.equal(r.sustainedTPSQualified,false);assert.equal(r.independentProofReverifiedHere,false);
});
test('T-REL-05 prior backlog and tail drain cannot inflate the fixed-window final numerator',()=>{
 const c=cohortFixture();c.windowStartNs='1000000000';c.records[3].finalCommitAtNs='11000000000';const r=cohortRead(c);
 assert.equal(r.preWindowBacklogFinalsExcluded,1);assert.equal(r.cohort.counts.offered,3);assert.equal(r.cohort.counts.committed_success,3);assert.equal(r.cohort.counts.tailFinals,1);assert.equal(r.cohort.window.finalCommitBusinessSuccess,2);assert.equal(r.cohort.finalWindowRate.denominatorNs,'9000000000');
 c.records[2].finalCommitAtNs=c.windowEndNs;assert.equal(cohortRead(c).cohort.window.finalCommitBusinessSuccess,1);
});
test('T-REL-05 censored P95/P99 retain the full denominator and overdue SLO violations',()=>{
 const c=cohortFixture();c.records[3]={id:'request-3',clockDomain:c.clockDomain,timedOut:true};const r=cohortRead(c).cohort.latency;
 assert.equal(r.denominator,4);assert.equal(r.successfulSamples,3);assert.equal(r.quantiles.p95.ns,null);assert.equal(r.quantiles.p99.denominator,4);assert.equal(r.quantiles.p95.lowerBoundNs,'17000000000');assert.equal(r.rightCensoredSamples,1);assert.equal(r.slo.p95.deadlineExceeded,1);assert.equal(r.slo.p99.deadlineExceeded,1);assert.equal(r.completedSuccessOnly.conditional,true);assert.equal(r.completedSuccessOnly.p95Ns,'2000000000');
});
test('T-REL-05 valid inclusion remains separate from unfinished final Commit and execution failures',()=>{
 const c=cohortFixture();delete c.records[0].finalCommitAtNs;c.records[1].executionCode=7;const n=cohortRead(c).cohort.counts;
 assert.equal(n.includedBusinessSuccess,3);assert.equal(n.committed_success,2);assert.equal(n.final_failed,1);assert.equal(n.unknown_or_unfinished,1);
});
test('T-REL-05 incomplete selected inventory duplicate members and foreign clocks fail closed',()=>{
 const c=cohortFixture();assert.throws(()=>measureFinalCohort(c,'1','99',['request-0'],c.run),/entire fixed-window plan/);
 for(const mutate of [x=>x.plan.push(x.plan[0]),x=>x.records.push(x.records[0]),x=>x.records[1].memberId=x.records[0].memberId,x=>x.records[0].clockDomain='other',x=>x.records[0].rejectedBeforeAdmission=true,x=>x.plan[0].signingMode='unspecified',x=>x.records[0].submittedAtNs=0,x=>x.records[0].timedOut='true']){const x=cohortFixture();mutate(x);assert.throws(()=>cohortRead(x));}
 assert.throws(()=>measureFinalCohort(c,'1','99',c.plan.map(p=>p.id),'another-run'),/run reference/);
});
test('T-REL-05 exact ns beyond float precision and R6 length are measurement DATA only',()=>{
 const c=cohortFixture(),offset=9007199254740993n;
 for(const key of ['windowStartNs','windowEndNs','observedUntilNs'])c[key]=String(BigInt(c[key])+offset);
 for(const p of c.plan)p.generatedAtNs=String(BigInt(p.generatedAtNs)+offset);
 for(const r of c.records)for(const key of ['submittedAtNs','acceptedAtNs','includedAtNs','finalCommitAtNs'])r[key]=String(BigInt(r[key])+offset);
 const r=cohortRead(c);assert.equal(r.cohort.latency.quantiles.p95.ns,'2000000000');assert.equal(r.cohort.latency.quantiles.p99.denominator,4);assert.equal(r.formal1800SecondWindowObserved,false);assert.equal(r.signatureThroughputQualified,false);
 c.windowEndNs=String(offset+1800000000000n);c.observedUntilNs=c.windowEndNs;assert.equal(cohortRead(c).formal1800SecondWindowObserved,true);assert.equal(cohortRead(c).sustainedTPSQualified,false);
});

test('T-REL-05 the exact 99.9 percent floor never forgives any unknown observation',()=>{
 const c=cohortFixture();c.plan=[];c.records=[];
 for(let i=0;i<1000;i++){const id='large-'+i;c.plan.push({id,generatedAtNs:'0',signingMode:'online_signed'});c.records.push({id,clockDomain:c.clockDomain,submittedAtNs:'0',includedAtNs:'1',finalCommitAtNs:'2',height:'1',executionCode:0,businessKind:'transfer',memberId:(i+1).toString(16).padStart(64,'0')});}
 c.records[999]={id:'large-999',clockDomain:c.clockDomain,rejectedBeforeAdmission:true};let r=cohortRead(c);assert.equal(r.cohort.completeQualityFloorObserved,true);assert.equal(r.cohort.successFraction.denominator,1000);assert.equal(r.sustainedTPSQualified,false);
 c.records[998]={id:'large-998',clockDomain:c.clockDomain,rejectedBeforeAdmission:true};assert.equal(cohortRead(c).cohort.completeQualityFloorObserved,false);
 c.records.pop();r=cohortRead(c);assert.equal(r.cohort.completeQualityFloorObserved,false);assert.equal(r.cohort.counts.measurementLost,1);assert.equal(r.cohort.latency.denominator,1000);
});

function rawCohortFixture(withContext=true){
 const x=fixture(),ctx={run:'raw-fixture-run',clockDomain:'fixture-core-projection',isolatedNetwork:true,loadModel:'open_loop',windowStartNs:'0',windowEndNs:'10000000000',observedUntilNs:'20000000000',plan:[],records:[]};
 for(const [i,r]of x.report.transactions.entries()){ctx.plan.push({id:r.hash,signingMode:i?'pre_signed':'online_signed',generatedAtNs:String(BigInt(i)*1000000000n)});ctx.records.push({id:r.hash,clockDomain:ctx.clockDomain,submittedAtNs:String(BigInt(i)*1000000000n),acceptedAtNs:String(BigInt(i)*1000000000n+1n),includedAtNs:String(BigInt(i+1)*1000000000n),finalCommitAtNs:String(BigInt(i+2)*1000000000n),height:String(r.height),executionCode:0,businessKind:'transfer',memberId:r.hash.toLowerCase()});}
 const input={manifestRaw:x.manifestRaw,journalRaw:x.journalRaw,summaryRaw:Buffer.from(JSON.stringify(x.report)),...(withContext?{contextRaw:Buffer.from(JSON.stringify(ctx))}:{})};
 input.bindings={run:ctx.run,count:1,rounds:2,fromHeight:'1',untilHeight:'99',requests:ctx.plan.map(p=>p.id),sha256:Object.fromEntries(Object.entries(input).map(([k,v])=>[k.replace('Raw',''),hash(v)]))};return input;
}
test('T-REL-05 adapter binds original raw journal and summary to the cohort kernel without proof promotion',()=>{
 const x=rawCohortFixture(),r=measureOriginalFinalCohort(x);assert.equal(r.coverage.denominator,2);assert.equal(r.bench.cohort.counts.committed_success,2);assert.equal(r.bench.signingGroups.pre_signed.counts.offered,1);assert.equal(r.timingProjectionAuthenticated,false);assert.equal(r.CORESourceAuthenticated,false);assert.equal(r.sustainedTPSQualified,false);assert.equal(r.reportedClientOfferToFinalMs.p95,23);assert.equal(r.reportedClientOfferToFinalMs.denominator,2);assert.match(r.runReferenceAuthority,/local output label/);
});
test('T-REL-05 adapter keeps the original denominator when a report row is lost and refuses fabricated recovery',()=>{
 const x=rawCohortFixture(false),report=JSON.parse(x.summaryRaw);report.transactions.pop();report.summary.effectiveBusinessIncluded=1;report.summary.finalSubmitted=1;x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.summary=hash(x.summaryRaw);
 const r=measureOriginalFinalCohort(x);assert.equal(r.coverage.denominator,2);assert.equal(r.coverage.observedRows,1);assert.equal(r.coverage.missingRequestIds.length,1);assert.equal(r.bench,null);assert.ok(r.missingContracts.some(message=>/UTC/.test(message)));
 const context=JSON.parse(rawCohortFixture().contextRaw);x.contextRaw=Buffer.from(JSON.stringify(context));x.bindings.sha256.context=hash(x.contextRaw);assert.throws(()=>measureOriginalFinalCohort(x),/invented a missing/);
 context.records.pop();x.contextRaw=Buffer.from(JSON.stringify(context));x.bindings.sha256.context=hash(x.contextRaw);const partial=measureOriginalFinalCohort(x);assert.equal(partial.bench.cohort.counts.measurementLost,1);assert.equal(partial.bench.cohort.latency.denominator,2);
});
test('T-REL-05 adapter refuses mixed raw bytes summary totals and promoted unqualified observations',()=>{
 const x=rawCohortFixture();x.summaryRaw=Buffer.from('{}');assert.throws(()=>measureOriginalFinalCohort(x),/digest/);
 const y=rawCohortFixture(),report=JSON.parse(y.summaryRaw);report.transactions[0].quorumVerified=false;report.summary.effectiveBusinessIncluded=1;report.summary.finalSubmitted=1;y.summaryRaw=Buffer.from(JSON.stringify(report));y.bindings.sha256.summary=hash(y.summaryRaw);assert.throws(()=>measureOriginalFinalCohort(y),/projected final/);
 const z=rawCohortFixture(),context=JSON.parse(z.contextRaw);context.plan.pop();z.contextRaw=Buffer.from(JSON.stringify(context));z.bindings.sha256.context=hash(z.contextRaw);assert.throws(()=>measureOriginalFinalCohort(z),/complete original inventory/);
});
test('T-REL-05 adapter actual read-only CLI preserves originals and refuses overwrite and links',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-final-cohort-')));try{
  const x=rawCohortFixture(),files={manifest:x.manifestRaw,journal:x.journalRaw,summary:x.summaryRaw,context:x.contextRaw,bindings:Buffer.from(JSON.stringify(x.bindings))};
  for(const [name,raw]of Object.entries(files))fs.writeFileSync(path.join(root,name),raw,{mode:0o600});
  const script=fileURLToPath(new URL('./same-control-readback.mjs',import.meta.url)),out=path.join(root,'result.json'),args=[script,...Object.keys(files).flatMap(k=>['--'+k,path.join(root,k)]),'--output',out];
  const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(out)).bench.cohort.counts.offered,2);
  for(const [name,raw]of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(root,name)),raw);
  const saved=fs.readFileSync(out);assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000}).status,1);assert.deepEqual(fs.readFileSync(out),saved);
  fs.symlinkSync(path.join(root,'journal'),path.join(root,'journal-link'));const linked=[...args],index=linked.indexOf('--journal');linked[index+1]=path.join(root,'journal-link');linked[linked.length-1]=path.join(root,'other.json');assert.equal(spawnSync(process.execPath,linked,{encoding:'utf8',timeout:10000}).status,1);assert.equal(fs.existsSync(path.join(root,'other.json')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('T-REL-05 adapter separates included execution failures from successful members and final Commit',()=>{
 const x=rawCohortFixture(),report=JSON.parse(x.summaryRaw),ctx=JSON.parse(x.contextRaw);report.transactions[1].executionCode=7;report.transactions[1].status='execution_failed';report.summary.effectiveBusinessIncluded=1;report.summary.finalSubmitted=1;ctx.records[1].executionCode=7;delete ctx.records[1].finalCommitAtNs;ctx.records[1].finalFailed=true;
 x.summaryRaw=Buffer.from(JSON.stringify(report));x.contextRaw=Buffer.from(JSON.stringify(ctx));x.bindings.sha256.summary=hash(x.summaryRaw);x.bindings.sha256.context=hash(x.contextRaw);
 const r=measureOriginalFinalCohort(x);assert.equal(r.coverage.reportedIncludedAll,2);assert.equal(r.coverage.reportedIncluded,1);assert.equal(r.bench.cohort.counts.included,2);assert.equal(r.bench.cohort.counts.includedBusinessSuccess,1);assert.equal(r.bench.cohort.counts.final_failed,1);assert.equal(r.bench.cohort.counts.committed_success,1);
});

function withOriginalMonotonicTrace(){
 const x=rawCohortFixture(false),report=JSON.parse(x.summaryRaw);report.monotonicObservations={schema:'YNX-PERF-MONOTONIC-OBSERVATIONS/v1',observationCutoffNs:'10000000000',missingClockPoints:0,invalidClockPoints:0,unqualifiedFinalSlots:0,logicalGenerationMeasured:false,fixedWindowConfigured:false,physicalCommitMeasured:false,rows:report.transactions.map((r,i)=>({slot:i,index:r.index,round:r.round,hash:r.hash,scheduledOffsetNs:'0',offeredOffsetNs:'1',submittedOffsetNs:'2',checkTxObservedOffsetNs:'3',includedObservedOffsetNs:'4',qualifiedFinalObservedOffsetNs:'5'}))};return {x,report};
}
test('T-REL-05 monotonic bridge consumes producer clock data without UTC or formal-window invention',()=>{
 const {x,report}=withOriginalMonotonicTrace();x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.summary=hash(x.summaryRaw);const r=measureOriginalFinalCohort(x);
 assert.equal(r.clientMonotonicData.denominator,2);assert.equal(r.clientMonotonicData.conditionalOfferToQualifiedFinalNs.p95Ns,'4');assert.equal(r.clientMonotonicData.observedStageCounts.qualifiedFinalObservedOffsetNs,2);assert.equal(r.clientMonotonicData.logicalGenerationMeasured,false);assert.equal(r.bench,null);assert.equal(r.sustainedTPSQualified,false);
});
test('T-REL-05 monotonic bridge refuses detached slots reversed clocks and widened producer claims',()=>{
 for(const mutate of [r=>r.monotonicObservations.rows[0].hash='other',r=>r.monotonicObservations.rows[0].qualifiedFinalObservedOffsetNs='2',r=>r.monotonicObservations.physicalCommitMeasured=true,r=>r.monotonicObservations.rows.pop(),r=>{r.transactions[0].checkTxIdentityVerified=false;r.summary.finalSubmitted=1;}]){
  const {x,report}=withOriginalMonotonicTrace();mutate(report);x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.summary=hash(x.summaryRaw);assert.throws(()=>measureOriginalFinalCohort(x));
 }
});
test('T-REL-05 monotonic bridge actual producer-schema CLI delivers bounded readback data',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-clock-flow-')));try{
  const {x,report}=withOriginalMonotonicTrace();x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.summary=hash(x.summaryRaw);
  const files={manifest:x.manifestRaw,journal:x.journalRaw,summary:x.summaryRaw,bindings:Buffer.from(JSON.stringify(x.bindings))};
  for(const [name,raw]of Object.entries(files))fs.writeFileSync(path.join(root,name),raw,{mode:0o600});
  const script=fileURLToPath(new URL('./same-control-readback.mjs',import.meta.url)),out=path.join(root,'readback.json');
  const result=spawnSync(process.execPath,[script,...Object.keys(files).flatMap(name=>['--'+name,path.join(root,name)]),'--output',out],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
  const readback=JSON.parse(fs.readFileSync(out));assert.equal(readback.coverage.denominator,2);assert.equal(readback.clientMonotonicData.conditionalOfferToQualifiedFinalNs.p99Ns,'4');assert.equal(readback.clientMonotonicData.physicalCommitMeasured,false);assert.equal(readback.bench,null);assert.equal(readback.sustainedTPSQualified,false);
  for(const [name,raw]of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(root,name)),raw);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
function declaredSourceFixture(){
 const {x,report}=withOriginalMonotonicTrace(),journal=x.journalRaw.toString().trimEnd().split('\n'),seed=JSON.parse(journal[1]),inputRaw=Buffer.from(JSON.stringify({transactions:[seed.transaction]}));
 const plan={schema:'YNX-PERF-DECLARED-COHORT/v1',manifestSha256:hash(x.manifestRaw),inputSha256:hash(inputRaw),genesisHash:'genesis',migrationHash:'migration',senders:1,rounds:2,offeredRate:1,windowStartNs:'0',windowEndNs:'2000000000',rows:[]};
 for(let i=0;i<2;i++)plan.rows.push({id:hash(Buffer.from(JSON.stringify([plan.schema,plan.manifestSha256,plan.inputSha256,i,0,i+1]))),index:i,sender:0,round:i+1,signingMode:i?'online_signed':'pre_signed',logicalArrivalOffsetNs:String(i*1000000000)});
 const planRaw=Buffer.from(JSON.stringify(plan)+'\n');report.senderMode='ready-pool';report.declaredCohort={schema:plan.schema,planSha256:hash(planRaw),planPath:'not-an-input-authority',windowCompleted:true,observationCutoffNs:'4000000000',releasedOffsetNs:['1','1000000001']};
 report.monotonicObservations.observationCutoffNs='4000000000';report.monotonicObservations.rows=report.transactions.map((r,i)=>({slot:i,index:r.index,round:r.round,hash:r.hash,scheduledOffsetNs:String(i*1000000000),offeredOffsetNs:String(i*1000000000+100),submittedOffsetNs:String(i*1000000000+200),checkTxObservedOffsetNs:String(i*1000000000+300),includedObservedOffsetNs:String(i*1000000000+400),qualifiedFinalObservedOffsetNs:i?'2500000000':'500000000'}));
 x.planRaw=planRaw;x.inputRaw=inputRaw;x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.plan=hash(planRaw);x.bindings.sha256.input=hash(inputRaw);x.bindings.sha256.summary=hash(x.summaryRaw);return {x,report,plan,journal};
}
test('T-REL-05 declared source keeps fixed-window finals distinct from tail drain and signing groups',()=>{
 const {x}=declaredSourceFixture();const missingPlan={...x};delete missingPlan.planRaw;delete missingPlan.inputRaw;assert.throws(()=>measureOriginalFinalCohort(missingPlan),/requires its original plan/);const r=measureOriginalFinalCohort(x);assert.equal(r.bench.cohort.counts.offered,2);assert.equal(r.bench.cohort.counts.committed_success,2);assert.equal(r.bench.cohort.counts.tailFinals,1);assert.equal(r.bench.cohort.window.finalCommitBusinessSuccess,1);assert.equal(r.bench.cohort.finalWindowRate.denominatorNs,'2000000000');assert.equal(r.bench.signingGroups.pre_signed.counts.offered,1);assert.equal(r.bench.signingGroups.online_signed.counts.offered,1);assert.equal(r.sustainedTPSQualified,false);
});
test('T-REL-05 declared source preserves unsigned and unsubmitted logical successors after failure',()=>{
 const {x,report,journal}=declaredSourceFixture();x.journalRaw=Buffer.from(journal.slice(0,2).join('\n')+'\n');report.transactions[1]={index:1,round:2,hash:'',status:'not_submitted',errors:[]};report.summary.effectiveBusinessIncluded=1;report.summary.finalSubmitted=1;report.monotonicObservations.rows[1]={slot:1,index:1,round:2,hash:''};x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.journal=hash(x.journalRaw);x.bindings.sha256.summary=hash(x.summaryRaw);
 const r=measureOriginalFinalCohort(x);assert.equal(r.coverage.denominator,2);assert.equal(r.coverage.withoutDurableSignedIntent,1);assert.equal(r.bench.cohort.counts.unknown_or_unfinished,1);assert.equal(r.bench.cohort.latency.quantiles.p95.denominator,2);assert.equal(r.bench.cohort.latency.quantiles.p95.ns,null);assert.equal(r.bench.cohort.latency.slo.p95.deadlineExceeded,1);
});
test('T-REL-05 declared source refuses effects before generation and postselected source plans',()=>{
 for(const mutate of [a=>a.report.declaredCohort.releasedOffsetNs[0]=null,a=>a.plan.rows[0].logicalArrivalOffsetNs='1',a=>a.report.declaredCohort.windowCompleted=false]){
  const a=declaredSourceFixture();mutate(a);a.x.planRaw=Buffer.from(JSON.stringify(a.plan)+'\n');a.report.declaredCohort.planSha256=hash(a.x.planRaw);a.x.summaryRaw=Buffer.from(JSON.stringify(a.report));a.x.bindings.sha256.plan=hash(a.x.planRaw);a.x.bindings.sha256.summary=hash(a.x.summaryRaw);assert.throws(()=>measureOriginalFinalCohort(a.x));
 }
});
test('T-REL-05 declared source withholds window rate when generation remains incomplete',()=>{
 const {x,report,journal}=declaredSourceFixture();
 x.journalRaw=Buffer.from(journal.slice(0,2).join('\n')+'\n');
 report.transactions[1]={index:1,round:2,hash:'',status:'not_submitted',errors:[]};
 report.monotonicObservations.rows[1]={slot:1,index:1,round:2,hash:''};
 report.summary.effectiveBusinessIncluded=1;report.summary.finalSubmitted=1;
 report.declaredCohort.releasedOffsetNs[1]=null;report.declaredCohort.windowCompleted=false;
 x.summaryRaw=Buffer.from(JSON.stringify(report));x.bindings.sha256.summary=hash(x.summaryRaw);x.bindings.sha256.journal=hash(x.journalRaw);
 const r=measureOriginalFinalCohort(x);assert.equal(r.coverage.denominator,2);assert.equal(r.coverage.notReleased,1);assert.equal(r.bench,null);assert.equal(r.reportedTerminalCounts.unknown_or_unfinished,1);
});
test('T-REL-05 declared source actual CLI consumes persisted plan and seed through the original entry',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-declared-flow-')));try{
  const {x}=declaredSourceFixture(),files={manifest:x.manifestRaw,journal:x.journalRaw,summary:x.summaryRaw,plan:x.planRaw,input:x.inputRaw,bindings:Buffer.from(JSON.stringify(x.bindings))};
  for(const [name,raw]of Object.entries(files))fs.writeFileSync(path.join(root,name),raw,{mode:0o600});
  const script=fileURLToPath(new URL('./same-control-readback.mjs',import.meta.url)),out=path.join(root,'result.json'),args=[script,...Object.keys(files).flatMap(k=>['--'+k,path.join(root,k)]),'--output',out];
  const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);const data=JSON.parse(fs.readFileSync(out));assert.equal(data.coverage.denominator,2);assert.equal(data.bench.cohort.window.finalCommitBusinessSuccess,1);assert.equal(data.bench.cohort.counts.tailFinals,1);for(const [name,raw]of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(root,name)),raw);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
