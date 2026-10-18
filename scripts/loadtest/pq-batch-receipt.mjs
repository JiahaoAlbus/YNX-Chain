import {createHash} from 'node:crypto';

const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const canonicalHash=s=>typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s);
const decimal=s=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&BigInt(s)<=18446744073709551615n;
const frame=b=>{const n=Buffer.alloc(4);n.writeUInt32BE(b.length);return Buffer.concat([n,b])};

// Independent application identity codec. This does not verify a PQ signature.
export function pqBatchMemberHash(batchHash,index){
  if(!canonicalHash(batchHash)||!Number.isInteger(index)||index<0||index>=1024)throw Error('invalid canonical PQ member identity');
  const i=Buffer.alloc(4);i.writeUInt32BE(index);
  const count=Buffer.alloc(4);count.writeUInt32BE(3);
  return hash(Buffer.concat([
    count,frame(Buffer.from('YNX-NATIVE-BATCH-MEMBER/v1')),frame(Buffer.from(batchHash.slice(2),'hex')),frame(i),
  ]));
}

// Count original server claims only. Local durable checkpoint != inclusion or
// BFT finality; neither HTTP success nor shared proof existence fills that gap.
export function classifyPQBatchReceipt(wire,response,expectedMembers){
  if(!Buffer.isBuffer(wire)||wire.length<1||wire.length>8*1024*1024||!Array.isArray(expectedMembers)||expectedMembers.length<1||expectedMembers.length>1024||(expectedMembers.length&(expectedMembers.length-1))!==0)throw Error('PQ receipt input bounds');
  const batchHash=hash(wire);
  if(!response||response.batchHash!==batchHash||response.wireHash!==batchHash||typeof response.replayed!=='boolean'||!decimal(response.executionHeight)||!['durable','memory','uncertain','not_committed','rejected'].includes(response.status)||!Array.isArray(response.results)||response.results.length!==expectedMembers.length)throw Error('PQ receipt batch identity or shape mismatch');
  let admitted=0,rejected=0;
  const members=response.results.map((row,index)=>{
    const expected=expectedMembers[index];
    if(!expected||!['amount','fee','nonce'].every(k=>decimal(expected[k])))throw Error('invalid expected decimal member');
    if(!row||row.index!==index||row.batchHash!==batchHash||row.wireHash!==batchHash||!row.decimalFields||row.decimalFields.executionHeight!==response.executionHeight||!['amount','fee','nonce'].every(k=>row.decimalFields[k]===expected[k])||typeof row.error!=='string')throw Error('PQ receipt member identity or decimals mismatch');
    if(row.outcome==='admitted'){
      if(row.transactionHash!==pqBatchMemberHash(batchHash,index)||row.error!=='')throw Error('PQ admitted member identity mismatch');
      admitted++;
    }else if(row.outcome==='rejected'){
      if(row.transactionHash!==''||row.error==='')throw Error('PQ rejected member has execution identity');
      rejected++;
    }else throw Error('unknown PQ member outcome');
    return {index,outcome:row.outcome,transactionHash:row.transactionHash,error:row.error};
  });
  if((response.status==='rejected'&&(admitted!==0||response.replayed))||(response.status!=='rejected'&&admitted===0))throw Error('PQ batch status inconsistent with member outcomes');
  return {batchHash,executionHeight:response.executionHeight,status:response.status,replayed:response.replayed,members,serverReportedAdmitted:admitted,serverReportedRejected:rejected,newServerReportedDurableMembers:response.status==='durable'&&!response.replayed?admitted:0,verifiedEffectiveInclusions:null,verifiedFinalCommits:null,interpretation:'Server claims only. Replayed identities are not new business. Independent execution/readback, actual block inclusion and applicable consensus finality are separate evidence.'};
}

// One counter per run. Retain exact hashes up to the caller's explicit bound;
// never evict identities, which would turn a late duplicate into new business.
// This aggregates server claims only and cannot promote them to BFT evidence.
export function createPQReceiptCounter(maxMembers){
  if(!Number.isSafeInteger(maxMembers)||maxMembers<1||maxMembers>1000000)throw Error('PQ counter identity bound');
  const admitted=new Set(),durable=new Set();
  return Object.freeze({observe(wire,response,expectedMembers){
    const receipt=classifyPQBatchReceipt(wire,response,expectedMembers);
    const hashes=receipt.members.filter(m=>m.outcome==='admitted').map(m=>m.transactionHash);
    const unseen=hashes.filter(h=>!admitted.has(h));
    if(admitted.size+unseen.length>maxMembers)throw Error('PQ counter identity bound exceeded; stop run without eviction');
    const newDurable=receipt.status==='durable'?hashes.filter(h=>!durable.has(h)):[];
    // Validation and capacity admission finish before any cumulative mutation.
    for(const h of unseen)admitted.add(h);
    for(const h of newDurable)durable.add(h);
    return {...receipt,newUniqueServerReportedDurableMembers:receipt.replayed?0:newDurable.length,uniqueServerReportedAdmittedMembers:admitted.size,uniqueServerReportedDurableMembers:durable.size,interpretation:'Run-scoped exact hash deduplication of server claims. First-seen durable replays are observed durable identities, never new execution. Inclusion, execution readback and weighted consensus commit verification remain separate.'};
  }});
}

// Format/binding checks for the production owner's call-local measurement API.
// This does not verify signatures, state execution or consensus evidence.
export function qualifyPQBatchMeasurement(m,receipt){
 const count=n=>Number.isSafeInteger(n)&&n>=0;
 const int64=s=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&BigInt(s)<=9223372036854775807n;
 if(!receipt||!canonicalHash(receipt.batchHash)||!decimal(receipt.executionHeight)||!m||m.version!=='ynx-pq-batch-measurement-v1'||m.wireHash!==receipt.batchHash||m.executionHeight!==receipt.executionHeight||!m.result||m.result.batchHash!==receipt.batchHash||m.result.executionHeight!==receipt.executionHeight||m.result.status!==receipt.status||m.result.replayed!==receipt.replayed||!Array.isArray(m.result.results)||m.result.results.length!==receipt.members.length)throw Error('PQ measurement identity/result mismatch');
 for(let i=0;i<receipt.members.length;i++){const a=m.result.results[i],b=receipt.members[i];if(!a||a.index!==b.index||a.outcome!==b.outcome||(a.transactionHash??'')!==b.transactionHash||(a.error??'')!==b.error)throw Error('PQ measurement original member result mismatch');}
 const durations={},counters={};
 const phase=(p,name)=>{
  if(!p||!['attempts','completed','errors'].every(k=>count(p[k]))||p.completed>p.attempts||p.errors!==p.attempts-p.completed||!int64(p.durationNs)||(p.attempts===0&&p.durationNs!=='0'))throw Error('PQ measurement phase shape: '+name);
  durations[name]=p.durationNs;counters[name]={attempts:p.attempts,completed:p.completed,errors:p.errors};
 };
 for(const name of ['total','inputCloneHash','lockWait','policyValidation','wireDecode','wholeAuthentication','memberExecution','replay'])phase(m[name],name);
 if(m.total.attempts!==1)throw Error('PQ measured API total attempt missing');
 const persistence=m.persistence;if(!persistence)throw Error('PQ persistence measurement missing');
 for(const name of ['total','snapshotBuild','integritySeal','checkpointBuild','persistenceLockWait','mkdir'])phase(persistence[name],'persistence.'+name);
 for(const name of ['snapshotFile','markerFile']){const f=persistence[name];if(!f||!count(f.writeCalls)||!count(f.bytesWritten))throw Error('PQ write counters invalid');for(const k of ['total','openTemp','encodeWrite','fileSync','close','rename','directorySync'])phase(f[k],'persistence.'+name+'.'+k);}
 if(!count(m.verifierSignatureChecks)||!count(m.memberAdmitted)||!count(m.memberRejected)||m.memberExecution.attempts!==m.memberAdmitted+m.memberRejected||m.memberExecution.completed!==m.memberAdmitted||m.memberExecution.errors!==m.memberRejected)throw Error('PQ evaluation counters mismatch');
 if(receipt.replayed){if(m.verifierSignatureChecks!==0||m.memberAdmitted!==0||m.memberRejected!==0||m.wholeAuthentication.attempts!==0||m.replay.attempts!==1)throw Error('PQ replay invented new work');}
 else if(m.memberAdmitted!==receipt.serverReportedAdmitted||m.memberRejected!==receipt.serverReportedRejected)throw Error('PQ original evaluation outcomes mismatch');
 const published=persistence.published??null;
 if(published!==null){
  if(receipt.status!=='durable'||published.version!=='ynx-local-durability-v1'||!decimal(published.height)||typeof published.hash!=='string'||(published.height!=='0'&&published.hash==='')||typeof published.snapshotIntegrity!=='string'||published.snapshotIntegrity===''||published.snapshotIntegrity!==persistence.candidateIntegrity||persistence.total.completed!==1||m.total.completed!==1)throw Error('PQ checkpoint publication mismatch');
  for(const name of ['snapshotFile','markerFile'])for(const k of ['total','openTemp','encodeWrite','fileSync','close','rename','directorySync'])if(persistence[name][k].completed!==1||persistence[name][k].errors!==0)throw Error('PQ checkpoint published before durable boundary');
 }
 return {wireHash:m.wireHash,executionHeight:m.executionHeight,status:receipt.status,replayed:receipt.replayed,phaseDurationsNs:durations,phaseCounters:counters,phaseDurationsAreInclusive:true,fileWrites:Object.fromEntries(['snapshotFile','markerFile'].map(name=>[name,{writeCalls:persistence[name].writeCalls,bytesWritten:persistence[name].bytesWritten}])),verifierSignatureChecks:m.verifierSignatureChecks,publishedLocalCheckpoint:published===null?null:{...published},verifiedEffectiveInclusions:null,verifiedFinalCommits:null,interpretation:'Bound server measurement fields only. Nanoseconds remain exact decimal strings; parent and child phases overlap and must not be summed. Published checkpoint height can precede pending transaction execution height. Local checkpoints are separate from block inclusion and BFT finality.'};
}

// Read the original result bytes with their completed guard receipt. This is a
// self-consistency check, not authentication of an artifact's origin. Retrieve
// both from the approved run; no formatted field becomes consensus evidence.
export function readGuardedPQPairedPhases(raw,guard){
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>1024*1024||!guard||guard.firstCause!==null||guard.child?.code!==0||guard.cleanupComplete!==true||!Array.isArray(guard.emptyOwnedScans)||guard.emptyOwnedScans.length!==2||guard.resultSHA256!==hash(raw).slice(2))throw Error('original result digest or completed guard missing');
  const r=JSON.parse(raw.toString('utf8'));
  if(r.schema!==1||r.kind!=='isolated-single-producer-PQ-paired-component'||!['1','16'].includes(String(r.n))||!Number.isInteger(r.n)||r.trial!==1||r.gomaxprocs!==1||!/^([0-9a-f]{40})$/.test(r.sourceCommit??'')||r.sourceCommit!==guard.sourceCommit||guard.explicitCaseN!==r.n||r.businessProjectionEqual!==true||r.bftFinalCommits!==null||r.consensusFinalityLatency!==null||r.productionMeasurementVersion!=='ynx-pq-batch-measurement-v1'||!/^[0-9a-f]{64}$/.test(r.sharedWholeSha256??'')||JSON.stringify(r.order)!=='["members","whole"]'||!Array.isArray(r.results)||r.results.length!==2)throw Error('measured pair identity or evidence layers mismatch');
  for(let i=0;i<2;i++){
    const row=r.results[i];
    if(!row||row.mode!==r.order[i]||['members','localBlockCheckpointMembers','coldRestoredMembers'].some(k=>row[k]!==r.n)||row.cloneLocalPeersPreserved!==true||row.checkpointPointerTransitions!==(i===0?r.n:1)||!Array.isArray(row.memberHashes)||row.memberHashes.length!==r.n||row.memberHashes.some(h=>!canonicalHash(h))||new Set(row.memberHashes).size!==r.n)throw Error('pair member/checkpoint fields missing');
    for(const key of ['submitNs','submitWallNs','sharedSigningPreparationNs','manualProduceBlockNs','coldRestoreNs'])if(!Number.isSafeInteger(row[key])||row[key]<1||row[key]>120000000000)throw Error('bounded pair timing missing');
    if(row.submitWallNs<row.submitNs)throw Error('pair API timing exceeds its wall interval');
  }
  const whole=r.results[1],m=whole.wholeMeasurement,batchHash='0x'+r.sharedWholeSha256;
  if(r.results[0].sharedSigningPreparationNs!==whole.sharedSigningPreparationNs||r.results[0].wholeMeasurement!=null||!m||m.wireHash!==batchHash||m.result?.status!=='durable'||m.result.replayed!==false||!Array.isArray(m.result.results)||m.result.results.length!==r.n)throw Error('original measured Whole result missing');
  const members=m.result.results.map((row,index)=>{
    const expected=pqBatchMemberHash(batchHash,index);
    if(row.index!==index||row.outcome!=='admitted'||row.transactionHash!==expected||whole.memberHashes[index]!==expected||(row.error??'')!=='')throw Error('Whole member hash differs from original batch identity');
    return {index,outcome:row.outcome,transactionHash:row.transactionHash,error:row.error??''};
  });
  const q=qualifyPQBatchMeasurement(m,{batchHash,executionHeight:m.executionHeight,status:m.result.status,replayed:m.result.replayed,members,serverReportedAdmitted:r.n,serverReportedRejected:0});
  if(q.publishedLocalCheckpoint===null||BigInt(q.phaseDurationsNs.total)>BigInt(whole.submitNs))throw Error('measured API interval or published checkpoint missing');
  return {kind:'guard-bound-local-production-phase-fields',sourceCommit:r.sourceCommit,n:r.n,trial:r.trial,goVersion:r.goVersion??null,platform:r.platform??null,gomaxprocs:r.gomaxprocs,outerWholeApiNs:String(whole.submitNs),memberSubmissionLoopNs:String(r.results[0].submitWallNs),sharedSigningPreparationNs:String(whole.sharedSigningPreparationNs),executionHeight:q.executionHeight,publishedLocalCheckpoint:q.publishedLocalCheckpoint,fileWrites:q.fileWrites,phases:Object.entries(q.phaseDurationsNs).map(([phase,durationNs])=>({phase,...q.phaseCounters[phase],durationNs})),phaseDurationsAreInclusive:true,verifiedEffectiveInclusions:null,verifiedFinalCommits:null,sustainedBusinessTPS:null,consensusFinalityLatency:null,interpretation:'Guard/result field consistency only; original run provenance and Go execution evidence remain required. Whole includes instrumentation; members do not. Parent/child timings overlap. Pending local checkpoint, manual block and cold restore are separate from BFT. No hardware-qualified speedup or sustained TPS inferred.'};
}
