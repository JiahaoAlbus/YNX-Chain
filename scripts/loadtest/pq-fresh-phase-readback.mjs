// Read-only measurement adapter for the original fresh-business callee.
// Guard/digest/schema checks establish self-consistency, NOT provenance or
// consensus signatures. Original normal callee/verifier + Root pins remain
// required; this module cannot authorize a run or qualify sustained TPS.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isUtf8} from 'node:buffer';

export const freshPhaseSchema='ynx-pq-fresh-phase-pair-v1';
export const originalFreshVersion='YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1';
const maxRows=2048, maxNs=120000000000n;
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^[0-9a-f]{${n}}$`).test(v)&&!/^0+$/.test(v);
const txHash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function json(raw,label){requireValue(isUtf8(raw),label+' is not UTF-8');try{return JSON.parse(raw.toString('utf8'));}catch{throw Error(label+' is malformed JSON');}}
function ns(value,name){requireValue(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value),name+' must be an exact decimal string');const n=BigInt(value);requireValue(n<=maxNs,name+' exceeds original window');return n;}
function sameBinaries(a,b){return object(a)&&object(b)&&Object.keys(a).length===4&&Object.keys(b).length===4&&Object.keys(b).every(k=>hex(b[k],64)&&a[k]===b[k]);}
export function freshTimingQuantiles(values){
 const sorted=values.map(v=>ns(String(v),'duration')).sort((a,b)=>a<b?-1:a>b?1:0);
 if(!sorted.length)return {samples:0,p50Ns:null,p95Ns:null,p99Ns:null};
 return {samples:sorted.length,...Object.fromEntries([50,95,99].map(p=>['p'+p+'Ns',String(sorted[Math.ceil(p*sorted.length/100)-1])]))};
}
function numericDuration(v,name){requireValue(Number.isSafeInteger(v)&&v>=0&&BigInt(v)<=maxNs,name+' is not a bounded original numeric duration');return BigInt(v);}
function boundOriginalDigest(guard,expected,key,digest){
 const actual=guard?.[key],external=expected?.[key];
 return (hex(actual,64)||hex(external,64))&&(actual===undefined||actual===digest)&&(external===undefined||external===digest);
}
function checkCommit(row){
 const t=row.commitTiming;requireValue(object(t)&&Number.isSafeInteger(t.height)&&String(t.height)===row.height&&t.durable===true&&Number.isSafeInteger(t.payloadBytes)&&t.payloadBytes>0,'missing actual durable Commit sample');
 requireValue(['atomic-json','snapshot-journal-v1','block-journal-v2'].includes(t.storage),'unknown original storage profile');
 const elapsed=numericDuration(t.elapsedNs,'Commit elapsed');requireValue(elapsed>0n&&elapsed<=row.end-row.start,'Commit sample exceeds actual delegated call');
 requireValue(object(t.stagesNs)&&Object.keys(t.stagesNs).length>0&&Object.keys(t.stagesNs).length<=128,'missing original Commit stages');
 let sum=0n;for(const [key,v]of Object.entries(t.stagesNs)){requireValue(/^[a-z][a-z0-9_]{0,63}$/.test(key),'unknown stage name grammar');sum+=numericDuration(v,'Commit stage');}
 requireValue(sum<=elapsed,'overlapping or invalid flat Commit stages');
 const encode=t.storage==='block-journal-v2'?'delta_encode':'json_encode';
 for(const key of [encode,'write','file_sync',...(t.storage==='atomic-json'?['directory_sync']:[])])requireValue(t.stagesNs[key]>0,'required original Commit stage missing: '+key);
 return elapsed;
}
function originalIdentity(b,mode,verifierSHA,epochId){
 requireValue(txHash(b.nativeHash)&&txHash(b.abciHash)&&b.nativeHash!==b.abciHash&&typeof b.height==='string'&&/^[1-9][0-9]*$/.test(b.height)&&Number.isSafeInteger(b.index)&&b.index>=0&&b.index<=0xffffffff,'original transaction coordinates missing');
 const o=b.observation,c=b.confirmation;
 requireValue(typeof b.verifierOutput==='string'&&b.verifierOutput.length>0&&b.verifierOutput.length<=192*1024,'original bounded verifier output required');
 const bytes=Buffer.from(b.verifierOutput,'base64');requireValue(bytes.toString('base64')===b.verifierOutput&&createHash('sha256').update(bytes).digest('hex')===c?.verifierEvidenceSha256,'original verifier output digest differs');
 const v=json(bytes,'original verifier output');
 requireValue(object(o)&&object(c)&&object(v),'original observation, confirmation and verifier DATA required');
 for(const r of [o,c])requireValue(r.transactionType==='pq_transfer'&&r.nativeTransactionHash===b.nativeHash&&r.abciTransactionHash===b.abciHash&&r.readbackIndexMode===mode,'client original identity/mode differs');
 requireValue(c.executionHeight===b.height&&c.cometIndex===b.index,'confirmation coordinates differ');
 requireValue(['committed_observed','submission_unknown'].includes(o.status)&&o.readbackOnly===false&&o.submissionAttempts===1,'original offered business observation missing');
 if(o.status==='committed_observed')requireValue(o.effectiveBusinessIncludedObserved===1&&o.executionHeight===b.height&&o.cometIndex===b.index,'original committed observation differs');
 else requireValue(o.effectiveBusinessIncludedObserved===0,'UNKNOWN was promoted to observed inclusion');
 let client=null;
 if(o.submissionToFirstCommittedRPCObservationNs!==undefined){requireValue(['post_response','original_get'].includes(o.firstCommittedRPCObservationSource)&&o.firstCommittedRPCHeight===b.height&&o.firstCommittedRPCIndex===b.index,'first committed RPC coordinates differ');client=ns(o.submissionToFirstCommittedRPCObservationNs,'client first committed RPC');} 
 requireValue(c.readbackOnly===true&&c.submissionAttempts===0&&c.submissionToFirstCommittedRPCObservationNs===undefined&&c.independentFinalityVerified===true&&c.proofVerificationStatus==='verified_original_transaction'&&c.consensusExecutionOutcome==='succeeded'&&c.effectiveBusinessFinalized===1&&Array.isArray(c.finalizedBusinessHashes)&&c.finalizedBusinessHashes.length===1&&c.finalizedBusinessHashes[0]===b.nativeHash&&c.registrationFinalized===false&&c.verifierProcessStarted===true&&c.verifierInterrupted===false&&c.verifierExitCode===0&&c.proofVerifierSha256===verifierSHA&&hex(c.trustContextSha256,64)&&hex(c.verifierEvidenceSha256,64),'independent original verifier receipt missing; durable/Data alone is insufficient');
 const r=v.result;
 requireValue(v.version==='YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1'&&v.code==='VERIFIED_TRANSACTION_DATA'&&!v.error&&object(r)&&r.version==='YNX-PQ-TRANSACTION-PROOF/v1'&&r.classification==='data'&&r.transactionType==='pq_transfer'&&r.transactionHash===b.abciHash.slice(2)&&r.nativeWireHash===b.nativeHash.slice(2)&&r.height===b.height&&r.index===String(b.index)&&r.included===true&&r.finalized===true&&r.executionSuccessful===true&&r.executionCode==='0'&&r.outcome==='succeeded'&&r.nativeGrant===false&&r.block?.commitVerified===true&&r.block?.lightTransitionVerified===true&&r.successor?.commitVerified===true&&r.successor?.lightTransitionVerified===true&&r.block.genesisSha256===epochId&&r.successor.genesisSha256===epochId&&r.block.headerHeight===b.height&&r.successor.headerHeight===String(BigInt(b.height)+1n),'canonical independently anchored verifier result missing or different');
 return {offer:ns(b.offeredNs,'offer'),proof:ns(b.proofVerifiedNs,'proof completion'),client};
}

// The original Go callee projects client reports; it does not embed raw verifier
// stdout. Validate its actual projection without manufacturing omitted evidence.
function projectedIdentity(b,mode,verifierSHA){
 requireValue(txHash(b.nativeHash)&&txHash(b.abciHash)&&b.nativeHash!==b.abciHash&&/^[1-9][0-9]*$/.test(b.height)&&Number.isSafeInteger(b.index)&&b.index>=0&&b.index<=0xffffffff,'original projected transaction coordinates missing');
 const o=b.observation,c=b.confirmation;
 for(const r of [o,c])requireValue(object(r)&&r.transactionType==='pq_transfer'&&r.nativeTransactionHash===b.nativeHash&&r.abciTransactionHash===b.abciHash&&r.readbackIndexMode===mode&&r.members===1&&r.rejectedMembers===0&&r.actualOfferToFinalityMeasured===false&&r.sustainedTPSQualified===false,'projected original client identity differs');
 requireValue(o.readbackOnly===false&&o.submissionAttempts===1&&o.independentFinalityVerified===false&&o.effectiveBusinessFinalized===0&&['committed_observed','submission_unknown'].includes(o.status),'projected original single submission missing');
 let client=null;
 if(o.submissionToFirstCommittedRPCObservationNs!==null){
  client=ns(o.submissionToFirstCommittedRPCObservationNs,'projected first RPC');
  requireValue(['post_response','original_get'].includes(o.firstCommittedRPCObservationSource)&&o.firstCommittedRPCHeight===b.height&&o.firstCommittedRPCIndex===b.index,'projected first RPC coordinates differ');
 }else requireValue(o.firstCommittedRPCObservationSource===''&&o.firstCommittedRPCHeight==='0'&&o.firstCommittedRPCIndex===null,'missing projected RPC observation invented coordinates');
 if(o.status==='committed_observed')requireValue(client!==null&&o.effectiveBusinessIncludedObserved===1&&o.executionHeight===b.height&&o.cometIndex===b.index,'projected committed coordinates differ');
 else requireValue(o.initialSubmissionUnknown===true||client!==null,'projected UNKNOWN identity missing');
 requireValue(c.readbackOnly===true&&c.submissionAttempts===0&&c.originalReadbackAttempts===1&&c.status==='committed_observed'&&c.effectiveBusinessIncludedObserved===1&&c.executionHeight===b.height&&c.cometIndex===b.index&&c.independentFinalityVerified===true&&c.effectiveBusinessFinalized===1&&c.registrationFinalized===false&&c.consensusExecutionOutcome==='succeeded'&&c.proofVerificationStatus==='verified_original_transaction'&&c.proofVerifierSha256===verifierSHA&&hex(c.trustContextSha256,64)&&c.submissionToFirstCommittedRPCObservationNs===null&&Array.isArray(c.finalizedBusinessHashes)&&c.finalizedBusinessHashes.length===1&&c.finalizedBusinessHashes[0]===b.nativeHash,'projected original verifier receipt differs');
 return {offer:ns(b.offeredNs,'offer'),proof:ns(b.proofVerifiedNs,'proof completion'),client};
}

function projectedClientStages(originals){
 const phases=['inputPreparationNs','intentDurabilityNs','submissionHTTPNs','submissionValidationNs','originalReadbackHTTPNs','originalReadbackValidationNs','proofCollectionHTTPNs','collectorIdentityValidationNs','proofDurabilityNs'];
 const verifier=['verifierPreparationNs','verifierProcessNs','verifierEvidenceDurabilityNs','verifierResultValidationNs','proofVerificationNs'];
 return Object.fromEntries(['observation','confirmation'].map(role=>{
  const rows=[...originals.values()].map(b=>b[role]),verified=rows.filter(r=>r.independentFinalityVerified);
  for(const r of rows){const parts=verifier.slice(0,4).map(k=>ns(r[k],role+' '+k)),total=ns(r.proofVerificationNs,role+' verifier total');requireValue(parts.reduce((a,b)=>a+b,0n)<=total&&(r.independentFinalityVerified||total===0n),'original verifier stages exceed total or report execution without verification');}
  return [role,Object.fromEntries([
   ...phases.map(k=>['clientPhases.'+k,freshTimingQuantiles(rows.map(r=>ns(r.clientPhases?.[k],role+' '+k)))]),
   ...verifier.map(k=>[k,{...freshTimingQuantiles(verified.map(r=>ns(r[k],role+' '+k))),notInvokedSamples:rows.length-verified.length}])
  ])];
 }));
}

function quantileDelta(before,after){
 const result={beforeSamples:before?.samples??0,afterSamples:after?.samples??0,sampleCountsEqual:(before?.samples??0)===(after?.samples??0)};
 for(const p of [50,95,99]){
  const key='p'+p+'Ns',a=before?.[key]??null,b=after?.[key]??null;
  result['p'+p]={beforeNs:a,afterNs:b,deltaNs:a===null||b===null?null:String(BigInt(b)-BigInt(a)),relativePercent:a===null||b===null||BigInt(a)===0n?null:{numerator:String((BigInt(b)-BigInt(a))*100n),denominator:a}};
 }
 return result;
}
function compareQuantiles(before={},after={}){return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])].sort().map(k=>[k,quantileDelta(before[k],after[k])]));}
function compareArms(before,after){
 return {interpretation:'Observed after-minus-before quantile differences, not per-transaction matched samples or a causal improvement claim. Missing data stays null; ratios use exact signed rational percentages.',causalImprovementProven:false,latencyNs:compareQuantiles(before.latencyNs,after.latencyNs),nodeBlocks:before.nodeBlocks.map((b,i)=>{
  const a=after.nodeBlocks[i];requireValue(b.storage===a.storage,'paired storage profile differs');return {nodeIndex:b.nodeIndex,storage:b.storage,beforeBlockCount:b.businessBlockCount,afterBlockCount:a.businessBlockCount,...Object.fromEntries(['finalizeNs','outerCommitNs','persistenceSampleNs','unattributedOuterCommitNs'].map(k=>[k,quantileDelta(b[k],a[k])])),stagesNs:compareQuantiles(b.stagesNs,a.stagesNs)};
 }),...(before.clientStagesNs&&after.clientStagesNs?{clientStagesNs:Object.fromEntries(['observation','confirmation'].map(role=>[role,compareQuantiles(before.clientStagesNs[role],after.clientStagesNs[role])]))}:{})};
}

function businessFlow(originals,start,end){
 const width=1000000000n,count=Number((end-start+width-1n)/width),kinds=['offered','firstNodeExecutionCompleted','firstNodeDurable','allNodesDurable','independentProofCompleted'];
 const buckets=Array.from({length:count},(_,i)=>{
  const a=start+BigInt(i)*width,b=a+width<end?a+width:end;
  return {startNs:String(a),endNs:String(b),durationNs:String(b-a),counts:Object.fromEntries(kinds.map(k=>[k,0]))};
 });
 const events=[];let initiallyUnknown=0,submissionUnknown=0;const lateness=[],afterWindowEvents={allNodesDurable:0};
 for(const b of originals.values()){
  for(const [kind,t]of [['offered',b.offer],['firstNodeExecutionCompleted',b.firstExecution],['firstNodeDurable',b.firstDurable],['allNodesDurable',b.allDurable],['independentProofCompleted',b.proof]]){
   requireValue(t>=start,'business flow event precedes original measurement');
   if(kind==='allNodesDurable'&&t>end){afterWindowEvents.allNodesDurable++;continue;}
   requireValue(t<=end,'business flow event outside original measurement');
   const index=Math.min(count-1,Number((t-start)/width));buckets[index].counts[kind]++;events.push({kind,t});
  }
  if(b.observation.initialSubmissionUnknown===true)initiallyUnknown++;
  if(b.observation.status==='submission_unknown')submissionUnknown++;
  if(b.offerLatenessNs!==undefined)lateness.push(numericDuration(b.offerLatenessNs,'reported offer lateness'));
 }
 events.sort((a,b)=>a.t<b.t?-1:a.t>b.t?1:0);
 let offered=0,durable=0,allDurable=0,proof=0,previous=start,q1=0,q2=0,q3=0,peak1=0,peak2=0,peak3=0,area1=0n,area2=0n,area3=0n;
 for(let i=0;i<events.length;){
  const t=events[i].t;area1+=BigInt(q1)*(t-previous);area2+=BigInt(q2)*(t-previous);area3+=BigInt(q3)*(t-previous);
  while(i<events.length&&events[i].t===t){const k=events[i++].kind;if(k==='offered')offered++;else if(k==='firstNodeDurable')durable++;else if(k==='allNodesDurable')allDurable++;else if(k==='independentProofCompleted')proof++;}
  q1=offered-durable;q2=durable-proof;q3=offered-allDurable;requireValue(q1>=0&&q2>=0&&q3>=0,'business flow has negative backlog');
  peak1=Math.max(peak1,q1);peak2=Math.max(peak2,q2);peak3=Math.max(peak3,q3);previous=t;
 }
 area1+=BigInt(q1)*(end-previous);area2+=BigInt(q2)*(end-previous);area3+=BigInt(q3)*(end-previous);
 let pending1=0,pending2=0,pending3=0;
 for(const b of buckets){
  pending1+=b.counts.offered-b.counts.firstNodeDurable;pending2+=b.counts.firstNodeDurable-b.counts.independentProofCompleted;pending3+=b.counts.offered-b.counts.allNodesDurable;
  b.backlogAtEnd={offeredAwaitingFirstDurable:pending1,firstDurableAwaitingIndependentProof:pending2,offeredAwaitingAllNodesDurable:pending3};
  b.observedRates=Object.fromEntries(kinds.map(k=>[k,{numerator:String(BigInt(b.counts[k])*width),denominatorNs:b.durationNs}]));
 }
 return {bucketWidthNs:String(width),buckets,afterWindowEvents,distinctAcceptanceTimeMeasured:false,acceptedThroughput:null,interpretation:'Parent-clock events from the original callee. Execution/durability completion and queued proof observation are distinct; none is a measurement of earliest BFT formation. All-node durable events after the original window stay outside throughput buckets and leave observable window-end backlog. Internal boundaries are left-inclusive; the final endpoint is included in the last bucket.',backlog:{offeredAwaitingAllNodesDurable:{peak:peak3,atEnd:q3,timeWeightedMean:{numeratorCountNs:String(area3),denominatorNs:String(end-start)}},offeredAwaitingFirstDurable:{peak:peak1,atEnd:q1,timeWeightedMean:{numeratorCountNs:String(area1),denominatorNs:String(end-start)}},firstDurableAwaitingIndependentProof:{peak:peak2,atEnd:q2,timeWeightedMean:{numeratorCountNs:String(area2),denominatorNs:String(end-start)}}},offerLatenessNs:{...freshTimingQuantiles(lateness),missingSamples:originals.size-lateness.length},initialSubmissionUnknown:initiallyUnknown,initialSubmissionUnknownFraction:{numerator:initiallyUnknown,denominator:originals.size},submissionUnknownBeforeIndependentReadback:submissionUnknown,submissionUnknownFraction:{numerator:submissionUnknown,denominator:originals.size},independentlyReconciledUnknownSubmissions:submissionUnknown,coverage:'All planned business identities in this completed qualified arm. Failed/aborted windows remain original guard failures and are not represented as zero-error success here.'};
}

function completedScans(scans,projected){
 if(!Array.isArray(scans))return false;
 if(!projected)return scans.length===2&&scans.every(scan=>Array.isArray(scan)&&scan.length===0);
 // Original controller appends metadata only when its owned PID set is empty.
 // The list can retain an earlier empty scan if a later scan saw a child;
 // cleanupComplete records that the final two were consecutive empty scans.
 if(scans.length<2||scans.length>2400)return false;
 let prior=-1;
 return scans.every(scan=>{
  if(!object(scan)||Object.keys(scan).length!==2||!Number.isSafeInteger(scan.elapsedMs)||scan.elapsedMs<prior||scan.elapsedMs<0||scan.elapsedMs>120000||!Number.isSafeInteger(scan.hostIdentities)||scan.hostIdentities<1)return false;
  prior=scan.elapsedMs;return true;
 });
}

function adaptOriginal(data,expected){
 requireValue(data.sameVM===true&&Number.isSafeInteger(data.sameProcessPID)&&data.sameProcessPID>0&&data.sameProcessPID===expected.sameProcessPID&&data.clockDomain==='pq-fresh:'+data.sameProcessPID&&data.clockDomain===expected.clockDomain,'original shared process clock differs');
 requireValue(data.syntheticOnly===true&&data.publicDeployment===false&&data.nativeGrant===false&&data.sustainedTPSQualified===false&&data.protocolCommit===expected.protocolCommit&&data.clientCommit===expected.performanceClientCommit&&data.clientTree===expected.clientSourceTree,'original callee source or classification differs');
 const roles=['consensus.test','ynx-bft-gatewayd','ynx-consensus-perf-client','ynx-consensus-proof-verify'];
 requireValue(object(data.binaries)&&Object.keys(data.binaries).length===4&&expected.verifierRole==='ynx-consensus-proof-verify','original four ELF identities required');
 for(const role of roles){const b=data.binaries[role];requireValue(object(b)&&b.sha256===expected.binaries[role]&&b.commit===(role==='ynx-consensus-perf-client'?expected.performanceClientCommit:expected.protocolCommit)&&Number.isSafeInteger(b.bytes)&&b.bytes>0,'original ELF pin differs');}
 const leaves=['internal/consensus/pq_network_e2e_test.go','internal/consensus/pq_network_business_test.go','internal/consensus/pq_network_fresh_business_test.go'];
 requireValue(object(data.sourceLeaves)&&object(expected.sourceLeaves)&&Object.keys(data.sourceLeaves).length===3&&Object.keys(expected.sourceLeaves).length===3&&leaves.every(k=>hex(expected.sourceLeaves[k],64)&&data.sourceLeaves[k]===expected.sourceLeaves[k]),'original source leaf pins differ');
 requireValue(Array.isArray(data.arms)&&data.arms.length===2&&Array.isArray(data.phaseRows)&&data.phaseRows.length<=maxRows&&data.businessFinalized===2*expected.businessPerArm&&data.birthsExcluded===34&&expected.businessPerArm===16,'original bounded fresh pair count differs');
 const arms=data.arms.map(a=>{
  requireValue(['before','after'].includes(a.name)&&a.genesisSHA256===expected.epochs[a.name]&&Array.isArray(a.rows)&&a.rows.length===16&&Array.isArray(a.births)&&a.births.length===17&&a.offeredBusiness===16&&a.finalizedBusiness===16&&a.offeredRatePerSecond===2&&Number.isSafeInteger(a.maximumInFlight)&&a.maximumInFlight>0&&a.maximumInFlight<=4&&a.sustainedTPSQualified===false,'original fresh arm profile differs');
  requireValue(a.births.every(b=>b.registrationFinalized===true&&b.finalizedBusinessMembers===0),'registration counted as business');
  const start=numericDuration(a.businessStartNs,'business start'),window=numericDuration(a.businessWindowNs,'business window');
  const business=a.rows.map(r=>{
   requireValue(Number.isSafeInteger(r.height)&&r.height>0,'unsafe original numeric height');
   const offer=numericDuration(r.offerOffsetNs,'offer offset'),proof=numericDuration(r.independentCompletionNs,'independent completion');
   requireValue(numericDuration(r.offerToIndependentNs,'offer to independent')===proof-offer&&numericDuration(r.observedCompletionNs,'observed completion')>=offer&&BigInt(r.observedCompletionNs)<=proof,'original completion arithmetic differs');
   return {...r,height:String(r.height),offeredNs:String(offer),proofVerifiedNs:String(proof),observation:r.submission,confirmation:r.readback};
  });
  return {...a,epochId:a.genesisSHA256,measurementStartNs:String(start),measurementEndNs:String(start+window),business,phaseRows:data.phaseRows.filter(r=>r.arm===a.name).map(r=>({...r,startNs:String(numericDuration(r.startNs,'phase start')),endNs:String(numericDuration(r.endNs,'phase end'))}))};
 });
 requireValue(data.phaseRows.every(r=>['before','after'].includes(r.arm)),'unowned phase rows');
 return {schema:freshPhaseSchema,...Object.fromEntries(['protocolCommit','performanceClientCommit','clientSourceTree','clientCodeTree','vmBootId','clockDomain','binaries'].map(k=>[k,expected[k]])),arms};
}

export function readGuardedFreshPhasePair(raw,guard,expected){
 return readBoundFreshPhasePair(raw,guard,expected,null);
}

export const freshValidationPhases=Object.freeze(['anchor','validator_registry','engine_schedule','engine_snapshot','pq_state','migration_trace_lots','legacy_sponsor','legacy_resource_market','legacy_contracts','legacy_pay','legacy_ai','legacy_trust','ledger_records','pay','resource','resource_sponsor','trust','ide','pq_resources','pq_dex','pq_contracts','pq_native_actions','pq_ethereum','pq_ordered_resources','fee_events','governance','dex','asset_auth','account_abstraction','account_abstraction_policy','ownership_and_vault_supply','staking','supply','app_hash']);

// Diagnostic observations can survive a failed window. This entry never calls
// the successful-pair qualifier and never turns callbacks into qualified TPS.
export function readFreshPhaseDiagnostics(stdout,guard,expected){
 requireValue(Buffer.isBuffer(stdout)&&stdout.length>0&&stdout.length<=1<<20&&isUtf8(stdout),'bounded UTF-8 diagnostic stdout required');
 requireValue(object(expected)&&hex(expected.stdoutSHA256,64)&&createHash('sha256').update(stdout).digest('hex')===expected.stdoutSHA256,'external original diagnostic stdout digest required');
 requireValue(hex(expected.protocolCommit,40)&&guard?.sourceCommit===expected.protocolCommit&&Number.isSafeInteger(expected.sameProcessPID)&&expected.sameProcessPID>0&&guard.child?.pid===expected.sameProcessPID&&expected.clockDomain==='pq-fresh:'+expected.sameProcessPID,'diagnostic source/PID clock differs');
 const leaves=['internal/consensus/pq_network_e2e_test.go','internal/consensus/pq_network_business_test.go','internal/consensus/pq_network_fresh_business_test.go'];
 requireValue(object(expected.sourceLeaves)&&Object.keys(expected.sourceLeaves).length===3&&leaves.every(k=>hex(expected.sourceLeaves[k],64)&&guard.sourcePins?.[k]?.sha256===expected.sourceLeaves[k]),'diagnostic source leaves differ');
 requireValue(hex(expected.consensusBinarySHA256,64)&&guard.binaryPin?.sha256===expected.consensusBinarySHA256&&JSON.stringify(expected.validationPhaseMapping)===JSON.stringify(freshValidationPhases),'diagnostic binary or source phase mapping differs');
 requireValue(guard.cleanupComplete===true&&completedScans(guard.emptyOwnedScans,true)&&Number.isInteger(guard.child.code)&&(guard.firstCause===null||typeof guard.firstCause==='string'&&guard.firstCause.length>0),'terminal original diagnostic guard required');
 const lines=stdout.toString('utf8').split(/\r?\n/),run='=== RUN   TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming';
 requireValue(lines.filter(l=>/^=== RUN   /.test(l)).length===1&&lines.includes(run),'sole original diagnostic RUN required');
 const start=lines.indexOf(run),terminal=lines.findIndex(l=>/PQ_NETWORK_FRESH_BUSINESS_SUMMARY|^--- (PASS|FAIL|SKIP):|^(PASS|FAIL)(\s|$)|^panic:|^fatal error:/.test(l)),commits=new Map(),validations=new Map(),inclusions=new Map(),transactions=[],identities=new Set(),abciIdentities=new Set();
 const bounded=(v,n)=>numericDuration(v,n),key=(a,n,h)=>a+'/'+n+'/'+h;
 const coordinate=(a,n,h)=>requireValue(['before','after'].includes(a)&&Number.isInteger(n)&&n>=0&&n<4&&typeof h==='string'&&/^[1-9][0-9]*$/.test(h),'diagnostic coordinate differs');
 const selected=lines.map((line,index)=>({line,index})).filter(x=>/PQ_NETWORK_FRESH_COMMIT_OBSERVATION|PQ_VALIDATE|PQ_FRESH_TX|PQ_FRESH_INCLUSION/.test(x.line));
 requireValue(selected.length>0&&selected.length<=832,'bounded original diagnostic records required');
 for(const {line,index}of selected){
  const m=/^(PQ_NETWORK_FRESH_COMMIT_OBSERVATION|PQ_VALIDATE|PQ_FRESH_TX|PQ_FRESH_INCLUSION) (\{.*\})$/.exec(line);
  requireValue(m&&index>start&&(terminal===-1||index<terminal),'diagnostic source log shape or terminal order differs');
  const [,tag,text]=m;requireValue(Buffer.byteLength(line)+1<=(tag==='PQ_NETWORK_FRESH_COMMIT_OBSERVATION'?1024:512),'diagnostic line exceeds original bound');
  const x=json(Buffer.from(text),'diagnostic record');
  if(tag==='PQ_NETWORK_FRESH_COMMIT_OBSERVATION'){
   coordinate(x.arm,x.nodeIndex,x.height);const k=key(x.arm,x.nodeIndex,x.height);
   requireValue(commits.size<384&&!commits.has(k)&&x.classification==='local-persistence-observation'&&x.pid===expected.sameProcessPID&&x.clockDomain===expected.clockDomain,'duplicate or foreign diagnostic Commit');
   const f=bounded(x.finalizeStartNs,'Finalize start'),fe=bounded(x.finalizeEndNs,'Finalize end'),c=bounded(x.commitStartNs,'Commit start'),ce=bounded(x.commitEndNs,'Commit end');
   requireValue(f<=fe&&fe<=c&&c<=ce&&bounded(x.commitCallNs,'Commit duration')===ce-c&&typeof x.finalizeOK==='boolean'&&typeof x.commitOK==='boolean'&&typeof x.timingAvailable==='boolean','diagnostic Commit arithmetic differs');
   if(x.timingAvailable){
    const t=x.commitTiming;requireValue(object(t)&&Number.isSafeInteger(t.height)&&String(t.height)===x.height&&typeof t.durable==='boolean'&&object(t.stagesNs),'diagnostic persistence sample differs');
    requireValue(['atomic-json','snapshot-journal-v1','block-journal-v2'].includes(t.storage),'unknown diagnostic storage');
    let sum=0n;for(const [name,value]of Object.entries(t.stagesNs)){requireValue(['validate','json_encode','delta_encode','journal_maintenance','prepare_file','write','file_sync','close_file','rename','directory_sync','version_checkpoint'].includes(name),'unknown diagnostic stage');sum+=bounded(value,'diagnostic stage');}
    requireValue(sum<=bounded(t.elapsedNs,'persistence elapsed')&&BigInt(t.elapsedNs)<=ce-c,'diagnostic persistence stages overlap');
   }
   commits.set(k,x);
  }else if(tag==='PQ_VALIDATE'){
   coordinate(x.a,x.n,x.h);const k=key(x.a,x.n,x.h);
   requireValue(validations.size<384&&!validations.has(k)&&Object.keys(x).length===7&&Number.isInteger(x.f)&&x.f>=-1&&x.f<34&&Array.isArray(x.p)&&x.p.length===34,'duplicate or invalid diagnostic validation');
   x.p.forEach(n=>bounded(n,'validation phase'));const count=x.f===-1?34:x.f+1;
   requireValue(x.p.slice(count).every(n=>n===0),'unexecuted validation suffix must be zero');
   requireValue(bounded(x.d,'hash document')+bounded(x.x,'hash encode')<=BigInt(x.p[33]),'hash child exceeds parent phase');
   validations.set(k,x);
  }else if(tag==='PQ_FRESH_INCLUSION'){
   coordinate(x.a,0,x.h);
   const hasWork=Object.hasOwn(x,'w');
   requireValue(inclusions.size<32&&Object.keys(x).length===(hasWork?8:7)&&x.c===expected.clockDomain&&hex(x.t,64)&&hex(x.b,64)&&!inclusions.has(x.t)&&Number.isSafeInteger(x.i)&&x.i>=0&&x.i<=0x7fffffff&&Array.isArray(x.p)&&x.p.length===4,'duplicate or foreign proposal observation');
   requireValue(expected.inclusionWorkTimingsRequired!==true||hasWork,'missing source-required coordinator call timings');
   if(hasWork){requireValue(Array.isArray(x.w)&&x.w.length===5,'coordinator work shape differs');x.w.forEach(v=>bounded(v,'coordinator work'));requireValue((x.w[0]>0||x.w[1]===0)&&(x.w[2]>0||x.w[3]===0),'uninvoked coordinator work was invented');}
   requireValue(transactions.some(t=>t.arm===x.a&&t.abciHash===x.t&&t.height===x.h&&t.index===x.i),'proposal observation precedes or differs from verified callback');
   for(const span of x.p)if(span!==null){requireValue(Array.isArray(span)&&span.length===2,'proposal span shape differs');requireValue(bounded(span[0],'proposal receipt')<=bounded(span[1],'proposal acceptance'),'proposal clock order differs');}
   inclusions.set(x.t,x);
  }else{
   coordinate(x.arm,0,x.height);
   requireValue(transactions.length<32&&x.kind==='validated-readback'&&hex(x.nativeHash,64)&&hex(x.abciHash,64)&&x.nativeHash!==x.abciHash&&!identities.has(x.nativeHash)&&!abciIdentities.has(x.abciHash)&&Number.isSafeInteger(x.index)&&x.index>=0&&x.index<=0xffffffff&&x.clockDomain===expected.clockDomain,'duplicate or foreign diagnostic transaction');
   const offer=bounded(x.offerOffsetNs,'offer'),end=bounded(x.independentCompletionNs,'callback');
   requireValue(end>=offer&&bounded(x.offerToIndependentNs,'offer to callback')===end-offer&&x.firstRPCClock==='client-duration','diagnostic callback arithmetic/clock differs');
   if(x.firstRPCNs!==null)ns(x.firstRPCNs,'child first RPC duration');
   identities.add(x.nativeHash);abciIdentities.add(x.abciHash);transactions.push(x);
  }
 }
 for(const [k,x]of validations){
  const c=commits.get(k);requireValue(c,'validation has no matching physical Commit');
  const sum=x.p.reduce((s,n)=>s+BigInt(n),0n),outer=c.commitTiming?.stagesNs?.validate;
  requireValue(outer===undefined?x.f!==-1:sum<=BigInt(outer),'validation partition exceeds enclosing stage');
  requireValue(x.f===-1||c.commitOK===false,'failed validation reported successful Commit');
 }
 const observed=transactions.map(x=>{
  const rows=[0,1,2,3].map(n=>commits.get(key(x.arm,n,x.height))),successful=rows.filter(r=>r?.finalizeOK&&r.commitOK&&r.timingAvailable&&r.commitTiming.durable),offer=BigInt(x.offerOffsetNs);
  const delta=(values,all=false)=>values.length===0||all&&values.length!==4?null:String(values.reduce((a,b)=>all?(a>b?a:b):(a<b?a:b))-offer);
  requireValue(successful.every(r=>BigInt(r.finalizeStartNs)>=offer&&BigInt(r.commitEndNs)<=maxNs),'transaction observation precedes original offer');
  const first=delta(successful.map(r=>BigInt(r.commitEndNs)));
  requireValue(first===null||BigInt(first)<=BigInt(x.offerToIndependentNs),'callback precedes every captured durable observation');
  const inclusion=inclusions.get(x.abciHash);requireValue(expected.inclusionObservationRequired!==true&&expected.inclusionWorkTimingsRequired!==true||inclusion,'missing source-required final-block proposal observation');
  if(inclusion?.w)requireValue(BigInt(inclusion.w[1])+BigInt(inclusion.w[3])+BigInt(inclusion.w[4])<=BigInt(x.offerToIndependentNs),'coordinator work exceeds original callback interval');
  const spans=inclusion?.p??[null,null,null,null];
  const boundSpans=spans.map((span,n)=>{if(span===null)return null;requireValue(BigInt(span[0])>=offer&&span[1]<=x.independentCompletionNs,'proposal observation outside original offer/callback interval');const c=rows[n];if(!c)return null;requireValue(c.finalizeOK&&c.commitOK&&c.timingAvailable&&c.commitTiming.durable&&span[1]<=c.finalizeStartNs,'proposal observation has no matching durable node or bounded parent clock');return span;});
  return {...x,finalBlockHash:inclusion?.b??null,acceptedProposalNodeObservations:spans,unboundProposalNodes:spans.filter(s=>s!==null).length-boundSpans.filter(s=>s!==null).length,coordinatorWork:inclusion?.w??null,firstNodeProposalReceiptNs:delta(boundSpans.filter(s=>s!==null).map(s=>BigInt(s[0]))),firstNodeProposalAcceptedNs:delta(boundSpans.filter(s=>s!==null).map(s=>BigInt(s[1]))),observedDurableNodes:successful.length,firstNodeFinalizeNs:delta(successful.map(r=>BigInt(r.finalizeEndNs))),firstNodeDurableNs:first,allNodesDurableNs:delta(successful.map(r=>BigInt(r.commitEndNs)),true)};
 });
 const arms=['before','after'].map(arm=>{
  const values=[...validations.values()].filter(x=>x.a===arm),total=values.reduce((sum,x)=>sum+x.p.reduce((s,n)=>s+BigInt(n),0n),0n),tx=observed.filter(x=>x.arm===arm);
  const rows=[...commits.values()].filter(x=>x.arm===arm),sampled=rows.filter(x=>x.timingAvailable),stages=[...new Set(sampled.flatMap(x=>Object.keys(x.commitTiming.stagesNs)))].sort();
  const work=tx.filter(x=>x.coordinatorWork!==null).map(x=>x.coordinatorWork),coordinatorCalls=Object.fromEntries([['inclusionProbe',0,1],['fullCommitCheck',2,3],['hostContext',null,4]].map(([name,count,duration])=>[name,{perCallbackAccumulatedNs:freshTimingQuantiles(work.filter(w=>count===null||w[count]>0).map(w=>w[duration])),observedCalls:String(work.reduce((sum,w)=>sum+BigInt(count===null?1:w[count]),0n)),notInvokedCallbacks:count===null?0:work.filter(w=>w[count]===0).length,missingCallbacks:tx.length-work.length}]));
  return {arm,physicalCommitObservations:rows.length,successfulDurableCommitObservations:rows.filter(x=>x.finalizeOK&&x.commitOK&&x.timingAvailable&&x.commitTiming.durable).length,validatedCallbackObservations:tx.length,coordinatorCalls,outerCommitNs:freshTimingQuantiles(rows.map(x=>x.commitCallNs)),persistenceStagesNs:Object.fromEntries(stages.map(k=>[k,freshTimingQuantiles(sampled.filter(x=>Object.hasOwn(x.commitTiming.stagesNs,k)).map(x=>x.commitTiming.stagesNs[k]))])),hashChildNs:{document:freshTimingQuantiles(values.filter(x=>x.f===-1||x.f===33).map(x=>x.d)),encodeDigest:freshTimingQuantiles(values.filter(x=>x.f===-1||x.f===33).map(x=>x.x))},phases:freshValidationPhases.map((name,i)=>{const samples=values.filter(x=>x.f===-1||i<=x.f).map(x=>x.p[i]),sum=samples.reduce((s,n)=>s+BigInt(n),0n);return {name,durationNs:freshTimingQuantiles(samples),summedTimerShare:{numeratorNs:String(sum),denominatorNs:String(total)}};}),latencyNs:Object.fromEntries(['firstNodeProposalReceiptNs','firstNodeProposalAcceptedNs','firstNodeFinalizeNs','firstNodeDurableNs','allNodesDurableNs','offerToIndependentNs'].map(k=>[k,{...freshTimingQuantiles(tx.filter(x=>x[k]!==null).map(x=>x[k])),missingSamples:tx.filter(x=>x[k]===null).length}]))};
 });
 const progressStages=originalProgressStages(lines,start,terminal===-1?lines.length:terminal,true),hostPreparationStages=hostPreparationReadback(progressStages,observed,expected.hostPreparationTimingsRequired===true);
 return {progressStages,hostPreparationStages,classification:'original-log-diagnostic-observations',executionAuthorized:false,sustainedTPSQualified:false,fullPairQualified:false,independentProofReverifiedHere:false,firstCause:guard.firstCause,childCode:guard.child.code,sourceCommit:expected.protocolCommit,clockDomain:expected.clockDomain,stdoutSHA256:expected.stdoutSHA256,arms,transactions:observed,interpretation:'Observed callbacks from the pinned original callee, not independent verification by this reader. Missing nodes remain null; failed phase suffix is unexecuted. Hash child intervals are not added twice. Summed node timers are not wall time/CPU. Execution/durability and queued verification completion are distinct; earliest block arrival/BFT formation and sustained TPS are unmeasured.'};
}

const hostPreparationPhaseNames=['totalWallNs','lightBlocksWallNs','inputEncodingWallNs','checkpointLoadWallNs','checkpointCaptureWallNs','checkpointDecodeWallNs','checkpointValidateWallNs','checkpointRetryWaitNs','retainInputsWallNs','contextWriteWallNs'];
function originalProgressStages(lines,runIndex,summaryIndex,allowIncomplete=false){
 const selected=lines.map((line,index)=>({line,index})).filter(r=>r.line.includes('PQ_NETWORK_FRESH_PROGRESS'));
 if(selected.length===0)return null;
 requireValue(selected.length<=1024,'bounded original progress events required');
 const pending=new Map(),seen=new Set(),spans=[];
 for(const {line,index}of selected){
  const m=/^[ \t]+pq_network_fresh_business_test\.go:[1-9][0-9]*: PQ_NETWORK_FRESH_PROGRESS arm=(before|after) phase=([a-z][a-z0-9-]{0,63}) node=(-1|[0-3]) index=(-1|[0-9]|1[0-6]) event=(begin|complete) offsetNs=([0-9]+) durationNs=([0-9]+)(?: hostNs=(\[.*\]))?$/.exec(line);
  requireValue(m&&index>runIndex&&index<summaryIndex&&Buffer.byteLength(line)+1<=512,'original progress shape, line bound or log order differs');
  const [,arm,phase,node,business,event,offset,duration,hostJSON]=m,key=[arm,phase,node,business].join('/'),at=BigInt(offset),elapsed=BigInt(duration);
  requireValue(at<=120000000000n&&elapsed<=120000000000n,'original progress outside bounded clock');
  let hostTimingsNs;
  if(hostJSON!==undefined){
   requireValue(phase==='business-host-context'&&node==='-1'&&Number(business)>=0&&Number(business)<16&&event==='complete','Host timing attached to a foreign progress phase');
   const values=json(Buffer.from(hostJSON),'Host progress timings');
   requireValue(Array.isArray(values)&&values.length===10,'ten original Host timings required');
   const times=values.map(v=>numericDuration(v,'Host phase'));
   requireValue(times.slice(1).reduce((a,b)=>a+b,0n)<=times[0]&&times[0]<=elapsed,'Host child timing overlaps or exceeds original parent span');
   hostTimingsNs=times.map(String);
  }
  if(event==='begin'){
   requireValue(elapsed===0n&&!seen.has(key),'duplicate or nonzero original progress begin');
   seen.add(key);pending.set(key,{arm,phase,nodeIndex:Number(node),businessIndex:Number(business),startNs:String(at)});
  }else{
   const begin=pending.get(key),start=begin===undefined?undefined:BigInt(begin.startNs);
   requireValue(start!==undefined&&at>=start&&at-start===elapsed,'original progress completion arithmetic differs');
   pending.delete(key);spans.push({...begin,endNs:String(at),durationNs:String(elapsed),...(hostTimingsNs?{hostTimingsNs}:{})});
  }
 }
 requireValue(allowIncomplete||pending.size===0,'original progress incomplete despite successful test');
 const groups=new Map();
 for(const span of spans){
  const key=[span.arm,span.phase,span.nodeIndex].join('/');
  if(!groups.has(key))groups.set(key,{arm:span.arm,phase:span.phase,nodeIndex:span.nodeIndex,values:[]});
  groups.get(key).values.push(BigInt(span.durationNs));
 }
 return {clock:'original parent-process monotonic offsets',spans,unfinished:[...pending.values()],groups:[...groups.values()].map(({values,...g})=>({...g,durationNs:freshTimingQuantiles(values)})),additiveWallTimeMeasured:false,interpretation:'Original explicit call spans include nested work, scheduling and bounded preparation queue wait. Host worker calls may overlap coordinator calls and other phases. Do not sum spans or cross-transaction Host/coordinator work into wall time or CPU, or interpret them as earliest BFT formation.'};
}
function hostPreparationReadback(progress,callbacks,required,summary=false){
 const host=(progress?.spans??[]).filter(s=>s.phase==='business-host-context'&&s.nodeIndex===-1),measured=host.filter(s=>s.hostTimingsNs!==undefined),used=new Set();
 for(const callback of callbacks){
  const arm=callback.arm,offer=BigInt(callback.offerOffsetNs),end=BigInt(callback.independentCompletionNs);
  let ordinal=callback.sourceOfferOrdinal;
  if(ordinal===undefined&&progress){
   const offers=[...progress.spans,...progress.unfinished].filter(s=>s.arm===arm&&s.phase==='business-offer'&&s.nodeIndex===-1&&s.businessIndex>=0&&BigInt(s.startNs)<=offer).sort((a,b)=>BigInt(a.startNs)<BigInt(b.startNs)?-1:BigInt(a.startNs)>BigInt(b.startNs)?1:0),candidate=offers.at(-1);
   if(candidate&&candidate.endNs!==undefined&&offer<=BigInt(candidate.endNs)&&offers.filter(s=>s.startNs===candidate.startNs).length===1)ordinal=candidate.businessIndex;
  }
  const found=ordinal===undefined?undefined:measured.find(s=>s.arm===arm&&s.businessIndex===ordinal),key=arm+'/'+ordinal;
  requireValue(!required||found&&!used.has(key),'source-required Host timing lacks its original offer/preparation ordinal');
  if(found){
   requireValue(BigInt(found.startNs)>=offer&&BigInt(found.endNs)<=end,'Host preparation outside original offer/callback interval');
   if(callback.coordinatorWork)requireValue(BigInt(found.hostTimingsNs[0])<=BigInt(callback.coordinatorWork[4]),'Host measured total exceeds original Host call');
   used.add(key);
  }
 }
 if(summary&&required)requireValue(measured.length===callbacks.length,'successful source-required Host preparation count differs');
 const wallCoverage={
  observations:measured.map(s=>{
   const total=BigInt(s.hostTimingsNs[0]),children=s.hostTimingsNs.slice(1).reduce((sum,n)=>sum+BigInt(n),0n);
   return {arm:s.arm,businessIndex:s.businessIndex,progressSpanNs:s.durationNs,helperTotalNs:String(total),helperChildrenNs:String(children),outsideHelperWallNs:String(BigInt(s.durationNs)-total),insideHelperUnattributedWallNs:String(total-children)};
  }),
  interpretation:'Exact per-preparation subtraction of nested wall intervals. Outside-helper time includes queue, worker result delivery and coordinator scheduling/logging; it is not a direct queue-wait measurement. Inside-helper unattributed time is not a named operation or CPU measurement. Residuals are not added across overlapping transactions, and quantiles must not be subtracted. Only completed preparations with all10 actual timers are included, even if no verified callback completed; missing and unfinished preparations have no residual sample.'
 };
 wallCoverage.arms=['before','after'].map(arm=>{const rows=wallCoverage.observations.filter(s=>s.arm===arm);return {arm,completedPreparations:rows.length,outsideHelperWallNs:freshTimingQuantiles(rows.map(s=>s.outsideHelperWallNs)),insideHelperUnattributedWallNs:freshTimingQuantiles(rows.map(s=>s.insideHelperUnattributedWallNs))};});
 return {classification:'actual original successful preparation DATA, not proof credit or CPU utilization',wallCoverage,phaseOrder:hostPreparationPhaseNames,observations:measured,unfinished:(progress?.unfinished??[]).filter(s=>s.phase==='business-host-context'),arms:['before','after'].map(arm=>{const rows=measured.filter(s=>s.arm===arm);return {arm,completedPreparations:rows.length,completedWithoutStageTimings:host.filter(s=>s.arm===arm&&s.hostTimingsNs===undefined).length,phases:Object.fromEntries(hostPreparationPhaseNames.map((name,i)=>[name,{...freshTimingQuantiles(rows.filter(s=>i!==7||s.hostTimingsNs[i]!=='0').map(s=>s.hostTimingsNs[i])),notInvokedSamples:i===7?rows.filter(s=>s.hostTimingsNs[i]==='0').length:0}]))};}),childrenAreIncludedInTotal:true,sourceRequired:required,independentProofReverifiedHere:false,interpretation:'All10 values are actual Host helper wall timers. Capture includes App-lock wait and encoding; queued progress span includes waiting before the single worker starts. Completed preparation is not a finalized business transaction. Missing or unfinished preparation is not measured zero. A zero retry-wait field means the successful helper never entered its5ms crossing retry; it is excluded from duration samples and counted as not invoked. Total and children are not added twice.'};
}

// Original compiled Go test emits this exact bounded public JSON in stdout.
// Bind those original log bytes directly; do not create or rewrite a guard.
export function readGuardedFreshPhaseLog(stdout,guard,expected){
 requireValue(Buffer.isBuffer(stdout)&&stdout.length>0&&stdout.length<=1<<20&&isUtf8(stdout),'bounded UTF-8 original stdout required');
 const digest=createHash('sha256').update(stdout).digest('hex');
 requireValue(boundOriginalDigest(guard,expected,'stdoutSHA256',digest),'original stdout digest differs');
 const name='TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming',lines=stdout.toString('utf8').split(/\r?\n/);
 if(lines.at(-1)==='')lines.pop();
 const pass=new RegExp('^--- PASS: '+name+' \\([0-9]+(?:\\.[0-9]+)?s\\)$');
 requireValue(lines.filter(l=>/^=== RUN   /.test(l)).length===1&&lines.includes('=== RUN   '+name)&&lines.filter(l=>/^--- PASS: /.test(l)).length===1&&lines.some(l=>pass.test(l))&&lines.filter(l=>l==='PASS').length===1&&lines.at(-1)==='PASS'&&!lines.some(l=>/^\s*--- (FAIL|SKIP):|^FAIL(?:\s|$)|^panic:|^fatal error:/.test(l)),'original fresh test must be the sole RUN/PASS and end with PASS without skip/failure/panic');
 const markers=lines.filter(l=>l.includes('PQ_NETWORK_FRESH_BUSINESS_SUMMARY'));
 requireValue(markers.length===1,'exactly one original fresh summary marker required');
 const match=/^[ \t]+pq_network_fresh_business_test\.go:[1-9][0-9]*: PQ_NETWORK_FRESH_BUSINESS_SUMMARY (\{.*\})$/.exec(markers[0]);
 requireValue(match,'original callee summary log shape differs');
 requireValue(lines.indexOf('=== RUN   '+name)<lines.indexOf(markers[0])&&lines.indexOf(markers[0])<lines.findIndex(l=>pass.test(l))&&lines.findIndex(l=>pass.test(l))<lines.indexOf('PASS'),'original RUN/summary/PASS order differs');
 const raw=Buffer.from(match[1],'utf8');
 requireValue(json(raw,'original stdout summary').version===originalFreshVersion,'original stdout receipt version differs');
 const result=readBoundFreshPhasePair(raw,guard,expected,digest);
 const progressStages=originalProgressStages(lines,lines.indexOf('=== RUN   '+name),lines.indexOf(markers[0])),input=json(raw,'original Host summary');
 const callbacks=input.arms.flatMap(arm=>arm.rows.map((row,i)=>({arm:arm.name,sourceOfferOrdinal:i,offerOffsetNs:row.offerOffsetNs,independentCompletionNs:row.independentCompletionNs})));
 return {...result,progressStages,hostPreparationStages:hostPreparationReadback(progressStages,callbacks,expected.hostPreparationTimingsRequired===true,true)};
}

function readBoundFreshPhasePair(raw,guard,expected,stdoutSHA256){
 requireValue(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=1<<20,'bounded original pair DATA required');
 const input=json(raw,'original phase result'),projected=input.version===originalFreshVersion;
 requireValue(object(expected)&&hex(expected.protocolCommit,40)&&hex(expected.performanceClientCommit,40)&&hex(expected.clientSourceTree,40)&&hex(expected.clientCodeTree,40)&&(projected&&expected.vmBootId===null||typeof expected.vmBootId==='string'&&expected.vmBootId.length>0)&&typeof expected.clockDomain==='string'&&expected.clockDomain.length>0&&Number.isSafeInteger(expected.businessPerArm)&&expected.businessPerArm>0&&expected.businessPerArm<=16&&object(expected.epochs)&&hex(expected.epochs.before,64)&&hex(expected.epochs.after,64)&&expected.epochs.before!==expected.epochs.after&&sameBinaries(expected.binaries,expected.binaries)&&Object.hasOwn(expected.binaries,expected.verifierRole),'external original case/source/clock/binary bindings required');
 if(projected)requireValue(raw.length<=256<<10,'original callee public summary exceeds 256 KiB');
 requireValue(guard?.firstCause===null&&guard.child?.code===0&&guard.cleanupComplete===true&&completedScans(guard.emptyOwnedScans,projected)&&guard.sourceCommit===expected.protocolCommit&&(stdoutSHA256?boundOriginalDigest(guard,expected,'stdoutSHA256',stdoutSHA256):boundOriginalDigest(guard,expected,'resultSHA256',createHash('sha256').update(raw).digest('hex'))),'original completed guard and raw result digest required');
 if(projected)requireValue(guard.child.pid===expected.sameProcessPID,'original guard child differs from the phase clock process');
 const data=projected?adaptOriginal(input,expected):input;
 requireValue(data.schema===freshPhaseSchema&&['protocolCommit','performanceClientCommit','clientSourceTree','clientCodeTree','vmBootId','clockDomain'].every(k=>data[k]===expected[k])&&sameBinaries(data.binaries,expected.binaries)&&Array.isArray(data.arms)&&data.arms.length===2,'fresh pair source/VM/binary identity differs');
 const used=new Set(), summaries=[];
 for(let armIndex=0;armIndex<2;armIndex++){
  const arm=data.arms[armIndex],name=['before','after'][armIndex],mode=['decode-index-again','reuse-validated-index'][armIndex];
  requireValue(arm.name===name&&arm.epochId===expected.epochs[name]&&arm.readbackIndexMode===mode&&Array.isArray(arm.business)&&arm.business.length>0&&arm.business.length<=expected.businessPerArm*4&&Array.isArray(arm.phaseRows)&&arm.phaseRows.length<=maxRows,'original arm/mode/epoch/row bound differs');
  const measureStart=ns(arm.measurementStartNs,"measurement start"),measureEnd=ns(arm.measurementEndNs,"measurement end");requireValue(measureEnd>measureStart,"measurement window missing");
  const phases=new Map();
  for(const input of arm.phaseRows){
   requireValue(input.arm===name&&Number.isInteger(input.nodeIndex)&&input.nodeIndex>=0&&input.nodeIndex<4&&typeof input.height==='string'&&/^[1-9][0-9]*$/.test(input.height)&&input.clockDomain===expected.clockDomain&&['finalize','commit'].includes(input.phase),'original per-H/node/clock phase identity differs');
   const start=ns(input.startNs,'phase start'),end=ns(input.endNs,'phase end');requireValue(end>start,'missing actual phase duration');
   const key=input.nodeIndex+'/'+input.height+'/'+input.phase;requireValue(!phases.has(key),'duplicate per-node/H phase is not a second physical Commit');
   const row={...input,start,end};if(row.phase==='commit')row.sampleElapsed=checkCommit(row);else requireValue(row.commitTiming===undefined,'Finalize must not carry fabricated Commit sample');
   phases.set(key,row);
  }
  const originals=new Map();let repeatedReadbacks=0;
  for(const b of arm.business){
   const times=(projected?projectedIdentity:originalIdentity)(b,mode,expected.binaries[expected.verifierRole],arm.epochId);requireValue(times.proof>=times.offer&&times.offer>=measureStart&&times.proof<=measureEnd,'proof/offer outside original measurement window');
   const prior=originals.get(b.nativeHash);
   if(prior){requireValue(prior.abciHash===b.abciHash&&prior.height===b.height&&prior.index===b.index&&prior.offer===times.offer,'repeat readback changed original coordinates or invented offer clock');prior.proof=prior.proof<times.proof?prior.proof:times.proof;repeatedReadbacks++;continue;}
   requireValue(!used.has(b.nativeHash)&&!used.has(b.abciHash),'two fresh epochs reused the same original transaction');used.add(b.nativeHash);used.add(b.abciHash);
   originals.set(b.nativeHash,{...b,...times});
  }
  requireValue(originals.size===expected.businessPerArm,'missing unique original effective business identities');
  const heights=new Set([...originals.values()].map(b=>b.height));
  const duration={firstNodeFinalize:[],firstNodeDurable:[],allNodesDurable:[],independentProofCompletion:[],clientSubmissionToFirstCommittedRPC:[]};
  let firstOffer=null,lastProof=0n;
  for(const b of originals.values()){
   const finalize=[],commit=[];
   for(let node=0;node<4;node++){
    const f=phases.get(node+'/'+b.height+'/finalize'),c=phases.get(node+'/'+b.height+'/commit');
    requireValue(f&&c&&f.start>=b.offer&&c.start>=f.end,'missing four-node business H phase, wrong offer clock or wrong call order');finalize.push(f.end);commit.push(c.end);
   }
   const min=v=>v.reduce((a,b)=>a<b?a:b),max=v=>v.reduce((a,b)=>a>b?a:b);
   requireValue(b.proof>=min(commit),'proof completion precedes every captured durable execution');
   b.firstExecution=min(finalize);b.firstDurable=min(commit);b.allDurable=max(commit);
   duration.firstNodeFinalize.push(min(finalize)-b.offer);duration.firstNodeDurable.push(min(commit)-b.offer);duration.allNodesDurable.push(max(commit)-b.offer);duration.independentProofCompletion.push(b.proof-b.offer);if(b.client!==null)duration.clientSubmissionToFirstCommittedRPC.push(b.client);
   firstOffer=firstOffer===null?b.offer:firstOffer<b.offer?firstOffer:b.offer;lastProof=lastProof>b.proof?lastProof:b.proof;
  }
  const nodeBlocks=[];
  for(let node=0;node<4;node++){
   const commits=[...heights].map(h=>phases.get(node+'/'+h+'/commit')),finals=[...heights].map(h=>phases.get(node+'/'+h+'/finalize'));
   const stageNames=new Set(commits.flatMap(c=>Object.keys(c.commitTiming.stagesNs)));
   const storage=commits[0].commitTiming.storage;requireValue(commits.every(c=>c.commitTiming.storage===storage),'one arm changed storage profile');
   nodeBlocks.push({nodeIndex:node,storage,businessBlockCount:heights.size,finalizeNs:freshTimingQuantiles(finals.map(f=>f.end-f.start)),outerCommitNs:freshTimingQuantiles(commits.map(c=>c.end-c.start)),persistenceSampleNs:freshTimingQuantiles(commits.map(c=>c.sampleElapsed)),unattributedOuterCommitNs:freshTimingQuantiles(commits.map(c=>c.end-c.start-c.sampleElapsed)),stagesNs:Object.fromEntries([...stageNames].sort().map(k=>[k,freshTimingQuantiles(commits.filter(c=>Object.hasOwn(c.commitTiming.stagesNs,k)).map(c=>BigInt(c.commitTiming.stagesNs[k])))]))});
  }
  summaries.push({name,epochId:arm.epochId,readbackIndexMode:mode,receiptQualifiedBusiness:originals.size,repeatedReadbacks,finalizedBusinessHashes:[...originals.keys()],latencyNs:Object.fromEntries(Object.entries(duration).map(([k,v])=>[k,{...freshTimingQuantiles(v),missingSamples:originals.size-v.length}])),flow:businessFlow(originals,measureStart,measureEnd),...(projected?{clientStagesNs:projectedClientStages(originals)}:{}),observedWindowNs:String(lastProof-firstOffer),measurementWindowNs:String(measureEnd-measureStart),receiptWindowRate:{transactions:originals.size,perSecondNumerator:String(BigInt(originals.size)*1000000000n),denominatorNs:String(measureEnd-measureStart)},nodeBlocks});
 }
 return {schema:'ynx-pq-fresh-phase-readback-v1',classification:'measurement-data-not-authority',sourceCommit:expected.protocolCommit,resultSource:stdoutSHA256?'original-go-stdout':'original-json-file',rawResultSHA256:createHash('sha256').update(raw).digest('hex'),...(stdoutSHA256?{stdoutSHA256}:{}),inputEvidence:projected?'original-callee-projected-client-receipts':'embedded-canonical-verifier-output',vmBootId:expected.vmBootId,vmIdentityEvidence:projected?(expected.vmBootId===null?'boot-id-unmeasured; original-callee-process-binding':'external-runner-binding-only'):'receipt-and-external-binding',arms:summaries,pairedQuantileDeltas:compareArms(summaries[0],summaries[1]),independentProofReverifiedHere:false,earliestBFTFormationMeasured:false,executionAuthorized:false,sustainedTPSQualified:false,interpretation:'Original qualified callee/verifier receipts required. Exact per-H physical Commit samples are not multiplied by tx count. Four-node durable times and proof-completion upper bounds are separate; no third-replica/BFT inference or target qualification.'};
}

// Thin normal-runner readback entry, not a process launcher or approval API.
export function readFreshPhaseFile(file){
 requireValue(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&fs.realpathSync(file)===file,'canonical original file required');
 const a=fs.lstatSync(file,{bigint:true});
 requireValue(a.isFile()&&a.nlink===1n&&a.size>0n&&a.size<=1048576n&&(a.mode&0o022n)===0n,'bounded protected original file required');
 requireValue(Number.isInteger(fs.constants.O_NOFOLLOW),'normal POSIX file identity support required');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const opened=fs.fstatSync(fd,{bigint:true});requireValue(opened.ino===a.ino&&opened.dev===a.dev,'original changed during open');
  const raw=Buffer.alloc(Number(a.size));let offset=0;
  while(offset<raw.length){const n=fs.readSync(fd,raw,offset,raw.length-offset,null);requireValue(n>0,'truncated original');offset+=n;}
  const end=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
  for(const key of ['ino','dev','size','mtimeNs','ctimeNs','mode','nlink'])requireValue(a[key]===end[key]&&end[key]===named[key],'original changed during read');
  return raw;
 }finally{fs.closeSync(fd);}
}
export function runFreshPhaseReadback(args){
 requireValue(Array.isArray(args)&&args.length===8,'exact result/guard/expected/output flags required');
 const options={};for(let i=0;i<args.length;i+=2){const key=args[i];requireValue(['--result','--stdout','--diagnostic-stdout','--guard','--expected','--output'].includes(key)&&!Object.hasOwn(options,key),'duplicate or unknown readback flag');options[key]=args[i+1];}
 requireValue(['--result','--stdout','--diagnostic-stdout'].filter(k=>Object.hasOwn(options,k)).length===1&&['--guard','--expected','--output'].every(k=>Object.hasOwn(options,k)),'one original result or stdout and all readback flags required');
 const raw=readFreshPhaseFile(options['--result']??options['--stdout']??options['--diagnostic-stdout']),guard=json(readFreshPhaseFile(options['--guard']),'guard'),expected=json(readFreshPhaseFile(options['--expected']),'expected');
 const summary=(options['--diagnostic-stdout']?readFreshPhaseDiagnostics:options['--stdout']?readGuardedFreshPhaseLog:readGuardedFreshPhasePair)(raw,guard,expected),out=options['--output'],parent=path.dirname(out);
 requireValue(path.isAbsolute(out)&&path.normalize(out)===out&&fs.realpathSync(parent)===parent,'canonical existing output parent required');
 const fd=fs.openSync(out,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(summary)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const directory=fs.openSync(parent,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 return summary;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{runFreshPhaseReadback(process.argv.slice(2));}catch(error){process.stderr.write('fresh phase readback refused: '+error.message+'\n');process.exitCode=1;}
}
