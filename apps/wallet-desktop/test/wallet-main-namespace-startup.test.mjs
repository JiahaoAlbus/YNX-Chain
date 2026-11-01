import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {createWalletMainNamespaceStartup} from '../src/wallet-main-namespace-startup.mjs';
import {initializeOriginalWalletMainNamespaceV1} from '@ynx-chain/wallet-auth/original-wallet-main-namespace-bootstrap';
function fixture({completion=Promise.resolve(Object.freeze({errorPresent:true,error:Error('PUBLIC_STARTUP')})),retireError,retireFails=false,joinFails=false}={}){
 const calls=[];let initializes=0;const attempt=Object.freeze({completion,retire(){calls.push('retire');if(retireFails)throw retireError;},async join(){calls.push('join');await completion;if(joinFails)throw Error('PUBLIC_JOIN');},async close(){calls.push('close');},statusDATA(){return {dataOnly:true};}});
 const owner=createWalletMainNamespaceStartup({initialize(){initializes++;return attempt;}});return {owner,attempt,calls,initializes:()=>initializes};
}
test('Main synchronously owns the same StartupAttempt before awaiting completion and never repeats initialization',async()=>{
 let release;const completion=new Promise(r=>release=r),f=fixture({completion});assert.equal(f.owner.start(),f.attempt);assert.equal(f.owner.start(),f.attempt);assert.equal(f.initializes(),1);assert.equal(f.owner.statusDATA().attemptPresent,true);const pending=f.owner.settle(f.attempt);assert.throws(()=>f.owner.assertSafeToClose(),{code:'WALLET_MAIN_STARTUP_CLEANUP_PENDING'});release({errorPresent:true,error:Error('PUBLIC_NO_NATIVE')});await assert.rejects(pending,/PUBLIC_NO_NATIVE/);assert.deepEqual(f.calls,['retire','join','close']);f.owner.assertSafeToClose();assert.equal(f.owner.isClosing(),false);
});
test('matching actual SDK Root-zero attempt rejects and drains without registration or a Native effect',async()=>{
 const owner=createWalletMainNamespaceStartup({initialize:initializeOriginalWalletMainNamespaceV1}),attempt=owner.start();await assert.rejects(owner.settle(attempt));const state=owner.statusDATA();assert.equal(state.startupErrorPresent,true);assert.equal(state.drained,true);assert.equal(state.MainRegistered,false);assert.equal(state.NativeAdmission,false);assert.equal(attempt.statusDATA().nativeOwnerPresent,false);owner.assertSafeToClose();
});
test('explicit errorPresent preserves false, null, zero and undefined completion errors',async()=>{
 for(const error of [false,null,0,undefined]){const f=fixture({completion:Promise.resolve({errorPresent:true,error})});f.owner.start();await assert.rejects(f.owner.settle(f.attempt),e=>e===error);assert.equal(f.owner.statusDATA().startupErrorPresent,true);assert.equal(f.owner.statusDATA().startupError,error);assert.equal(f.owner.statusDATA().drained,true);}
});
test('data-only or success-looking completion never grants Main registration',async()=>{
 const f=fixture({completion:Promise.resolve({errorPresent:false,error:null,MainRegistered:true,NativeAdmission:true})});f.owner.start();await assert.rejects(f.owner.settle(f.attempt),{code:'WALLET_MAIN_NATIVE_REGISTRATION_NOT_SUPPLIED'});assert.equal(f.owner.statusDATA().MainRegistered,false);
});
test('retire failure stays first cleanup cause, join is attempted, failed join never closes the parent',async()=>{
 const f=fixture({retireFails:true,retireError:false,joinFails:true});f.owner.start();await assert.rejects(f.owner.settle(f.attempt),/PUBLIC_STARTUP/);assert.deepEqual(f.calls,['retire','join']);assert.equal(f.owner.statusDATA().cleanupErrorPresent,true);assert.equal(f.owner.statusDATA().cleanupError,false);await assert.rejects(f.owner.shutdown(),e=>e===false);assert.deepEqual(f.calls,['retire','join']);assert.throws(()=>f.owner.assertSafeToClose());
});
test('exit during pending acquisition synchronously retires and waits original completion before parent close',async()=>{
 let release;const completion=new Promise(r=>release=r),f=fixture({completion});f.owner.start();const settle=f.owner.settle(f.attempt),drain=f.owner.shutdown();assert.equal(f.owner.isClosing(),true);assert.deepEqual(f.calls.slice(0,2),['retire','join']);assert.equal(f.calls.includes('close'),false);release({errorPresent:true,error:Error('PUBLIC_EXIT')});await drain;await assert.rejects(settle,/PUBLIC_EXIT/);assert.deepEqual(f.calls,['retire','join','close']);f.owner.assertSafeToClose();
});
test('shutdown before startup prevents a late factory and accepts no substituted attempt',async()=>{
 const f=fixture();await f.owner.shutdown();assert.throws(()=>f.owner.start(),{code:'WALLET_MAIN_STARTUP_CLOSING'});assert.equal(f.initializes(),0);f.owner.assertSafeToClose();const other=fixture();other.owner.start();assert.throws(()=>other.owner.settle({...other.attempt}),{code:'WALLET_MAIN_STARTUP_ATTEMPT_CHANGED'});await other.owner.shutdown();
});
const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');const begin=main.indexOf('async function shutdownOriginalPQWallet(){'),end=main.indexOf('\nconst originalAdmissionExit=',begin);assert.ok(begin>0&&end>begin);
function shutdownFixture({childFails=false}={}){
 const events=[];let release;const gate=new Promise(r=>release=r),close=async()=>{events.push('child');await gate;if(childFails)throw false;};const sandbox={originalMainNamespaceStartup:{retire(){events.push('parent-retire');},async shutdown(){events.push('parent-drain');}},originalPayContextBridge:{invalidateAll(){},assertSafeToClose(){}},nativePayMainEntry:{cancel(){}},pqFinalityCollection:{retire(){},async join(){}},originalDeviceRegistration:{close},originalDeviceFinalization:null,walletAuthority:{async shutdownPQReviews(){events.push('authority-drain');}},originalDeviceCreation:null,originalDeviceQuery:null,originalIDEIdentityPeer:null,originalProjectControl:{async shutdown(){}},nativePayProduct:{assertSafeToClose(){}},pqTransactionSubmission:{hasUnresolvedCleanup:()=>false}};return {run:vm.compileFunction(main.slice(begin,end)+';return shutdownOriginalPQWallet;',[],{contextExtensions:[sandbox]})(),events,release:()=>release()};
}
test('actual Main shutdown drains real child groups before namespace parent',async()=>{
 const f=shutdownFixture(),pending=f.run();assert.deepEqual(f.events,['parent-retire','child']);f.release();await pending;assert.ok(f.events.indexOf('authority-drain')<f.events.indexOf('parent-drain'));
});
test('actual Main shutdown retains parent when child drain fails with falsy error',async()=>{
 const f=shutdownFixture({childFails:true}),pending=f.run();f.release();await assert.rejects(pending,e=>e===false);assert.equal(f.events.includes('parent-drain'),false);
});
test('synchronous exit reentry during initializer retains the late SAME attempt and cannot close early',async()=>{
 const calls=[];let owner,drain;const attempt=Object.freeze({completion:Promise.resolve({errorPresent:true,error:Error('PUBLIC_RETIRED')}),retire(){calls.push('retire');},async join(){calls.push('join');},async close(){calls.push('close');},statusDATA(){return {};}});
 owner=createWalletMainNamespaceStartup({initialize(){drain=owner.shutdown();assert.equal(owner.statusDATA().drained,false);return attempt;}});assert.throws(()=>owner.start(),{code:'WALLET_MAIN_STARTUP_RETIRED'});assert.equal(owner.statusDATA().attemptPresent,true);await drain;assert.deepEqual(calls,['retire','join','close']);owner.assertSafeToClose();
});
