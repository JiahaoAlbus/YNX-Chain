import {createHash} from 'node:crypto';
import path from 'node:path';
import {types} from 'node:util';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQFinalityOriginal} from './wallet-pq-finality-original.mjs';
import {preparePQHostSelectionRequest,parsePQHostSelectionResult} from './wallet-pq-host-selection.mjs';
import {pqProcessCauseData} from './wallet-pq-verifier-capture.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function catalog(value){
 if(types.isProxy(value))fail('PQ_HOST_SELECTION_CATALOG_INVALID');
 exactData(value,['catalogPath','catalogSha256'],'PQ_HOST_SELECTION_CATALOG_INVALID');
 if(typeof value.catalogPath!=='string'||!path.isAbsolute(value.catalogPath)||path.normalize(value.catalogPath)!==value.catalogPath||value.catalogPath===path.parse(value.catalogPath).root||value.catalogPath.includes('\0')||Buffer.from(value.catalogPath).toString()!==value.catalogPath||Buffer.byteLength(value.catalogPath)>4096||typeof value.catalogSha256!=='string'||! /^[a-f0-9]{64}$/.test(value.catalogSha256)||/^0{64}$/.test(value.catalogSha256))fail('PQ_HOST_SELECTION_CATALOG_INVALID');
 return Object.freeze({...value});
}
const samePacket=(a,b)=>JSON.stringify(a.lifecycle)===JSON.stringify(b.lifecycle)&&a.result.exitCode===b.result.exitCode&&a.result.signal===b.result.signal&&sha(a.result.stdout)===sha(b.result.stdout)&&sha(a.result.stderr)===sha(b.result.stderr);
/** Private Main capture owner, not a catalog/Source permission factory.
 * `selector` must be the original pinned packaged single-use process caller;
 * no IPC may supply it or the independently supplied private catalog pin.
 * Raw result saving deliberately survives key lock. Explicit save is local
 * only: it never runs a process, parses a late result or returns a selection.
 */
export function createPQHostSelectionCapture({original,binding,sourceCatalog,evidence,selector}){
 const own=preparePQFinalityOriginal(original,binding),selectedBinding=Object.freeze({account:own.original.account,networkId:own.binding.chainId}),selectedCatalog=catalog(sourceCatalog),request=preparePQHostSelectionRequest(own.original,selectedBinding);
 let used=false,active=false,retired=false,stored=false,selected=false,pending=null,firstCause,firstCausePresent=false;
 const remember=cause=>{if(!firstCausePresent){firstCausePresent=true;firstCause=cause;}};
 const guardOwner=guard=>{guard.assert();if(guard.account!==own.original.account)fail('PQ_HOST_CONTEXT_MISMATCH');};
 const status=()=>Object.freeze({account:own.original.account,operationId:own.original.operationId,hash:own.original.hash,entered:used,active,retired,stored,selected,pendingSave:pending!==null,firstCausePresent,nativeGrant:false,proofVerified:false,canRetry:false,clearsOriginal:false});
 function outputQueue(r){
  r.packet=selector.snapshot();r.phase='outputs';r.index=0;
  r.queue=[{kind:'host-selection-stdout',body:r.packet.result.stdout},{kind:'host-selection-stderr',body:r.packet.result.stderr}];
 }
 async function drain(r){
  while(r.index<r.queue.length){const item=r.queue[r.index];
   try{r.refs.push(await evidence.append(own.original,selectedBinding,item.kind,item.body));r.index++;}
   catch(cause){
    // Never flush a different operation's pending evidence. Only a failure
    // carrying this append's actual eventId can transfer its local save debt.
    const held=evidence.pending();
    if(held&&cause?.eventId===held.eventId&&held.kind===item.kind&&held.bytes===item.body.length&&held.sha256===sha(item.body))r.held=held;
    throw cause;
   }
  }
 }
 async function savePacket(r){
  await drain(r);
  if(r.phase==='inputs'){outputQueue(r);await drain(r);}
  if(r.phase==='outputs'){
   const p=r.packet;
   const metadata={version:1,type:'host-selection-capture',operationId:own.original.operationId,hash:own.original.hash,catalog:selectedCatalog,requestSha256:request.stdinSha256,resourceIdentity:typeof selector.identity==='function'?selector.identity():null,references:r.refs.slice(),exitCode:p.result.exitCode,signal:p.result.signal,lifecycle:p.lifecycle,firstCause:pqProcessCauseData(p.firstCause,p.lifecycle.firstCausePresent),cleanupCause:pqProcessCauseData(p.cleanupCause,p.lifecycle.cleanupCausePresent)};
   r.phase='metadata';r.index=0;r.queue=[{kind:'host-selection-result',body:Buffer.from(JSON.stringify(metadata))}];await drain(r);
  }
  stored=true;
 }
 const retire=()=>{retired=true;selected=false;selector.retire();};
 return Object.freeze({
  status,retire,
  async join(){await pending?.work?.catch(()=>{});await selector.join();},
  assertSafeToClose(){if(active||pending)fail('PQ_HOST_SELECTION_UNCONFIRMED');selector.assertSafeToClose();evidence.assertSafeToClose();},
  async run(guard){
   if(used)fail('PQ_HOST_SELECTION_ALREADY_ENTERED');guardOwner(guard);
   if(retired)fail('PQ_HOST_SELECTION_RETIRED');evidence.assertSafeToClose();
   used=true;active=true;
   const r={phase:'inputs',index:0,queue:[{kind:'host-selection-stdin',body:Buffer.from(request.stdin)}],refs:[],held:null,packet:null,work:null};pending=r;
   const work=(async()=>{
    try{
     // Reserve once before await. Returned bytes are captured and saved even
     // if this caller becomes locked/retired while the process is completing.
     try{await selector.run({...selectedCatalog,stdin:request.stdin});}catch(cause){remember(cause);}
     await savePacket(r);
     const p=r.packet;
     selector.assertSafeToClose();
     if(p.lifecycle.cleanupPending||!p.lifecycle.closeObserved||p.lifecycle.interruption!==null||p.lifecycle.stdoutTruncated||p.lifecycle.stderrTruncated||p.lifecycle.firstCausePresent||p.lifecycle.cleanupCausePresent||firstCausePresent)fail('PQ_HOST_SELECTION_PROCESS_INCOMPLETE');
     guardOwner(guard);if(retired)fail('PQ_HOST_SELECTION_RETIRED');
     const result=parsePQHostSelectionResult(p.result);guardOwner(guard);if(retired)fail('PQ_HOST_SELECTION_RETIRED');
     selected=true;pending=null;return result;
    }catch(cause){
     remember(cause);selected=false;
     if(stored&&r.phase==='metadata'&&r.index===r.queue.length){try{selector.assertSafeToClose();if(samePacket(selector.snapshot(),r.packet))pending=null;}catch{}}
     throw cause;
    }finally{active=false;}
   })();r.work=work;return work;
  },
  async save(guard){
   if(active||!pending)fail('PQ_HOST_SELECTION_NO_HELD_EVIDENCE');guardOwner(guard);active=true;retire();
   const r=pending;
   try{
    if(r.held){r.refs.push(await evidence.flush(r.held.eventId));r.index++;r.held=null;}
    await savePacket(r);selector.assertSafeToClose();
    // A real late close may contain additional output. Save that generation,
    // without running selection again or reviving a previously rejected DTO.
    const latest=selector.snapshot();
    if(!samePacket(latest,r.packet)){outputQueue(r);await savePacket(r);}
    evidence.assertSafeToClose();pending=null;return Object.freeze({...status(),active:false,saved:true,selected:false});
   }catch(cause){remember(cause);throw cause;}finally{active=false;}
  }
 });
}
