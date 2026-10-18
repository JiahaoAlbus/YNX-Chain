import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {DesktopWalletAuthority,MemoryPermissionStore,isOriginalPQTransactionReviewBorrow} from '../src/desktop-wallet-authority.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import * as keys from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import * as backup from '@ynx-chain/wallet-auth/pq-wallet-backup';
import * as contract from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {registerHooks} from 'node:module';
import {createPUBLICPeer} from './wallet-pq-typed-auth-peer.fixture.mjs';
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='electron'?{url:new URL('./wallet-pq-typed-auth-peer.fixture.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context)}});
const realFactory=await import('../src/original-policy-supplier/transaction-permission.mjs');hooks.deregister();
const SDK=Object.freeze({...keys,...backup,...contract}),PASSWORD='synthetic-typed-authority-QA-only';
const input=JSON.parse(readFileSync(new URL('../src/features/pq-transaction/fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(row=>row.kind==='resource_delegation_create');
// These resources model Auth boundaries, NOT real IPC/Root approval. Real SDK,
// Main private borrow, encrypted synthetic vault and protected journal execute.
async function fixture(t,{permission=true,afterComplete,actualFactory=false}={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-typed-authority-')),lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const filePath=path.join(directory,'vault.json'),vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:SDK,randomSecret:()=> '1'.padStart(64,'0')});lifecycle.authorizer=vault.authorizer();
 t.after(async()=>{lifecycle.lock();await fs.rm(directory,{recursive:true,force:true});});
 await lifecycle.custody(g=>vault.setup({password:PASSWORD,confirmation:PASSWORD},g));await lifecycle.unlock({password:PASSWORD});
 const status=await lifecycle.run(()=>vault.createAccount());lifecycle.setAccount(status.account);await lifecycle.unlock({password:PASSWORD});
 const handle=await keys.createPQWalletKeyHandle({chainId:input.chainId,owner:status.account}),binding=keys.readPQWalletKeyPublic(handle);t.after(()=>keys.destroyPQWalletKeyHandle(handle));
 await lifecycle.run(()=>vault.savePQKeys({handle,publicBinding:binding,operationId:'synthetic-existing-pair'}));
 const pair=pqPublicBindingToRegistrationKeys(binding),authorization=parsePQAccountAuthorization({owner:status.account,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:pair.algorithmVersion,owner:status.account,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]},{chainId:input.chainId,nativeChainId:'6423',owner:status.account});
 const view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:input.chainId,nativeChainId:'6423',canonicalOwner:status.account,authorization,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
 const counts={source:0,sign:0,close:0,permission:0,complete:0};let retired=false,request,completion;
 const resource={assertCurrent(){if(retired)throw Error('QA_RETIRED');},readOriginal(){return view;},async recheck(){},retire(){retired=true;},async join(){},async close(){counts.close++;}};
 const source=async r=>{counts.source++;assert.equal(r.operation,'typed-action');assert.equal(r.owner,status.account);return resource;};
 const originalWithKeys=vault.withPQKeys.bind(vault);vault.withPQKeys=(binding,action,lease)=>originalWithKeys(binding,(...args)=>{counts.sign++;return action(...args);},lease);
 const capsule=Object.freeze({testOnly:true}),recognized=new WeakSet();
 const permissionSource=async(r,c,borrow)=>{
  counts.permission++;assert.equal(c,capsule);assert.equal(isOriginalPQTransactionReviewBorrow(borrow),true);assert.deepEqual(borrow.readOriginal().request,r);request=r;
  assert.deepEqual(Object.keys(r).sort(),['action','purpose','memberCount','memberIndex','networkId','nativeChainId','account','operationId','origin','typedAction','requestDigest','policyRevision','pair','reviewExecutionHeight','executionHeight','expiresAt'].sort());
  assert.equal(r.requestDigest,createHash('sha256').update(encodePQNativeAction(r.typedAction)).digest('hex'));assert.equal(r.purpose,'TX-BATCH');assert.equal(r.memberCount,1);assert.equal(r.memberIndex,0);assert.equal(Object.hasOwn(r,'transportHash'),false);
  const auth={assertCurrent(){borrow.assertCurrent();},async recheck(){await borrow.recheck();},enterSign(){borrow.enterOriginal('sign');},complete(result){counts.complete++;completion=result;borrow.completeOriginal(result);borrow.assertCompletedCurrent(result);afterComplete?.(lifecycle);},async close(){borrow.retire();await borrow.close();}};recognized.add(auth);return auth;
 };
 const store=new FileTransactionIntentStore({filePath:path.join(directory,'journal.json')}),authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:source,pqPolicyRecognized:v=>v===resource,pqNetworkId:input.chainId,...(permission?{pqTransactionPermissionSource:actualFactory?realFactory.acquireOriginalWalletTransactionPermission:permissionSource,pqTransactionPermissionRecognized:actualFactory?realFactory.isOriginalWalletTransactionPermission:v=>recognized.has(v)}:{})});
 t.after(()=>authority.shutdownPQReviews());
 return {directory,filePath,lifecycle,vault,authority,store,counts,capsule,capsuleFor:id=>realFactory.captureOriginalWalletTransactionApprovalIPC(createPUBLICPeer(new URL('../src/index.html',import.meta.url).href),id,'sign'),account:status.account,get request(){return request},get completion(){return completion},action:{kind:input.kind,fee:input.fee,payload:{...input.payload,provider:status.account}}};
}
test('typed Main normal pending review and synthetic SDK sign retain both original hashes without submission',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.filePath,'utf8'),response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));
 assert.equal(response.request.method,'ynx_signPQNativeAction');assert.equal(f.authority.isPendingPQTransactionReview(response.request.id),true);assert.equal(f.counts.sign,0);
 const result=await f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule));assert.equal(result.result.submitted,false);
 const [record]=await f.store.readPQOriginals(f.account,()=>{});assert.equal(record.kind,'pq-typed-action');assert.equal(record.hash,f.completion.transportHash);assert.equal(record.typed.memberHash,f.completion.memberHash);assert.equal(f.request.typedAction.nonce,'9007199254740994');
 assert.equal(record.typed.reviewSnapshot.executionHeight,'9007199254740993');assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(f.counts.sign,1);assert.equal(f.counts.complete,1);
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));assert.equal(f.counts.sign,1);
});
test('typed sign cannot fall back when original Auth transaction factory is missing',async t=>{
 const f=await fixture(t,{permission:false}),response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)),e=>e.data?.code==='PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED');assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);
});
test('typed lock after completion retains original member and no duplicate signature',async t=>{
 const f=await fixture(t,{afterComplete:l=>l.lock()}),response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));const held=f.store.localOriginal(f.account);
 assert.ok(held.pqMemberData.length>0);assert.equal(held.pq.hash,f.completion.transportHash);assert.equal(held.pq.typed.memberHash,f.completion.memberHash);assert.equal(f.counts.sign,1);
 await f.lifecycle.unlock({password:PASSWORD});await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));assert.equal(f.counts.sign,1);
 await f.lifecycle.run(()=>f.store.saveOriginal(f.account,held.pq.hash,()=>f.lifecycle.current().assert()));assert.equal((await f.store.readPQOriginals(f.account,()=>{}))[0].wire,held.pq.wire);
});
test('typed cancel and absent classic witness never enter keys or accept renderer authority fields',async t=>{
 const f=await fixture(t);let getter=false;
 for(const extra of [{owner:f.account},{nonce:'1'},{get networkId(){getter=true;return input.chainId}}]){
  const candidate=Object.defineProperties({...f.action},Object.getOwnPropertyDescriptors(extra));
  await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQTypedAction(candidate)));
 }
 assert.equal(getter,false);
 for(const kind of ['stake_delegate','stake_unbond','stake_withdraw'])await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQTypedAction({...f.action,kind})),e=>e.data?.code==='PQ_TYPED_CLASSIC_ORIGINALS_NOT_SUPPLIED');
 await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQTypedAction({...f.action,kind:'contract_deploy'})),e=>e.data?.code==='PQ_TYPED_DEPLOYMENT_MATERIAL_NOT_SUPPLIED');
 assert.equal(f.counts.source,0);const response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));assert.throws(()=>f.authority.reject(response.request.id));await f.authority.shutdownPQReviews();assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);
});
test('actual Auth factory and typed kernel consume actual Main private borrow and SDK sign once (PUBLIC Electron only)',async t=>{
 const f=await fixture(t,{actualFactory:true}),response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action)),capsule=f.capsuleFor(response.request.id);
 const result=await f.lifecycle.run(()=>f.authority.approve(response.request.id,capsule));assert.equal(result.result.submitted,false);assert.equal(result.result.confirmed,false);assert.equal(f.counts.sign,1);
 const [record]=await f.store.readPQOriginals(f.account,()=>{});assert.equal(record.operationId,response.request.id);assert.equal(record.typed.review.action.kind,f.action.kind);assert.equal(record.hash,result.result.hash);
 const cold=new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')});assert.deepEqual((await cold.readPQOriginals(f.account,()=>{}))[0],record);
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,capsule)));assert.equal(f.counts.sign,1);
});
test('typed review remains invalid after focus-loss lock and re-unlock, before any signer or reservation',async t=>{
 const f=await fixture(t,{actualFactory:true}),response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));
 f.lifecycle.setFocused(false);f.lifecycle.setFocused(true);await f.lifecycle.unlock({password:PASSWORD});
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsuleFor(response.request.id))));
 assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.store.localOriginal(f.account),null);
});
