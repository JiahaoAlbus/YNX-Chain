import test from 'node:test';import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {OriginalAuthSourceCurrentV2Kernel,loadReleaseSelectedOriginalSourceV2} from '../src/original-auth-source-current-v2.js';
import {loadOriginalAuthSourceCurrentService,handleOriginalAuthSourceCurrent} from '../src/original-auth-identity-source-current.js';
import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2 as message,canonicalOriginalAuthSourceEnvelopeV2 as envelope,verifyOriginalAuthSourceCurrentV2 as verify} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {parsePQAccountAuthorization} from '../src/pq-wallet-policy.js';
// PUBLIC ephemeral mathematical test keys only. No real Root/key file/service.
const keys=[keyGen({provider:'portable'}),keyGen({provider:'portable'}),keyGen({provider:'portable'})];
const owners=[0,1,2,3].map(i=>'0x'+String(i+1).repeat(40)),networkId='ab'.repeat(32),H='9007199254740993';
const contract={purpose:'AUTH-IDENTITY-RECEIVE',enrollmentFrame:'PUBLIC-issuer',profileFrame:'PUBLIC-profile',currentFrame:'PUBLIC-current'};
const policy={rootDigest:'',enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'de'.repeat(32),signatureContract:contract};
function raw(who,height=H){const key=keys[who%3];return {owner:owners[who],executionHeight:height,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:owners[who],pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex'),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};}
function sign(k,purpose,m){let batch;try{batch=batchSign(keys[k].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:owners[k],purpose},[Buffer.from(m)]).batch;return encodeMember(extract(batch,0));}finally{if(batch)discardBatch(batch);}}
function signed(role,k,frame,body){const b={networkId,owner:owners[k],keyVersion:'1',executionHeight:H};return envelope(role,b,canonical(body),sign(k,'AUTH-SOURCE-'+role.toUpperCase(),message(role,frame,b,canonical(body))));}
const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose:contract.purpose,rootId:'PUBLIC-test-not-admitted',networkId,rootOwner:owners[0]});policy.rootDigest=sha(rootRaw);
const e={version:2,purpose:contract.purpose,rootId:'PUBLIC-test-not-admitted',rootOwner:owners[0],sourceId:'PUBLIC-test',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'ca'.repeat(32),profileOwner:owners[1],currentOwner:owners[2],endpoint:policy.endpoint,spki:policy.spki,currentStatePath:'/PUBLIC-NOT-PROVISIONED/current',operations:['beginYNX','handleReturn','restore','disconnect'],issuedAtMs:0,expiresAtMs:86400000};
const enrollmentRaw=signed('enrollment',0,contract.enrollmentFrame,e);policy.enrollmentDigest=sha(enrollmentRaw);
const p={version:2,purpose:contract.purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owners[3],selection:{association:{account:'PUBLIC-existing-account',clientId:'PUBLIC-client',productId:'developer',platform:'macos',applicationId:e.applicationId,deviceId:'PUBLIC-device'},expectedRequest:{service:e.service,productId:'developer',platform:'macos',applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:e.operations,instanceId:'PUBLIC-instance'},originalHostStatePath:'/PUBLIC-HOST',originalHostTerminalDirectory:'/PUBLIC-HOST.private-terminal'},issuedAtMs:0,expiresAtMs:86400000};
const profileRaw=signed('profile',1,contract.profileFrame,p),digest=sha(profileRaw),state={status:'active',floor:0,head:'cd'.repeat(32)},node={origin:'https://PUBLIC-NOT-CONTACTED.invalid',spki:'ef'.repeat(32),nativeChainId:'6423'};
function fixture(records=new Map()){
 const f={records,time:100,calls:0,signs:0,closes:0,writeFail:false,postAdvance:false,heightDrift:false,closeError:undefined,hasCloseError:false};
 const io={openV2(){return{};},ready(){},list(){return [...records.keys()];},read(_l,n){if(!records.has(n))throw Error('missing');return records.get(n);},write(_l,n,r){if(records.has(n))throw Error('duplicate');records.set(n,r);if(f.writeFail)throw Error('applied-lost');},close(){f.closes++;if(f.hasCloseError)throw f.closeError;}};
 const signer={assertCurrent(){},signCurrent(m,b,v){f.signs++;if(f.signFailure)throw new Error('PUBLIC sign failure');const r=sign(2,'AUTH-SOURCE-CURRENT',m);if(f.postAdvance)f.time+=30000;if(f.heightDrift)f.height=(BigInt(H)+1n).toString();return r;},close(){f.signerClosed=true;}};
 const get=async(_n,o)=>{f.calls++;return raw(owners.indexOf(o),f.height??H);};
 f.kernel=new OriginalAuthSourceCurrentV2Kernel(rootRaw,enrollmentRaw,[profileRaw],policy,node,signer,io,()=>f.time,get);return f;
}
test.after(()=>keys.forEach(k=>destroyKey(k.privateKey)));
test('admin transition signs only the state selected before observation',async()=>{
 const f=fixture(),input={...state};
 try{
  await f.kernel.initialize();
  const inFlight=f.kernel.transition(digest,input);
  input.head='ef'.repeat(32);input.status='revoked';
  Object.defineProperty(input,'getLater',{get(){throw Error('GETTER_AFTER_AWAIT');},enumerable:true});
  await inFlight;
  const event=JSON.parse([...f.records.entries()].find(([k])=>k.endsWith('.entered'))[1]);
  const body=JSON.parse(Buffer.from(JSON.parse(event.currentRaw).body,'base64url'));
  assert.equal(body.head,state.head);assert.equal(body.status,'active');assert.equal(f.signs,1);
 }finally{f.kernel.close();}
});
test('admin transition refuses Proxy before reflection or observation, with first cause retained',async()=>{
 const f=fixture();let traps=0;
 try{
  await f.kernel.initialize();const before=f.calls;
  const proxy=new Proxy({...state},{getPrototypeOf(t){traps++;return Reflect.getPrototypeOf(t);},ownKeys(t){traps++;return Reflect.ownKeys(t);},get(t,k){traps++;return Reflect.get(t,k);}});
  await assert.rejects(f.kernel.transition(digest,proxy),/AUTH_SOURCE_V2_SCHEMA/);
  assert.equal(traps,0);assert.equal(f.calls,before);assert.equal(f.signs,0);
  assert.equal(f.kernel.status().firstCause.code,'AUTH_SOURCE_V2_SCHEMA');
 }finally{f.kernel.close();}
});
test('admin transition refuses a static accessor with zero execution',async()=>{
 const f=fixture();let getters=0;
 try{
  await f.kernel.initialize();const before=f.calls;
  await assert.rejects(f.kernel.transition(digest,{...state,get head(){getters++;return state.head;}}),/AUTH_SOURCE_V2_SCHEMA/);
  assert.equal(getters,0);assert.equal(f.calls,before);assert.equal(f.signs,0);
 }finally{f.kernel.close();}
});
