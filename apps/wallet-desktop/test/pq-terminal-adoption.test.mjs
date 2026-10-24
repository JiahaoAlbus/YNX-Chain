import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
// Explicit controlled orchestration boundary. No genuine Host, proof process,
// token, source admission or consensus qualification is minted by this test.
test('normal verification calls private terminal adoption only after final Host current and observation persistence',async()=>{
 const raw=await fs.readFile(new URL('../src/wallet-pq-finality-verification.mjs',import.meta.url),'utf8'),events=[];
 const original={account:'PUBLIC-account',hash:'PUBLIC-hash',operationId:'PUBLIC-operation',kind:'pq-transfer'},binding={account:original.account},guard={account:original.account,assert(){}};
 const result={observation:{status:'verifier-result-data',reportedOutcome:'succeeded'},journalRecord:{PUBLIC:'record'}};
 const host={async acquire(){events.push('acquire');},async withContext(g,action){events.push('before-current');const value=await action({},g);events.push('after-current');return value;},retire(){},join:async()=>{},assertSafeToClose(){}};
 const token=Object.freeze({PUBLIC:'not a real terminal token'});
 const context={createPQHostContextReference:()=>host,createPQFinalityVerifierCapture:()=>({run:async()=>{events.push('proof');return result;},retire(){},assertSafeToClose(){}}),supportsPackagedPQTypedFinality:()=>true,originalPQVerifierReceipt:{},preparePQFinalityOriginal:()=>{},createPQVerifiedFinalityTerminal:()=>token};
 runInNewContext(raw.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nthis.create=createPQFinalityVerification;',context);
 const service=context.create({evidence:{assertSafeToClose(){}},selectSource:async()=>({}),createProducer:()=>({}),createVerifier:()=>({}),persistObservation:async()=>{events.push('observation');return{stored:true};},flushObservation:async()=>({stored:true}),adoptTerminal:async(o,t)=>{assert.equal(o,original);assert.equal(t,token);events.push('terminal');return{stored:true,status:'finalized-succeeded',consensusFinality:true,nativeGrant:false};}});
 const accepted=await service.verify(original,binding,{},guard);
 assert.deepEqual(events,['acquire','before-current','proof','after-current','observation','terminal']);assert.equal(accepted.consensusFinality,true);assert.equal(accepted.nativeGrant,false);
});
test('controlled accepted terminal fact survives journal failure; local save neither rechecks a retired Host nor reruns the proof',async()=>{
 const raw=await fs.readFile(new URL('../src/wallet-pq-finality-verification.mjs',import.meta.url),'utf8'),events=[],original={account:'PUBLIC-account',hash:'PUBLIC-hash',operationId:'PUBLIC-operation',kind:'pq-transfer'},binding={account:'PUBLIC-account'},guard={account:'PUBLIC-account',assert(){}};
 const result={observation:{status:'verifier-result-data'},journalRecord:{PUBLIC:true}},token=Object.freeze({PUBLIC:'controlled only'}),host={acquire:async()=>events.push('acquire'),withContext:async(g,action)=>{events.push('before');const r=await action({},g);events.push('after');return r;},retire(){},status:()=>({pendingSave:false}),assertSafeToClose(){}};
 const context={createPQHostContextReference:()=>host,createPQFinalityVerifierCapture:()=>({run:async()=>{events.push('proof');return result;},retire(){},assertSafeToClose(){}}),supportsPackagedPQTypedFinality:()=>true,originalPQVerifierReceipt:{},preparePQFinalityOriginal:()=>{},createPQVerifiedFinalityTerminal:()=>{events.push('token');return token;}};
 runInNewContext(raw.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nthis.create=createPQFinalityVerification;',context);
 const service=context.create({evidence:{assertSafeToClose(){}},selectSource:async()=>({}),createProducer:()=>({}),createVerifier:()=>({}),persistObservation:async()=>{events.push('failed-save');throw false;},flushObservation:async()=>{events.push('flush');return{stored:true};},adoptTerminal:async(o,t)=>{assert.equal(t,token);events.push('adopt');return{stored:true,status:'finalized-succeeded',consensusFinality:true,independentFinality:true,nativeGrant:false};}});
 await assert.rejects(service.verify(original,binding,{},guard),e=>e===false);assert.equal(service.pending(original),true);const saved=await service.save(original,binding,guard);assert.equal(saved.consensusFinality,true);assert.equal(saved.status,'finalized-succeeded');assert.deepEqual(events,['acquire','before','proof','after','token','failed-save','flush','adopt']);assert.equal(service.pending(),false);
});
