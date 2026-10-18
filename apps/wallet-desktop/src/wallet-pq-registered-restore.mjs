import {createPQKeyPreparationSource} from './wallet-pq-key-source.mjs';
import {createDualPQKeyPreparation} from './wallet-pq-key-preparation.mjs';
const fail=(code,data)=>{throw Object.assign(Error(code),{code,...(data?{data:{...data,code}}:{})});};
/** Explicit local restoration into an empty protected slot. Auth's readonly
 * registered binding is DATA, never adoption/signing/transaction authority.
 * All providers/paths/original bindings are fixed by main, not IPC or backup.
 * Existing records and UNKNOWN reservations are never overwritten or cleared. */
export function createRegisteredPQRestore({lifecycle,vault,sdk,networkId,id,clock=()=>new Date(),acquire,isOriginal,files,chooseFile}){
 for(const name of ['preparePQRestoreResult','capturePQRestoreResult','pqRestoreResultStatus','commitPQRestoreResult','reconcilePQRestoreResult','selectPQRestoreResultOutcome'])if(typeof vault?.[name]!=='function')fail('PQ_RESTORE_ORIGINAL_RESULT_CUSTODY_REQUIRED');
 const records=new Map(),history=[];let busy=false;
 const remember=(r,cause)=>{if(!r.firstCausePresent){r.firstCausePresent=true;r.firstCause=cause;}};
 const cleanup=(r,cause)=>{if(!r.cleanupCausePresent){r.cleanupCausePresent=true;r.cleanupCause=cause;}};
 const scope=()=>Object.freeze({account:lifecycle.status().account,revision:lifecycle.status().revision,network:networkId});
 function current(r){lifecycle.assertUnlocked();const s=lifecycle.status();if(r.invalidated||s.account!==r.scope.account||s.revision!==r.scope.revision)fail('PQ_RESTORE_VIEW_EXPIRED');}
 function retire(r){r.invalidated=true;if(!r.resource||r.retireSelected)return;r.retireSelected=true;try{if(r.resource.retire()!==undefined)fail('PQ_RESTORE_RETIRE_UNCONFIRMED');}catch(cause){cleanup(r,cause);}}
 async function close(r){
  if(r.closePass)return r.closePass;
  r.closePass=Promise.resolve().then(async()=>{if(!r.resource){r.closed=true;return;}try{if(await r.resource.close()!==undefined)fail('PQ_RESTORE_CLOSE_UNCONFIRMED');r.closed=true;}catch(cause){cleanup(r,cause);throw cause;}});void r.closePass.catch(()=>{});return r.closePass;
 }
 function observation(r,guard){
  guard.assert();current(r);if(!r.resource||isOriginal(r.resource)!==true||r.resource.assertCurrent()!==undefined)fail('PQ_RESTORE_ORIGINAL_SOURCE_REQUIRED');
  const value=r.resource.readOriginal();
  if(!value||!Object.isFrozen(value)||value.version!=='YNX-WALLET-REGISTERED-BINDING/v1'||value.dataOnly!==true||['restorationAuthorized','adoptionAuthorized','signingAuthorized','transactionAuthorized','retryAuthorized'].some(key=>value[key]!==false))fail('PQ_RESTORE_ORIGINAL_SOURCE_REQUIRED');
  const binding=sdk.validatePQPublicBinding(value.publicBinding);
  if(binding.owner!==r.scope.account||binding.chainId!==networkId)fail('PQ_RESTORE_BINDING_CHANGED');
  if(r.expected)sdk.assertPQPublicBindingMatches(binding,r.expected);else r.expected=binding;
  return binding;
 }
 function publicState(r){const s=r?.failed&&!r.reservationEntered?null:r?.controller?.status(),result=r?.restoreResult?vault.pqRestoreResultStatus(r.restoreResult):null,cleanupDebt=r?.cleanupCausePresent===true||s?.cleanupDebt===true,sourceClosed=r?r.closed===true&&(r.resumeReads??[]).every(read=>read.closed===true):true;return Object.freeze({phase:result?.persisted?'saved':result?.resumeAvailable?'restore-retained':s?.phase??(r?.failed?'failed':r?'reading-original':'idle'),busy,hasOriginal:s?.hasOriginal??false,persisted:result?.persisted??s?.persisted??false,persistenceAttempted:result?.persistenceAttempted??s?.persistenceAttempted??false,preparationUnknown:s?.preparationUnknown??false,cleanupDebt,sourceClosed,resumeAvailable:result?.resumeAvailable===true&&sourceClosed&&!cleanupDebt,registrationPerformed:false,signingAuthorized:false,transactionAuthorized:false,retryAuthorized:false});}
 function incomplete(r){
  const state=publicState(r),cause=r.firstCause,code=cause?.data?.code??cause?.code;let safe='PQ_REGISTERED_RESTORE_INCOMPLETE';
  if(state.cleanupDebt)safe='PQ_RESTORE_CLEANUP_UNCONFIRMED';
  else if(!r.controller){
   if(code==='PASSWORD_VAULT_PQ_ORIGINAL_EXISTS')safe='PQ_RESTORE_ORIGINAL_EXISTS';
   else if(code==='PQ_BACKUP_AUTHENTICATION_FAILED')safe='PQ_RESTORE_CREDENTIAL_MISMATCH';
   else if(['PQ_BINDING_MISMATCH','PQ_BACKUP_ENCODING_INVALID','PQ_BACKUP_VERSION_UNSUPPORTED','PQ_BACKUP_CRYPTO_UNSUPPORTED'].includes(code))safe='PQ_RESTORE_WRONG_BACKUP';
   else if(r.factoryError||code==='PQ_RESTORE_ORIGINAL_SOURCE_REQUIRED')safe='PQ_RESTORE_REGISTERED_SOURCE_UNAVAILABLE';
  }
  fail(safe,state);
 }
 return Object.freeze({status:()=>publicState(records.get(lifecycle.status().account)),
  async restore(input){
   if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==1||typeof Object.getOwnPropertyDescriptor(input,'credential')?.value!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(input.credential))fail('PQ_RESTORE_CREDENTIAL_REQUIRED');
   if(busy||history.length>=64)fail('PQ_RESTORE_ORIGINAL_UNRESOLVED');
   const originalScope=scope(),previous=records.get(originalScope.account);
   // A failed, fully closed READ before any reservation/SDK import can be
   // explicitly retried. Retain it in history; never replay an entered restore.
   if(previous&&(previous.reservationEntered||!previous.closed||previous.cleanupCausePresent))fail('PQ_RESTORE_ORIGINAL_UNRESOLVED');
   const r={scope:originalScope,resource:null,expected:null,controller:null,reservationEntered:false,closed:false,invalidated:false,firstCausePresent:false,cleanupCausePresent:false,failed:false};
   let wire,credential=input.credential,unsubscribe;busy=true;
   try{
    await lifecycle.run(async guard=>{
     current(r);await vault.assertPQPreparationAvailable();guard.assert();
     const file=await chooseFile();guard.assert();current(r);if(!file)return;
     wire=await files.read(file,guard);guard.assert();current(r);
     records.set(originalScope.account,r);history.push(r);
     unsubscribe=lifecycle.subscribe(s=>{if(s.locked||s.account!==originalScope.account||s.revision!==originalScope.revision)retire(r);});
     try{r.resource=await acquire({networkId,nativeChainId:'6423',owner:originalScope.account,operation:'read-registered-binding',at:clock().toISOString()});}
     catch(cause){const d=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'partial'):null;if(d&&Object.hasOwn(d,'value'))r.resource=d.value;const first=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'cause'):null;r.factoryError=cause;remember(r,first&&Object.hasOwn(first,'value')?first.value:cause);throw cause;}
     // Capture the exact original before any guard/brand/expiry fence.
     if(r.invalidated)retire(r);const expected=observation(r,guard);
     // Authenticate the SDK container before reserving a key import. Wrong
     // credentials/another account are known input refusals, not a new UNKNOWN
     // key acquisition. DER stays in protected main briefly and is wiped; the
     // sole SDK still imports/recomputes both keys after durable reservation.
     let material;
     try{material=await sdk.openPQWalletBackup(wire,credential,expected);guard.assert();current(r);sdk.assertPQPublicBindingMatches(material.binding,expected);}
     finally{material?.pkcs8A.fill(0);material?.pkcs8B.fill(0);}
    });
    if(!wire)return Object.freeze({cancelled:true,persisted:false});current(r);
    const originalSource=createPQKeyPreparationSource({sdk,
     getOriginalNetwork:()=>Object.freeze({chainId:networkId,owner:originalScope.account}),
     getRegisteredBinding:({guard})=>observation(r,guard),readRestoreInput:()=>({wire,credential}),
     repository:{assertCanPrepare:async value=>{r.reservationEntered=true;await vault.reservePQPreparation(value);value.guard.assert();r.restoreResult=await vault.preparePQRestoreResult({wire,credential,publicBinding:r.expected,operationId:value.operationId});},
      saveKeys:async value=>{value.guard.assert();if(r.captureCausePresent)throw r.captureCause;if(await r.resource.recheck()!==undefined)fail('PQ_RESTORE_RECHECK_UNCONFIRMED');observation(r,value.guard);return vault.commitPQRestoreResult(r.restoreResult);},
      readKeys:()=>vault.reconcilePQRestoreResult(r.restoreResult),verifySavedKeys:async value=>{const actual=await vault.reconcilePQRestoreResult(r.restoreResult);return value.receipt?.recordDigest===actual.recordDigest&&value.receipt?.operationId===actual.operationId&&value.receipt?.account===actual.account;},
     }});
    const source=Object.freeze({...originalSource,async prepare(...args){
     const material=await originalSource.prepare(...args);
     // Keep the exact returned material even if public-result proof capture
     // fails. The controller must still retire this original handle once.
     try{originalSource.selectOriginal(material,value=>{if(vault.capturePQRestoreResult(r.restoreResult,value.handle)!==true)vault.selectPQRestoreResultOutcome(r.restoreResult,outcome=>{throw outcome.firstCausePresent?outcome.firstCause:Error('PQ_RESTORE_RESULT_UNVERIFIED');});});}
     catch(cause){r.captureCausePresent=true;r.captureCause=cause;}
     return material;
    }});
    r.controller=createDualPQKeyPreparation({lifecycle,source,getBinding:()=>({account:originalScope.account,network:networkId}),id});
    await r.controller.restore();r.controller.cancel();current(r);
   }catch(cause){r.failed=true;remember(r,cause);if(!r.reservationEntered)try{r.controller?.dispose();}catch(error){cleanup(r,error);}}
   finally{
    wire?.fill(0);credential=null;unsubscribe?.();
    try{await close(r);}catch{/* Separate cleanup cause retained by close. */}
    busy=false;
   }
   if(r.failed||r.cleanupCausePresent||r.controller?.status().cleanupDebt)incomplete(r);
   try{current(r);}catch(cause){remember(r,cause);throw cause;}return publicState(r);
  },
  async recover(){
   if(busy)fail('PQ_RESTORE_ORIGINAL_UNRESOLVED');const originalScope=scope(),r=records.get(originalScope.account);
   current({invalidated:false,scope:originalScope});
   let value;busy=true;
   try{
    if(r?.restoreResult){const result=vault.pqRestoreResultStatus(r.restoreResult);if(result.persistenceAttempted)await lifecycle.run(()=>vault.reconcilePQRestoreResult(r.restoreResult));value=publicState(r);}
    else if(!r?.controller||!r.reservationEntered){const state=await lifecycle.run(()=>vault.readPQPreparationStatus({networkId}));value={...state,cleanupDebt:state.cleanupDebt||r?.cleanupCausePresent===true,sourceClosed:r?.closed??true,registrationPerformed:false,signingAuthorized:false,transactionAuthorized:false,retryAuthorized:false};}
    else{const s=r.controller.status();if(s.persistenceAttempted&&!s.persisted&&!s.preparationUnknown)await r.controller.reconcile();value=publicState(r);}
    current({invalidated:false,scope:originalScope});
   }finally{busy=false;}
   return Object.freeze({...value,busy:false});
  },
  async resume(){
   if(busy||history.length>=64)fail('PQ_RESTORE_ORIGINAL_UNRESOLVED');const selected=scope(),r=records.get(selected.account);
   current({invalidated:false,scope:selected});
   if(!r?.restoreResult||!publicState(r).resumeAvailable)fail('PQ_RESTORE_ORIGINAL_UNRESOLVED');
   const read={scope:selected,expected:r.expected,resource:null,closed:false,invalidated:false,firstCausePresent:false,cleanupCausePresent:false};
   history.push(read);(r.resumeReads??=[]).push(read);busy=true;let failed=false,unsubscribe;
   try{
    await lifecycle.run(async guard=>{
     current(read);unsubscribe=lifecycle.subscribe(s=>{if(s.locked||s.account!==selected.account||s.revision!==selected.revision)retire(read);});
     try{read.resource=await acquire({networkId,nativeChainId:'6423',owner:selected.account,operation:'read-registered-binding',at:clock().toISOString()});}
     catch(cause){const d=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'partial'):null;if(d&&Object.hasOwn(d,'value'))read.resource=d.value;const first=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'cause'):null;remember(read,first&&Object.hasOwn(first,'value')?first.value:cause);throw cause;}
     if(read.invalidated)retire(read);observation(read,guard);
     if(await read.resource.recheck()!==undefined)fail('PQ_RESTORE_RECHECK_UNCONFIRMED');observation(read,guard);
     // Fresh original registered binding is data, not a new import/sign grant.
     // The Vault can save only this same encrypted, verified original result.
     await vault.commitPQRestoreResult(r.restoreResult,{resume:true});current(read);
    });
   }catch(cause){failed=true;remember(read,cause);remember(r,cause);}
   finally{unsubscribe?.();try{await close(read);}catch(cause){cleanup(r,cause);failed=true;}if(read.cleanupCausePresent)cleanup(r,read.cleanupCause);busy=false;}
   if(failed||read.cleanupCausePresent||publicState(r).cleanupDebt)incomplete(r);
   current({invalidated:false,scope:selected});return publicState(r);
  },
  // Original main custody only. Never expose raw sources/causes through IPC.
  selectOriginalOutcome(observer){if(typeof observer!=='function')fail('PQ_RESTORE_OBSERVER_REQUIRED');const r=records.get(lifecycle.status().account);return observer(r?Object.freeze({...r}):null);},
 });
}
