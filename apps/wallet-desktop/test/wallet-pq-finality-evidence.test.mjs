import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {PQFinalityEvidence,PQ_FINALITY_EVIDENCE_LIMITS} from '../src/wallet-pq-finality-evidence.mjs';
const vector=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)))),row=vector.originals.find(x=>x.name==='transfer-lost-response');
const binding={account:vector.owner,networkId:vector.networkId},original=createPQOriginalRecord({account:vector.owner,kind:'pq-transfer',operationId:'QA-evidence-original',request:preparePQTransferTransport(Buffer.from(row.wire,'base64'))});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,io=fs){const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-evidence-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,store:new PQFinalityEvidence({directory,io})};}
const file=(directory,ref)=>path.join(directory,ref.eventId+'.'+ref.attemptId+'.pqfe');
test('exact detached HTTP bytes survive private disk and cold read without claiming finality',async t=>{
 const f=await fixture(t),bytes=Buffer.from([0,255,13,10,65]),expected=Buffer.from(bytes),pending=f.store.append(original,binding,'collector-http',bytes);bytes.fill(8);
 assert.throws(()=>f.store.assertSafeToClose(),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});const ref=await pending;
 assert.deepEqual(Object.keys(ref),['eventId','attemptId','kind','bytes','sha256']);assert.equal(ref.sha256,hash(expected));assert.equal((await fs.stat(file(f.directory,ref))).mode&0o777,0o600);
 const cold=new PQFinalityEvidence({directory:f.directory});assert.deepEqual(await cold.read(original,binding,ref),expected);f.store.assertSafeToClose();assert.equal(f.store.pending(),null);
 const stored=await fs.readFile(file(f.directory,ref));assert.ok(stored.includes(Buffer.from(binding.networkId)));assert.equal(JSON.stringify(ref).includes('finality'),false);
});
test('focus lock during saving cannot discard already captured bytes or authorize another effect',async t=>{
 let locked=false;const io={...fs,open:async(...args)=>{locked=true;return fs.open(...args);}},f=await fixture(t,io),ref=await f.store.append(original,binding,'verifier-stdout',Buffer.from('unverified DATA'));
 assert.equal(locked,true);assert.deepEqual(await f.store.read(original,binding,ref),Buffer.from('unverified DATA'));assert.equal(ref.consensusFinality,undefined);
});
test('partial write retains first error and close debt; explicit local flush uses new file without overwriting the failed attempt',async t=>{
 let fault=true;const cause=Error('PUBLIC disk full'),io={...fs,open:async(...args)=>{const h=await fs.open(...args);if(typeof args[1]==='number'&&(args[1]&constants.O_CREAT)){let writes=0;return new Proxy(h,{get(target,key){if(key==='writeFile')return async b=>{if(++writes===2&&fault){await target.writeFile(b.subarray(0,2));throw cause;}return target.writeFile(b);};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});}return h;}},f=await fixture(t,io),bytes=Buffer.from('original retained bytes');
 await assert.rejects(f.store.append(original,binding,'collector-http',bytes),e=>e.cause===cause);const p=f.store.pending(),partial=file(f.directory,p.lastAttempt),before=await fs.readFile(partial);assert.equal(p.causePresent,true);assert.throws(()=>f.store.assertSafeToClose());
 await assert.rejects(f.store.append(original,binding,'collector-http',bytes),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});assert.equal((await fs.readdir(f.directory)).length,1);
 fault=false;const ref=await f.store.flush(p.eventId);assert.notEqual(ref.attemptId,p.lastAttempt.attemptId);assert.deepEqual(await fs.readFile(partial),before);assert.equal((await fs.readdir(f.directory)).length,2);assert.deepEqual(await f.store.read(original,binding,ref),bytes);f.store.assertSafeToClose();
});
test('directory fsync failure after complete file keeps uncertainty and original file, never silently retries',async t=>{
 let fault=true;const cause=Error('PUBLIC directory fsync'),io={...fs,open:async(...args)=>{const h=await fs.open(...args);if(args[1]==='r')return new Proxy(h,{get(target,key){if(key==='sync')return async()=>{if(fault)throw cause;return target.sync();};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});return h;}},f=await fixture(t,io),bytes=Buffer.from('fixed stdin');
 await assert.rejects(f.store.append(original,binding,'verifier-stdin',bytes),e=>e.cause===cause);const p=f.store.pending();assert.deepEqual(await f.store.read(original,binding,p.lastAttempt),bytes);assert.throws(()=>f.store.assertSafeToClose());fault=false;
 const ref=await f.store.flush(p.eventId);assert.equal(ref.eventId,p.eventId);assert.equal((await fs.readdir(f.directory)).length,2);f.store.assertSafeToClose();
});
test('foreign original, altered bytes, broad mode, symlink and hardlink cannot pass evidence readback',async t=>{
 for(const mode of ['owner','bytes','permissions','symlink','hardlink']){const f=await fixture(t),ref=await f.store.append(original,binding,'host-context',Buffer.from('not a trust grant')),p=file(f.directory,ref);
  if(mode==='owner'){await assert.rejects(f.store.read({...original,operationId:'other-original'},binding,ref));continue;}
  if(mode==='bytes'){const b=await fs.readFile(p);b[b.length-1]^=1;await fs.writeFile(p,b);}
  if(mode==='permissions')await fs.chmod(p,0o644);
  if(mode==='symlink'){await fs.rename(p,p+'.retained');await fs.symlink(p+'.retained',p);}
  if(mode==='hardlink')await fs.link(p,p+'.alias');
  await assert.rejects(f.store.read(original,binding,ref),undefined,mode);
 }
});
test('input bounds and exotic byte accessors fail before capture or file creation',async t=>{
 const f=await fixture(t);let reads=0;const exotic=new Uint8Array(1);Object.defineProperty(exotic,'buffer',{get(){reads++;throw Error('must not run');}});
 for(const [kind,bytes] of [['foreign',Buffer.alloc(1)],['verifier-stderr',Buffer.alloc(65537)],['collector-http',exotic],['collector-http',new Proxy(new Uint8Array(1),{})],['collector-http',new Uint8Array(new SharedArrayBuffer(1))]])await assert.rejects(f.store.append(original,binding,kind,bytes),{code:'PQ_FINALITY_EVIDENCE_INVALID'});
 assert.equal(reads,0);assert.equal((await fs.readdir(f.directory)).length,0);f.store.assertSafeToClose();
});
test('falsy original storage error keeps explicit first-cause presence and cannot be erased by a later error',async t=>{
 let cause=undefined;const io={...fs,open:async(...args)=>{if(typeof args[1]==='number'&&(args[1]&constants.O_CREAT))throw cause;return fs.open(...args);}},f=await fixture(t,io);
 await assert.rejects(f.store.append(original,binding,'verifier-stderr',Buffer.alloc(0)),e=>e.cause===undefined);const held=f.store.pending();assert.equal(held.causePresent,true);
 cause=Error('PUBLIC later storage failure');await assert.rejects(f.store.flush(held.eventId),e=>e.cause===undefined);assert.equal(f.store.pending().eventId,held.eventId);assert.throws(()=>f.store.assertSafeToClose());
});
test('reference and account-binding accessors never execute during main evidence selection',async t=>{
 const f=await fixture(t);let reads=0;const bad={account:binding.account};Object.defineProperty(bad,'networkId',{enumerable:true,get(){reads++;throw Error('PUBLIC must not run');}});
 await assert.rejects(f.store.append(original,bad,'collector-http',Buffer.alloc(1)));
 const ref={eventId:{toString(){reads++;throw Error('PUBLIC must not run');}},attemptId:'x',kind:'collector-http',bytes:1,sha256:'a'.repeat(64)};await assert.rejects(f.store.read(original,binding,ref));assert.equal(reads,0);assert.equal((await fs.readdir(f.directory)).length,0);
});
test('actual Protocol context bound accepts data above old 8MiB and rejects one byte beyond the full profile before file creation',async t=>{
 const expected=4*Math.ceil((24*1024*1024)/3)+4*Math.ceil((8*1024*1024)/3)+8192;
 assert.equal(PQ_FINALITY_EVIDENCE_LIMITS['host-context'],expected+32768+1024);assert.equal(PQ_FINALITY_EVIDENCE_LIMITS['verifier-stdin'],80*1024*1024+expected+1024);
 const sentinel=Error('PUBLIC no disk write'),io={...fs,open:async()=>{throw sentinel;}},f=await fixture(t,io);
 await assert.rejects(f.store.append(original,binding,'host-context',new Uint8Array(expected+32768+1025)),{code:'PQ_FINALITY_EVIDENCE_INVALID'});assert.equal(f.store.pending(),null);
 await assert.rejects(f.store.append(original,binding,'host-context',new Uint8Array(8*1024*1024+1)),e=>e.code==='PQ_FINALITY_EVIDENCE_UNCONFIRMED'&&e.cause===sentinel);
 assert.equal(f.store.pending().bytes,8*1024*1024+1);assert.equal((await fs.readdir(f.directory)).length,0);
});
