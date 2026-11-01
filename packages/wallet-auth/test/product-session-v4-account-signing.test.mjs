import test from'node:test';import assert from'node:assert/strict';import registry from'../product-session-registry.json'with{type:'json'};
import{createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletProductSessionApprovalV4,signPQWalletProductSessionApproval}from'../src/pq-wallet-key-backup.js';
import{preparePQProductSessionApprovalV4,prepareProductSessionApprovalV4Data,verifyProductSessionApprovalV4Data}from'../src/product-session-pq-v4-codec.js';
import{captureProductSessionAccountPolicy}from'../src/product-session-account-policy.js';
import{createProductSessionRequest}from'../src/product-session-v2.js';import{productPlatformBinding}from'../src/product-session-registry.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'../src/product-session-device-registration-v4.js';import{ynxAddressFromEVM}from'../src/crypto.js';import{canonicalJSON}from'../src/canonical.js';import{PQ_SUITE}from'../src/pq-wallet-contract.js';
test('new fixed v4 account plan signs through existing account custody and verifies full AND once',async()=>{
 const network='aa'.repeat(32),owner='0x'+'11'.repeat(20),account=ynxAddressFromEVM(owner),at=new Date('2026-10-31T12:00:00.000Z'),handle=await createPQWalletKeyHandle({chainId:network,owner});
 try{
  const p=readPQWalletKeyPublic(handle),binding=productPlatformBinding(registry,'developer','macos'),hex=v=>Buffer.from(v,'base64url').toString('hex');let valid=true;
  const original={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network,canonicalOwner:owner,checkpoint:{kind:'trusted-node-committed/v1',height:'3',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:'1',registeredAt:'1',activeFrom:'2',pkA:hex(p.pkA),pkB:hex(p.pkB)},observedAt:at.toISOString(),expiresAt:new Date(+at+5000).toISOString()};
  // Explicit PUBLIC policy resource for mathematical integration only. This
  // fixture is not an independently admitted node, Main review or user grant.
  const resource={readOriginal:()=>original,assertCurrent(){if(!valid)throw Error('PUBLIC_CURRENT_REVOKED')},async recheck(){},retire(){},join(){},close(){}};
  const policy=captureProductSessionAccountPolicy(resource,{networkId:network,account},at),record={version:'4',registrationId:'11111111-1111-4111-8111-111111111111',networkId:network,canonicalOwner:owner,...Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'].map(k=>[k,binding[k]])),deviceId:'PUBLIC-registration-device',generation:'1',revision:'1',pkA:'33'.repeat(2592),pkB:'44'.repeat(64),registeredAt:new Date(+at-1000).toISOString(),expiresAt:new Date(+at+4000).toISOString(),revokedAt:null},registration=Buffer.from(canonicalJSON(record)),r=inspectProductSessionDeviceRegistrationOriginalV4Data(registration);
  const request={...createProductSessionRequest(registry,{productId:'developer',platform:'macos',deviceId:record.deviceId,deviceAlgorithm:PQ_SUITE,deviceRegistrationId:record.registrationId,deviceRegistrationRevision:'1',deviceRegistrationDigest:r.registrationDigest,scopes:[binding.scopes[0]],purpose:'PUBLIC independent account approval',nonce:'N'.repeat(32),state:'S'.repeat(32)},at),expiresAt:record.expiresAt};
  const input={account,expiresAt:new Date(+at+3000).toISOString()},data=prepareProductSessionApprovalV4Data(registry,request,input,policy,registration,at),plan=preparePQProductSessionApprovalV4(registry,request,input,policy,registration,at);
  assert.equal(data.approval,false);assert.throws(()=>signPQWalletProductSessionApprovalV4(handle,data,at),{code:'PQ_SESSION_V4_REVIEW_PLAN_REQUIRED'});assert.throws(()=>signPQWalletProductSessionApprovalV4(handle,{...plan},at),{code:'PQ_SESSION_V4_REVIEW_PLAN_REQUIRED'});
  assert.throws(()=>signPQWalletProductSessionApproval(handle,plan,at),{code:'PQ_SESSION_REVIEW_PLAN_REQUIRED'});
  const approval=signPQWalletProductSessionApprovalV4(handle,plan,at),verified=verifyProductSessionApprovalV4Data(registry,request,approval,policy,registration,at);assert.equal(approval.version,'4');assert.equal(verified.signatureVerified,true);assert.equal(verified.NativeAdmission,false);assert.equal(verified.SourceAdmission,false);
  assert.throws(()=>signPQWalletProductSessionApprovalV4(handle,plan,at),{code:'PQ_SESSION_V4_APPROVAL_ALREADY_ENTERED'});
  const after=preparePQProductSessionApprovalV4(registry,request,input,policy,registration,at);valid=false;assert.throws(()=>signPQWalletProductSessionApprovalV4(handle,after,at),/PUBLIC_CURRENT_REVOKED/);
 }finally{destroyPQWalletKeyHandle(handle);}
});
