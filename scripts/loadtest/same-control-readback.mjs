// Read-only evidence qualification for the existing frozen classical client pair.
// Cryptographic signatures, Merkle proofs and fee/nonce replay remain the pinned
// Go client's responsibility; this consumer never turns report booleans into a
// new independently authenticated consensus proof.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isUtf8} from 'node:buffer';
const sha=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
function signedBytes(text){
 requireValue(typeof text==='string'&&text.length>0,'signed bytes missing');
 const bytes=Buffer.from(text,'base64');
 requireValue(bytes.toString('base64')===text&&bytes.length<=65536,'signed bytes encoding/bound');
 return bytes;
}
function percentiles(values){
 requireValue(values.length>0&&values.every(v=>Number.isFinite(v)&&v>=0),'monotonic latency missing or invalid');
 const sorted=[...values].sort((a,b)=>a-b);
 return {samples:sorted.length,...Object.fromEntries([50,95,99].map(p=>[`p${p}`,sorted[Math.ceil(p*sorted.length/100)-1]]))};
}
export function qualifySameControlReadback({receipt,report,manifestRaw,journalRaw}){
 requireValue(Buffer.isBuffer(manifestRaw)&&Buffer.isBuffer(journalRaw)&&manifestRaw.length<=1024*1024&&journalRaw.length<=8*1024*1024,'bounded original manifest/journal bytes required');
 const manifest=JSON.parse(manifestRaw);
 requireValue(receipt.firstCause===null&&receipt.allGroupsGone===true&&Array.isArray(receipt.processes)&&receipt.processes.length>0&&receipt.processes.every(p=>p.exited===true&&p.groupGone===true),'window not fully retired');
 const {count,rounds}=receipt,n=count*rounds;
 requireValue(Number.isSafeInteger(count)&&count>0&&Number.isSafeInteger(rounds)&&rounds>=2&&rounds<=32&&n<=2048&&receipt.senderMode==='ready-pool'&&receipt.inclusionMode==='block-scan'&&!receipt.terminalStream&&!receipt.reuseResultSlots&&!receipt.segmentedIntents,'not original bounded full-history pair');
 requireValue(report.chainId===manifest.chainId&&report.genesisSha256===manifest.genesisHash&&report.roundsRequested===rounds&&report.roundsCompleted===rounds&&report.setupErrors?.length===0,'report fixture/completion mismatch');
 const lines=journalRaw.toString('utf8').split('\n');
 requireValue(lines.pop()===''&&lines.length===n+1,'complete signed input inventory required');
 const header=JSON.parse(lines.shift());
 requireValue(header.kind==='YNX_LOCAL_READY_SENDER_V1'&&header.manifestSha256===sha(manifestRaw)&&header.migrationHash===manifest.migrationStateHash&&header.genesisHash===manifest.genesisHash,'signed journal fixture binding mismatch');
 const inputs=new Map(),hashes=new Set(),templates=new Map(),senderNonces=new Set(),senderAddresses=new Map();
 for(const line of lines){
  requireValue(Buffer.byteLength(line)<=65536,'signed input row bound');
  const e=JSON.parse(line),bytes=signedBytes(e.transaction),hash=sha(bytes).toUpperCase(),tx=JSON.parse(bytes);
  requireValue(Number.isSafeInteger(e.index)&&e.index>=0&&e.index<n&&e.sender===e.index%count&&e.round===Math.floor(e.index/count)+1&&!inputs.has(e.index)&&!hashes.has(hash)&&e.hash===hash,'duplicate or unbound signed identity');
  requireValue(tx.type==='transfer'&&tx.chainId===6423&&tx.version===1&&tx.nonce===e.round&&tx.amount===1&&tx.fee===1&&typeof tx.signature==='string'&&/^[a-fA-F0-9]+$/.test(tx.signature)&&typeof tx.publicKey==='string','signed business input shape mismatch');
  const nonceIdentity=JSON.stringify([tx.from,tx.nonce]);
  requireValue(!senderNonces.has(nonceIdentity)&&(!senderAddresses.has(tx.from)||senderAddresses.get(tx.from)===e.sender),'duplicate business sender/nonce or shared sender slot');
  senderNonces.add(nonceIdentity);senderAddresses.set(tx.from,e.sender);
  const template=JSON.stringify([tx.from,tx.to,tx.publicKey]);
  requireValue(!templates.has(e.sender)||templates.get(e.sender)===template,'sender template/nonce sequence changed');
  templates.set(e.sender,template);inputs.set(e.index,{hash,bytes:bytes.toString('base64'),round:e.round});hashes.add(hash);
 }
 requireValue(inputs.size===n&&templates.size===count&&report.transactions?.length===n,'incomplete business identities');
 const seen=new Set(),proofPositions=new Set(),inclusion=[],final=[],offerFinal=[];
 let effective=0,qualified=0;
 for(const r of report.transactions){
  const input=inputs.get(r.index);
  requireValue(input&&!seen.has(r.index)&&r.round===input.round&&r.hash===input.hash&&r.signedTransaction===input.bytes,'report identity missing duplicate or not byte exact');seen.add(r.index);
  const included=Number.isSafeInteger(r.height)&&r.height>0&&r.executionCode===0&&r.quorumVerified===true&&r.transactionProofVerified===true&&r.durableStateVerified===true&&r.durableStateHeight>=r.height&&typeof r.durableSnapshotSha256==='string'&&r.durableSnapshotSha256.length>0&&(!['block-journal','snapshot-journal'].includes(r.durableStoreFormat)||(r.durableInfoVerified===true&&r.durableInfoHeight>=r.durableStateHeight));
  if(included){
   requireValue(typeof r.blockHash==='string'&&r.blockHash.length>0&&Number.isSafeInteger(r.blockTxIndex)&&r.blockTxIndex>=0&&Number.isSafeInteger(r.blockTxTotal)&&r.blockTxIndex<r.blockTxTotal,'block identity/index missing');
   const position=`${r.height}:${r.blockHash}:${r.blockTxIndex}`;requireValue(!proofPositions.has(position),'duplicate block transaction identity');proofPositions.add(position);effective++;inclusion.push(r.inclusionMs);
  }
  if(included&&r.status==='confirmed'&&r.confirmedObservedAt&&r.checkTxIdentityVerified===true&&r.checkTxCode===0){qualified++;final.push(r.confirmationMs);requireValue(Number.isFinite(r.queueDelayMs)&&r.queueDelayMs>=0,'monotonic offer queue span missing');offerFinal.push(r.queueDelayMs+r.confirmationMs);}
 }
 const s=report.summary;
 requireValue(s&&s.input===n&&s.effectiveBusinessIncluded===effective&&s.finalSubmitted===qualified,'claimed business totals differ from full identity readback');
 requireValue(Number.isFinite(s.measurementWindowSeconds)&&s.measurementWindowSeconds>0,'measurement window unavailable');
 requireValue(Math.abs(s.finalSubmittedPerMeasurementSecond-qualified/s.measurementWindowSeconds)<1e-8,'claimed final rate mismatch');
 return {controls:{count,rounds,offeredRate:receipt.offeredRate,stateLayout:receipt.stateLayout,senderMode:receipt.senderMode,inclusionMode:receipt.inclusionMode,terminalStream:!!receipt.terminalStream,reuseResultSlots:!!receipt.reuseResultSlots,gomaxprocs:receipt.caps?.gomaxprocs,gogc:receipt.caps?.gogc,gomemlimit:receipt.caps?.gomemlimit,clientTimeout:receipt.caps?.clientTimeout,clientConcurrency:receipt.caps?.clientConcurrency,clientObservers:receipt.caps?.clientObservers},inputIdentities:n,uniqueSignedByteHashes:hashes.size,effectiveBusinessIncluded:effective,qualifiedClientFinal:qualified,fullWindowClientFinalTPS:qualified/s.measurementWindowSeconds,inclusionMs:percentiles(inclusion),clientFinalMs:percentiles(final),offerToClientFinalMs:percentiles(offerFinal),identityReadback:'complete journal-to-report exact signed bytes/hash/index/sender/nonce binding',signatureAndConsensusVerification:'reported by pinned Go client; not independently repeated by this JavaScript consumer',independentStoppedNodeReplay:null,independentBFTReverification:null,steadyStateTPS:null};
}
export function compareSameControlReadbacks(before,after){
 requireValue(JSON.stringify(before.controls)===JSON.stringify(after.controls),'comparison workload/runtime controls differ');
 requireValue(before.inputIdentities===after.inputIdentities&&before.qualifiedClientFinal===before.inputIdentities&&after.qualifiedClientFinal===after.inputIdentities,'matched complete business windows required');
 return {before,after,fullWindowRateChangePercent:(after.fullWindowClientFinalTPS/before.fullWindowClientFinalTPS-1)*100,clientFinalP95ChangeMs:after.clientFinalMs.p95-before.clientFinalMs.p95,interpretation:'Finite-window client comparison only; actual source/configuration/fixture policy must be bound separately. No sustained capacity, independent BFT proof or ten-minute claim.'};
}

// The expected guard digest comes from the separately inspected local receipt.
// This binds an actual retained Go verifier result; it does not implement a
// second signature engine or authenticate an arbitrary caller-supplied digest.
export function bindBaselineStoppedProof({observationRaw,guardRaw,expectedGuardSHA256,replayRaw,accountsRaw}){
 for(const raw of [observationRaw,guardRaw,replayRaw,accountsRaw])requireValue(Buffer.isBuffer(raw)&&raw.length<=8*1024**2,'bounded original proof bytes required');
 requireValue(/^[a-f0-9]{64}$/.test(expectedGuardSHA256)&&sha(guardRaw)===expectedGuardSHA256,'trusted original guard digest mismatch');
 const guard=JSON.parse(guardRaw),report=JSON.parse(observationRaw),replay=JSON.parse(replayRaw),accounts=JSON.parse(accountsRaw);
 requireValue(guard.admissionCase==='offline-baseline-stopped-01'&&guard.plan?.mode==='stopped_replay'&&guard.plan.binarySHA256==='a77ce29169a4277df163a4cb4b156e32f7a7d3cf2b99bb75d1a6ae66853a19cc'&&guard.firstCause===null&&guard.groupGone===true&&guard.go?.code===0&&guard.go.signal===null&&guard.go.exited===true,'actual original stopped verifier did not complete');
 const names=['TestStoppedNetworkReplay','TestStoppedReadySenderAccountReadback'];
 const passed=[...guard.go.stdout.matchAll(/^--- PASS: (Test[^ /]+) \(/gm)].map(m=>m[1]);
 requireValue(passed.length===2&&names.every(n=>passed.includes(n))&&!/^\s*--- (?:FAIL|SKIP):/m.test(guard.go.stdout)&&/^PASS$/m.test(guard.go.stdout),'both original verifier functions must actually pass');
 requireValue(guard.originalsUnchanged===true&&guard.offlineBefore?.rows?.length>0&&JSON.stringify(guard.offlineBefore)===JSON.stringify(guard.offlineAfter),'original input identities changed or unavailable');
 requireValue(guard.offlineOwnerChecks?.length===4&&guard.offlineOwnerChecks.every(c=>c.code===1&&!c.stdout&&!c.stderr),'original owner/port absence unavailable');
 const replayHash=sha(replayRaw),accountsHash=sha(accountsRaw);
 requireValue(guard.proofArtifacts?.length===2&&guard.proofArtifacts.some(a=>a.sha256===replayHash&&a.source.endsWith('/stopped-replay.json'))&&guard.proofArtifacts.some(a=>a.sha256===accountsHash&&a.source.endsWith('/ready-account-readback.json')),'proof bytes differ from completed original guard');
 requireValue(replay.observationSha256===sha(observationRaw),'stopped proof belongs to another transaction report');
 const count=report.summary?.input,rounds=report.roundsRequested;
 requireValue(Number.isSafeInteger(count)&&count>0&&count===report.summary.finalSubmitted&&rounds===report.roundsCompleted&&count%rounds===0,'stopped report workload incomplete');
 requireValue(replay.nodes?.length===4&&accounts?.length===4&&new Set(replay.nodes.map(n=>n.name)).size===4&&new Set(accounts.map(n=>n.name)).size===4,'four distinct actual stopped stores required');
 const canonical=replay.nodes[0],seen=new Set();
 for(const n of replay.nodes){
  requireValue(n.readOnlyBlockstore===true&&n.exactStateEqual===true&&n.replayedTransactions===count&&n.height===canonical.height&&n.appHash===canonical.appHash&&n.snapshotSha256===canonical.snapshotSha256&&n.storeSha256===canonical.storeSha256,'actual stopped state/replay disagreement');
  const a=accounts.find(a=>a.name===n.name);requireValue(a&&a.height===n.height&&a.snapshotSha256===n.snapshotSha256&&a.storeSha256===n.storeSha256&&a.sendersVerified===count/rounds&&a.expectedNonce===rounds&&a.feeEvents===count,'actual account/nonce/fee proof disagreement');
 }
 requireValue(Array.isArray(replay.publicSignedBlocks)&&replay.publicSignedBlocks.length>0,'retained signed blocks missing');
 let businessInputs=0;
 for(const b of replay.publicSignedBlocks){
  requireValue(Number.isSafeInteger(b.height)&&!seen.has(b.height)&&Number(b.header?.height)===b.height&&b.header.chain_id===report.chainId&&Number(b.commit?.height)===b.height&&Array.isArray(b.commit.signatures)&&Array.isArray(b.transactions),'retained signed-block identity missing');seen.add(b.height);businessInputs+=b.transactions.length;
 }
 requireValue(businessInputs===count,'signed blocks do not retain the complete business input count');
 return {kind:'original baseline proof bound to separately inspected retained Go verifier receipt',guardSHA256:expectedGuardSHA256,observationSHA256:sha(observationRaw),replaySHA256:replayHash,accountsSHA256:accountsHash,originalStores:4,verifiedBusinessInputsPerStore:count,signedBlockHeights:[...seen],finalHeight:canonical.height,finalAppHash:canonical.appHash,canonicalSnapshotSHA256:canonical.snapshotSha256,cryptographicVerifier:'existing retained Go VerifyCommitLight and application replay; no cryptographic re-verification in this JavaScript consumer',newThroughputOrLatencySamples:false};
}

// REL-05 measurement kernel over a complete source inventory. This computes
// DATA only: the original CORE source/run/ledger/clock adapter must authenticate
// inputs separately. No caller-provided flag can promote this result to proof.
const cohortNs=(v,label)=>{requireValue(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v),label+' requires exact nonnegative decimal ns');return BigInt(v);};
const cohortId=v=>typeof v==='string'&&v.length>0&&v.length<=256;
function cohortLatency(rows,cutoff,thresholds){
 const completed=[],bounds=[];let censored=0,failed=0;
 const violations=Object.fromEntries(Object.keys(thresholds).map(k=>[k,{deadlineExceeded:0,failed:0}]));
 for(const r of rows){
  if(r.outcome==='committed_success'){
   const elapsed=r.final-r.offered;completed.push(elapsed);bounds.push(elapsed);
   for(const [k,limit]of Object.entries(thresholds))if(elapsed>limit)violations[k].deadlineExceeded++;
  }else if(r.outcome==='unknown_or_unfinished'){
   const elapsed=cutoff-r.offered;bounds.push(elapsed);censored++;
   for(const [k,limit]of Object.entries(thresholds))if(elapsed>limit)violations[k].deadlineExceeded++;
  }else{failed++;for(const k of Object.keys(thresholds))violations[k].failed++;}
 }
 completed.sort((a,b)=>a<b?-1:a>b?1:0);bounds.sort((a,b)=>a<b?-1:a>b?1:0);
 const quantiles={};
 for(const p of [50,95,99]){
  const rank=Math.ceil(rows.length*p/100),finite=rank>0&&rank<=bounds.length;
  quantiles['p'+p]={denominator:rows.length,rank,ns:censored===0&&finite?String(bounds[rank-1]):null,lowerBoundNs:finite?String(bounds[rank-1]):null,unboundedByFailures:rank>bounds.length&&rank>0,rightCensored:censored>0};
 }
 return {denominator:rows.length,successfulSamples:completed.length,rightCensoredSamples:censored,failedWithoutSuccessLatency:failed,algorithm:'nearest-rank on the full logical-request cohort; failures have no finite time-to-success, unfinished ages are lower bounds',quantiles,completedSuccessOnly:{conditional:true,samples:completed.length,...Object.fromEntries([50,95,99].map(p=>['p'+p+'Ns',completed.length?String(completed[Math.ceil(completed.length*p/100)-1]):null]))},slo:violations};
}
export function measureFinalCohort(ctx,fromHeight,untilHeight,requests,run){
 requireValue(ctx&&cohortId(run)&&ctx.run===run,'original run reference differs');
 const lower=cohortNs(fromHeight,'fromHeight'),upper=cohortNs(untilHeight,'untilHeight');requireValue(lower>0n&&upper>=lower,'invalid original height range');
 requireValue(cohortId(ctx.clockDomain)&&ctx.isolatedNetwork===true,'isolated original clock domain required');
 const start=cohortNs(ctx.windowStartNs,'window start'),end=cohortNs(ctx.windowEndNs,'window end'),cutoff=cohortNs(ctx.observedUntilNs,'observation cutoff');requireValue(start<end&&cutoff>=end,'fixed window or observation cutoff differs');
 const inside=n=>n!==null&&n>=start&&n<end;
 const clockError=ctx.clockSynchronizationErrorNs===undefined||ctx.clockSynchronizationErrorNs===null?null:String(cohortNs(ctx.clockSynchronizationErrorNs,'clock uncertainty'));
 requireValue(Array.isArray(ctx.plan)&&ctx.plan.length<=2000000&&Array.isArray(ctx.records)&&ctx.records.length<=2000000&&Array.isArray(requests),'bounded complete original request inventory required');
 const plans=new Map(),wanted=new Set(),records=new Map();
 for(const p of ctx.plan){
  requireValue(p&&cohortId(p.id)&&!plans.has(p.id)&&['online_signed','pre_signed'].includes(p.signingMode),'duplicate/invalid planned identity or signing mode');
  const offered=cohortNs(p.generatedAtNs,'logical generation');plans.set(p.id,{...p,offered});if(inside(offered))wanted.add(p.id);
 }
 requireValue(wanted.size>0&&requests.length===wanted.size&&new Set(requests).size===requests.length&&requests.every(id=>wanted.has(id)),'requests must include the entire fixed-window plan, including unsent/rejected identities');
 for(const r of ctx.records){requireValue(r&&plans.has(r.id)&&!records.has(r.id)&&r.clockDomain===ctx.clockDomain,'duplicate, unplanned or foreign-clock observation');for(const k of ['rejectedBeforeAdmission','finalFailed','timedOut','sourceRequestFailed','measurementLost'])requireValue(r[k]===undefined||typeof r[k]==='boolean','invalid observation flag '+k);records.set(r.id,r);}
 const thresholds={p95:2000000000n,p99:5000000000n},rows=[],members=new Set();let preWindowBacklogFinals=0;
 for(const p of plans.values()){
  const r=records.get(p.id);
  const stamp=(key)=>{if(r?.[key]===undefined||r[key]===null)return null;const n=cohortNs(r[key],key);requireValue(n>=p.offered&&n<=cutoff,'event outside original generation/cutoff');return n;};
  const submitted=stamp('submittedAtNs'),accepted=stamp('acceptedAtNs'),included=stamp('includedAtNs'),final=stamp('finalCommitAtNs');
  requireValue(accepted===null||submitted!==null&&accepted>=submitted,'acceptance has no original submission');
  requireValue(included===null||submitted!==null&&included>=submitted,'inclusion has no original submission');
  requireValue(final===null||included!==null&&final>=included,'final Commit has no original inclusion');
  const height=r?.height===undefined?null:cohortNs(r.height,'observed height');
  requireValue(included===null||height!==null&&height>0n,'inclusion height missing');
  const businessIncluded=included!==null&&r.executionCode===0&&r.businessKind==='transfer'&&typeof r.memberId==='string'&&/^[a-f0-9]{64}$/.test(r.memberId);
  const success=businessIncluded&&final!==null;
  if(businessIncluded){requireValue(!members.has(r.memberId),'duplicate successful business member identity');members.add(r.memberId);}
  if(!wanted.has(p.id)){if(success&&inside(final))preWindowBacklogFinals++;continue;}
  requireValue(!r?.rejectedBeforeAdmission||accepted===null&&included===null&&final===null,'rejection contradicts accepted/ledger observation');
  let outcome='unknown_or_unfinished';
  if(success)outcome='committed_success';
  else if(r?.rejectedBeforeAdmission===true)outcome='rejected_before_admission';
  else if(r?.finalFailed===true||included!==null&&Number.isInteger(r?.executionCode)&&r.executionCode!==0)outcome='final_failed';
  requireValue(!(success&&r?.finalFailed),'successful member contradicts final failure');
  rows.push({id:p.id,mode:p.signingMode,offered:p.offered,submitted,accepted,included,final,height,businessIncluded,outcome,timeout:r?.timedOut===true,sourceFailure:r?.sourceRequestFailed===true,lost:!r||r.measurementLost===true});
 }
 const summarize=selected=>{
  const counts={offered:selected.length,submitted:0,accepted:0,included:0,includedBusinessSuccess:0,committed_success:0,rejected_before_admission:0,final_failed:0,unknown_or_unfinished:0,timedOut:0,sourceRequestFailed:0,measurementLost:0,tailFinals:0,finalsOutsideHeightRange:0};
  const window={submitted:0,accepted:0,included:0,includedBusinessSuccess:0,finalCommitBusinessSuccess:0};
  for(const r of selected){
   counts[r.outcome]++;if(r.submitted!==null)counts.submitted++;if(r.accepted!==null)counts.accepted++;
   if(inside(r.submitted))window.submitted++;if(inside(r.accepted))window.accepted++;
   if(r.included!==null){counts.included++;if(r.height>=lower&&r.height<=upper&&inside(r.submitted)&&inside(r.included))window.included++;}
   if(r.timeout)counts.timedOut++;if(r.sourceFailure)counts.sourceRequestFailed++;if(r.lost)counts.measurementLost++;
   if(r.businessIncluded){counts.includedBusinessSuccess++;if(r.height>=lower&&r.height<=upper&&inside(r.submitted)&&inside(r.included))window.includedBusinessSuccess++;}
   if(r.outcome==='committed_success'){
    const heightOK=r.height>=lower&&r.height<=upper;
    if(!heightOK)counts.finalsOutsideHeightRange++;
    if(r.final>=end)counts.tailFinals++;
    if(heightOK&&inside(r.submitted)&&inside(r.final))window.finalCommitBusinessSuccess++;
   }
  }
  const n=selected.length,final=counts.committed_success;
  counts.notSubmitted=n-counts.submitted;
  const boundaryObservations={generatedWithoutSubmissionAtWindowEnd:selected.filter(r=>r.submitted===null||r.submitted>=end).length,submittedWithoutFinalCommitAtWindowEnd:selected.filter(r=>inside(r.submitted)&&(r.final===null||r.final>=end)).length,interpretation:"Observation gaps, not a measurement of physical queue depth; rejected requests and missing telemetry remain visible."};
  return {counts,window,boundaryObservations,latency:cohortLatency(selected,cutoff,thresholds),successFraction:{numerator:final,denominator:n},failureFraction:{numerator:counts.final_failed+counts.rejected_before_admission,denominator:n},unknownFraction:{numerator:counts.unknown_or_unfinished,denominator:n},completeQualityFloorObserved:n>0&&BigInt(final)*1000n>=BigInt(n)*999n&&counts.unknown_or_unfinished===0&&counts.measurementLost===0,finalWindowRate:{numerator:window.finalCommitBusinessSuccess,perSecondNumerator:String(BigInt(window.finalCommitBusinessSuccess)*1000000000n),denominatorNs:String(end-start)}};
 };
 return {functionId:'REL-05',classification:'measurement-data-not-authority',run,fromHeight,untilHeight,clockDomain:ctx.clockDomain,window:{startNs:String(start),endNs:String(end),observedUntilNs:String(cutoff),boundary:'start inclusive, end exclusive; tail drain separately reported'},preWindowBacklogFinalsExcluded:preWindowBacklogFinals,cohort:summarize(rows),signingGroups:Object.fromEntries(['online_signed','pre_signed'].map(mode=>[mode,summarize(rows.filter(r=>r.mode===mode))])),inventoryCoverage:'complete against supplied plan; CORE must independently bind the original inventory/run/ledger/clock',independentProofReverifiedHere:false,signatureThroughputQualified:false,sustainedTPSQualified:false,formal1800SecondWindowObserved:end-start===1800000000000n,openLoopDeclared:ctx.loadModel==='open_loop',clockSynchronizationErrorNs:clockError,interpretation:'Submitted/accepted are intermediate counts, never summed with exclusive terminal outcomes. Late drain and prior-window backlog cannot raise the formal fixed-window final rate. Unknown/timeout identities remain in all denominators and right-censored latency. Source authenticity and two-run R6 qualification remain with original CORE/REL owners.'};
}

// Thin adapter for the existing Go ready-sender raw JSONL and summary. SHA
// bindings detect mixed bytes; they are not an independent CORE attestation.
export function measureOriginalFinalCohort({manifestRaw,journalRaw,summaryRaw,contextRaw,bindings}){
 const raws={manifest:manifestRaw,journal:journalRaw,summary:summaryRaw,...(contextRaw===undefined?{}:{context:contextRaw})};
 for(const [key,raw]of Object.entries(raws))requireValue(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=(key==='manifest'?1048576:8388608)&&isUtf8(raw)&&bindings?.sha256?.[key]===sha(raw),'original '+key+' bytes/digest differ');
 requireValue(cohortId(bindings.run)&&Number.isSafeInteger(bindings.count)&&bindings.count>0&&Number.isSafeInteger(bindings.rounds)&&bindings.rounds>=2&&bindings.rounds<=32&&bindings.count*bindings.rounds<=2048,'original bounded ready-sender profile required');
 const manifest=JSON.parse(manifestRaw),report=JSON.parse(summaryRaw),n=bindings.count*bindings.rounds;
 requireValue(['chainId','genesisHash','migrationStateHash'].every(k=>typeof manifest[k]==='string'&&manifest[k].length>0),'original manifest identity missing');
 requireValue(report.chainId===manifest.chainId&&report.genesisSha256===manifest.genesisHash&&report.roundsRequested===bindings.rounds&&Array.isArray(report.transactions)&&report.transactions.length<=n&&report.summary?.input===n&&!report.retentionMode&&!report.terminalStream,'original complete-inventory summary profile differs');
 const lines=journalRaw.toString('utf8').split('\n');requireValue(lines.pop()===''&&lines.length===n+1,'original complete journal inventory required');
 const header=JSON.parse(lines.shift());requireValue(header.kind==='YNX_LOCAL_READY_SENDER_V1'&&header.manifestSha256===sha(manifestRaw)&&header.migrationHash===manifest.migrationStateHash&&header.genesisHash===manifest.genesisHash,'original journal/manifest binding differs');
 const inputs=new Map(),ids=new Set(),nonces=new Set(),senders=new Map();
 for(const line of lines){
  requireValue(Buffer.byteLength(line)<=65536,'original signed row bound');const e=JSON.parse(line),bytes=signedBytes(e.transaction),hash=sha(bytes).toUpperCase(),tx=JSON.parse(bytes);
  requireValue(Number.isSafeInteger(e.index)&&e.index>=0&&e.index<n&&!inputs.has(e.index)&&e.sender===e.index%bindings.count&&e.round===Math.floor(e.index/bindings.count)+1&&e.hash===hash&&!ids.has(hash),'original signed index/hash/round differs');
  requireValue(tx.version===1&&tx.chainId===6423&&tx.type==='transfer'&&tx.nonce===e.round&&tx.amount===1&&tx.fee===1&&typeof tx.signature==='string'&&/^[a-fA-F0-9]+$/.test(tx.signature)&&typeof tx.publicKey==='string'&&typeof tx.from==='string'&&typeof tx.to==='string','original signed transfer format differs');
  const nonce=JSON.stringify([tx.from,tx.nonce]),template=JSON.stringify([tx.from,tx.to,tx.publicKey]);requireValue(!nonces.has(nonce)&&(!senders.has(e.sender)||senders.get(e.sender)===template),'original sender/nonce identity differs');
  nonces.add(nonce);senders.set(e.sender,template);ids.add(hash);inputs.set(e.index,{id:hash,round:e.round,bytes:bytes.toString('base64')});
 }
 const observed=new Map(),positions=new Set();let reportedIncluded=0,reportedFinal=0,reportedIncludedAll=0;const clientElapsed=[];
 const includedAny=r=>Number.isSafeInteger(r.height)&&r.height>0&&Number.isInteger(r.executionCode)&&r.transactionProofVerified===true;
 const included=r=>Number.isSafeInteger(r.height)&&r.height>0&&r.executionCode===0&&r.quorumVerified===true&&r.transactionProofVerified===true&&r.durableStateVerified===true&&r.durableStateHeight>=r.height&&typeof r.durableSnapshotSha256==='string'&&r.durableSnapshotSha256.length>0&&(!['block-journal','snapshot-journal'].includes(r.durableStoreFormat)||(r.durableInfoVerified===true&&r.durableInfoHeight>=r.durableStateHeight));
 const final=r=>included(r)&&r.status==='confirmed'&&typeof r.confirmedObservedAt==='string'&&r.confirmedObservedAt.length>0&&r.checkTxIdentityVerified===true&&r.checkTxCode===0;
 for(const r of report.transactions){
  const input=inputs.get(r.index);requireValue(input&&!observed.has(input.id)&&r.hash===input.id&&r.round===input.round&&r.signedTransaction===input.bytes,'original report signed identity differs');observed.set(input.id,r);
  if(includedAny(r)){requireValue(typeof r.blockHash==='string'&&r.blockHash.length>0&&Number.isSafeInteger(r.blockTxIndex)&&r.blockTxIndex>=0&&Number.isSafeInteger(r.blockTxTotal)&&r.blockTxIndex<r.blockTxTotal,'original included position missing');const position=JSON.stringify([r.height,r.blockHash,r.blockTxIndex]);requireValue(!positions.has(position),'duplicate original ledger position');positions.add(position);reportedIncludedAll++;}
  if(included(r))reportedIncluded++;
  if(final(r)){reportedFinal++;if(r.queueDelayMs!==undefined&&r.queueDelayMs!==null&&r.confirmationMs!==undefined&&r.confirmationMs!==null){requireValue(Number.isFinite(r.queueDelayMs)&&r.queueDelayMs>=0&&Number.isFinite(r.confirmationMs)&&r.confirmationMs>=0,'invalid original monotonic duration');clientElapsed.push(r.queueDelayMs+r.confirmationMs);}}
 }
 requireValue(report.summary.effectiveBusinessIncluded===reportedIncluded&&report.summary.finalSubmitted===reportedFinal,'original summary totals differ from actual rows');
 const coverage={denominator:n,observedRows:observed.size,missingRequestIds:[...ids].filter(id=>!observed.has(id)),reportedIncluded,reportedIncludedAll,reportedFinal};
 let bench=null;const missing=['Existing CORE DTO supplies no independently bound full logical-generation/physical-Commit monotonic projection; an external projection is DATA only.'];
 if(contextRaw===undefined)missing.push('CORE original logical-generation/monotonic-clock/Commit projection not supplied; UTC and elapsed-summary fields are not substituted');
 else{
  const ctx=JSON.parse(contextRaw);requireValue(ctx.run===bindings.run&&Array.isArray(ctx.plan)&&ctx.plan.length===n&&new Set(ctx.plan.map(p=>p.id)).size===n&&ctx.plan.every(p=>ids.has(p.id))&&Array.isArray(ctx.records),'cohort projection differs from complete original inventory');
  for(const r of ctx.records){
   const original=observed.get(r.id);requireValue(original,'projection invented a missing original report row');
   if(r.acceptedAtNs!==undefined&&r.acceptedAtNs!==null)requireValue(original.checkTxIdentityVerified===true&&original.checkTxCode===0,'projected acceptance differs from original');
   if(r.includedAtNs!==undefined&&r.includedAtNs!==null)requireValue(includedAny(original)&&r.height===String(original.height)&&r.executionCode===original.executionCode&&r.memberId===r.id.toLowerCase()&&r.businessKind==='transfer','projected inclusion differs from original');
   if(r.finalCommitAtNs!==undefined&&r.finalCommitAtNs!==null)requireValue(final(original),'projected final differs from original qualified client result');
   if(r.rejectedBeforeAdmission===true)requireValue(original.checkTxIdentityVerified===true&&Number.isInteger(original.checkTxCode)&&original.checkTxCode!==0,'projected rejection differs from original');
   if(r.finalFailed===true)requireValue(Number.isInteger(original.executionCode)&&original.executionCode!==0,'projected failure differs from original execution');
   if(r.timedOut===true)requireValue(original.status==='timeout','projected timeout differs from original');
  }
  requireValue(Array.isArray(bindings.requests),'externally selected complete cohort IDs required');
  bench=measureFinalCohort(ctx,bindings.fromHeight,bindings.untilHeight,bindings.requests,bindings.run);
 }
 return {functionId:'REL-05',classification:'original-raw-measurement-data-not-authority',run:bindings.run,runReferenceAuthority:'local output label only; original CORE has no arbitrary generic runID DTO',originalRunBinding:{manifestSHA256:sha(manifestRaw),genesisHash:manifest.genesisHash,migrationHash:manifest.migrationStateHash,journalSHA256:sha(journalRaw),summarySHA256:sha(summaryRaw)},reportedClientOfferToFinalMs:{denominator:n,missingSamples:n-clientElapsed.length,conditionalSuccessOnly:true,clock:'original client Go monotonic queueDelayMs + confirmationMs; UTC is not subtracted',...(clientElapsed.length?percentiles(clientElapsed):{samples:0,p50:null,p95:null,p99:null})},sourceSHA256:Object.fromEntries(Object.entries(raws).map(([key,raw])=>[key,sha(raw)])),coverage,bench,missingContracts:missing,CORESourceAuthenticated:false,timingProjectionAuthenticated:false,originalFinalBoundary:'Go client verified finality observation; not a physical final Commit timestamp',sustainedTPSQualified:false,signatureAndConsensusVerification:'Original Go qualifiedBusinessFinal/verifiedBusinessInclusion predicates are consumed as reports; signatures are not re-verified here.'};
}
function readCohortRawFile(file,maxBytes){
 requireValue(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&fs.realpathSync(file)===file,'canonical original input path required');
 const before=fs.lstatSync(file,{bigint:true});requireValue(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maxBytes)&&(before.mode&0o022n)===0n,'bounded protected original input required');
 requireValue(Number.isInteger(fs.constants.O_NOFOLLOW),'original no-follow identity support required');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd,{bigint:true});requireValue(opened.dev===before.dev&&opened.ino===before.ino,'original changed during open');const raw=Buffer.alloc(Number(before.size));let offset=0;while(offset<raw.length){const n=fs.readSync(fd,raw,offset,raw.length-offset,null);requireValue(n>0,'truncated original input');offset+=n;}const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mode','nlink','mtimeNs','ctimeNs'])requireValue(before[key]===after[key]&&after[key]===named[key],'original changed during read');requireValue(raw.length===Number(before.size),'original length differs');return raw;}finally{fs.closeSync(fd);}
}
export function runFinalCohortReadback(args){
 requireValue(Array.isArray(args)&&[10,12].includes(args.length),'exact manifest/journal/summary/bindings/output and optional context flags required');const o={};
 for(let i=0;i<args.length;i+=2){requireValue(['--manifest','--journal','--summary','--bindings','--context','--output'].includes(args[i])&&!Object.hasOwn(o,args[i]),'duplicate or unknown cohort flag');o[args[i]]=args[i+1];}
 requireValue(['--manifest','--journal','--summary','--bindings','--output'].every(k=>typeof o[k]==='string'),'original cohort inputs missing');
 const bindings=JSON.parse(readCohortRawFile(o['--bindings'],1048576)),result=measureOriginalFinalCohort({manifestRaw:readCohortRawFile(o['--manifest'],1048576),journalRaw:readCohortRawFile(o['--journal'],8388608),summaryRaw:readCohortRawFile(o['--summary'],8388608),bindings,...(o['--context']?{contextRaw:readCohortRawFile(o['--context'],8388608)}:{})});
 const out=o['--output'],parent=path.dirname(out);requireValue(path.isAbsolute(out)&&path.normalize(out)===out&&fs.realpathSync(parent)===parent,'canonical existing output parent required');
 const fd=fs.openSync(out,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(result)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const directory=fs.openSync(parent,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{runFinalCohortReadback(process.argv.slice(2));}catch(error){process.stderr.write('final cohort readback refused: '+error.message+'\n');process.exitCode=1;}}
