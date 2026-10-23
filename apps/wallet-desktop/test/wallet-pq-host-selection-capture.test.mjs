import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createPQHostSelectionCapture} from '../src/wallet-pq-host-selection-capture.mjs';
import {PQFinalityEvidence} from '../src/wallet-pq-finality-evidence.mjs';
import {original,binding} from './helpers/pq-host-export.mjs';

const selection={sourcePath:'/PUBLIC/original-source',sourceSha256:'a'.repeat(64),sourceId:'PUBLIC.original',epoch:'2'};
const sourceCatalog={catalogPath:'/PUBLIC/private-catalog',catalogSha256:'b'.repeat(64)};
const copy=x=>structuredClone(x);
// Controlled PUBLIC child boundary only. Real PQFinalityEvidence below writes,
// fsyncs and reads back bounded original records, including after a restart.
function processFixture({exitCode=0,afterRun=null,cleanupPending=false}={}){
 let calls=0,entered,retired=0;
 const packet={result:{stdout:Buffer.from(JSON.stringify(selection)),stderr:Buffer.from('PUBLIC diagnostic'),exitCode,signal:null},lifecycle:{started:true,closeObserved:!cleanupPending,cleanupPending,interruption:null,stdoutTruncated:false,stderrTruncated:false,firstCausePresent:false,cleanupCausePresent:false},firstCause:undefined,cleanupCause:undefined};
 const selector={
  async run(input){calls++;entered=copy(input);afterRun?.();return packet;},
  snapshot(){return {...packet,result:{...packet.result,stdout:Buffer.from(packet.result.stdout),stderr:Buffer.from(packet.result.stderr)},lifecycle:{...packet.lifecycle}};},
  identity:()=>({classification:'PUBLIC controlled non-executable'}),
  retire(){retired++;},async join(){},
  assertSafeToClose(){if(packet.lifecycle.cleanupPending)throw Object.assign(Error('PUBLIC outstanding child'),{code:'PQ_FINALITY_VERIFIER_CLEANUP_PENDING'});}
 };
 return {selector,packet,calls:()=>calls,entered:()=>entered,retired:()=>retired,close(){packet.result.stderr=Buffer.from('PUBLIC late close diagnostic');packet.lifecycle.cleanupPending=false;packet.lifecycle.closeObserved=true;}};
}
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-selection-capture-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const evidence=new PQFinalityEvidence({directory,...options}),guard={account:binding.account,assert(){}};
 return {directory,evidence,guard,capture:p=>createPQHostSelectionCapture({original,binding,sourceCatalog,evidence,selector:p.selector})};
}
async function readCold(f){
 const cold=new PQFinalityEvidence({directory:f.directory}),found=await cold.candidates(original,binding);
 const rows=[];for(const ref of found.candidates)rows.push({ref,body:await cold.read(original,binding,ref)});
 return {rows,unreadable:found.unreadable};
}
test('selector original stdin, both raw streams and lifecycle are durable before returning DATA',async t=>{
 const f=await fixture(t),p=processFixture(),capture=f.capture(p);
 assert.deepEqual(await capture.run(f.guard),selection);assert.equal(p.calls(),1);
 assert.deepEqual(Object.keys(p.entered()),['catalogPath','catalogSha256','stdin']);
 const {rows,unreadable}=await readCold(f);assert.equal(rows.length,4);assert.equal(unreadable,0);
 const stdout=rows.find(x=>x.ref.kind==='host-selection-stdout').body;
 assert.deepEqual(stdout,p.packet.result.stdout);
 const metadata=JSON.parse(rows.find(x=>x.ref.kind==='host-selection-result').body);
 assert.deepEqual(metadata.catalog,sourceCatalog);assert.equal(metadata.lifecycle.closeObserved,true);assert.equal(metadata.references.length,3);
 assert.equal(capture.status().stored,true);assert.equal(capture.status().pendingSave,false);assert.equal(capture.status().nativeGrant,false);
 await assert.rejects(capture.run(f.guard),{code:'PQ_HOST_SELECTION_ALREADY_ENTERED'});capture.assertSafeToClose();
});
test('async caller mutation cannot change the retained original binding or catalog',async t=>{
 const f=await fixture(t),inputBinding={...binding},inputCatalog={...sourceCatalog};
 const p=processFixture({afterRun:()=>{inputBinding.networkId='0'.repeat(64);inputCatalog.catalogSha256='c'.repeat(64);}});
 const capture=createPQHostSelectionCapture({original,binding:inputBinding,sourceCatalog:inputCatalog,evidence:f.evidence,selector:p.selector});
 assert.deepEqual(await capture.run(f.guard),selection);
 const {rows}=await readCold(f);assert.equal(rows.length,4);
 assert.deepEqual(JSON.parse(rows.find(x=>x.ref.kind==='host-selection-result').body).catalog,sourceCatalog);
});
test('local save failure holds original output; explicit save never reruns or returns selection',async t=>{
 let fault=true;const io={...fs,open:async(...args)=>{if(fault&&typeof args[1]==='number'&&(args[1]&constants.O_CREAT))throw false;return fs.open(...args);}};
 const f=await fixture(t,{io}),p=processFixture(),capture=f.capture(p);
 await assert.rejects(capture.run(f.guard),e=>e.code==='PQ_FINALITY_EVIDENCE_UNCONFIRMED'&&e.cause===false);
 const held=f.evidence.pending();assert.ok(held);assert.equal(capture.status().pendingSave,true);assert.throws(()=>capture.assertSafeToClose());
 fault=false;const saved=await capture.save(f.guard);assert.equal(saved.saved,true);assert.equal(saved.selected,false);assert.equal(saved.active,false);assert.equal(saved.canRetry,false);assert.equal(p.calls(),1);
 assert.equal(f.evidence.pending(),null);assert.equal((await readCold(f)).rows.length,4);capture.assertSafeToClose();
 await assert.rejects(capture.run(f.guard),{code:'PQ_HOST_SELECTION_ALREADY_ENTERED'});
});
test('lock after process completion does not discard output or publish a stale selection',async t=>{
 let locked=false;const f=await fixture(t),p=processFixture({afterRun:()=>{locked=true;}}),capture=f.capture(p);
 const guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC lock'),{code:'WALLET_LOCKED'});}};
 await assert.rejects(capture.run(guard),{code:'WALLET_LOCKED'});
 assert.equal((await readCold(f)).rows.length,4);assert.equal(capture.status().selected,false);assert.equal(capture.status().stored,true);assert.equal(p.calls(),1);
 locked=false;await assert.rejects(capture.run(guard),{code:'PQ_HOST_SELECTION_ALREADY_ENTERED'});capture.assertSafeToClose();
});
test('rejected process still saves original raw success-shaped output, without accepting DATA',async t=>{
 const f=await fixture(t),p=processFixture({exitCode:1}),capture=f.capture(p);
 await assert.rejects(capture.run(f.guard),{code:'PQ_HOST_SELECTION_UNAVAILABLE'});
 assert.equal((await readCold(f)).rows.length,4);assert.equal(capture.status().selected,false);capture.assertSafeToClose();
});
test('outstanding child retains cleanup debt and later close is saved without second dispatch',async t=>{
 const f=await fixture(t),p=processFixture({cleanupPending:true}),capture=f.capture(p);
 await assert.rejects(capture.run(f.guard),{code:'PQ_FINALITY_VERIFIER_CLEANUP_PENDING'});
 assert.equal((await readCold(f)).rows.length,4);assert.equal(capture.status().pendingSave,true);
 await assert.rejects(capture.save(f.guard),{code:'PQ_FINALITY_VERIFIER_CLEANUP_PENDING'});assert.equal(p.calls(),1);
 p.close();const saved=await capture.save(f.guard);assert.equal(saved.saved,true);assert.equal(saved.selected,false);assert.equal(p.calls(),1);
 const {rows}=await readCold(f);assert.equal(rows.length,7);
 assert.ok(rows.some(x=>x.ref.kind==='host-selection-stderr'&&x.body.toString()==='PUBLIC late close diagnostic'));
 assert.equal(capture.status().pendingSave,false);capture.assertSafeToClose();
});
test('close arriving during metadata fsync cannot erase uncaptured late output',async t=>{
 const f=await fixture(t),p=processFixture({cleanupPending:true});
 const evidence={
  append:async(...args)=>{const ref=await f.evidence.append(...args);if(args[2]==='host-selection-result')p.close();return ref;},
  pending:()=>f.evidence.pending(),flush:id=>f.evidence.flush(id),assertSafeToClose:()=>f.evidence.assertSafeToClose()
 };
 const capture=createPQHostSelectionCapture({original,binding,sourceCatalog,evidence,selector:p.selector});
 await assert.rejects(capture.run(f.guard),{code:'PQ_HOST_SELECTION_PROCESS_INCOMPLETE'});
 assert.equal(capture.status().pendingSave,true);assert.equal((await readCold(f)).rows.length,4);
 await capture.save(f.guard);const {rows}=await readCold(f);assert.equal(rows.length,7);
 assert.ok(rows.some(x=>x.ref.kind==='host-selection-stderr'&&x.body.toString()==='PUBLIC late close diagnostic'));
 assert.equal(p.calls(),1);assert.equal(capture.status().selected,false);capture.assertSafeToClose();
});
test('retirement while the process returns still saves raw output without source publication',async t=>{
 const f=await fixture(t);let capture;const p=processFixture({afterRun:()=>capture.retire()});capture=f.capture(p);
 await assert.rejects(capture.run(f.guard),{code:'PQ_HOST_SELECTION_RETIRED'});
 assert.equal((await readCold(f)).rows.length,4);assert.equal(capture.status().retired,true);assert.equal(capture.status().selected,false);assert.equal(p.calls(),1);capture.assertSafeToClose();
});
test('different original owner or preexisting evidence debt blocks before a process dispatch',async t=>{
 const f=await fixture(t),p=processFixture(),capture=f.capture(p);
 await assert.rejects(capture.run({...f.guard,account:'foreign'}),{code:'PQ_HOST_CONTEXT_MISMATCH'});assert.equal(p.calls(),0);
 let fail=true;const io={...fs,open:async(...args)=>{if(fail&&typeof args[1]==='number'&&(args[1]&constants.O_CREAT))throw Error('PUBLIC disk');return fs.open(...args);}};
 const g=await fixture(t,{io});await assert.rejects(g.evidence.append(original,binding,'host-selection-stdin',Buffer.from('other original pending data')));
 const other=g.capture(p),held=g.evidence.pending();await assert.rejects(other.run(g.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});
 assert.equal(p.calls(),0);assert.equal(g.evidence.pending().eventId,held.eventId);assert.equal(other.status().entered,false);fail=false;await g.evidence.flush(held.eventId);
});
