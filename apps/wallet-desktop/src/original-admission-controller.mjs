import {admissionCanonical,captureInstalledAdmission,launchOriginalAdmissionIDE} from './original-admission-broker.mjs';
const failure=code=>Object.assign(new Error(code),{code});
// Supply is fixed original-main custody, NEVER an IPC/renderer/ENV object.
// No supplier is provisioned by this controller, and no account key is used.
export function createOriginalAdmissionController({getSupply=()=>null,run,getContext,id,now=Date.now,onState=()=>{}}){
  let phase='not-supplied',revision=0,stateRevision=0,review=null,active=false,owner=null,heldSupply=null,channel=null,publication=null,first=null,cleanupError=null,unknown=false,acknowledged=false;
  function status(){let available=false;try{available=getSupply()!==null;}catch{}const r=review?.raw.expectedRequest;return Object.freeze({phase,available,busy:active,revision:stateRevision,hasReview:!!review,review:review?Object.freeze({id:review.id,product:'developer',platform:'macos',service:'wallet-product-session-v2',applicationId:r.applicationId,gatewayOrigin:r.gatewayOrigin,consumerManifestDigest:r.consumerManifestDigest,gatewayManifestDigest:r.gatewayManifestDigest,registryDigest:r.registryDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:review.deadline}):null,publicationRetained:!!publication,outcomeUnknown:unknown,error:first?'ADMISSION_OPERATION_FAILED':null,cleanupIncomplete:!!cleanupError});}
  const notify=()=>{stateRevision++;try{onState(status());}catch{/* UI observation is not an effect. */}};
  function context(){const c=getContext();if(!c||c.locked||c.authenticating||!c.focused||c.changing)throw failure('WALLET_LOCKED');return c;}
  function live(token,guard){guard?.assert();const c=context();if(token!==revision||!review||c.account!==review.context.account||c.revision!==review.context.revision||now()>=review.deadline)throw failure('ADMISSION_OPERATION_RETIRED');}
  function supplyCurrent(s){if(s.assertCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}
  async function ownerCurrent(s,ref){if(await s.assertOriginalServiceAdmissionProductionOwner(ref)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}
  function dispose(){if(owner!==null){const ref=owner;owner=null;try{heldSupply.closeOriginalServiceAdmissionProductionOwner(ref);}catch(e){cleanupError??=e;}}try{channel?.close();}catch(e){cleanupError??=e;}}
  function cancel(){revision++;review=null;if(active&&publication&&!acknowledged)unknown=true;dispose();phase=unknown?'unknown':'cancelled';notify();return status();}
  return Object.freeze({status,cancel,
    review(){try{
      if(active||unknown||cleanupError)throw failure('ADMISSION_OPERATION_UNRESOLVED');
      const c=context(),s=getSupply();if(!s){phase='not-supplied';notify();throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');}
      // These calls are to the fixed original custodian, not inferred grant.
      supplyCurrent(s);
      if(s.broker)s.broker.assertCurrent();
      else {if(!s.executor||typeof s.assertExecutorCurrent!=='function')throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');if(s.assertExecutorCurrent(s.executor,null)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}
      const raw=JSON.parse(admissionCanonical(s.raw)),deadline=Math.min(raw.expiresAtMs,c.unlockExpiresAt??now(),now()+120000);
      if(!Number.isSafeInteger(deadline)||deadline<=now())throw failure('ADMISSION_REVIEW_EXPIRED');
      heldSupply=s;channel=s.broker??null;review={id:id(),raw,context:{account:c.account,revision:c.revision},deadline};revision++;phase='review';first=null;publication=null;acknowledged=false;notify();return status();
    }catch(e){if(e.code==='WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'||e.code==='ADMISSION_OPERATION_UNRESOLVED')throw e;first??=e;phase=unknown?'unknown':'failed';notify();throw failure('ADMISSION_REVIEW_UNAVAILABLE');}
    },
    async confirm(reviewId){
      if(active||unknown||cleanupError||!review||reviewId!==review.id)throw failure('ADMISSION_REVIEW_CHANGED');
      active=true;phase='acquiring';const token=revision,s=heldSupply;let acquisitionEntered=false,publishEntered=false;
      notify();
      try{
        await run(async guard=>{
          live(token,guard);supplyCurrent(s);channel?.assertCurrent();
          const originalReview=Object.freeze({account:review.context.account,assert:()=>{live(token,guard);supplyCurrent(s);},assertAdmissionSuccession:request=>{live(token,guard);if(s.assertAdmissionSuccession(request)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');}});
          acquisitionEntered=true;
          const ref=await s.vault.acquireOriginalServiceAdmissionProduction(review.raw,originalReview,s.observer);
          owner=ref;live(token,guard);
          await ownerCurrent(s,ref);live(token,guard);
          if(!channel){
            const r=review.raw.expectedRequest;
            if(['applicationId','consumerManifestDigest','instanceId','currentReference'].some(k=>s.executor[k]!==r[k]))throw failure('ADMISSION_EXECUTOR_BINDING_CHANGED');
            phase='launching';notify();channel=await launchOriginalAdmissionIDE({executor:s.executor,assertExecutorCurrent:s.assertExecutorCurrent,assertCustodyCurrent:()=>{live(token,guard);supplyCurrent(s);},now});live(token,guard);
          }
          publishEntered=true;phase='publishing';notify();
          const result=await s.publishOriginalServiceAdmissionProduction(ref);
          publication=captureInstalledAdmission(result,now()); // Never erased on later cancellation/ACK loss.
          live(token,guard);if(publication.account!==review.context.account||publication.expiresAtMs>review.deadline)throw failure('ADMISSION_ACCOUNT_OR_DEADLINE_CHANGED');
          await ownerCurrent(s,ref);live(token,guard);
          phase='delivering';notify();await channel.deliver(publication);
          live(token,guard);await ownerCurrent(s,ref);channel.assertCurrent();live(token,guard);
          acknowledged=true;phase='acknowledged';notify();
          // Keep the actual run/owner open only for this original epoch. No
          // dead-guard capture, renewal, automatic publication or 5min lease.
          const retired=await channel.waitRetirement(async()=>{live(token,guard);await ownerCurrent(s,ref);live(token,guard);});
          if(retired.reason!=='ADMISSION_EPOCH_EXPIRED')first??=retired.error;
          phase='retired';notify();
        });
        if(token!==revision)throw failure('ADMISSION_OPERATION_RETIRED');
      }catch(e){first??=e;unknown ||= !acknowledged&&(publishEntered||acquisitionEntered);phase=unknown?'unknown':acknowledged?'retired':'failed';throw failure('ADMISSION_OPERATION_FAILED');}
      finally{dispose();active=false;review=null;if(cleanupError){unknown=true;phase='unknown';}notify();}
      return status();
    },
  });
}
