// Actual SDK adapter + composed package, PUBLIC physical LINK boundary only.
// No Native loading, protected Source, signing, Go receiver or effect execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openOriginalTaskReadTransport} from '../src/desktop-grant-resource-transport-owner.mjs';
import {collectDesktopGrantNativeBackendInputsDATA} from '../scripts/native/desktop-grant-backend-inputs.mjs';
import {acquireOriginalTaskGrantAuthorityInputs} from '../src/desktop-grant-normal-inputs.mjs';
import {createOriginalTaskEffectOrchestrator} from '../src/desktop-grant-original-orchestration.mjs';
const require=createRequire(import.meta.url);
function boundary(pending=false){
 const dir=mkdtempSync(path.join(os.tmpdir(),'PUBLIC-paired-finite3-')),modulePath=path.join(dir,'physical.cjs');
 writeFileSync(modulePath,`const state={events:[],closes:0,options:null};let joined=false,closed=false;
 const response={copyDATA(){state.events.push('copyDATA');return{bodyComplete:true,method:'POST',service:'ynx-ai-original-task-read-v1',statusCode:200,body:Buffer.from('PUBLIC-transport-only')}} ,release(){state.events.push('release')}};
 const owner={current(){state.events.push('connectedCurrent')},exchange(id,wire,options){state.events.push('exchange');if(options!==state.options)throw Error('SAME_OPTIONS');return{response,errorPresent:false,error:null}},retire(){state.events.push('retire')},async join(){state.events.push('join');joined=true},async close(){state.events.push('close');state.closes++;closed=${!pending};return{physicalDone:closed,errorPresent:false,error:null}},lifetime(){return{joined,closed,firstCausePresent:false}},firstCause(){return undefined}};
 exports.state=state;exports.openOriginalTaskReadResourceCaller=(profile,options)=>{state.options=options;state.events.push('open');return{owner,errorPresent:false,error:null}};`);
 return {dir,modulePath,state:require(modulePath).state,remove(){rmSync(dir,{recursive:true,force:true})}};
}
test('composed physical adapter retains actual response and SAME options; release precedes physical close',async()=>{
 const f=boundary();let currentCalls=0;const options=Object.freeze({signal:new AbortController().signal});
 try{const a=await openOriginalTaskReadTransport({assertNativeCurrent(){currentCalls++}},Object.freeze({PUBLIC:true}),f.modulePath,'input',Buffer.from('PUBLIC-wire'),options);
  assert.equal(a.errorPresent,false);assert.equal(a.data.body.toString(),'PUBLIC-transport-only');assert(currentCalls>=4);assert.equal(f.state.options,options);
  const c=a.owner.close();assert.equal(a.owner.close(),c);assert.deepEqual(await c,{physicalDone:true,errorPresent:false,error:null,sourceFirstPresent:false,sourceFirst:undefined,transportFirstPresent:false,transportFirst:undefined});
  assert.equal(a.owner.isJoined(),true);assert.equal(a.owner.isClosed(),true);assert.equal(f.state.closes,1);assert(f.state.events.indexOf('copyDATA')<f.state.events.indexOf('release'));assert(f.state.events.indexOf('release')<f.state.events.indexOf('join'));
 }finally{f.remove()}
});
test('post-response independent Source failure keeps raw zero/null and packet through paired cleanup',async()=>{
 for(const cause of [0,null]){const f=boundary();let calls=0;
  try{const a=await openOriginalTaskReadTransport({assertNativeCurrent(){if(++calls>=4)throw cause}},Object.freeze({PUBLIC:true}),f.modulePath,'query',Buffer.from('PUBLIC-wire'));
   assert.equal(a.errorPresent,true);assert.equal(a.error,cause);assert.equal(a.sourceCurrentErrorPresent,true);assert.equal(a.data.body.toString(),'PUBLIC-transport-only');const r=await a.owner.close();assert.equal(r.physicalDone,true);assert.equal(r.errorPresent,true);assert.equal(r.error,cause);assert.equal(r.sourceFirstPresent,true);assert.equal(r.sourceFirst,cause);assert.equal(r.transportFirstPresent,false);assert.equal(f.state.closes,1);
  }finally{f.remove()}
 }
});
test('pending original physical owner remains unclosed; repeated close neither retries nor converts EOF to grant',async()=>{
 const f=boundary(true);
 try{const a=await openOriginalTaskReadTransport({assertNativeCurrent(){}},Object.freeze({PUBLIC:true}),f.modulePath,'input',Buffer.from('PUBLIC-wire'));const p=a.owner.close();assert.equal(a.owner.close(),p);const r=await p;assert.equal(r.physicalDone,false);assert.equal(r.errorPresent,true);assert.equal(a.owner.isClosed(),false);assert.equal(a.owner.lifetime().responseHeld,false);assert.equal(f.state.closes,1);assert.equal(await a.owner.close(),r)}finally{f.remove()}
});
test('R2 and paired orchestration normal closure match all source pins while Root0 remains refused',async()=>{
 const actual=collectDesktopGrantNativeBackendInputsDATA(fileURLToPath(new URL('../../..',import.meta.url)));assert.equal(actual.inputs.length,164);assert.equal(actual.RootAdmission,false);assert.equal(typeof createOriginalTaskEffectOrchestrator,'function');const a=await acquireOriginalTaskGrantAuthorityInputs();assert.equal(a.owner,null);assert.equal(a.errorPresent,true);assert.equal(a.error.code,'GRANT_PROTECTED_SOURCE_NOT_SUPPLIED');
});
