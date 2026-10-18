import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {qualifySameControlReadback,compareSameControlReadbacks} from './same-control-readback.mjs';
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
