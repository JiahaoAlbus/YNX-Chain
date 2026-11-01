import test from 'node:test';import assert from 'node:assert/strict';
import registry from '../product-session-registry.json' with {type:'json'};
import {canonicalJSON} from '../src/canonical.js';import {ynxAddressFromEVM} from '../src/crypto.js';
import {createProductSessionRequest,productSessionRequestDigest,productSessionApprovalDigest} from '../src/product-session-v2.js';import {productPlatformBinding} from '../src/product-session-registry.js';import {PQ_SUITE} from '../src/pq-wallet-contract.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '../src/product-session-device-registration-v4.js';
import {encodeProductSessionHTTPProofV4Message,encodeProductSessionProofHeaderV4} from '../src/product-session-proof-v4.js';
import {keyGen,batchSign,extract,encodeMember,destroyKey,discardBatch} from '@ynx/batch-v01-candidate';
import {createHash} from 'node:crypto';
import * as m from '../src/product-session-management-v4.js';
const sha=b=>createHash('sha256').update(b).digest('hex'),owner='0x'+'11'.repeat(20),account=ynxAddressFromEVM(owner),network='aa'.repeat(32),at=new Date('2026-10-31T12:00:00.000Z'),binding=productPlatformBinding(registry,'developer','macos');
function fixture(pkA='33'.repeat(2592),pkB='44'.repeat(64)){
 const record={version:'4',registrationId:'11111111-1111-4111-8111-111111111111',networkId:network,canonicalOwner:owner,...Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'].map(k=>[k,binding[k]])),deviceId:'PUBLIC-management-device',generation:'1',revision:'1',pkA,pkB,registeredAt:new Date(+at-1000).toISOString(),expiresAt:new Date(+at+60000).toISOString(),revokedAt:null};
 const registrationOriginal=canonicalJSON(record),{registrationDigest}=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registrationOriginal));
 const request=createProductSessionRequest(registry,{productId:'developer',platform:'macos',deviceId:record.deviceId,deviceAlgorithm:PQ_SUITE,deviceRegistrationId:record.registrationId,deviceRegistrationRevision:'1',deviceRegistrationDigest:registrationDigest,scopes:[binding.scopes[0]],purpose:'PUBLIC management DATA only',nonce:'N'.repeat(32),state:'S'.repeat(32)},at);
 return {request,registrationOriginal,account};
}
const f=fixture(),bodies={active:{...f,sessionBinding:'ab'.repeat(32)},recover:{...f,operationId:'PUBLIC-original-operation'},revoke:{...f,operationId:'PUBLIC-revoke-operation',sessionBinding:null},cancel:{...f,operationId:'PUBLIC-cancel-operation',challengeId:'C'.repeat(32)}};
function target(body){
 const {purpose,...r}=body.request,auth={policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',networkId:network,canonicalOwner:owner,revision:'1',registeredAt:'2',activeFrom:'3',pkA:'55'.repeat(2592),pkB:'66'.repeat(64)},requestDigest=productSessionRequestDigest(registry,body.request,at);
 const approval={...r,result:'approved',requestDigest,account,accountAuthorization:auth},challenge={...r,account,accountAuthorization:auth,challenge:'C'.repeat(32),requestDigest,approvalDigest:productSessionApprovalDigest(approval),expiresAt:new Date(+at+30000).toISOString(),sessionExpiresAt:body.request.expiresAt};
 return {kind:'completion',operationId:body.operationId,approvalOriginal:canonicalJSON(approval),challengeOriginal:canonicalJSON(challenge)};
}
const recoveryTarget=target(bodies.recover);
const invalid=fn=>assert.throws(fn);
test('new four fixed routes preserve exact issuer body and historical DATA roundtrip',()=>{for(const [op,body]of Object.entries(bodies)){const d=m.encodeProductSessionManagementV4RequestDATA(registry,op,body,op==='recover'?recoveryTarget:undefined),r=m.decodeProductSessionManagementV4RequestDATA(registry,op,d.bodyOriginal,op==='recover'?recoveryTarget:undefined);assert.equal(r.path,m.PRODUCT_SESSION_MANAGEMENT_V4_ROUTES[op]);assert.equal(r.bodyDigest,sha(d.bodyOriginal));assert.equal(r.method,'POST');assert.equal(r.SourceAdmission,false);assert.equal(r.signatureVerified,false);assert.equal(Buffer.from(r.bodyOriginal).toString(),canonicalJSON(body));}});
test('new strict body rejects extra/missing/cross account/product/registration and unknown op',()=>{
 for(const patch of [{approved:true},{account:ynxAddressFromEVM('0x'+'22'.repeat(20))},{sessionBinding:null},{request:{...f.request,deviceId:'PUBLIC-foreign-device'}},{registrationOriginal:f.registrationOriginal+' '}])invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'active',{...bodies.active,...patch}));
 const missing={...bodies.cancel};delete missing.challengeId;invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'cancel',missing));invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'restore',bodies.active));
});
test('new canonical original rejects duplicate/unknown/UTF8/whitespace/overcap',()=>{
 const good=canonicalJSON(bodies.active);for(const raw of [good+' ',good.replace('{','{"account":"foreign",'),'{"__proto__":{},'+good.slice(1)])invalid(()=>m.decodeProductSessionManagementV4RequestDATA(registry,'active',Buffer.from(raw)));
 invalid(()=>m.decodeProductSessionManagementV4RequestDATA(registry,'active',new Uint8Array([255])));invalid(()=>m.decodeProductSessionManagementV4RequestDATA(registry,'active',new Uint8Array(393217)));
});
test('new input isolation never calls getters/proxy/array iterator or own buffer spoof',()=>{
 let calls=0;const getter={...bodies.active};Object.defineProperty(getter,'account',{enumerable:true,get(){calls++;return account;}});invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'active',getter));
 const proxy=new Proxy(bodies.active,{ownKeys(){calls++;return[]}});invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'active',proxy));
 const scopes=[f.request.scopes[0]];scopes.length=2;Object.defineProperty(scopes,Symbol.iterator,{value(){calls++;throw false}});invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'active',{...bodies.active,request:{...f.request,scopes}}));
 const sab=new Uint8Array(new SharedArrayBuffer(8));Object.defineProperty(sab,'buffer',{get(){calls++;return new ArrayBuffer(8)}});invalid(()=>m.decodeProductSessionManagementV4RequestDATA(registry,'active',sab));
 const d=m.encodeProductSessionManagementV4RequestDATA(registry,'active',bodies.active),raw=new Uint8Array(d.bodyOriginal);Object.defineProperty(raw,Symbol.iterator,{value(){calls++;throw false}});m.decodeProductSessionManagementV4RequestDATA(registry,'active',raw);
 const detached=new Uint8Array([1]);structuredClone(detached,{transfer:[detached.buffer]});invalid(()=>m.decodeProductSessionManagementV4RequestDATA(registry,'active',detached));assert.equal(calls,0);
});
test('new recovery correlates only SAME original operation and actual body SHA; no retry',()=>{
 const d=m.encodeProductSessionManagementV4RequestDATA(registry,'recover',bodies.recover,recoveryTarget),original=Buffer.from('PUBLIC original business body'),selected={operationId:bodies.recover.operationId,originalBodyDigest:sha(original),originalBodyOriginal:original};
 const r=m.assertProductSessionManagementV4RecoveryDATA(d,selected);assert.equal(r.queryOnly,true);assert.equal(r.retryAuthorized,false);
 invalid(()=>m.assertProductSessionManagementV4RecoveryDATA(d,{...selected,operationId:'PUBLIC-foreign-operation'}));invalid(()=>m.assertProductSessionManagementV4RecoveryDATA(d,{...selected,originalBodyOriginal:Buffer.from('changed')}));
});
const selection={operation:'recover',operationId:bodies.recover.operationId,requestBodyDigest:m.encodeProductSessionManagementV4RequestDATA(registry,'recover',bodies.recover,recoveryTarget).bodyDigest,originalRequestBodyDigest:'cd'.repeat(32)};
const response={version:'4',...selection,state:'OBSERVED',original:'PUBLIC original committed result, DATA only',code:null};
test('new response exact8 roundtrip preserves original without DB projection or authority',()=>{
 const raw=m.encodeProductSessionManagementV4ResponseDATA(response,selection),d=m.decodeProductSessionManagementV4ResponseDATA(raw,selection);assert.equal(Object.keys(d.response).length,8);assert.deepEqual(d.responseOriginal,raw);assert.equal(d.executionVerified,false);assert.equal(d.authorized,false);assert.equal(d.signatureVerified,false);
});
test('new UNKNOWN and REJECTED never imply absence or permit replay; missing original digest only unresolved',()=>{for(const state of ['UNKNOWN','REJECTED']){const v={...response,state,original:null,originalRequestBodyDigest:null,code:'PAIR_V4_ORIGINAL_NOT_FOUND'},d=m.decodeProductSessionManagementV4ResponseDATA(m.encodeProductSessionManagementV4ResponseDATA(v,selection),selection);assert.equal(d.retryAuthorized,false);assert.equal(d.response.state,state);}});
test('new response rejects wrong original/query digest/op/ref/state/extra/trailing/cap',()=>{
 for(const patch of [{originalRequestBodyDigest:'00'.repeat(32)},{requestBodyDigest:'00'.repeat(32)},{operationId:'PUBLIC-other-operation'},{state:'COMMITTED'},{record:{}},{originalRequestBodyDigest:null},{code:'APPROVED'}])invalid(()=>m.encodeProductSessionManagementV4ResponseDATA({...response,...patch},selection));
 const raw=m.encodeProductSessionManagementV4ResponseDATA(response,selection);invalid(()=>m.decodeProductSessionManagementV4ResponseDATA(Buffer.concat([raw,Buffer.from(' ')]),selection));invalid(()=>m.decodeProductSessionManagementV4ResponseDATA(new Uint8Array(393217),selection));
});
test('new existing V4 N1 full-AND proof binds exact route/body/registration and independent device pair',()=>{
 const key=keyGen({provider:'portable'});let batch;
 try{const hex=b=>Buffer.from(b).toString('hex'),f=fixture(hex(key.publicKey.pkA),hex(key.publicKey.pkB)),d=m.encodeProductSessionManagementV4RequestDATA(registry,'active',{...f,sessionBinding:'ab'.repeat(32)}),r=JSON.parse(f.registrationOriginal);
 const unsigned={version:'4',sessionBinding:'ab'.repeat(32),...Object.fromEntries(['productId','clientId','applicationId','bundleId','packageId','origin','callback','deviceId'].map(k=>[k,r[k]])),account,canonicalOwner:owner,deviceRegistrationId:r.registrationId,deviceRegistrationRevision:r.revision,deviceRegistrationDigest:f.request.deviceRegistrationDigest,method:'POST',path:d.path,bodyDigest:d.bodyDigest,nonce:'P'.repeat(32),issuedAt:at.toISOString(),expiresAt:new Date(+at+15000).toISOString()};
 const signed=batchSign(key.privateKey,{chainId:Buffer.from(network,'hex'),owner,purpose:'PRODUCT-SESSION-HTTP-PROOF'},[Buffer.from(encodeProductSessionHTTPProofV4Message(unsigned,network))]);batch=signed.batch;
 const header=encodeProductSessionProofHeaderV4(unsigned,encodeMember(extract(batch,0))),expected={networkId:network,unsigned,pkA:r.pkA,pkB:r.pkB},good=m.inspectProductSessionManagementV4ProofDATA(registry,'active',d.bodyOriginal,header,expected);assert.equal(good.signatureVerified,true);assert.equal(good.current,false);
 invalid(()=>m.inspectProductSessionManagementV4ProofDATA(registry,'recover',m.encodeProductSessionManagementV4RequestDATA(registry,'recover',{...f,operationId:'PUBLIC-original-operation'},target({...f,operationId:'PUBLIC-original-operation'})).bodyOriginal,header,expected));
 invalid(()=>m.inspectProductSessionManagementV4ProofDATA(registry,'active',d.bodyOriginal,header,{...expected,pkB:'55'.repeat(64)}));
 invalid(()=>m.inspectProductSessionManagementV4ProofDATA(registry,'active',m.encodeProductSessionManagementV4RequestDATA(registry,'active',{...f,sessionBinding:'cd'.repeat(32)}).bodyOriginal,header,expected));
 }finally{if(batch)discardBatch(batch);destroyKey(key.privateKey);}
});

test('new PAIR UNKNOWN cannot derive a binding or substitute zero/op hash; completion target is query-only',()=>{for(const t of [undefined,{kind:'pair',operationId:bodies.recover.operationId,sessionBinding:'00'.repeat(32)},{kind:'pair',operationId:bodies.recover.operationId,sessionBinding:sha(Buffer.from(bodies.recover.operationId))}])assert.throws(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'recover',bodies.recover,t),{code:'PAIR_V4_RECOVERY_SESSION_BINDING_NOT_DERIVABLE'});const d=m.encodeProductSessionManagementV4RequestDATA(registry,'recover',bodies.recover,recoveryTarget);assert.match(d.intendedSessionBinding,/^[a-f0-9]{64}$/);assert.equal(d.current,false);assert.equal(d.authorized,false);invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'recover',bodies.recover,{...recoveryTarget,operationId:'PUBLIC-other-operation'}));invalid(()=>m.encodeProductSessionManagementV4RequestDATA(registry,'recover',bodies.recover,{...recoveryTarget,sessionBinding:'00'.repeat(32)}));});

test('BOM request original must be rejected without normalization',()=>{const d=m.encodeProductSessionManagementV4RequestDATA(registry,'active',bodies.active),bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(d.bodyOriginal)]);assert.throws(()=>m.decodeProductSessionManagementV4RequestDATA(registry,'active',bom));});
test('BOM response original must be rejected without normalization',()=>{const raw=m.encodeProductSessionManagementV4ResponseDATA(response,selection),bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(raw)]);assert.throws(()=>m.decodeProductSessionManagementV4ResponseDATA(bom,selection));});
