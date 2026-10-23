const prefix='YNX_ABCI_PHASE_TIMING ';
const stages=['check_tx','prepare_proposal','process_proposal','finalize_block','commit'];
const subphases=new Set(['validate','json_encode','delta_encode','journal_maintenance','prepare_file','write','file_sync','close_file','rename','directory_sync']);
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const signedInteger=n=>Number.isSafeInteger(n);
function unixNs(value){
 if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw Error('node clock requires exact decimal Unix nanoseconds');
 return BigInt(value);
}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function readClock(clock,elapsed){
 if(!exactKeys(clock,['originUnixNs','emittedUnixNs','wallDriftNs'])||!signedInteger(clock.wallDriftNs)||unixNs(clock.emittedUnixNs)-unixNs(clock.originUnixNs)-BigInt(elapsed)!==BigInt(clock.wallDriftNs))throw Error('node clock calibration differs');
 return Math.abs(clock.wallDriftNs);
}
function readBlockExecution(point,commit,clock,window){
 const keys=['height','appHash','transactions','codeZeroTransactions','finalizeReturned','commitReturned'];
 if(point&&Object.hasOwn(point,'blockHash')){keys.push('blockHash');if(typeof point.blockHash!=='string'||!/^[0-9a-f]{64}$/.test(point.blockHash))throw Error('node block hash differs');}
 if(!exactKeys(point,keys)||point.height!==commit.height||typeof point.appHash!=='string'||!/^[0-9a-f]{64}$/.test(point.appHash)||!integer(point.transactions)||!integer(point.codeZeroTransactions)||point.codeZeroTransactions>point.transactions)throw Error('node block execution identity differs');
 let maximum=0;
 for(const key of ['finalizeReturned','commitReturned']){
  const at=point[key];
  if(!exactKeys(at,['unixNs','elapsedNs','wallDriftNs'])||!integer(at.elapsedNs)||at.elapsedNs>window||!signedInteger(at.wallDriftNs)||unixNs(at.unixNs)-unixNs(clock.originUnixNs)-BigInt(at.elapsedNs)!==BigInt(at.wallDriftNs))throw Error('node block completion clock differs');
  maximum=Math.max(maximum,Math.abs(at.wallDriftNs));
 }
 if(point.finalizeReturned.elapsedNs>point.commitReturned.elapsedNs)throw Error('node Finalize/Commit completion order differs');
 return maximum;
}
export function readNodePhaseTiming(log){
 if(typeof log!=='string'||Buffer.byteLength(log)>1024*1024)throw Error('node timing log bound');
 const frames=log.split('\n').filter(line=>line.startsWith(prefix));
 if(!frames.length||frames.length>4097)throw Error('missing or excessive node timing frames');
 const commitTotalsNs={},validationTotalsNs={semantics:0,app_hash:0};let prior,commits=0,previousHeight,validationPresent,clockPresent,origin;const blockExecutions=[];let maximumClockDrift=0;
 for(let i=0;i<frames.length;i++){
  const row=JSON.parse(frames[i].slice(prefix.length));
  if(row.schema!==1||row.sequence!==i+1||row.valid!==true||row.capped!==false||!integer(row.inFlight)||row.reason==='shutdown'&&row.inFlight!==0||!integer(row.windowElapsedNs)||row.windowElapsedNs<=0||!['commit','shutdown'].includes(row.reason)||row.reason==='shutdown'&&i!==frames.length-1||i===frames.length-1&&row.reason!=='shutdown')throw Error('incomplete or invalid node timing session');
  const hasClock=Object.hasOwn(row,'clock');
  if(clockPresent!==undefined&&clockPresent!==hasClock)throw Error('mixed node clock coverage');
  clockPresent=hasClock;
  if(hasClock){
   maximumClockDrift=Math.max(maximumClockDrift,readClock(row.clock,row.windowElapsedNs));
   if(origin!==undefined&&origin!==row.clock.originUnixNs)throw Error('node clock origin changed');
   origin=row.clock.originUnixNs;
  }
  if(Object.hasOwn(row,'blockExecution')&&(!hasClock||row.reason!=='commit'))throw Error('stale node block execution point');
  if(!row.stages||Object.keys(row.stages).some(name=>!stages.includes(name)))throw Error('unknown node timing stage');
  if(prior&&row.windowElapsedNs<prior.windowElapsedNs)throw Error('node timing clock regressed');
  for(const name of stages){
   const value=row.stages[name];if(!value)throw Error('missing node timing stage');
   if(!integer(value.calls)||!integer(value.failedResponses)||value.failedResponses>value.calls||!integer(value.elapsedNs)||!Array.isArray(value.durationBuckets)||value.durationBuckets.length!==64||value.durationBuckets.some(n=>!integer(n))||value.durationBuckets.reduce((a,b)=>a+b,0)!==value.calls)throw Error('invalid node stage totals');
   const old=prior?.stages[name];if(old&&(value.calls<old.calls||value.failedResponses<old.failedResponses||value.elapsedNs<old.elapsedNs||value.durationBuckets.some((n,j)=>n<old.durationBuckets[j])))throw Error('node stage totals regressed');
  }
  if(prior&&Object.keys(prior.stages).some(name=>!row.stages[name]))throw Error('node timing stage disappeared');
  if(row.reason==='commit'){
   commits++;const c=row.commit;
   if(!c||!integer(c.height)||previousHeight!==undefined&&c.height!==previousHeight+1||!['atomic-json','snapshot-journal-v1','block-journal-v2'].includes(c.storage)||c.durable!==true||!integer(c.elapsedNs)||c.elapsedNs<=0||!integer(c.payloadBytes)||c.payloadBytes<=0||!c.stagesNs||Object.keys(c.stagesNs).length>10||Object.entries(c.stagesNs).some(([name,n])=>!subphases.has(name)||!integer(n)))throw Error('unqualified Commit timing');
   if(!('validate' in c.stagesNs)||!('file_sync' in c.stagesNs)||!((c.storage==='block-journal-v2'?'delta_encode':'json_encode') in c.stagesNs))throw Error('missing Commit encode or sync phase');
   for(const [name,n]of Object.entries(c.stagesNs)){commitTotalsNs[name]=(commitTotalsNs[name]??0)+n;if(!integer(commitTotalsNs[name]))throw Error('Commit aggregate overflow');}
   const hasValidation=Object.hasOwn(c,'validationStagesNs');
   if(validationPresent!==undefined&&validationPresent!==hasValidation)throw Error('mixed validation child coverage');
   validationPresent=hasValidation;
   if(hasValidation){
    const child=c.validationStagesNs;
    if(!child||Array.isArray(child)||Object.keys(child).length!==2||!Object.hasOwn(child,'semantics')||!Object.hasOwn(child,'app_hash')||!integer(child.semantics)||!integer(child.app_hash)||!integer(child.semantics+child.app_hash)||child.semantics+child.app_hash>c.stagesNs.validate)throw Error('invalid nested validation child timing');
    for(const name of ['semantics','app_hash']){validationTotalsNs[name]+=child[name];if(!integer(validationTotalsNs[name]))throw Error('validation aggregate overflow');}
   }
   if(Object.hasOwn(row,'blockExecution')){
    maximumClockDrift=Math.max(maximumClockDrift,readBlockExecution(row.blockExecution,c,row.clock,row.windowElapsedNs));
    blockExecutions.push(row.blockExecution);
   }
   previousHeight=c.height;
  }else if(row.commit!==null)throw Error('shutdown has stale Commit timing');
  prior=row;
 }
 if(!commits||!prior.stages.finalize_block.calls||prior.stages.commit.calls!==commits||prior.stages.commit.failedResponses!==0)throw Error('missing executed node phase coverage');
 return {...(clockPresent?{blockExecutionClock:{originUnixNs:origin,maximumAbsWallDriftNs:maximumClockDrift,driftWithin1ms:maximumClockDrift<=1000000,completeCommitCoverage:blockExecutions.length===commits,completeBlockHashCoverage:blockExecutions.length===commits&&blockExecutions.every(p=>Object.hasOwn(p,'blockHash')),blocks:blockExecutions,requiresSameVMAndClientClockEvidence:true,bftFinalityProven:false}}:{}),schema:1,commitAttempts:commits,windowElapsedNs:prior.windowElapsedNs,stages:prior.stages,commitTotalsNs,...(validationPresent?{validationTotalsNs,validationCommitSamples:commits,validationInterpretation:'Validation children are already included in commitTotalsNs.validate; never add them again into Commit or finality.'}:{}),interpretation:'Cumulative completed ABCI handler wall durations include application lock waits; parallel stage sums may exceed window time. Commit subphases cover the original durable write path. Histogram quantiles are intervals, not exact points. Diagnostic emission overhead is outside handler timers and remains in client-observed latency. These are local node timings, not BFT finality.'};
}
