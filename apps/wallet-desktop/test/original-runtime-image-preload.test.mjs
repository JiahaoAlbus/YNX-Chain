import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {PUBLICPreloadAdmission as fixture,PUBLICOriginalPreloadOwner} from './public-device-finalization-native.fixture.mjs';
const target=new URL('../src/original-runtime-image-preload.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(context.parentURL===target&&specifier==='../../../packages/wallet-auth/src/original-auth-runtime-image-source-v1.js')return{url:new URL('./public-device-finalization-native.fixture.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
const {createOriginalRuntimeImagePreloadController}=await import('../src/original-runtime-image-preload.mjs');
function owner(events,methods={}){return PUBLICOriginalPreloadOwner({async recheck(){events.push('recheck');},retire(){events.push('retire');},async join(){events.push('join');},async close(){events.push('close');},...methods});}
test('actual Main caller waits for original async acquisition and refreshes before a later synchronous load',async()=>{
 const events=[],held=owner(events);let release,started;const entered=new Promise(r=>started=r);
 fixture.acquire=()=>{events.push('acquire');started();return new Promise(r=>release=r);};fixture.current=()=>{events.push('current');};
 const main=createOriginalRuntimeImagePreloadController(),a=main.ensureCurrent(),b=main.ensureCurrent();await entered;assert.deepEqual(events,['acquire']);release(Object.freeze({owner:held,error:null}));await Promise.all([a,b]);main.assertCurrent();await main.ensureCurrent();assert.equal(events.filter(e=>e==='acquire').length,1);assert.equal(events.filter(e=>e==='recheck').length,1);await main.close();assert.deepEqual(events.slice(-3),['retire','join','close']);
});
for(const cause of [false,0,null,undefined,''])test('nonnull original admission partial retains failure '+String(cause)+' and is drained once',async()=>{
 const events=[],held=owner(events);fixture.acquire=()=>Object.freeze({owner:held,error:cause});fixture.current=()=>{};
 const main=createOriginalRuntimeImagePreloadController();if(cause===null){await main.ensureCurrent();}else{await assert.rejects(main.ensureCurrent(),e=>e===cause);await assert.rejects(main.ensureCurrent(),e=>e===cause);}
 await main.close();await main.close();assert.deepEqual(events,['retire','join','close']);
});
test('late retirement during acquisition adopts and closes the returned original before releasing the controller',async()=>{
 const events=[],held=owner(events);let release,started;const entered=new Promise(r=>started=r);
 fixture.acquire=()=>{started();return new Promise(r=>release=r);};fixture.current=()=>{};
 const main=createOriginalRuntimeImagePreloadController(),pending=main.ensureCurrent();await entered;const rejected=assert.rejects(pending,{code:'RUNTIME_IMAGE_PRELOAD_RETIRED'}),closing=main.close();release(Object.freeze({owner:held,error:null}));await rejected;await closing;assert.deepEqual(events,['retire','join','close']);
});
test('UNKNOWN close retains the original falsy cleanup result and does not retry physical close',async()=>{
 const events=[],held=owner(events,{async close(){events.push('close');throw false;}});fixture.acquire=()=>Object.freeze({owner:held,error:null});fixture.current=()=>{};
 const main=createOriginalRuntimeImagePreloadController();await main.ensureCurrent();await assert.rejects(main.close(),e=>e===false);await assert.rejects(main.close(),e=>e===false);assert.deepEqual(events,['retire','join','close']);
});
test('a current refusal after successful acquisition is sticky and never selects a replacement owner',async()=>{
 const events=[],held=owner(events);let acquisitions=0;fixture.acquire=()=>{acquisitions++;return Object.freeze({owner:held,error:null});};fixture.current=()=>{};
 const main=createOriginalRuntimeImagePreloadController();await main.ensureCurrent();fixture.current=()=>{throw 0;};assert.throws(()=>main.assertCurrent(),e=>e===0);await assert.rejects(main.ensureCurrent(),e=>e===0);assert.equal(acquisitions,1);await main.close();
});
