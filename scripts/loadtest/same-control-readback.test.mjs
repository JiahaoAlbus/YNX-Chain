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
