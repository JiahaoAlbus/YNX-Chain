import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {createRegisteredPQRestore} from '../src/wallet-pq-registered-restore.mjs';
const account='0x'+'1'.repeat(40),networkId='2'.repeat(64),credential='A'.repeat(43);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){
 const options={cancel:false,recognized:true,partialFailure:false,closeFailure:false,badCredential:false,acquireGate:null,restoreGate:null};
 const counts={acquire:0,reserve:0,restore:0,save:0,read:0,retire:0,close:0,recheck:0,open:0};
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(account);await lifecycle.unlock();
 const binding=Object.freeze({chainId:networkId,owner:account,protocolVersion:'YNX-BATCH/v0.1',suite:'TEST-ONLY',pkA:'TEST-A',pkB:'TEST-B'}),started=deferred(),imported=deferred(),material={pkcs8A:Uint8Array.of(1),pkcs8B:Uint8Array.of(2)},receipt={},handle={};let keyRetired=false;
 const sdk={validatePQNetworkBinding:value=>value,validatePQPublicBinding:value=>value,assertPQPublicBindingMatches:(a,b)=>assert.deepEqual(a,b),createPQWalletKeyHandle:()=>assert.fail('No new KeyGen'),readPQWalletKeyPublic:()=>{assert.equal(keyRetired,false);return binding;},destroyPQWalletKeyHandle:()=>{assert.equal(keyRetired,false);keyRetired=true;counts.retire++;return true;},readPQWalletKeyCleanupOutcome:()=>({retired:keyRetired,cleanupComplete:keyRetired,cleanupUnknown:false}),
  openPQWalletBackup:async()=>{counts.open++;if(options.badCredential)throw Error('PQ_BACKUP_AUTHENTICATION_FAILED');return {...material,binding};},
  restorePQWalletKeyHandle:async(wire,key,expected)=>{assert.equal(wire[0],7);assert.equal(key,credential);assert.deepEqual(expected,binding);counts.restore++;imported.resolve();if(options.restoreGate)await options.restoreGate;return handle;},
 };
 let stored=false,verified=false,persistenceAttempted=false,persisted=false,restoreToken;
 const vault={assertPQPreparationAvailable:async()=>{},reservePQPreparation:async value=>{counts.reserve++;assert.equal(value.kind,'restore');assert.equal(value.operationId,'TEST-original-restore');},savePQKeys:async value=>{counts.save++;assert.equal(value.handle,handle);assert.equal(value.restoration.wire[0],7);assert.equal(value.restoration.credential,credential);stored=true;return receipt;},readPQKeys:async()=>{counts.read++;if(!stored)throw Error('ABSENT');return receipt;},verifySavedPQKeys:async value=>stored&&value.receipt===receipt};
 // PUBLIC repository stand-in for the new main-only original-result contract;
 // real encrypted Vault, SDK, candidate-session and CAS tests are separate.
 vault.preparePQRestoreResult=async value=>{assert.equal(value.wire[0],7);assert.equal(value.credential,credential);restoreToken={};return restoreToken;};
 vault.capturePQRestoreResult=(token,original)=>{assert.equal(token,restoreToken);assert.equal(original,handle);verified=true;return true;};
 vault.pqRestoreResultStatus=token=>{assert.equal(token,restoreToken);return {verified,persistenceAttempted,persisted,cleanupComplete:keyRetired,resumeAvailable:verified&&keyRetired&&!persistenceAttempted&&!persisted};};
 vault.selectPQRestoreResultOutcome=(_token,observer)=>observer({firstCausePresent:false});
 vault.commitPQRestoreResult=async token=>{assert.equal(token,restoreToken);assert.equal(verified,true);persistenceAttempted=true;const value=await vault.savePQKeys({handle,restoration:{wire:Uint8Array.of(7),credential}});persisted=true;return value;};
 vault.reconcilePQRestoreResult=async token=>{assert.equal(token,restoreToken);assert.equal(persistenceAttempted,true);const value=await vault.readPQKeys();persisted=true;return value;};
 const acquire=async request=>{assert.deepEqual(Object.keys(request).sort(),['at','nativeChainId','networkId','operation','owner'].sort());assert.equal(request.operation,'read-registered-binding');assert.equal(request.owner,account);counts.acquire++;let retired=false;
  const resource={assertCurrent(){if(retired||options.expired)throw Error('RETIRED');},readOriginal:()=>Object.freeze({version:'YNX-WALLET-REGISTERED-BINDING/v1',publicBinding:binding,dataOnly:true,restorationAuthorized:false,adoptionAuthorized:false,signingAuthorized:false,transactionAuthorized:false,retryAuthorized:false}),recheck:async()=>{counts.recheck++;},retire(){retired=true;},join:async()=>{},close:async()=>{counts.close++;retired=true;if(options.closeFailure)throw false;}};
  started.resolve();if(options.acquireGate)await options.acquireGate;if(options.partialFailure)throw Object.assign(Error('TEST-partial'),{partial:resource,cause:false});return resource;
 };
 const api=createRegisteredPQRestore({lifecycle,vault,sdk,networkId,id:()=> 'TEST-original-restore',acquire,isOriginal:()=>options.recognized,files:{read:async()=>Uint8Array.of(7)},chooseFile:async()=>options.cancel?null:'TEST-normal-dialog-file'});
 return {api,lifecycle,vault,sdk,options,counts,started,imported,material};
}
test('registered restore uses only original binding, empty slot, SDK and same Vault; wipes preflight material and retires original',async()=>{
 const f=await fixture(),s=await f.api.restore({credential});assert.equal(s.persisted,true);assert.equal(s.sourceClosed,true);assert.equal(s.signingAuthorized,false);assert.equal(s.transactionAuthorized,false);
 assert.equal(f.counts.reserve,1);assert.equal(f.counts.restore,1);assert.equal(f.counts.save,1);assert.equal(f.counts.close,1);assert.equal(f.counts.retire,1);assert.equal(f.material.pkcs8A[0],0);assert.equal(f.material.pkcs8B[0],0);
 await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.restore,1);
});
test('registered restore cancellation and existing protected records enter no source or crypto',async()=>{
 const f=await fixture();f.options.cancel=true;assert.equal((await f.api.restore({credential})).cancelled,true);assert.equal(f.counts.acquire,0);f.options.cancel=false;f.vault.assertPQPreparationAvailable=async()=>{throw Error('EXISTS');};await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.acquire,0);assert.equal(f.counts.reserve,0);
});
test('unbranded public kernel cannot supply expected keys',async()=>{
 const f=await fixture();f.options.recognized=false;await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.open,0);assert.equal(f.counts.reserve,0);assert.equal(f.counts.restore,0);assert.equal(f.counts.close,1);
});
test('wrong recovery credential is refused before durable reservation, and closed read may explicitly retry',async()=>{
 const f=await fixture();f.options.badCredential=true;await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.reserve,0);assert.equal(f.counts.close,1);f.options.badCredential=false;await f.api.restore({credential});assert.equal(f.counts.restore,1);
});
test('original factory partial and falsy cause retained; cleanup failure remains separate',async()=>{
 const f=await fixture();f.options.partialFailure=true;f.options.closeFailure=true;await assert.rejects(f.api.restore({credential}));
 f.api.selectOriginalOutcome(r=>{assert.equal(r.firstCausePresent,true);assert.equal(r.firstCause,false);assert.equal(r.cleanupCausePresent,true);assert.equal(r.cleanupCause,false);assert(r.resource);});assert.equal(f.counts.restore,0);assert.equal(f.counts.close,1);
 await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.acquire,1);
});
test('late acquired original after lock is captured and closed without importing keys',async()=>{
 const f=await fixture(),gate=deferred();f.options.acquireGate=gate.promise;const work=f.api.restore({credential});await f.started.promise;f.lifecycle.lock();gate.resolve();await assert.rejects(work);assert.equal(f.counts.close,1);assert.equal(f.counts.restore,0);
});
test('late SDK restored handle after lock is captured, retired once, never saved or replaced',async()=>{
 const f=await fixture(),gate=deferred();f.options.restoreGate=gate.promise;const work=f.api.restore({credential});await f.imported.promise;f.lifecycle.lock();gate.resolve();await assert.rejects(work);assert.equal(f.counts.retire,1);assert.equal(f.counts.save,0);assert.equal(f.counts.close,1);
});
test('cleanup failure cannot erase an already saved original or be advertised as successful restore',async()=>{
 const f=await fixture();f.options.closeFailure=true;await assert.rejects(f.api.restore({credential}));assert.equal(f.api.status().persisted,true);assert.equal(f.api.status().cleanupDebt,true);assert.equal(f.counts.retire,1);await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.restore,1);
});
test('readonly expiry before any reservation/import remains a retryable explicit read, not a new UNKNOWN',async()=>{
 const f=await fixture(),open=f.sdk.openPQWalletBackup;f.sdk.openPQWalletBackup=async(...args)=>{const material=await open(...args);f.options.expired=true;return material;};
 await assert.rejects(f.api.restore({credential}));assert.equal(f.counts.reserve,0);assert.equal(f.counts.restore,0);assert.equal(f.api.status().preparationUnknown,false);assert.equal(f.counts.close,1);
 f.options.expired=false;f.sdk.openPQWalletBackup=open;assert.equal((await f.api.restore({credential})).persisted,true);assert.equal(f.counts.acquire,2);
});
test('lost save acknowledgement reconciles only original protected record after unlock, without another import or save',async()=>{
 const f=await fixture(),save=f.vault.savePQKeys;f.vault.savePQKeys=async value=>{await save(value);f.lifecycle.lock();throw false;};
 await assert.rejects(f.api.restore({credential}));assert.equal(f.api.status().phase,'save-unknown');assert.equal(f.counts.save,1);assert.equal(f.counts.retire,1);await f.lifecycle.unlock();
 const state=await f.api.recover();assert.equal(state.persisted,true);assert.equal(state.busy,false);assert.equal(f.counts.restore,1);assert.equal(f.counts.save,1);assert.equal(f.counts.read,1);f.api.selectOriginalOutcome(r=>assert.equal(r.controller.selectRetainedOutcome(v=>v.firstCause),false));
});
