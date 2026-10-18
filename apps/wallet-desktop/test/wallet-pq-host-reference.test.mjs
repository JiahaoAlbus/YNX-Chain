import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {EventEmitter} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixture as exportFixture,original,binding,H,J,row} from './helpers/pq-host-export.mjs';
import {PQFinalityEvidence} from '../src/wallet-pq-finality-evidence.mjs';
import {PQFinalityVerifierProcessKernel} from '../src/wallet-pq-verifier-process.mjs';
import {createPQHostContextReference} from '../src/wallet-pq-host-reference.mjs';
import {createPQFinalityVerifierCapture} from '../src/wallet-pq-verifier-capture.mjs';
import {readPQFinalityVerifierEvidence} from '../src/wallet-pq-verifier-restore.mjs';
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function fixture(t){
 const root=await fs.mkdtemp(path.join(tmpdir(),'wallet-host-ref-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const directory=path.join(root,'evidence'),f=exportFixture();f.encode();
 let creates=0,fault=0,locked=false,spawns=0;const requests=[],children=[];
 const io={...fs,open:async(...args)=>{if(typeof args[1]==='number'&&(args[1]&constants.O_CREAT)&&++creates===fault)throw Error('PUBLIC storage refusal');return fs.open(...args);}},evidence=new PQFinalityEvidence({directory,io}),guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC lock'),{code:'PUBLIC_LOCKED'});}};
 let response=async child=>{const run=f.encode();child.stdout.emit('data',run.stdout);child.stderr.emit('data',run.stderr);child.emit('close',0,null);};
 const createProducer=selected=>{
  const kernel=new PQFinalityVerifierProcessKernel({mode:'host-producer',prepare:async input=>({executable:'/PUBLIC/new-version-producer-not034',contextPath:input.sourcePath,contextSha256:input.sourceSha256,stdin:input.stdin}),spawn:(file,args,options)=>{
   spawns++;assert.equal(file,'/PUBLIC/new-version-producer-not034');assert.deepEqual(args,['--host-trust-source',selected.sourcePath,'--host-trust-source-sha256',selected.sourceSha256]);assert.equal(options.shell,false);
   const child=new EventEmitter();for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{};}child.kill=()=>true;
   child.stdin.end=bytes=>{const request=JSON.parse(Buffer.from(bytes));requests.push(request);void response(child,request).catch(cause=>child.emit('error',cause));};children.push(child);return child;
  }});
  return Object.freeze({run:input=>kernel.run(input),snapshot:()=>kernel.snapshot(),retire:()=>kernel.retire(),join:()=>kernel.join(),assertSafeToClose:()=>kernel.assertSafeToClose(),identity:()=>Object.freeze({fixtureOnly:true,sourceCommit:'PUBLIC-no-binary'}),kernel});
 };
 const holder=createPQHostContextReference({original,binding,selection:f.selection,evidence,createProducer});
 return{root,directory,f,evidence,guard,holder,requests,children,spawns:()=>spawns,fault:n=>{fault=n;},lock:value=>{locked=value;},response:fn=>{response=fn;},records:()=>evidence.candidates(original,binding)};
}
test('actual bounded Host kernel -> protected evidence -> held DATA -> same fingerprint current, with no permission grant',async t=>{
 const h=await fixture(t),first=await h.holder.acquire(h.guard);assert.equal(first.state,'held');assert.equal(first.nativeRootAuthorized,false);assert.equal(h.spawns(),1);assert.equal((await h.records()).candidates.length,4);
 await h.holder.current(h.guard);assert.deepEqual(h.requests.map(r=>r.operation),['acquire','current']);assert.equal(h.requests[0].sourceFingerprint,'');assert.equal(h.requests[1].sourceFingerprint,H);assert.equal((await h.records()).candidates.length,8);
 await h.holder.withContext(h.guard,async(input,guard)=>{guard.assert();assert.equal(input.contextSha256,h.f.source.contextSHA256);input.contextBytes.fill(0);});
 await h.holder.withContext(h.guard,async(input)=>{assert.notEqual(input.contextBytes[0],0);});await h.holder.close();assert.equal(h.holder.status().state,'closed');assert.equal(h.spawns(),6);
});
test('changed fingerprint revokes permanently and cannot reacquire or invoke a callback with a late old view',async t=>{
 const h=await fixture(t);await h.holder.acquire(h.guard);h.f.exported.sourceFingerprint=J;await assert.rejects(h.holder.current(h.guard),{code:'PQ_HOST_CONTEXT_MISMATCH'});assert.equal(h.holder.status().state,'revoked');await assert.rejects(h.holder.acquire(h.guard),{code:'PQ_HOST_REFERENCE_RETIRED'});await assert.rejects(h.holder.withContext(h.guard,()=>assert.fail('revoked view')));assert.equal(h.spawns(),2);assert.equal((await h.records()).candidates.length,8);await h.holder.close();
});
test('retirement during an actual accepted producer preserves late raw output and cannot publish held state',async t=>{
 const h=await fixture(t),entered=gate(),release=gate();h.response(async child=>{entered.resolve();await release.promise;child.stdout.emit('data',h.f.encode().stdout);child.emit('close',0,null);});
 const pending=h.holder.acquire(h.guard),rejected=assert.rejects(pending);await entered.promise;h.holder.retire();assert.throws(()=>h.holder.assertSafeToClose());release.resolve();await rejected;await h.holder.join();assert.equal(h.holder.status().held,false);assert.equal(h.holder.status().state,'retired');assert.equal((await h.records()).candidates.length,4);h.holder.assertSafeToClose();assert.equal(h.spawns(),1);
});
test('lock after producer result cannot lose its raw streams or manifest and cannot revive the source',async t=>{
 const h=await fixture(t);h.response(async child=>{h.lock(true);child.stdout.emit('data',h.f.encode().stdout);child.emit('close',0,null);});await assert.rejects(h.holder.acquire(h.guard),{code:'PUBLIC_LOCKED'});assert.equal((await h.records()).candidates.length,4);assert.equal(h.holder.status().state,'revoked');h.lock(false);await assert.rejects(h.holder.current(h.guard));h.holder.assertSafeToClose();
});
test('storage failure retains the same output; explicit local save performs zero additional producer calls or grants',async t=>{
 const h=await fixture(t);h.fault(2);await assert.rejects(h.holder.acquire(h.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});assert.equal(h.spawns(),1);assert.throws(()=>h.holder.assertSafeToClose());await assert.rejects(h.holder.current(h.guard),{code:'PQ_HOST_REFERENCE_UNCONFIRMED'});
 h.fault(0);const saved=await h.holder.saveHeld(h.guard);assert.equal(saved.saved,true);assert.equal(saved.held,false);assert.equal(saved.state,'revoked');assert.equal(h.spawns(),1);assert.equal((await h.records()).candidates.length,4);h.holder.assertSafeToClose();
});
test('malformed producer output is saved before parser rejection and never silently retried',async t=>{
 const h=await fixture(t);h.response(async child=>{child.stdout.emit('data',Buffer.from([255,0]));child.emit('close',0,null);});await assert.rejects(h.holder.acquire(h.guard));assert.equal((await h.records()).candidates.length,4);assert.equal(h.spawns(),1);assert.equal(h.holder.status().state,'revoked');h.holder.assertSafeToClose();
});
test('join and close wait for a borrowed original context action, while retirement suppresses its later publication',async t=>{
 const h=await fixture(t);await h.holder.acquire(h.guard);const entered=gate(),release=gate();const work=h.holder.withContext(h.guard,async()=>{entered.resolve();await release.promise;return 'PUBLIC saved result';}),rejected=assert.rejects(work,{code:'PQ_HOST_REFERENCE_RETIRED'});await entered.promise;assert.throws(()=>h.holder.assertSafeToClose());let closed=false;const close=h.holder.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release.resolve();await rejected;await close;assert.equal(closed,true);assert.equal(h.holder.status().state,'closed');assert.equal(h.spawns(),2);
});
test('locked or foreign account rejects before producer construction and retirement before acquisition stays terminal',async t=>{
 const h=await fixture(t);h.lock(true);await assert.rejects(h.holder.acquire(h.guard),{code:'PUBLIC_LOCKED'});h.lock(false);await assert.rejects(h.holder.acquire({...h.guard,account:'foreign'}),{code:'PQ_HOST_CONTEXT_MISMATCH'});assert.equal(h.spawns(),0);h.holder.retire();await assert.rejects(h.holder.acquire(h.guard),{code:'PQ_HOST_REFERENCE_RETIRED'});await h.holder.close();
});
test('same captured proof survives post-action Host change; no replacement process or false publication follows',async t=>{
 const h=await fixture(t);await h.holder.acquire(h.guard);let proofCalls=0;
 const kernel=new PQFinalityVerifierProcessKernel({prepare:async input=>({executable:'/PUBLIC/fixed-proof-fixture',...input}),spawn:()=>{proofCalls++;const child=new EventEmitter();for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{};}child.kill=()=>true;child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify(row.expectedResponse)+'\n'));child.emit('close',0,null);});return child;}});
 const verifier={run:i=>kernel.run(i),snapshot:()=>kernel.snapshot(),retire:()=>kernel.retire(),join:()=>kernel.join(),assertSafeToClose:()=>kernel.assertSafeToClose()},capture=createPQFinalityVerifierCapture({evidence:h.evidence,verifier});
 await assert.rejects(h.holder.withContext(h.guard,async(context,guard)=>{const saved=await capture.run(original,binding,{...context,proof:row.request.proof},guard);assert.equal(saved.observation.reportedOutcome,'succeeded');h.f.exported.sourceFingerprint=J;return saved;}),{code:'PQ_HOST_CONTEXT_MISMATCH'});
 assert.equal(proofCalls,1);assert.equal(h.spawns(),3);assert.equal(h.holder.status().state,'revoked');const refs=await h.records();assert.equal(refs.candidates.length,17);const ref=refs.candidates.find(r=>r.kind==='verifier-result'),cold=await readPQFinalityVerifierEvidence(original,binding,new PQFinalityEvidence({directory:h.directory}),ref);
 assert.equal(cold.status,'verifier-result-data');assert.equal(cold.independentFinality,false);assert.equal(cold.canRetry,false);assert.equal(cold.clearsOriginal,false);h.holder.assertSafeToClose();capture.assertSafeToClose();
});
