import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {canonicalJSON} from '../src/canonical.js';
import {ynxAddressFromEVM} from '../src/crypto.js';
import {ProductSessionAuthority,createProductSessionRequest,signProductSessionChallenge,parseProductSessionApproval} from '../src/product-session-v2.js';
import {parseCompletionRecord,deriveCompletionTarget} from '../src/product-session-completion-record.js';
import {captureProductSessionAccountPolicy} from '../src/product-session-account-policy.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval,verifyPQProductSessionCompletionRecord} from '../src/product-session-pq-approval.js';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,signPQWalletProductSessionApproval,destroyPQWalletKeyHandle} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
// Actual dual/P256 math and original authority; synthetic QA policy only.
test('V3 cold completion checks fresh current policy at NOW and signed bytes at original time, with completion-only capability',async()=>{
 const at=new Date('2026-10-18T00:00:00.000Z'),late=new Date('2026-10-18T00:06:00.000Z'),network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network),device=Buffer.alloc(32,7);
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
  const observe=(time,revision='1')=>{
   let retired=false;const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:network.owner,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision,registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB},observedAt:time.toISOString(),expiresAt:new Date(time.getTime()+30000).toISOString()};
   const owner={readOriginal:()=>view,assertCurrent(){if(retired)throw Error('QA retired');},async recheck(){this.assertCurrent();},retire(){retired=true;},async join(){},async close(){}};
   return {owner,ref:captureProductSessionAccountPolicy(owner,{networkId:network.chainId,account},time)};
  };
  const original=observe(at),request=createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Explicit cold recovery',nonce:'b'.repeat(43),state:'c'.repeat(43),finiteServiceSeconds:7200},at);
  const approval=signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt,approvedServiceConsent:request.serviceConsent},original.ref,at),at),verified=verifyPQProductSessionApproval(registry,request,approval,original.ref,at);
  const authority=new ProductSessionAuthority(registry,undefined,{observation:original.ref,verifiedApproval:verified.verifiedApproval,required:true}),challenge=authority.issueChallenge({request,approval,challenge:'d'.repeat(43)},at),completion=signProductSessionChallenge(challenge,device.toString('base64url'));
  const session=authority.complete({request,approval,completion},at),raw=canonicalJSON({request,approval,completion});assert(Buffer.byteLength(raw)>16384&&Buffer.byteLength(raw)<=196608);
  const fresh=observe(late);
  assert.throws(()=>verifyPQProductSessionApproval(registry,request,approval,fresh.ref,late));
  const restored=verifyPQProductSessionCompletionRecord(registry,raw,fresh.ref,late);
  assert.deepEqual(restored.target,session);assert.deepEqual(deriveCompletionTarget(registry,raw,late,restored.verification),session);
  assert.deepEqual(parseCompletionRecord(registry,raw,late,null,restored.verification).completion,completion);
  assert.throws(()=>deriveCompletionTarget(registry,raw,late,{}),{code:'PQ_COMPLETION_VERIFICATION_REQUIRED'});
  assert.throws(()=>parseProductSessionApproval(registry,request,approval,at,restored.verification),{code:'PQ_SESSION_VERIFICATION_REQUIRED'});
  assert.throws(()=>new ProductSessionAuthority(registry,undefined,{observation:fresh.ref,verifiedApproval:restored.verification,required:true}).issueChallenge({request,approval,challenge:'e'.repeat(43)},late));
  assert.throws(()=>verifyPQProductSessionCompletionRecord(registry,raw,observe(late,'2').ref,late));
  const bad=JSON.parse(raw);bad.completion.deviceSignature='a'.repeat(96);assert.throws(()=>verifyPQProductSessionCompletionRecord(registry,canonicalJSON(bad),fresh.ref,late));
  assert.throws(()=>parseCompletionRecord(registry,canonicalJSON({...JSON.parse(raw),approval:{...approval,version:'2'}}),late),{code:'INVALID_SESSION_STORE'});
  fresh.owner.retire();assert.throws(()=>deriveCompletionTarget(registry,raw,late,restored.verification),/QA retired/);
 }finally{destroyPQWalletKeyHandle(handle);}
});
