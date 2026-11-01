import test from 'node:test';
import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {AUTH_IDENTITY_PURPOSES as purpose,canonicalOriginalAuthIdentityRequest as raw,encodeOriginalAuthIdentityRequest as encode} from '@ynx-chain/wallet-auth/auth-identity-contract';
import {verifyOriginalAuthIdentityMemberData as verify,verifyOriginalAuthIdentityRecoveryData as recover} from '@ynx-chain/wallet-auth/auth-identity-verification';
import {parsePQAccountAuthorization,pqRegisteredPublicBinding} from '@ynx-chain/wallet-auth/pq-wallet-policy';

// Real cross-layer signatures with PUBLIC synthetic originals/ephemeral keys.
// No real Native receiver, credential, recovery permission or key borrow.
test('Auth R82 exact request feeds the shared dual verifier without granting authority',()=>{
 const key=keyGen({provider:'portable'}),network={chainId:'ac'.repeat(32),nativeChainId:'6423',owner:'0x'+'14'.repeat(20)};
 const dto={owner:network.owner,executionHeight:'9007199254740993',ledgerNonce:'2',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1',pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex')}]};
 const snapshot=parsePQAccountAuthorization(dto,network),binding=pqRegisteredPublicBinding(snapshot);
 const body={version:'YNX-AUTH-IDENTITY/v2',algorithmVersion:'YNX-BATCH/v0.1',networkId:network.chainId,owner:network.owner,keyVersion:'1',executionHeight:dto.executionHeight,principalId:'PUBLIC-original-principal',productId:'developer',applicationId:'com.ynx.developer',deviceId:'PUBLIC-device',requestId:'PUBLIC-request',purpose:purpose.receive,requestDigest:'ab'.repeat(32),credentialDigest:'cd'.repeat(32),nonce:Buffer.alloc(32,1).toString('base64url'),issuedAtMs:'100',expiresAtMs:'30100'};
 const sign=(value,N=1)=>{
  const b=batchSign(key.privateKey,{chainId:Buffer.from(network.chainId,'hex'),owner:network.owner,purpose:value.purpose},Array.from({length:N},()=>Buffer.from(encode(value))));
  try{return encodeMember(extract(b.batch,0));}finally{discardBatch(b.batch);}
 };
 try{
  const originalRaw=raw(body),wire=sign(body);
  for(const p of [purpose.receive,purpose.keyCall]){
   const request={...body,purpose:p},requestRaw=raw(request),proof=p===purpose.receive?wire:sign(request);
   const data=verify(snapshot,proof,requestRaw,requestRaw,p,'100');
   assert.equal(data.authorized,false);assert.equal(data.dataOnly,true);assert.equal(data.verification.signatureVerified,true);assert.equal(data.verification.nativeAdmission,false);assert.equal(data.body.principalId,body.principalId);
   assert.equal('invoke' in data,false);assert.equal('privateKey' in data,false);
  }
  const recovery={...body,purpose:purpose.recover,requestId:'PUBLIC-recovery'},recoveryRaw=raw(recovery),recoveryWire=sign(recovery);
  const data=recover(snapshot,recoveryWire,binding,originalRaw,recoveryRaw,recoveryRaw,'100');
  assert.equal(data.authorized,false);assert.equal(data.continuity.principalId,body.principalId);assert.equal(data.registered.keyVersion,'1');
  assert.throws(()=>recover(snapshot,recoveryWire,{...binding,pkB:Buffer.alloc(64).toString('base64url')},originalRaw,recoveryRaw,recoveryRaw,'100'),{code:'PQ_BINDING_MISMATCH'});
  assert.throws(()=>recover(snapshot,recoveryWire,binding,raw({...body,principalId:'another-principal'}),recoveryRaw,recoveryRaw,'100'),{code:'AUTH_IDENTITY_V2_IDENTITY_CHANGED'});
  const loginRaw=raw({...body,purpose:purpose.login});
  for(const p of [purpose.receive,purpose.recover,purpose.keyCall])assert.throws(()=>verify(snapshot,wire,loginRaw,loginRaw,p,'100'),{code:'AUTH_IDENTITY_V2_PURPOSE'});
  assert.throws(()=>verify(snapshot,wire,raw({...body,credentialDigest:'ef'.repeat(32)}),originalRaw,purpose.receive,'100'),{code:'AUTH_IDENTITY_V2_REQUEST_MISMATCH'});
  assert.throws(()=>verify(snapshot,wire,originalRaw,originalRaw,purpose.receive,'30100'),{code:'AUTH_IDENTITY_V2_EXPIRED'});
  assert.throws(()=>verify(snapshot,sign(body,2),originalRaw,originalRaw,purpose.receive,'100'),{code:'AUTH_IDENTITY_V2_N1_REQUIRED'});
  const revoked=parsePQAccountAuthorization({...dto,policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'25',revokedFrom:'26',ledgerNonce:'2'}]},network);
  assert.throws(()=>recover(revoked,recoveryWire,binding,originalRaw,recoveryRaw,recoveryRaw,'100'),{code:'PQ_REGISTERED_KEY_INACTIVE'});
 }finally{destroyKey(key.privateKey);}
});
