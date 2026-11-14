import test from 'node:test';
import assert from 'node:assert/strict';
import {finishSessionSignOut,signOutNotice} from './sessionSignOut';

test('Wallet-required or lost remote revoke is reported without replay',async()=>{
 let calls=0;const result=await finishSessionSignOut(async()=>{},async()=>{calls++;throw Error('WALLET_REVOCATION_REQUIRED')},Promise.resolve());
 assert.equal(calls,1);assert.deepEqual(result,{localCleared:true,remote:'unconfirmed',nativeClosed:true,retained:true});assert.match(signOutNotice(result,false),/requires confirmation/);
});
test('local storage failure does not skip original revoke or Native cleanup',async()=>{
 let calls=0;const result=await finishSessionSignOut(async()=>{throw Error('storage')},async()=>{calls++},Promise.resolve());
 assert.equal(calls,1);assert.deepEqual(result,{localCleared:false,remote:'response-received',nativeClosed:true,retained:true});assert.match(signOutNotice(result,false),/could not be fully cleared/);assert.match(signOutNotice(result,false),/requires confirmation/);
});
test('Native close failure and absent session are not promoted to remote revocation',async()=>{
 const result=await finishSessionSignOut(async()=>{},null,Promise.reject(Error('original close')));
 assert.deepEqual(result,{localCleared:true,remote:'not-requested',nativeClosed:false,retained:true});assert.match(signOutNotice(result,false),/closure was not confirmed/);
});
test('failed original custody prevents both local deletion and remote revoke',async()=>{
 let clears=0,calls=0;const result=await finishSessionSignOut(async()=>{clears++},async()=>{calls++},Promise.resolve(),async()=>{throw Error('pending record exists')});
 assert.equal(clears,0);assert.equal(calls,0);assert.deepEqual(result,{localCleared:false,remote:'not-requested',nativeClosed:true,retained:false});
});
