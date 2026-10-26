import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createProductSessionRequest,encodeProductSessionWalletURL,ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {DesktopWalletAuthority,MemoryPermissionStore} from '../src/desktop-wallet-authority.mjs';
import {DesktopAuthorizationController} from '../src/callback-policy.mjs';
import {PRODUCT_SESSION_REGISTRY,WALLET_AUTH_PROTOCOL_SOURCE} from '../src/wallet-auth-contract.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';

const at=new Date('2026-10-26T00:00:00.000Z'),account='0x'+'11'.repeat(20);
function requestV4(){return createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:'social',platform:'macos',deviceId:'a'.repeat(43),deviceAlgorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',deviceRegistrationId:'11111111-1111-4111-8111-111111111111',deviceRegistrationRevision:'1',deviceRegistrationDigest:'12'.repeat(32),scopes:['account:read'],purpose:'PUBLIC SDK49 consumer boundary test',nonce:'b'.repeat(43),state:'c'.repeat(43)},at);}
function fixture(){
 const calls={source:0,store:0,key:0,external:0},guard={account,assert(){}};
 const store=Object.fromEntries(['readSessionOriginal','reserveSessionOriginal','captureSessionOriginal','saveSessionOriginal','recordSessionFailure'].map(name=>[name,async()=>{calls.store++;if(name==='readSessionOriginal')return null;throw Error('PUBLIC_UNEXPECTED_JOURNAL_ENTRY');}]));
 const authority=new DesktopWalletAuthority({clock:()=>at,permissions:new MemoryPermissionStore(),vault:{authorization:{current:()=>guard,status:()=>({account,revision:1,locked:false})},status:async()=>({initialized:true,account,ynxAccount:ynxAddressFromEVM(account)}),withSecret(){calls.key++;throw Error('PUBLIC_CLASSIC_KEY_ENTRY');},withPQKeys(){calls.key++;throw Error('PUBLIC_PQ_KEY_ENTRY');}},transactionSender:{submissions:{intentStore:store}},pqNetworkId:'71'.repeat(32),pqSessionSource:async()=>{calls.source++;throw Error('PUBLIC_OLD_ACCOUNT_SOURCE_ENTERED');},pqSessionRecognized:()=>false});
 const controller=new DesktopAuthorizationController({authority,clock:()=>at,openExternal:async()=>{calls.external++;},requestId:()=> 'SDK49-public-review'});
 return {authority,controller,calls};
}
test('actual SDK49 normal receipt imports and valid v4 preview cancels without source/journal/key/callback effects',async()=>{
 assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceCommit,'afa53c4dddba6bb9e06b6619dea45af189978fb6');
 const f=fixture(),request=requestV4(),url=encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,request,at);
 const review=await f.controller.receive(url);assert.equal(review.acceptedForReview,true);assert.equal(review.request.version,'4');assert.equal(review.account,account);assert.equal(review.authorityGranted,false);
 assert.equal(f.controller.cancel(),true);assert.equal(f.controller.pending,null);assert.deepEqual(f.calls,{source:0,store:0,key:0,external:0});
});
test('v4 confirmation and reconciliation refuse absent real issuer before old account Source or journal reservation',async()=>{
 const f=fixture(),request=requestV4();
 const review=await f.controller.receive(encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,request,at));
 await assert.rejects(f.controller.act({action:'approve',id:review.id,account}),e=>e.data?.code==='PQ_DEVICE_ISSUER_NOT_SUPPLIED');
 await assert.rejects(async()=>f.authority.reconcileCanonicalAuthorization(request,account),e=>e.data?.code==='PQ_DEVICE_ISSUER_NOT_SUPPLIED');
 assert.equal(f.controller.prepared,null);assert.equal(f.controller.inFlight,false);assert.equal(f.controller.cancel(),true);assert.deepEqual(f.calls,{source:0,store:0,key:0,external:0});
});
test('SDK49 normal PQ codec retains PUBLIC original hash and UNKNOWN across lock and disk reopen, with no second submission',async t=>{
 // Copied public signed bytes only; no key generation, signing, network or real
 // authority. The store and SDK parser below are the actual product consumers.
 const vector=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)),{maxOutputLength:8*1024*1024}));
 const wire=vector.originals.find(row=>row.name==='transfer-lost-response');
 const original=createPQOriginalRecord({account:vector.owner,kind:'pq-transfer',operationId:'SDK49-public-original',request:preparePQTransferTransport(Buffer.from(wire.wire,'base64'))});
 const directory=await mkdtemp(path.join(tmpdir(),'ynx-sdk49-original-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const filePath=path.join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath}),guard=()=>{};
 await store.reserveOriginal(vector.owner,'pq-transfer');store.captureOriginal(vector.owner,original,'pq-transfer');await store.saveOriginal(vector.owner,original.hash,guard);
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(vector.owner);await lifecycle.unlock();
 await lifecycle.run(g=>store.beginPQSubmission(vector.owner,original.hash,()=>g.assert()));lifecycle.setFocused(false);assert.equal(lifecycle.status().locked,true);
 const cold=new FileTransactionIntentStore({filePath});assert.equal((await cold.readPQProgress(vector.owner,original.hash,guard)).status,'submission-unknown');
 assert.deepEqual(await cold.readPQOriginals(vector.owner,guard),[original]);assert.equal((await cold.beginPQSubmission(vector.owner,original.hash,guard)).created,false);
 const packet=name=>{const r=vector.http.find(row=>row.name===name);return {phase:r.method==='POST'?'submission':'read',statusCode:r.statusCode,text:Buffer.from(r.bodyWire,'base64').toString('utf8')};};
 await cold.savePQSubmissionResult(vector.owner,original.hash,packet('transfer-original-reconciled'));
 const before=await readFile(filePath,'utf8');await cold.savePQSubmissionResult(vector.owner,original.hash,packet('transfer-outcome-unknown'));
 assert.equal(await readFile(filePath,'utf8'),before);const reopened=new FileTransactionIntentStore({filePath});const progress=await reopened.readPQProgress(vector.owner,original.hash,guard);
 assert.equal(progress.status,'inclusion-observed');assert.equal(progress.retryAuthorized,false);assert.equal(progress.consensusFinality,false);assert.equal((await reopened.readPQOriginals(vector.owner,guard))[0].operationId,original.operationId);
});
