import {createPQHostContextReference} from './wallet-pq-host-reference.mjs';
import {createPQFinalityVerifierCapture} from './wallet-pq-verifier-capture.mjs';
import {supportsPackagedPQTypedFinality} from './wallet-pq-verifier-assets.mjs';
import {originalPQVerifierReceipt} from './wallet-pq-verifier-receipt.mjs';
import {preparePQFinalityOriginal} from './wallet-pq-finality-original.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const safe=owner=>{try{owner?.assertSafeToClose();return true;}catch{return false;}};
/** Main-only orchestration of the original Host and proof callers. Source
 * selection is a private original-producer dependency, never IPC or ENV.
 * A result is retained DATA, not authority or a journal status transition.
 */
export function createPQFinalityVerification({evidence,selectSource,createSelection=null,createProducer,createVerifier,persistObservation,flushObservation,verifierReceipt=originalPQVerifierReceipt}){
 if(typeof persistObservation!=='function'||typeof flushObservation!=='function')fail('PQ_FINALITY_PRIVATE_JOURNAL_REQUIRED');
 if(createSelection!==null&&typeof createSelection!=='function')fail('PQ_HOST_SELECTION_OWNER_REQUIRED');
 // Capture this private original-Main component choice before any async work.
 // No mutable flag/renderer capability can turn a legacy component into fbec.
 const typedComponentAvailable=supportsPackagedPQTypedFinality(verifierReceipt);
 let operation=null,active=false;
 const safeOperation=own=>safe(own.selection)&&safe(own.host)&&safe(own.capture)&&safe(evidence)&&(!own.result||own.journalStored);
 const assertOwner=(original,binding,guard)=>{guard.assert();if(guard.account!==original.account||binding.account!==original.account)fail('PQ_HOST_CONTEXT_MISMATCH');};
 const retire=()=>{operation?.selection?.retire();operation?.host?.retire();operation?.capture?.retire();};
 return Object.freeze({
  retire,
  pending:original=>operation!==null&&(!original||operation.original.hash===original.hash&&operation.original.account===original.account&&operation.original.operationId===original.operationId),
  assertSafeToClose(){if(active||operation&&!safeOperation(operation))fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');evidence.assertSafeToClose();},
  async join(){await operation?.work?.catch(()=>{});await operation?.selection?.join();await operation?.host?.join();await operation?.capture?.join();},
  async verify(original,binding,proof,guard){
   if(active||operation)fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');assertOwner(original,binding,guard);
   // A source-owned independent closed component receipt is not Host trust.
   // Legacy591 remains denied for typed requests. Validate the complete saved
   // original/review/snapshots before even selecting a prospective Host source.
   if(original.kind==='pq-typed-action'){
    preparePQFinalityOriginal(original,binding);
    if(!typedComponentAvailable)fail('PQ_TYPED_VERIFIER_ASSET_NOT_SUPPLIED');
   }
   active=true;const own={original,binding,selection:null,host:null,capture:null,work:null,result:null,journalStored:false};operation=own;
   const work=(async()=>{
    // Retain the selector's actual process/capture owner before the first
    // await. Lock and close must not discard its pending local-save debt.
    // A selected profile never falls back to the legacy supplier on failure.
    if(createSelection){own.selection=createSelection(original,binding);if(!own.selection)fail('PQ_HOST_SELECTION_OWNER_REQUIRED');}
    const selection=own.selection?await own.selection.run(guard):await selectSource(original,binding);assertOwner(original,binding,guard);
    own.host=createPQHostContextReference({original,binding,selection,evidence,createProducer});
    await own.host.acquire(guard);
    return own.host.withContext(guard,async(context,current)=>{
     own.capture=createPQFinalityVerifierCapture({evidence,verifier:createVerifier()});
     return own.capture.run(original,binding,{...context,proof},current);
    });
   })();own.work=work;
   try{const result=await work;own.result=result;const saved=await persistObservation(original,result.journalRecord);if(saved?.stored!==true)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.journalStored=true;guard.assert();return Object.freeze({account:original.account,hash:original.hash,status:result.observation.status,rawStored:true,observationStored:true,observation:result.observation,independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false});}
   finally{active=false;retire();if(safeOperation(own))operation=null;}
  },
  // Explicit saving never selects a new source, runs current(), or constructs
  // another producer/verifier. Retire before draining retained local evidence.
  async save(original,binding,guard){
   if(active||!operation)fail('PQ_FINALITY_NO_HELD_EVIDENCE');assertOwner(original,binding,guard);
   const own=operation;if(own.original.hash!==original.hash||own.original.operationId!==original.operationId||own.original.account!==original.account)fail('PQ_HOST_CONTEXT_MISMATCH');
   active=true;retire();
   try{
    if(own.selection&&!safe(own.selection))await own.selection.save(guard);
    if(own.host?.status().pendingSave)await own.host.saveHeld(guard);
    if(own.capture&&!safe(own.capture))await own.capture.save(guard);
    if(own.result&&!own.journalStored){const saved=await flushObservation(original,own.result.journalRecord,guard);if(saved?.stored!==true)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.journalStored=true;}
    if(!safe(own.selection)||!safe(own.host)||!safe(own.capture)||!safe(evidence))fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');
    operation=null;return Object.freeze({saved:true,account:original.account,hash:original.hash,independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false});
   }finally{active=false;if(safeOperation(own))operation=null;}
  },
 });
}
