import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {inspectRetainedPQOriginal} from '../src/wallet-pq-local-original.mjs';
import {projectPQOriginalObservation} from '../src/transaction-resolution-display.mjs';
const account='0x'+'11'.repeat(20),hash='0x'+'22'.repeat(32);
function fixture(){let remote=0,locked=false;const original={account,hash,kind:'pq-transfer',wire:'PUBLIC_NOT_A_REAL_SIGNATURE'},progress={account,hash,kind:original.kind,status:'signed-unsubmitted'},guard={account,assert(){if(locked)throw Error('CONTROLLED_LOCK');}},submissions={intentStore:{async readPQOriginals(_a,current){current();return[original];},async readPQProgress(_a,_h,current){current();return progress;}},async checkPQ(){remote++;return{outcome:'OLD_REMOTE_PATH'};}};return{original,progress,guard,submissions,remote:()=>remote,lock:()=>{locked=true;}};}
test('normal Main original-check entry uses retained custody, never the obsolete native reader',async()=>{
 const f=fixture(),main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf("handleWalletIPC('wallet:pq-transaction-status'"),end=main.indexOf("handleWalletIPC('wallet:pq-transfer-review'",start),handlers=new Map();
 runInNewContext(main.slice(start,end),{handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>fn(),keyAccess:{current:()=>f.guard},walletAuthority:{accountStatus:async()=>({account}),transactionSender:{submissions:f.submissions}},inspectRetainedPQOriginal});
 const result=await handlers.get('wallet:pq-transaction-status')({},hash);assert.equal(f.remote(),0);assert.equal(result.outcome,'original-retained-locally');assert.equal(result.networkQueryPerformed,false);assert.equal(result.signatureVerified,false);assert.equal('wire' in result,false);
 assert.doesNotMatch(main,/pqReadOriginal:readOriginalTransaction/);
});
test('local original view binds progress and preserves UNKNOWN without a network or replacement action',async()=>{
 for(const status of ['submission-unknown','inclusion-observed','rejection-observed','finalized-succeeded']){const f=fixture();f.progress.status=status;await assert.rejects(inspectRetainedPQOriginal(f.submissions,hash,account,f.guard),{code:'PQ_ORIGINAL_PROGRESS_QUERY_REQUIRED'});assert.equal(f.remote(),0);assert.equal(f.progress.status,status);}
 const f=fixture();await assert.rejects(inspectRetainedPQOriginal(f.submissions,'0x'+'33'.repeat(32),account,f.guard),{code:'TRANSACTION_INTENT_REQUIRED'});f.lock();await assert.rejects(inspectRetainedPQOriginal(f.submissions,hash,account,f.guard),/CONTROLLED_LOCK/);
});
test('local custody display refuses network, signature, retry and finality claims or wrong binding',async()=>{
 const f=fixture(),value=await inspectRetainedPQOriginal(f.submissions,hash,account,f.guard),binding={account,hash,kind:f.original.kind};
 assert.deepEqual(projectPQOriginalObservation({ok:true,value},binding),{outcome:'original-retained-locally'});
 for(const key of ['networkQueryPerformed','signatureVerified','retryAuthorized','clearsOriginal','consensusFinality'])assert.throws(()=>projectPQOriginalObservation({ok:true,value:{...value,[key]:true}},binding));
 assert.throws(()=>projectPQOriginalObservation({ok:true,value:{...value,wire:'PRIVATE'}},binding));assert.throws(()=>projectPQOriginalObservation({ok:true,value:{...value,account:'0x'+'44'.repeat(20)}},binding));
});
test('typed original check stays on its existing owned verification and query path',async()=>{const f=fixture();f.original.kind='pq-typed-action';const result=await inspectRetainedPQOriginal(f.submissions,hash,account,f.guard);assert.equal(f.remote(),1);assert.equal(result.outcome,'OLD_REMOTE_PATH');});
test('lock during the local read cannot return a stale account result',async()=>{const f=fixture();f.submissions.intentStore.readPQProgress=async()=>{f.lock();return f.progress;};await assert.rejects(inspectRetainedPQOriginal(f.submissions,hash,account,f.guard),/CONTROLLED_LOCK/);assert.equal(f.remote(),0);});
