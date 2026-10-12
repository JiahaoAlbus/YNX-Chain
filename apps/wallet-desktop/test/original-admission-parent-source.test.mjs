import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Exact source, PUBLIC caller/resources; no product module imports or OS spawn.
export function publicParentAPI(){
 const text=readFileSync(new URL('../src/original-admission-parent-source.mjs',import.meta.url),'utf8');
 const names=[...text.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]);
 const context={};runInNewContext(text.replaceAll('export ','')+'\nthis.api={'+names.join(',')+'};',context);return context.api;
}
function fixture(){
 const api=publicParentAPI(),executor=Object.freeze({executable:'/PUBLIC/IDE',args:[],applicationId:'PUBLIC-app',consumerManifestDigest:'PUBLIC-digest',instanceId:'PUBLIC-instance',currentReference:'PUBLIC-reference',expiresAtMs:2000}),raw=Object.freeze({expiresAtMs:2000,expectedRequest:executor});
 let retired=false,checks=0;const check=()=>{checks++;if(retired)throw Error('PUBLIC_LOCKED');};
 api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:'same-vault'},raw,executor,assertCurrent:()=>undefined,originalConfiguration:{PUBLIC:'original-ref'}});
 const ref=api.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>1000,()=>undefined);
 return {api,ref,executor,lock:()=>{retired=true;},checks:()=>checks};
}
test('R12 PUBLIC parent reserves one launch before reentry and closes same source once',async()=>{
 const f=fixture();let launches=0,closes=0;const child={stdio:[null,null,null,null,{destroy(){closes++;}}]};
 assert.equal(f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{launches++;assert.throws(()=>f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{}),/ALREADY_ENTERED/);return child;}),child);
 f.api.retireOriginalAdmissionParentSource(f.ref);const close=f.api.closeOriginalAdmissionParentSource(f.ref);assert.equal(close,f.api.closeOriginalAdmissionParentSource(f.ref));await close;
 assert.equal(launches,1);assert.equal(closes,1);assert.throws(()=>f.api.assertOriginalAdmissionParentCurrent(f.ref),/RETIRED/);
 f.api.selectOriginalAdmissionParentOutcome(f.ref,value=>{assert.equal(value.child,child);assert.equal(value.closed,true);});
});
test('R12 PUBLIC parent joins entered callbacks and keeps falsy cleanup cause with exact child',async()=>{
 for(const cause of [false,0,'',null,undefined]){
  const f=fixture();let resolve,count=0;const child={stdio:[null,null,null,null,{destroy(){count++;throw cause;}}]};
  f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>child);
  const entered=new Promise(r=>{resolve=r;});f.api.trackOriginalAdmissionParentCall(f.ref,entered);
  const close=f.api.closeOriginalAdmissionParentSource(f.ref);let settled=false;void close.then(()=>settled=true,()=>settled=true);await Promise.resolve();assert.equal(settled,false);
  resolve();let thrown=false;try{await close;}catch(error){thrown=true;assert.equal(error,cause);}assert.equal(thrown,true);assert.equal(count,1);
  f.api.selectOriginalAdmissionParentOutcome(f.ref,value=>{assert.equal(value.cleanupFailurePresent,true);assert.equal(value.cleanupCause,cause);assert.equal(value.child,child);});
 }
});
test('R12 PUBLIC parent rejects unbound callback and preserves exact thrown launch cause',async()=>{
 const api=publicParentAPI();assert.throws(()=>api.acquireOriginalAdmissionParentSource(()=>{}, {},JSON.stringify,()=>1000,()=>{}),/NOT_SUPPLIED/);
 const f=fixture();assert.throws(()=>f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{throw false;}),error=>error===false);
 f.api.selectOriginalAdmissionParentOutcome(f.ref,value=>{assert.equal(value.firstCausePresent,true);assert.equal(value.firstCause,false);assert.equal(value.launchEntered,true);});
 await f.api.closeOriginalAdmissionParentSource(f.ref);assert.throws(()=>f.api.enterOriginalAdmissionParentLaunch(f.ref,()=>{}),/RETIRED/);
});
