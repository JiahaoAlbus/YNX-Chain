import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOriginalAdmissionBroker,admissionCanonical} from '../src/original-admission-broker.mjs';
import * as parent from '../src/original-admission-parent-source.mjs';
// Transport-only public fixtures; no Native Source, real executor or authority.
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function publication(){const h='a'.repeat(64),n='a'.repeat(43);return {account:'PUBLIC-account',sequence:1,expiresAtMs:2000,selection:{sourceSelection:{rootPath:'/PUBLIC/root',rootDigest:h,rolePath:'/PUBLIC/role',roleDigest:h},receiptSelection:{receiptPath:'/PUBLIC/receipts/'+n+'.admission.json',receiptDigest:h},receiptDirectory:'/PUBLIC/receipts',expectedRequest:{version:1,purpose:'wallet-product-session-v2-service-admission/v1',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:h,consumerManifestDigest:h,gatewayManifestDigest:h,instanceId:'PUBLIC-instance',currentReference:h,operations:['beginYNX','handleReturn','restore','disconnect'],requestNonce:n,requestedAtMs:900,expiresAtMs:2500}}};}
function fixture(handler){
 const stream=new EventEmitter(),writes=[],callbacks=[],timers=new Set();let alive=true;
 stream.write=(raw,done)=>{writes.push(raw);callbacks.push(done);};stream.destroy=()=>{stream.destroyed=true;};
 const broker=createOriginalAdmissionBroker({stream,handlePrivateServicePayload:handler,now:()=>1000,assertChannelCurrent(){if(!alive)throw Error('PUBLIC_LOCKED');},schedule(fn){timers.add(fn);return fn;},unschedule(fn){timers.delete(fn);}});
 const ready=async()=>{const p=publication(),work=broker.deliver(p);callbacks.shift()();stream.emit('data',admissionCanonical({type:'ack',requestNonce:p.selection.expectedRequest.requestNonce,receiptDigest:p.selection.receiptSelection.receiptDigest,sequence:1,consumerManifestDigest:p.selection.expectedRequest.consumerManifestDigest})+'\n');await work;};
 return {stream,broker,writes,callbacks,ready,lock(){alive=false;}};
}
test('R33 same reader transitions only after installed ACK and serializes exact payload responses',async()=>{
 const seen=[],f=fixture(async raw=>{seen.push(raw);return '{"PUBLIC_response":'+JSON.parse(raw).PUBLIC_request+'}';});await f.ready();
 const line=admissionCanonical({PUBLIC_request:1});f.stream.emit('data',line.slice(0,4));f.stream.emit('data',line.slice(4)+'\n'+admissionCanonical({PUBLIC_request:2})+'\n');await flush();
 assert.deepEqual(seen,[line]);assert.equal(f.stream.listenerCount('data'),1);assert.equal(f.writes[1],'{"PUBLIC_response":1}\n');f.callbacks.shift()();await flush();
 assert.deepEqual(seen,[line,admissionCanonical({PUBLIC_request:2})]);assert.equal(f.writes[2],'{"PUBLIC_response":2}\n');f.callbacks.shift()();await f.broker.joinEntered();f.broker.close();
});
test('R33 pending payload is drained on close and late response never writes or replays',async()=>{
 let resolve,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>resolve=r);});await f.ready();f.stream.emit('data','{}\n{}\n');await flush();
 assert.equal(calls,1);f.broker.close(Error('PUBLIC_CANCEL'));let joined=false;const done=f.broker.joinEntered().then(()=>joined=true);await flush();assert.equal(joined,false);
 resolve('{}');await done;assert.equal(calls,1);assert.equal(f.writes.length,1);assert.equal(f.stream.destroyed,true);
});
test('R33 payload response write callback lock or error cannot start the next queued request',async()=>{
 for(const mode of ['lock','error']){let calls=0;const f=fixture(async()=>{calls++;return '{}';});await f.ready();f.stream.emit('data','{}\n{}\n');await flush();assert.equal(calls,1);
 if(mode==='lock')f.lock();f.callbacks.shift()(mode==='error'?Error('PUBLIC_UNCERTAIN_WRITE'):undefined);await f.broker.joinEntered();assert.equal(calls,1);assert.equal(f.writes.length,2);assert.equal(f.stream.destroyed,true);}
});
test('R33 payload transport enforces input/output bounds, UTF8 and no injected LF without replay',async()=>{
 for(const mode of ['large-input','bad-utf8','large-output','injected-lf','queue']){
  let calls=0;const f=fixture(async()=>{calls++;return mode==='large-output'?'x'.repeat(196609):mode==='injected-lf'?'{}\n{}':'{}';});await f.ready();
  f.stream.emit('data',mode==='large-input'?'x'.repeat(589825):mode==='bad-utf8'?Buffer.from([0xff,10]):mode==='queue'?'{}\n'.repeat(18):'{}\n');await flush();
  // A queued callback, if any, belongs to the first response only.
  if(f.callbacks.length)f.callbacks.shift()();await f.broker.joinEntered();assert.equal(f.stream.destroyed,true);assert.ok(calls<=1);assert.ok(f.writes.length<=2);
 }
});
test('R33 business data before installed ACK remains forbidden',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return '{}';}),work=f.broker.deliver(publication());f.stream.emit('data','{}\n');await assert.rejects(work);f.callbacks.shift()();await f.broker.joinEntered();assert.equal(calls,0);
});
async function parentFixture(handler){
 const p=publication(),r=p.selection.expectedRequest,executor={executable:'/PUBLIC/NO_SPAWN',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000};
 let alive=true,closes=0;const check=()=>{if(!alive)throw Error('PUBLIC_PARENT_LOCK');};
 const host={assertCurrent(){},readPending:()=>({pending:true,descriptor:41,currentReference:r.currentReference,requestNonce:r.requestNonce}),beginPrelude:()=>Promise.resolve(),takeSenderDescriptor:()=>42,readInstalledFrame(){},acknowledge(){},retire(){},async join(){},async close(){closes++;},outcome(){},handlePrivateServicePayload:handler};
 parent.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:true},raw:{expiresAtMs:2500,expectedRequest:r},executor,assertCurrent:check,originalConfiguration:{reserveParentHost:()=>host}});
 const ref=parent.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>1000,check);parent.enterOriginalAdmissionParentLaunch(ref,()=>({PUBLIC_child:true}));await parent.waitOriginalAdmissionParentPrelude(ref);
 return {ref,host,closes:()=>closes,lock(){alive=false;},ack(){parent.acknowledgeOriginalAdmissionParentFrame(ref,Buffer.from('PUBLIC_ACK'));}};
}
test('R33 parent requires its actual installed ACK, keeps exact handler result and joins once',async()=>{
 let calls=0,resolve;const f=await parentFixture(raw=>{calls++;assert.equal(raw,'PUBLIC_exact');return new Promise(r=>resolve=r);});
 await assert.rejects(parent.handleOriginalAdmissionParentPayload(f.ref,'PUBLIC_exact'),/INSTALLED_ACK_REQUIRED/);assert.equal(calls,0);f.ack();
 const work=parent.handleOriginalAdmissionParentPayload(f.ref,'PUBLIC_exact');await flush();assert.equal(calls,1);
 const close=parent.closeOriginalAdmissionParentSource(f.ref);let done=false;close.then(()=>done=true);await flush();assert.equal(done,false);assert.equal(f.closes(),0);
 // Original bytes are retained by the supplier; a late response cannot escape
 // the original parent current/retirement fence to a replacement endpoint.
 resolve('PUBLIC_result');await assert.rejects(work,/RETIRED/);await close;assert.equal(f.closes(),1);assert.equal(parent.closeOriginalAdmissionParentSource(f.ref),close);
});
test('R33 parent retains falsy business error separately from cleanup failure without retry',async()=>{
 let calls=0;const f=await parentFixture(()=>{calls++;throw false;});f.ack();let rejected=false;
 try{await parent.handleOriginalAdmissionParentPayload(f.ref,'PUBLIC');}catch(error){rejected=true;assert.equal(error,false);}assert.equal(rejected,true);
 f.host.close=()=>{throw undefined;};const close=parent.closeOriginalAdmissionParentSource(f.ref);try{await close;}catch(error){assert.equal(error,undefined);}
 parent.selectOriginalAdmissionParentOutcome(f.ref,s=>{assert.equal(s.firstCausePresent,true);assert.equal(s.firstCause,false);assert.equal(s.cleanupFailurePresent,true);assert.equal(s.cleanupCause,undefined);assert.equal(s.closed,false);});
 assert.equal(parent.closeOriginalAdmissionParentSource(f.ref),close);assert.equal(calls,1);
});
test('R33 parent does not substitute a missing SDK successor handler or invoke after lock',async()=>{
 let calls=0;for(const mode of ['missing','lock']){const f=await parentFixture(()=>{calls++;return Promise.resolve('PUBLIC');});f.ack();if(mode==='missing')delete f.host.handlePrivateServicePayload;else f.lock();
 await assert.rejects(parent.handleOriginalAdmissionParentPayload(f.ref,'PUBLIC'),mode==='missing'?/NOT_SUPPLIED/:/PARENT_LOCK/);await parent.closeOriginalAdmissionParentSource(f.ref);}
 assert.equal(calls,0);
});
