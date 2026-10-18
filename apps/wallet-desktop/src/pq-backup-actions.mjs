import {timingSafeEqual} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Main-only composition. Dialog paths, original binding and SDK material
 * never come from IPC. Return the independent credential only after explicit
 * export/verify and exact readback plus both-key SDK restoration/retirement.
 * Verification is NOT adoption, chain registration or signing authority. */
export function createPQBackupActions({lifecycle,vault,sdk,networkId,files,chooseExportFile,chooseVerifyFile}){
 let cleanupDebt=null,firstCause,firstCausePresent=false,lastOriginal=null;
 const retain=cause=>{if(!firstCausePresent){firstCause=cause;firstCausePresent=true;}};
 async function execute(exporting){
  if(cleanupDebt)fail('PQ_KEY_CLEANUP_UNRESOLVED');
  const security=lifecycle.status();
  const result=await lifecycle.run(async guard=>{
   const binding=await vault.readPQProposalBinding(networkId);guard.assert();
   const filePath=await (exporting?chooseExportFile(binding.owner):chooseVerifyFile(binding.owner));guard.assert();
   if(!filePath)return Object.freeze({saved:false,verified:false,walletChanged:false});
   const original={account:binding.owner,filePath,exporting,writeEntered:false,verified:false,failed:false};lastOriginal=original;
   try{return await vault.withPQBackup(networkId,async(payload,current)=>{
    sdk.assertPQPublicBindingMatches(payload.binding,binding);current.assert();
    if(exporting){original.writeEntered=true;await files.write(filePath,payload.wire,current);}
    let wire,handle,failed=false,cause,retirementFailed=false;
    try{
     wire=await files.read(filePath,current);current.assert();
     if(!(wire instanceof Uint8Array)||wire.length!==payload.wire.length||!timingSafeEqual(wire,payload.wire))fail('PQ_BACKUP_ORIGINAL_FILE_REQUIRED');
     handle=await sdk.restorePQWalletKeyHandle(wire,payload.credential,binding);
     // Capture the late handle before a lock fence can hide it.
     current.assert();sdk.assertPQPublicBindingMatches(sdk.readPQWalletKeyPublic(handle),binding);current.assert();
    }catch(error){failed=true;cause=error;retain(error);}
    finally{
     wire?.fill(0);
     if(handle)try{if(sdk.destroyPQWalletKeyHandle(handle)!==true)fail('PQ_KEY_CLEANUP_UNRESOLVED');}
     catch(error){retirementFailed=true;cleanupDebt={handle,cause:error};}
    }
    if(failed)throw cause;if(retirementFailed)fail('PQ_KEY_CLEANUP_UNRESOLVED');current.assert();
    original.verified=true;
    return Object.freeze({saved:exporting,verified:true,credential:payload.credential,account:binding.owner,walletChanged:false,registered:false,signed:false,broadcast:false});
   });}
   catch(error){original.failed=true;if(!cleanupDebt)retain(error);fail(cleanupDebt?'PQ_KEY_CLEANUP_UNRESOLVED':original.writeEntered?'PQ_BACKUP_EXPORT_UNCONFIRMED':'PQ_BACKUP_FILE_UNVERIFIED');}
  });
  const current=lifecycle.status();
  if(current.locked||current.authenticating||current.account!==security.account||current.revision!==security.revision){const cause=Object.assign(Error('PQ_BACKUP_VIEW_EXPIRED'),{code:'PQ_BACKUP_VIEW_EXPIRED'});retain(cause);throw cause;}
  return result;
 }
 return Object.freeze({export:()=>execute(true),verify:()=>execute(false),
  status:()=>Object.freeze({cleanupDebt:!!cleanupDebt,firstCausePresent,exportAttempted:lastOriginal?.writeEntered??false,lastFileVerified:lastOriginal?.verified??false}),
  // Original main recovery/debug custody only, never preload/IPC or logs.
  selectOriginalOutcome(observer){if(typeof observer!=='function')fail('PQ_BACKUP_OBSERVER_REQUIRED');return observer(Object.freeze({original:lastOriginal?Object.freeze({...lastOriginal}):null,firstCausePresent,firstCause,cleanupDebt}));},
 });
}
