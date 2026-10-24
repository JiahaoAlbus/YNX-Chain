import test from 'node:test';import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {parsePQAccountAuthorization} from './src/pq-wallet-policy.js';
import {canonical,sha} from './native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2 as message,canonicalOriginalAuthSourceEnvelopeV2 as envelope,verifyOriginalAuthSourceCurrentV2 as current,verifyOriginalAuthSourceProfileV2 as profile} from './native/original-auth-identity-source-v2-verifier.mjs';
import {PQ_HOST_CATALOG_SOURCE_PURPOSE as purpose,PQ_HOST_CATALOG_SOURCE_OPERATIONS as operations} from './native/original-pq-host-catalog-source-contract.mjs';
import {dispatchOriginalSourceV2} from './native/original-auth-source-v2-dispatch.mjs';
test('dedicated policy extension cannot widen legacy purpose or add arbitrary fields',async()=>{
 let touched=0;const get=async()=>{touched++;throw Error('PUBLIC never GET');};
 const input={operation:'auth-source-v2-native-node/v1',node:{origin:'https://PUBLIC.invalid',spki:'a'.repeat(64),nativeChainId:'6423'},rootRaw:'PUBLIC-not-a-root',enrollmentRaw:'PUBLIC-not-an-enrollment',profileRaw:'',headRaw:'',previous:{},policy:{rootDigest:'',enrollmentDigest:'',endpoint:'',spki:'',applicationId:'com.PUBLIC.fixture.wallet',signatureContract:{purpose:'AUTH-IDENTITY-RECEIVE',enrollmentFrame:'PUBLIC-e',profileFrame:'PUBLIC-p',currentFrame:'PUBLIC-c'}}};
 await assert.rejects(dispatchOriginalSourceV2(input,get,get),/DISPATCH_SCHEMA/);
 input.policy.signatureContract.purpose='caller-arbitrary-purpose';await assert.rejects(dispatchOriginalSourceV2(input,get,get),/DISPATCH_SCHEMA/);assert.equal(touched,0);
});
test('actual dedicated Source dispatcher reaches original N1 before/after registrations and returns DATA',async t=>{
 t.mock.method(Date,'now',()=>200);
 const keys=[0,1,2].map(()=>keyGen({provider:'portable'})),batches=[];
 const owners=[1,2,3,4].map(n=>'0x'+String(n).repeat(40)),networkId='ab'.repeat(32),height='100';
 const contract={purpose,enrollmentFrame:'PUBLIC-PQ-CATALOG-enrollment',profileFrame:'PUBLIC-PQ-CATALOG-profile',currentFrame:'PUBLIC-PQ-CATALOG-current'};
 const policy={rootDigest:'',enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'de'.repeat(32),signatureContract:contract,applicationId:'com.PUBLIC.fixture.wallet'};
 const dto=i=>({owner:owners[i],executionHeight:height,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:owners[i],pkA:keys[i%3].publicKey.pkA.toString('hex'),pkB:keys[i%3].publicKey.pkB.toString('hex'),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]});
 const roleIndex={enrollment:0,profile:1,current:2};
 const sign=(role,body)=>{const i=roleIndex[role],binding={networkId,owner:owners[i],keyVersion:'1',executionHeight:height};const batch=batchSign(keys[i].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:owners[i],purpose:{enrollment:'AUTH-SOURCE-ENROLLMENT',profile:'AUTH-SOURCE-PROFILE',current:'AUTH-SOURCE-CURRENT'}[role]},[Buffer.from(message(role,contract[role+'Frame'],binding,canonical(body)))]);batches.push(batch.batch);return envelope(role,binding,canonical(body),encodeMember(extract(batch.batch,0)));};
 try{
  const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-NOT-ADMITTED-PQ-root',networkId,rootOwner:owners[0]});policy.rootDigest=sha(rootRaw);
  const e={version:2,purpose,rootId:'PUBLIC-NOT-ADMITTED-PQ-root',rootOwner:owners[0],sourceId:'PUBLIC-PQ-source',service:purpose,productId:'wallet',platform:'macos',applicationId:policy.applicationId,gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'ca'.repeat(32),profileOwner:owners[1],currentOwner:owners[2],endpoint:policy.endpoint,spki:policy.spki,currentStatePath:'/PUBLIC-NOT-DEPLOYED/current',operations:[...operations],issuedAtMs:0,expiresAtMs:60000};
  const enrollmentRaw=sign('enrollment',e);policy.enrollmentDigest=sha(enrollmentRaw);
  const scope={version:'YNX-PQ-HOST-CATALOG-SOURCE/v1',journalBinding:{operationId:'PUBLIC-operation',account:'PUBLIC-account',networkId,originalHash:'a'.repeat(64),nativeWireHash:'b'.repeat(64),transactionHash:'c'.repeat(64)},deliveryManifestPath:'/PUBLIC/manifest',deliveryManifestSHA256:'d'.repeat(64),bindingPath:'/PUBLIC/binding',bindingSHA256:'e'.repeat(64),outputPath:'/PUBLIC/catalog',attemptPath:'/PUBLIC/catalog.source-attempt',resultPath:'/PUBLIC/catalog.source-result',protocolImagePath:'/PUBLIC/ynx-comet',protocolImageSHA256:'f'.repeat(64),protocolSourceRevision:'a'.repeat(40),protocolWalletRequestContract:'YNX-PQ-HOST-CATALOG-WALLET-JOURNAL6/v1',protocolReconcileContract:'',walletCodeIdentity:Buffer.alloc(32,1).toString('base64'),issuedAtMs:0,expiresAtMs:30000};
  const p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-PQ-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owners[3],selection:{association:{account:'PUBLIC-account',clientId:'PUBLIC-client',productId:'wallet',platform:'macos',applicationId:e.applicationId,deviceId:'PUBLIC-device'},expectedRequest:{service:purpose,productId:'wallet',platform:'macos',applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:[...operations],instanceId:'PUBLIC-PQ-instance'},originalHostStatePath:'/PUBLIC/host',originalHostTerminalDirectory:'/PUBLIC/host.private-terminal',pqHostCatalogSource:scope},issuedAtMs:0,expiresAtMs:60000};
  const profileRaw=sign('profile',p),nonce=Buffer.alloc(32,4).toString('base64url');
  const c={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,profileDigest:sha(profileRaw),instanceId:p.instanceId,generation:1,subjectOwner:owners[3],subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonical(scope)),status:'active',nonce,issuedAtMs:100,expiresAtMs:30100};
  const previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'};
  c.expiresAtMs=29000;const headRaw=sign('current',c),input={operation:'auth-source-v2-native-node/v1',node:{origin:'https://PUBLIC.invalid',spki:'a'.repeat(64),nativeChainId:'6423'},rootRaw,enrollmentRaw,profileRaw,headRaw,policy,previous};
  let reads=0,fetches=0;const get=async(_node,owner)=>{reads++;return dto(owners.indexOf(owner));};
  const fetch=async(endpoint,spki,digest,actualNonce)=>{fetches++;assert.equal(endpoint,policy.endpoint);assert.equal(spki,policy.spki);assert.equal(digest,sha(profileRaw));return sign('current',{...c,nonce:actualNonce});};
  const result=await dispatchOriginalSourceV2(input,get,fetch);assert.equal(reads,8);assert.equal(fetches,1);assert.equal(result.projection.nativeAdmission,false);assert.equal(result.projection.dataOnly,true);assert.equal(result.projection.selection.pqHostCatalogSource.protocolImageSHA256,'f'.repeat(64));
  reads=fetches=0;await assert.rejects(dispatchOriginalSourceV2({...input,policy:{...policy,arbitraryEndpoint:'https://wrong.invalid'}},get,fetch),/DISPATCH_SCHEMA/);assert.equal(reads+fetches,0);
  await assert.rejects(dispatchOriginalSourceV2({...input,policy:{...policy,applicationId:'com.foreign.wallet'}},get,fetch),/ENROLLMENT/);
  let time=200;t.mock.method(Date,'now',()=>time);reads=0;const expire=async(n,o)=>{const result=await get(n,o);if(reads===8)time=30000;return result;};await assert.rejects(dispatchOriginalSourceV2(input,expire,fetch),/POST_CURRENT_EXPIRED/);
 }finally{for(const b of batches)discardBatch(b);for(const k of keys)destroyKey(k.privateKey);}
});
