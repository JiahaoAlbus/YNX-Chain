// Executes the actual Auth runtime with PUBLIC Native/peer/effect seams.
// No Root, actual process lineage, installed Wallet approval or signing here.
import assert from 'node:assert/strict';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const purpose={receive:'AUTH-IDENTITY-RECEIVE',recover:'AUTH-IDENTITY-RECOVER',keyCall:'AUTH-PROTECTED-KEY-CALL'};
function raw(kind){return canonical({version:'YNX-AUTH-IDENTITY/v2',algorithmVersion:'YNX-BATCH/v0.1',networkId:'ab'.repeat(32),owner:'0x'+'12'.repeat(20),keyVersion:'1',executionHeight:'99',principalId:'PUBLIC',productId:'developer',applicationId:'com.ynx.developer',deviceId:'PUBLIC-device',requestId:'PUBLIC-request',purpose:purpose[kind],requestDigest:'cd'.repeat(32),credentialDigest:'ef'.repeat(32),nonce:Buffer.alloc(32,1).toString('base64url'),issuedAtMs:'100',expiresAtMs:'30100'});}
function fixture(Runtime,kind='receive'){
 const counts={begin:0,request:0,complete:0,invoke:0,send:0,receive:0,peerClose:0,callClose:0,peerRetire:0,callRetire:0};let cancelled=false,businessError,peerError,returned=false;let wait;
 const call={begin(){counts.begin++;if(businessError)throw businessError;},current(){if(businessError)throw businessError;},request(){counts.request++;return Object.freeze({original:raw(kind),message:new Uint8Array([1]),dataOnly:true,authorized:false});},completeProof(wire){counts.complete++;assert.deepEqual(wire,new Uint8Array([1,2,3]));},invoke(){counts.invoke++;return {publicResult:'PUBLIC key effect'};},result(){return {publicResult:'PUBLIC original receipt'};},retire(){counts.callRetire++;cancelled=true;},join(){},close(){counts.callClose++;}};
 const peer={current(){if(peerError)throw peerError;},sendRequest(k,original,invocation){counts.send++;assert.equal(k,kind);assert.equal(original,raw(kind));assert.equal(invocation,kind==='keyCall'?'{}':undefined);},receiveReturn(){counts.receive++;return wait?wait():Promise.resolve({decision:'approve',requestId:'PUBLIC-request',purpose:purpose[kind],proof:new Uint8Array([1,2,3])});},retire(){counts.peerRetire++;cancelled=true;},join(){},close(){counts.peerClose++;}};
 return {runtime:new Runtime(call,peer),call,peer,counts,failCall:e=>{businessError=e;},failPeer:e=>{peerError=e;},wait:f=>{wait=f;},cancelled:()=>cancelled};
}
export async function runControls({OriginalIdentityPeerCall:Runtime,parseOriginalIdentityPeerFrameData:parse}){
 const results=[];
 for(const kind of Object.keys(purpose)){
  const f=fixture(Runtime,kind);await f.runtime.begin(kind,kind==='keyCall'?'{}':undefined);const result=await f.runtime.waitForReturn();assert(result.publicResult);assert.equal(f.counts.complete,1);assert.equal(f.counts.invoke,kind==='keyCall'?1:0);assert.equal(f.counts.request,1);assert.throws(()=>f.runtime.waitForReturn());await f.runtime.close();assert.equal(f.counts.callClose,1);assert.equal(f.counts.peerClose,1);results.push(kind+' normal once/correlation');
 }
 {
  const f=fixture(Runtime);const e=Error('PUBLIC constructor partial');f.failCall(e);await assert.rejects(f.runtime.begin('receive'),x=>x===e);await f.runtime.close();assert.equal(f.counts.begin,1);assert.equal(f.counts.callClose,1);assert.equal(f.counts.send,0);results.push('late constructor partial cleanup');
 }
 {
  const f=fixture(Runtime);let release;await f.runtime.begin('receive');f.wait(()=>new Promise(r=>{release=r;}));const pending=f.runtime.waitForReturn();await Promise.resolve();await Promise.resolve();await Promise.resolve();while(!release)await new Promise(r=>setTimeout(r,0));f.runtime.retire();release({decision:'approve',requestId:'PUBLIC-request',purpose:purpose.receive,proof:new Uint8Array([1,2,3])});await assert.rejects(pending);assert.deepEqual(f.runtime.outcome().proof,new Uint8Array([1,2,3]));assert.equal(f.counts.complete,0);await f.runtime.close();results.push('cancel then late proof retains bytes without effect');
 }
 for(const mode of ['correlation','purpose','reject','bad-proof','late-current']){
  const f=fixture(Runtime);await f.runtime.begin('receive');f.wait(async()=>{
   if(mode==='late-current')f.failPeer(Error('PUBLIC peer revoked'));
   return {decision:mode==='reject'?'reject':'approve',requestId:mode==='correlation'?'OTHER':'PUBLIC-request',purpose:mode==='purpose'?purpose.recover:purpose.receive,proof:mode==='reject'?null:mode==='bad-proof'?new Uint8Array(262145):new Uint8Array([1,2,3])};
  });await assert.rejects(f.runtime.waitForReturn());assert.equal(f.counts.complete,0);assert.equal(f.counts.invoke,0);await f.runtime.close();results.push(mode+' refused');
 }
 {
  const f=fixture(Runtime),e=Error('PUBLIC partial write unknown');f.peer.sendRequest=()=>{f.counts.send++;throw e;};await assert.rejects(f.runtime.begin('receive'),x=>x===e);assert.throws(()=>f.runtime.begin('receive'));await f.runtime.close();assert.equal(f.counts.send,1);results.push('partial write no business resend');
 }
 {
  const f=fixture(Runtime),e=Error('PUBLIC peer join failed');f.peer.join=()=>{throw e;};await f.runtime.begin('receive');await assert.rejects(f.runtime.close(),x=>x===e);await assert.rejects(f.runtime.close(),x=>x===e);assert.equal(f.counts.callClose,1);assert.equal(f.counts.peerClose,0);results.push('join debt preserves unrelated close and sticky failure');
 }
 {
  const f=fixture(Runtime);assert.throws(()=>f.runtime.waitForReturn());assert.throws(()=>f.runtime.begin('recover','{}'));assert.equal(f.counts.begin,0);results.push('invalid/sender not ready');
 }
 const valid={version:'YNX-IDE-IDENTITY-PEER/v1',kind:'request',peerNonce:Buffer.alloc(32,1).toString('base64url'),requestId:'PUBLIC',purpose:purpose.receive,requestOriginalSha256:'ab'.repeat(32),payload:{original:raw('receive')}};
 assert.equal(parse(canonical(valid)).nativeAdmission,false);
 for(const v of [canonical(valid)+' ',canonical({...valid,extra:true}),canonical({...valid,purpose:'LOGIN'}),canonical({...valid,kind:'transaction'}),canonical({...valid,peerNonce:'bad'}),'{}','null',canonical({...valid,extra:'x'.repeat(524288)})])assert.throws(()=>parse(v));results.push('closed bounded canonical DATA envelope');
 return {cases:results.length,results,actualRuntime:true,NativeAndPeer:'PUBLIC seams',realPeer:false,realApproval:false,effects:false,rootGrant:false};
}
