import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import * as payload from '../src/original-ide-private-payload.js';
import {canonicalJSON} from '../src/canonical.js';
import {createOriginalPrivateReferenceCarrier} from '../src/original-wallet-service-private-reference.js';
const entry='file:///PUBLIC/server.mjs',requestId='req_PUBLIC_REQUEST_001',sha=x=>createHash('sha256').update(x).digest('hex');
const request=(id=requestId)=>canonicalJSON(createOriginalPrivateReferenceCarrier('complete',id,canonicalJSON({reference:'ynxpsr1_'+'A'.repeat(43),request:{version:'2'},completion:{challenge:{PUBLIC:true},deviceSignature:'PUBLIC_SIGNATURE'}})));
const response=(id=requestId)=>canonicalJSON({status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':id},body:canonicalJSON({ok:true,requestId:id,schemaVersion:2,result:{PUBLIC:true}})});
const proof=(raw=request())=>({responseRaw:response(JSON.parse(raw).requestId),responseDigest:sha(response(JSON.parse(raw).requestId)),requestDigest:sha(raw),associationDigest:'a'.repeat(64),stateBeforeDigest:'1'.repeat(64),stateAfterDigest:'2'.repeat(64),stateFileDigest:'3'.repeat(64),enteredDigest:'4'.repeat(64),recordVersion:3,success:true,dataOnly:true,effectRetryAuthorized:false,nativeAdmission:false});
function fixture(options={}){
 const owner={},events=[];let captures=0,reads=0,ready=0;
 const native={acquireOriginalIDEColdTerminalCustody(...args){assert.equal(args.length,0);captures++;if(options.captureThrow)throw options.cause;return owner;},assertOriginalHostTerminalJournalReady(o){assert.equal(o,owner);ready++;if(options.readyThrow||options.late&&reads)throw options.cause;},readOriginalHostRetainedTerminalCustody(o,raw){assert.equal(o,owner);reads++;return options.proof?options.proof(raw):proof(raw);},retireOriginalHostTerminalJournal(o){assert.equal(o,owner);events.push('retire');if(options.cleanupThrow)throw options.cleanupCause;},joinOriginalHostTerminalJournal(o){assert.equal(o,owner);events.push('join');},closeOriginalHostTerminalJournal(o){assert.equal(o,owner);events.push('close');if(options.closeThrow)throw options.cleanupCause;}};
 if(options.missing)delete native[options.missing];
 let source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export ','').replaceAll('import.meta.url','moduleURL').replaceAll("import('./original-ide-private-payload.js')","PUBLIC_IMPORT()");
 const ctx=vm.createContext({URL,fileURLToPath,resolve,dirname,join,process:{argv:['PUBLIC','/PUBLIC/server.mjs']},moduleURL:new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url).href,createRequire:()=>p=>{assert.equal(p,fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url))));return native;},originalIDEServiceAdmissionStartupSelection:null,PUBLIC_IMPORT:()=>options.importPayload?options.importPayload():Promise.resolve(payload)});
 vm.runInContext(source+'\nthis.api={acquire:acquireOriginalIDEColdTerminalCustody,cleanup:getOriginalIDEColdTerminalCustodyCleanup,parent:acquireOriginalIDEAdmissionParentDelivery};',ctx);
 return {api:ctx.api,events,captures:()=>captures,reads:()=>reads,ready:()=>ready};
}
// PUBLIC lexical Native seam drives actual production JS + actual codec only.
test('cold fixed no-parent DATA selection with null startup, no dispatch/ACK and once read',async()=>{
 const f=fixture();assert.equal(await f.api.parent(entry),null);const c=await f.api.acquire(entry);assert.equal(await f.api.acquire(entry),c);assert.equal(f.captures(),1);assert.equal(c.dispatch,undefined);assert.equal(c.acknowledge,undefined);
 const data=c.readTerminalCustody(request());assert.equal(data.proof.nativeAdmission,false);assert.equal(data.proof.effectRetryAuthorized,false);assert.equal(c.status().unknown,true);assert.equal(f.reads(),1);
 assert.throws(()=>c.readTerminalCustody(request()),{code:'IDE_COLD_TERMINAL_ALREADY_SELECTED'});assert.equal(f.reads(),1);await c.close();assert.deepEqual(f.events,['retire','join','close']);
});
test('missing formal callee refuses without fallback or replay',async()=>{
 const f=fixture({missing:'readOriginalHostRetainedTerminalCustody'});for(let i=0;i<2;i++)await assert.rejects(f.api.acquire(entry),{code:'IDE_COLD_IMPLEMENTATION_NOT_SUPPLIED'});assert.equal(f.captures(),0);await f.api.cleanup(entry).close();
});
for(const cause of [false,undefined])test('partial ready preserves exact '+String(cause)+' and cleanup once',async()=>{
 const f=fixture({readyThrow:true,cause,closeThrow:true,cleanupCause:'PUBLIC_CLEANUP'});await assert.rejects(f.api.acquire(entry),e=>e===cause);const c=f.api.cleanup(entry);await assert.rejects(f.api.acquire(entry),e=>e===cause);const closing=c.close();assert.equal(closing,c.close());await assert.rejects(closing,e=>e==='PUBLIC_CLEANUP');assert.equal(f.captures(),1);assert.deepEqual(f.events,['retire','join','close']);assert.equal(c.status().cleanupFailurePresent,true);await assert.rejects(f.api.acquire(entry),e=>e===cause);
});
test('throwing capture retains UNKNOWN cleanup debt and never reacquires',async()=>{
 const f=fixture({captureThrow:true,cause:undefined});await assert.rejects(f.api.acquire(entry),e=>e===undefined);const c=f.api.cleanup(entry);await assert.rejects(c.close(),{code:'IDE_COLD_CAPTURE_CUSTODY_UNKNOWN'});await assert.rejects(f.api.acquire(entry),e=>e===undefined);assert.equal(f.captures(),1);assert.equal(c.status().cleanupComplete,false);assert.equal(c.status().unknown,true);
});
test('late Native current failure retains proof internally but exposes no DATA or replay',async()=>{
 const f=fixture({late:true,cause:false}),c=await f.api.acquire(entry);assert.throws(()=>c.readTerminalCustody(request()),e=>e===false);assert.equal(c.status().retained,1);assert.equal(f.reads(),1);assert.throws(()=>c.readTerminalCustody(request()),e=>e===false);await c.close();
});
test('close while payload import pending drains partial owner and preserves cancellation cause',async()=>{
 let resume;const f=fixture({importPayload:()=>new Promise(r=>{resume=r;})});const acquisition=f.api.acquire(entry);void acquisition.catch(()=>{});await Promise.resolve();assert.equal(f.captures(),1);const c=f.api.cleanup(entry);c.retire(undefined);const closing=c.close();resume(payload);await assert.rejects(acquisition,e=>e===undefined);await closing;assert.deepEqual(f.events,['retire','join','close']);assert.equal(c.status().cleanupComplete,true);
});
test('close before acquire starts cancels without Native capture',async()=>{
 const f=fixture(),acquire=f.api.acquire(entry),c=f.api.cleanup(entry),close=c.close();await assert.rejects(acquire,{code:'IDE_COLD_CUSTODY_RETIRED'});await close;assert.equal(f.captures(),0);
});
test('13-field parser strict flags/digests/shape/canonical request; old ten-field stays strict',()=>{
 const raw=request(),p=proof(),check=p=>payload.captureOriginalIDEColdTerminalCustodyData(p,raw);assert.equal(check(p).proof.dataOnly,true);
 for(const bad of [{...p,dataOnly:false},{...p,nativeAdmission:true},{...p,effectRetryAuthorized:true},{...p,requestDigest:'f'.repeat(64)},{...p,responseDigest:'f'.repeat(64)},{...p,associationDigest:'bad'},{...p,recordVersion:4},{...p,success:false},{...p,extra:true},{...p,[Symbol('extra')]:true}])assert.throws(()=>check(bad));
 let touched=false;const accessor={...p};Object.defineProperty(accessor,'responseRaw',{get(){touched=true;throw Error('PUBLIC');},enumerable:true});assert.throws(()=>check(accessor));const proxy=new Proxy(p,{getPrototypeOf(){touched=true;throw Error('PUBLIC');}});assert.throws(()=>check(proxy));assert.equal(touched,false);
 assert.throws(()=>payload.captureOriginalIDEPrivateTerminalCustodyData(p,raw,{}));assert.throws(()=>payload.decodeOriginalIDEColdTerminalCustodyRequest(canonicalJSON({requestId,operation:'restore',phase:'time',body:null,proofHeader:null})));assert.throws(()=>payload.captureOriginalIDEColdTerminalCustodyData(p,raw+' '));
});
test('read capacity 64 and invalid entry do not enter Native',async()=>{
 const f=fixture();await assert.rejects(f.api.acquire('file:///PUBLIC/other.mjs'),{code:'IDE_ADMISSION_RUNNING_ENTRY_MISMATCH'});assert.equal(f.api.cleanup(entry),null);const c=await f.api.acquire(entry);
 for(let i=0;i<64;i++)c.readTerminalCustody(request('req_PUBLIC_REQUEST_'+String(i).padStart(3,'0')));
 assert.throws(()=>c.readTerminalCustody(request('req_PUBLIC_REQUEST_999')),{code:'IDE_COLD_TERMINAL_ALREADY_SELECTED'});assert.equal(f.reads(),64);await c.close();
});
test('bad Native DATA response never re-enters and preserves cleanup',async()=>{
 const f=fixture({proof:raw=>({...proof(raw),nativeAdmission:true})}),c=await f.api.acquire(entry);assert.throws(()=>c.readTerminalCustody(request()),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});assert.throws(()=>c.readTerminalCustody(request()),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});assert.equal(f.reads(),1);await c.close();
});
for(const cause of [false,undefined])test('payload import '+String(cause)+' retains captured owner and independent cleanup cause',async()=>{
 const f=fixture({importPayload:()=>Promise.reject(cause),cleanupThrow:true,cleanupCause:cause});await assert.rejects(f.api.acquire(entry),e=>e===cause);const c=f.api.cleanup(entry);await assert.rejects(c.close(),e=>e===cause);assert.equal(c.status().firstCausePresent,true);assert.equal(c.status().cleanupFailurePresent,true);assert.equal(c.status().cleanupComplete,false);assert.deepEqual(f.events,['retire','join','close']);await assert.rejects(f.api.acquire(entry),e=>e===cause);assert.equal(f.captures(),1);
});
test('close directly during pending import refuses late success and cleans once',async()=>{
 let resume;const f=fixture({importPayload:()=>new Promise(r=>{resume=r;})}),acquire=f.api.acquire(entry);void acquire.catch(()=>{});await Promise.resolve();const c=f.api.cleanup(entry),closing=c.close();resume(payload);await assert.rejects(acquire,{code:'IDE_COLD_CUSTODY_RETIRED'});await closing;assert.deepEqual(f.events,['retire','join','close']);
});
test('fulfilled factory refuses closed client and latched falsy failure without recapture',async()=>{
 const closed=fixture(),c=await closed.api.acquire(entry);await c.close();await assert.rejects(closed.api.acquire(entry),{code:'IDE_COLD_CUSTODY_RETIRED'});assert.equal(closed.captures(),1);
 const failed=fixture({late:true,cause:undefined}),d=await failed.api.acquire(entry);assert.throws(()=>d.readTerminalCustody(request()),e=>e===undefined);await assert.rejects(failed.api.acquire(entry),e=>e===undefined);assert.equal(failed.captures(),1);await d.close();
});
test('cold raw request cap is 65536 UTF-8 bytes before general decoder',()=>{
 const raw=request();assert.throws(()=>payload.decodeOriginalIDEColdTerminalCustodyRequest('x'.repeat(65537)),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});assert.throws(()=>payload.decodeOriginalIDEColdTerminalCustodyRequest('中'.repeat(21846)),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});for(const value of [null,undefined,{},''])assert.throws(()=>payload.decodeOriginalIDEColdTerminalCustodyRequest(value),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});assert.equal(payload.decodeOriginalIDEColdTerminalCustodyRequest(raw).requestId,requestId);
});
