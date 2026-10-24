import {createPQHostContextReference} from './wallet-pq-host-reference.mjs';
import {createPQFinalityVerifierCapture} from './wallet-pq-verifier-capture.mjs';
import {supportsPackagedPQTypedFinality} from './wallet-pq-verifier-assets.mjs';
import {originalPQVerifierReceipt} from './wallet-pq-verifier-receipt.mjs';
import {preparePQFinalityOriginal} from './wallet-pq-finality-original.mjs';
import {createPQVerifiedFinalityTerminal} from './wallet-pq-finality-terminal.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const safe=owner=>{try{owner?.assertSafeToClose();return true;}catch{return false;}};
/** Main-only orchestration of the original Host and proof callers. Source
 * selection is a private original-producer dependency, never IPC or ENV.
 * Parsed output remains DATA. Only an optional original-Main private adoption
 * after sealed callers/current/evidence can atomically retire an outbox.
 */
export function createPQFinalityVerification({evidence,selectSource,createSource=null,createSelection=null,createProducer,createVerifier,persistObservation,flushObservation,adoptTerminal=null,verifierReceipt=originalPQVerifierReceipt}){
 if(typeof persistObservation!=='function'||typeof flushObservation!=='function')fail('PQ_FINALITY_PRIVATE_JOURNAL_REQUIRED');
 if(createSelection!==null&&typeof createSelection!=='function')fail('PQ_HOST_SELECTION_OWNER_REQUIRED');
 if(createSource!==null&&(typeof createSource!=='function'||createSelection===null))fail('PQ_HOST_ORIGINAL_SOURCE_OWNER_REQUIRED');
 // Capture this private original-Main component choice before any async work.
 // No mutable flag/renderer capability can turn a legacy component into fbec.
 const typedComponentAvailable=supportsPackagedPQTypedFinality(verifierReceipt);
 let operation=null,active=false;
 if(adoptTerminal!==null&&typeof adoptTerminal!=='function')fail('PQ_FINALITY_PRIVATE_JOURNAL_REQUIRED');
 const safeOperation=own=>safe(own.source)&&safe(own.selection)&&safe(own.host)&&safe(own.capture)&&safe(evidence)&&(!own.result||own.journalStored)&&(!own.terminal||own.terminalStored);
 const assertOwner=(original,binding,guard)=>{guard.assert();if(guard.account!==original.account||binding.account!==original.account)fail('PQ_HOST_CONTEXT_MISMATCH');};
 const retire=()=>{operation?.source?.retire();operation?.selection?.retire();operation?.host?.retire();operation?.capture?.retire();};
 async function releaseSource(own){
  if(!own.source)return;
  // All real child joins settle before releasing the original Native owner.
  // A failed join retains custody and blocks close; no replacement is acquired.
  const joined=await Promise.allSettled([own.selection?.join(),own.host?.join(),own.capture?.join()]);
  const failed=joined.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  await own.source.join();await own.source.close();
 }
 return Object.freeze({
  retire,
  pending:original=>operation!==null&&(!original||operation.original.hash===original.hash&&operation.original.account===original.account&&operation.original.operationId===original.operationId),
  assertSafeToClose(){if(active||operation&&!safeOperation(operation))fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');evidence.assertSafeToClose();},
  async join(){const own=operation;await own?.done;await own?.work?.catch(()=>{});await own?.selection?.join();await own?.host?.join();await own?.capture?.join();if(own)await releaseSource(own);},
  async verify(original,binding,proof,guard){
   if(active||operation)fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');assertOwner(original,binding,guard);
   // A source-owned independent closed component receipt is not Host trust.
   // Legacy591 remains denied for typed requests. Validate the complete saved
   // original/review/snapshots before even selecting a prospective Host source.
   if(original.kind==='pq-typed-action'){
    preparePQFinalityOriginal(original,binding);
    if(!typedComponentAvailable)fail('PQ_TYPED_VERIFIER_ASSET_NOT_SUPPLIED');
   }
   active=true;const own={original,binding,source:null,selection:null,host:null,capture:null,verifier:null,work:null,result:null,journalAttempted:false,journalStored:false,terminal:null,terminalStored:false,terminalResult:null};operation=own;
   own.done=new Promise(resolve=>{own.finish=resolve;});
   const executionGuard=Object.freeze({account:guard.account,assert(){guard.assert();own.source?.assertCurrent(guard);}});
   const work=(async()=>{
    // Retain the selector's actual process/capture owner before the first
    // await. Lock and close must not discard its pending local-save debt.
    // A selected profile never falls back to the legacy supplier on failure.
    if(createSource){own.source=createSource(original,binding);if(!own.source)fail('PQ_HOST_ORIGINAL_SOURCE_OWNER_REQUIRED');await own.source.acquire(guard);executionGuard.assert();}
    if(createSelection){own.selection=createSelection(original,binding,own.source?.catalog());if(!own.selection)fail('PQ_HOST_SELECTION_OWNER_REQUIRED');}
    const selection=own.selection?await own.selection.run(executionGuard):await selectSource(original,binding);assertOwner(original,binding,executionGuard);
    own.host=createPQHostContextReference({original,binding,selection,evidence,createProducer});
    await own.host.acquire(executionGuard);
    return own.host.withContext(executionGuard,async(context,current)=>{
     own.verifier=createVerifier();own.capture=createPQFinalityVerifierCapture({evidence,verifier:own.verifier});
     return own.capture.run(original,binding,{...context,proof},current);
    });
   })();own.work=work;
   let failed=false;
   try{
    const result=await work;own.result=result;executionGuard.assert();
    // Retain the private accepted fact before journal IO can fail or lock can
    // retire the live Host. Every raw evidence file is already durable here.
    if(adoptTerminal&&result.observation.status==='verifier-result-data')own.terminal=await createPQVerifiedFinalityTerminal({original,binding,result,selection:own.selection,host:own.host,verifier:own.verifier,evidence,guard:executionGuard});
    own.journalAttempted=true;const saved=await persistObservation(original,result.journalRecord);if(saved?.stored!==true)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.journalStored=true;executionGuard.assert();
    if(adoptTerminal&&own.terminal){const terminal=await adoptTerminal(original,own.terminal,executionGuard);if(terminal?.stored!==true||terminal.consensusFinality!==true||terminal.nativeGrant!==false)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.terminalResult=terminal;own.terminalStored=true;executionGuard.assert();return Object.freeze({...terminal,account:original.account,hash:original.hash,rawStored:true,observationStored:true,nativeGrant:false,canRetry:false,clearsOriginal:false});}
    return Object.freeze({account:original.account,hash:original.hash,status:result.observation.status,rawStored:true,observationStored:true,observation:result.observation,independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false});
   }
   catch(cause){failed=true;throw cause;}
   finally{try{retire();try{await releaseSource(own);}catch(cleanupCause){if(!failed)throw cleanupCause;}if(safeOperation(own))operation=null;}finally{active=false;own.finish();}}
  },
  // Explicit saving never selects a new source, runs current(), or constructs
  // another producer/verifier. Retire before draining retained local evidence.
  async save(original,binding,guard){
   if(active||!operation)fail('PQ_FINALITY_NO_HELD_EVIDENCE');assertOwner(original,binding,guard);
   const own=operation;if(own.original.hash!==original.hash||own.original.operationId!==original.operationId||own.original.account!==original.account)fail('PQ_HOST_CONTEXT_MISMATCH');
   active=true;own.done=new Promise(resolve=>{own.finish=resolve;});retire();
   try{
    if(own.source&&!safe(own.source))await own.source.save(guard);
    if(own.selection&&!safe(own.selection))await own.selection.save(guard);
    if(own.host?.status().pendingSave)await own.host.saveHeld(guard);
    if(own.capture&&!safe(own.capture))await own.capture.save(guard);
    if(own.result&&!own.journalStored){const attempted=own.journalAttempted;own.journalAttempted=true;const saved=attempted?await flushObservation(original,own.result.journalRecord,guard):await persistObservation(original,own.result.journalRecord);if(saved?.stored!==true)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.journalStored=true;}
    if(own.terminal&&!own.terminalStored){const saved=await adoptTerminal(original,own.terminal,guard);if(saved?.stored!==true||saved.consensusFinality!==true||saved.nativeGrant!==false)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.terminalResult=saved;own.terminalStored=true;}
    await releaseSource(own);
    if(!safe(own.source)||!safe(own.selection)||!safe(own.host)||!safe(own.capture)||!safe(evidence))fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');
    operation=null;if(own.terminalStored)return Object.freeze({...own.terminalResult,saved:true,account:original.account,hash:original.hash,nativeGrant:false,canRetry:false,clearsOriginal:false});return Object.freeze({saved:true,account:original.account,hash:original.hash,independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false});
   }finally{active=false;own.finish();if(safeOperation(own))operation=null;}
  },
 });
}
