import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';

const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const begin=main.indexOf('async function shutdownOriginalPQWallet(){');
const end=main.indexOf('\nconst originalAdmissionExit=',begin);
assert(begin>=0&&end>begin);

function fixture(failure,originalCause){
 const calls=[];let release;
 const held=new Promise(resolve=>{release=resolve;});
 const invoke=name=>()=>{calls.push(name);if(name===failure)throw originalCause;};
 const context={
  originalMainNamespaceStartup:{retire:invoke('namespace-retire'),shutdown:invoke('namespace-close')},
  originalPayContextBridge:{invalidateAll:invoke('pay-retire'),assertSafeToClose(){}},
  originalProductContextBridge:{invalidateAll:invoke('product-retire'),assertSafeToClose(){}},
  nativePayMainEntry:{cancel:invoke('pay-cancel'),shutdown:invoke('pay-close')},
  pqFinalityCollection:{retire:invoke('finality-retire'),join:invoke('finality-join')},
  originalDeviceRegistration:{close:invoke('registration-close')},
  originalDeviceFinalization:{close:async()=>{calls.push('finalization-close');await held;calls.push('finalization-done');}},
  walletAuthority:{shutdownPQReviews:invoke('reviews-close')},
  originalAITaskReview:{shutdown:invoke('ai-close'),assertSafeToClose(){}},
  originalDeviceManagementReview:{shutdown:invoke('management-close'),assertSafeToClose(){}},
  originalDeviceCreation:{close:invoke('creation-close')},
  originalDeviceQuery:{close:invoke('query-close')},
  originalIDEIdentityPeerOwner:{shutdown:invoke('peer-close')},
  originalProjectControl:{shutdown:invoke('project-close')},
  agentDelegationsService:{close:invoke('agent-close'),assertSafeToClose(){}},
  nativePayProduct:{assertSafeToClose(){}},pqTransactionSubmission:null,
  aiTaskPublicCleanupPresent:false,aiTaskPublicCleanupCause:undefined,aiTaskPublicParents:new Map()
 };
 return {calls,release,run:compileFunction(main.slice(begin,end)+';return shutdownOriginalPQWallet;',[],{contextExtensions:[context]})()};
}

for(const [failure,cause] of [['agent-close',Error('agent cleanup failed')],['registration-close',false],['reviews-close',null],['pay-close',0],['finality-retire',undefined]]){
 test('actual Main drains every original owner after synchronous '+failure+' failure',async()=>{
  const f=fixture(failure,cause);let settled=false;
  const work=f.run();const observed=work.then(()=>{settled=true;return {failed:false};},error=>{settled=true;return {failed:true,error};});
  await new Promise(resolve=>setImmediate(resolve));
  const beforeRelease={settled,calls:[...f.calls]};
  f.release();const outcome=await observed;
  assert.equal(beforeRelease.settled,false,'must wait for the original pending child despite a synchronous failure');
  assert(beforeRelease.calls.includes('finalization-close'),'one synchronous close cannot skip a sibling');
  for(const name of ['reviews-close','pay-close','creation-close','query-close','finality-join','peer-close','project-close','agent-close'])assert.equal(f.calls.filter(value=>value===name).length,1,name);
  assert(f.calls.indexOf('creation-close')>f.calls.indexOf('finalization-done'),'registration children drain before creation parent');
  assert.equal(outcome.failed,true);assert.equal(outcome.error,cause,'preserve the exact falsy original failure');
  assert.equal(f.calls.includes('namespace-close'),false,'unresolved cleanup cannot release the namespace parent');
 });
}

const exitBegin=main.indexOf('function createOriginalAdmissionExitGate(');
const makeExit=compileFunction(main.slice(exitBegin,begin)+';return createOriginalAdmissionExitGate;',[],{contextExtensions:[{setImmediate}]})();
for(const failedOwner of ['entry','wallet']){
 test('actual close gate waits for both original drains when '+failedOwner+' fails synchronously',async()=>{
  const calls=[];let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const shutdown=name=>()=>{calls.push(name);if(name===failedOwner)throw null;return pending;};
  const gate=makeExit({entry:{shutdown:shutdown('entry')},shutdownWallet:shutdown('wallet'),lock(){calls.push('lock');},quit(){calls.push('quit');},report(){calls.push('report');}});
  let settled=false;const first=gate.request(),second=gate.request();
  assert.equal(first,second,'repeated close must retain the same cleanup attempt');
  const observed=first.then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  await new Promise(resolve=>setImmediate(resolve));const settledBeforeRelease=settled;
  release();const error=await observed;
  assert.equal(settledBeforeRelease,false);assert.equal(error.code,'ADMISSION_SHUTDOWN_INCOMPLETE');
  assert.deepEqual(calls,['lock','entry','wallet','report']);
  assert.equal(gate.request(),first,'failed cleanup remains sticky without replay');
 });
}
