import test from 'node:test';
import assert from 'node:assert/strict';
import {readOriginalAddressObservation} from '../src/walletconnect-address-observation.mjs';
const sample=()=>({scope:'local-only',attempt:1,stage:'relay',connection:'rejected',initialization:'fulfilled',inFlight:false,draining:false,cancelled:true,cleanup:'unknown',firstCause:{present:true,code:'PUBLIC_PRIVATE_MATERIAL'},remoteCleanup:'not-proven',remoteCleanupUnconfirmed:true});
const safe=()=> 'WALLET_CONNECTION_UNAVAILABLE';
test('original SDK observation is bounded, frozen and never invokes effect APIs',()=>{
 let reads=0,effects=0;const fail=()=>{effects++;throw Error('FORBIDDEN');},original={cleanupSnapshot:()=>{reads++;return sample();},initialize:fail,restore:fail,connect:fail,cancel:fail,disconnect:fail};
 for(let i=0;i<16;i++){const value=readOriginalAddressObservation(original,safe);assert.equal(value.availability,'available');assert.ok(Object.isFrozen(value.value));assert.ok(Object.isFrozen(value.value.firstCause));assert.equal(value.value.firstCause.code,'WALLET_CONNECTION_UNAVAILABLE');assert.equal(JSON.stringify(value).includes('PRIVATE'),false);}
 assert.equal(reads,16);assert.equal(effects,0);
});
test('observation refuses remote-success claims, missing inflight, extra fields and getters without granting retry',()=>{
 for(const change of [{remoteCleanup:'confirmed'},{remoteCleanupUnconfirmed:false},{topic:'PRIVATE'},{connection:'pending',inFlight:false},{initialization:'pending',inFlight:false}])assert.equal(readOriginalAddressObservation({cleanupSnapshot:()=>({...sample(),...change})},safe).availability,'invalid');
 let touched=false;const getter=sample();Object.defineProperty(getter,'firstCause',{get(){touched=true;throw Error('PRIVATE');},enumerable:true});
 assert.equal(readOriginalAddressObservation({cleanupSnapshot:()=>getter},safe).availability,'invalid');assert.equal(touched,false);
 assert.deepEqual(readOriginalAddressObservation({},safe),{availability:'not-supplied',value:null});
 assert.deepEqual(readOriginalAddressObservation(null,safe),{availability:'not-started',value:null});
});
