// Auth R84 fixture reused unchanged below the package import wiring.
// This test checks the newly packed public entry, not actual Native admission.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {keyGen,batchSign,extract,encodeMember,decodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
const {canonical,sha}=await import(new URL('./original-auth-identity-source-verifier.mjs',import.meta.resolve('@ynx-chain/wallet-auth/auth-source-verification')));
import {encodeOriginalAuthSourceStatementV2 as message,canonicalOriginalAuthSourceEnvelopeV2 as envelope,verifyOriginalAuthSourceProfileV2 as profile,verifyOriginalAuthSourceCurrentV2 as current,selectOriginalAuthSourceAlgorithm as dispatch} from '@ynx-chain/wallet-auth/auth-source-verification';

test('new Source v2 graph uses real three-role registered dual signatures; PUBLIC DATA not admitted Native',()=>{
 const keys=[keyGen({provider:'portable'}),keyGen({provider:'portable'}),keyGen({provider:'portable'})],batches=[];
 const owners=['0x'+'11'.repeat(20),'0x'+'22'.repeat(20),'0x'+'33'.repeat(20),'0x'+'44'.repeat(20)],networkId='ab'.repeat(32),H='9007199254740993';
 const contract={purpose:'AUTH-IDENTITY-RECEIVE',enrollmentFrame:'PUBLIC-original-enrollment-frame',profileFrame:'PUBLIC-original-profile-frame',currentFrame:'PUBLIC-original-current-frame'};
 const policy={rootDigest:'',enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'de'.repeat(32),signatureContract:contract};
 const row=(who,key=keys[who%3],revision='1',registeredAt='10',activeFrom='11',ledgerNonce='1')=>({algorithmVersion:'YNX-BATCH/v0.1',owner:owners[who],pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex'),revision,registeredAt,activeFrom,ledgerNonce});
 const raw=(who)=>({owner:owners[who],executionHeight:H,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[row(who)]});
 const parse=(who,value)=>parsePQAccountAuthorization(value,{chainId:networkId,nativeChainId:'6423',owner:owners[who]});
 const registrations={root:parse(0,raw(0)),profile:parse(1,raw(1)),current:parse(2,raw(2)),subject:parse(3,raw(3))};
 const roles={enrollment:['AUTH-SOURCE-ENROLLMENT',contract.enrollmentFrame,0],profile:['AUTH-SOURCE-PROFILE',contract.profileFrame,1],current:['AUTH-SOURCE-CURRENT',contract.currentFrame,2]};
 const sign=(role,body,count=1)=>{const[purpose,frame,k]=roles[role],binding={networkId,owner:owners[k],keyVersion:'1',executionHeight:H},m=Buffer.from(message(role,frame,binding,canonical(body)));const batch=batchSign(keys[k].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:owners[k],purpose},count===1?[m]:[m,Buffer.from('PUBLIC second message not an Auth singleton')]);batches.push(batch.batch);return envelope(role,binding,canonical(body),encodeMember(extract(batch.batch,0)));};
 try{
  const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose:contract.purpose,rootId:'PUBLIC-not-admitted-root',networkId,rootOwner:owners[0]});policy.rootDigest=sha(rootRaw);
  const enrollment={version:2,purpose:contract.purpose,rootId:'PUBLIC-not-admitted-root',rootOwner:owners[0],sourceId:'PUBLIC-source',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'ca'.repeat(32),profileOwner:owners[1],currentOwner:owners[2],endpoint:policy.endpoint,spki:policy.spki,currentStatePath:'/PUBLIC-NOT-A-REAL-STATE',operations:['beginYNX','handleReturn','restore','disconnect'],issuedAtMs:0,expiresAtMs:86400000};
  const enrollmentRaw=sign('enrollment',enrollment);policy.enrollmentDigest=sha(enrollmentRaw);
  const association={account:'PUBLIC-existing-principal-no-role-grant',clientId:'PUBLIC-client',productId:'developer',platform:'macos',applicationId:enrollment.applicationId,deviceId:'PUBLIC-existing-device'};
  const p={version:2,purpose:contract.purpose,sourceId:enrollment.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owners[3],selection:{association,expectedRequest:{service:enrollment.service,productId:'developer',platform:'macos',applicationId:enrollment.applicationId,gatewayOrigin:enrollment.gatewayOrigin,registryDigest:enrollment.registryDigest,operations:enrollment.operations,instanceId:'PUBLIC-instance'},originalHostStatePath:'/PUBLIC-NOT-A-REAL-HOST',originalHostTerminalDirectory:'/PUBLIC-NOT-A-REAL-HOST.private-terminal'},issuedAtMs:0,expiresAtMs:86400000};
  p.selection.originalBusinessPermissions={projects:['PUBLIC-existing-project'],role:'PUBLIC-existing-role-no-new-grant'};
  const profileRaw=sign('profile',p),nonce=Buffer.alloc(32,4).toString('base64url');
  const c={version:2,purpose:contract.purpose,sourceId:enrollment.sourceId,enrollmentDigest:policy.enrollmentDigest,profileDigest:sha(profileRaw),instanceId:p.instanceId,generation:1,subjectOwner:owners[3],subjectKeyVersion:'1',sequence:1,floor:0,head:'cd'.repeat(32),status:'active',nonce,issuedAtMs:100,expiresAtMs:30100};
  const currentRaw=sign('current',c),previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'};
  const verified=current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,nonce,previous,200);
  assert.equal(verified.principalId,association.account);assert.equal(verified.subjectOwner,owners[3]);assert.equal(verified.executionHeight,H);assert.equal(verified.subjectKeyVersion,'1');assert.equal(verified.nativeAdmission,false);assert(Object.isFrozen(verified.selection.association));
  assert.deepEqual(verified.selection.originalBusinessPermissions,p.selection.originalBusinessPermissions);assert(Object.isFrozen(verified.selection.originalBusinessPermissions.projects));
  assert.throws(()=>profile(rootRaw,enrollmentRaw,profileRaw,{...policy,rootDigest:'00'.repeat(32)},registrations,200),/NOT_PINNED/);
  assert.throws(()=>profile(rootRaw,enrollmentRaw,profileRaw,policy,{...registrations,profile:registrations.subject},200));
  const alias=parse(2,{...raw(2),records:[row(2,keys[0])]});assert.throws(()=>profile(rootRaw,enrollmentRaw,profileRaw,policy,{...registrations,current:alias},200),/KEYS_NOT_DISTINCT/);
  for(const field of ['sigmaA','sigmaB']){const env=JSON.parse(profileRaw),wire=decodeMember(Buffer.from(env.member,'base64url'));wire.certificate[field][0]^=1;env.member=encodeMember(wire).toString('base64url');assert.throws(()=>profile(rootRaw,enrollmentRaw,canonical(env),policy,registrations,200),/SIGNATURE_INVALID/);}
  const n2=sign('profile',p,2);assert.throws(()=>profile(rootRaw,enrollmentRaw,n2,policy,registrations,200),/N1_REQUIRED/);
  assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,Buffer.alloc(32,8).toString('base64url'),previous,200),/CURRENT/);
  assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,nonce,{...previous,timeFloor:201},200),/ROLLBACK/);
  assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,nonce,previous,30100),/EXPIRED/);
  const rotated=parse(3,{...raw(3),activeRevision:'2',records:[row(3),row(3,keys[1],'2','20','21','2')]});assert.throws(()=>current(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,{...registrations,subject:rotated},nonce,previous,200),/CURRENT/);
  assert.throws(()=>dispatch(registrations.subject,1),/LEGACY_ENTRY_REFUSED/);assert.equal(dispatch(registrations.subject,2).algorithmVersion,'YNX-BATCH/v0.1');
  const before={...raw(3),executionHeight:'10',algorithmVersion:'legacy'};delete before.activeRevision;const legacy=parse(3,before);assert.equal(dispatch(legacy,1).algorithmVersion,'ed25519');assert.throws(()=>dispatch(legacy,2),/MIGRATION_REQUIRED/);
  const revoked=parse(3,{...raw(3),executionHeight:'26',policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:owners[3],authorizingRevision:'1',throughRevision:'1',registeredAt:'25',revokedFrom:'26',ledgerNonce:'3'}]});for(const v of [1,2])assert.throws(()=>dispatch(revoked,v),/REVOKED/);
  assert.throws(()=>profile(rootRaw,enrollmentRaw,profileRaw,policy,{...registrations,subject:{...registrations.subject}},200),/SNAPSHOT_REQUIRED/);
 }finally{for(const batch of batches)discardBatch(batch);for(const k of keys)destroyKey(k.privateKey);}
});

test('Source verification public export rejects browser resolution',()=>{
 const r=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',"try {await import('@ynx-chain/wallet-auth/auth-source-verification');process.exit(1);} catch(e) {if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw e;}"],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
