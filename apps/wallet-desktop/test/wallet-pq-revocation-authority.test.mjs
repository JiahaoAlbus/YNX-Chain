import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {DesktopWalletAuthority,MemoryPermissionStore} from '../src/desktop-wallet-authority.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import * as keys from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import * as backup from '@ynx-chain/wallet-auth/pq-wallet-backup';
import * as contract from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {pqPublicBindingToRegistrationKeys,decodePQRevocationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import https from 'node:https';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';
import {acquireOriginalWalletTransactionPolicy,isOriginalWalletTransactionPolicy} from '../src/original-policy-supplier/transaction-resource.mjs';
const SDK=Object.freeze({...keys,...backup,...contract}),CHAIN='16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f',PASSWORD='isolated-revocation-QA-password';
// Actual encrypted PasswordWalletVault and SDK, synthetic original policy only.
// No user profiles, registered chain authority, signing UI or network effects.
async function fixture(t,{pending=false,onRecheck,recognized=true,onAcquire,normal=false}={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-revoke-authority-')),filePath=path.join(directory,'vault.json'),lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:SDK,randomSecret:()=> '1'.padStart(64,'0')});lifecycle.authorizer=vault.authorizer();
 t.after(async()=>{lifecycle.lock();await fs.rm(directory,{recursive:true,force:true});});
 await lifecycle.custody(g=>vault.setup({password:PASSWORD,confirmation:PASSWORD},g));await lifecycle.unlock({password:PASSWORD});
 const status=await lifecycle.run(()=>vault.createAccount());lifecycle.setAccount(status.account);await lifecycle.unlock({password:PASSWORD});
 const handle=await keys.createPQWalletKeyHandle({chainId:CHAIN,owner:status.account}),binding=keys.readPQWalletKeyPublic(handle);t.after(()=>keys.destroyPQWalletKeyHandle(handle));
 await lifecycle.run(()=>vault.savePQKeys({handle,publicBinding:binding,operationId:'QA-existing-pair'}));
 const pair=pqPublicBindingToRegistrationKeys(binding),records=[{algorithmVersion:pair.algorithmVersion,owner:status.account,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}];
 if(pending)records.push({...records[0],revision:'2',registeredAt:'25',activeFrom:'60',ledgerNonce:'2',pkA:'01'.repeat(2592),pkB:'02'.repeat(64)});
 const authorization=parsePQAccountAuthorization({owner:status.account,executionHeight:'30',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:CHAIN,enableAt:'10',activeRevision:'1',records},{chainId:CHAIN,nativeChainId:'6423',owner:status.account});
 const view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:CHAIN,nativeChainId:'6423',canonicalOwner:status.account,authorization,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
 let retired=false;const counts={acquire:0,recheck:0,retire:0,join:0,close:0,sign:0};
 const resource={assertCurrent(){if(retired)throw Error('QA_RETIRED');},readOriginal(){return view;},async recheck(){counts.recheck++;await onRecheck?.();},retire(){retired=true;counts.retire++;},async join(){counts.join++;},async close(){counts.close++;}};
 const source=async input=>{counts.acquire++;assert.equal(input.operation,'revocation');assert.equal(input.owner,status.account);assert.equal(input.networkId,CHAIN);assert.equal(input.nativeChainId,'6423');await onAcquire?.();return normal?acquireOriginalWalletTransactionPolicy(input):resource;};
 const originalWithKeys=vault.withPQKeys.bind(vault);vault.withPQKeys=(binding,action,permission)=>originalWithKeys(binding,(...args)=>{counts.sign++;return action(...args);},permission);
 const store=new FileTransactionIntentStore({filePath:path.join(directory,'journal.json')}),authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:source,pqPolicyRecognized:normal?isOriginalWalletTransactionPolicy:value=>recognized&&value===resource,pqNetworkId:CHAIN});
 return {directory,filePath,lifecycle,vault,store,authority,counts,resource,account:status.account,authorization};
}
test('revocation authority reviews complete pending schedule and signs current pair once without submitting',async t=>{
 const f=await fixture(t,{pending:true}),vaultBefore=await fs.readFile(f.filePath,'utf8'),response=await f.lifecycle.run(()=>f.authority.requestPQRevocation({}));
 assert.equal(response.request.method,'ynx_signPQRevocation');assert.equal(response.request.review.authorizingRevision,'1');assert.equal(response.request.review.throughRevision,'2');assert.equal(response.request.review.executionHeight,'30');assert.equal(response.request.review.revokeAt,'31');assert.equal(response.request.review.nonce,'9007199254740994');
 assert.equal(f.counts.sign,0);assert.equal('snapshot' in response.request,false);assert.equal('resource' in response.request,false);
 const result=await f.lifecycle.run(()=>f.authority.approve(response.request.id));assert.equal(result.status,'success');assert.equal(result.result.submitted,false);assert.equal(result.result.confirmed,false);
 const [record]=await f.store.readPQOriginals(f.account,()=>{}),decoded=decodePQRevocationRequest(Buffer.from(record.wire,'base64url'));
 assert.equal(record.kind,'pq-revocation');assert.equal(decoded.intent.throughRevision,'2');assert.equal(decoded.intent.authorizingRevision,'1');assert.equal(decoded.purpose,'ACCOUNT-REVOCATION');assert.equal(decoded.N,1);
 assert.equal(await fs.readFile(f.filePath,'utf8'),vaultBefore);assert.deepEqual(f.counts,{acquire:1,recheck:1,retire:1,join:1,close:1,sign:1});
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id)));assert.equal(f.counts.sign,1);
});
test('revocation cancel closes original resource without journal reservation or signing',async t=>{
 const f=await fixture(t),response=await f.lifecycle.run(()=>f.authority.requestPQRevocation({}));assert.throws(()=>f.authority.reject(response.request.id),error=>error.data?.code==='USER_REJECTED_REQUEST');await f.authority.shutdownPQReviews();
 assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.counts.close,1);
});
test('revocation refuses changed policy before entering protected signer or reserving',async t=>{
 const cause=Error('QA_POLICY_CHANGED'),f=await fixture(t,{onRecheck:()=>{throw cause;}}),response=await f.lifecycle.run(()=>f.authority.requestPQRevocation({}));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id)),e=>e===cause);assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.counts.close,1);
});
test('revocation lock after signature capture keeps same signed original and prevents duplicate approval',async t=>{
 const f=await fixture(t),response=await f.lifecycle.run(()=>f.authority.requestPQRevocation({})),capture=f.store.captureOriginal.bind(f.store);
 f.store.captureOriginal=(...args)=>{const result=capture(...args);f.lifecycle.lock();return result;};
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id)));const retained=f.store.localOriginal(f.account).pq;
 assert.equal(retained.kind,'pq-revocation');assert.equal(decodePQRevocationRequest(Buffer.from(retained.wire,'base64url')).intent.owner,f.account);assert.equal(f.counts.sign,1);
 await f.lifecycle.unlock({password:PASSWORD});await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id)));assert.equal(f.counts.sign,1);
 await f.lifecycle.run(()=>f.store.saveOriginal(f.account,retained.hash,()=>f.lifecycle.current().assert()));
 assert.deepEqual(await f.store.readPQOriginals(f.account,()=>{}),[retained]);assert.equal(f.counts.sign,1);
});
test('revocation input cannot supply keys, nonce, target, heights or getter values',async t=>{
 const f=await fixture(t);let accessed=false;
 for(const input of [{owner:f.account},{throughRevision:'1'},{executeAt:'30'},{to:f.account},{get amount(){accessed=true;return '1';}}])await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQRevocation(input)));
 assert.equal(accessed,false);assert.equal(f.counts.acquire,0);assert.equal(f.counts.sign,0);
});
test('actual Auth R59 normal factory feeds protected revocation review/sign/save through GET-only instrumentation',async t=>{
 const f=await fixture(t,{pending:true,normal:true}),originalHTTPS=https.request,calls=[];
 https.request=(url,options,callback)=>{
  assert.equal(url.origin,'https://rpc.ynxweb4.com');assert.equal(options.method,'GET');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);calls.push(url.pathname);
  const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{
   const response=new EventEmitter();response.destroy=()=>{};response.statusCode=200;response.headers={'content-type':'application/json','cache-control':'no-store'};
   const body=url.pathname==='/status'?{chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:'65efa82e0615',release:'ynx-network-surgical-65efa82e0615'}}:url.pathname==='/blocks/0'?{height:0,hash:CHAIN}:{...f.authorization,revocations:[],policyView:'next_execution',recordsView:'includes_pending',source:'authoritative_producer',recordsComplete:true,committedHeight:'29',committedBlockHash:'30'.padStart(64,'0'),committedAlgorithmVersion:'YNX-BATCH/v0.1',committedActiveRevision:'1',checkpointStatus:'durable',checkpointIntegrity:'a'.repeat(64),globalPolicyVersion:'YNX-ACCOUNT-POLICY/v1',authorizationStatus:'active',pqSigningEnabled:true,committedAuthorizationStatus:'active',committedPQSigningEnabled:true};
   callback(response);response.emit('data',Buffer.from(JSON.stringify(body)));response.emit('end');
  });return request;
 };syncBuiltinESMExports();
 try{
  const review=await f.lifecycle.run(()=>f.authority.requestPQRevocation({}));assert.equal(review.request.review.throughRevision,'2');
  const result=await f.lifecycle.run(()=>f.authority.approve(review.request.id));assert.equal(result.result.submitted,false);assert.equal(f.counts.sign,1);
  const [record]=await f.store.readPQOriginals(f.account,()=>{});assert.equal(decodePQRevocationRequest(Buffer.from(record.wire,'base64url')).intent.throughRevision,'2');
  assert.deepEqual(calls,Array.from({length:2},()=>['/status','/blocks/0','/accounts/'+f.account+'/authorization','/status']).flat());
 }finally{https.request=originalHTTPS;syncBuiltinESMExports();await f.authority.shutdownPQReviews();}
});
