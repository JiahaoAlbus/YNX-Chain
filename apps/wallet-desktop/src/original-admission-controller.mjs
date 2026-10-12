import {admissionCanonical,captureInstalledAdmission,launchOriginalAdmissionIDE} from './original-admission-broker.mjs';
const failure=code=>Object.assign(new Error(code),{code});
// Supply is fixed original-main custody, NEVER an IPC/renderer/ENV object.
// No supplier is provisioned by this controller, and no account key is used.
export function createOriginalAdmissionController({getSupply=()=>null,run,getContext,id,now=Date.now,onState=()=>{}}){
  let phase='not-supplied',revision=0,stateRevision=0,review=null,active=false,owner=null,heldSupply=null,channel=null,publication=null,first=null,cleanupError=null,unknown=false;
  function status(){let available=false;try{available=getSupply()!==null;}catch{}const r=review?.raw.expectedRequest;return Object.freeze({phase,available,busy:active,revision:stateRevision,hasReview:!!review,review:review?Object.freeze({id:review.id,product:'developer',platform:'macos',service:'wallet-product-session-v2',applicationId:r.applicationId,gatewayOrigin:r.gatewayOrigin,consumerManifestDigest:r.consumerManifestDigest,gatewayManifestDigest:r.gatewayManifestDigest,registryDigest:r.registryDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:review.deadline}):null,publicationRetained:!!publication,outcomeUnknown:unknown,error:first?'ADMISSION_OPERATION_FAILED':null,cleanupIncomplete:!!cleanupError});}
  const notify=()=>{stateRevision++;try{onState(status());}catch{/* UI observation is not an effect. */}};
  function context(){const c=getContext();if(!c||c.locked||c.authenticating||!c.focused||c.changing)throw failure('WALLET_LOCKED');return c;}
  function live(token,guard){guard?.assert();const c=context();if(token!==revision||!review||c.account!==review.context.account||c.revision!==review.context.revision||now()>=review.deadline)throw failure('ADMISSION_OPERATION_RETIRED');}
  function dispose(){if(owner!==null){const ref=owner;owner=null;try{heldSupply.closeOriginalServiceAdmissionProductionOwner(ref);}catch(e){cleanupError??=e;}}try{channel?.close();}catch(e){cleanupError??=e;}}
  function cancel(){revision++;review=null;if(active&&publication)unknown=true;dispose();phase=unknown?'unknown':'cancelled';notify();return status();}
  return Object.freeze({status,cancel,
    review(){try{
      if(active||unknown||cleanupError)throw failure('ADMISSION_OPERATION_UNRESOLVED');
      const c=context(),s=getSupply();if(!s){phase='not-supplied';notify();throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');}
      // These calls are to the fixed original custodian, not inferred grant.
      s.assertCurrent();
      if(s.broker)s.broker.assertCurrent();
      else {if(!s.executor||typeof s.assertExecutorCurrent!=='function')throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');s.assertExecutorCurrent(s.executor,null);}
      const raw=JSON.parse(admissionCanonical(s.raw)),deadline=Math.min(raw.expiresAtMs,c.unlockExpiresAt??now(),now()+120000);
      if(!Number.isSafeInteger(deadline)||deadline<=now())throw failure('ADMISSION_REVIEW_EXPIRED');
      heldSupply=s;channel=s.broker??null;review={id:id(),raw,context:{account:c.account,revision:c.revision},deadline};revision++;phase='review';first=null;publication=null;notify();return status();
    }catch(e){if(e.code==='WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'||e.code==='ADMISSION_OPERATION_UNRESOLVED')throw e;first??=e;phase=unknown?'unknown':'failed';notify();throw failure('ADMISSION_REVIEW_UNAVAILABLE');}
    },
    async confirm(reviewId){
      if(active||unknown||cleanupError||!review||reviewId!==review.id)throw failure('ADMISSION_REVIEW_CHANGED');
      active=true;phase='acquiring';const token=revision,s=heldSupply;let acquisitionEntered=false,publishEntered=false;
      notify();
      try{
        await run(async guard=>{
          live(token,guard);s.assertCurrent();channel?.assertCurrent();
          const originalReview=Object.freeze({account:review.context.account,assert:()=>{live(token,guard);s.assertCurrent();},assertAdmissionSuccession:request=>{live(token,guard);s.assertAdmissionSuccession(request);}});
          acquisitionEntered=true;
          const ref=await s.vault.acquireOriginalServiceAdmissionProduction(review.raw,originalReview,s.observer);
          owner=ref;live(token,guard);
          await s.assertOriginalServiceAdmissionProductionOwner(ref);live(token,guard);
          if(!channel){
            const r=review.raw.expectedRequest;
            if(['applicationId','consumerManifestDigest','instanceId','currentReference'].some(k=>s.executor[k]!==r[k]))throw failure('ADMISSION_EXECUTOR_BINDING_CHANGED');
            phase='launching';notify();channel=await launchOriginalAdmissionIDE({executor:s.executor,assertExecutorCurrent:s.assertExecutorCurrent,assertCustodyCurrent:()=>{live(token,guard);s.assertCurrent();},now});live(token,guard);
          }
          publishEntered=true;phase='publishing';notify();
          const result=await s.publishOriginalServiceAdmissionProduction(ref);
          publication=captureInstalledAdmission(result,now()); // Never erased on later cancellation/ACK loss.
          live(token,guard);if(publication.account!==review.context.account)throw failure('ADMISSION_ACCOUNT_CHANGED');
          await s.assertOriginalServiceAdmissionProductionOwner(ref);live(token,guard);
          phase='delivering';notify();await channel.deliver(publication);
          live(token,guard);await s.assertOriginalServiceAdmissionProductionOwner(ref);channel.assertCurrent();live(token,guard);
          phase='acknowledged';notify();
        });
        if(token!==revision)throw failure('ADMISSION_OPERATION_RETIRED');
      }catch(e){first??=e;unknown ||= publishEntered||acquisitionEntered;phase=unknown?'unknown':'failed';throw failure('ADMISSION_OPERATION_FAILED');}
      finally{dispose();active=false;review=null;if(cleanupError){unknown=true;phase='unknown';}notify();}
      return status();
    },
  });
}
