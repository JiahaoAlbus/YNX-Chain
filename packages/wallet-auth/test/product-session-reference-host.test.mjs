import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {p256} from '@noble/curves/nist.js';
import {canonicalJSON,WalletAuthError} from '../src/canonical.js';
import {RecoverableProductSessionClient} from '../src/product-session-recovery.js';
import {createProductSessionReferenceReturnURL} from '../src/product-session-router.js';
import {createProductWalletConnection,createProductWalletReturnPublisher} from '../src/product-wallet-connection.js';
import {productPlatformBinding} from '../src/product-session-registry.js';
import {ynxAddressFromEVM} from '../src/crypto.js';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {ProductSessionGatewayFetchAdapter} from '../src/product-session-gateway-client.js';
import {createProductSessionRequest,signProductSessionChallenge,productSessionApprovalDigest} from '../src/product-session-v2.js';
import {createPQWalletKeyHandle,destroyPQWalletKeyHandle,readPQWalletKeyPublic,signPQWalletProductSessionApproval} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {captureProductSessionAccountPolicy} from '../src/product-session-account-policy.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval,verifyPQProductSessionPublicationApproval} from '../src/product-session-pq-approval.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
const base='/v2/product-sessions/returns';
// Actual original Host filesystem and HTTP adapter; policy provider/HTTPS
// binding are explicit QA standins, never real Source or Native admission.
async function fixture(){
 const network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network),dir=mkdtempSync(join(tmpdir(),'ynx-return-host-')),device=Buffer.alloc(32,7);
 const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));let now=new Date('2026-10-18T00:00:00.000Z'),serial=0,postFailure=false,missing=false,changed=false,host,server,url,operations=[];
 const accounts=new Map([[account,{handle,keys,owner:network.owner}]]);
 function context(request=null,approval=null,write=false,subject=account){
  const selected=accounts.get(approval?.account??subject);if(!selected)throw Error('QA account resource not supplied');
  let retired=false;const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:selected.owner,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:changed?'2':'1',registeredAt:'10',activeFrom:'20',pkA:selected.keys.pkA,pkB:selected.keys.pkB},observedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30000).toISOString()};
  const resource={readOriginal:()=>view,assertCurrent(){if(retired)throw Error('QA retired');},async recheck(){this.assertCurrent();},retire(){retired=true;},async join(){},async close(){}};
  const observation=captureProductSessionAccountPolicy(resource,{networkId:network.chainId,account:approval?.account??subject},now),verifiedApproval=write?verifyPQProductSessionApproval(registry,request,approval,observation,now).verifiedApproval:null;
  return {value:{observation,verifiedApproval,required:true},retire:()=>resource.retire()};
 }
 const request=createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Explicit reference recovery',nonce:'b'.repeat(43),state:'c'.repeat(43),finiteServiceSeconds:7200},now);
 const signing=context();const approval=signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt,approvedServiceConsent:request.serviceConsent},signing.value.observation,now),now);signing.retire();
 const options={statePath:join(dir,'state.json'),now:()=>now,tokenFactory:()=>String(++serial).padStart(43,'t'),accountPolicy:{mode:'required',async run(operation,execute){
  const ref=operation.path.startsWith(base);
  assert.equal(Object.keys(operation).sort().join('|'),['requestId','method','path','body','proofHeader','walletControlProofHeader','session','at',...(ref?['publication']:[])].sort().join('|'));
  operations.push(operation);if(missing)throw Error('QA Source missing');const body=JSON.parse(operation.body),publication=operation.publication;
  const write=operation.path===base||operation.path===base+'/complete'&&!publication.completed;
  if(operation.path===base){assert.equal(publication,null);assert.equal(operation.session,null);}else if(ref&&publication){assert.equal(publication.requestRaw,canonicalJSON(body.request));assert.equal(Object.isFrozen(publication),true);assert.equal(!!operation.session,publication.completed);}
  const ctx=context(write?(publication?JSON.parse(publication.requestRaw):body.request):null,write?(publication?JSON.parse(publication.approvalRaw):body.approval):null,write,operation.session?.account??(publication?JSON.parse(publication.approvalRaw).account:account));
  try{if(body.selector==='YNX-PRODUCT-SESSION-PUBLICATION/v1')verifyPQProductSessionPublicationApproval(registry,body.request,body.approval,ctx.value.observation,now);assert.equal(execute(ctx.value),undefined);if(postFailure)throw Error('QA Source post-effect UNKNOWN');}finally{ctx.retire();}
 }}};
 async function stop(){if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}}
 async function start(){host=new ProductSessionGatewayNodeHost(registry,options);server=createServer(host.handler());await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;}
 await start();
 let loseComplete=false,loseBeforeComplete=false,deviceSigns=0,signUnknown=false,completeCalls=0;
 const caller=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:async(target,init)=>{const path=new URL(target).pathname;if(path===base+'/complete'){completeCalls++;if(loseBeforeComplete){loseBeforeComplete=false;throw new WalletAuthError('NETWORK_UNAVAILABLE','QA unknown complete transport');}}const response=await fetch(url+path,init);if(path===base+'/complete'&&loseComplete){loseComplete=false;await response.text();throw new WalletAuthError('NETWORK_UNAVAILABLE','QA lost completion response');}return response;},walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:2000});
 const values=new Map();let deviceToken=0;
 const clientConfig={registry,productId:'finance',platform:'web',finiteServiceSeconds:7200,storage:{securityLevel:'webcrypto-nonextractable',get:async k=>values.get(k)??null,set:async(k,v)=>{values.set(k,v);},remove:async k=>values.delete(k)},gateway:caller,device:{id:'a'.repeat(43),key:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:request.scopes,purpose:'Explicit reference recovery',async sign(v){if(v.purpose==='challenge'){deviceSigns++;if(signUnknown)throw Error('QA device signing UNKNOWN');}return Buffer.from(p256.sign(Buffer.from(v.payload,'base64url'),device,{format:'der'})).toString('base64url');}},tokenFactory:()=>String(++deviceToken).padStart(43,'k'),clock:()=>now};
 return {request,approval,caller,operations,device,context,clientConfig,values,get completeCalls(){return completeCalls;},get deviceSigns(){return deviceSigns;},loseComplete(){loseComplete=true;},loseBeforeComplete(){loseBeforeComplete=true;},signUnknown(){signUnknown=true;},approve(r){const ctx=context();try{return signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,r,{account,expiresAt:r.expiresAt,...(r.serviceConsent?{approvedServiceConsent:r.serviceConsent}:{})},ctx.value.observation,now),now);}finally{ctx.retire();}},async approveOther(r){const other={chainId:network.chainId,owner:'0x'+'55'.repeat(20)},subject=ynxAddressFromEVM(other.owner);if(!accounts.has(subject)){const key=await createPQWalletKeyHandle(other);accounts.set(subject,{handle:key,keys:pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(key)),owner:other.owner});}const selected=accounts.get(subject),ctx=context(null,null,false,subject);try{return signPQWalletProductSessionApproval(selected.handle,preparePQProductSessionApproval(registry,r,{account:subject,expiresAt:r.expiresAt,...(r.serviceConsent?{approvedServiceConsent:r.serviceConsent}:{})},ctx.value.observation,now),now);}finally{ctx.retire();}},get httpURL(){return url;},get host(){return host;},get now(){return now;},setMissing(){missing=true;},setChanged(){changed=true;},failure(v){postFailure=v;},advance(){now=new Date('2026-10-18T00:06:00.000Z');},async cold(){await stop();await start();},async close(){await stop();for(const item of accounts.values())destroyPQWalletKeyHandle(item.handle);rmSync(dir,{recursive:true,force:true});}};
}
test('actual HTTP caller persists full PQ publication, cold-completes once and reads original finite session after approval expiry',async()=>{
 const f=await fixture();try{
  const published=await f.caller.publishReturn({requestId:'req_reference_publish_001',request:f.request,approval:f.approval});assert.match(published.reference,/^ynxpsr1_[A-Za-z0-9_-]{43}$/);assert(JSON.stringify(published).length<4096);
  const rows=f.host.snapshot().returnPublications.records;assert.equal(rows.length,1);assert.equal(rows[0].approvalRaw,canonicalJSON(f.approval));assert(rows[0].approvalRaw.length>65536);
  await f.cold();const same=await f.caller.publishReturn({requestId:'req_reference_publish_001',request:f.request,approval:f.approval});assert.deepEqual(same,published);assert.equal(f.host.snapshot().authority.issuedChallenges.length,1);
  const read=await f.caller.returnChallenge({requestId:'req_reference_read_00001',reference:published.reference,request:f.request}),completion=signProductSessionChallenge(read.challenge,f.device.toString('base64url'));
  const input={reference:published.reference,request:f.request,completion};const pending=await f.caller.returnOutcome({requestId:'req_reference_outcome_01',...input});assert.deepEqual(pending,{state:'pending',retryAuthorized:false});assert.equal(f.host.snapshot().authority.consumedNonces.length,0);
  const session=await f.caller.completeReturn({requestId:'req_reference_complete_1',...input});assert.equal(session.version,'3');assert.equal(f.host.snapshot().authority.consumedNonces.length,1);
  f.advance();await f.cold();const recovered=await f.caller.returnOutcome({requestId:'req_reference_outcome_02',...input});assert.equal(recovered.state,'completed');assert.equal(recovered.retryAuthorized,false);assert.deepEqual(recovered.session,session);assert.equal(recovered.session.expiresAt,'2026-10-18T02:00:00.000Z');
  assert.equal(f.host.snapshot().authority.sessions.length,1);assert.equal(f.host.snapshot().authority.consumedNonces.length,1);assert.equal(f.operations.at(-1).publication.completed,true);
  f.setChanged();await assert.rejects(()=>f.caller.returnOutcome({requestId:'req_reference_outcome_03',...input}));assert.equal(f.host.snapshot().authority.sessions.length,1);
 }finally{await f.close();}
});
test('publish/completion post-effect UNKNOWN retains exact row and cold outcome never consumes again',async()=>{
 const f=await fixture();try{
  f.failure(true);await assert.rejects(()=>f.caller.publishReturn({requestId:'req_reference_unknown_01',request:f.request,approval:f.approval}));
  const meta=f.host.readOriginalProductSessionReturnOutcome('req_reference_unknown_01');assert.equal(meta.state,'pending');assert.equal(meta.retryAuthorized,false);const raw=canonicalJSON(f.host.snapshot().returnPublications);f.failure(false);await f.cold();assert.equal(canonicalJSON(f.host.snapshot().returnPublications),raw);
  const {challenge}=await f.caller.returnChallenge({requestId:'req_reference_unknown_02',reference:meta.reference,request:f.request}),completion=signProductSessionChallenge(challenge,f.device.toString('base64url')),input={reference:meta.reference,request:f.request,completion};
  f.failure(true);await assert.rejects(()=>f.caller.completeReturn({requestId:'req_reference_unknown_03',...input}));assert.equal(f.host.snapshot().authority.sessions.length,1);f.failure(false);f.advance();await f.cold();const outcome=await f.caller.returnOutcome({requestId:'req_reference_unknown_04',...input});assert.equal(outcome.state,'completed');assert.equal(f.host.snapshot().authority.consumedNonces.length,1);
  assert.deepEqual(f.host.readOriginalProductSessionReturnOutcome('req_reference_absent_001'),{state:'not_found',retryAuthorized:false});
 }finally{await f.close();}
});
test('reference binding/device/expiry/missing Source fail closed with full original retained',async()=>{
 const f=await fixture();try{
  const {reference}=await f.caller.publishReturn({requestId:'req_reference_denials_01',request:f.request,approval:f.approval}),raw=canonicalJSON(f.host.snapshot().returnPublications);
  await assert.rejects(()=>f.caller.returnChallenge({requestId:'req_reference_denials_02',reference,request:{...f.request,state:'x'.repeat(43)}}));
  const {challenge}=await f.caller.returnChallenge({requestId:'req_reference_denials_03',reference,request:f.request}),completion={challenge,deviceSignature:'a'.repeat(96)};
  await assert.rejects(()=>f.caller.completeReturn({requestId:'req_reference_denials_04',reference,request:f.request,completion}));assert.equal(f.host.snapshot().authority.sessions.length,0);assert.equal(canonicalJSON(f.host.snapshot().returnPublications),raw);
  f.advance();await assert.rejects(()=>f.caller.returnChallenge({requestId:'req_reference_denials_05',reference,request:f.request}));assert.equal(f.host.snapshot().authority.consumedNonces.length,0);
  f.setMissing();await assert.rejects(()=>f.caller.returnOutcome({requestId:'req_reference_denials_06',reference,request:f.request,completion}));assert.equal(canonicalJSON(f.host.snapshot().returnPublications),raw);
 }finally{await f.close();}
});
test('reference client uses real HTTP callee and cold-recovers lost complete ACK without a second signature or submission',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig),pending=await client.beginExplicit(),approval=f.approve(pending.request),publication=await f.caller.publishReturn({requestId:'req_reference_client_001',request:pending.request,approval}),url=createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now);
  assert(url.length<4096);assert(!url.includes('approval='));f.loseComplete();assert.notEqual((await client.handleReturn(url)).status,'connected');assert.equal(f.completeCalls,1);assert.equal(f.deviceSigns,1);
  const key=client.storageKey+':completion',raw=f.values.get(key);assert(raw.length<16384);assert.equal(JSON.parse(raw).version,'YNX-PRODUCT-SESSION-RETURN-REFERENCE/v1');assert.equal(f.host.snapshot().authority.sessions.length,1);
  f.advance();await f.cold();const cold=new RecoverableProductSessionClient(f.clientConfig),result=await cold.restore();assert.equal(result.status,'connected');assert.equal(result.session.expiresAt,'2026-10-18T02:00:00.000Z');assert.equal(f.completeCalls,1);assert.equal(f.deviceSigns,1);assert.equal(f.values.has(key),false);
 }finally{await f.close();}
});
test('reference client persists signing UNKNOWN marker and never re-signs across cold retry',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig),pending=await client.beginExplicit(),publication=await f.caller.publishReturn({requestId:'req_reference_client_002',request:pending.request,approval:f.approve(pending.request)}),url=createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now);
  f.signUnknown();assert.equal((await client.handleReturn(url)).status,'retry-required');assert.equal(f.deviceSigns,1);assert.equal(f.completeCalls,0);const key=client.storageKey+':completion',raw=f.values.get(key);assert.equal(JSON.parse(raw).completion.deviceSignature,null);
  const cold=new RecoverableProductSessionClient(f.clientConfig);assert.equal((await cold.restore()).status,'retry-required');assert.equal(f.values.get(key),raw);assert.equal(f.deviceSigns,1);assert.equal(f.completeCalls,0);
 }finally{await f.close();}
});
test('reference client retry retains pending outcome without a callback and never authorizes a second complete',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig),pending=await client.beginExplicit(),publication=await f.caller.publishReturn({requestId:'req_reference_client_003',request:pending.request,approval:f.approve(pending.request)}),url=createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now);
  f.loseBeforeComplete();await client.handleReturn(url);const key=client.storageKey+':completion',raw=f.values.get(key),requestRaw=f.values.get(client.storageKey+':pending');assert.equal(f.completeCalls,1);assert.equal(f.deviceSigns,1);assert.equal(f.host.snapshot().authority.sessions.length,0);
  f.values.delete(client.storageKey+':return');const cold=new RecoverableProductSessionClient(f.clientConfig);assert.equal((await cold.retry({walletInstalled:false,schemeRegistered:false})).status,'retry-required');assert.equal(f.values.get(key),raw);assert.equal(f.values.get(client.storageKey+':pending'),requestRaw);assert.equal(f.completeCalls,1);assert.equal(f.deviceSigns,1);assert.equal(f.host.snapshot().authority.consumedNonces.length,0);
 }finally{await f.close();}
});
test('new account selection cannot erase an UNKNOWN signed original across cold begin',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig),pending=await client.beginExplicit(),publication=await f.caller.publishReturn({requestId:'req_reference_replace_01',request:pending.request,approval:f.approve(pending.request)}),url=createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now);
  f.loseComplete();await client.handleReturn(url);
  const before=new Map(f.values),cold=new RecoverableProductSessionClient(f.clientConfig),result=await cold.beginExplicit();
  assert.equal(result.status,'retry-required');assert.equal(result.outcomeUnknown,true);assert.deepEqual(f.values,before);assert.equal(f.completeCalls,1);assert.equal(f.deviceSigns,1);assert.equal(f.host.snapshot().authority.sessions.length,1);
 }finally{await f.close();}
});
test('new account selection retains a signing UNKNOWN marker rather than replacing its request',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig),pending=await client.beginExplicit(),publication=await f.caller.publishReturn({requestId:'req_reference_replace_02',request:pending.request,approval:f.approve(pending.request)}),url=createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now);
  f.signUnknown();await client.handleReturn(url);const before=new Map(f.values);assert.equal((await client.beginExplicit()).status,'retry-required');assert.deepEqual(f.values,before);assert.equal(f.deviceSigns,1);assert.equal(f.completeCalls,0);
 }finally{await f.close();}
});
test('lost-ACK completed reference can resolve exact expired target for sign-out without reconnecting or replay',async()=>{
 const f=await fixture();try{
  const config={...f.clientConfig,finiteServiceSeconds:300},client=new RecoverableProductSessionClient(config),pending=await client.beginExplicit(),publication=await f.caller.publishReturn({requestId:'req_reference_expired_01',request:pending.request,approval:f.approve(pending.request)}),url=createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now);
  f.loseComplete();await client.handleReturn(url);const key=client.storageKey+':completion',raw=f.values.get(key);assert.equal(f.host.snapshot().authority.sessions[0].expiresAt,'2026-10-18T00:05:00.000Z');
  f.advance();await f.cold();const cold=new RecoverableProductSessionClient(config);assert.notEqual((await cold.restore()).status,'connected');assert.equal(f.values.get(key),raw);
  const result=await cold.disconnect();assert.equal(result.status,'expired');assert.equal(result.revocationConfirmed,false);assert.equal(result.sessionBinding,f.host.snapshot().authority.sessions[0].sessionBinding);assert.equal(f.completeCalls,1);assert.equal(f.deviceSigns,1);assert.equal(f.host.snapshot().authority.consumedNonces.length,1);assert.equal(f.values.has(key),false);
  assert.equal((await cold.beginExplicit()).status,'connecting');
 }finally{await f.close();}
});
test('confirmed PQ account selection changes owner through real reference HTTP and cold restore keeps only the selected session',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig);
  const first=await client.beginExplicit(),one=await f.caller.publishReturn({requestId:'req_reference_accounts_1',request:first.request,approval:f.approve(first.request)}),a=await client.handleReturn(createProductSessionReferenceReturnURL(registry,first.request,one,f.now));assert.equal(a.status,'connected');
  const second=await client.beginExplicit();assert.equal(second.status,'connecting');const approval=await f.approveOther(second.request);assert.notEqual(approval.account,a.session.account);
  const two=await f.caller.publishReturn({requestId:'req_reference_accounts_2',request:second.request,approval}),b=await client.handleReturn(createProductSessionReferenceReturnURL(registry,second.request,two,f.now));assert.equal(b.status,'connected');assert.equal(b.session.account,approval.account);assert.notEqual(b.session.sessionBinding,a.session.sessionBinding);
  await f.cold();const cold=new RecoverableProductSessionClient(f.clientConfig),restored=await cold.restore();assert.equal(restored.status,'connected');assert.equal(restored.session.account,approval.account);assert.equal(f.completeCalls,2);assert.equal(f.deviceSigns,2);assert.equal(f.host.snapshot().authority.sessions.length,2);
 }finally{await f.close();}
});
test('trusted publication metadata binds exact account and full signed approval, without rewriting on colliding requestId',async()=>{
 const f=await fixture();try{
  const requestId='req_reference_metadata_1',published=await f.caller.publishReturn({requestId,request:f.request,approval:f.approval}),before=canonicalJSON(f.host.snapshot()),metadata=f.host.readOriginalProductSessionReturnOutcome(requestId);
  assert.equal(metadata.account,f.approval.account);assert.equal(metadata.approvalDigest,productSessionApprovalDigest(f.approval));assert.equal(metadata.requestDigest,f.approval.requestDigest);assert.equal(metadata.reference,published.reference);assert.equal(metadata.retryAuthorized,false);assert.equal(canonicalJSON(f.host.snapshot()),before);
  const other=await f.approveOther(f.request);assert.notEqual(other.account,metadata.account);await assert.rejects(()=>f.caller.publishReturn({requestId,request:f.request,approval:other}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(f.host.readOriginalProductSessionReturnOutcome(requestId),metadata);assert.equal(f.host.snapshot().returnPublications.records.length,1);assert.equal(f.host.snapshot().authority.sessions.length,0);
 }finally{await f.close();}
});
test('unaltered normal product factory and coordinator use fixed HTTP reference caller, cold recover and revoke original session',async()=>{
 const f=await fixture(),nativeFetch=globalThis.fetch;let lose=true,completes=0,opened=0;
 try{
  // Explicit QA transport boundary only. Actual factory, coordinator, client,
  // device crypto, HTTP Host and filesystem run unchanged; no OS open occurs.
  globalThis.fetch=async(target,init)=>{const url=new URL(target),fixed=url.origin==='https://wallet-auth.ynxweb4.com';assert(fixed||url.origin===f.httpURL);const path=url.pathname,response=await nativeFetch(f.httpURL+path,init);if(fixed&&path===base+'/complete'){completes++;if(lose){lose=false;await response.text();throw new WalletAuthError('NETWORK_UNAVAILABLE','QA factory lost ACK');}}return response;};
  const config={registry,productId:'finance',platform:'web',walletInstalled:async()=>true,schemeRegistered:async()=>true,gatewayTimeoutMs:2000,storage:f.clientConfig.storage,device:f.clientConfig.device,scope:{},discoveryWaitMs:0,openWallet:async()=>{opened++;return {opened:true};},openTimeoutMs:1000};
  const connection=createProductWalletConnection(config),begun=await connection.beginYNX();assert.equal(begun.status,'wallet-opened');assert.equal(opened,1);const request=begun.sessionState.request;
  const publication=await f.caller.publishReturn({requestId:'req_reference_factory_01',request,approval:f.approve(request)}),url=createProductSessionReferenceReturnURL(registry,request,publication,f.now);
  assert.notEqual((await connection.handleReturn(url)).sessionState.status,'connected');assert.equal(completes,1);assert.equal(f.deviceSigns,1);
  await f.cold();const cold=createProductWalletConnection(config),restored=await cold.restore();assert.equal(restored.sessionState.status,'connected');assert.equal(completes,1);assert.equal(f.deviceSigns,1);assert.equal(opened,1);
  const ended=await cold.disconnect();assert.equal(ended.sessionState.status,'disconnected');assert.equal(ended.sessionState.revocationConfirmed,true);assert.equal(f.host.snapshot().authority.revokedSessions.length,1);assert.equal(completes,1);
 }finally{globalThis.fetch=nativeFetch;await f.close();}
});
test('fixed publisher factory recovers lost publish ACK from full original approval after expiry without another publish or mutation',async()=>{
 const f=await fixture(),nativeFetch=globalThis.fetch;let publishes=0,lose=true;
 try{
  globalThis.fetch=async(target,init)=>{const url=new URL(target);assert.equal(url.origin,'https://wallet-auth.ynxweb4.com');const response=await nativeFetch(f.httpURL+url.pathname,init);if(url.pathname===base){publishes++;if(lose){lose=false;await response.text();throw new WalletAuthError('NETWORK_UNAVAILABLE','QA lost publish ACK');}}return response;};
  const publisher=createProductWalletReturnPublisher({gatewayTimeoutMs:2000}),publicationRequestId='req_fixed_pub_original_1',input={publicationRequestId,request:f.request,approval:f.approval};
  await assert.rejects(()=>publisher.publishReturn({requestId:publicationRequestId,request:f.request,approval:f.approval}));assert.equal(publishes,1);assert.equal(f.host.snapshot().returnPublications.records.length,1);
  f.advance();await f.cold();const before=canonicalJSON(f.host.snapshot()),recovered=await publisher.publicationOutcome({requestId:'req_fixed_pub_readonly_1',...input});assert.equal(recovered.state,'pending');assert.equal(recovered.account,f.approval.account);assert.equal(recovered.approvalDigest,productSessionApprovalDigest(f.approval));assert.equal(recovered.retryAuthorized,false);assert.equal(canonicalJSON(f.host.snapshot()),before);
  const missing=await publisher.publicationOutcome({requestId:'req_fixed_pub_readonly_2',...input,publicationRequestId:'req_fixed_pub_absent_001'});assert.deepEqual(missing,{state:'not_found',retryAuthorized:false});assert.equal(canonicalJSON(f.host.snapshot()),before);assert.equal(publishes,1);assert.equal(f.host.snapshot().authority.sessions.length,0);assert.equal(f.host.snapshot().authority.consumedNonces.length,0);
  await assert.rejects(()=>publisher.publicationOutcome({requestId:'req_fixed_pub_readonly_3',...input,approval:{...f.approval,walletProof:'invalid'}}));assert.equal(canonicalJSON(f.host.snapshot()),before);
  for(const field of ['endpoint','fetch','provider','key','nativeBorrow'])assert.throws(()=>createProductWalletReturnPublisher({gatewayTimeoutMs:2000,[field]:'untrusted'}),{code:'UNKNOWN_OR_MISSING_FIELD'});
 }finally{globalThis.fetch=nativeFetch;await f.close();}
});
test('a different DApp cannot restore a foreign protected session even when a storage bridge and signer were misbound',async()=>{
 const f=await fixture();try{
  const client=new RecoverableProductSessionClient(f.clientConfig),pending=await client.beginExplicit(),publication=await f.caller.publishReturn({requestId:'req_reference_isolation1',request:pending.request,approval:f.approve(pending.request)}),connected=await client.handleReturn(createProductSessionReferenceReturnURL(registry,pending.request,publication,f.now));assert.equal(connected.status,'connected');
  const {finiteServiceSeconds:ignored,...original}=f.clientConfig,binding=productPlatformBinding(registry,'cloud','web'),other=new RecoverableProductSessionClient({...original,productId:'cloud',device:{...original.device,scopes:binding.scopes}}),foreign=f.values.get(client.storageKey);f.values.set(other.storageKey,foreign);
  const before=f.operations.length,result=await other.restore();assert.notEqual(result.status,'connected');assert.equal(f.operations.length,before);assert.equal(f.values.get(other.storageKey),foreign);assert.equal(f.values.get(client.storageKey),foreign);assert.equal(f.host.snapshot().authority.sessions.length,1);
 }finally{await f.close();}
});
