// PUBLIC registrations/ephemeral keys only; frame DATA never supplies trusted
// provenance, fresh clocks, Native admission, business permission or approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {keyGen,batchSign,extract,encodeMember,decodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {canonicalJSON} from '../src/canonical.js';
import {canonicalOriginalAuthIdentityRequest,encodeOriginalAuthIdentityRequest,AUTH_IDENTITY_PURPOSES as purposes} from '../native/original-auth-identity-v2-contract.mjs';
import {verifyOriginalAuthIdentityProofFrameData as verify} from '@ynx-chain/wallet-auth/auth-identity-verification';
const version='YNX-AUTH-IDENTITY-PROOF-DATA/v1';
test('proof frame rejects non-string, capacity, noncanonical, duplicate and unknown fields before math',()=>{
 let getter=false;assert.throws(()=>verify({get toString(){getter=true;return ()=>'';}}));assert.equal(getter,false);
 for(const raw of ['',null,'x'.repeat(2097153),'中'.repeat(699051),'null','[]','{}','{"version":"a","version":"b"}','{"__proto__":{}}'])assert.throws(()=>verify(raw));
});
test('fixed canonical proof DATA frame feeds sole verifier for three exact R82 N1 purposes',()=>{
 const key=keyGen({provider:'portable'}),batches=[];
 const network={chainId:'ab'.repeat(32),nativeChainId:'6423',owner:'0x'+'12'.repeat(20)},H='9007199254740993';
 const registration={owner:network.owner,executionHeight:H,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex'),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const request={version:'YNX-AUTH-IDENTITY/v2',algorithmVersion:'YNX-BATCH/v0.1',networkId:network.chainId,owner:network.owner,keyVersion:'1',executionHeight:H,principalId:'PUBLIC-original-principal',productId:'developer',applicationId:'com.ynx.developer',deviceId:'PUBLIC-device',requestId:'PUBLIC-request',purpose:purposes.receive,requestDigest:'ab'.repeat(32),credentialDigest:'cd'.repeat(32),nonce:Buffer.alloc(32,1).toString('base64url'),issuedAtMs:'100',expiresAtMs:'30100'};
 const sign=(body,count=1)=>{const message=Buffer.from(encodeOriginalAuthIdentityRequest(body)),batch=batchSign(key.privateKey,{chainId:Buffer.from(network.chainId,'hex'),owner:network.owner,purpose:body.purpose},count===1?[message]:[message,Buffer.from('PUBLIC second message')]);batches.push(batch.batch);return encodeMember(extract(batch.batch,0));};
 const frame=(body,wire)=>({version,requestRaw:canonicalOriginalAuthIdentityRequest(body),expectedRequestRaw:canonicalOriginalAuthIdentityRequest(body),purpose:body.purpose,atMs:'100',registration,network,wireBase64url:wire.toString('base64url')});
 try{
  for(const purpose of [purposes.receive,purposes.recover,purposes.keyCall]){
   const body={...request,purpose},wire=sign(body),input=frame(body,wire),raw=canonicalJSON(input),data=verify(raw);
   assert.deepEqual(Object.keys(data).sort(),['version','requestOriginalDigest','proofDigest','networkId','owner','keyVersion','executionHeight','purpose','memberCount','memberIndex','signatureVerified','dataOnly','authorized','nativeAdmission','effectRetryAuthorized'].sort());
   assert.equal(data.version,version);assert.equal(data.proofDigest,createHash('sha256').update(wire).digest('hex'));assert.equal(data.requestOriginalDigest,createHash('sha256').update(input.requestRaw).digest('hex'));
   assert.equal(data.networkId,network.chainId);assert.equal(data.owner,network.owner);assert.equal(data.keyVersion,'1');assert.equal(data.executionHeight,H);assert.equal(data.purpose,purpose);assert.equal(data.memberCount,1);assert.equal(data.memberIndex,0);assert.equal(data.signatureVerified,true);assert.equal(data.dataOnly,true);assert.equal(data.authorized,false);assert.equal(data.nativeAdmission,false);assert.equal(data.effectRetryAuthorized,false);
   assert(Object.isFrozen(data));assert.equal(Object.getPrototypeOf(data),Object.prototype);assert(Object.values(data).every(v=>['string','boolean','number'].includes(typeof v)));
  }
  const wire=sign(request),base=frame(request,wire),run=change=>verify(canonicalJSON({...base,...change}));
  assert.throws(()=>verify(canonicalJSON(base),{}),{code:'AUTH_IDENTITY_PROOF_FRAME_ARGUMENTS'});
  assert.throws(()=>run({network:{...network,nativeChainId:6423}}),{code:'AUTH_IDENTITY_PROOF_FRAME_NETWORK'});
  assert.throws(()=>verify(canonicalJSON(base)+' '));assert.throws(()=>verify(canonicalJSON(base).replace('{','{"version":"duplicate",')));
  for(const change of [{extra:true},{version:'other'},{atMs:100},{atMs:'30100'},{purpose:purposes.login},{purpose:'TX-BATCH'},{wireBase64url:base.wireBase64url+'='},{wireBase64url:Buffer.alloc(1200000).toString('base64url')},{expectedRequestRaw:canonicalOriginalAuthIdentityRequest({...request,requestId:'PUBLIC-other'})},{network:{...network,owner:'0x'+'13'.repeat(20)}},{network:{...network,extra:true}},{registration:{...registration,extra:true}}])assert.throws(()=>run(change));
  assert.throws(()=>run({wireBase64url:sign(request,2).toString('base64url')}),{code:'AUTH_IDENTITY_V2_N1_REQUIRED'});
  const corrupt=decodeMember(wire);corrupt.certificate.sigmaB[0]^=1;
  assert.throws(()=>run({wireBase64url:encodeMember(corrupt).toString('base64url')}),{code:'PQ_REGISTERED_MEMBER_SIGNATURE_INVALID'});
  const login={...request,purpose:purposes.login};assert.throws(()=>verify(canonicalJSON(frame(login,sign(login)))),{code:'AUTH_IDENTITY_PROOF_PURPOSE_UNSUPPORTED'});
  const revoked={...registration,policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:(BigInt(H)-1n).toString(),revokedFrom:H,ledgerNonce:'3'}]};
  assert.throws(()=>run({registration:revoked}),{code:'PQ_REGISTERED_KEY_INACTIVE'});
 }finally{for(const batch of batches)discardBatch(batch);destroyKey(key.privateKey);}
});
