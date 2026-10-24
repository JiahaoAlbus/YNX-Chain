// Offline diagnostic extraction only; original resource refusal remains binding.
// Usage: node THIS.mjs ORIGINAL_RUN_DIRECTORY NEW_OUTPUT_JSON
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readNodePhaseTiming} from '../../../scripts/loadtest/node-phase-timing.mjs';
const [root,output]=process.argv.slice(2);
if(!root||!output)throw Error('original run directory and new output required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const proofPath=path.join(root,'complete-original-public-integrity-03.json');
const proofBytes=fs.readFileSync(proofPath),proof=JSON.parse(proofBytes);
if(sha(proofBytes)!=='19179efb68cfa0812a3e4aa33614b4855b974f99802c07f6899ea4b25545b832')throw Error('original integrity proof hash differs');
if(proof.fullOriginalPublicIntegrityVerified!==true||proof.nativePairQualified!==false||proof.networkRangeBytes!==0||proof.originalMemberIntegrity.members!==549||proof.originalMemberIntegrity.bytes!==44070424)throw Error('original integrity proof differs');
const summarize=values=>{
 if(!values.length||values.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('missing or invalid phase samples');
 const sorted=[...values].sort((a,b)=>a-b),q=p=>sorted[Math.ceil(sorted.length*p)-1]/1e6;
 return {samples:values.length,totalMs:values.reduce((a,b)=>a+b,0)/1e6,meanMs:values.reduce((a,b)=>a+b,0)/values.length/1e6,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99)};
};
const expectedLogSHA256={"before-native-prepared-bounded":{"0":"8f01916582ebceac7d61cdbaaefcae2e70484b33ff0d61e56602cd1e7c55c3e0","1":"9bc1153cb8110c6bb9ee658d8229170bb2e7003bde5edeb6dbf84982beaf9e6a","2":"d80f719f723a06bc02e4f3d9b165e67bedf1ea719d5b4d027ac19758da151f0f","3":"bbc93236b361bc502b2bc45bfb3f97eff4f39813079e8c1a0303afc8598d1102"},"after-native-prepared-grouped":{"0":"b8511b257502d2bc112211bccae8ed13ec2e69603d0cfa2f2276065b37dbd165","1":"0c85c0c5de792eff42f82b882cd837f6a900112f714c7f282ae5730784a2d8ce","2":"04c8ae1d5dfc3406a78af8f8c9cf3b6acb3dc51da2af9f3ba3b8117696d2de11","3":"21559df218a14420e1f0df777b54e59e622e4b932ca63cbde9e9e1a93382d1e5"}};
const cases=[];
for(const name of ['before-native-prepared-bounded','after-native-prepared-grouped']){
 const nodes=[];let common;
 for(let i=0;i<4;i++){
  const file=path.join(root,'capture',name,`abci-${i}.log`),bytes=fs.readFileSync(file),log=bytes.toString();
  if(sha(bytes)!==expectedLogSHA256[name][i])throw Error('original node log hash differs');
  const timing=readNodePhaseTiming(log);
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
 cases.push({name,effectiveTransactions:8192,replicas:4,pooledReplicaSamples:pooled,nodes});
}
const result={schema:1,runId:40101270671,sourceCommit:'1f21f1f2eed732c0948ac98ff7028bee5f2d6ca4',
 originalIntegrityProof:{path:proofPath,bytes:proofBytes.length,sha256:sha(proofBytes)},cases,
 nativePairQualified:false,performanceComparisonQualified:false,sustainedTPSQualified:false,
 interpretation:'Actual original node handler and Commit subphase durations; pooled samples represent replicas, not additional business transactions. Semantics and app_hash are children already included in validate. Phase quantiles are separate distributions and must not be added. Cumulative handler durations include lock waits and overlap across handlers/replicas. No BFT finality or qualified optimization comparison is inferred.'};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runId:result.runId,cases:cases.map(c=>({name:c.name,phases:c.pooledReplicaSamples})),nativePairQualified:false}));
