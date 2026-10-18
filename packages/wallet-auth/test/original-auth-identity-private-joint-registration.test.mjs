import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import * as PUBLIC_PAYLOAD from '../src/original-ide-private-payload.js';
import {canonicalJSON as PUBLIC_CANONICAL} from '../src/canonical.js';
test('R15 actual joint startup and both fixed loaders decode paths without Native calls',()=>{
 const joint=readFileSync(new URL('../src/original-auth-identity-private-joint-registration.js',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../src/original-wallet-service-private-dispatch.js',import.meta.url),'utf8').match(/function loadFixedOriginalNativeServiceBinding\(\)\{[^]*?\n\}/)[0];
 const names=JSON.parse(joint.match(/const methods=(\[[^;]+\]);/)[1].replaceAll("'",'"'));
 const extra=['captureOriginalNativePrivateServiceBorrow','assertOriginalNativePrivateServiceCurrent','assertOriginalNativePrivateServiceAdmission','assertOriginalNativePrivateServiceTerminal','retireOriginalNativePrivateService','joinOriginalNativePrivateService','closeOriginalNativePrivateService'];let calls=0,cases=0;
 function setup(directory,missing=null,loadFail=false){
  const base='file:///PUBLIC/'+directory+'/packages/wallet-auth/src/',vault={},targets=[];
  const native=Object.fromEntries([...names,...extra].map(k=>[k,()=>{++calls;throw Error('forbidden native call');}]));if(missing)native[missing]=null;
  const c=vm.createContext({URL,fileURLToPath,assertOriginalAdmissionVault:v=>assert.equal(v,vault),createRequire:value=>target=>{const expected=fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',base+'original-auth-identity-private-joint-registration.js'));targets.push(target);if(loadFail||target!==expected)throw Error('TEST_ONLY_MODULE_REFUSED');return native;}});
  vm.runInContext(joint.replace(/^import .*;$/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(base+'original-auth-identity-private-joint-registration.js'))+';this.initialize=initializeOriginalAuthIdentityPrivateStartup;this.status=originalAuthIdentityStartupStatus;',c);
  vm.runInContext(dispatch.replaceAll('import.meta.url',JSON.stringify(base+'original-wallet-service-private-dispatch.js'))+';this.dispatchBinding=loadFixedOriginalNativeServiceBinding;',c);
  return {c,vault,targets};
 }
 for(const directory of ['YNXChain','YNX%20Chain','YNX%25Chain','YNX%23Chain','YNX%E9%92%B1%E5%8C%85']){const f=setup(directory);f.c.initialize(f.vault);assert.equal(f.c.status(f.vault).implementingModuleAvailable,true);assert.equal(f.c.status(f.vault).nativeQualified,false);assert.equal(f.c.status(f.vault).resourceSupplied,false);assert.ok(f.c.dispatchBinding());assert.equal(f.targets.length,2);assert.throws(()=>f.c.initialize(f.vault),/STARTUP_ALREADY_SELECTED/);assert.equal(f.targets.length,2);cases+=2;}
 for(const name of names){const f=setup('YNX%20Chain',name);assert.throws(()=>f.c.initialize(f.vault),/NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED/);assert.equal(f.c.status(f.vault).implementingModuleAvailable,false);assert.throws(()=>f.c.initialize(f.vault),/STARTUP_ALREADY_SELECTED/);assert.equal(f.targets.length,1);++cases;}
 const fail=setup('YNX%20Chain',null,true);assert.throws(()=>fail.c.initialize(fail.vault),/NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED/);assert.equal(fail.c.status(fail.vault).implementingModuleAvailable,false);++cases;
 assert.equal(calls,0);console.log('R15_TWO_ACTUAL_LOADERS_AND_STARTUP_CASES='+cases+' REAL_MODULE_LOADS=0 NATIVE_METHOD_CALLS=0');
});
// PUBLIC lexical machinery controls. No real .node module, root/profile,
// protected file, crypto or Native authority is loaded or supplied.
const text=readFileSync(new URL('../src/original-auth-identity-private-joint-registration.js',import.meta.url),'utf8');
function fixture({missing=false,commitFailure=false,hostNative={},typedNative=false,missingGenericAcquire=false,partialIDE=false,adminCloseFailure=false,payloadSelection=null,payloadDispatch=null}={}){
 const association={account:'PUBLIC_ACCOUNT',clientId:'PUBLIC_CLIENT',productId:'developer',platform:'macos',applicationId:'PUBLIC_APP',deviceId:'PUBLIC_DEVICE'},original={},joint={},localRef={},events=[];
 let live=true,closed=0,commits=0,guardHook=null,genericAcquisitions=0,ideAcquisitions=0,administrationLane=null;const localOriginal={scope:'LOCAL_SELECTED_VAULT',account:'PUBLIC_ACCOUNT',nativeQualified:false,independentLatest:false};
 const guard={assert(){if(!live)throw false;guardHook?.();}};
 const local={read:async()=>localOriginal,assertObservationCurrent:value=>{assert.equal(value,localOriginal);guard.assert();},close:async()=>{events.push('local-close');}};
 const vault={acquireOriginalServiceRoleLocalCurrentSource:async()=>localRef};
 local.vault=vault;
 const installed={vault,association,raw:{PUBLIC:'original'},executor:{PUBLIC:'executor',privateDispatch:payloadDispatch},observer:{PUBLIC:'observer'}};
 const native={acquireOriginalAdministrationProfile:async()=>{genericAcquisitions++;administrationLane='generic';return original;},readOriginalAdministrationProfile:value=>{assert.equal(value,original);if(partialIDE&&administrationLane==='ide')throw undefined;return {association,expectedLocalCurrent:{PUBLIC:true},...payloadSelection};},assertOriginalAdministrationProfileCurrent:value=>{assert.equal(value,original);guard.assert();},reserveOriginalJointRegistration:async(value,localValue)=>{assert.equal(value,original);assert.equal(localValue,localOriginal);events.push('reserved');return joint;},commitOriginalJointRegistration:async value=>{assert.equal(value,joint);commits++;if(commitFailure)throw undefined;return {PUBLIC:'original-commit'};},readOriginalJointRegistration:value=>{assert.equal(value,joint);return installed;},assertOriginalJointCurrent:value=>{assert.equal(value,joint);guard.assert();},assertOriginalJointExecutorChild:(value,executor,child)=>{assert.equal(value,joint);assert.equal(executor,installed.executor);if(child==='FOREIGN')throw Error('PUBLIC_CHILD_MISMATCH');},assertOriginalJointSuccession:()=>guard.assert(),retireOriginalJoint:()=>{events.push('retire');},joinOriginalJoint:async()=>{events.push('join');},closeOriginalJoint:async()=>{closed++;events.push('native-close');}};
 Object.assign(native,{retireOriginalAdministrationProfile:value=>assert.equal(value,original),joinOriginalAdministrationProfile:async()=>undefined,closeOriginalAdministrationProfile:async()=>{events.push('admin-close');if(adminCloseFailure)throw false;}});
 if(typedNative)native.acquireOriginalIDEAdministrationProfile=function(){assert.equal(arguments.length,0);ideAcquisitions++;administrationLane='ide';return original;};
 if(missingGenericAcquire)native.acquireOriginalAdministrationProfile=undefined;
 Object.assign(native,hostNative);
 const context=vm.createContext({types,PUBLIC_PAYLOAD,PUBLIC_CANONICAL,PUBLIC_NATIVE:missing?{}:native,assertOriginalAdmissionVault:value=>{if(value!==vault)throw Error('PUBLIC_FOREIGN_VAULT');},captureOriginalServiceRoleLocalCurrentSource:value=>{assert.equal(value,localRef);return local;}});
 const body=text.replace(/^import .*;$/mg,'').replace('const requireOriginal=createRequire(import.meta.url);','').replace(/^const loadOriginalNative=.*;$/m,'const loadOriginalNative=()=>PUBLIC_NATIVE;').replaceAll('export ','').replaceAll("import('./original-ide-private-payload.js')",'Promise.resolve(PUBLIC_PAYLOAD)').replaceAll("import('./canonical.js')",'Promise.resolve({canonicalJSON:PUBLIC_CANONICAL})');
 vm.runInContext(body+'\nthis.api={initializeOriginalAuthIdentityPrivateStartup,originalAuthIdentityStartupStatus,acquireOriginalAuthIdentityJointConfiguration,readOriginalAuthIdentityJointConfiguration,assertOriginalAuthIdentityJointCurrent,assertOriginalAuthIdentityJointExecutorChild,retireOriginalAuthIdentityJointConfiguration,joinOriginalAuthIdentityJointConfiguration,closeOriginalAuthIdentityJointConfiguration,originalAuthIdentityJointOutcome,originalAuthIdentityStartupUnresolved,reserveIDE:typeof reserveOriginalAuthIdentityIDEParentHost===\"function\"?reserveOriginalAuthIdentityIDEParentHost:null,initializeIDE:typeof initializeOriginalAuthIdentityIDEPrivateStartup===\"function\"?initializeOriginalAuthIdentityIDEPrivateStartup:null,acquireIDE:typeof acquireOriginalAuthIdentityIDEJointConfiguration===\"function\"?acquireOriginalAuthIdentityIDEJointConfiguration:null,statusIDE:typeof originalAuthIdentityIDEStartupStatus===\"function\"?originalAuthIdentityIDEStartupStatus:null};',context);
 return {api:context.api,vault,guard,installed,events,acquisitions:()=>({generic:genericAcquisitions,ide:ideAcquisitions}),setGuardHook(fn){guardHook=fn;},invalidate(){live=false;},closed:()=>closed,commits:()=>commits};
}
test('R11 PUBLIC fixed startup refuses missing implementing exports and never claims qualification',async()=>{
 const f=fixture({missing:true});assert.throws(()=>f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault),/NOT_IMPLEMENTED/);assert.equal(f.api.originalAuthIdentityStartupStatus(f.vault).implementingModuleAvailable,false);assert.equal(f.api.originalAuthIdentityStartupStatus(f.vault).nativeQualified,false);await assert.rejects(f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard),/NOT_IMPLEMENTED/);assert.equal(f.commits(),0);
});

// R19: actual SDK source with explicitly PUBLIC Native lexical stand-ins.
// These controls never create an endpoint, run spawn, sign, or supply a grant.
async function hostFixture({reserveFailure=false,readFailure=false,retireFailure=false,joinFailure=false,closeFailure=false,badBegin=false}={}){
 const intent={},frame=Buffer.from('PUBLIC original installed bytes\n'),ack=Buffer.from('PUBLIC ack bytes');let reserved=0,ready=false,resolveBegin,rejectBegin;
 const prefix=new Promise((resolve,reject)=>{resolveBegin=()=>{ready=true;resolve();};rejectBegin=reject;});
 void prefix.catch(()=>{});
 const events=[];const same=handle=>assert.equal(handle,intent);
 const hostNative={
  reserveOriginalIDEParentIntent(){reserved++;events.push('intent-reserve');if(reserveFailure)throw undefined;return intent;},
  readOriginalIDEParentIntent(handle){same(handle);events.push('intent-read');if(readFailure)throw false;return {pending:true,descriptor:40,currentReference:'PUBLIC',requestNonce:'PUBLIC'};},
  beginOriginalIDEParentPrelude(handle){same(handle);events.push('begin');return badBegin?undefined:prefix;},
  takeOriginalIDEParentSenderDescriptor(handle){same(handle);assert(ready);events.push('take');return 41;},
  readOriginalIDEParentInstalledFrame(handle){same(handle);assert(ready);events.push('frame');return frame;},
  assertOriginalIDEParentAcknowledgement(handle,raw){same(handle);assert.equal(raw,ack);events.push('ack');},
  assertOriginalIDEParentIntentCurrent(handle){same(handle);},
  retireOriginalIDEParentIntent(handle){same(handle);events.push('intent-retire');rejectBegin(undefined);if(retireFailure)throw false;},
  joinOriginalIDEParentIntent(handle){same(handle);events.push('intent-join');return joinFailure?Promise.reject(false):Promise.resolve();},
  closeOriginalIDEParentIntent(handle){same(handle);events.push('intent-close');return closeFailure?Promise.reject(0):Promise.resolve();},
 };
 const f=fixture({hostNative,typedNative:true});f.api.initializeIDE(f.vault);const ref=await f.api.acquireIDE(f.vault,f.guard);
 assert.equal(typeof f.api.reserveIDE,'function','actual shared Host factory missing');
 const host=f.api.reserveIDE(ref);return {...f,ref,host,events,frame,ack,resolveBegin,rejectBegin,reserved:()=>reserved};
}
test('R19 PUBLIC original joint Host starts prelude immediately, then preserves fd and wire identities',async()=>{
 const f=await hostFixture();const pending=f.host.readPending();assert.equal(pending.descriptor,40);
 const begin=f.host.beginPrelude();assert.deepEqual(f.events,['intent-reserve','intent-read','begin']);
 f.events.push('actual-spawn-would-pass-borrowed-40-as-child-fd4');f.resolveBegin();assert.equal(await begin,undefined);
 assert.equal(f.host.takeSenderDescriptor(),41);assert.equal(f.host.readInstalledFrame(),f.frame);assert.equal(f.host.acknowledge(f.ack),undefined);
 const close=f.host.close();assert.equal(f.host.close(),close);assert.equal(await close,undefined);assert.equal(f.reserved(),1);
 assert.equal(f.events.filter(x=>x==='intent-close').length,1);
});
test('R19 PUBLIC pending read falsy failure retains opaque cleanup and blocks new reservation',async()=>{
 const f=await hostFixture({readFailure:true});assert.throws(()=>f.host.readPending(),error=>error===false);
 assert.equal(f.host.outcome().firstCause,false);assert.equal(f.host.outcome().unknown,true);
 assert.equal(await f.host.close(),undefined);assert.equal(f.events.filter(x=>x==='intent-close').length,1);
 assert.throws(()=>f.api.reserveIDE(f.ref));assert.equal(f.reserved(),1);
});
test('R19 PUBLIC parent cleanup retires and drains pending prelude before closing original joint',async()=>{
 const f=await hostFixture();const begin=f.host.beginPrelude();void begin.catch(()=>{});
 assert.equal(await f.api.closeOriginalAuthIdentityJointConfiguration(f.ref),undefined);
 assert.equal(f.events.filter(x=>x==='intent-retire').length,1);assert.equal(f.events.filter(x=>x==='intent-join').length,1);assert.equal(f.events.filter(x=>x==='intent-close').length,1);
 assert.equal(f.closed(),1);assert.equal(f.host.outcome().cleanupComplete,true);
});
test('R19 PUBLIC join and close failures are both attempted once and preserve first falsy cleanup',async()=>{
 const f=await hostFixture({joinFailure:true,closeFailure:true});const close=f.host.close();
 await assert.rejects(close,error=>error===false);assert.equal(f.host.close(),close);
 assert.equal(f.events.filter(x=>x==='intent-retire').length,1);assert.equal(f.events.filter(x=>x==='intent-join').length,1);assert.equal(f.events.filter(x=>x==='intent-close').length,1);
 assert.equal(f.host.outcome().cleanupCause,false);assert.equal(f.host.outcome().cleanupComplete,false);
 await assert.rejects(f.api.closeOriginalAuthIdentityJointConfiguration(f.ref),error=>error===false);assert.equal(f.closed(),1);
});
test('R19 PUBLIC a synchronous void begin is not promoted to a completed Native prelude',async()=>{
 const f=await hostFixture({badBegin:true});assert.throws(()=>f.host.beginPrelude(),{code:'AUTH_IDENTITY_IDE_PRELUDE_PROMISE_REQUIRED'});
 assert.equal(f.host.outcome().unknown,true);assert.equal(await f.host.close(),undefined);
});
test('R19 PUBLIC current-hook close prevents Native begin before its effect',async()=>{
 const f=await hostFixture();let close;
 f.setGuardHook(()=>{f.setGuardHook(null);close=f.host.close();});
 assert.throws(()=>f.host.beginPrelude(),{code:'AUTH_IDENTITY_IDE_HOST_RETIRED'});
 assert.equal(f.events.includes('begin'),false);assert.equal(f.host.outcome().preludeStarted,false);assert.equal(await close,undefined);
});
test('R19 PUBLIC explicit retire failure is stable and close still attempts join and Native close',async()=>{
 const f=await hostFixture({retireFailure:true});assert.throws(()=>f.host.retire(),error=>error===false);assert.throws(()=>f.host.retire(),error=>error===false);
 await assert.rejects(f.host.close(),error=>error===false);
 assert.equal(f.events.filter(x=>x==='intent-retire').length,1);assert.equal(f.events.filter(x=>x==='intent-join').length,1);assert.equal(f.events.filter(x=>x==='intent-close').length,1);
 assert.equal(f.host.outcome().cleanupCause,false);assert.equal(f.host.outcome().cleanupComplete,false);
});
test('R19 PUBLIC uncertain reserve returns cleanup custody with its first undefined failure retained',async()=>{
 const f=await hostFixture({reserveFailure:true});assert.equal(f.host.outcome().nativeIntentRetained,false);
 assert.equal(f.host.outcome().firstCausePresent,true);assert.equal(f.host.outcome().firstCause,undefined);
 assert.throws(()=>f.host.readPending(),error=>error===undefined);await assert.rejects(f.host.close(),error=>error===undefined);
 assert.equal(f.host.outcome().cleanupCausePresent,true);assert.equal(f.reserved(),1);assert.throws(()=>f.api.reserveIDE(f.ref));
});
test('R19 PUBLIC rejected prelude preserves undefined UNKNOWN through completed resource cleanup',async()=>{
 const f=await hostFixture();const begin=f.host.beginPrelude();f.rejectBegin(undefined);await assert.rejects(begin,error=>error===undefined);
 assert.equal(f.host.outcome().unknown,true);assert.equal(f.host.outcome().firstCausePresent,true);assert.equal(f.host.outcome().firstCause,undefined);
 assert.equal(await f.host.close(),undefined);assert.equal(f.host.outcome().cleanupComplete,true);assert.equal(f.host.outcome().unknown,true);
 assert.equal(f.api.originalAuthIdentityStartupUnresolved(f.vault),true);assert.equal(f.events.filter(x=>x==='begin').length,1);
});
test('R19 PUBLIC transferred descriptor, original frame and ACK each cross Native at most once',async()=>{
 for(const operation of ['take','frame','ack']){
  const f=await hostFixture();const begin=f.host.beginPrelude();f.resolveBegin();await begin;f.host.takeSenderDescriptor();
  if(operation!=='take')f.host.readInstalledFrame();if(operation==='ack')f.host.acknowledge(f.ack);
  assert.throws(()=>operation==='take'?f.host.takeSenderDescriptor():operation==='frame'?f.host.readInstalledFrame():f.host.acknowledge(f.ack));
  assert.equal(f.events.filter(x=>x===operation).length,1);assert.equal(await f.host.close(),undefined);
 }
});
test('R20 PUBLIC typed IDE selects the dedicated zero-argument Native acquisition without generic dependency',async()=>{
 const f=fixture({typedNative:true,missingGenericAcquire:true});assert.equal(typeof f.api.initializeIDE,'function');assert.equal(typeof f.api.acquireIDE,'function');
 f.api.initializeIDE(f.vault);const ref=await f.api.acquireIDE(f.vault,f.guard);
 assert.deepEqual(f.acquisitions(),{generic:0,ide:1});assert.equal(f.api.readOriginalAuthIdentityJointConfiguration(ref).executor,f.installed.executor);
 await f.api.closeOriginalAuthIdentityJointConfiguration(ref);assert.equal(f.closed(),1);
});
test('R20 PUBLIC missing dedicated callee never falls back to the available generic acquisition',async()=>{
 const f=fixture();assert.equal(typeof f.api.initializeIDE,'function');
 f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault);assert.throws(()=>f.api.initializeIDE(f.vault),/NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED/);
 await assert.rejects(f.api.acquireIDE(f.vault,f.guard),/NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED/);assert.deepEqual(f.acquisitions(),{generic:0,ide:0});
 const original=await f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard);assert.deepEqual(f.acquisitions(),{generic:1,ide:0});await f.api.closeOriginalAuthIdentityJointConfiguration(original);
});
test('R20 PUBLIC generic joint cannot reserve an IDE Host or retire the unrelated generic owner',async()=>{
 let reserves=0;const names=['reserveOriginalIDEParentIntent','readOriginalIDEParentIntent','beginOriginalIDEParentPrelude','takeOriginalIDEParentSenderDescriptor','readOriginalIDEParentInstalledFrame','assertOriginalIDEParentAcknowledgement','assertOriginalIDEParentIntentCurrent','retireOriginalIDEParentIntent','joinOriginalIDEParentIntent','closeOriginalIDEParentIntent'];
 const hostNative=Object.fromEntries(names.map(name=>[name,()=>undefined]));hostNative.reserveOriginalIDEParentIntent=()=>{reserves++;return {};};
 const f=fixture({hostNative});f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault);const original=await f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard);
 assert.throws(()=>f.api.reserveIDE(original),{code:'AUTH_IDENTITY_IDE_SOURCE_REQUIRED'});assert.equal(reserves,0);
 assert.equal(f.api.readOriginalAuthIdentityJointConfiguration(original).executor,f.installed.executor);await f.api.closeOriginalAuthIdentityJointConfiguration(original);
});
test('R20 PUBLIC typed partial administration keeps first undefined and common cleanup debt',async()=>{
 const f=fixture({typedNative:true,partialIDE:true,adminCloseFailure:true});assert.equal(typeof f.api.initializeIDE,'function');f.api.initializeIDE(f.vault);
 await assert.rejects(f.api.acquireIDE(f.vault,f.guard),error=>error===undefined);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.acquisitions(),{generic:0,ide:1});assert.equal(f.events.filter(e=>e==='admin-close').length,1);
 assert.equal(f.api.originalAuthIdentityStartupUnresolved(f.vault),true);await assert.rejects(f.api.acquireIDE(f.vault,f.guard),/UNRESOLVED/);assert.equal(f.acquisitions().ide,1);
});
test('R20 PUBLIC generic and typed startup selections are independent and do not acquire Source during initialization',()=>{
 const f=fixture({typedNative:true});assert.equal(typeof f.api.initializeIDE,'function');f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault);f.api.initializeIDE(f.vault);
 assert.throws(()=>f.api.initializeIDE(f.vault),/STARTUP_ALREADY_SELECTED/);assert.equal(f.api.originalAuthIdentityStartupStatus(f.vault).implementingModuleAvailable,true);
 assert.equal(f.api.statusIDE(f.vault).implementingModuleAvailable,true);assert.equal(f.api.statusIDE(f.vault).nativeQualified,false);assert.equal(f.api.statusIDE(f.vault).resourceSupplied,false);
 assert.deepEqual(f.acquisitions(),{generic:0,ide:0});
});
test('R11 PUBLIC joint machinery reserves commits reads back original association, rejects foreign owner and child',async()=>{
 const f=fixture();f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault);const ref=await f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard),selected=f.api.readOriginalAuthIdentityJointConfiguration(ref);
 assert.equal(selected.vault,f.vault);assert.equal(selected.executor,f.installed.executor);assert.equal(f.commits(),1);assert.throws(()=>f.api.readOriginalAuthIdentityJointConfiguration({}),/OWNER_REQUIRED/);assert.throws(()=>f.api.assertOriginalAuthIdentityJointExecutorChild(ref,selected.executor,'FOREIGN'),/CHILD_MISMATCH/);
 const close=f.api.closeOriginalAuthIdentityJointConfiguration(ref);assert.equal(f.api.closeOriginalAuthIdentityJointConfiguration(ref),close);await close;assert.equal(f.closed(),1);assert.equal(f.events.at(-1),'admin-close');assert.throws(()=>f.api.readOriginalAuthIdentityJointConfiguration(ref),/RETIRED/);
});
test('R11 PUBLIC joint current retains committed original on late falsy invalidation, no close retry',async()=>{
 const f=fixture();f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault);const ref=await f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard);f.invalidate();assert.throws(()=>f.api.assertOriginalAuthIdentityJointCurrent(ref),cause=>cause===false);
 assert.equal(f.api.originalAuthIdentityJointOutcome(ref).result.PUBLIC,'original-commit');await f.api.closeOriginalAuthIdentityJointConfiguration(ref);assert.equal(f.commits(),1);assert.equal(f.closed(),1);
 assert.equal(f.api.originalAuthIdentityJointOutcome(ref).firstCausePresent,true);assert.equal(f.api.originalAuthIdentityStartupUnresolved(f.vault),true);
});
test('R11 PUBLIC failed commit remains UNKNOWN reachable through startup even without returned API',async()=>{
 const f=fixture({commitFailure:true});f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault);let rejected=false;try{await f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard);}catch(cause){rejected=true;assert.equal(cause,undefined);}assert(rejected);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.closed(),1);assert.equal(f.api.originalAuthIdentityStartupUnresolved(f.vault),true);await assert.rejects(f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard),/UNRESOLVED/);assert.equal(f.commits(),1);
});

// R33 actual parent SDK code, PUBLIC Native/Source stand-ins only.
const r33Selection={expectedRequest:{requestNonce:'PUBLIC_NONCE',consumerManifestDigest:'a'.repeat(64)},receiptSelection:{receiptDigest:'b'.repeat(64)}};
const r33Id='req_PUBLIC_REQUEST_001';
const r33Input=PUBLIC_CANONICAL({operation:'restore',phase:'time',requestId:r33Id,body:null,proofHeader:null});
const r33Frame=PUBLIC_PAYLOAD.createOriginalIDEPrivateRequestFrame(PUBLIC_PAYLOAD.originalIDEPrivateDeliveryBinding(r33Selection),r33Input);
const r33Response={status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':r33Id},body:PUBLIC_CANONICAL({ok:true,requestId:r33Id,schemaVersion:2,result:{PUBLIC:true}})};
async function r33Fixture({dispatch=()=>r33Response,terminal=()=>undefined,initialACK=true}={}){
 let calls=0,terminals=0;const events=[];
 const hostNative={reserveOriginalIDEParentIntent:()=>({}),readOriginalIDEParentIntent:()=>({pending:true}),assertOriginalIDEParentIntentCurrent(){},beginOriginalIDEParentPrelude:()=>Promise.resolve(),takeOriginalIDEParentSenderDescriptor:()=>41,readOriginalIDEParentInstalledFrame:()=>Buffer.from('PUBLIC\n'),assertOriginalIDEParentAcknowledgement(){},retireOriginalIDEParentIntent(){events.push('retire');},joinOriginalIDEParentIntent(){events.push('join');return Promise.resolve();},closeOriginalIDEParentIntent(){events.push('close');return Promise.resolve();},assertOriginalNativePrivateServiceTerminal(...args){terminals++;assert.equal(args.length,5);return terminal();}};
 const f=fixture({typedNative:true,hostNative,payloadSelection:r33Selection,payloadDispatch:raw=>{calls++;assert.equal(raw,r33Input);return dispatch();}});f.api.initializeIDE(f.vault);const ref=await f.api.acquireIDE(f.vault,f.guard),host=f.api.reserveIDE(ref);
 await host.beginPrelude();host.takeSenderDescriptor();host.readInstalledFrame();if(initialACK)host.acknowledge(Buffer.from('PUBLIC_ACK'));
 return {...f,host,ref,events,calls:()=>calls,terminals:()=>terminals};
}
test('R33 PUBLIC parent uses its same executor and independent Native ACK before frame',async()=>{
 const f=await r33Fixture();const reply=await f.host.handlePrivateServicePayload(r33Frame);assert.equal(PUBLIC_PAYLOAD.parseOriginalIDEPrivatePayload(reply).responseRaw,PUBLIC_CANONICAL(r33Response));assert.equal(f.calls(),1);assert.equal(f.terminals(),1);assert.equal(f.host.outcome().unknown,false);await f.host.close();
});
test('R33 PUBLIC parent rejects payload before initial ACK without invoking business',async()=>{
 const f=await r33Fixture({initialACK:false});await assert.rejects(f.host.handlePrivateServicePayload(r33Frame),{code:'AUTH_IDENTITY_IDE_PAYLOAD_NOT_READY'});assert.equal(f.calls(),0);assert.equal(f.host.outcome().unknown,true);await f.host.close();
});
test('R33 PUBLIC parent terminal falsy preserves first cause, blocks replay and keeps UNKNOWN',async()=>{
 const f=await r33Fixture({terminal(){throw undefined;}});await assert.rejects(f.host.handlePrivateServicePayload(r33Frame),e=>e===undefined);assert.equal(f.host.outcome().firstCausePresent,true);assert.equal(f.host.outcome().firstCause,undefined);assert.equal(f.host.outcome().unknown,true);await assert.rejects(f.host.handlePrivateServicePayload(r33Frame),e=>e===undefined);assert.equal(f.calls(),1);assert.equal(f.terminals(),1);await f.host.close();
});
test('R33 PUBLIC parent source loss after DATA prevents terminal/publication',async()=>{
 let f;f=await r33Fixture({dispatch(){f.invalidate();return r33Response;}});await assert.rejects(f.host.handlePrivateServicePayload(r33Frame),e=>e===false);assert.equal(f.calls(),1);assert.equal(f.terminals(),0);assert.equal(f.host.outcome().unknown,true);await f.host.close();
});
test('R33 PUBLIC parent retire drains entered response before Native join/close; late DATA never returns',async()=>{
 let resolve,entered;const started=new Promise(r=>entered=r),result=new Promise(r=>resolve=r);
 const f=await r33Fixture({dispatch(){entered();return result;}}),pending=f.host.handlePrivateServicePayload(r33Frame);await started;assert.equal(f.host.outcome().unknown,true);
 const close=f.host.close();await Promise.resolve();assert.equal(f.events.includes('join'),false);resolve(r33Response);await assert.rejects(pending);await close;assert.deepEqual(f.events,['retire','join','close']);assert.equal(f.terminals(),0);
});
test('R33 PUBLIC parent rejects same request twice and foreign binding without replay',async()=>{
 const f=await r33Fixture();await f.host.handlePrivateServicePayload(r33Frame);await assert.rejects(f.host.handlePrivateServicePayload(r33Frame),{code:'ORIGINAL_PRIVATE_ALREADY_ENTERED'});assert.equal(f.calls(),1);await f.host.close();
 const g=await r33Fixture();await assert.rejects(g.host.handlePrivateServicePayload(PUBLIC_CANONICAL({...JSON.parse(r33Frame),bindingDigest:'0'.repeat(64)})),{code:'AUTH_IDENTITY_IDE_PAYLOAD_BINDING_MISMATCH'});assert.equal(g.calls(),0);await g.host.close();
});
