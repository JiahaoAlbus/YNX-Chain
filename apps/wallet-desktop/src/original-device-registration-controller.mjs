// Main-only, fixed SDK registration caller. No caller-supplied Source, signer,
// client, endpoint or registration-success DTO is accepted by this factory.
import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {evmAddressFromYNX,canonicalJSON} from '@ynx-chain/wallet-auth';
import {openOriginalProductDeviceV4RegistrationClient} from '@ynx-chain/wallet-auth/original-product-device-v4-registration-client';
import {assertWalletIPC} from './wallet-ipc-policy.mjs';

const ports=new WeakMap(),expectedURL=new URL('./index.html',import.meta.url).href;
const fail=code=>{throw Object.assign(Error(code),{code});};
const own=(v,k)=>{if(!v||types.isProxy(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const remember=(r,e)=>{if(!r.firstPresent){r.firstPresent=true;r.first=e;}};
const state=port=>{const r=ports.get(port);if(!r)fail('DEVICE_REGISTRATION_ORIGINAL_REVIEW_REQUIRED');return r;};
const safeCode=e=>{const c=own(e,'code')??own(own(e,'data'),'code');return typeof c==='string'&&/^[A-Z0-9_]{1,128}$/.test(c)?c:'DEVICE_REGISTRATION_ORIGINAL_FAILURE';};

/** Correlation for the original Main authority only, never a Source brand. */
export function readOriginalDeviceRegistrationAccountReview(port){
 const r=state(port);r.current();if(!r.decided||r.phase!=='approving-account')fail('DEVICE_REGISTRATION_INDEPENDENT_APPROVAL_REQUIRED');
 return Object.freeze({request:r.view.request,account:r.security.account,requestId:r.request.id,
   operationId:r.view.scope.pendingId,registrationOriginal:r.view.scope.registrationOriginal});
}
export async function closeOriginalDeviceRegistrationClient(port){
 const r=state(port);if(r.closePass)return r.closePass;
 r.closePass=(async()=>{try{
  const owner=r.client??r.partial;
  if(owner){
   // A Native acquisition partial is retained before interpretation. Respect
   // its retire/join/close contract; a completed SDK client owns its own drain.
   if(!r.client&&typeof owner.retire==='function'&&typeof owner.join==='function'){
    owner.retire();await owner.join();
   }
   if(typeof owner.close!=='function')fail('DEVICE_REGISTRATION_PARTIAL_CLEANUP_REQUIRED');
   await owner.close();
  }
  r.clientClosed=true;
 }catch(e){r.cleanupPresent=true;r.cleanupCause=e;remember(r,e);throw e;}})();
 void r.closePass.catch(()=>{});return r.closePass;
}
export function readOriginalDeviceRegistrationCleanupDATA(port){
 const r=state(port);return Object.freeze({closed:r.clientClosed===true,cleanupPresent:r.cleanupPresent===true,cleanupCause:r.cleanupCause});
}
export function retainOriginalDeviceRegistrationFailure(port,cause){remember(state(port),cause);}
export function captureOriginalDeviceRegistrationApproval(port,{store,token,approval}){
 const r=state(port);if(r.approvalReturned)fail('DEVICE_REGISTRATION_APPROVAL_ALREADY_CAPTURED');
 // Retain the actual signer return before canonicalization, parse or lock.
 r.approvalReturned=true;r.rawApproval=approval;r.store=store;r.token=token;
 r.approvalOriginal=canonicalJSON(approval);
 store.captureSessionOriginal(token,{version:'4',original:r.approvalOriginal});
 return store.saveSessionOriginal(token).then(()=>{r.approvalSaved=true;},async error=>{
  // A lost storage ACK may already have written the same original. Readback
  // is DATA only and never permits signing or HTTP entry after this failure.
  try{const saved=await store.readSessionOriginal(r.security.account,r.view.requestDigest,()=>{});r.approvalSaved=saved?.approval?.original===r.approvalOriginal;}catch{}
  throw error;
 });
}

/** Called only inside the authority's existing account-policy owner lifetime.
 * Its own guard.submit performs the one outward effect. SDK returned originals
 * reach the original journal BEFORE late account/abort/Source checks. */
export async function submitOriginalDeviceRegistrationPair(port,{store,token,approvalOriginal,policyRef,assertCurrent,submit}){
 const r=state(port);r.current();if(r.pairSelected)fail('DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY');
 r.pairSelected=true;r.token=token;r.store=store;
 let failed=false,cause,response,transportFailed=false,transportCause;
 const capture=()=>{
  const status=r.client.readStatusDATA();r.sdkStatus=status;
  if(r.responseCaptured||status.originalResponseRetained!==true&&response===undefined)return;
  // Read only original DATA descriptors; never reconstruct a challenge reply.
  const raw=own(response,'responseOriginal')??own(status.originalResponse,'original');
  if(typeof raw!=='string'){r.unresolvedSDKResponse=status.originalResponse;r.httpOriginalMissing=true;return;}
  r.rawResponse=raw;store.captureSessionPairResponse(token,raw);r.responseCaptured=true;
 };
 try{
  assertCurrent();r.current();
  r.phase='preparing-original-pair';
  r.packet=await r.client.prepareOriginalPairSubmission({approvalOriginal,policyRef,abortContext:r.context});
  assertCurrent();r.current();
  const requestDATA=r.client.readOriginalPairRequestDATA(r.packet);
  if(requestDATA.operationId!==r.view.scope.pendingId||requestDATA.requestDigest!==r.view.requestDigest||requestDATA.registrationOriginal!==r.view.scope.registrationOriginal)fail('DEVICE_REGISTRATION_ORIGINAL_REQUEST_CHANGED');
  const entry=await store.beginSessionPairSubmission(token,requestDATA,()=>{assertCurrent();r.current();});
  if(entry.created!==true)fail('DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY');
  assertCurrent();r.current();r.phase='submitting-original-pair';r.httpSelected=true;
  response=await submit(async()=>{
   try{return response=await r.client.submitPreparedPair(r.packet,r.context);}
   catch(e){transportFailed=true;transportCause=e;throw e;}
   finally{capture();}
  });
 }catch(e){failed=true;cause=transportFailed?transportCause:e;remember(r,cause);}
 // No lease, Source, permission or abort assertion belongs before this save.
 try{capture();if(r.responseCaptured){await store.saveSessionPairResponse(token);r.responseSaved=true;}}
 catch(e){if(!failed){failed=true;cause=e;remember(r,e);}}
 if(failed){r.phase='original-pair-unknown';throw cause;}
 try{assertCurrent();r.current();}catch(e){remember(r,e);r.phase='original-pair-unknown';throw e;}
 // This SDK generation ends at a saved challenge. Its reply cannot register a
 // device, complete Native creation or mint a session. A later fixed completion
 // client needs a fresh challenge Source and a separate durable phase entry.
 r.phase='awaiting-original-challenge';
 return Object.freeze({phase:r.phase,operationId:r.view.scope.pendingId,requestDigest:r.view.requestDigest,
   responseRetained:r.responseSaved,queryOnly:true,registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false});
}

export function createOriginalDeviceRegistrationController({vault,networkId,authority,...extra}){
 if(Object.keys(extra).length||!vault?.authorization||typeof networkId!=='string'||!/^[0-9a-f]{64}$/.test(networkId)||typeof authority?.approveOriginalDeviceRegistration!=='function')fail('DEVICE_REGISTRATION_MAIN_COMPOSITION_REQUIRED');
 let active=null,closed=false;
 const status=r=>Object.freeze({requestId:r?.request?.id??null,account:r?.security.account??null,phase:r?.phase??'idle',
   operationId:r?.view?.scope.pendingId??null,requestDigest:r?.view?.requestDigest??null,
   originalResponseRetained:r?.responseCaptured??false,responseSaved:r?.responseSaved??false,
   accountApprovalOriginalRetained:r?.approvalReturned??false,accountApprovalSaved:r?.approvalSaved??false,
   cleanupUnresolved:r?.cleanupPresent===true,queryOnly:r?.decided===true||r?.phase==='query-only',
   registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false,
   ...(r?.firstPresent?{firstCauseCode:safeCode(r.first)}:{})});
 const selected=id=>{if(!active||active.request?.id!==id)fail('DEVICE_REGISTRATION_ORIGINAL_REVIEW_REQUIRED');return active;};
 const retire=(r,cause)=>{r.retired=true;if(!r.abort.signal.aborted)r.abort.abort(cause??Error('DEVICE_REGISTRATION_RETIRED'));};
 const finishLocal=r=>{r.unsubscribe?.();if(r.peer){r.peer.sender.removeListener('destroyed',r.peer.revoke);r.peer.sender.removeListener('did-start-navigation',r.peer.revoke);}};
 function current(r){
  if(closed||r.retired)fail('DEVICE_REGISTRATION_RETIRED');
  // current() intentionally rejects key access after submit. Recheck the SAME
  // captured approval lease's effect-current fence instead of reopening keys.
  if(r.httpSelected)r.approvalGuard.assertEffectCurrent();else vault.authorization.current().assert();
  const now=vault.authorization.status();if(now.account!==r.security.account||now.revision!==r.security.revision)fail('DEVICE_REGISTRATION_SELECTED_ACCOUNT_CHANGED');
  const clock=Date.now();if(clock<r.clockFloor)fail('DEVICE_REGISTRATION_CLOCK_ROLLBACK');r.clockFloor=clock;
  if(r.view&&clock>=Date.parse(r.view.originalWindow.expiresAt)||r.peer&&clock>=r.peer.expires)fail('DEVICE_REGISTRATION_REVIEW_EXPIRED');
  if(r.peer){const p=r.peer,w=p.windowFor(p.sender);
   if(w!==p.window||!w||w.isDestroyed()||p.sender.mainFrame!==p.frame)fail('DEVICE_REGISTRATION_APPROVAL_WINDOW_CHANGED');
   assertWalletIPC(p.event,p.sender,expectedURL);
  }
 }
 async function prepareReview(selection){
  if(arguments.length!==1)fail('DEVICE_REGISTRATION_ORIGINAL_SELECTION_REQUIRED');
  if(closed||active&&(!active.clientClosed||active.decided||active.inFlight))fail('DEVICE_REGISTRATION_ORIGINAL_UNRESOLVED');
  const guard=vault.authorization.current();guard.assert();const security=vault.authorization.status();
  const identity=own(selection,'identityBinding');
  if(own(identity,'networkId')!==networkId||own(identity,'canonicalOwner')!==security.account||evmAddressFromYNX(own(identity,'account'))!==security.account)fail('DEVICE_REGISTRATION_SELECTED_ACCOUNT_CHANGED');
  const r={security,phase:'acquiring-original-review',abort:new AbortController(),firstPresent:false,clientClosed:false,clockFloor:Date.now()};
  r.context=Object.freeze({signal:r.abort.signal});r.current=()=>current(r);r.port=Object.freeze(Object.create(null));ports.set(r.port,r);active=r;
  r.unsubscribe=vault.authorization.subscribe(s=>{if(s.locked||s.account!==security.account||s.revision!==security.revision)retire(r,Error('DEVICE_REGISTRATION_SELECTED_ACCOUNT_CHANGED'));});
  const pass=(async()=>{try{
   try{r.client=await openOriginalProductDeviceV4RegistrationClient();}
   catch(e){r.partial=own(e,'partial');throw e;}
   current(r);r.view=r.client.readOriginalRegistrationReviewDATA(selection);current(r);
   const journal=authority.transactionSender?.submissions?.intentStore;if(!journal)fail('SESSION_ORIGINAL_STORE_REQUIRED');
   const saved=await journal.readSessionOriginal(security.account,r.view.requestDigest,()=>current(r));current(r);
   if(saved){r.phase='query-only';fail('DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY');}
   const request=r.view.request;
   r.request=Object.freeze({id:randomUUID(),origin:request.origin,method:'ynx_registerProductDeviceV4',params:Object.freeze([]),createdAt:request.issuedAt,
    review:Object.freeze({title:'Approve account for this original app device / 独立批准此应用设备',account:security.account,
      productId:request.productId,clientId:request.clientId,platform:request.platform,applicationId:request.applicationId,origin:request.origin,
      callback:request.callback,deviceId:request.deviceId,networkId,operationId:r.view.scope.pendingId,requestDigest:r.view.requestDigest,
      deviceRegistrationId:request.deviceRegistrationId,deviceRegistrationRevision:request.deviceRegistrationRevision,
      deviceRegistrationDigest:request.deviceRegistrationDigest,scopes:request.scopes,expiresAt:r.view.originalWindow.expiresAt,
      devicePublicKeys:Object.freeze({pkA:r.view.record.pkA,pkB:r.view.record.pkB}),
      warning:'Separate account approval, not the earlier device-create decision. One original pair submission only. A saved challenge does not prove registration, connection or session creation.'})});
   r.phase='review';return r.request;
  }catch(e){remember(r,e);if(r.phase!=='query-only')r.phase='failed-before-account';try{await closeOriginalDeviceRegistrationClient(r.port);}catch{}finishLocal(r);throw e;}})();
  r.inFlight=pass;try{return await pass;}finally{r.inFlight=null;}
 }
 async function approveOriginal(event,id){
  const r=selected(id);if(r.phase!=='review'||r.inFlight||r.decided)fail('DEVICE_REGISTRATION_REVIEW_ALREADY_DECIDED');current(r);
  r.approvalGuard=vault.authorization.current();
  r.phase='capturing-account-approval';let BrowserWindow;
  try{({BrowserWindow}=await import('electron'));current(r);}catch(e){if(!r.retired)r.phase='review';throw e;}
  const sender=event?.sender,window=sender&&BrowserWindow.fromWebContents(sender);
  try{if(!window||window.isDestroyed())fail('DEVICE_REGISTRATION_APPROVAL_WINDOW_REQUIRED');assertWalletIPC(event,sender,expectedURL);}
  catch(e){if(!r.retired)r.phase='review';throw e;}
  r.peer={event,sender,window,expires:Math.min(Date.now()+30000,Date.parse(r.view.originalWindow.expiresAt)),windowFor:sender=>BrowserWindow.fromWebContents(sender),frame:event.senderFrame,revoke:()=>retire(r,Error('DEVICE_REGISTRATION_APPROVAL_WINDOW_CHANGED'))};
  sender.on('destroyed',r.peer.revoke);sender.on('did-start-navigation',r.peer.revoke);
  r.decided=true;r.phase='approving-account';const permission=Object.freeze({assert:()=>current(r)});
  const pass=(async()=>{let failed=false,cause;
   try{await authority.approveOriginalDeviceRegistration(r.port,permission);}
   catch(e){failed=true;cause=e;remember(r,e);if(r.phase!=='original-pair-unknown')r.phase='original-approval-unknown';}
   finally{
    try{await closeOriginalDeviceRegistrationClient(r.port);}
    catch(e){remember(r,e);if(!failed){failed=true;cause=e;r.phase='original-cleanup-unconfirmed';}}
    finishLocal(r);
   }
   if(failed)throw cause;
   return status(r); // Read only AFTER the original cleanup has settled.
  })();
  r.inFlight=pass;try{return await pass;}finally{r.inFlight=null;}
 }
 async function rejectOriginal(id){const r=selected(id);retire(r,Error('DEVICE_REGISTRATION_USER_REJECTED'));if(r.inFlight)try{await r.inFlight;}catch{}
  await closeOriginalDeviceRegistrationClient(r.port);finishLocal(r);r.phase=r.decided?'original-pair-unknown':'cancelled-before-account';return status(r);}
 async function close(){closed=true;const r=active;if(!r)return;retire(r,Error('DEVICE_REGISTRATION_CLOSING'));if(r.inFlight)try{await r.inFlight;}catch{}
  await closeOriginalDeviceRegistrationClient(r.port);finishLocal(r);
  if(r.store&&(r.approvalReturned&&!r.approvalSaved||r.responseCaptured&&!r.responseSaved)){
   try{const saved=await r.store.readSessionOriginal(r.security.account,r.view.requestDigest,()=>{});
    if(typeof r.approvalOriginal==='string'&&saved?.approval?.original===r.approvalOriginal)r.approvalSaved=true;
    if(r.responseCaptured&&saved?.pairSubmission?.responseOriginal===r.rawResponse)r.responseSaved=true;
   }catch{}
   if(r.approvalReturned&&!r.approvalSaved||r.responseCaptured&&!r.responseSaved)fail('DEVICE_REGISTRATION_ORIGINAL_SAVE_UNCONFIRMED');
  }
 }
 async function readOriginalPairOutcome(digest){
  const guard=vault.authorization.current();guard.assert();const original=await authority.transactionSender.submissions.intentStore.readSessionPairSubmission(guard.account,digest,()=>guard.assert());
  return original?Object.freeze({operationId:original.operationId,requestDigest:original.requestDigest,status:original.status,
    originalResponseRetained:original.pairSubmission?.responseOriginal!==null&&!!original.pairSubmission,queryOnly:true,canRetry:false,registered:false,newSession:false}):null;
 }
 return Object.freeze({prepareReview,approveOriginal,rejectOriginal,readOriginalPairOutcome,close,readStatusDATA:()=>status(active),
  isPendingReview:id=>active?.request?.id===id&&active.phase==='review'&&!active.retired&&!closed});
}
