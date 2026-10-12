import {admissionCanonical,captureInstalledAdmission,launchOriginalAdmissionIDE} from './original-admission-broker.mjs';
const failure=code=>Object.assign(new Error(code),{code});
const immutable=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
// Supply is fixed original-main custody, NEVER an IPC/renderer/ENV object.
// No supplier is provisioned by this controller, and no account key is used.
export function createOriginalAdmissionController({getSupply=()=>null,run,getContext,id,now=Date.now,onState=()=>{}}){
  let phase='not-supplied',revision=0,stateRevision=0,review=null,active=false,owner=null,heldSupply=null,channel=null,publication=null,originalPublication=null,publicationReturned=false,first=null,firstPresent=false,cleanupError=null,cleanupFailurePresent=false,unknown=false,acknowledged=false,closeEntered=false,channelCloseEntered=false;
  const retainFirst=e=>{if(!firstPresent){first=e;firstPresent=true;}};
  const retainCleanup=e=>{if(!cleanupFailurePresent){cleanupError=e;cleanupFailurePresent=true;}unknown=true;};
  function status(){let available=false;try{available=getSupply()!==null;}catch{}const r=review?.raw.expectedRequest;return Object.freeze({phase,available,busy:active,revision:stateRevision,hasReview:!!review,review:review?Object.freeze({id:review.id,product:'developer',platform:'macos',service:'wallet-product-session-v2',applicationId:r.applicationId,gatewayOrigin:r.gatewayOrigin,consumerManifestDigest:r.consumerManifestDigest,gatewayManifestDigest:r.gatewayManifestDigest,registryDigest:r.registryDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:review.deadline}):null,publicationRetained:publicationReturned,ownerRetained:owner!==null,outcomeUnknown:unknown,error:firstPresent?'ADMISSION_OPERATION_FAILED':null,cleanupIncomplete:cleanupFailurePresent});}
  const notify=()=>{stateRevision++;try{onState(status());}catch{/* UI observation is not an effect. */}};
  function context(){const c=getContext();if(!c||c.locked||c.authenticating||!c.focused||c.changing)throw failure('WALLET_LOCKED');return c;}
  function live(token,guard){guard?.assert();const c=context();if(token!==revision||!review||c.account!==review.context.account||c.revision!==review.context.revision||now()>=review.deadline)throw failure('ADMISSION_OPERATION_RETIRED');}
  function supplyCurrent(s){if(s.assertCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}
  async function ownerCurrent(s,ref){if(await s.assertOriginalServiceAdmissionProductionOwner(ref)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}
  function retireChannel(){if(!channel||channelCloseEntered)return;channelCloseEntered=true;try{channel.close();}catch(e){retainCleanup(e);}}
  async function dispose(){
    retireChannel();
    // EOF retires business use immediately, not ownership of entered callbacks.
    try{await channel?.joinEntered?.();}catch(e){retainCleanup(e);}
    if(cleanupFailurePresent)return;
    if(owner!==null&&!closeEntered){closeEntered=true;try{
      const result=heldSupply.closeOriginalServiceAdmissionProductionOwner(owner);
      // Auth same-Vault supply has an explicit original-ref completion ABI.
      // Generic R10 suppliers still do not qualify arbitrary async close.
      if(result!==undefined&&typeof heldSupply.completeOriginalServiceAdmissionProductionClose==='function'){
        if(await heldSupply.completeOriginalServiceAdmissionProductionClose(owner,result)!==undefined)throw failure('ADMISSION_CLOSE_RESULT_UNKNOWN');
        owner=null;
      }
      else if(result!==undefined){retainCleanup(failure('ADMISSION_CLOSE_RESULT_UNKNOWN'));notify();await Promise.resolve(result).catch(retainFirst);}
      else owner=null;
    }catch(e){retainCleanup(e);}}
  }
  function cancel(){revision++;review=null;if(active&&publicationReturned&&!acknowledged)unknown=true;retireChannel();phase=unknown?'unknown':'cancelled';notify();return status();}
  return Object.freeze({status,cancel,
    // Trusted original-main recovery selection ONLY; deliberately absent from
    // renderer IPC/status. Retention is not a grant to sign, send or retry.
    // Observer is synchronous, receives the exact original references, and
    // cannot replace them. No automatic second disposal of uncertain custody.
    selectRetainedOutcome(observer){if(typeof observer!=='function')throw failure('ADMISSION_RECOVERY_OBSERVER_INVALID');return observer(Object.freeze({owner,supply:heldSupply,publication:originalPublication,publicationReturned,firstCause:first,firstCausePresent:firstPresent,cleanupCause:cleanupError,cleanupFailurePresent,closeEntered}));},
    review(){try{
      if(active||unknown||cleanupFailurePresent||owner!==null)throw failure('ADMISSION_OPERATION_UNRESOLVED');
      const c=context(),s=getSupply();if(!s){phase='not-supplied';notify();throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');}
      const raw=immutable(JSON.parse(admissionCanonical(s.raw))),executor=s.executor?immutable(JSON.parse(admissionCanonical(s.executor))):null;
      // These calls are to the fixed original custodian, not inferred grant.
      supplyCurrent(s);
      if(s.broker)s.broker.assertCurrent();
      else {if(!executor||typeof s.assertExecutorCurrent!=='function')throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');if(s.assertExecutorCurrent(immutable(JSON.parse(admissionCanonical(executor))),null)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}
      if(admissionCanonical(s.raw)!==admissionCanonical(raw)||executor&&admissionCanonical(s.executor)!==admissionCanonical(executor))throw failure('ADMISSION_REVIEW_BINDING_CHANGED');
      const deadline=Math.min(raw.expiresAtMs,c.unlockExpiresAt??now(),now()+120000);
      if(!Number.isSafeInteger(deadline)||deadline<=now())throw failure('ADMISSION_REVIEW_EXPIRED');
      heldSupply=s;channel=s.broker??null;review={id:id(),raw,executor,context:{account:c.account,revision:c.revision},deadline};revision++;phase='review';first=null;firstPresent=false;publication=null;originalPublication=null;publicationReturned=false;closeEntered=false;channelCloseEntered=false;acknowledged=false;notify();return status();
    }catch(e){if(e?.code==='WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'||e?.code==='ADMISSION_OPERATION_UNRESOLVED')throw e;retainFirst(e);phase=unknown?'unknown':'failed';notify();throw failure('ADMISSION_REVIEW_UNAVAILABLE');}
    },
    async confirm(reviewId){
      if(active||unknown||cleanupFailurePresent||owner!==null||!review||reviewId!==review.id)throw failure('ADMISSION_REVIEW_CHANGED');
      active=true;phase='acquiring';const token=revision,s=heldSupply,approved=review;let acquisitionEntered=false,publishEntered=false;
      notify();
      try{
        await run(async guard=>{
          live(token,guard);supplyCurrent(s);channel?.assertCurrent();
          const originalReview=Object.freeze({account:approved.context.account,assert:()=>{live(token,guard);supplyCurrent(s);},assertAdmissionSuccession:request=>{live(token,guard);if(admissionCanonical(request)!==admissionCanonical(approved.raw.expectedRequest))throw failure('ADMISSION_REQUEST_BINDING_CHANGED');if(s.assertAdmissionSuccession(request)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}});
          acquisitionEntered=true;
          const ref=await s.vault.acquireOriginalServiceAdmissionProduction(immutable(JSON.parse(admissionCanonical(approved.raw))),originalReview,s.observer);
          owner=ref;live(token,guard);
          await ownerCurrent(s,ref);live(token,guard);
          if(!channel){
            const r=approved.raw.expectedRequest;
            if(admissionCanonical(s.executor)!==admissionCanonical(approved.executor)||['applicationId','consumerManifestDigest','instanceId','currentReference'].some(k=>approved.executor[k]!==r[k]))throw failure('ADMISSION_EXECUTOR_BINDING_CHANGED');
            phase='launching';notify();channel=await launchOriginalAdmissionIDE({executor:approved.executor,assertExecutorCurrent:s.assertExecutorCurrent,assertCustodyCurrent:()=>{live(token,guard);supplyCurrent(s);},now});live(token,guard);
          }
          publishEntered=true;phase='publishing';notify();
          const result=await s.publishOriginalServiceAdmissionProduction(ref);
          originalPublication=result;publicationReturned=true; // retain BEFORE any validation or clock/current callback
          publication=captureInstalledAdmission(result,now()); // Never erased on later cancellation/ACK loss.
          live(token,guard);if(publication.account!==approved.context.account||publication.expiresAtMs>approved.deadline)throw failure('ADMISSION_ACCOUNT_OR_DEADLINE_CHANGED');
          for(const key of ['expectedRequest','sourceSelection','receiptDirectory'])if(admissionCanonical(publication.selection[key])!==admissionCanonical(approved.raw[key]))throw failure('ADMISSION_REQUEST_BINDING_CHANGED');
          await ownerCurrent(s,ref);live(token,guard);
          phase='delivering';notify();
          if(typeof s.enterOriginalServiceAdmissionDelivery!=='function'||typeof s.acknowledgeOriginalServiceAdmissionDelivery!=='function')throw failure('ADMISSION_DURABLE_DELIVERY_NOT_SUPPLIED');
          if(await s.enterOriginalServiceAdmissionDelivery(ref)!==undefined)throw failure('ADMISSION_DELIVERY_STATE_UNKNOWN');
          live(token,guard);await ownerCurrent(s,ref);live(token,guard);
          try{await channel.deliver(publication);}catch(error){
            // Best effort ONLY while the original business guard still lives.
            // Cold durable entered is already unresolved if this cannot write.
            if(typeof s.markOriginalServiceAdmissionDeliveryUnknown==='function')try{live(token,guard);await s.markOriginalServiceAdmissionDeliveryUnknown(ref,'ADMISSION_CHANNEL_FAILED');}catch{/* do not replace original channel first cause */}
            throw error;
          }
          live(token,guard);await ownerCurrent(s,ref);channel.assertCurrent();live(token,guard);
          if(await s.acknowledgeOriginalServiceAdmissionDelivery(ref)!==undefined)throw failure('ADMISSION_DELIVERY_STATE_UNKNOWN');
          live(token,guard);
          acknowledged=true;phase='acknowledged';notify();
          // Keep the actual run/owner open only for this original epoch. No
          // dead-guard capture, renewal, automatic publication or 5min lease.
          const retired=await channel.waitRetirement(async()=>{live(token,guard);await ownerCurrent(s,ref);live(token,guard);});
          if(retired.reason!=='ADMISSION_EPOCH_EXPIRED')retainFirst(retired.error);
          phase='retired';notify();
        });
        if(token!==revision)throw failure('ADMISSION_OPERATION_RETIRED');
      }catch(e){retainFirst(e);unknown ||= !acknowledged&&(publishEntered||acquisitionEntered);phase=unknown?'unknown':acknowledged?'retired':'failed';throw failure('ADMISSION_OPERATION_FAILED');}
      finally{await dispose();active=false;review=null;if(cleanupFailurePresent||owner!==null){unknown=true;phase='unknown';}notify();}
      return status();
    },
  });
}
