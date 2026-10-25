import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {preparePQMigrationTransport,decodePQMigrationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {preparePQMigrationOriginal} from './transfer-binding.mjs';
import {pqMigrationBroadcastPermissionRequest} from './migration-permission-binding.mjs';
import {createPQTransactionSubmission} from './submission.mjs';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const row=fixture.originals.find(x=>x.name==='rotation'),wire=Buffer.from(row.wire,'base64'),decoded=decodePQMigrationRequest(wire),account=decoded.intent.owner,networkId=decoded.intent.chainId;
const original=createPQOriginalRecord({account,kind:'pq-migration',operationId:'PUBLIC-stored-migration-sign',request:preparePQMigrationTransport(wire)}),plan=preparePQMigrationOriginal(original,{account,networkId});
const responseRow=fixture.http.find(x=>x.name==='rotation-committed');
const response=()=>({method:'POST',requestPath:plan.request.path,status:responseRow.statusCode,contentType:responseRow.contentType,cacheControl:responseRow.cacheControl,body:new Uint8Array(Buffer.from(responseRow.bodyWire,'base64'))});
// Public saved E6 + actual durable journal. Permission and IO peers below are
// CONTROLLED test seams, never evidence of an original Auth grant or live send.
async function setup(t,options={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-migration-once-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filePath=path.join(directory,'journal.json');let armed=false,writes=0;
 const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw Error('CONTROLLED_STORAGE_ACK_LOST')}}};
 const store=new FileTransactionIntentStore({filePath,io});await store.reserveOriginal(account,'pq-migration');store.captureOriginal(account,original,'pq-migration');await store.saveOriginal(account,original.hash,()=>{});
 let current=true,posts=0,gets=0,acquisitions=0,entries=0,closes=0;const completions=[],recognized=new WeakSet();
 const guard={account,assert(){if(!current)throw Error('CONTROLLED_LOCKED')},assertEffectCurrent(){if(!current)throw Error('CONTROLLED_LOCKED')},async submit(fn){const out=await fn();if(options.lateGuard)throw Error('CONTROLLED_GUARD_LATE');return out}};
 const acquire=async request=>{acquisitions++;const bound=Object.freeze({...request,issuedAt:new Date(Date.now()-1000).toISOString()});const resource={readOriginal:()=>bound,assertCurrent(){if(options.revoked)throw false},recheck(){if(options.revoked)throw false},enterBroadcast(){entries++},complete(value){completions.push(value)},retire(){},join(){},close(){closes++}};recognized.add(resource);return resource};
 const transport={async submitMigration(request){posts++;assert.equal((await new FileTransactionIntentStore({filePath}).readPQProgress(account,original.hash,()=>{})).status,'submission-unknown');assert.deepEqual(request.body,wire);if(options.throwPost)throw false;if(options.lateLock)current=false;if(options.armResponse)armed=true;return options.response??response()},async submitTransfer(){throw Error('NO_TRANSFER')},async readOriginal(hash){gets++;assert.equal(hash,original.hash);return {status:responseRow.statusCode,text:Buffer.from(responseRow.bodyWire,'base64').toString('utf8')}}};
 const create=(s=store,extra={})=>createPQTransactionSubmission({intentStore:s,networkId,transport,acquireOriginalWalletTransactionPermission:()=>{throw Error('NO_ORDINARY_APPROVAL')},isOriginalWalletTransactionPermission:()=>false,acquireOriginalWalletMigrationBroadcastPermission:acquire,isOriginalWalletMigrationBroadcastPermission:r=>recognized.has(r),...extra});
 const request=()=>pqMigrationBroadcastPermissionRequest(plan,{operationId:'PUBLIC-independent-broadcast-review',policyRevision:decoded.intent.priorRevision,reviewExecutionHeight:'1',executionHeight:'1',expiresAt:new Date(Date.now()+25000).toISOString()});
 return{store,filePath,guard,create,request,arm:()=>{armed=true},fresh:()=>({account,assert(){},assertEffectCurrent(){},submit:fn=>fn()}),counts:()=>({posts,gets,acquisitions,entries,closes,writes,completions})};
}
test('migration independent review enters one POST; cold duplicate refuses and query keeps original',async t=>{
 const f=await setup(t);assert.notEqual(f.request().operationId,original.operationId);const out=await f.create().broadcast(original.hash,f.guard,f.request());assert.equal(out.kind,'pq-migration');assert.equal(out.status,'inclusion-observed');assert.equal(out.consensusFinality,false);assert.equal(f.counts().posts,1);assert.deepEqual(f.counts().completions,[{outcome:'returned',transportHash:original.hash,abciTransactionHash:row.abciTransactionHash}]);
 const cold=f.create(new FileTransactionIntentStore({filePath:f.filePath}));await assert.rejects(cold.broadcast(original.hash,f.fresh(),f.request()),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});await cold.reconcile(original.hash,f.fresh());assert.equal(f.counts().posts,1);assert.equal(f.counts().gets,1);assert.equal(f.counts().acquisitions,1);assert.deepEqual(await new FileTransactionIntentStore({filePath:f.filePath}).readPQOriginals(account,()=>{}),[original]);
});
test('migration raw result is retained inside submit callback before external late guard or lock',async t=>{
 for(const options of [{lateGuard:true},{lateLock:true},{armResponse:true}]){const f=await setup(t,options);await assert.rejects(f.create().broadcast(original.hash,f.guard,f.request()));assert.equal(f.counts().posts,1);assert.equal(f.counts().completions[0].outcome,'returned');const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.equal((await cold.readPQProgress(account,original.hash,()=>{})).status,'inclusion-observed');assert.equal(f.counts().closes,1);}
});
test('migration invalid raw UTF8 remains held and refuses close, replacement or resend',async t=>{
 const f=await setup(t,{response:{...response(),body:new Uint8Array([255,0,192])}});
 await assert.rejects(f.create().broadcast(original.hash,f.guard,f.request()));
 const p=await f.store.readPQProgress(account,original.hash,()=>{});
 assert.equal(p.storageConfirmed,false);assert.equal(p.metadataConfirmed,false);assert.equal(p.localResultHeld,true);assert.equal(p.retryAuthorized,false);
 f.store.selectPQProgressOutcome(account,original.hash,slot=>{assert.equal(slot.migrationResponseUncaptured,true);assert.equal(slot.firstTypedSubmissionResponseCopied,true);assert.deepEqual(Buffer.from(slot.firstTypedSubmissionResponse.body),Buffer.from([255,0,192]));});
 assert.throws(()=>f.store.savePQMigrationSubmissionResult(account,original.hash,response()),{data:{code:'PQ_MIGRATION_RESPONSE_ALREADY_CAPTURED'}});
 await assert.rejects(f.create().broadcast(original.hash,f.fresh(),f.request()),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});
 await assert.rejects(f.store.flushPQProgressResult(account,original.hash,()=>{}),{data:{code:'PQ_MIGRATION_RESPONSE_CAPTURE_UNCONFIRMED'}});
 await assert.rejects(f.store.assertPQProgressSafeToClose(),{data:{code:'PQ_PROGRESS_CLOSE_UNCONFIRMED'}});assert.equal(f.counts().posts,1);
});
test('migration marker ACK loss and revoked approval prevent outward entry; transport unknown is query only',async t=>{
 const lost=await setup(t);lost.arm();await assert.rejects(lost.create().broadcast(original.hash,lost.guard,lost.request()));assert.equal(lost.counts().posts,0);assert.equal(lost.counts().entries,0);assert.equal((await new FileTransactionIntentStore({filePath:lost.filePath}).readPQProgress(account,original.hash,()=>{})).status,'submission-unknown');
 const revoked=await setup(t,{revoked:true});await assert.rejects(revoked.create().broadcast(original.hash,revoked.guard,revoked.request()),x=>x===false);assert.equal(revoked.counts().posts,0);assert.equal((await revoked.store.readPQProgress(account,original.hash,()=>{})).status,'signed-unsubmitted');
 const unknown=await setup(t,{throwPost:true});await assert.rejects(unknown.create().broadcast(original.hash,unknown.guard,unknown.request()),{code:'PQ_TRANSACTION_OUTCOME_UNKNOWN'});assert.equal(unknown.counts().completions[0].outcome,'unknown');await unknown.create(new FileTransactionIntentStore({filePath:unknown.filePath})).reconcile(original.hash,unknown.fresh());assert.equal(unknown.counts().posts,1);assert.equal(unknown.counts().gets,1);
});
test('migration absent or transplanted broadcast review cannot acquire a peer or create an effect marker',async t=>{
 const f=await setup(t),request=f.request();
 const cases=[null,Object.freeze({...request,operationId:original.operationId}),Object.freeze({...request,transportHash:request.abciTransactionHash,abciTransactionHash:request.transportHash}),Object.freeze({...request,currentAuthorization:'legacy'}),Object.freeze({...request,newKeyWholeProofHash:'0x'+'00'.repeat(32)}),Object.freeze({...request,migrationIntent:Object.freeze({...request.migrationIntent,ledgerNonce:'999'})})];
 for(const candidate of cases)await assert.rejects(f.create().broadcast(original.hash,f.guard,candidate),{code:'PQ_MIGRATION_PERMISSION_BINDING'});
 assert.equal(f.counts().acquisitions,0);assert.equal(f.counts().posts,0);assert.equal((await f.store.readPQProgress(account,original.hash,()=>{})).status,'signed-unsubmitted');
 const noFactory=f.create(f.store,{acquireOriginalWalletMigrationBroadcastPermission:null});await assert.rejects(noFactory.broadcast(original.hash,f.guard,request),{code:'PQ_MIGRATION_PERMISSION_NOT_SUPPLIED'});assert.equal(f.counts().posts,0);
 const ordinaryOnly=f.create(f.store,{acquireOriginalWalletMigrationBroadcastPermission:null,isOriginalWalletMigrationBroadcastPermission:null,acquireOriginalWalletTransactionPermission:()=>{throw Error('ORDINARY_MUST_NOT_ENTER')},isOriginalWalletTransactionPermission:()=>true});await assert.rejects(ordinaryOnly.broadcast(original.hash,f.guard,request),{code:'PQ_MIGRATION_PERMISSION_NOT_SUPPLIED'});assert.equal(f.counts().posts,0);
});
