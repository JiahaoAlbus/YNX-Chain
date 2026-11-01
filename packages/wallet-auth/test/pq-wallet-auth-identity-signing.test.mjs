// PUBLIC synthetic registrations and ephemeral test keys only. These checks
// establish crypto DATA, never actual Source, approval or Native qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeMember} from '@ynx/batch-v01-candidate';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletAuthIdentityRequest} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {parsePQAccountAuthorization} from '../src/pq-wallet-policy.js';
import {canonicalOriginalAuthIdentityRequest,encodeOriginalAuthIdentityRequest,AUTH_IDENTITY_PURPOSES as purposes} from '../native/original-auth-identity-v2-contract.mjs';
import {verifyOriginalAuthIdentityMemberData} from '../src/auth-identity-verification.js';

test('typed Auth producer signs exact R82 N1 E with current registered opaque full pair; no login/raw signing',async()=>{
 const network={chainId:'ab'.repeat(32),nativeChainId:'6423',owner:'0x'+'12'.repeat(20)},handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner}),other=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle)),otherKeys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(other));
  const H='9007199254740993';
  const row=(pair=keys,revision='1',registeredAt='10',activeFrom='11',ledgerNonce='1')=>({algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA,pkB:pair.pkB,revision,registeredAt,activeFrom,ledgerNonce});
  const dto=()=>({owner:network.owner,executionHeight:H,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[row()]});
  const parse=value=>parsePQAccountAuthorization(value,network),snapshot=parse(dto());
  const request={version:'YNX-AUTH-IDENTITY/v2',algorithmVersion:'YNX-BATCH/v0.1',networkId:network.chainId,owner:network.owner,keyVersion:'1',executionHeight:H,principalId:'PUBLIC-original-principal',productId:'developer',applicationId:'com.ynx.developer',deviceId:'PUBLIC-device',requestId:'PUBLIC-request',purpose:purposes.receive,requestDigest:'ab'.repeat(32),credentialDigest:'cd'.repeat(32),nonce:Buffer.alloc(32,1).toString('base64url'),issuedAtMs:'100',expiresAtMs:'30100'};
  const raw=changes=>canonicalOriginalAuthIdentityRequest({...request,...changes});
  for(const purpose of [purposes.receive,purposes.recover,purposes.keyCall]){
   const original=raw({purpose}),wire=signPQWalletAuthIdentityRequest(handle,original,snapshot,'100'),decoded=decodeMember(Buffer.from(wire));
   assert(wire instanceof Uint8Array);assert.equal(decoded.certificate.N,1);assert.equal(decoded.index,0);assert.equal(decoded.certificate.purpose,purpose);
   assert.deepEqual(decoded.message,Buffer.from(encodeOriginalAuthIdentityRequest({...request,purpose})));
   const verified=verifyOriginalAuthIdentityMemberData(snapshot,wire,original,original,purpose,'100');
   assert.equal(verified.verification.signatureVerified,true);assert.equal(verified.authorized,false);assert.equal(verified.dataOnly,true);
  }
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw({purpose:purposes.login}),snapshot,'100'),{code:'PQ_AUTH_IDENTITY_PURPOSE_UNSUPPORTED'});
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw()+' ',snapshot,'100'),{code:'AUTH_IDENTITY_V2_CANONICAL'});
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,'arbitrary raw message',snapshot,'100'));
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),snapshot,'30100'),{code:'AUTH_IDENTITY_V2_EXPIRED'});
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),snapshot,100),{code:'AUTH_IDENTITY_V2_DECIMAL'});
  for(const changes of [{owner:'0x'+'13'.repeat(20)},{networkId:'ac'.repeat(32)},{executionHeight:'9007199254740992'},{keyVersion:'2'}])assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(changes),snapshot,'100'));
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),{...snapshot},'100'),{code:'PQ_POLICY_SNAPSHOT_REQUIRED'});
  assert.throws(()=>signPQWalletAuthIdentityRequest(other,raw(),snapshot,'100'),{code:'PQ_BINDING_MISMATCH'});
  for(const pair of [{pkA:otherKeys.pkA,pkB:keys.pkB},{pkA:keys.pkA,pkB:otherKeys.pkB}])assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),parse({...dto(),records:[row(pair)]}),'100'),{code:'PQ_BINDING_MISMATCH'});
  const rotated=parse({...dto(),activeRevision:'2',records:[row(),row(otherKeys,'2','20','21','2')]});
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),rotated,'100'),{code:'PQ_REGISTERED_KEY_VERSION_MISMATCH'});
  const pendingDTO={...dto(),executionHeight:'10',algorithmVersion:'legacy'};delete pendingDTO.activeRevision;
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw({executionHeight:'10'}),parse(pendingDTO),'100'),{code:'PQ_REGISTERED_KEY_INACTIVE'});
  const revoked=parse({...dto(),policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:(BigInt(H)-1n).toString(),revokedFrom:H,ledgerNonce:'3'}]});
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),revoked,'100'),{code:'PQ_REGISTERED_KEY_INACTIVE'});
  assert.throws(()=>signPQWalletAuthIdentityRequest({},raw(),snapshot,'100'),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
  destroyPQWalletKeyHandle(handle);
  assert.throws(()=>signPQWalletAuthIdentityRequest(handle,raw(),snapshot,'100'),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
 }finally{destroyPQWalletKeyHandle(handle);destroyPQWalletKeyHandle(other);}
});
