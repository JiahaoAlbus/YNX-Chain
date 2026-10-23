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
import {AsyncLocalStorage} from 'node:async_hooks';
import {gunzipSync} from 'node:zlib';
import {captureWalletPQConnection} from '../src/wallet-pq-connection-contract.mjs';
import {PQ_DEPLOYMENT_MATERIAL_PINS} from '../src/features/pq-transaction/contract-deployment-material-pins.mjs';
import {runInNewContext} from 'node:vm';
import {createPQTransactionSubmission} from '../src/features/pq-transaction/submission.mjs';
import {inspectPQReviewedTypedTransportOriginal} from '../src/features/pq-transaction/typed-action-reviewed-transport.mjs';
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='electron'?{url:new URL('./wallet-pq-typed-auth-peer.fixture.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context)}});
const realFactory=await import('../src/original-policy-supplier/transaction-permission.mjs');hooks.deregister();
const SDK=Object.freeze({...keys,...backup,...contract}),PASSWORD='synthetic-typed-authority-QA-only';
const input=JSON.parse(readFileSync(new URL('../src/features/pq-transaction/fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(row=>row.kind==='resource_delegation_create');
// These resources model Auth boundaries, NOT real IPC/Root approval. Real SDK,
// Main private borrow, encrypted synthetic vault and protected journal execute.
async function fixture(t,{permission=true,afterComplete,actualFactory=false,broadcast=false,wireController=false,latePostLock=false}={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-typed-authority-')),lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const filePath=path.join(directory,'vault.json'),vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:SDK,randomSecret:()=> '1'.padStart(64,'0')});lifecycle.authorizer=vault.authorizer();
 t.after(async()=>{lifecycle.lock();await fs.rm(directory,{recursive:true,force:true});});
 await lifecycle.custody(g=>vault.setup({password:PASSWORD,confirmation:PASSWORD},g));await lifecycle.unlock({password:PASSWORD});
 const status=await lifecycle.run(()=>vault.createAccount());lifecycle.setAccount(status.account);await lifecycle.unlock({password:PASSWORD});
 const handle=await keys.createPQWalletKeyHandle({chainId:input.chainId,owner:status.account}),binding=keys.readPQWalletKeyPublic(handle);t.after(()=>keys.destroyPQWalletKeyHandle(handle));
 await lifecycle.run(()=>vault.savePQKeys({handle,publicBinding:binding,operationId:'synthetic-existing-pair'}));
 const pair=pqPublicBindingToRegistrationKeys(binding),authorization=parsePQAccountAuthorization({owner:status.account,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:pair.algorithmVersion,owner:status.account,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]},{chainId:input.chainId,nativeChainId:'6423',owner:status.account});
 const view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:input.chainId,nativeChainId:'6423',canonicalOwner:status.account,authorization,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
 const counts={source:0,sign:0,close:0,permission:0,complete:0,posts:0};let request,completion;const policyResources=new WeakSet();
 const source=async r=>{counts.source++;assert.equal(r.operation,'typed-action');assert.equal(r.owner,status.account);let retired=false;const resource={assertCurrent(){if(retired)throw Error('QA_RETIRED');},readOriginal(){return view;},async recheck(){},retire(){retired=true;},async join(){},async close(){counts.close++;}};policyResources.add(resource);return resource;};
 const originalWithKeys=vault.withPQKeys.bind(vault);vault.withPQKeys=(binding,action,lease)=>originalWithKeys(binding,(...args)=>{counts.sign++;return action(...args);},lease);
 const capsule=Object.freeze({testOnly:true}),recognized=new WeakSet();
 const permissionSource=async(r,c,borrow)=>{
  counts.permission++;assert.equal(c,capsule);assert.equal(isOriginalPQTransactionReviewBorrow(borrow),true);assert.deepEqual(borrow.readOriginal().request,r);request=r;
  assert.deepEqual(Object.keys(r).sort(),['action','purpose','memberCount','memberIndex','networkId','nativeChainId','account','operationId','origin','typedAction','requestDigest','policyRevision','pair','reviewExecutionHeight','executionHeight','expiresAt'].sort());
  assert.equal(r.requestDigest,createHash('sha256').update(encodePQNativeAction(r.typedAction)).digest('hex'));assert.equal(r.purpose,'TX-BATCH');assert.equal(r.memberCount,1);assert.equal(r.memberIndex,0);assert.equal(Object.hasOwn(r,'transportHash'),false);
  const auth={assertCurrent(){borrow.assertCurrent();},async recheck(){await borrow.recheck();},enterSign(){borrow.enterOriginal('sign');},complete(result){counts.complete++;completion=result;borrow.completeOriginal(result);borrow.assertCompletedCurrent(result);afterComplete?.(lifecycle);},async close(){borrow.retire();await borrow.close();}};recognized.add(auth);return auth;
 };
 const store=new FileTransactionIntentStore({filePath:path.join(directory,'journal.json')});let execute;
 if(wireController){
  const context=new AsyncLocalStorage(),controller=createPQTransactionSubmission({intentStore:store,networkId:input.chainId,isOriginalWalletTransactionPermission:realFactory.isOriginalWalletTransactionPermission,
   acquireOriginalWalletTransactionPermission:request=>{const selected=context.getStore();assert.equal(selected.selected,false);assert.equal(JSON.stringify(selected.request),JSON.stringify(request));selected.selected=true;return realFactory.acquireOriginalWalletTransactionPermission(request,selected.capsule,selected.borrow)},
   transport:{async submitTypedAction(review,raw,original,assertCurrent){
    assertCurrent();counts.posts++;const local=inspectPQReviewedTypedTransportOriginal(review,raw,original),progress=await new FileTransactionIntentStore({filePath:path.join(directory,'journal.json')}).readPQProgress(status.account,original.transportHash,()=>{});assert.equal(progress.status,'submission-unknown');
    const view={type:local.action.kind,status:'committed',committed:true,source:'comet-rpc',nativeTransactionHash:local.memberHash,abciTransactionHash:local.transportHash,wire:Buffer.from(local.member).toString('base64'),transport:Buffer.from(raw).toString('base64'),executionHeight:(BigInt(local.executionHeight)+1n).toString(),cometIndex:0,from:status.account,to:local.action.payload.beneficiary,amount:local.action.payload.amountYNXT,fee:local.action.fee,nonce:local.action.nonce,effects:{synthetic:true},readbackUrl:'/transactions/pq/actions/originals/'+local.memberHash,abciReadbackUrl:'/transactions/pq/actions/'+local.transportHash};
    if(latePostLock)lifecycle.setFocused(false);
    return{method:'POST',requestPath:'/transactions/pq/actions/broadcast',status:200,contentType:'application/json',cacheControl:'no-store',body:Buffer.from(JSON.stringify(view))};
   }}});
  const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf('async function executeOriginalPQBroadcast('),end=main.indexOf('\nlet nativeWallet;',start);
  execute=runInNewContext(main.slice(start,end)+';executeOriginalPQBroadcast;',{pqBroadcastApprovalContext:context,pqTransactionSubmission:controller,retireUnusedOriginalWalletTransactionApproval:realFactory.retireUnusedOriginalWalletTransactionApproval});
 }
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:source,pqPolicyRecognized:v=>policyResources.has(v),pqNetworkId:input.chainId,...(wireController?{pqBroadcastSource:execute}:broadcast?{pqBroadcastSource:async()=>{throw Error('QA_SENDER_MUST_NOT_ENTER_WITHOUT_APPROVAL')}}:{}),...(permission?{pqTransactionPermissionSource:actualFactory?realFactory.acquireOriginalWalletTransactionPermission:permissionSource,pqTransactionPermissionRecognized:actualFactory?realFactory.isOriginalWalletTransactionPermission:v=>recognized.has(v)}:{})});
 t.after(()=>authority.shutdownPQReviews());
 return {directory,filePath,lifecycle,vault,authority,store,counts,capsule,capsuleFor:(id,action='sign')=>realFactory.captureOriginalWalletTransactionApprovalIPC(createPUBLICPeer(new URL('../src/index.html',import.meta.url).href),id,action),account:status.account,get request(){return request},get completion(){return completion},action:{kind:input.kind,fee:input.fee,payload:{...input.payload,provider:status.account}}};
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
function goDeploymentFixture(){
 const generations=JSON.parse(gunzipSync(readFileSync(new URL('../src/features/pq-transaction/fixtures/deployment-material-generations.json.gz',import.meta.url)),{maxOutputLength:1<<20})),pin=PQ_DEPLOYMENT_MATERIAL_PINS[0],row=generations.rows[2].contracts.find(c=>c.name===pin.name),files=row.files;
 return {source:Buffer.from(files['request-source.txt'].base64,'base64').toString('utf8'),payload:{name:pin.name,sourceHash:pin.sourceHash,deployedBytecodeHash:pin.deployedBytecodeHash,compilerConfigHash:pin.compilerConfigHash,constructorArgs:['7'],value:'0'},files:[{role:'artifactFile',bytes:files['artifact.json'].base64},{role:'buildInfoFile',bytes:files['build-info.json'].base64}]};
}
test('Main deployment review captures compiler materials before custody and retains complete signed original',async t=>{
 const f=await fixture(t),publicData=goDeploymentFixture();
 const material=Object.fromEntries(publicData.files.filter(x=>x.role!=='source').map(x=>[x.role,Buffer.from(x.bytes,'base64')]));
 const action={kind:'contract_deploy',fee:'10',payload:publicData.payload,deployment:{source:publicData.source,material}};
 const response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(action));
 assert.equal(f.counts.sign,0);assert.equal(response.request.review.deployment.compilerMaterialValidationRequired,true);
 const expected=createHash('sha256').update(material.artifactFile).digest('hex');assert.equal(response.request.review.deployment.artifactFile.sha256,expected);
 material.artifactFile.fill(0);
 await f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule));
 const [record]=await new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')}).readPQOriginals(f.account,()=>{});
 const network={chainId:input.chainId,nativeChainId:'6423',owner:f.account};
 const read=inspectPQReviewedTypedTransportOriginal(record.typed.review,Buffer.from(record.wire,'base64url'),{reviewSnapshot:parsePQAccountAuthorization(record.typed.reviewSnapshot,network),signingSnapshot:parsePQAccountAuthorization(record.typed.signingSnapshot,network),selectedBinding:{account:f.account,networkId:input.chainId},memberHash:record.typed.memberHash,transportHash:record.hash});
 assert.equal(createHash('sha256').update(read.material.artifactFile).digest('hex'),expected);assert.equal(read.source,publicData.source);assert.equal(f.counts.sign,1);assert.equal(f.counts.posts,0);
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));assert.equal(f.counts.sign,1);
});
test('deployment material capacity and focus-loss refuse before synthetic signing or reservation',async t=>{
 const f=await fixture(t),data=goDeploymentFixture();
 const material=Object.fromEntries(data.files.filter(x=>x.role!=='source').map(x=>[x.role,Buffer.from(x.bytes,'base64')]));
 const action={kind:'contract_deploy',fee:'10',payload:data.payload,deployment:{source:data.source,material}};
 await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQTypedAction({...action,deployment:{source:data.source,material:{...material,buildInfoFile:Buffer.alloc(200000,65)}}})),e=>e.data?.code==='PQ_TYPED_ORIGINAL_CAPACITY');
 assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);
 const response=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(action));f.lifecycle.setFocused(false);f.lifecycle.setFocused(true);
 await f.lifecycle.unlock({password:PASSWORD});
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));
 assert.equal(f.counts.sign,0);assert.equal(f.counts.posts,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);
});
function connectedDeployment(f){
 const data=goDeploymentFixture();
 return {version:1,account:f.account,action:{kind:'contract_deploy',fee:'10',payload:data.payload,deployment:{source:data.source,material:Object.fromEntries(data.files.filter(x=>x.role!=='source').map(x=>[x.role,x.bytes]))}}};
}
test('connected contract pending requires explicit Wallet approval; cold original query is origin scoped and UNKNOWN read only',async t=>{
 const f=await fixture(t,{broadcast:true}),origin='https://ide.example';let live=true;
 await f.lifecycle.run(()=>f.authority.approveOrigin(origin,f.account));
 const connect=(requestKey,from=origin)=>captureWalletPQConnection({origin:from,account:f.account,sessionBinding:'PUBLIC approved original namespace',requestKey,assertCurrent(){if(!live)throw Error('SESSION_ENDED')}});
 const connection=connect('same-original-request'),input={origin,method:'ynx_preparePQContractAction',params:[connectedDeployment(f)]};
 await assert.rejects(f.lifecycle.run(()=>f.authority.request(input)),e=>e.data?.code==='PQ_CONNECTION_SOURCE_REQUIRED');
 const response=await f.lifecycle.run(()=>f.authority.request(input,connection));assert.equal(response.request.origin,origin);assert.equal(response.request.review.initiatorOrigin,origin);assert.equal(f.counts.sign,0);
 const signed=await f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule));assert.equal(f.counts.sign,1);assert.equal(signed.result.operationId,response.request.id);assert.match(signed.result.memberHash,/^0x[a-f0-9]{64}$/);assert.equal(signed.result.hash,signed.result.transportHash);
 const [saved]=await new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')}).readPQOriginals(f.account,()=>{});assert.equal(saved.version,3);assert.equal(saved.typed.initiator.origin,origin);
 await assert.rejects(f.lifecycle.run(()=>f.authority.request(input,connection)),e=>e.data?.code==='PQ_CONNECTION_ORIGINAL_RECONCILE_REQUIRED');
 await f.store.beginPQSubmission(f.account,saved.hash,()=>{}); // Fault boundary only: no POST is performed.
 const query={origin,method:'ynx_getPQContractOriginal',params:[{version:1,account:f.account,operationId:saved.operationId,refresh:false}]};
 const result=await f.lifecycle.run(()=>f.authority.request(query,connect('new-read-request')));
 assert.equal(result.result.status,'submission-unknown');assert.equal(result.result.queryOnly,true);assert.equal(result.result.canRetry,false);assert.equal(result.result.transportHash,saved.hash);assert.equal(result.result.memberHash,saved.typed.memberHash);assert.equal(Object.hasOwn(result.result,'wire'),false);
 const recovery=await f.lifecycle.run(()=>f.authority.request({...query,params:[{version:1,account:f.account,originalRequestKeyHash:saved.typed.initiator.requestKeyHash,refresh:false}]},connect('reopen-after-lost-response')));
 assert.equal(recovery.result.operationId,saved.operationId);assert.equal(recovery.result.status,'submission-unknown');
 f.authority.transactionSender.submissions.checkPQ=async()=>{throw Error('PUBLIC_OFFLINE')};
 await assert.rejects(f.lifecycle.run(()=>f.authority.request({...query,params:[{...query.params[0],refresh:true}]},connect('offline-read-request'))),/PUBLIC_OFFLINE/);
 assert.equal((await f.store.readPQProgress(f.account,saved.hash,()=>{})).status,'submission-unknown');
 const other='https://other.example';await f.lifecycle.run(()=>f.authority.approveOrigin(other,f.account));
 await assert.rejects(f.lifecycle.run(()=>f.authority.request({...query,origin:other},connect('other-read-request',other))),e=>e.data?.code==='PQ_CONNECTION_ORIGINAL_REQUIRED');
 await assert.rejects(f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractBroadcast',params:[{version:1,account:f.account,operationId:saved.operationId}]},connect('new-broadcast-request'))),e=>e.data?.code==='PQ_TRANSACTION_ALREADY_ENTERED');
 assert.equal(f.counts.sign,1);assert.equal(f.counts.posts,0);
});
test('connected contract disconnect and account permission revocation invalidate pending before key entry',async t=>{
 for(const cause of ['disconnect','revoke']){
  const f=await fixture(t),origin='https://ide.example';let live=true;
  await f.lifecycle.run(()=>f.authority.approveOrigin(origin,f.account));
  const connection=captureWalletPQConnection({origin,account:f.account,sessionBinding:'PUBLIC original namespace',requestKey:cause,assertCurrent(){if(!live)throw Error('SESSION_ENDED')}});
  const response=await f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractAction',params:[connectedDeployment(f)]},connection));
  if(cause==='disconnect')live=false;else await f.authority.revokeOrigin(origin);
  await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));
  assert.equal(f.counts.sign,0);assert.equal(f.counts.posts,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);
 }
});
test('connected contract call uses a separate original broadcast review and cancellation never posts',async t=>{
 const f=await fixture(t,{actualFactory:true,broadcast:true}),origin='https://ide.example';
 await f.lifecycle.run(()=>f.authority.approveOrigin(origin,f.account));
 const connect=key=>captureWalletPQConnection({origin,account:f.account,sessionBinding:'PUBLIC exact contract-call session',requestKey:key,assertCurrent(){}});
 const action=JSON.parse(readFileSync(new URL('../src/features/pq-transaction/fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(x=>x.kind==='contract_execute');
 const sign=await f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractAction',params:[{version:1,account:f.account,action:{kind:action.kind,fee:action.fee,payload:action.payload}}]},connect('original-call')));
 const signed=await f.lifecycle.run(()=>f.authority.approve(sign.request.id,f.capsuleFor(sign.request.id)));
 const broadcast=await f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractBroadcast',params:[{version:1,account:f.account,operationId:signed.result.operationId}]},connect('original-call-broadcast')));
 assert.notEqual(broadcast.request.id,sign.request.id);assert.equal(broadcast.request.origin,origin);assert.equal(broadcast.request.method,'ynx_broadcastPQNativeAction');assert.equal(broadcast.request.review.hash,signed.result.transportHash);
 assert.throws(()=>f.authority.reject(broadcast.request.id));assert.equal(f.counts.sign,1);assert.equal(f.counts.posts,0);
});
test('qualified deployment reaches distinct original broadcast review, while unknown materials refuse before keys',async t=>{
 const f=await fixture(t,{actualFactory:true,broadcast:true}),origin='https://ide.example';
 await f.lifecycle.run(()=>f.authority.approveOrigin(origin,f.account));
 const connect=key=>captureWalletPQConnection({origin,account:f.account,sessionBinding:'PUBLIC exact deployment session',requestKey:key,assertCurrent(){}});
 const changed=connectedDeployment(f);changed.action.deployment.material.buildInfoFile=Buffer.from('{}').toString('base64');
 await assert.rejects(f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractAction',params:[changed]},connect('wrong-compiler'))),e=>e.code==='PQ_TYPED_CONTRACT_MATERIAL_UNAVAILABLE');
 assert.equal(f.counts.sign,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);
 const pending=await f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractAction',params:[connectedDeployment(f)]},connect('qualified-deploy')));
 const signed=await f.lifecycle.run(()=>f.authority.approve(pending.request.id,f.capsuleFor(pending.request.id)));
 const broadcast=await f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractBroadcast',params:[{version:1,account:f.account,operationId:signed.result.operationId}]},connect('qualified-deploy-broadcast')));
 assert.equal(broadcast.request.method,'ynx_broadcastPQNativeAction');assert.equal(broadcast.request.review.typedAction.kind,'contract_deploy');assert.notEqual(broadcast.request.id,pending.request.id);assert.equal(broadcast.request.review.hash,signed.result.transportHash);
 assert.throws(()=>f.authority.reject(broadcast.request.id));assert.equal(f.counts.sign,1);assert.equal(f.counts.posts,0);
});
test('connection ending after synthetic sign preserves the v3 original and never repeats the signature',async t=>{
 let live=true;const f=await fixture(t,{afterComplete:()=>{live=false}}),origin='https://ide.example';
 await f.lifecycle.run(()=>f.authority.approveOrigin(origin,f.account));
 const token=captureWalletPQConnection({origin,account:f.account,sessionBinding:'PUBLIC exact original session',requestKey:'late-disconnect',assertCurrent(){if(!live)throw Error('PUBLIC_LATE_DISCONNECT')}});
 const response=await f.lifecycle.run(()=>f.authority.request({origin,method:'ynx_preparePQContractAction',params:[connectedDeployment(f)]},token));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)),/PUBLIC_LATE_DISCONNECT/);
 const held=f.store.localOriginal(f.account);assert.equal(held.pq.version,3);assert.equal(held.pq.typed.initiator.origin,origin);assert.ok(held.pqMemberData.length>0);assert.equal(f.counts.sign,1);
 await f.lifecycle.run(()=>f.store.saveOriginal(f.account,held.pq.hash,()=>f.lifecycle.current().assert()));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id,f.capsule)));assert.equal(f.counts.sign,1);assert.equal(f.counts.posts,0);
 assert.equal((await new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')}).readPQOriginals(f.account,()=>{}))[0].hash,held.pq.hash);
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
test('normal original broadcast review creates a distinct pending capsule identity and cancellation never signs or sends',async t=>{
 const f=await fixture(t,{actualFactory:true,broadcast:true}),sign=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));await f.lifecycle.run(()=>f.authority.approve(sign.request.id,f.capsuleFor(sign.request.id)));
 const [record]=await f.store.readPQOriginals(f.account,()=>{}),before=await fs.readFile(path.join(f.directory,'journal.json'),'utf8'),review=await f.lifecycle.run(()=>f.authority.requestPQBroadcast(record.hash));
 assert.equal(review.request.method,'ynx_broadcastPQNativeAction');assert.notEqual(review.request.id,sign.request.id);assert.equal(f.authority.isPendingPQBroadcastReview(review.request.id),true);assert.equal(f.authority.isPendingPQTransactionReview(review.request.id),false);
 assert.equal(review.request.review.operationId,record.operationId);assert.equal(review.request.review.hash,record.hash);assert.equal(review.request.review.memberHash,record.typed.memberHash);assert.deepEqual(review.request.review.typedAction,record.typed.review.action);assert.equal(Object.hasOwn(review.request.review,'wire'),false);assert.equal(f.counts.sign,1);
 assert.throws(()=>f.authority.reject(review.request.id));await f.authority.shutdownPQReviews();assert.equal(f.counts.close,2);assert.equal(f.counts.sign,1);assert.equal(await fs.readFile(path.join(f.directory,'journal.json'),'utf8'),before);
});
test('normal typed broadcast review refuses an existing uncertain submission before opening another policy or signer',async t=>{
 const f=await fixture(t,{actualFactory:true,broadcast:true}),sign=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));await f.lifecycle.run(()=>f.authority.approve(sign.request.id,f.capsuleFor(sign.request.id)));
 const [record]=await f.store.readPQOriginals(f.account,()=>{});await f.store.beginPQSubmission(f.account,record.hash,()=>{});
 await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQBroadcast(record.hash)),e=>e.data?.code==='PQ_TRANSACTION_ALREADY_ENTERED');assert.equal(f.counts.source,1);assert.equal(f.counts.sign,1);
});
test('actual Main pending/private borrow/normal ALS/real Auth factory/sole controller retain one typed result (PUBLIC Electron and transport)',async t=>{
 const f=await fixture(t,{actualFactory:true,wireController:true}),sign=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));await f.lifecycle.run(()=>f.authority.approve(sign.request.id,f.capsuleFor(sign.request.id)));
 const [record]=await f.store.readPQOriginals(f.account,()=>{}),broadcast=await f.lifecycle.run(()=>f.authority.requestPQBroadcast(record.hash));
 const result=await f.lifecycle.run(()=>f.authority.approve(broadcast.request.id,f.capsuleFor(broadcast.request.id,'broadcast')));assert.equal(result.result.status,'inclusion-observed');assert.equal(result.result.consensusFinality,false);assert.equal(f.counts.posts,1);assert.equal(f.counts.sign,1);
 const cold=new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')});assert.equal((await cold.readPQProgress(f.account,record.hash,()=>{})).status,'inclusion-observed');assert.deepEqual((await cold.readPQOriginals(f.account,()=>{}))[0],record);
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(broadcast.request.id,f.capsuleFor(broadcast.request.id,'broadcast'))));assert.equal(f.counts.posts,1);
});
test('actual Main composed typed broadcast saves complete result across focus-loss lock and never signs/posts again',async t=>{
 const f=await fixture(t,{actualFactory:true,wireController:true,latePostLock:true}),sign=await f.lifecycle.run(()=>f.authority.requestPQTypedAction(f.action));await f.lifecycle.run(()=>f.authority.approve(sign.request.id,f.capsuleFor(sign.request.id)));
 const [record]=await f.store.readPQOriginals(f.account,()=>{}),broadcast=await f.lifecycle.run(()=>f.authority.requestPQBroadcast(record.hash));await assert.rejects(f.lifecycle.run(()=>f.authority.approve(broadcast.request.id,f.capsuleFor(broadcast.request.id,'broadcast'))));
 const cold=new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')});assert.equal((await cold.readPQProgress(f.account,record.hash,()=>{})).status,'inclusion-observed');assert.equal(f.lifecycle.status().locked,true);assert.equal(f.counts.posts,1);assert.equal(f.counts.sign,1);
 f.lifecycle.setFocused(true);await f.lifecycle.unlock({password:PASSWORD});await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQBroadcast(record.hash)));assert.equal(f.counts.posts,1);assert.equal(f.counts.sign,1);
});
