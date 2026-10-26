import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {decodePQMigrationRequest,decodePQTransferRequest,preparePQMigrationTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {DesktopWalletAuthority,MemoryPermissionStore} from '../src/desktop-wallet-authority.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {captureCometPolicyObservation} from '../src/original-policy-supplier/comet-projection.mjs';
import {encodeOperatorPolicyPacket} from '../src/original-policy-supplier/operator-packet.mjs';
import {TransactionPolicyResourceKernel} from '../src/original-policy-supplier/transaction-resource.mjs';
import {createPQTransactionSubmission} from '../src/features/pq-transaction/submission.mjs';
import {createPUBLICPeer} from './wallet-pq-typed-auth-peer.fixture.mjs';
const peerURL=new URL('./wallet-pq-typed-auth-peer.fixture.mjs',import.meta.url).href;
const hook=registerHooks({resolve(name,context,next){return name==='electron'?{url:peerURL,shortCircuit:true}:next(name,context);}});
let permission;try{permission=await import('../src/original-policy-supplier/transaction-permission.mjs');}finally{hook.deregister();}
const vector=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const decode=name=>decodePQMigrationRequest(Buffer.from(vector.originals.find(r=>r.name===name).wire,'base64'));
const first=decode('initial-migration').intent,second=decode('rotation').intent;
const wire=Buffer.from(vector.originals.find(r=>r.name==='transfer-lost-response').wire,'base64'),transfer=decodePQTransferRequest(wire).transfer,account=transfer.from,networkId=transfer.chainId;
// Real product authority, private borrow, Auth permission factory/kernel and
// journal. ONLY Electron, policy Source and Vault's Native callee are PUBLIC
// controlled ports. The callee returns a previously published fixture member;
// no private key, new signing, production approval, Native crypto or I/O exists.
async function fixture(t,{lateLock=false,legacyE6=false}={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-sdk49-native-e6-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const filePath=path.join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath}),counts={source:0,permission:0,native:0,portable:0,post:0};let current=true;
 const guard={account,assert(){if(!current)throw Error('PUBLIC_LOCKED_AFTER_CAPTURE');}},record=(intent,registeredAt)=>({algorithmVersion:intent.algorithmVersion,owner:account,pkA:intent.pkA,pkB:intent.pkB,revision:intent.newRevision,registeredAt,activeFrom:intent.activateAt,ledgerNonce:intent.ledgerNonce});
 const snapshot=parsePQAccountAuthorization(legacyE6?{owner:account,executionHeight:'2',ledgerNonce:'0',algorithmVersion:'legacy',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'1',records:[]}:{owner:account,executionHeight:'6',ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'1',activeRevision:'2',records:[record(first,'2'),record(second,'4')]},{owner:account,chainId:networkId,nativeChainId:'6423'});
 const observation=captureCometPolicyObservation({kind:'comet-node-observed-app-state/v1',source:'comet-rpc',recordsView:'committed',committedHeight:legacyE6?'1':'5',committedAppHash:'a'.repeat(64),independentFinality:false},snapshot);
 const policyText=JSON.stringify({version:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'1',records:snapshot.records}),resources=new WeakSet();
 const source=async request=>{counts.source++;const now=Date.now(),packet=encodeOperatorPolicyPacket('transaction',request,{authorization:snapshot,observation,committedHeight:'5',committedAppHash:'a'.repeat(64)},now,now+29000,policyText),resource=new TransactionPolicyResourceKernel(request,{readOriginal:async()=>packet,recheck:async()=>packet,retire(){},async join(){},async close(){}});await resource.initialize();resources.add(resource);return resource;};
 const vault={authorization:{current:()=>guard,status:()=>({account,revision:1,locked:!current})},status:async()=>({account,initialized:true}),assertPQNativeTransactionAvailable(){},async withPQNativeTransaction(binding,request,capture,approval){counts.native++;approval.assert();assert.equal(binding.owner,account);assert.equal(request.policyOriginal.toString(),policyText);capture({member:Buffer.from(wire)});if(lateLock)current=false;approval.assert();},withPQKeys(){counts.portable++;assert.fail('No portable signer');},withSecret(){counts.portable++;assert.fail('No classic signer');}};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqBroadcastSource:()=>{counts.post++;assert.fail('No real broadcast');},pqNetworkId:networkId,pqPolicySource:source,pqPolicyRecognized:r=>resources.has(r),pqTransactionPermissionSource:(...args)=>{counts.permission++;return permission.acquireOriginalWalletTransactionPermission(...args);},pqTransactionPermissionRecognized:permission.isOriginalWalletTransactionPermission});
 t.after(()=>authority.shutdownPQReviews());return {authority,store,filePath,counts,unlock:()=>{current=true;}};
}
test('ordinary native approval reaches existing transaction permission and captures public member without any v4 issuer',async t=>{
 const f=await fixture(t),review=await f.authority.requestPQTransfer({to:transfer.to,amount:transfer.amount});assert.equal(review.request.method,'ynx_signPQNativeTransfer');
 const peer=createPUBLICPeer(new URL('../src/index.html',import.meta.url).href),capsule=permission.captureOriginalWalletTransactionApprovalIPC(peer,review.request.id,'sign');
 const result=await f.authority.approve(review.request.id,capsule);assert.equal(result.result.savedLocally,true);assert.equal(result.result.submitted,false);
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),[saved]=await cold.readPQOriginals(account,()=>{});assert.equal(saved.operationId,review.request.id);assert.deepEqual(Buffer.from(saved.wire,'base64url'),wire);assert.equal((await cold.readPQProgress(account,saved.hash,()=>{})).status,'signed-unsubmitted');
 assert.deepEqual(f.counts,{source:1,permission:1,native:1,portable:0,post:0});assert.equal(peer.sender.listenerCount('destroyed'),0);
});
test('ordinary native public result survives late lock and explicit local save without signing again',async t=>{
 const f=await fixture(t,{lateLock:true}),review=await f.authority.requestPQTransfer({to:transfer.to,amount:transfer.amount}),peer=createPUBLICPeer(new URL('../src/index.html',import.meta.url).href),capsule=permission.captureOriginalWalletTransactionApprovalIPC(peer,review.request.id,'sign');
 await assert.rejects(f.authority.approve(review.request.id,capsule));
 const held=f.store.localOriginal(account);assert.deepEqual(Buffer.from(held.pq.wire,'base64url'),wire);assert.equal(held.pq.operationId,review.request.id);
 assert.ok(await new FileTransactionIntentStore({filePath:f.filePath}).unresolvedPreparation(account));
 f.unlock();await f.store.saveOriginal(account,held.pq.hash,()=>{});assert.equal((await new FileTransactionIntentStore({filePath:f.filePath}).readPQOriginals(account,()=>{}))[0].hash,held.pq.hash);
 assert.equal(f.counts.native,1);assert.equal(f.counts.permission,1);assert.equal(f.counts.portable,0);assert.equal(f.counts.post,0);
});
test('legacy E6 enters its own ordinary migration preview and cancels without re-signing or using v4 session',async t=>{
 const f=await fixture(t,{legacyE6:true}),row=vector.originals.find(r=>r.name==='initial-migration'),original=createPQOriginalRecord({account,kind:'pq-migration',operationId:'PUBLIC-existing-legacy-E6-review',request:preparePQMigrationTransport(Buffer.from(row.wire,'base64'))});
 await f.store.reserveOriginal(account,'pq-migration');f.store.captureOriginal(account,original,'pq-migration');await f.store.saveOriginal(account,original.hash,()=>{});
 const preview=await f.authority.requestPQBroadcast(original.hash);assert.equal(preview.request.method,'ynx_broadcastPQMigration');assert.equal(preview.request.review.originalOperationId,original.operationId);assert.equal(preview.request.review.hash,original.hash);
 assert.throws(()=>f.authority.reject(preview.request.id),e=>e.code===4001);await f.authority.shutdownPQReviews();
 assert.deepEqual(await new FileTransactionIntentStore({filePath:f.filePath}).readPQOriginals(account,()=>{}),[original]);assert.deepEqual(f.counts,{source:1,permission:0,native:0,portable:0,post:0});
});
test('existing legacy E6 cold UNKNOWN reads only the original migration ID/hash without new keys, v4 issuer or approval',async t=>{
 const f=await fixture(t),row=vector.originals.find(r=>r.name==='initial-migration'),original=createPQOriginalRecord({account,kind:'pq-migration',operationId:'PUBLIC-existing-legacy-E6',request:preparePQMigrationTransport(Buffer.from(row.wire,'base64'))});
 await f.store.reserveOriginal(account,'pq-migration');f.store.captureOriginal(account,original,'pq-migration');await f.store.saveOriginal(account,original.hash,()=>{});await f.store.beginPQSubmission(account,original.hash,()=>{});
 const response=vector.http.find(r=>r.name==='migration-committed'),calls=[];
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),controller=createPQTransactionSubmission({intentStore:cold,networkId,transport:{async readOriginal(hash){calls.push(hash);return {status:response.statusCode,text:Buffer.from(response.bodyWire,'base64').toString('utf8')};},submitMigration(){assert.fail('No E6 resend');},submitTransfer(){assert.fail('No transfer cast');}}});
 const progress=await controller.reconcile(original.hash,{account,assert(){}});assert.equal(progress.kind,'pq-migration');assert.equal(progress.status,'inclusion-observed');assert.equal(progress.consensusFinality,false);assert.deepEqual(calls,[original.hash]);assert.deepEqual(await cold.readPQOriginals(account,()=>{}),[original]);
 assert.deepEqual(f.counts,{source:0,permission:0,native:0,portable:0,post:0});
});
