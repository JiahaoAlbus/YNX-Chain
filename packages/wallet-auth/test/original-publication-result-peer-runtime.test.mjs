// PUBLIC normal caller controls only. No Native Source, signature, approval or effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OriginalIdentityPeerCall} from '../src/original-identity-peer-runtime.js';
import {canonicalJSON} from '../src/canonical.js';
import {encodeIDEArtifactManifestData} from '../src/ide-artifact-manifest.js';
const manifest=new TextDecoder().decode(encodeIDEArtifactManifestData({byteSize:1,contentDigest:'a'.repeat(64),projectId:'PUBLIC-project',publishPurpose:'release',targetEnvironment:'testnet',version:'1'}));
const purpose={receive:'AUTH-IDENTITY-RECEIVE',recover:'AUTH-IDENTITY-RECOVER',keyCall:'AUTH-PROTECTED-KEY-CALL'};
function request(kind){return canonicalJSON({version:'YNX-AUTH-IDENTITY/v2',algorithmVersion:'YNX-BATCH/v0.1',networkId:'ab'.repeat(32),owner:'0x'+'12'.repeat(20),keyVersion:'1',executionHeight:'99',principalId:'PUBLIC',productId:'developer',applicationId:'com.ynx.developer',deviceId:'PUBLIC-device',requestId:'PUBLIC-request',purpose:purpose[kind],requestDigest:'cd'.repeat(32),credentialDigest:'ef'.repeat(32),nonce:Buffer.alloc(32,1).toString('base64url'),issuedAtMs:'100',expiresAtMs:'30100'});}
function fixture(kind='keyCall'){
 const count={begin:0,send:0,publication:0,identity:0,complete:0,invoke:0,peerClose:0,callClose:0};let failurePresent=false,failure,receive;
 const call={begin(k,invocation){count.begin++;assert.equal(k,kind);if(kind==='keyCall')assert.equal(invocation,manifest);},request(){return {original:request(kind),message:new Uint8Array([1]),dataOnly:true,authorized:false};},current(){if(failurePresent)throw failure;},completeProof(){count.complete++;},invoke(){count.invoke++;},result(){return 'PUBLIC-identity-result';},retire(){},join(){},close(){count.callClose++;}};
 const peer={current(){},sendRequest(k,raw,invocation){count.send++;assert.equal(k,kind);assert.equal(raw,request(kind));assert.equal(invocation,kind==='keyCall'?manifest:undefined);},receiveOriginalArtifactReturn(){count.publication++;return receive();},receiveReturn(){count.identity++;return {decision:'approve',requestId:'PUBLIC-request',purpose:purpose[kind],proof:new Uint8Array([1])};},retire(){},join(){},close(){count.peerClose++;}};
 return {runtime:new OriginalIdentityPeerCall(call,peer),call,peer,count,receive(fn){receive=fn;},fail(value){failurePresent=true;failure=value;}};
}
const data=()=>({decision:'publication-result',requestId:'PUBLIC-request',requestPurpose:purpose.keyCall,purpose:'ARTIFACT-RELEASE',resultOriginal:new Uint8Array([1,2,3]),dataOnly:true,signatureVerified:false,publicationAuthorized:false,nativeAdmission:false,approvalCurrent:false});
test('PUBLIC publication uses same keyCall/send once, isolated terminal and copied DATA without second effect',async()=>{
 const f=fixture(),returned=data();f.receive(()=>returned);await f.runtime.beginPublication(manifest);assert.throws(()=>f.runtime.beginPublication(manifest));assert.throws(()=>f.runtime.waitForReturn(),{code:'AUTH_IDENTITY_PEER_RETURN_ROUTE'});const result=await f.runtime.waitForPublicationResult();assert.throws(()=>f.runtime.waitForPublicationResult());assert.deepEqual(result.resultOriginal,new Uint8Array([1,2,3]));returned.resultOriginal.fill(9);result.resultOriginal.fill(8);const first=f.runtime.outcome();assert.deepEqual(first.result.resultOriginal,new Uint8Array([1,2,3]));first.result.resultOriginal.fill(7);first.publicationResultOriginal.fill(6);assert.deepEqual(f.runtime.outcome().result.resultOriginal,new Uint8Array([1,2,3]));assert.equal(first.proofSelected,false);assert.equal(first.publicationMode,true);assert.equal(first.publicationResultSelected,true);assert.equal(result.signatureVerified,false);assert.equal(result.publicationAuthorized,false);await f.runtime.close();assert.deepEqual(f.count,{begin:1,send:1,publication:1,identity:0,complete:0,invoke:0,peerClose:1,callClose:1});
});
test('PUBLIC six-field manifest refuses extra/invalid originals before Native begin',()=>{
 for(const raw of ['{}',manifest+' ',JSON.stringify({...JSON.parse(manifest),extra:true})]){const f=fixture();assert.throws(()=>f.runtime.beginPublication(raw));assert.equal(f.count.begin,0);}
});
test('PUBLIC wrong correlation, truthy authority flags and old proof2 are never publication DATA',async()=>{
 const invalid=[{decision:'approve',requestId:'PUBLIC-request',purpose:purpose.keyCall,proof:new Uint8Array([1])},{...data(),requestId:'OTHER'},{...data(),requestPurpose:purpose.receive},{...data(),purpose:'OTHER'},...['dataOnly','signatureVerified','publicationAuthorized','nativeAdmission','approvalCurrent'].map(key=>({...data(),[key]:key!=='dataOnly'}))];
 for(const response of invalid){const f=fixture();f.receive(()=>response);await f.runtime.beginPublication(manifest);await assert.rejects(f.runtime.waitForPublicationResult());assert.equal(f.count.complete,0);assert.equal(f.count.invoke,0);await f.runtime.close();}
});
test('PUBLIC native reject schema and cancel rejection stay distinct, no proof fallback',async()=>{
 const f=fixture();f.receive(()=>({decision:'reject',requestId:'PUBLIC-request',purpose:purpose.keyCall,proof:null}));await f.runtime.beginPublication(manifest);await assert.rejects(f.runtime.waitForPublicationResult(),{code:'AUTH_IDENTITY_PEER_USER_REJECTED'});await f.runtime.close();
 const g=fixture(),cancel=Object.assign(Error('PUBLIC cancel'),{code:'AUTH_IDENTITY_PEER_USER_CANCELLED'});g.receive(()=>Promise.reject(cancel));await g.runtime.beginPublication(manifest);await assert.rejects(g.runtime.waitForPublicationResult(),e=>e===cancel);await g.runtime.close();
});
test('PUBLIC malformed decision accessor is refused without getter or reentry',async()=>{
 const f=fixture();let calls=0;const response=data();Object.defineProperty(response,'decision',{enumerable:true,get(){calls++;f.runtime.retire();return 'reject';}});f.receive(()=>response);await f.runtime.beginPublication(manifest);await assert.rejects(f.runtime.waitForPublicationResult(),{code:'AUTH_IDENTITY_PEER_SCHEMA'});assert.equal(calls,0);assert.equal(f.runtime.outcome().retired,false);assert.equal(f.count.invoke,0);await f.runtime.close();
});
test('PUBLIC late current failure retains independent original bytes and arbitrary falsy first cause',async()=>{
 for(const first of [undefined,null,false,0,'']){const f=fixture(),response=data();f.receive(()=>{f.fail(first);return response;});await f.runtime.beginPublication(manifest);let caught=false;try{await f.runtime.waitForPublicationResult();}catch(e){caught=true;assert.equal(e,first);}assert.equal(caught,true);response.resultOriginal.fill(9);assert.deepEqual(f.runtime.outcome().publicationResultOriginal,new Uint8Array([1,2,3]));assert.equal(f.runtime.outcome().firstCausePresent,true);assert.equal(f.runtime.outcome().firstCause,first);assert.equal(f.runtime.outcome().settled,false);await f.runtime.close();assert.equal(f.count.invoke,0);}
});
test('PUBLIC retired pending terminal retains bytes without accepting late success',async()=>{
 const f=fixture();let release;f.receive(()=>new Promise(resolve=>{release=resolve;}));await f.runtime.beginPublication(manifest);const pending=f.runtime.waitForPublicationResult();while(!release)await new Promise(resolve=>setImmediate(resolve));f.runtime.retire();release(data());await assert.rejects(pending);assert.deepEqual(f.runtime.outcome().publicationResultOriginal,new Uint8Array([1,2,3]));await f.runtime.close();assert.equal(f.count.invoke,0);
});
test('PUBLIC cleanup UNKNOWN preserves bytes, once-only independent cleanup and original falsy cause',async()=>{
 const f=fixture();f.receive(data);await f.runtime.beginPublication(manifest);await f.runtime.waitForPublicationResult();f.peer.close=()=>{f.count.peerClose++;throw false;};for(let i=0;i<2;i++){let caught=false;try{await f.runtime.close();}catch(e){caught=true;assert.equal(e,false);}assert.equal(caught,true);}assert.equal(f.count.peerClose,1);assert.equal(f.count.callClose,1);assert.deepEqual(f.runtime.outcome().publicationResultOriginal,new Uint8Array([1,2,3]));assert.equal(f.runtime.outcome().cleanupCause,false);
});
test('PUBLIC affected identity routing still uses ordinary proof completion only',async()=>{
 for(const kind of ['receive','recover','keyCall']){const f=fixture(kind);await f.runtime.begin(kind,kind==='keyCall'?manifest:undefined);assert.throws(()=>f.runtime.waitForPublicationResult(),{code:'AUTH_IDENTITY_PEER_RETURN_ROUTE'});await f.runtime.waitForReturn();assert.equal(f.runtime.outcome().proofSelected,true);assert.equal(f.runtime.outcome().publicationResultSelected,false);assert.equal(f.count.identity,1);assert.equal(f.count.publication,0);assert.equal(f.count.complete,1);assert.equal(f.count.invoke,kind==='keyCall'?1:0);await f.runtime.close();}
});
