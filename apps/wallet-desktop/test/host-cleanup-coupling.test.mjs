import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=process.env.HOST_SOURCE??fileURLToPath(new URL('../src/',import.meta.url));
// PUBLIC same-ref cleanup fault injection, never loads the Native/SDK module
// or creates a real original Vault/Source, accepted session or grant.
function configuration({step,cause}){
 const text=readFileSync(root+'/original-admission-custodian.mjs','utf8'),calls=[];
 const vault={assertOriginalServiceAdmissionConfigurationCurrent:async()=>undefined},original={vault,raw:{PUBLIC:true},executor:{PUBLIC:true}};
 const action=name=>{calls.push(name);if(name===step)throw cause;};
 const source={acquire:async()=>original,assertCurrent:()=>undefined,assertExecutorCurrent:()=>undefined,assertAdmissionSuccession:()=>undefined,retire:()=>action('retire'),join:async()=>action('join'),close:async()=>action('close')};
 const context={PUBLIC_SOURCE:source,assertOriginalAdmissionVault(value){if(value!==vault)throw Error('PUBLIC_VAULT_REQUIRED');},captureOriginalAdmissionProductionContext(){throw Error('PUBLIC_NO_PRODUCTION');}};
 const code=text.replace(/^import .*;$/mg,'').replace(/const originalConfigurationSource=Object.freeze\(\{[\s\S]*?\n\}\);/,'const originalConfigurationSource=PUBLIC_SOURCE;').replaceAll('export ','');
 runInNewContext(code+'\nthis.api={acquireOriginalAdmissionConfiguration,retireOriginalAdmissionConfiguration,closeOriginalAdmissionConfiguration};',context);
 return {api:context.api,vault,calls};
}
function supplyAPI(){const text=readFileSync(root+'/original-admission-supply.mjs','utf8'),end=text.indexOf('export async function openOriginalAdmissionSupply'),context={};runInNewContext(text.slice(0,end).replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.api={release,unresolved};',context);return context.api;}
test('configuration retains each falsy retirement failure but still joins and closes the same original',async()=>{
 for(const cause of [false,null,undefined]){
  const f=configuration({step:'retire',cause}),ref=await f.api.acquireOriginalAdmissionConfiguration(f.vault,{assert(){}}),close=f.api.closeOriginalAdmissionConfiguration(ref);
  let rejected=false;try{await close;}catch(error){rejected=true;assert.equal(error,cause);}assert.equal(rejected,true);
  assert.deepEqual(f.calls,['retire','join','close']);assert.equal(f.api.closeOriginalAdmissionConfiguration(ref),close);
  await assert.rejects(f.api.acquireOriginalAdmissionConfiguration(f.vault,{assert(){}}),/UNRESOLVED/);
 }
});
test('configuration join failure never prevents independent original close or erases its first result',async()=>{
 const f=configuration({step:'join',cause:false}),ref=await f.api.acquireOriginalAdmissionConfiguration(f.vault,{assert(){}}),close=f.api.closeOriginalAdmissionConfiguration(ref);
 let rejected=false;try{await close;}catch(error){rejected=true;assert.equal(error,false);}assert.equal(rejected,true);assert.deepEqual(f.calls,['retire','join','close']);assert.equal(f.api.closeOriginalAdmissionConfiguration(ref),close);
});
test('prior explicit failed retirement is observed without calling retirement again or skipping close',async()=>{
 const f=configuration({step:'retire',cause:undefined}),ref=await f.api.acquireOriginalAdmissionConfiguration(f.vault,{assert(){}});let rejected=false;
 try{f.api.retireOriginalAdmissionConfiguration(ref);}catch(error){rejected=true;assert.equal(error,undefined);}assert.equal(rejected,true);
 try{await f.api.closeOriginalAdmissionConfiguration(ref);}catch(error){assert.equal(error,undefined);}
 assert.deepEqual(f.calls,['retire','join','close']);
});
test('supply cleanup independently attempts retirement, join and close; same pass and UNKNOWN remain',async()=>{
 for(const step of ['retire','join'])for(const cause of [false,null,undefined]){
  const a=supplyAPI(),calls=[],original={PUBLIC_ORIGINAL:true};let state,inner;
  const action=name=>{calls.push(name);inner=a.release(state);if(step===name)throw cause;};
  state={configured:original,closing:null,operationCausePresent:true,operationCause:'PUBLIC_ORIGINAL_ERROR',original:{retireOriginalAdmissionConfiguration:()=>action('retire'),joinOriginalAdmissionConfiguration:async()=>action('join'),closeOriginalAdmissionConfiguration:async()=>action('close')}};
  const close=a.release(state);let rejected=false;try{await close;}catch(error){rejected=true;assert.equal(error,cause);}assert.equal(rejected,true);
  assert.equal(inner,close);assert.equal(a.release(state),close);assert.deepEqual(calls,['retire','join','close']);assert.equal(state.configured,original);assert.equal(state.operationCause,'PUBLIC_ORIGINAL_ERROR');assert.equal(state.cleanupFailed,true);assert.equal(a.unresolved.has(state),true);
 }
});
