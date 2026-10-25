// Read-only evidence qualification for the existing frozen classical client pair.
// Cryptographic signatures, Merkle proofs and fee/nonce replay remain the pinned
// Go client's responsibility; this consumer never turns report booleans into a
// new independently authenticated consensus proof.
import {createHash} from 'node:crypto';
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
