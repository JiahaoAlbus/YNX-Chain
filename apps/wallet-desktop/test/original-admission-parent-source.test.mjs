import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Exact source, PUBLIC caller/resources; no product module imports or OS spawn.
export function publicParentAPI(){
 const text=readFileSync(process.env.PUBLIC_NATIVE_PARENT?new URL('file://'+process.env.PUBLIC_NATIVE_PARENT+'/original-admission-parent-source.mjs'):new URL('../src/original-admission-parent-source.mjs',import.meta.url),'utf8');
 const names=[...text.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]);
 const context={};runInNewContext(text.replaceAll('export ','')+'\nthis.api={'+names.join(',')+'};',context);return context.api;
}
function fixture({closeCausePresent=false,closeCause}={}){
 const api=publicParentAPI(),executor=Object.freeze({executable:'/PUBLIC/IDE',args:[],applicationId:'PUBLIC-app',consumerManifestDigest:'PUBLIC-digest',instanceId:'PUBLIC-instance',currentReference:'PUBLIC-reference',expiresAtMs:2000}),raw=Object.freeze({expiresAtMs:2000,expectedRequest:executor});
 let retired=false,checks=0;const check=()=>{checks++;if(retired)throw Error('PUBLIC_LOCKED');};
 let closes=0;
 const host={assertCurrent(){},readPending:()=>({pending:true,descriptor:41,currentReference:executor.currentReference,requestNonce:raw.expectedRequest.requestNonce}),beginPrelude:async()=>{},takeSenderDescriptor:()=>42,readInstalledFrame(){throw Error('PUBLIC_NO_FRAME');},acknowledge(){throw Error('PUBLIC_NO_ACK');},retire(){},async join(){},async close(){closes++;if(closeCausePresent)throw closeCause;},outcome:()=>({PUBLIC:true})};
 api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:'same-vault'},raw,executor,assertCurrent:()=>undefined,originalConfiguration:{reserveParentHost:()=>host}});
 const ref=api.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>1000,()=>undefined);
 return {api,ref,executor,lock:()=>{retired=true;},checks:()=>checks,closeCount:()=>closes};
}
test('R13 PUBLIC final synchronous executor callback cannot expire or cancel before spawn',()=>{
 for(const reason of ['expiry','cancel']){
  const api=publicParentAPI(),executor={executable:'/PUBLIC/IDE',args:[],applicationId:'PUBLIC-app',consumerManifestDigest:'PUBLIC-build',instanceId:'PUBLIC-instance',currentReference:'PUBLIC-ref',expiresAtMs:2000};
  let time=1000,locked=false,armed=false,spawned=0;
  const check=()=>{if(armed){if(reason==='expiry')time=2000;else locked=true;}};
  api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:true},raw:{expiresAtMs:2000,expectedRequest:executor},executor,assertCurrent(){}});
  const ref=api.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>time,()=>{if(locked)throw Error('PUBLIC_CANCELLED');});armed=true;
  assert.throws(()=>api.enterOriginalAdmissionParentLaunch(ref,()=>{spawned++;return {stdio:[]};}),/RETIRED|CANCELLED/);assert.equal(spawned,0);
 }
});
function r3ConfigurationAPI(source,vault){
 const text=readFileSync(new URL('../src/original-admission-custodian.mjs',import.meta.url),'utf8');
 const context={PUBLIC_SOURCE:source,captureOriginalAdmissionProductionContext:()=>{throw Error('PUBLIC_NO_PRODUCTION');},assertOriginalAdmissionVault:value=>{if(value!==vault)throw Error('PUBLIC_VAULT_REQUIRED');}};
 const sourceSlot=/const originalConfigurationSource=Object.freeze\(\{[\s\S]*?\n\}\);/;
 assert.match(text,sourceSlot);
 runInNewContext(text.replace(/^import .*;$/mg,'').replace(sourceSlot,'const originalConfigurationSource=PUBLIC_SOURCE;').replaceAll('export ','')+'\nthis.api={acquireOriginalAdmissionConfiguration,retireOriginalAdmissionConfiguration,joinOriginalAdmissionConfiguration,closeOriginalAdmissionConfiguration};',context);return context.api;
}
function r3SupplyReleaseAPI(){
 const text=readFileSync(new URL('../src/original-admission-supply.mjs',import.meta.url),'utf8'),end=text.indexOf('export async function openOriginalAdmissionSupply');
 const context={};runInNewContext(text.slice(0,end).replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.release=release;this.unresolved=unresolved;',context);return context;
}
test('R3 PUBLIC supply reserves same closing Promise BEFORE synchronous retire reentry',async()=>{
 const api=r3SupplyReleaseAPI();let retire=0,join=0,close=0,inner;
 const state={configured:{PUBLIC:true},closing:null,operationCausePresent:false,original:{retireOriginalAdmissionConfiguration(){retire++;inner=api.release(state);},joinOriginalAdmissionConfiguration(){join++;},closeOriginalAdmissionConfiguration(){close++;}}};
 const outer=api.release(state);await outer;assert.equal(inner,outer);assert.equal(api.release(state),outer);assert.equal(retire,1);assert.equal(join,1);assert.equal(close,1);assert.equal(state.closed,true);
});
test('R3 PUBLIC supply cleanup nonvoid/falsy rejection keeps same pass/debt and late raw',async()=>{
 for(const cause of [false,null,undefined,'PUBLIC_NONVOID']){
  const api=r3SupplyReleaseAPI();let closed=0;const original={PUBLIC_RAW:'exact-original'};
  const state={configured:original,closing:null,operationCausePresent:true,operationCause:false,original:{retireOriginalAdmissionConfiguration(){},joinOriginalAdmissionConfiguration(){},closeOriginalAdmissionConfiguration(){closed++;if(cause==='PUBLIC_NONVOID')return cause;throw cause;}}};
  const close=api.release(state);let rejected=false;try{await close;}catch(error){rejected=true;if(cause!=='PUBLIC_NONVOID')assert.equal(error,cause);}assert.equal(rejected,true);
  assert.equal(api.release(state),close);assert.equal(closed,1);assert.equal(state.cleanupFailed,true);assert.equal(state.configured,original);assert.equal(state.operationCause,false);assert.equal(api.unresolved.has(state),true);
 }
 const api=r3SupplyReleaseAPI(),state={configured:{PUBLIC_RAW:true},closing:null,operationCausePresent:true,original:{retireOriginalAdmissionConfiguration(){},joinOriginalAdmissionConfiguration(){},closeOriginalAdmissionConfiguration(){}}};
 api.unresolved.add(state);await api.release(state);assert.equal(state.closed,true);assert.equal(api.unresolved.has(state),true);
});
test('R3 PUBLIC fixed getter verifies original Vault/current, null is NOT supplied',async()=>{
 let calls=0;const vault={assertOriginalServiceAdmissionConfigurationCurrent:async()=>{calls++;}};
 const api=r3ConfigurationAPI(null,vault),guard={account:'PUBLIC',assert(){}};
 assert.equal(await api.acquireOriginalAdmissionConfiguration(vault,guard),null);assert.equal(calls,1);
 await assert.rejects(api.acquireOriginalAdmissionConfiguration({},guard),/VAULT_REQUIRED/);
});
test('R3 PUBLIC exact configuration retires synchronously, joins once, same-ref close once',async()=>{
 let alive=true,release,retired=0,joined=0,closed=0;const entered=new Promise(r=>{release=r;});
 const vault={assertOriginalServiceAdmissionConfigurationCurrent:async()=>undefined},original={vault,raw:{PUBLIC:true},executor:{PUBLIC:true},observer:{PUBLIC:true}};
 const source={acquire:async()=>original,assertCurrent:()=>undefined,assertExecutorCurrent:()=>undefined,assertAdmissionSuccession:()=>undefined,retire:value=>{assert.equal(value,original);retired++;},join:async value=>{assert.equal(value,original);joined++;await entered;},close:value=>{assert.equal(value,original);closed++;}};
 const api=r3ConfigurationAPI(source,vault),guard={account:'PUBLIC',assert(){if(!alive)throw false;}};
 const ref=await api.acquireOriginalAdmissionConfiguration(vault,guard);assert.equal(ref.raw,original.raw);
 alive=false;api.retireOriginalAdmissionConfiguration(ref);assert.throws(()=>ref.assertCurrent(),/RETIRED/);
 const close=api.closeOriginalAdmissionConfiguration(ref);assert.equal(api.closeOriginalAdmissionConfiguration(ref),close);
 await Promise.resolve();await Promise.resolve();assert.equal(closed,0);release();await close;
 assert.equal(retired,1);assert.equal(joined,1);assert.equal(closed,1);
});
test('R3 PUBLIC late acquisition fences clean exact original; falsy cleanup retains one debt',async()=>{
 for(const cause of [false,null,undefined]){
  let closeCalls=0;const vault={assertOriginalServiceAdmissionConfigurationCurrent:async()=>undefined},original={vault,raw:{},executor:{},observer:{}};
  const source={acquire:async()=>original,assertCurrent:()=>undefined,assertExecutorCurrent:()=>undefined,retire:()=>undefined,join:()=>undefined,close:()=>{closeCalls++;throw cause;}};
  const api=r3ConfigurationAPI(source,vault),ref=await api.acquireOriginalAdmissionConfiguration(vault,{assert(){}}),close=api.closeOriginalAdmissionConfiguration(ref);
  let failed=false;try{await close;}catch(error){failed=true;assert.equal(error,cause);}assert.equal(failed,true);assert.equal(api.closeOriginalAdmissionConfiguration(ref),close);assert.equal(closeCalls,1);
  await assert.rejects(api.acquireOriginalAdmissionConfiguration(vault,{assert(){}}),/UNRESOLVED/);
 }
 let alive=true,closed=0;const vault={assertOriginalServiceAdmissionConfigurationCurrent:async()=>undefined},original={vault,raw:{},executor:{},observer:{}};
 const api=r3ConfigurationAPI({acquire:async()=>{alive=false;return original;},retire:()=>undefined,join:()=>undefined,close:value=>{assert.equal(value,original);closed++;}},vault);
 await assert.rejects(api.acquireOriginalAdmissionConfiguration(vault,{assert(){if(!alive)throw Error('PUBLIC_LATE');}}),/PUBLIC_LATE/);assert.equal(closed,1);
});
test('R12 PUBLIC parent reserves one launch before reentry and closes same source once',async()=>{
 const f=fixture();let launches=0,closes=0;const child={stdio:[null,null,null,null,{destroy(){closes++;}}]};
 assert.equal(f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{launches++;assert.throws(()=>f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{}),/ALREADY_ENTERED/);return child;}),child);
 f.api.retireOriginalAdmissionParentSource(f.ref);const close=f.api.closeOriginalAdmissionParentSource(f.ref);assert.equal(close,f.api.closeOriginalAdmissionParentSource(f.ref));await close;
 assert.equal(launches,1);assert.equal(closes,0,'borrowed child fd is not a JS pipe');assert.equal(f.closeCount(),1);assert.throws(()=>f.api.assertOriginalAdmissionParentCurrent(f.ref),/RETIRED/);
 f.api.selectOriginalAdmissionParentOutcome(f.ref,value=>{assert.equal(value.child,child);assert.equal(value.closed,true);});
});
test('R12 PUBLIC parent joins entered callbacks and keeps falsy cleanup cause with exact child',async()=>{
 for(const cause of [false,0,'',null,undefined]){
  const f=fixture({closeCausePresent:true,closeCause:cause});let resolve,count=0;const child={stdio:[null,null,null,null,{destroy(){count++;throw Error('PUBLIC_BORROWED_FD');}}]};
  f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>child);
  const entered=new Promise(r=>{resolve=r;});f.api.trackOriginalAdmissionParentCall(f.ref,entered);
  const close=f.api.closeOriginalAdmissionParentSource(f.ref);let settled=false;void close.then(()=>settled=true,()=>settled=true);await Promise.resolve();assert.equal(settled,false);
  resolve();let thrown=false;try{await close;}catch(error){thrown=true;assert.equal(error,cause);}assert.equal(thrown,true);assert.equal(count,0);assert.equal(f.closeCount(),1);
  f.api.selectOriginalAdmissionParentOutcome(f.ref,value=>{assert.equal(value.cleanupFailurePresent,true);assert.equal(value.cleanupCause,cause);assert.equal(value.child,child);});
 }
});
test('R12 PUBLIC parent rejects unbound callback and preserves exact thrown launch cause',async()=>{
 const api=publicParentAPI();assert.throws(()=>api.acquireOriginalAdmissionParentSource(()=>{}, {},JSON.stringify,()=>1000,()=>{}),/NOT_SUPPLIED/);
 const f=fixture();assert.throws(()=>f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{throw false;}),error=>error===false);
 f.api.selectOriginalAdmissionParentOutcome(f.ref,value=>{assert.equal(value.firstCausePresent,true);assert.equal(value.firstCause,false);assert.equal(value.launchEntered,true);});
 await f.api.closeOriginalAdmissionParentSource(f.ref);assert.throws(()=>f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{}),/RETIRED/);
});
