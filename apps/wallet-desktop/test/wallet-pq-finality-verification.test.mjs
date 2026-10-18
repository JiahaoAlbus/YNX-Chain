import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {EventEmitter} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixture as exportFixture,original,binding,row} from './helpers/pq-host-export.mjs';
import {PQFinalityEvidence} from '../src/wallet-pq-finality-evidence.mjs';
import {PQFinalityVerifierProcessKernel} from '../src/wallet-pq-verifier-process.mjs';
import {createPQFinalityVerification} from '../src/wallet-pq-finality-verification.mjs';
import {readPQFinalityVerifierEvidence} from '../src/wallet-pq-verifier-restore.mjs';
import {runInNewContext} from 'node:vm';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(tmpdir(),'wallet-host-main-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const f=exportFixture();f.encode();
 let writes=0,fault=0,hostCalls=0,proofCalls=0,selectCalls=0,locked=false,missing=false,afterProof=()=>{};
 const io={...fs,open:async(...args)=>{if(typeof args[1]==='number'&&(args[1]&constants.O_CREAT)&&++writes===fault)throw Error('PUBLIC storage refusal');return fs.open(...args);}},evidence=new PQFinalityEvidence({directory:path.join(root,'evidence'),io});
 const guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC locked'),{code:'PUBLIC_LOCKED'});}};
 function kernel(mode){return new PQFinalityVerifierProcessKernel({mode,prepare:async input=>({executable:'/PUBLIC/not-a-real-binary',contextPath:mode==='proof'?input.contextPath:input.sourcePath,contextSha256:mode==='proof'?input.contextSha256:input.sourceSha256,stdin:input.stdin}),spawn:()=>{
  mode==='proof'?proofCalls++:hostCalls++;const child=new EventEmitter();for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{};}child.kill=()=>true;
  child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data',mode==='proof'?Buffer.from(JSON.stringify(row.expectedResponse)):f.encode().stdout);if(mode==='proof')afterProof();child.emit('close',0,null);});return child;
 }});}
 const service=createPQFinalityVerification({evidence,selectSource:async()=>{selectCalls++;if(missing)throw Object.assign(Error('PUBLIC no genuine source'),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});return f.selection;},createProducer:()=>kernel('host-producer'),createVerifier:()=>kernel('proof')});
 return {root,f,service,evidence,guard,counts:()=>({hostCalls,proofCalls,selectCalls}),fault:n=>{fault=n;},lock:v=>{locked=v;},missing:()=>{missing=true;},afterProof:fn=>{afterProof=fn;}};
}
test('Main verification orchestrates acquire/current, same original proof capture and final current without granting finality',async t=>{
 const f=await fixture(t),result=await f.service.verify(original,binding,row.request.proof,f.guard);
 assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:3,proofCalls:1});assert.equal(result.hash,original.hash);assert.equal(result.rawStored,true);assert.equal(result.status,'verifier-result-data');
 for(const key of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'])assert.equal(result[key],false);
 assert.doesNotMatch(JSON.stringify(result),/contextPath|sourcePath|references|nativeWire|envelope/);assert.equal(f.service.pending(),false);f.service.assertSafeToClose();
 const found=await f.evidence.candidates(original,binding);assert.equal(found.candidates.length,17);const ref=found.candidates.find(x=>x.kind==='verifier-result');const cold=await readPQFinalityVerifierEvidence(original,binding,f.evidence,ref);assert.equal(cold.status,'verifier-result-data');assert.equal(cold.independentFinality,false);
});
test('missing original source refuses before producer or verifier construction, without an alternate supplier',async t=>{
 const f=await fixture(t);f.missing();await assert.rejects(f.service.verify(original,binding,row.request.proof,f.guard),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});
 assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:0,proofCalls:0});assert.equal(f.service.pending(),false);f.service.assertSafeToClose();
});
test('proof-result storage refusal retains same operation; explicit local save constructs no second process or source',async t=>{
 const f=await fixture(t);f.fault(11);await assert.rejects(f.service.verify(original,binding,row.request.proof,f.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});
 assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:2,proofCalls:1});assert.equal(f.service.pending(original),true);assert.throws(()=>f.service.assertSafeToClose());
 await assert.rejects(f.service.verify(original,binding,row.request.proof,f.guard),{code:'PQ_FINALITY_VERIFICATION_UNCONFIRMED'});f.fault(0);
 const saved=await f.service.save(original,binding,f.guard);assert.equal(saved.saved,true);assert.equal(saved.canRetry,false);assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:2,proofCalls:1});f.service.assertSafeToClose();
});
test('lock on proof output preserves captured result and does not start final current or another proof',async t=>{
 const f=await fixture(t);f.afterProof(()=>{f.lock(true);f.service.retire();});await assert.rejects(f.service.verify(original,binding,row.request.proof,f.guard),{code:'PUBLIC_LOCKED'});
 assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:2,proofCalls:1});f.lock(false);const found=await f.evidence.candidates(original,binding);assert.equal(found.candidates.length,13);assert(found.candidates.some(r=>r.kind==='verifier-result'));f.service.assertSafeToClose();
});
test('retiring an unentered process settles join without spawning, including predispatch storage failure cleanup',async()=>{
 let spawns=0;const kernel=new PQFinalityVerifierProcessKernel({prepare:()=>assert.fail('no preparation'),spawn:()=>{spawns++;}});kernel.retire();await kernel.join();kernel.assertSafeToClose();await assert.rejects(kernel.run({}),{code:'PQ_FINALITY_VERIFIER_CANCELLED'});assert.equal(spawns,0);
});
test('normal Main close retires before joining actual proof owners and existing review cleanup',async()=>{
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf('async function shutdownOriginalPQWallet(){'),end=main.indexOf('\nconst originalAdmissionExit=',start),calls=[];let release;
 const joined=new Promise(r=>{release=r;}),context={pqFinalityCollection:{retire(){calls.push('retire');},join(){calls.push('join');return joined;}},walletAuthority:{shutdownPQReviews(){calls.push('reviews');return Promise.resolve();}}};
 assert(start>=0&&end>start);runInNewContext(main.slice(start,end)+'\nthis.shutdown=shutdownOriginalPQWallet;',context);let done=false;const work=context.shutdown().then(()=>{done=true;});assert.deepEqual(calls,['retire','reviews','join']);await Promise.resolve();assert.equal(done,false);release();await work;assert.equal(done,true);
 assert.match(main,/keyAccess\.subscribe\(status=>\{if\(status.locked\)pqFinalityCollection\?\.retire\(\)/);
});
test('predispatch storage failure can drain locally after retirement without launching the proof process',async t=>{
 const f=await fixture(t);f.fault(9);await assert.rejects(f.service.verify(original,binding,row.request.proof,f.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});
 assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:2,proofCalls:0});await f.service.join();f.fault(0);
 await assert.rejects(f.service.save(original,binding,f.guard),{code:'PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE'});
 assert.deepEqual(f.counts(),{selectCalls:1,hostCalls:2,proofCalls:0});assert.equal(f.service.pending(),false);f.service.assertSafeToClose();
 const found=await f.evidence.candidates(original,binding);assert(found.candidates.some(x=>x.kind==='verifier-result'));
});
