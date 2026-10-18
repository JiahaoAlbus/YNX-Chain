import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {canonicalJSON} from '../src/canonical.js';
import {ynxAddressFromEVM} from '../src/crypto.js';
import {ProductSessionAuthority} from '../src/product-session-v2.js';
import {verifyProductSessionProofV2} from '../src/product-session-proof-v2.js';
import {createProductSessionReturnURL} from '../src/product-session-router.js';
import {captureProductSessionAccountPolicy} from '../src/product-session-account-policy.js';
import {createPQWalletKeyHandle,destroyPQWalletKeyHandle,readPQWalletKeyPublic,signPQWalletProductSessionApproval} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval,createPQRecoverableProductSessionClient} from '../src/product-session-pq-approval.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
async function fixture(){
 const network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network),keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle)),secret=Buffer.alloc(32,7);
 let now=new Date('2026-10-18T00:00:00.000Z'),snapshot,token=0,missing=false,cleanupFail=false;
 const values=new Map(),counts={challenge:0,complete:0,deviceChallenge:0,acquire:0,close:0};
 const acquire=async input=>{
  counts.acquire++;let retired=false,closed=false,closing;
  const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:network.owner,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:'1',registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB},observedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30000).toISOString()};
  const resource={readOriginal:()=>view,assertCurrent(){if(retired)throw Error('QA retired');},async recheck(){this.assertCurrent();},retire(){retired=true;},async join(){},async close(){}};
  const obs=captureProductSessionAccountPolicy(resource,{networkId:network.chainId,account},now),verified=['challenge','completion'].includes(input.operation)?verifyPQProductSessionApproval(registry,input.request,input.approval,obs,now).verifiedApproval:null;
  const owner={readContext(){resource.assertCurrent();return {observation:obs,verifiedApproval:verified,required:true};},assertCurrent(){resource.assertCurrent();},async recheck(){resource.assertCurrent();},retire(){resource.retire();},async join(){},close(){if(!closing)closing=Promise.resolve().then(()=>{counts.close++;if(cleanupFail)throw Error('QA cleanup UNKNOWN');closed=true;});return closing;}};
  if(missing){const e=Error('QA source unavailable');Object.defineProperty(e,'partial',{value:owner});throw e;}
  return owner;
 };
 const source={acquire},server=async(input,work)=>{const owner=await acquire(input);try{const authority=new ProductSessionAuthority(registry,snapshot,owner.readContext()),result=work(authority);snapshot=authority.snapshot();return result;}finally{owner.retire();await owner.join();await owner.close();}};
 const gateway={currentTime:async()=>now,walletInstalled:async()=>false,schemeRegistered:async()=>false,
  challenge:async r=>{counts.challenge++;return server({account,operation:'challenge',request:r.request,approval:r.approval},a=>a.issueChallenge({request:r.request,approval:r.approval,challenge:'d'.repeat(43)},now));},
  complete:async r=>{counts.complete++;await server({account,operation:'completion',request:r.request,approval:r.approval},a=>a.complete({request:r.request,approval:r.approval,completion:r.completion},now));throw Object.assign(Error('QA lost complete ACK'),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});},
  introspect:async r=>server({account,operation:'revalidation',request:null,approval:null},a=>{const s=a.snapshot().sessions.find(x=>x.sessionBinding===r.sessionBinding);if(!s)throw Error('QA original target absent');verifyProductSessionProofV2(r.proof,s,{method:'POST',path:'/v2/product-sessions/introspect',bodyDigest:r.proof.bodyDigest},now);return a.introspect(s.sessionBinding,{...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,s[k]])),requiredScopes:r.requiredScopes},now);}),revoke:async()=>{throw Error('not part of this QA');}};
 const config={registry,productId:'finance',platform:'android',finiteServiceSeconds:7200,storage:{securityLevel:'os-protected',get:async k=>values.get(k)??null,set:async(k,v)=>{values.set(k,v);},remove:async k=>values.delete(k)},gateway,device:{id:'a'.repeat(43),key:Buffer.from(p256.getPublicKey(secret,true)).toString('base64url'),scopes:['finance.profile.write'],purpose:'Explicit cold client recovery',async sign(v){if(v.purpose==='challenge')counts.deviceChallenge++;return Buffer.from(p256.sign(Buffer.from(v.payload,'base64url'),secret,{format:'der'})).toString('base64url');}},tokenFactory:()=>String(++token).padStart(43,'a'),clock:()=>now,accountPolicySource:source};
 const client=createPQRecoverableProductSessionClient(config);
 const returned=async request=>{const own=await acquire({account,operation:'revalidation',request:null,approval:null});try{const obs=own.readContext().observation,approval=signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt,approvedServiceConsent:request.serviceConsent},obs,now),now),verified=verifyPQProductSessionApproval(registry,request,approval,obs,now);return createProductSessionReturnURL(registry,request,{result:'approved',approval},now,verified.verifiedApproval);}finally{own.retire();await own.join();await own.close();}};
 return {client,config,counts,values,returned,advance(){now=new Date('2026-10-18T00:06:00.000Z');},missing(){missing=true;},cleanup(){cleanupFail=true;},close(){destroyPQWalletKeyHandle(handle);}};
}
// All Source/storage/transport objects are explicit QA fixtures. Real SDK dual,
// P256, original authority, client and exact protected records are exercised.
test('original V3 client cold-restores a lost complete ACK after approval expiry by exact read-only target, without re-sign/resubmit',async()=>{
 const f=await fixture();try{const pending=await f.client.beginExplicit(),url=await f.returned(pending.request);assert(url.length>16384);assert.equal((await f.client.handleReturn(url)).status,'retry-required');assert.equal(f.counts.complete,1);assert.equal(f.counts.deviceChallenge,1);assert(f.values.get(f.client.storageKey+':completion').length>16384);
 f.advance();const cold=createPQRecoverableProductSessionClient(f.config),restored=await cold.restore();assert.equal(restored.status,'connected');assert.equal(restored.session.version,'3');assert.equal(restored.session.expiresAt,'2026-10-18T02:00:00.000Z');assert.equal(f.counts.complete,1);assert.equal(f.counts.challenge,1);assert.equal(f.counts.deviceChallenge,1);assert.equal(f.values.has(cold.storageKey+':completion'),false);
 }finally{f.close();}
});
test('missing Source and cleanup UNKNOWN preserve exact V3 completion and never replay original completion',async()=>{
 const f=await fixture();try{const pending=await f.client.beginExplicit();await f.client.handleReturn(await f.returned(pending.request));const key=f.client.storageKey+':completion',raw=f.values.get(key);f.advance();f.missing();f.cleanup();const cold=createPQRecoverableProductSessionClient(f.config);assert.equal((await cold.restore()).status,'retry-required');assert.equal(f.values.get(key),raw);assert.equal(f.counts.complete,1);const acquired=f.counts.acquire;assert.equal((await cold.restore()).status,'retry-required');assert.equal(f.counts.acquire,acquired);assert.equal(f.values.get(key),raw);
 }finally{f.close();}
});
