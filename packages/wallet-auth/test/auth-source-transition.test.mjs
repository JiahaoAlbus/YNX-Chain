// New Source v2 historical baseline controls: real dual-PQ math, PUBLIC only.
import test from 'node:test';import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,decodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
const {canonical,sha}=await import(new URL('./original-auth-identity-source-verifier.mjs',import.meta.resolve('@ynx-chain/wallet-auth/auth-source-verification')));
import {encodeOriginalAuthSourceStatementV2 as message,canonicalOriginalAuthSourceEnvelopeV2 as envelope,verifyOriginalAuthSourceProfileV2 as profile,verifyOriginalAuthSourceCurrentV2 as current,selectOriginalAuthSourceAlgorithm as dispatch} from '@ynx-chain/wallet-auth/auth-source-verification';

import * as sourceAPI from '@ynx-chain/wallet-auth/auth-source-verification';
test('held historical current authenticates only baseline; fresh current still mandatory',()=>{
 const transition=sourceAPI.verifyOriginalAuthSourceTransitionV2;assert.equal(typeof transition,'function');
 const keys=[keyGen({provider:'portable'}),keyGen({provider:'portable'}),keyGen({provider:'portable'})],batches=[];
 const owners=['0x'+'11'.repeat(20),'0x'+'22'.repeat(20),'0x'+'33'.repeat(20),'0x'+'44'.repeat(20)],networkId='ab'.repeat(32),H='9007199254740993';
 const contract={purpose:'AUTH-IDENTITY-RECEIVE',enrollmentFrame:'PUBLIC-original-enrollment-frame',profileFrame:'PUBLIC-original-profile-frame',currentFrame:'PUBLIC-original-current-frame'};
 const policy={rootDigest:'',enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'de'.repeat(32),signatureContract:contract};
 const row=(who,key=keys[who%3],revision='1',registeredAt='10',activeFrom='11',ledgerNonce='1')=>({algorithmVersion:'YNX-BATCH/v0.1',owner:owners[who],pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex'),revision,registeredAt,activeFrom,ledgerNonce});
 const raw=(who)=>({owner:owners[who],executionHeight:H,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[row(who)]});
 const parse=(who,value)=>parsePQAccountAuthorization(value,{chainId:networkId,nativeChainId:'6423',owner:owners[who]});
 const registrations={root:parse(0,raw(0)),profile:parse(1,raw(1)),current:parse(2,raw(2)),subject:parse(3,raw(3))};
 const roles={enrollment:['AUTH-SOURCE-ENROLLMENT',contract.enrollmentFrame,0],profile:['AUTH-SOURCE-PROFILE',contract.profileFrame,1],current:['AUTH-SOURCE-CURRENT',contract.currentFrame,2]};
 const sign=(role,body,count=1,atHeight=H)=>{const[purpose,frame,k]=roles[role],binding={networkId,owner:owners[k],keyVersion:'1',executionHeight:atHeight},m=Buffer.from(message(role,frame,binding,canonical(body)));const batch=batchSign(keys[k].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:owners[k],purpose},count===1?[m]:[m,Buffer.from('PUBLIC second message not an Auth singleton')]);batches.push(batch.batch);return envelope(role,binding,canonical(body),encodeMember(extract(batch.batch,0)));};
 try{
  const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose:contract.purpose,rootId:'PUBLIC-not-admitted-root',networkId,rootOwner:owners[0]});policy.rootDigest=sha(rootRaw);
  const enrollment={version:2,purpose:contract.purpose,rootId:'PUBLIC-not-admitted-root',rootOwner:owners[0],sourceId:'PUBLIC-source',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'ca'.repeat(32),profileOwner:owners[1],currentOwner:owners[2],endpoint:policy.endpoint,spki:policy.spki,currentStatePath:'/PUBLIC-NOT-A-REAL-STATE',operations:['beginYNX','handleReturn','restore','disconnect'],issuedAtMs:0,expiresAtMs:86400000};
  const enrollmentRaw=sign('enrollment',enrollment);policy.enrollmentDigest=sha(enrollmentRaw);
  const association={account:'PUBLIC-existing-principal-no-role-grant',clientId:'PUBLIC-client',productId:'developer',platform:'macos',applicationId:enrollment.applicationId,deviceId:'PUBLIC-existing-device'};
  const p={version:2,purpose:contract.purpose,sourceId:enrollment.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owners[3],selection:{association,expectedRequest:{service:enrollment.service,productId:'developer',platform:'macos',applicationId:enrollment.applicationId,gatewayOrigin:enrollment.gatewayOrigin,registryDigest:enrollment.registryDigest,operations:enrollment.operations,instanceId:'PUBLIC-instance'},originalHostStatePath:'/PUBLIC-NOT-A-REAL-HOST',originalHostTerminalDirectory:'/PUBLIC-NOT-A-REAL-HOST.private-terminal'},issuedAtMs:0,expiresAtMs:86400000};
  p.selection.originalBusinessPermissions={projects:['PUBLIC-existing-project'],role:'PUBLIC-existing-role-no-new-grant'};
  const profileRaw=sign('profile',p),nonce=Buffer.alloc(32,4).toString('base64url');
  const c={version:2,purpose:contract.purpose,sourceId:enrollment.sourceId,enrollmentDigest:policy.enrollmentDigest,profileDigest:sha(profileRaw),instanceId:p.instanceId,generation:1,subjectOwner:owners[3],subjectKeyVersion:'1',sequence:1,floor:0,head:'cd'.repeat(32),status:'active',nonce,issuedAtMs:100,expiresAtMs:30100};
  const currentRaw=sign('current',c),previous={sequence:0,floor:0,head:'',timeFloor:0};

  const H2=(BigInt(H)+1n).toString();
  const advanced=Object.fromEntries(['root','profile','current','subject'].map((name,i)=>[name,parse(i,{...raw(i),executionHeight:H2})]));
  const held=transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{...previous,executionHeight:H},40000);
  assert.equal(held.historical,true);assert.equal(held.dataOnly,true);assert.equal(held.nativeAdmission,false);
  assert.equal(held.statementExecutionHeight,H);assert.equal(held.executionHeight,H2);
  assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{...previous,executionHeight:H},40000,true),/ARGUMENTS/);
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{...previous,executionHeight:H},40000,false),/ARGUMENTS/);
  assert.equal(held.sequence,1);assert.equal(held.floor,0);assert.equal(held.head,c.head);assert.equal(held.status,'active');
  assert.equal(held.timeFloor,40000);assert.equal(held.expiresAtMs,30100);assert(Object.isFrozen(held));
  assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{...previous,executionHeight:H},40000),/CURRENT_HEIGHT/);
  const freshNonce=Buffer.alloc(32,8).toString('base64url');
  const freshRaw=sign('current',{...c,sequence:2,nonce:freshNonce,issuedAtMs:40000,expiresAtMs:70000},1,H2);
  const result=current(rootRaw,enrollmentRaw,profileRaw,freshRaw,policy,advanced,freshNonce,{sequence:held.sequence,floor:held.floor,head:held.head,timeFloor:held.timeFloor,executionHeight:held.executionHeight},40001);
  assert.equal(result.sequence,2);assert.equal(result.status,'active');assert.equal(result.nativeAdmission,false);
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{sequence:1,floor:0,head:'ee'.repeat(32),timeFloor:0,executionHeight:H},40000),/EQUIVOCATION/);
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{...previous,executionHeight:(BigInt(H2)+1n).toString()},40000),/OBSERVATION_ROLLBACK/);
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,nonce,{...previous,timeFloor:40001,executionHeight:H},40000),/ROLLBACK/);
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,advanced,Buffer.alloc(32,9).toString('base64url'),{...previous,executionHeight:H},40000),/CURRENT/);
  const future=sign('current',c,1,(BigInt(H2)+1n).toString());
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,future,policy,advanced,nonce,{...previous,executionHeight:H},40000),/STATEMENT_HEIGHT/);
  const futureClock=sign('current',{...c,issuedAtMs:50000,expiresAtMs:80000});
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,futureClock,policy,advanced,nonce,{...previous,executionHeight:H},40000),/EXPIRED/);
  const badWindow=sign('current',{...c,expiresAtMs:30101});
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,badWindow,policy,advanced,nonce,{...previous,executionHeight:H},40000),/EXPIRED/);
  for(const status of ['revoked','retired']){
   const raw=sign('current',{...c,status});
   assert.equal(transition(rootRaw,enrollmentRaw,profileRaw,raw,policy,advanced,nonce,{...previous,executionHeight:H},40000).status,status);
   const fresh=sign('current',{...c,status,issuedAtMs:40000,expiresAtMs:70000},1,H2);
   assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,fresh,policy,advanced,nonce,{...previous,executionHeight:H},40001),/REVOKED/);
  }
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,{...advanced,profile:registrations.profile},nonce,{...previous,executionHeight:H},40000),/REGISTRATION/);
  const corrupted=JSON.parse(currentRaw),member=Buffer.from(corrupted.member,'base64url');member[member.length-1]^=1;corrupted.member=member.toString('base64url');
  assert.throws(()=>transition(rootRaw,enrollmentRaw,profileRaw,canonical(corrupted),policy,advanced,nonce,{...previous,executionHeight:H},40000));
 }finally{for(const batch of batches)discardBatch(batch);for(const k of keys)destroyKey(k.privateKey);}
});
