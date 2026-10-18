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
import {ynxAddressFromEVM} from '../src/crypto.js';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {ProductSessionGatewayFetchAdapter} from '../src/product-session-gateway-client.js';
import {createProductSessionRequest,signProductSessionChallenge} from '../src/product-session-v2.js';
import {createPQWalletKeyHandle,destroyPQWalletKeyHandle,readPQWalletKeyPublic,signPQWalletProductSessionApproval} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {captureProductSessionAccountPolicy} from '../src/product-session-account-policy.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval} from '../src/product-session-pq-approval.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
const base='/v2/product-sessions/returns';
// Actual original Host filesystem and HTTP adapter; policy provider/HTTPS
// binding are explicit QA standins, never real Source or Native admission.
async function fixture(){
 const network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network),dir=mkdtempSync(join(tmpdir(),'ynx-return-host-')),device=Buffer.alloc(32,7);
 const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));let now=new Date('2026-10-18T00:00:00.000Z'),serial=0,postFailure=false,missing=false,changed=false,host,server,url,operations=[];
 function context(request=null,approval=null,write=false){
  let retired=false;const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:network.owner,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:changed?'2':'1',registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB},observedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30000).toISOString()};
  const resource={readOriginal:()=>view,assertCurrent(){if(retired)throw Error('QA retired');},async recheck(){this.assertCurrent();},retire(){retired=true;},async join(){},async close(){}};
  const observation=captureProductSessionAccountPolicy(resource,{networkId:network.chainId,account},now),verifiedApproval=write?verifyPQProductSessionApproval(registry,request,approval,observation,now).verifiedApproval:null;
  return {value:{observation,verifiedApproval,required:true},retire:()=>resource.retire()};
 }
 const request=createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Explicit reference recovery',nonce:'b'.repeat(43),state:'c'.repeat(43),finiteServiceSeconds:7200},now);
 const signing=context();const approval=signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt,approvedServiceConsent:request.serviceConsent},signing.value.observation,now),now);signing.retire();
 const options={statePath:join(dir,'state.json'),now:()=>now,tokenFactory:()=>String(++serial).padStart(43,'t'),accountPolicy:{mode:'required',async run(operation,execute){
  const ref=operation.path.startsWith(base);
  assert.equal(Object.keys(operation).sort().join('|'),['requestId','method','path','body','proofHeader','walletControlProofHeader','session','at',...(ref?['publication']:[])].sort().join('|'));
  operations.push(operation);if(missing)throw Error('QA Source missing');const body=JSON.parse(operation.body),publication=operation.publication;
  const write=operation.path===base||operation.path===base+'/complete'&&!publication.completed;
  if(operation.path===base){assert.equal(publication,null);assert.equal(operation.session,null);}else if(ref){assert.equal(publication.requestRaw,canonicalJSON(body.request));assert.equal(Object.isFrozen(publication),true);assert.equal(!!operation.session,publication.completed);}
  const ctx=context(write?(publication?JSON.parse(publication.requestRaw):body.request):null,write?(publication?JSON.parse(publication.approvalRaw):body.approval):null,write);
  try{assert.equal(execute(ctx.value),undefined);if(postFailure)throw Error('QA Source post-effect UNKNOWN');}finally{ctx.retire();}
 }}};
 async function stop(){if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}}
 async function start(){host=new ProductSessionGatewayNodeHost(registry,options);server=createServer(host.handler());await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;}
 await start();
 let loseComplete=false,loseBeforeComplete=false,deviceSigns=0,signUnknown=false,completeCalls=0;
 const caller=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:async(target,init)=>{const path=new URL(target).pathname;if(path===base+'/complete'){completeCalls++;if(loseBeforeComplete){loseBeforeComplete=false;throw new WalletAuthError('NETWORK_UNAVAILABLE','QA unknown complete transport');}}const response=await fetch(url+path,init);if(path===base+'/complete'&&loseComplete){loseComplete=false;await response.text();throw new WalletAuthError('NETWORK_UNAVAILABLE','QA lost completion response');}return response;},walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:2000});
 const values=new Map();let deviceToken=0;
 const clientConfig={registry,productId:'finance',platform:'web',finiteServiceSeconds:7200,storage:{securityLevel:'webcrypto-nonextractable',get:async k=>values.get(k)??null,set:async(k,v)=>{values.set(k,v);},remove:async k=>values.delete(k)},gateway:caller,device:{id:'a'.repeat(43),key:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:request.scopes,purpose:'Explicit reference recovery',async sign(v){if(v.purpose==='challenge'){deviceSigns++;if(signUnknown)throw Error('QA device signing UNKNOWN');}return Buffer.from(p256.sign(Buffer.from(v.payload,'base64url'),device,{format:'der'})).toString('base64url');}},tokenFactory:()=>String(++deviceToken).padStart(43,'k'),clock:()=>now};
 return {request,approval,caller,operations,device,context,clientConfig,values,get completeCalls(){return completeCalls;},get deviceSigns(){return deviceSigns;},loseComplete(){loseComplete=true;},loseBeforeComplete(){loseBeforeComplete=true;},signUnknown(){signUnknown=true;},approve(r){const ctx=context();try{return signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,r,{account,expiresAt:r.expiresAt,approvedServiceConsent:r.serviceConsent},ctx.value.observation,now),now);}finally{ctx.retire();}},get host(){return host;},get now(){return now;},setMissing(){missing=true;},setChanged(){changed=true;},failure(v){postFailure=v;},advance(){now=new Date('2026-10-18T00:06:00.000Z');},async cold(){await stop();await start();},async close(){await stop();destroyPQWalletKeyHandle(handle);rmSync(dir,{recursive:true,force:true});}};
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
