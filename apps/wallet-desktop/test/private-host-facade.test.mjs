import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const root=process.env.HOST_SOURCE??new URL('../src/',import.meta.url).pathname;
const text=readFileSync(root+'/original-admission-custodian.mjs','utf8');
// PUBLIC closure reachability only: no SDK/Native import, actual joint,
// original Source, vault secret, grant, OS operation or accepted service.
function fixture({duringReserve}={}){
 let locked=false,reserves=0;const vault={assertOriginalServiceAdmissionConfigurationCurrent:async()=>undefined};
 const original={vault,raw:{PUBLIC:true},executor:{PUBLIC:true},observer:{PUBLIC:true},owner:{PUBLIC_ONLY:true}},host={PUBLIC_PARTIAL:true};
 const source={acquire:async()=>original,assertCurrent:()=>undefined,assertExecutorCurrent:()=>undefined,assertAdmissionSuccession:()=>undefined,reserveParentHost(value){assert.equal(value,original);reserves++;duringReserve?.(()=>{locked=true;});return host;},retire:()=>undefined,join:async()=>undefined,close:async()=>undefined};
 const code=text.replace(/^import .*;$/mg,'').replace(/const originalConfigurationSource=Object.freeze\(\{[\s\S]*?\n\}\);/,'const originalConfigurationSource=PUBLIC_SOURCE;').replaceAll('export ','');
 const context={PUBLIC_SOURCE:source,captureOriginalAdmissionProductionContext(){throw Error('PUBLIC_NO_PRODUCTION');},assertOriginalAdmissionVault(value){if(value!==vault)throw Error('PUBLIC_VAULT_REQUIRED');}};
 runInNewContext(code+'\nthis.api={acquireOriginalAdmissionConfiguration,closeOriginalAdmissionConfiguration};',context);
 return {api:context.api,vault,host,guard:{assert(){if(locked)throw Error('PUBLIC_LOCKED');}},lock:()=>{locked=true;},reserves:()=>reserves};
}
test('fixed custodian delegates only its captured SDK private owner to the actual facade factory',()=>{
 assert.match(text,/import \{reserveOriginalAuthIdentityIDEParentHost\} from '\.\.\/\.\.\/\.\.\/packages\/wallet-auth\/src\/original-ide-parent-host\.js'/);
 assert.match(text,/reserveParentHost:original=>reserveOriginalAuthIdentityIDEParentHost\(original\.owner\)/);
});
test('private configuration retains its original selection without exposing joint or intent',async()=>{
 const f=fixture(),ref=await f.api.acquireOriginalAdmissionConfiguration(f.vault,f.guard);
 assert.equal(ref.reserveParentHost(),f.host);assert.equal(f.reserves(),1);assert.equal(Object.hasOwn(ref,'owner'),false);assert.equal(Object.hasOwn(ref,'joint'),false);
 await f.api.closeOriginalAdmissionConfiguration(ref);
});
test('pre-reservation guard refuses without entering Native selection',async()=>{
 const f=fixture(),ref=await f.api.acquireOriginalAdmissionConfiguration(f.vault,f.guard);f.lock();
 assert.throws(()=>ref.reserveParentHost(),/PUBLIC_LOCKED/);assert.equal(f.reserves(),0);await f.api.closeOriginalAdmissionConfiguration(ref);
});
test('late cancellation cannot discard a returned partial Host before caller capture',async()=>{
 const f=fixture({duringReserve:lock=>lock()}),ref=await f.api.acquireOriginalAdmissionConfiguration(f.vault,f.guard);
 const partial=ref.reserveParentHost();assert.equal(partial,f.host);assert.throws(()=>ref.assertCurrent(),/PUBLIC_LOCKED/);await f.api.closeOriginalAdmissionConfiguration(ref);
});
