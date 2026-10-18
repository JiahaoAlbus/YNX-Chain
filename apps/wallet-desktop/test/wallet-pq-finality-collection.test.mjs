import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync,constants} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTransferOriginal} from '../src/features/pq-transaction/transfer-binding.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {PQFinalityEvidence} from '../src/wallet-pq-finality-evidence.mjs';
import {createPQFinalityCollection} from '../src/wallet-pq-finality-collection.mjs';
const v=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)))),r=v.originals.find(x=>x.name==='transfer-lost-response'),binding={account:v.owner,networkId:v.networkId};
const original=createPQOriginalRecord({account:v.owner,kind:'pq-transfer',operationId:'QA-collected-original',request:preparePQTransferTransport(Buffer.from(r.wire,'base64'))});
const plan=preparePQTransferOriginal(original,binding),bytes=()=>Buffer.from(JSON.stringify({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'pending',observedExecutionStatus:'committed',nativeTransactionHash:original.hash,abciTransactionHash:plan.binding.abciTransactionHash,executionHeight:'42',cometIndex:0,independentFinality:false,proofVerification:'not-performed'}));
async function fixture(t,io=fs){
 const root=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-collect-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'intents.json'),intentStore=new FileTransactionIntentStore({filePath:file});
 await intentStore.reserveOriginal(binding.account,'pq-transfer');intentStore.captureOriginal(binding.account,original,'pq-transfer');await intentStore.saveOriginal(binding.account,original.hash,()=>{});
 const before=await fs.readFile(file),directory=path.join(root,'evidence'),evidence=new PQFinalityEvidence({directory,io});let calls=0,locked=false,reply=async()=>({status:202,rawBytes:bytes()});
 const guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC locked'),{code:'PUBLIC_LOCKED'});}},transport={async readFinalityProof(o,b){calls++;assert.deepEqual(o,original);assert.deepEqual(b,binding);return reply();}},service=createPQFinalityCollection({intentStore,networkId:binding.networkId,evidence,transport});
 return {root,file,before,intentStore,evidence,service,directory,transport,guard,calls:()=>calls,lock:v=>{locked=v;},reply:fn=>{reply=fn;},unchanged:async()=>assert.deepEqual(await fs.readFile(file),before)};
}
test('original journal -> one readonly query -> exact private evidence -> pending DATA, with unchanged signed journal',async t=>{
 const f=await fixture(t),result=await f.service.collect(original.hash,f.guard);assert.equal(result.status,'pending');assert.equal(result.rawStored,true);assert.equal(result.proofCollected,false);assert.equal(result.evidence.httpStatus,202);assert.equal(result.consensusFinality,false);assert.equal(result.independentFinality,false);assert.equal(result.clearsOriginal,false);assert.equal(f.calls(),1);
 assert.deepEqual(await f.evidence.read(original,binding,result.evidence),bytes());await f.unchanged();f.service.assertSafeToClose();
 const cold=createPQFinalityCollection({intentStore:new FileTransactionIntentStore({filePath:f.file}),networkId:binding.networkId,evidence:new PQFinalityEvidence({directory:f.directory}),transport:{readFinalityProof(){throw Error('no repeat GET');}}});
 const restored=await cold.restore(original.hash,f.guard);assert.equal(restored.records.length,1);assert.deepEqual(restored.records[0],result);assert.equal(restored.unreadable,0);await f.unchanged();
});
test('late lock suppresses public completion but never drops the returned raw evidence or resets original state',async t=>{
 const f=await fixture(t);f.reply(async()=>{f.lock(true);return {status:202,rawBytes:bytes()};});await assert.rejects(f.service.collect(original.hash,f.guard),{code:'PUBLIC_LOCKED'});assert.equal(f.calls(),1);f.lock(false);
 const saved=await f.service.restore(original.hash,f.guard);assert.equal(saved.records.length,1);assert.equal(saved.records[0].rawStored,true);assert.equal(f.calls(),1);await f.unchanged();
});
test('malformed UTF8/JSON remains privately retained and restore says unverified, never missing or final',async t=>{
 const f=await fixture(t),bad=Buffer.from([255,0,123]);f.reply(async()=>({status:200,rawBytes:bad}));await assert.rejects(f.service.collect(original.hash,f.guard));const recovered=await f.service.restore(original.hash,f.guard);
 assert.equal(recovered.records.length,1);assert.equal(recovered.records[0].rawStored,true);assert.equal(recovered.records[0].status,'evidence-unverified');assert.deepEqual(await f.evidence.read(original,binding,recovered.records[0].evidence),bad);assert.equal(f.calls(),1);await f.unchanged();
});
test('disk failure blocks close and another GET; explicit save uses held bytes after unlock without another query',async t=>{
 let fault=true;const io={...fs,open:async(...args)=>{if(fault&&typeof args[1]==='number'&&(args[1]&constants.O_CREAT))throw Error('PUBLIC full disk');return fs.open(...args);}},f=await fixture(t,io);
 await assert.rejects(f.service.collect(original.hash,f.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});assert.throws(()=>f.service.assertSafeToClose());await assert.rejects(f.service.collect(original.hash,f.guard),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'});assert.equal(f.calls(),1);
 f.lock(true);await assert.rejects(f.service.save(original.hash,f.guard),{code:'PUBLIC_LOCKED'});fault=false;f.lock(false);const saved=await f.service.save(original.hash,f.guard);assert.equal(saved.rawStored,true);assert.equal(f.calls(),1);f.service.assertSafeToClose();await f.unchanged();
});
test('concurrent collection cannot enter another query and a changed original hash cannot select a transport',async t=>{
 const f=await fixture(t);let release;f.reply(()=>new Promise(resolve=>{release=resolve;}));const work=f.service.collect(original.hash,f.guard);for(let i=0;i<100&&!release;i++)await new Promise(r=>setImmediate(r));assert.equal(typeof release,'function');
 await assert.rejects(f.service.collect(original.hash,f.guard),{code:'PQ_FINALITY_COLLECTION_IN_PROGRESS'});assert.throws(()=>f.service.assertSafeToClose());release({status:202,rawBytes:bytes()});await work;assert.equal(f.calls(),1);
 await assert.rejects(f.service.collect('0x'+'0'.repeat(64),f.guard));assert.equal(f.calls(),1);await f.unchanged();
});
test('HTTP status is separately bound to raw evidence and cannot be changed during cold parsing',async t=>{
 const f=await fixture(t),result=await f.service.collect(original.hash,f.guard);await assert.rejects(f.evidence.read(original,binding,{...result.evidence,httpStatus:200}));await f.unchanged();
});
test('cold scan retains incomplete/unknown files as warnings rather than silently reporting an empty history',async t=>{
 const f=await fixture(t);await f.service.collect(original.hash,f.guard);await fs.writeFile(path.join(f.directory,'PUBLIC-unknown'),Buffer.from('retained partial'),{mode:0o600});const saved=await f.service.restore(original.hash,f.guard);assert.equal(saved.records.length,1);assert.equal(saved.unreadable,1);assert.equal(saved.consensusFinality,false);assert.equal((await fs.readdir(f.directory)).length,2);await f.unchanged();
});
test('actual normal Main and preload bind only the retained hash to the same collection and private journal',async t=>{
 const f=await fixture(t),main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await fs.readFile(new URL('../src/preload.cjs',import.meta.url),'utf8'),handlers=new Map();
 const lines=main.split('\n').filter(line=>line.startsWith("handleWalletIPC('wallet:pq-finality-")&&!line.includes('wallet:pq-finality-verifier-status'));assert.equal(lines.length,3);
 runInNewContext(lines.join('\n'),{handleWalletIPC:(name,fn)=>handlers.set(name,fn),pqFinalityCollection:f.service,keyAccess:{current:()=>f.guard},sensitiveIPC:async fn=>{try{return {ok:true,value:await fn()};}catch(e){return {ok:false,error:{code:e.code}};}}});
 let api;new Function('require',preload)(name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'ynxWallet');api=value;}},ipcRenderer:{invoke:(channel,...args)=>{assert.equal(args.length,1);assert.equal(args[0],original.hash);return handlers.get(channel)(null,...args);}}};});
 const collected=await api.collectPQFinalityEvidence(original.hash);assert.equal(collected.ok,true);assert.equal(collected.value.consensusFinality,false);const restored=await api.restorePQFinalityEvidence(original.hash);assert.equal(restored.value.records.length,1);assert.equal(f.calls(),1);
 assert.equal((await api.savePQFinalityEvidence(original.hash)).error.code,'PQ_FINALITY_NO_HELD_EVIDENCE');assert.equal(f.calls(),1);await f.unchanged();
 assert.equal((main.match(/const originalPQNodeTransport=createPQTransactionNodeTransport\(\)/g)??[]).length,1);assert.match(main,/pqFinalityCollection=createPQFinalityCollection\(\{intentStore:originalTransactionIntentStore/);assert.match(main,/pqTransactionSubmission=createPQTransactionSubmission\(\{intentStore:originalTransactionIntentStore/);assert.ok(main.includes('pqFinalityCollection?.assertSafeToClose()'));
});
