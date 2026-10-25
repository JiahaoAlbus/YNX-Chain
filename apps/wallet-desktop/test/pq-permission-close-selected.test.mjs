import test from 'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';
import {TransactionPermissionKernel} from '../src/original-policy-supplier/transaction-permission-kernel.mjs';
import {encodePQNativeTransfer} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const at=Date.parse('2026-10-25T13:00:00.000Z'),account='0x'+'22'.repeat(20),networkId='11'.repeat(32);
function fixture(action='sign',options={}){
 const transfer=Object.freeze({chainId:networkId,nativeChainId:'6423',from:account,to:'0x'+'33'.repeat(20),amount:'1',fee:'1',nonce:'1'});
 const request={action,networkId,nativeChainId:'6423',account,operationId:'Auth-PQ-Close-Only-PUBLIC',origin:'ynx-wallet:local-pq',transfer,requestDigest:createHash('sha256').update(encodePQNativeTransfer(transfer)).digest('hex'),...(action==='sign'?{policyRevision:'1',expiresAt:new Date(at+20000).toISOString()}:{transportHash:'0x'+'44'.repeat(32)})};
 const counts={entry:0,retire:0,join:0,close:0,completed:0};let kernel,hook=null;
 const peer={readOriginal(){return{request,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+10000).toISOString()}},assertCurrent(){if(hook){const fn=hook;hook=null;fn()}},recheck(){return options.recheck?.()},enterOriginal(){counts.entry++},completeOriginal(){counts.completed++},assertCompletedCurrent(){},retire(){counts.retire++},join(){counts.join++},close(){counts.close++;if(options.closeFailure)throw options.closeCause}};
 kernel=new TransactionPermissionKernel(request,peer,()=>at);return{kernel,counts,setHook(fn){hook=fn}};
}
for(const action of['sign','broadcast'])test(`PQ actual Auth kernel close-selected blocks same-tick ${action} before peer effect`,async()=>{
 const f=fixture(action);await f.kernel.initialize();const closing=f.kernel.close();let refused=false;
 try{action==='sign'?f.kernel.enterSign():f.kernel.enterBroadcast()}catch{refused=true}
 // Capture the actual foreign-effect counter too, so a throwing assertion
 // cannot disguise an entered operation after Close was already selected.
 await closing;assert.equal(refused,true,'closing permission stayed live');assert.equal(f.counts.entry,0,'peer.enterOriginal was called after close');assert.equal(f.counts.retire,1);assert.equal(f.counts.join,1);assert.equal(f.counts.close,1);
 assert.equal(f.kernel.outcome().effectRetryAuthorized,false);
});
test('PQ actual Auth kernel close during foreign current prevents subsequent entry and retains close once',async()=>{
 const f=fixture();await f.kernel.initialize();let closing;f.setHook(()=>{closing=f.kernel.close()});assert.throws(()=>f.kernel.enterSign());await closing;
 assert.equal(f.counts.entry,0);await f.kernel.close();assert.equal(f.counts.retire,1);assert.equal(f.counts.join,1);assert.equal(f.counts.close,1);
});
test('PQ actual Auth kernel close fences a pending recheck and joins its SAME failure',async()=>{
 let release,entered;const ready=new Promise(r=>{entered=r});const pending=new Promise(r=>{release=r});
 const f=fixture('sign',{recheck(){entered();return pending}});await f.kernel.initialize();
 const check=f.kernel.recheck(),checkResult=assert.rejects(check);await ready;
 const closing=f.kernel.close();assert.throws(()=>f.kernel.enterSign());assert.equal(f.counts.entry,0);
 assert.equal(f.kernel.close(),closing);assert.equal(f.counts.close,0);release();await checkResult;await closing;assert.equal(f.counts.join,1);assert.equal(f.counts.close,1);
});
test('PQ actual Auth kernel close preserves completed original and unknown retry boundary',async()=>{
 const f=fixture();await f.kernel.initialize();f.kernel.enterSign();const result={outcome:'returned',transportHash:'0x'+'44'.repeat(32)};f.kernel.complete(result);
 const held=f.kernel.outcome().result,closing=f.kernel.close();assert.deepEqual(held,result);assert.equal(f.kernel.outcome().result,held);assert.throws(()=>f.kernel.enterSign());await closing;
 assert.equal(f.kernel.outcome().result,held);assert.equal(f.counts.entry,1);assert.equal(f.counts.completed,1);assert.equal(f.counts.close,1);assert.equal(f.kernel.outcome().effectRetryAuthorized,false);
});
test('PQ actual Auth kernel false first close failure stays exact and does not repeat primitive',async()=>{
 const f=fixture('sign',{closeFailure:true,closeCause:false});await f.kernel.initialize();const closing=f.kernel.close();
 await assert.rejects(closing,e=>e===false);assert.equal(f.kernel.close(),closing);await assert.rejects(f.kernel.close(),e=>e===false);assert.equal(f.kernel.outcome().cleanupCause,false);assert.equal(f.counts.close,1);assert.equal(f.counts.entry,0);
});
