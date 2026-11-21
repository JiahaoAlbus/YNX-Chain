import test from 'node:test';
import assert from 'node:assert/strict';
import {requireWalletCallbackReady} from './walletCallbackGate';

test('Wallet callback is not consumed while device custody is missing or revocation is pending',async()=>{
 let calls=0;
 const process=async(secret:string,pending:()=>Promise<boolean>)=>{await requireWalletCallbackReady(Promise.resolve(),()=>secret,pending);calls++};
 await assert.rejects(process('',async()=>false),/DEVICE_KEY_NOT_READY/);
 await assert.rejects(process('PUBLIC-device',async()=>true),/REVOCATION_PENDING/);
 await assert.rejects(process('PUBLIC-device',async()=>{throw Error('PUBLIC storage unavailable')}),/storage unavailable/);
 assert.equal(calls,0);
 await process('PUBLIC-device',async()=>false);assert.equal(calls,1);
});
test('a cold-start Wallet callback waits for original device custody to load',async()=>{
 let finish!:()=>void,secret='',calls=0;
 const boot=new Promise<void>(resolve=>{finish=resolve});
 const callback=(async()=>{const retained=await requireWalletCallbackReady(boot,()=>secret,async()=>false);calls++;return retained})();
 await Promise.resolve();assert.equal(calls,0);
 secret='PUBLIC-original-device';finish();assert.equal(await callback,secret);assert.equal(calls,1);
});
