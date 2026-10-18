import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {ProductSessionAuthority,createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge} from '../src/product-session-v2.js';
import {ynxAddressFromEVM} from '../src/crypto.js';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletProductSessionApproval} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {captureProductSessionAccountPolicy} from '../src/product-session-account-policy.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval} from '../src/product-session-pq-approval.js';
import {ProductSessionGatewayHttpHandler} from '../src/product-session-gateway-http.js';
import {canonicalJSON} from '../src/canonical.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
const at=new Date('2026-10-18T00:00:00.000Z'),device=Buffer.alloc(32,7);
const base={productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.portfolio.read'],purpose:'Explicit account session',nonce:'b'.repeat(43),state:'c'.repeat(43)};
const context=s=>({...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,s[k]])),requiredScopes:s.scopes});
// Fresh isolated keys and an EXPLICIT SYNTHETIC committed source fixture.
// Real signature math and existing state machine, not real chain/source grants.
test('PQ v3 actual dual approval enters original device lifecycle; replay, revocation and source fences remain effective',async()=>{
 const network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network);
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));let retired=false;
  const original={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:network.owner,
   checkpoint:{kind:'trusted-node-committed/v1',height:'9007199254740993',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',
   activeRecord:{revision:'1',registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB},observedAt:at.toISOString(),expiresAt:'2026-10-18T00:05:00.000Z'};
  const resource={readOriginal:()=>original,assertCurrent(){if(retired)throw Error('fixture retired');},async recheck(){this.assertCurrent();},retire(){retired=true;},async join(){},async close(){retired=true;}};
  const observation=captureProductSessionAccountPolicy(resource,{networkId:network.chainId,account},at);
  const request=createProductSessionRequest(registry,base,at),plan=preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt},observation,at);
  const approval=signPQWalletProductSessionApproval(handle,plan,at);
  assert.throws(()=>signPQWalletProductSessionApproval(handle,{},at),{code:'PQ_SESSION_REVIEW_PLAN_REQUIRED'});
  const shortPlan=preparePQProductSessionApproval(registry,request,{account,expiresAt:'2026-10-18T00:00:01.000Z'},observation,at);
  assert.throws(()=>signPQWalletProductSessionApproval(handle,shortPlan,new Date('2026-10-18T00:00:01.000Z')),{code:'SESSION_EXPIRED'});
  const finite=createProductSessionRequest(registry,{...base,scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],finiteServiceSeconds:7200},at);
  assert.throws(()=>preparePQProductSessionApproval(registry,finite,{account,expiresAt:finite.expiresAt},observation,at));
  assert.throws(()=>preparePQProductSessionApproval(registry,finite,{account,expiresAt:finite.expiresAt,approvedServiceConsent:{...finite.serviceConsent,durationSeconds:3600}},observation,at),{code:'SERVICE_CONSENT_BINDING_MISMATCH'});
  assert(preparePQProductSessionApproval(registry,finite,{account,expiresAt:finite.expiresAt,approvedServiceConsent:finite.serviceConsent},observation,at));
  assert.equal(approval.version,'3');assert(!('walletSignature' in approval));assert(!('accountPublicKey' in approval));
  const verified=verifyPQProductSessionApproval(registry,request,approval,observation,at);
  const options={observation,verifiedApproval:verified.verifiedApproval,required:true};
  const http=(handler,path,body,id)=>handler.handle({requestId:id,method:'POST',path,contentType:'application/json',body:canonicalJSON(body),proofHeader:null,networkAvailable:true},at);
  const gateway=new ProductSessionGatewayHttpHandler(registry,()=>'g'.repeat(43),undefined,undefined,options);
  const h1=http(gateway,'/v2/product-sessions/challenge',{request,approval},'req_pq_challenge_00001');assert.equal(h1.status,200);
  const gatewayChallenge=JSON.parse(h1.body).result;
  const coldGateway=new ProductSessionGatewayHttpHandler(registry,()=>'h'.repeat(43),JSON.parse(JSON.stringify(gateway.snapshot())),undefined,options);
  const gatewayBody={request,approval,completion:signProductSessionChallenge(gatewayChallenge,device.toString('base64url'))};
  const h2=http(coldGateway,'/v2/product-sessions/complete',gatewayBody,'req_pq_complete_00001');assert.equal(h2.status,200);
  assert.equal(JSON.parse(h2.body).result.version,'3');
  assert.equal(http(coldGateway,'/v2/product-sessions/complete',gatewayBody,'req_pq_complete_00001').body,h2.body);
  assert.equal(http(coldGateway,'/v2/product-sessions/complete',gatewayBody,'req_pq_complete_replay_1').status,400);
  const server=new ProductSessionAuthority(registry,undefined,options);
  const challenge=server.issueChallenge({request,approval,challenge:'d'.repeat(43)},at);
  const completion=signProductSessionChallenge(challenge,device.toString('base64url'));
  const session=server.complete({request,approval,completion},at);
  assert.equal(session.version,'3');assert.equal(session.account,account);assert.equal(session.accountAuthorization.pkA,keys.pkA);
  assert.equal(server.introspect(session.sessionBinding,context(session),at).active,true);
  assert.throws(()=>server.complete({request,approval,completion},at));
  const cold=new ProductSessionAuthority(registry,JSON.parse(JSON.stringify(server.snapshot())),options);
  assert.equal(cold.introspect(session.sessionBinding,context(session),at).active,true);
  assert.throws(()=>cold.introspect(session.sessionBinding,{...context(session),productId:'mail'},at));
  cold.revokeSession(session.sessionBinding);assert.throws(()=>cold.introspect(session.sessionBinding,context(session),at),{code:'SESSION_REVOKED'});
  assert.throws(()=>new ProductSessionAuthority(registry).issueChallenge({request,approval,challenge:'e'.repeat(43)},at),{code:'PQ_SESSION_VERIFICATION_REQUIRED'});
  assert.throws(()=>verifyPQProductSessionApproval(registry,request,{...approval,state:'z'.repeat(43)},observation,at));
  assert.throws(()=>verifyPQProductSessionApproval(registry,request,{...approval,walletSignature:'00'},observation,at));
  const tampered={...approval,walletProof:Buffer.from(approval.walletProof,'base64url').map((x,i)=>i===100?x^1:x).toString('base64url')};
  assert.throws(()=>verifyPQProductSessionApproval(registry,request,tampered,observation,at));
  original.activeRecord={...original.activeRecord,revision:'2'};
  assert.notEqual(http(coldGateway,'/v2/product-sessions/complete',gatewayBody,'req_pq_complete_00001').status,200);
  assert.throws(()=>server.introspect(session.sessionBinding,context(session),at),{code:'ACCOUNT_POLICY_CHANGED'});
  original.activeRecord={...original.activeRecord,revision:'1'};resource.retire();
  assert.throws(()=>signPQWalletProductSessionApproval(handle,plan,at),/fixture retired/);
  assert.throws(()=>server.introspect(session.sessionBinding,context(session),at),/fixture retired/);
 }finally{destroyPQWalletKeyHandle(handle);}
});
test('active PQ source rejects valid classic account approval before issuing challenge',()=>{
 const request=createProductSessionRequest(registry,base,at),approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},at);
 // This negative only checks routing; no synthetic signature is treated as PQ.
 const owner='0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
 const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:'71'.repeat(32),canonicalOwner:owner,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:'1',registeredAt:'10',activeFrom:'20',pkA:'01'.repeat(2592),pkB:'02'.repeat(64)},observedAt:at.toISOString(),expiresAt:'2026-10-18T00:05:00.000Z'};
 const resource={readOriginal:()=>view,assertCurrent(){},async recheck(){},retire(){},async join(){},async close(){}};
 const observation=captureProductSessionAccountPolicy(resource,{networkId:view.networkId,account:approval.account},at);
 const authority=new ProductSessionAuthority(registry,undefined,{observation,verifiedApproval:null,required:true});
 assert.throws(()=>authority.issueChallenge({request,approval,challenge:'d'.repeat(43)},at),{code:'ACTIVE_PQ_CLASSIC_SESSION_REFUSED'});
 assert.equal(authority.snapshot().issuedChallenges.length,0);
 const http=new ProductSessionGatewayHttpHandler(registry,()=>'d'.repeat(43),undefined,undefined,{observation,verifiedApproval:null,required:true});
 const result=http.handle({requestId:'req_pq_classic_denied_01',method:'POST',path:'/v2/product-sessions/challenge',contentType:'application/json',body:canonicalJSON({request,approval}),proofHeader:null,networkAvailable:true},at);
 assert.notEqual(result.status,200);assert.equal(JSON.parse(result.body).error.code,'ACTIVE_PQ_CLASSIC_SESSION_REFUSED');
 assert.equal(http.snapshot().authority.issuedChallenges.length,0);
});
