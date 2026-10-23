import {createHash} from 'node:crypto';
import {preparePQFinalityOriginal as preparePQTransferOriginal} from './wallet-pq-finality-original.mjs';
import {parsePQTransferHostContext,preparePQHostSourceRequest} from './wallet-pq-host-context.mjs';
import {pqProcessCauseData} from './wallet-pq-verifier-capture.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const summaryFields=['sourceId','epoch','sourceFingerprint','sourceSha256','lifecycleSha256','contextSha256'];
/** Private original-Main holder. Each acquire/current is a new bounded
 * single-request producer child, never a daemon/token/signing authority.
 * createProducer is the fixed new-version packaged factory supplied by Main,
 * NOT IPC, and cannot be replaced by the old034 proof executable.
 * Protected evidence is saved before parsing/guard/current publication.
 */
export function createPQHostContextReference({original,binding,selection,evidence,createProducer}){
 const own=preparePQTransferOriginal(original,binding),selected=preparePQHostSourceRequest(selection,'acquire').selection;
 let state='new',active=false,view=null,pending=null,sequence=0;const processes=new Set(),jobs=new Set();
 const assertState=()=>{if(!['held','acquiring','checking'].includes(state))fail('PQ_HOST_REFERENCE_RETIRED');};
 const scoped=guard=>{guard.assert();if(guard.account!==own.original.account)fail('PQ_HOST_CONTEXT_MISMATCH');};
 const publicState=()=>Object.freeze({account:own.original.account,operationId:own.original.operationId,hash:own.original.hash,state,held:state==='held',pendingSave:pending!==null,nativeRootAuthorized:false,sourceDeploymentQualified:false,proofVerified:false,independentFinality:false,canRetry:false,clearsOriginal:false});
 function queueOutputs(r){
  r.packet=r.process.snapshot();r.queue=[{kind:'host-producer-stdout',body:r.packet.result.stdout},{kind:'host-producer-stderr',body:r.packet.result.stderr}];r.index=0;r.phase='outputs';
 }
 async function drain(r){
  while(r.index<r.queue.length){const item=r.queue[r.index];
   try{r.refs.push(await evidence.append(own.original,binding,item.kind,item.body));r.index++;}
   catch(cause){r.held=evidence.pending();throw cause;}
  }
 }
 async function save(r){
  await drain(r);
  if(r.phase==='outputs'){
   const p=r.packet,meta={version:1,type:'host-producer-capture',operationId:own.original.operationId,hash:own.original.hash,operation:r.operation,source:selected,requestSha256:r.request.stdinSha256,resourceIdentity:typeof r.process.identity==='function'?r.process.identity():null,references:r.refs.slice(),exitCode:p.result.exitCode,signal:p.result.signal,lifecycle:p.lifecycle,firstCause:pqProcessCauseData(p.firstCause,p.lifecycle.firstCausePresent),cleanupCause:pqProcessCauseData(p.cleanupCause,p.lifecycle.cleanupCausePresent)};
   r.queue=[{kind:'host-producer-result',body:Buffer.from(JSON.stringify(meta))}];r.index=0;r.phase='manifest';await drain(r);
  }
 }
 async function invoke(operation,guard){
  if(active||pending)fail('PQ_HOST_REFERENCE_UNCONFIRMED');scoped(guard);
  if(operation==='acquire'?state!=='new':state!=='held')fail('PQ_HOST_REFERENCE_RETIRED');
  if(sequence>=32)fail('PQ_HOST_REFERENCE_CAPACITY');sequence++;active=true;state=operation==='acquire'?'acquiring':'checking';
  const prior=view?Object.fromEntries(summaryFields.map(k=>[k,view[k]])):null;
  const request=preparePQHostSourceRequest(selected,operation,view?.sourceFingerprint??'');
  let r;
  const work=(async()=>{
   try{
    const process=createProducer(selected);processes.add(process);
    r={process,operation,request,prior,refs:[],held:null,packet:null,queue:[],index:0,phase:'inputs'};pending=r;
    // This private readonly request performs no external write. The exact
    // returned streams, request and binary identity are one capture below.
    try{await process.run({sourcePath:selected.sourcePath,sourceSha256:selected.sourceSha256,stdin:request.stdin});}catch{ /* preserve exact cause in the owned snapshot */ }
    r.packet=process.snapshot();
    r.queue=[{kind:'host-producer-stdin',body:Buffer.from(request.stdin)}];await drain(r);queueOutputs(r);await save(r);
    const p=r.packet;
    if(p.lifecycle.cleanupPending||!p.lifecycle.closeObserved||p.lifecycle.interruption!==null||p.lifecycle.stdoutTruncated||p.lifecycle.stderrTruncated||p.lifecycle.firstCausePresent)fail('PQ_HOST_PROCESS_INCOMPLETE');
    // Never use a late success to resurrect revoked/retired input. Raw output
    // and lifecycle have already been durably read back at this point.
    scoped(guard);assertState();const parsed=parsePQTransferHostContext(own.original,binding,selected,p.result,prior);scoped(guard);assertState();
    view=parsed;state='held';pending=null;return publicState();
   }catch(cause){
    if(!['retired','revoked','closed'].includes(state))state='revoked';view=null;
    if(r&&r.phase==='manifest'&&r.index===r.queue.length&&!r.packet.lifecycle.cleanupPending)pending=null;
    throw cause;
   }finally{active=false;}
  })();jobs.add(work);try{return await work;}finally{jobs.delete(work);}
 }
 const api=Object.freeze({
  acquire:guard=>invoke('acquire',guard),current:guard=>invoke('current',guard),status:publicState,
  // Only the local held source can provide private capture inputs. This is
  // not a permission: the action must use the original guarded proof caller.
  async withContext(guard,action){
   scoped(guard);if(state!=='held'||!view)fail('PQ_HOST_REFERENCE_RETIRED');if(typeof action!=='function')fail('PQ_HOST_OBSERVER_REQUIRED');
   const work=(async()=>{
    // The same independently pinned source is rechecked on both sides of the
    // accepted action. Saving a returned proof remains the action's owner.
    await api.current(guard);const ownView=view;
    const assert=()=>{scoped(guard);if(state!=='held'||view!==ownView)fail('PQ_HOST_REFERENCE_RETIRED');};assert();
    const value=await action(Object.freeze({contextPath:ownView.contextPath,contextSha256:ownView.contextSha256,contextBytes:Buffer.from(ownView.contextBytes),expected:ownView.expected}),Object.freeze({account:guard.account,assert}));assert();
    await api.current(guard);scoped(guard);if(state!=='held')fail('PQ_HOST_REFERENCE_RETIRED');return value;
   })();
   jobs.add(work);try{return await work;}finally{jobs.delete(work);}
  },
  retire(){if(state!=='closed'&&state!=='revoked')state='retired';view=null;for(const p of processes)p.retire();},
  revoke(){if(state!=='closed')state='revoked';view=null;for(const p of processes)p.retire();},
  async saveHeld(guard){
   if(active||!pending)fail('PQ_FINALITY_NO_HELD_EVIDENCE');scoped(guard);active=true;const r=pending;
   try{
    if(r.held){r.refs.push(await evidence.flush(r.held.eventId));r.index++;r.held=null;}
    await drain(r);if(r.phase==='inputs')queueOutputs(r);await save(r);
    r.process.assertSafeToClose();
    // A late close may carry additional bytes/status. Preserve a fresh final
    // generation; never rerun acquire/current or publish new trust on save.
    const latest=r.process.snapshot();
    if(JSON.stringify(latest.lifecycle)!==JSON.stringify(r.packet.lifecycle)||latest.result.exitCode!==r.packet.result.exitCode||latest.result.signal!==r.packet.result.signal||sha(latest.result.stdout)!==sha(r.packet.result.stdout)||sha(latest.result.stderr)!==sha(r.packet.result.stderr)){
     queueOutputs(r);await save(r);
    }
    pending=null;return Object.freeze({...publicState(),saved:true,held:false});
   }finally{active=false;}
  },
  async join(){await Promise.allSettled([...jobs]);await Promise.all([...processes].map(p=>p.join()));},
  assertSafeToClose(){if(active||pending||jobs.size)fail('PQ_HOST_REFERENCE_UNCONFIRMED');for(const p of processes)p.assertSafeToClose();evidence.assertSafeToClose();},
  async close(){api.retire();await api.join();api.assertSafeToClose();state='closed';view=null;},
 });return api;
}
