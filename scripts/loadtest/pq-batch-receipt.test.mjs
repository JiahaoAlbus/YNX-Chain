import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pqBatchMemberHash,classifyPQBatchReceipt,createPQReceiptCounter,qualifyPQBatchMeasurement,readGuardedPQPairedPhases} from './pq-batch-receipt.mjs';

// Parser fixtures only: no valid PQ signature or business acceptance is implied.
function fixture(){
  const wire=Buffer.from('unsigned parser-only fixture');
  const batchHash='0x'+createHash('sha256').update(wire).digest('hex');
  const expected=[{amount:'9007199254740993',fee:'1',nonce:'2'},{amount:'1',fee:'1',nonce:'2'},{amount:'1',fee:'1',nonce:'9007199254740993'},{amount:'2',fee:'1',nonce:'3'}];
  const response={batchHash,wireHash:batchHash,status:'durable',replayed:false,executionHeight:'2',results:expected.map((e,index)=>({index,batchHash,wireHash:batchHash,outcome:index===1||index===3?'admitted':'rejected',transactionHash:index===1||index===3?pqBatchMemberHash(batchHash,index):'',error:index===1||index===3?'':'business rejected',decimalFields:{...e,executionHeight:'2'}}))};
  return {wire,response,expected};
}
test('member hash matches fixed application framing vectors in aa97f102',()=>{
  const zero='0x'+'0'.repeat(64);
  for(const [i,want] of [[0,'0xc3734379b242cee7e34589669a060798062b01f809b6b749af0ad0ee7c6652c9'],[1,'0x6754ab3d53902b48068d49f9d0974b8e1f8125f3399830b9f4da66c809b6a6bf'],[1023,'0x2e976c0c8997192623c73de89594605ac8d1c1d6d9dabbc48a41deb65950d53d']])assert.equal(pqBatchMemberHash(zero,i),want);
  for(const [h,i] of [[zero,1024],[zero,-1],[zero,0.5],['0x'+'A'.repeat(64),0]])assert.throws(()=>pqBatchMemberHash(h,i));
});
test('partial checkpoint response counts members, withholding actual inclusion/finality',()=>{
  const f=fixture(),r=classifyPQBatchReceipt(f.wire,f.response,f.expected);
  assert.equal(r.serverReportedAdmitted,2);assert.equal(r.serverReportedRejected,2);assert.equal(r.newServerReportedDurableMembers,2);assert.equal(r.verifiedEffectiveInclusions,null);assert.equal(r.verifiedFinalCommits,null);
});
test('replay memory uncertain and not-committed cannot count new durable business',()=>{
  for(const status of ['durable','memory','uncertain','not_committed']){
    const f=fixture();f.response.status=status;f.response.replayed=status==='durable';
    assert.equal(classifyPQBatchReceipt(f.wire,f.response,f.expected).newServerReportedDurableMembers,0);
  }
});
test('wrong wire identity result ordering and rejected execution identities fail',()=>{
  for(const mutate of [f=>f.response.batchHash='0x'+'0'.repeat(64),f=>f.response.results.reverse(),f=>f.response.results[0].transactionHash=pqBatchMemberHash(f.response.batchHash,0),f=>f.response.results[1].transactionHash='0x'+'1'.repeat(64),f=>f.response.results.pop(),f=>f.response.status='accepted',f=>f.response.status='rejected']){const f=fixture();mutate(f);assert.throws(()=>classifyPQBatchReceipt(f.wire,f.response,f.expected));}
});
test('decimal values stay exact strings beyond JS safe integer range',()=>{
  for(const mutate of [f=>f.response.results[0].decimalFields.amount=9007199254740993,f=>f.response.results[0].decimalFields.amount='9007199254740992',f=>f.expected[0].nonce='02',f=>f.expected[0].amount='18446744073709551616',f=>f.response.executionHeight='02']){const f=fixture();mutate(f);assert.throws(()=>classifyPQBatchReceipt(f.wire,f.response,f.expected));}
});
test('N=1024 with repeated business nonce is one server admission, not 1024',()=>{
  const f=fixture();f.expected=Array.from({length:1024},()=>({amount:'1',fee:'1',nonce:'2'}));f.response.results=f.expected.map((e,index)=>({index,batchHash:f.response.batchHash,wireHash:f.response.batchHash,outcome:index===0?'admitted':'rejected',transactionHash:index===0?pqBatchMemberHash(f.response.batchHash,index):'',error:index===0?'':'nonce',decimalFields:{...e,executionHeight:'2'}}));
  const r=classifyPQBatchReceipt(f.wire,f.response,f.expected);assert.equal(r.serverReportedAdmitted,1);assert.equal(r.serverReportedRejected,1023);assert.equal(r.newServerReportedDurableMembers,1);
});

test('run-scoped counter deduplicates repeated original responses and durable replay', ()=>{
  const counter=createPQReceiptCounter(8), f=fixture();
  assert.equal(counter.observe(f.wire,f.response,f.expected).newUniqueServerReportedDurableMembers,2);
  assert.equal(counter.observe(f.wire,f.response,f.expected).newUniqueServerReportedDurableMembers,0);
  f.response.replayed=true;
  const out=counter.observe(f.wire,f.response,f.expected);
  assert.equal(out.uniqueServerReportedDurableMembers,2);
  assert.equal(out.verifiedFinalCommits,null);
});
test('uncertain admission does not consume a later durable identity; replay-first is not new execution',()=>{
  const f=fixture(), counter=createPQReceiptCounter(8);f.response.status='uncertain';
  assert.equal(counter.observe(f.wire,f.response,f.expected).newUniqueServerReportedDurableMembers,0);
  f.response.status='durable';f.response.replayed=true;
  const replay=counter.observe(f.wire,f.response,f.expected);
  assert.equal(replay.newUniqueServerReportedDurableMembers,0);
  assert.equal(replay.uniqueServerReportedDurableMembers,2);
  f.response.replayed=false;
  assert.equal(counter.observe(f.wire,f.response,f.expected).newUniqueServerReportedDurableMembers,0);
});
test('identity cap or malformed receipt fails atomically and never evicts old identities',()=>{
  for(const cap of [0,1.5,1000001,Infinity])assert.throws(()=>createPQReceiptCounter(cap));
  const f=fixture(), counter=createPQReceiptCounter(1);
  assert.throws(()=>counter.observe(f.wire,f.response,f.expected),/bound/);
  f.response.results[3].outcome='rejected';f.response.results[3].transactionHash='';f.response.results[3].error='rejected';
  assert.equal(counter.observe(f.wire,f.response,f.expected).newUniqueServerReportedDurableMembers,1);
  assert.equal(counter.observe(f.wire,f.response,f.expected).newUniqueServerReportedDurableMembers,0);
  f.response.results[0].transactionHash='malformed';
  assert.throws(()=>counter.observe(f.wire,f.response,f.expected));
});

test('capacity exhaustion retains old hashes and cannot reset a previous count',()=>{
 const first=fixture(), second=fixture(), counter=createPQReceiptCounter(2);
 counter.observe(first.wire,first.response,first.expected);
 second.wire=Buffer.from('different unsigned parser-only fixture');
 const h='0x'+createHash('sha256').update(second.wire).digest('hex');
 second.response.batchHash=second.response.wireHash=h;
 for(const row of second.response.results){row.batchHash=row.wireHash=h;if(row.outcome==='admitted')row.transactionHash=pqBatchMemberHash(h,row.index);}
 assert.throws(()=>counter.observe(second.wire,second.response,second.expected),/bound/);
 const after=counter.observe(first.wire,first.response,first.expected);
 assert.equal(after.uniqueServerReportedDurableMembers,2);
 assert.equal(after.newUniqueServerReportedDurableMembers,0);
});

function measurementFixture(){
 const f=fixture(),phase=(a=0,c=0,e=0,ns='0')=>({attempts:a,completed:c,errors:e,durationNs:ns});
 const file=()=>Object.fromEntries([...['total','openTemp','encodeWrite','fileSync','close','rename','directorySync'].map(k=>[k,phase(1,1,0,'10')]),['writeCalls',2],['bytesWritten',1024]]);
 const m={version:'ynx-pq-batch-measurement-v1',wireHash:f.response.batchHash,executionHeight:f.response.executionHeight,result:{executionHeight:f.response.executionHeight,batchHash:f.response.batchHash,status:f.response.status,replayed:false,results:f.response.results.map(r=>({index:r.index,outcome:r.outcome,transactionHash:r.transactionHash,error:r.error}))},total:phase(1,1,0,'9007199254740993'),inputCloneHash:phase(1,1,0,'10'),lockWait:phase(1,1,0,'10'),policyValidation:phase(1,1,0,'10'),wireDecode:phase(1,1,0,'10'),wholeAuthentication:phase(1,1,0,'100'),memberExecution:phase(4,2,2,'200'),replay:phase(),verifierSignatureChecks:2,memberAdmitted:2,memberRejected:2,persistence:{...Object.fromEntries(['total','snapshotBuild','integritySeal','checkpointBuild','persistenceLockWait','mkdir'].map(k=>[k,phase(1,1,0,'20')])),snapshotFile:file(),markerFile:file(),candidateIntegrity:'source-local-integrity',published:{version:'ynx-local-durability-v1',height:'1',hash:'source-local-block-hash',snapshotIntegrity:'source-local-integrity'}}};
 return {...f,m,phase};
}
test('production phase receipt binds exact result and preserves large ns and distinct checkpoint height',()=>{const f=measurementFixture();
 const q=qualifyPQBatchMeasurement(f.m,classifyPQBatchReceipt(f.wire,f.response,f.expected));
 assert.equal(q.phaseDurationsNs.total,'9007199254740993');assert.deepEqual(q.fileWrites.snapshotFile,{writeCalls:2,bytesWritten:1024});assert.equal(q.executionHeight,'2');assert.equal(q.publishedLocalCheckpoint.height,'1');assert.equal(q.verifiedFinalCommits,null);assert.equal(q.phaseDurationsAreInclusive,true);
});
test('covered replay has zero new signature/member/persistence work and cannot invent publication',()=>{const f=measurementFixture();f.response.replayed=f.m.result.replayed=true;
 f.m.memberAdmitted=f.m.memberRejected=f.m.verifierSignatureChecks=0;
 for(const k of ['policyValidation','wireDecode','wholeAuthentication','memberExecution'])f.m[k]=f.phase();
 f.m.replay=f.phase(1,1,0,'10');
 for(const k of ['total','snapshotBuild','integritySeal','checkpointBuild','persistenceLockWait','mkdir'])f.m.persistence[k]=f.phase();
 for(const file of ['snapshotFile','markerFile']){for(const k of ['total','openTemp','encodeWrite','fileSync','close','rename','directorySync'])f.m.persistence[file][k]=f.phase();f.m.persistence[file].writeCalls=f.m.persistence[file].bytesWritten=0;}
 delete f.m.persistence.published;delete f.m.persistence.candidateIntegrity;
 const q=qualifyPQBatchMeasurement(f.m,classifyPQBatchReceipt(f.wire,f.response,f.expected));assert.equal(q.publishedLocalCheckpoint,null);assert.equal(q.verifierSignatureChecks,0);
});
test('successful snapshot sync followed by failed marker never qualifies a published checkpoint',()=>{const f=measurementFixture();f.response.status=f.m.result.status='uncertain';
 f.m.total=f.m.persistence.total=f.m.persistence.markerFile.total=f.m.persistence.markerFile.directorySync=f.phase(1,0,1,'10');delete f.m.persistence.published;
 const receipt=classifyPQBatchReceipt(f.wire,f.response,f.expected);
 assert.equal(qualifyPQBatchMeasurement(f.m,receipt).publishedLocalCheckpoint,null);
 f.m.persistence.published={version:'ynx-local-durability-v1',height:'1',hash:'source-local-block-hash',snapshotIntegrity:f.m.persistence.candidateIntegrity};
 assert.throws(()=>qualifyPQBatchMeasurement(f.m,receipt));
});
test('malformed and mismatched measurement fields fail before use',()=>{
 for(const mutate of [f=>f.m.wireHash='0x'+'0'.repeat(64),f=>f.m.executionHeight='3',f=>f.m.result.status='memory',f=>f.m.result.results[1].transactionHash='0x'+'0'.repeat(64),f=>f.m.total.durationNs=1,f=>f.m.total.durationNs='-1',f=>f.m.total.durationNs='9223372036854775808',f=>f.m.total.completed=0,f=>f.m.verifierSignatureChecks=9007199254740992,f=>f.m.persistence.published.snapshotIntegrity='other',f=>f.m.memberAdmitted=4,f=>f.m.persistence.markerFile.bytesWritten=9007199254740992]){const f=measurementFixture();mutate(f);assert.throws(()=>qualifyPQBatchMeasurement(f.m,classifyPQBatchReceipt(f.wire,f.response,f.expected)));}
});

function guardedPairFixture(){
 const f=measurementFixture(),h=f.response.batchHash;
 f.m.total.durationNs='1000000';f.m.memberAdmitted=1;f.m.memberRejected=0;f.m.memberExecution=f.phase(1,1,0,'100');
 f.m.result.results=[{index:0,outcome:'admitted',transactionHash:pqBatchMemberHash(h,0)}];
 const common={members:1,localBlockCheckpointMembers:1,coldRestoredMembers:1,cloneLocalPeersPreserved:true,checkpointPointerTransitions:1,submitNs:2000000,submitWallNs:2100000,sharedSigningPreparationNs:1000,manualProduceBlockNs:1000,coldRestoreNs:1000};
 const report={schema:1,kind:'isolated-single-producer-PQ-paired-component',sourceCommit:'a'.repeat(40),n:1,trial:1,gomaxprocs:1,order:['members','whole'],businessProjectionEqual:true,bftFinalCommits:null,consensusFinalityLatency:null,sharedWholeSha256:h.slice(2),productionMeasurementVersion:f.m.version,results:[{...common,mode:'members',memberHashes:['0x'+'5'.repeat(64)]},{...common,mode:'whole',memberHashes:[pqBatchMemberHash(h,0)],wholeMeasurement:f.m}]};
 const raw=Buffer.from(JSON.stringify(report));
 const guard={sourceCommit:report.sourceCommit,explicitCaseN:1,firstCause:null,child:{code:0},cleanupComplete:true,emptyOwnedScans:[{},{}],resultSHA256:createHash('sha256').update(raw).digest('hex')};
 return {raw,guard,report};
}
test('guard-bound phase table retains exact inclusive ns and withholds finality or TPS',()=>{const f=guardedPairFixture();const q=readGuardedPQPairedPhases(f.raw,f.guard);
 assert.equal(q.phases.find(p=>p.phase==='total').durationNs,'1000000');assert.equal(q.phaseDurationsAreInclusive,true);assert.equal(q.verifiedFinalCommits,null);assert.equal(q.sustainedBusinessTPS,null);assert.equal(q.publishedLocalCheckpoint.height,'1');assert.equal(q.executionHeight,'2');
});
test('stale result digest failed guard missing cleanup and changed Whole identities refuse the table',()=>{assert.equal(typeof readGuardedPQPairedPhases,'function');
 for(const mutate of [f=>f.guard.resultSHA256='0'.repeat(64),f=>f.guard.firstCause='limit',f=>f.guard.child.code=1,f=>f.guard.emptyOwnedScans=[],f=>f.guard.cleanupComplete=false,f=>f.guard.sourceCommit='b'.repeat(40),f=>f.guard.explicitCaseN=16]){const f=guardedPairFixture();mutate(f);assert.throws(()=>readGuardedPQPairedPhases(f.raw,f.guard));}
 const f=guardedPairFixture();f.report.results[1].memberHashes=['0x'+'0'.repeat(64)];f.raw=Buffer.from(JSON.stringify(f.report));f.guard.resultSHA256=createHash('sha256').update(f.raw).digest('hex');assert.throws(()=>readGuardedPQPairedPhases(f.raw,f.guard));
});
