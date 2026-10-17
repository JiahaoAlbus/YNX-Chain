import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
// Exact product source; public resource stand-ins only. No Native module,
// accepted service authority, real account, OS spawn, signature or payment.
async function fixture(){
 const location=process.env.PARENT_SOURCE??new URL('../src/original-admission-parent-source.mjs',import.meta.url);
 const text=readFileSync(location,'utf8'),names=[...text.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]),context={};
 runInNewContext(text.replaceAll('export ','')+'\nthis.api={'+names.join(',')+'};',context);
 const api=context.api,executor={executable:'/PUBLIC/NO_OS_EXECUTION',args:[],applicationId:'PUBLIC-only',consumerManifestDigest:'PUBLIC-only',instanceId:'PUBLIC-only',currentReference:'PUBLIC-only',expiresAtMs:2000},check=()=>undefined;
 let finish;const host={assertCurrent(){},readPending:()=>({pending:true,descriptor:41,currentReference:executor.currentReference,requestNonce:'PUBLIC'}),beginPrelude:()=>new Promise(resolve=>{finish=resolve;}),takeSenderDescriptor:()=>42,readInstalledFrame(){throw Error('PUBLIC_NO_FRAME');},acknowledge(){throw Error('PUBLIC_NO_ACK');},retire(){finish?.();},async join(){},async close(){},outcome:()=>({PUBLIC:true})};
 api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:true},raw:{expiresAtMs:2000,expectedRequest:{...executor,requestNonce:'PUBLIC'}},executor,assertCurrent:()=>undefined,originalConfiguration:{reserveParentHost:()=>host}});
 const ref=api.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>1000,()=>undefined);
 const child={stdio:[null,null,null,null,{destroy(){throw Error('unexpected raw stream close');}}]};
 api.enterOriginalAdmissionParentLaunch(ref,()=>{finish();return child;});await api.waitOriginalAdmissionParentPrelude(ref);
 const stream=new EventEmitter();stream.destroy=()=>{if(stream.destroyed)return;stream.destroyed=true;queueMicrotask(()=>stream.emit('close'));};api.takeOriginalAdmissionParentStream(ref,()=>stream,()=>{});
 return {api,ref,child};
}
test('same parent close Promise is reserved before a channel close can reenter',async()=>{
 const {api,ref,child}=await fixture();let inner,calls=0;
 api.attachOriginalAdmissionParentChannel(ref,{close(){calls++;inner=api.closeOriginalAdmissionParentSource(ref);}});
 const outer=api.closeOriginalAdmissionParentSource(ref);
 await outer;assert.equal(inner,outer);assert.equal(api.closeOriginalAdmissionParentSource(ref),outer);assert.equal(calls,1);
 api.selectOriginalAdmissionParentOutcome(ref,s=>{assert.equal(s.child,child);assert.equal(s.retired,true);assert.equal(s.closed,true);});
});
test('retirement observer reentry receives the identical pass while entered work drains',async()=>{
 const {api,ref}=await fixture();let release,inner,observed=0,closed=0;
 api.attachOriginalAdmissionParentChannel(ref,{close(){closed++;}});
 const work=new Promise(resolve=>{release=resolve;});api.trackOriginalAdmissionParentCall(ref,work);
 api.onOriginalAdmissionParentRetirement(ref,()=>{if(observed++===0)inner=api.closeOriginalAdmissionParentSource(ref);});
 const outer=api.closeOriginalAdmissionParentSource(ref);let done=false;void outer.then(()=>{done=true;});
 await Promise.resolve();assert.equal(done,false);assert.equal(inner,outer);
 release();await outer;assert.equal(closed,1);assert.equal(observed,1);
});
test('reentrant falsy cleanup failure is retained on one rejected pass and exact child',async()=>{
 const {api,ref,child}=await fixture();let inner,calls=0;
 api.attachOriginalAdmissionParentChannel(ref,{close(){calls++;inner=api.closeOriginalAdmissionParentSource(ref);throw false;}});
 const outer=api.closeOriginalAdmissionParentSource(ref);let rejected=false;
 try{await outer;}catch(error){rejected=true;assert.equal(error,false);}
 assert.equal(rejected,true);assert.equal(inner,outer);assert.equal(calls,1);assert.equal(api.closeOriginalAdmissionParentSource(ref),outer);
 api.selectOriginalAdmissionParentOutcome(ref,s=>{assert.equal(s.child,child);assert.equal(s.cleanupFailurePresent,true);assert.equal(s.cleanupCause,false);assert.equal(s.closed,false);});
});
test('throwing retirement observer retains falsy debt on the reserved pass without a retry',async()=>{
 const {api,ref}=await fixture();let observed=0;
 api.attachOriginalAdmissionParentChannel(ref,{close(){}});
 api.onOriginalAdmissionParentRetirement(ref,()=>{observed++;throw undefined;});
 const outer=api.closeOriginalAdmissionParentSource(ref);let rejected=false;
 try{await outer;}catch(error){rejected=true;assert.equal(error,undefined);}
 assert.equal(rejected,true);assert.equal(observed,1);assert.equal(api.closeOriginalAdmissionParentSource(ref),outer);
 api.selectOriginalAdmissionParentOutcome(ref,s=>{assert.equal(s.cleanupFailurePresent,true);assert.equal(s.cleanupCause,undefined);assert.equal(s.closed,false);});
});
