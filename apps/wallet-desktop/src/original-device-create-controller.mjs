// Original Main-only device creation orchestration. No renderer request terms,
// Source provider, key, approval callback or registration-success DTO is accepted.
import * as fixedImage from '../../../packages/wallet-auth/src/original-auth-identity-fixed-native-image.js';
import {types} from 'node:util';
import {prepareOriginalWalletDeviceCreateReviewDATA} from './original-policy-supplier/device-create-review.mjs';
import {captureOriginalWalletDeviceCreateApprovalIPC,claimOriginalWalletDeviceCreateApproval,retireUnusedOriginalWalletDeviceCreateApproval} from './original-policy-supplier/device-create-approval.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const partial=e=>Object.getOwnPropertyDescriptor(Object(e),'partial')?.value;
const code=e=>{const v=Object.getOwnPropertyDescriptor(Object(e),'code')?.value;return typeof v==='string'&&/^[A-Z0-9_]{1,96}$/.test(v)?v:'DEVICE_CREATE_ORIGINAL_FAILURE';};
function outcome(value){
 const fields=['operation','state','association','firstCause','result','cleanup','outputState','reportedLengthsExact','recoveredOriginal'];
 if(!value||types.isProxy(value)||!Object.isFrozen(value)||Object.keys(value).sort().join('|')!==fields.sort().join('|')||!['UNKNOWN','PENDING_REGISTRATION','REGISTERED_LOCAL_ASSOCIATION'].includes(value.state))fail('DEVICE_CREATE_ORIGINAL_OUTCOME_REQUIRED');
 return value;
}
function publicPair(value){
 if(!value||types.isProxy(value)||Object.keys(value).sort().join('|')!=='pkA|pkB'||!types.isUint8Array(value.pkA)||!types.isUint8Array(value.pkB)||value.pkA.byteLength!==2592||value.pkB.byteLength!==64)fail('DEVICE_CREATE_ORIGINAL_PUBLIC_PAIR_REQUIRED');
 return Object.freeze({pkA:Buffer.from(value.pkA),pkB:Buffer.from(value.pkB)});
}
export function createOriginalDeviceCreationController({vault,networkId}){
 let active=null,closed=false;
 const remember=(r,cause)=>{if(!r.hasCause){r.hasCause=true;r.cause=cause;}};
 const keepOutcome=(r,value)=>{if(!r.hasRawOutcome){r.hasRawOutcome=true;r.rawOriginalOutcome=value;}r.rawLatestOutcome=value;const v=outcome(value);if(!r.originalOutcome)r.originalOutcome=v;r.latestOutcome=v;return v;};
 const retain=r=>{if(r.child&&!r.cleanup.child.closed&&r.effectEntryInvoked)try{keepOutcome(r,r.child.readOriginalOutcomeDATA());}catch(e){if(!r.hasOutcomeReadCause){r.hasOutcomeReadCause=true;r.outcomeReadCause=e;}}};
 function retire(r){
  r.retired=true;retain(r);
  // Native public outcome is retained both before and after retirement. A late
  // lock may change PENDING to UNKNOWN; it never makes the first effect vanish.
  for(const name of ['child','source']){const c=r.cleanup[name];if(r[name]&&!c.retired){c.retired=true;try{r[name].retire();}catch(e){c.error=e;c.failed=true;remember(r,e);}}}
  retain(r);r.peer?.retire();r.review?.close();
 }
 async function drain(r){
  retire(r);let childClosed=!r.child;
  for(const name of ['child','source']){
   if(name==='source'&&!childClosed)break;
   const owner=r[name],c=r.cleanup[name];if(!owner)continue;
   if(c.failed)break;
   try{
    if(!c.joined){c.joined=true;await owner.join();}
    if(!c.closeSelected){c.closeSelected=true;await owner.close();c.closed=true;}
    if(name==='child')childClosed=c.closed;
   }catch(e){c.failed=true;c.error=e;remember(r,e);break;}
  }
  r.cleanupDebt=!!r.child&&!r.cleanup.child.closed||!!r.source&&!r.cleanup.source.closed;
  if(!r.cleanupDebt){r.unsubscribe?.();r.selected?.close();r.peer?.close();}
  if(r.cleanupDebt)fail('DEVICE_CREATE_ORIGINAL_CLEANUP_UNRESOLVED');
 }
 const status=r=>Object.freeze({requestId:r?.review?.id??null,account:r?.security?.account??null,retired:r?.retired??false,phase:r?.phase??'idle',effectEntryInvoked:r?.effectEntryInvoked??false,originalOutcomeRetained:r?.hasRawOutcome??false,originalOutcome:r?.originalOutcome??null,latestOutcome:r?.latestOutcome??null,cleanupUnresolved:r?.cleanupDebt??false,...(r?.hasCause?{firstCauseCode:code(r.cause)}:{}),...(r?.hasOutcomeReadCause?{outcomeReadCauseCode:code(r.outcomeReadCause)}:{})});
 const selected=id=>{if(!active||active.review?.id!==id)fail('DEVICE_CREATE_ORIGINAL_REVIEW_REQUIRED');return active;};
 // IPC guards expire when that IPC returns. Each normal call needs its own
 // genuine guard AND the same original protected session/review selection.
 const current=r=>{if(closed||r.retired)fail('DEVICE_CREATE_RETIRED');vault.authorization.current().assert();const now=vault.authorization.status();if(now.account!==r.security.account||now.revision!==r.security.revision)fail('DEVICE_CREATE_SELECTED_SESSION_CHANGED');r.selected?.assertCurrent();r.review?.assertCurrent();r.source?.assertCurrent();};
 async function prepareReview(){
  if(arguments.length)fail('DEVICE_CREATE_ZERO_INPUT');if(closed)fail('DEVICE_CREATE_RETIRED');
  if(active){if(!active.effectEntryInvoked&&active.review&&Date.now()>=Date.parse(active.review.request.expiresAt))await drain(active);const terminal=active.phase==='registered-original-result-retained'&&active.latestOutcome?.state==='REGISTERED_LOCAL_ASSOCIATION'&&!active.hasCause;if(active.effectEntryInvoked&&!terminal||active.cleanupDebt||active.inFlight)fail('DEVICE_CREATE_ORIGINAL_UNRESOLVED');if(active.source&&!active.cleanup.source.closed)fail('DEVICE_CREATE_REVIEW_IN_PROGRESS');}
  const guard=vault.authorization.current();guard.assert();const before=vault.authorization.status();
  const r={security:before,phase:'acquiring-source',cleanup:{child:{},source:{}},hasCause:false,effectEntryInvoked:false,cleanupDebt:false};active=r;
  r.unsubscribe=vault.authorization.subscribe(s=>{if(s.locked||s.account!==before.account||s.revision!==before.revision)retire(r);});
  const task=(async()=>{try{
   if(typeof fixedImage.acquireOriginalProductSessionDeviceV4ProvisioningSourceStage!=='function')fail('DEVICE_PROVISIONING_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
   try{r.source=fixedImage.acquireOriginalProductSessionDeviceV4ProvisioningSourceStage();}catch(e){r.source=partial(e);throw e;}
   current(r);const originalBytes=r.source.readIntentOriginalDATA();current(r);
   r.selected=await vault.captureSelectedPQAccountPublic(networkId);current(r);
   r.review=prepareOriginalWalletDeviceCreateReviewDATA(originalBytes,r.selected);current(r);r.phase='review';return r.review.request;
  }catch(e){remember(r,e);r.phase='failed-before-effect';try{await drain(r);}catch{}throw e;}})();r.inFlight=task;try{return await task;}finally{r.inFlight=null;}
 }
 async function approveOriginal(event,id){
  const r=selected(id);if(r.phase!=='review'||r.inFlight)fail('DEVICE_CREATE_REVIEW_ALREADY_DECIDED');current(r);r.phase='capturing-approval';let capsule;
  const task=(async()=>{
   try{
    capsule=captureOriginalWalletDeviceCreateApprovalIPC(event,r.review);r.peer=claimOriginalWalletDeviceCreateApproval(capsule,r.review);
    try{r.child=r.source.captureOriginalCreationApproval(r.peer);}catch(e){r.child=partial(e);throw e;}
    current(r);await r.child.recheck();current(r);r.child.assertCurrent();
    r.phase='preparing';r.effectEntryInvoked=true;
    // Interpret neither error nor renewed lock before retaining this original.
    const prepared=keepOutcome(r,r.child.prepare());retain(r);current(r);
    if(prepared.state!=='PENDING_REGISTRATION'){r.phase='original-outcome-retained';fail('DEVICE_CREATE_ORIGINAL_NOT_PENDING');}
    r.pair=publicPair(r.child.readPublicPairDATA());current(r);r.phase='awaiting-original-registration';return status(r);
   }catch(e){remember(r,e);retain(r);r.phase=r.effectEntryInvoked?'original-outcome-unknown':'failed-before-effect';try{await drain(r);}catch{}throw e;}
   finally{if(capsule)retireUnusedOriginalWalletDeviceCreateApproval(capsule);}
  })();r.inFlight=task;try{return await task;}finally{r.inFlight=null;}
 }
 function readPublicPairForOriginalRegistration(id){
  if(arguments.length!==1)fail('DEVICE_CREATE_REGISTRATION_ZERO_DTO');const r=selected(id);if(r.phase!=='awaiting-original-registration')fail('DEVICE_CREATE_ORIGINAL_NOT_PENDING');current(r);r.child.assertCurrent();return publicPair(r.pair);
 }
 async function completeOriginalRegistration(id){
  if(arguments.length!==1)fail('DEVICE_CREATE_REGISTRATION_ZERO_DTO');const r=selected(id);if(r.phase!=='awaiting-original-registration'||r.inFlight)fail('DEVICE_CREATE_ORIGINAL_NOT_PENDING');current(r);r.phase='completing-original-registration';
  const task=(async()=>{try{
   await r.child.recheck();current(r);r.child.assertCurrent();const result=keepOutcome(r,r.child.complete());retain(r);current(r);
   r.phase=result.state==='REGISTERED_LOCAL_ASSOCIATION'?'registered-original-result-retained':'original-outcome-unknown';
   if(result.state!=='REGISTERED_LOCAL_ASSOCIATION')fail('DEVICE_CREATE_ORIGINAL_COMPLETION_UNKNOWN');await drain(r);return status(r);
  }catch(e){remember(r,e);retain(r);r.phase='original-outcome-unknown';try{await drain(r);}catch{}throw e;}})();r.inFlight=task;try{return await task;}finally{r.inFlight=null;}
 }
 async function rejectOriginal(id){const r=selected(id);retire(r);if(r.inFlight)try{await r.inFlight;}catch{}r.phase=r.effectEntryInvoked?'original-outcome-unknown':'cancelled-before-effect';await drain(r);return status(r);}
 async function close(){closed=true;const r=active;if(!r)return;retire(r);if(r.inFlight)try{await r.inFlight;}catch{}await drain(r);}
 return Object.freeze({prepareReview,approveOriginal,readPublicPairForOriginalRegistration,completeOriginalRegistration,rejectOriginal,close,readStatusDATA:()=>status(active),isPendingReview:id=>active?.review?.id===id&&active.phase==='review'&&!active.retired});
}
