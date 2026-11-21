import test from 'node:test';
import assert from 'node:assert/strict';
import {OriginalWalletCallbackClaims,requireWalletCallbackReady} from './walletCallbackGate';

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
test('the same Wallet callback is claimed once even after an ambiguous response',()=>{
 const claims=new OriginalWalletCallbackClaims(),original='a'.repeat(64),other='b'.repeat(64);
 assert.equal(claims.reserve(original),true);assert.equal(claims.reserve(original),false);
 assert.equal(claims.reserve(other),true);assert.throws(()=>claims.reserve('not-a-digest'),/CALLBACK_DIGEST_INVALID/);
});
test('concurrent duplicate callbacks send only one original approval and never retry after lost response',async()=>{
 const claims=new OriginalWalletCallbackClaims();let requests=0;
 const receive=async()=>{await requireWalletCallbackReady(Promise.resolve(),()=> 'PUBLIC-device',async()=>false);if(!claims.reserve('a'.repeat(64)))return;requests++;throw Error('PUBLIC response lost')};
 const outcomes=await Promise.allSettled([receive(),receive()]);
 assert.equal(outcomes.filter(result=>result.status==='rejected').length,1);assert.equal(requests,1);
 await receive();assert.equal(requests,1);
});
