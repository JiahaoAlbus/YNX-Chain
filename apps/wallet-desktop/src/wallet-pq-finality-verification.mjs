import {createPQHostContextReference} from './wallet-pq-host-reference.mjs';
import {createPQFinalityVerifierCapture} from './wallet-pq-verifier-capture.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const safe=owner=>{try{owner?.assertSafeToClose();return true;}catch{return false;}};
/** Main-only orchestration of the original Host and proof callers. Source
 * selection is a private original-producer dependency, never IPC or ENV.
 * A result is retained DATA, not authority or a journal status transition.
 */
export function createPQFinalityVerification({evidence,selectSource,createProducer,createVerifier,persistObservation,flushObservation}){
 if(typeof persistObservation!=='function'||typeof flushObservation!=='function')fail('PQ_FINALITY_PRIVATE_JOURNAL_REQUIRED');
 let operation=null,active=false;
 const safeOperation=own=>safe(own.host)&&safe(own.capture)&&safe(evidence)&&(!own.result||own.journalStored);
 const assertOwner=(original,binding,guard)=>{guard.assert();if(guard.account!==original.account||binding.account!==original.account)fail('PQ_HOST_CONTEXT_MISMATCH');};
 const retire=()=>{operation?.host?.retire();operation?.capture?.retire();};
 return Object.freeze({
  retire,
  pending:original=>operation!==null&&(!original||operation.original.hash===original.hash&&operation.original.account===original.account&&operation.original.operationId===original.operationId),
  assertSafeToClose(){if(active||operation&&!safeOperation(operation))fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');evidence.assertSafeToClose();},
  async join(){await operation?.work?.catch(()=>{});await operation?.host?.join();await operation?.capture?.join();},
  async verify(original,binding,proof,guard){
   if(active||operation)fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');assertOwner(original,binding,guard);
   // Current independently signed packaged receipt591 has no typed CLI
   // capability evidence. PUBLIC/Linux producer success cannot replace it.
   // Keep DATA capture/restore usable; no source/process is selected here.
   if(original.kind==='pq-typed-action')fail('PQ_TYPED_VERIFIER_ASSET_NOT_SUPPLIED');
   active=true;const own={original,binding,host:null,capture:null,work:null,result:null,journalStored:false};operation=own;
   const work=(async()=>{
    const selection=await selectSource(original,binding);assertOwner(original,binding,guard);
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
    if(own.host?.status().pendingSave)await own.host.saveHeld(guard);
    if(own.capture&&!safe(own.capture))await own.capture.save(guard);
    if(own.result&&!own.journalStored){const saved=await flushObservation(original,own.result.journalRecord,guard);if(saved?.stored!==true)fail('PQ_FINALITY_JOURNAL_SAVE_UNCONFIRMED');own.journalStored=true;}
    if(!safe(own.host)||!safe(own.capture)||!safe(evidence))fail('PQ_FINALITY_VERIFICATION_UNCONFIRMED');
    operation=null;return Object.freeze({saved:true,account:original.account,hash:original.hash,independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false});
   }finally{active=false;if(safeOperation(own))operation=null;}
  },
 });
}
