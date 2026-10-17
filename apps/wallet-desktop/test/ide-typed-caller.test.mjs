import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const root=process.env.CALLER_SOURCE??new URL('../src/',import.meta.url).pathname;
const read=name=>readFileSync(root+'/'+name,'utf8');
// PUBLIC lexical caller tests only: no genuine Native module, Vault, grant,
// user profile, accepted session, signatures or OS protected originals.
function startup(cause){
 const vault={},calls=[],status={initialized:true,implementingModuleAvailable:false,nativeQualified:false,resourceSupplied:false};
 const c={initializeOriginalAuthIdentityIDEPrivateStartup(...args){calls.push(['ide',...args]);if(cause)throw cause;},originalAuthIdentityIDEStartupStatus(value){assert.equal(value,vault);calls.push(['status']);return status;},initializeOriginalAuthIdentityPrivateStartup(){throw Error('GENERIC_FORBIDDEN');},originalAuthIdentityStartupStatus(){throw Error('GENERIC_STATUS_FORBIDDEN');}};
 runInNewContext(read('original-auth-identity-startup.mjs').replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.initialize=initializeOriginalAuthIdentityStartup;',c);
 return {initialize:()=>c.initialize(vault),vault,calls,status};
}
test('IDE startup selects only dedicated SDK entry and status with the same Vault',()=>{
 const f=startup();assert.equal(f.initialize(),f.status);assert.deepEqual(f.calls,[['ide',f.vault],['status']]);
});
test('missing dedicated Native startup is unavailable, never generic fallback or qualification',()=>{
 const f=startup({code:'AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED'});assert.equal(f.initialize(),f.status);assert.equal(f.status.nativeQualified,false);assert.deepEqual(f.calls,[['ide',f.vault],['status']]);
});
test('unexpected dedicated startup failure retains exact error without fallback',()=>{
 const cause={PUBLIC:'original-error'},f=startup(cause);assert.throws(f.initialize,error=>error===cause);assert.deepEqual(f.calls,[['ide',f.vault]]);
});
test('IDE configuration acquires dedicated joint; common lifecycle and Host keep exact private owner',async()=>{
 const text=read('original-admission-custodian.mjs'),start=text.indexOf('const originalConfigurationSource='),end=text.indexOf('const configurations=',start);
 assert.ok(start>=0&&end>start);const vault={},guard={},owner={},selected={vault,raw:{PUBLIC:true},executor:{PUBLIC:true},observer:{PUBLIC:true}},calls=[];
 const record=name=>(value,...rest)=>{assert.equal(value,owner);calls.push([name,...rest]);return undefined;};
 const c={acquireOriginalAuthIdentityIDEJointConfiguration:async(...args)=>{assert.equal(args.length,2);assert.equal(args[0],vault);assert.equal(args[1],guard);calls.push(['ide-acquire']);return owner;},acquireOriginalAuthIdentityJointConfiguration(){throw Error('GENERIC_FORBIDDEN');},readOriginalAuthIdentityJointConfiguration:value=>{assert.equal(value,owner);return selected;},assertOriginalAuthIdentityJointCurrent:record('current'),assertOriginalAuthIdentityJointExecutorChild:record('executor'),assertOriginalAuthIdentityJointSuccession:record('succession'),reserveOriginalAuthIdentityIDEParentHost:record('host'),retireOriginalAuthIdentityJointConfiguration:record('retire'),joinOriginalAuthIdentityJointConfiguration:record('join'),closeOriginalAuthIdentityJointConfiguration:record('close')};
 runInNewContext(text.slice(start,end)+'\nthis.source=originalConfigurationSource;',c);const original=await c.source.acquire(vault,guard);
 assert.equal(original.owner,owner);assert.equal(original.raw,selected.raw);c.source.assertCurrent(original);c.source.assertExecutorCurrent(original,'PUBLIC-executor','PUBLIC-child');c.source.assertAdmissionSuccession(original,'PUBLIC-request');c.source.reserveParentHost(original);c.source.retire(original);await c.source.join(original);await c.source.close(original);
 assert.deepEqual(calls,[['ide-acquire'],['current'],['executor','PUBLIC-executor','PUBLIC-child'],['succession','PUBLIC-request'],['host'],['retire'],['join'],['close']]);
});
