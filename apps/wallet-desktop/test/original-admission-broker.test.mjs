import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function publicBroker(){
 const parent=readFileSync(process.env.PUBLIC_NATIVE_PARENT?new URL('file://'+process.env.PUBLIC_NATIVE_PARENT+'/original-admission-parent-source.mjs'):new URL('../src/original-admission-parent-source.mjs',import.meta.url),'utf8');
 const names=[...parent.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]),p={};runInNewContext(parent.replaceAll('export ','')+'\nthis.api={'+names.join(',')+'};',p);
 const text=readFileSync(process.env.PUBLIC_NATIVE_PARENT?new URL('file://'+process.env.PUBLIC_NATIVE_PARENT+'/original-admission-broker.mjs'):new URL('../src/original-admission-broker.mjs',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export ','');
 const context={...p.api,Object,JSON,Buffer,setTimeout,clearTimeout,spawnChild:()=>{throw Error('PUBLIC_REAL_SPAWN_FORBIDDEN');}};
 runInNewContext(text+'\nthis.api={launchOriginalAdmissionIDE,createOriginalAdmissionBroker,admissionCanonical,captureInstalledAdmission,selectRetainedOriginalAdmissionLaunches};',context);return {...context.api,...p.api};
}
// Old callbacks below are not selected in the R12 affected run.
const {createOriginalAdmissionBroker,admissionCanonical,captureInstalledAdmission,launchOriginalAdmissionIDE}=publicBroker();
test('R13 PUBLIC actual launcher final callback cancellation and expiry perform zero spawn',async()=>{
 for(const reason of ['expiry','cancel']){
  const api=publicBroker(),r=publication().selection.expectedRequest,executor={executable:'/PUBLIC/IDE',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000};
  let time=1000,locked=false,checks=0,spawns=0;
  const check=()=>{if(++checks===2){if(reason==='expiry')time=2000;else locked=true;}};
  api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:true},raw:{expiresAtMs:2500,expectedRequest:r},executor,assertCurrent(){}});
  await assert.rejects(api.launchOriginalAdmissionIDE({executor,assertExecutorCurrent:check,assertCustodyCurrent(){if(locked)throw Error('PUBLIC_CANCELLED');},now:()=>time,spawn(){spawns++;return {stdio:[]};}}));assert.equal(spawns,0);
 }
});
test('R12 PUBLIC actual broker rejects path and callback without fixed source binding before spawn',async()=>{
 const api=publicBroker(),r=publication().selection.expectedRequest;let count=0;
 const executor={executable:'/PUBLIC/IDE',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000};
 await assert.rejects(api.launchOriginalAdmissionIDE({executor,assertExecutorCurrent(){},assertCustodyCurrent(){},now:()=>1000,spawn(){count++;}}),/QUALIFICATION_NOT_SUPPLIED/);assert.equal(count,0);
});
test('R12 PUBLIC actual broker retains late spawned child on lock and never respawns',async()=>{
 const api=publicBroker(),r=publication().selection.expectedRequest,executor={executable:'/PUBLIC/IDE',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000},timers=new Set(),child=new EventEmitter();let locked=false,spawned=0,destroyed=0;
 child.stdio=[null,null,null,null,{destroy(){destroyed++;}}];const check=()=>undefined;
 api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:'same'},raw:{expiresAtMs:2500,expectedRequest:r},executor,assertCurrent:()=>undefined});
 const work=api.launchOriginalAdmissionIDE({executor,assertExecutorCurrent:check,assertCustodyCurrent(){if(locked)throw false;},now:()=>1000,schedule(fn,ms){const timer={fn,ms};timers.add(timer);return timer;},unschedule(timer){timers.delete(timer);},spawn(){spawned++;return child;}});
 locked=true;for(const timer of [...timers].filter(x=>x.ms===25))timer.fn();let rejected=false;try{await work;}catch(error){rejected=true;assert.equal(error,false);}assert.equal(rejected,true);
 child.emit('spawn');assert.equal(spawned,1);assert.equal(destroyed,1);assert.equal(timers.size,0);
 api.selectRetainedOriginalAdmissionLaunches(value=>{assert.equal(value.child,child);assert.equal(value.firstCausePresent,true);assert.equal(value.firstCause,false);});
});
test('R12 PUBLIC actual broker normal mocked launch delegates one channel retirement and joins custody',async()=>{
 const api=publicBroker(),r=publication().selection.expectedRequest,executor={executable:'/PUBLIC/IDE',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000},child=new EventEmitter(),stream=new EventEmitter(),timers=new Set();let destroys=0,spawns=0;
 stream.destroy=()=>{destroys++;};child.stdio=[null,null,null,null,stream];const check=()=>undefined;
 api.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:'same'},raw:{expiresAtMs:2500,expectedRequest:r},executor,assertCurrent:()=>undefined});
 const options={executor,assertExecutorCurrent:check,assertCustodyCurrent(){},now:()=>1000,schedule(fn,ms){const t={fn,ms};timers.add(t);return t;},unschedule(t){timers.delete(t);},spawn(){spawns++;queueMicrotask(()=>child.emit('spawn'));return child;}};
 const broker=await api.launchOriginalAdmissionIDE(options);broker.assertCurrent();broker.close();broker.close();await broker.joinEntered();assert.equal(spawns,1);assert.equal(destroys,1);assert.equal(timers.size,0);
 await assert.rejects(api.launchOriginalAdmissionIDE(options),/ALREADY_ENTERED/);assert.equal(spawns,1);
 let held=0;api.selectRetainedOriginalAdmissionLaunches(()=>held++);assert.equal(held,0);
});
test('R10 absolute expiry closes endpoint while joining pending hold callback',async()=>{const stream=new PublicStream(),timers=new Set();let clock=1000,release,checks=0;const broker=createOriginalAdmissionBroker({stream,now:()=>clock,assertChannelCurrent(){},schedule(fn,ms){const t={fn,ms};timers.add(t);return t;},unschedule(t){timers.delete(t);}}),p=publication();const sent=broker.deliver(p);stream.done();stream.emit('data',admissionCanonical(ack(p))+'\n');await sent;let settled=false;const retired=broker.waitRetirement(()=>{checks++;return new Promise(r=>release=r);});retired.then(()=>settled=true);clock=2000;for(const t of [...timers])t.fn();await Promise.resolve();assert.equal(stream.destroyed,true);assert.equal(settled,false);release();assert.equal((await retired).reason,'ADMISSION_EPOCH_EXPIRED');assert.equal(checks,1);});
test('R10 cancellation joins pending write completion separately from EOF',async()=>{const f=fixture(),work=f.broker.deliver(publication());f.broker.close();await assert.rejects(work);let joined=false;const drain=f.broker.joinEntered().then(()=>joined=true);await Promise.resolve();assert.equal(joined,false);f.stream.done();await drain;assert.equal(joined,true);});
test('R10 executor approval cannot rewrite selected executable before launch',async()=>{const r=publication().selection.expectedRequest;let spawned=0;await assert.rejects(launchOriginalAdmissionIDE({executor:{executable:'/PUBLIC/executor',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000},now:()=>1000,assertCustodyCurrent(){},assertExecutorCurrent(selected){selected.executable='/PUBLIC/substitution';},spawn(){spawned++;throw Error('unexpected spawn');}}));assert.equal(spawned,0);});
// PUBLIC records only. No original signature, holder, key or runtime claim.
function publication(){const h='a'.repeat(64),n='a'.repeat(43);return {account:'PUBLIC-account',sequence:1,expiresAtMs:2000,selection:{sourceSelection:{rootPath:'/PUBLIC/root',rootDigest:h,rolePath:'/PUBLIC/role',roleDigest:h},receiptSelection:{receiptPath:'/PUBLIC/receipts/'+n+'.admission.json',receiptDigest:h},receiptDirectory:'/PUBLIC/receipts',expectedRequest:{version:1,purpose:'wallet-product-session-v2-service-admission/v1',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:h,consumerManifestDigest:h,gatewayManifestDigest:h,instanceId:'PUBLIC-instance',currentReference:h,operations:['beginYNX','handleReturn','restore','disconnect'],requestNonce:n,requestedAtMs:900,expiresAtMs:2500}}};}
class PublicStream extends EventEmitter{write(wire,done){this.wire=wire;this.done=done;this.onWrite?.();}destroy(){this.destroyed=true;}}
function ack(p){return {type:'ack',requestNonce:p.selection.expectedRequest.requestNonce,receiptDigest:p.selection.receiptSelection.receiptDigest,sequence:p.sequence,consumerManifestDigest:p.selection.expectedRequest.consumerManifestDigest};}
function fixture(){const stream=new PublicStream();let time=1000,live=true;const broker=createOriginalAdmissionBroker({stream,now:()=>time,assertChannelCurrent(){assert.ok(live,'PUBLIC original launcher retired');}});return {stream,broker,time:v=>time=v,retire:()=>live=false};}
test('R9 PUBLIC exact ACK requires both write completion and immutable epoch',async()=>{const f=fixture(),p=publication(),work=f.broker.deliver(p);f.stream.emit('data',admissionCanonical(ack(p))+'\n');let settled=false;work.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);f.stream.done();await work;assert.equal(JSON.parse(f.stream.wire).type,'installed');assert.equal(f.stream.wire.includes('PUBLIC-account'),false);f.broker.close();});
test('R9 PUBLIC EOF after delivery is uncertain and same broker never sends twice',async()=>{const f=fixture(),work=f.broker.deliver(publication());f.stream.emit('end');await assert.rejects(work,{code:'ADMISSION_CHANNEL_EOF'});await assert.rejects(f.broker.deliver(publication()));assert.equal(f.stream.destroyed,true);});
test('R9 PUBLIC conflicting ACK retires held epoch',async()=>{const f=fixture(),p=publication(),work=f.broker.deliver(p);f.stream.done();f.stream.emit('data',admissionCanonical({...ack(p),sequence:2})+'\n');await assert.rejects(work,{code:'ADMISSION_ACK_MISMATCH'});});
test('R9 PUBLIC oversized/duplicate framed reply never becomes ACK',async()=>{for(const data of ['x'.repeat(65537),admissionCanonical(ack(publication()))+'\n'+admissionCanonical(ack(publication()))+'\n']){const f=fixture(),work=f.broker.deliver(publication());f.stream.emit('data',data);await assert.rejects(work);}});
test('R9 PUBLIC expiry and original channel revocation fence delayed ACK',async()=>{for(const change of [f=>f.time(2000),f=>f.retire()]){const f=fixture(),p=publication(),work=f.broker.deliver(p);f.stream.done();change(f);f.stream.emit('data',admissionCanonical(ack(p))+'\n');await assert.rejects(work);}});
test('R9 PUBLIC canonical capture rejects accessor and wrong receipt path',()=>{assert.throws(()=>captureInstalledAdmission({...publication(),get account(){throw Error('must not execute');}},1000),{code:'ADMISSION_RECORD_INVALID'});const p=publication();p.selection.receiptSelection.receiptPath='/PUBLIC/wrong';assert.throws(()=>captureInstalledAdmission(p,1000));});
test('R9 PUBLIC Wallet-parent launcher preserves only dedicated duplex4 and original approval fences',async()=>{
 const p=publication(),executor={executable:'/PUBLIC/approved/YNX Developer',args:[],applicationId:'com.ynxweb4.developer.testnetpreview',consumerManifestDigest:p.selection.expectedRequest.consumerManifestDigest,instanceId:'PUBLIC-instance',currentReference:p.selection.expectedRequest.currentReference,expiresAtMs:2000},child=new EventEmitter(),stream=new PublicStream();child.stdio=[null,null,null,null,stream];let spawned=0,checks=0;
 const work=launchOriginalAdmissionIDE({executor,now:()=>1000,assertCustodyCurrent(){checks++;},assertExecutorCurrent(selected,current){assert.equal(selected.executable,executor.executable);assert.ok(current===null||current===child);},spawn(executable,args,options){spawned++;assert.equal(executable,executor.executable);assert.deepEqual(options.stdio,['ignore','inherit','inherit','ignore','pipe']);assert.equal(options.shell,false);assert.equal(options.env.NODE_OPTIONS,undefined);queueMicrotask(()=>child.emit('spawn'));return child;}});
 const broker=await work;assert.equal(spawned,1);assert.ok(checks>=2);child.emit('exit',0);assert.throws(()=>broker.assertCurrent());assert.equal(stream.destroyed,true);
});
test('R9 PUBLIC missing or refused original executor cannot spawn by path/hash alone',async()=>{
 let entered=0;await assert.rejects(launchOriginalAdmissionIDE({executor:null,spawn(){entered++;}}));
 const p=publication(),executor={executable:'/PUBLIC/executor',args:[],applicationId:'com.ynxweb4.developer.testnetpreview',consumerManifestDigest:p.selection.expectedRequest.consumerManifestDigest,instanceId:'PUBLIC-instance',currentReference:p.selection.expectedRequest.currentReference,expiresAtMs:2000};
 await assert.rejects(launchOriginalAdmissionIDE({executor,now:()=>1000,assertCustodyCurrent(){},assertExecutorCurrent(){throw Error('PUBLIC executor not approved');},spawn(){entered++;}}));assert.equal(entered,0);
});
test('R9 PUBLIC acknowledged epoch stays held only until original expiry; no second delivery',async()=>{
 const stream=new PublicStream();let clock=1000,tick;const broker=createOriginalAdmissionBroker({stream,now:()=>clock,assertChannelCurrent(){},schedule:fn=>{tick=fn;return 1;},unschedule(){}}),p=publication();
 const work=broker.deliver(p);stream.done();stream.emit('data',admissionCanonical(ack(p))+'\n');await work;
 let checked=0;const retired=broker.waitRetirement(async()=>{checked++;});await Promise.resolve();assert.equal(stream.destroyed,undefined);assert.equal(checked,1);clock=2000;await tick();assert.equal((await retired).reason,'ADMISSION_EPOCH_EXPIRED');assert.equal(stream.destroyed,true);await assert.rejects(broker.deliver(p));
});
test('R9 PUBLIC a Promise is not a completed original channel-current check',async()=>{const stream=new PublicStream(),broker=createOriginalAdmissionBroker({stream,assertChannelCurrent:()=>Promise.resolve(),now:()=>1000});await assert.rejects(broker.deliver(publication()),{code:'ADMISSION_CURRENT_INVALID'});assert.equal(stream.wire,undefined);broker.close();});
