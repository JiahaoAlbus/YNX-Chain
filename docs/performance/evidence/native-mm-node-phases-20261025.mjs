// Original matched node phase diagnostics; full signed-stream qualification is separate.
// Usage: node THIS.mjs ORIGINAL_RUN_DIRECTORY NEW_OUTPUT_JSON TRUSTED_PRIORITY_PROOF_SHA256
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
const [root,output,trustedPrioritySHA]=process.argv.slice(2);
if(!root||!output||!/^[0-9a-f]{64}$/.test(trustedPrioritySHA??''))throw Error('run directory, NEW output and trusted actual priority proof SHA required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const proofPath=path.join(root,'priority-original-node-diagnostics-01.json');
const proofBytes=fs.readFileSync(proofPath),proof=JSON.parse(proofBytes);
if(sha(proofBytes)!==trustedPrioritySHA||proof.originalReaderSHA256!=='302fc2be287d1836471d20985736cfe395d2bce662f1116d9c75c5c2e9d3257e'||proof.artifact.runId!==40113221553||proof.artifact.head!=='d24e97b8d3373e294a9d7992e07b4ef532bd6dcf'||proof.missingOriginalPriorityMembers.length||proof.priorityOriginalMembers.length!==17)throw Error('original priority proof differs');
const members=new Map(proof.priorityOriginalMembers.map(p=>[p.path,p]));
function original(relative){const bytes=fs.readFileSync(path.join(root,'capture',relative)),pin=members.get(relative);if(!pin||pin.bytes!==bytes.length||pin.sha256!==sha(bytes))throw Error('original priority member differs: '+relative);return bytes;}
const source=path.resolve(root,'../native-prepared-grouped-mm-pair-source-d24e97b8d3/frozen-readers/scripts/loadtest/node-phase-timing.mjs');
if(sha(fs.readFileSync(source))!=='1957ee706aa138d0b9f72b042826c2f8682d2ea59c86d9d02de71359fdfd2da5')throw Error('original node parser differs');
const {readNodePhaseTiming}=await import(pathToFileURL(source).href);
const logBytes=fs.readFileSync(path.join(root,'native-ci-full.raw'));
if(logBytes.length!==797820||sha(logBytes)!=='425f2fae268bcfd8e1b837d8bc2b1615bebb02f64a8603ede0e0148d92d9bf5e')throw Error('original CI log differs');
const terminals=logBytes.toString().split('\n').filter(s=>s.includes('YNX_NATIVE_STREAM_TERMINAL ')).map(s=>JSON.parse(s.split('YNX_NATIVE_STREAM_TERMINAL ')[1]));
if(terminals.length!==2||terminals.some(t=>t.qualified!==true||t.firstCause!==null))throw Error('original case terminals differ');
const summarize=values=>{if(!values.length||values.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('missing or invalid phase samples');const sorted=[...values].sort((a,b)=>a-b),q=p=>sorted[Math.ceil(sorted.length*p)-1]/1e6;return {samples:values.length,totalMs:values.reduce((a,b)=>a+b,0)/1e6,meanMs:values.reduce((a,b)=>a+b,0)/values.length/1e6,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99)};};
const cases=[];
for(const name of ['before-native-mm-bounded','after-native-mm-grouped']){
 const nodes=[];let common;
 const receiptBytes=original(name+'/evidence/actual.json'),receipt=JSON.parse(receiptBytes),term=terminals[cases.length];
 if(sha(receiptBytes)!==term.receiptSHA256)throw Error('original case receipt terminal SHA differs');
 for(let i=0;i<4;i++){
  const file=path.join(root,'capture',name,`abci-${i}.log`),bytes=original(name+`/abci-${i}.log`),log=bytes.toString();
  const timing=readNodePhaseTiming(log);
  if(!isDeepStrictEqual(timing,receipt.nodePhases[i]))throw Error('original node parser receipt differs');
  const frames=log.split('\n').filter(s=>s.startsWith('YNX_ABCI_PHASE_TIMING ')).map(s=>JSON.parse(s.slice(22)));
  const business=frames.filter(f=>f.reason==='commit'&&f.blockExecution?.transactions>0);
  if(!business.length||business.some(f=>f.blockExecution.transactions!==f.blockExecution.codeZeroTransactions||f.commit.height!==f.blockExecution.height))throw Error('business block execution differs');
  const identities=business.map(f=>[f.blockExecution.height,f.blockExecution.blockHash,f.blockExecution.appHash,f.blockExecution.transactions]);
  if(common&&JSON.stringify(common)!==JSON.stringify(identities))throw Error('four replica business block identities differ');
  common=identities;
  const phase={commit:business.map(f=>f.commit.elapsedNs)};
  for(const key of ['validate','delta_encode','write','file_sync','close_file','prepare_file','journal_maintenance']){
   phase[key]=business.map(f=>f.commit.stagesNs[key]);
  }
  for(const key of ['semantics','app_hash'])phase[key]=business.map(f=>f.commit.validationStagesNs[key]);
  nodes.push({node:i,source:{path:file,bytes:bytes.length,sha256:sha(bytes)},completeLogValidated:true,
   businessBlocks:business.length,businessTransactions:identities.reduce((n,r)=>n+r[3],0),
   journalMaintenanceOver5ms:business.filter(f=>f.commit.stagesNs.journal_maintenance>5000000).map(f=>({height:f.commit.height,transactions:f.blockExecution.transactions,journalMaintenanceMs:f.commit.stagesNs.journal_maintenance/1e6,commitMs:f.commit.elapsedNs/1e6})),
   phases:Object.fromEntries(Object.entries(phase).map(([key,values])=>[key,summarize(values)])),
   actualCheckpointSamples:frames.filter(f=>f.reason==='commit'&&f.commit.checkpointStagesNs).map(f=>({height:f.commit.height,currentBlockTransactions:f.blockExecution?.transactions,stagesNs:f.commit.checkpointStagesNs})),
   cumulativeHandlerTimings:timing.stages});
 }
 if(nodes.some(n=>n.businessTransactions!==8192))throw Error('original business transaction count differs');
 const pooled={};
 for(const key of Object.keys(nodes[0].phases)){
  const values=[];
  for(const node of nodes){
   const log=fs.readFileSync(node.source.path,'utf8');
   for(const line of log.split('\n').filter(s=>s.startsWith('YNX_ABCI_PHASE_TIMING '))){
    const f=JSON.parse(line.slice(22));if(f.reason!=='commit'||!(f.blockExecution?.transactions>0))continue;
    values.push(key==='commit'?f.commit.elapsedNs:key==='semantics'||key==='app_hash'?f.commit.validationStagesNs[key]:f.commit.stagesNs[key]);
   }
  }
  pooled[key]=summarize(values);
 }
 const checkpointValues={};for(const node of nodes)for(const point of node.actualCheckpointSamples)for(const [key,ns]of Object.entries(point.stagesNs))(checkpointValues[key]??=[]).push(ns);
 cases.push({name,effectiveTransactions:8192,replicas:4,pooledReplicaSamples:pooled,checkpointPhases:Object.fromEntries(Object.entries(checkpointValues).map(([key,values])=>[key,summarize(values)])),nodes});
}
const result={schema:1,runId:40113221553,sourceCommit:'d24e97b8d3373e294a9d7992e07b4ef532bd6dcf',
 originalPriorityMemberProof:{path:proofPath,bytes:proofBytes.length,sha256:sha(proofBytes)},cases,
 nativePairQualified:false,performanceComparisonQualified:false,sustainedTPSQualified:false,
 interpretation:'Original17-member CRC/SHA priority proof; full signed-stream/resource readback is still pending. Business Commit phases exclude empty blocks; checkpoint children include all original checkpoints, including those during empty blocks. Actual original node handler and Commit subphase durations; pooled samples represent replicas, not additional business transactions. Semantics and app_hash are children already included in validate. Phase quantiles are separate distributions and must not be added. Cumulative handler durations include lock waits and overlap across handlers/replicas. No BFT finality or qualified optimization comparison is inferred.'};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runId:result.runId,cases:cases.map(c=>({name:c.name,phases:c.pooledReplicaSamples})),nativePairQualified:false}));
