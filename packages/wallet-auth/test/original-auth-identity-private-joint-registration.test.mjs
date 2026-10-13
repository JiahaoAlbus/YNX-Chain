import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// PUBLIC lexical machinery controls. No real .node module, root/profile,
// protected file, crypto or Native authority is loaded or supplied.
const text=readFileSync(new URL('../src/original-auth-identity-private-joint-registration.js',import.meta.url),'utf8');
function fixture({missing=false,commitFailure=false}={}){
 const association={account:'PUBLIC_ACCOUNT',clientId:'PUBLIC_CLIENT',productId:'developer',platform:'macos',applicationId:'PUBLIC_APP',deviceId:'PUBLIC_DEVICE'},original={},joint={},localRef={},events=[];
 let live=true,closed=0,commits=0;const localOriginal={scope:'LOCAL_SELECTED_VAULT',account:'PUBLIC_ACCOUNT',nativeQualified:false,independentLatest:false};
 const guard={assert(){if(!live)throw false;}};
 const local={read:async()=>localOriginal,assertObservationCurrent:value=>{assert.equal(value,localOriginal);guard.assert();},close:async()=>{events.push('local-close');}};
 const vault={acquireOriginalServiceRoleLocalCurrentSource:async()=>localRef};
 local.vault=vault;
 const installed={vault,association,raw:{PUBLIC:'original'},executor:{PUBLIC:'executor'},observer:{PUBLIC:'observer'}};
 const native={acquireOriginalAdministrationProfile:async()=>original,readOriginalAdministrationProfile:value=>{assert.equal(value,original);return {association,expectedLocalCurrent:{PUBLIC:true}};},assertOriginalAdministrationProfileCurrent:value=>{assert.equal(value,original);guard.assert();},reserveOriginalJointRegistration:async(value,localValue)=>{assert.equal(value,original);assert.equal(localValue,localOriginal);events.push('reserved');return joint;},commitOriginalJointRegistration:async value=>{assert.equal(value,joint);commits++;if(commitFailure)throw undefined;return {PUBLIC:'original-commit'};},readOriginalJointRegistration:value=>{assert.equal(value,joint);return installed;},assertOriginalJointCurrent:value=>{assert.equal(value,joint);guard.assert();},assertOriginalJointExecutorChild:(value,executor,child)=>{assert.equal(value,joint);assert.equal(executor,installed.executor);if(child==='FOREIGN')throw Error('PUBLIC_CHILD_MISMATCH');},assertOriginalJointSuccession:()=>guard.assert(),retireOriginalJoint:()=>{events.push('retire');},joinOriginalJoint:async()=>{events.push('join');},closeOriginalJoint:async()=>{closed++;events.push('native-close');}};
 Object.assign(native,{retireOriginalAdministrationProfile:value=>assert.equal(value,original),joinOriginalAdministrationProfile:async()=>undefined,closeOriginalAdministrationProfile:async()=>{events.push('admin-close');}});
 const context=vm.createContext({PUBLIC_NATIVE:missing?{}:native,assertOriginalAdmissionVault:value=>{if(value!==vault)throw Error('PUBLIC_FOREIGN_VAULT');},captureOriginalServiceRoleLocalCurrentSource:value=>{assert.equal(value,localRef);return local;}});
 const body=text.replace(/^import .*;$/mg,'').replace('const requireOriginal=createRequire(import.meta.url);','').replace(/^const loadOriginalNative=.*;$/m,'const loadOriginalNative=()=>PUBLIC_NATIVE;').replaceAll('export ','');
 vm.runInContext(body+'\nthis.api={initializeOriginalAuthIdentityPrivateStartup,originalAuthIdentityStartupStatus,acquireOriginalAuthIdentityJointConfiguration,readOriginalAuthIdentityJointConfiguration,assertOriginalAuthIdentityJointCurrent,assertOriginalAuthIdentityJointExecutorChild,retireOriginalAuthIdentityJointConfiguration,joinOriginalAuthIdentityJointConfiguration,closeOriginalAuthIdentityJointConfiguration,originalAuthIdentityJointOutcome,originalAuthIdentityStartupUnresolved};',context);
 return {api:context.api,vault,guard,installed,events,invalidate(){live=false;},closed:()=>closed,commits:()=>commits};
}
test('R11 PUBLIC fixed startup refuses missing implementing exports and never claims qualification',async()=>{
 const f=fixture({missing:true});assert.throws(()=>f.api.initializeOriginalAuthIdentityPrivateStartup(f.vault),/NOT_IMPLEMENTED/);assert.equal(f.api.originalAuthIdentityStartupStatus(f.vault).implementingModuleAvailable,false);assert.equal(f.api.originalAuthIdentityStartupStatus(f.vault).nativeQualified,false);await assert.rejects(f.api.acquireOriginalAuthIdentityJointConfiguration(f.vault,f.guard),/NOT_IMPLEMENTED/);assert.equal(f.commits(),0);
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
