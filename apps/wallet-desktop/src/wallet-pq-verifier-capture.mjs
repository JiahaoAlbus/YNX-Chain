import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData,preparePQTransferOriginal} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQTransferFinalityInvocation} from './features/pq-transaction/finality-invocation.mjs';
import {bindSavedPQTransferFinalityInvocation} from './features/pq-transaction/finality-saved-invocation.mjs';
import {parsePQTransferFinalityVerifierResult} from './features/pq-transaction/finality-verifier-result.mjs';
import {PQ_FINALITY_EVIDENCE_LIMITS as limits} from './wallet-pq-finality-evidence.mjs';
import {createPQFinalityRecord} from './wallet-pq-finality-record.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function causeData(value,present){
 if(!present)return {present:false};
 if(value===null||value===undefined||typeof value==='boolean')return {present:true,type:value===null?'null':typeof value,value:value??null};
 if(typeof value==='number')return {present:true,type:'number',value:String(value)};
 if(typeof value==='bigint')return {present:true,type:'bigint',value:String(value)};
 const text=value=>{const body=Buffer.from(value);return {text:body.subarray(0,4096).toString('base64'),bytes:body.length,sha256:sha(body),truncated:body.length>4096};};
 if(typeof value==='string')return {present:true,type:'string',value:text(value)};
 // Error fields are private evidence, not public diagnostics. Never execute
 // a foreign getter or serialize an arbitrary object/stack/cause graph.
 if(value&&typeof value==='object'&&!types.isProxy(value)){
  const fields={};for(const key of ['name','code','message']){const d=Object.getOwnPropertyDescriptor(value,key);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')fields[key]=text(d.value);}
  return {present:true,type:types.isNativeError(value)?'error':'opaque-object',fields};
 }
 return {present:true,type:typeof value};
}
export {causeData as pqProcessCauseData};
function bytes(value,maximum){
 if(types.isProxy(value)||!types.isUint8Array(value)||![Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value))||['buffer','byteLength','byteOffset','length'].some(k=>Object.hasOwn(value,k))||types.isSharedArrayBuffer(value.buffer)||value.byteLength>maximum)fail('PQ_FINALITY_CAPTURE_INVALID');
 return Buffer.from(value);
}
/** Private Main result owner. This captures a single original invocation;
 * it is not a Host authority, signer, broadcaster or journal state transition.
 * The caller must acquire the context/target from the original Host, not IPC.
 * The normal verifier dependency is the sealed packaged factory, never a path
 * or process supplied by the renderer. Injection here supports PUBLIC tests.
 */
export function createPQFinalityVerifierCapture({evidence,verifier}){
 let entered=false,active=false,plan=null,queue=[],index=0,held=null,refs=[],packet=null,waitingClose=false,done=false;
 const binding=()=>plan.binding;
 function safe(){if(active||held||!done&&entered)fail('PQ_FINALITY_CAPTURE_UNCONFIRMED');verifier.assertSafeToClose();evidence.assertSafeToClose();}
 async function drain(){
  while(index<queue.length){const item=queue[index];try{refs.push(await evidence.append(plan.original,binding(),item.kind,item.body));index++;}
   catch(cause){held=evidence.pending();throw cause;}}
 }
 function outcomes(){
  packet=verifier.snapshot();
  // All opaque output precedes the manifest. A manifest exists only after
  // readback of every referenced item; partial files never imply completion.
  queue=[{kind:'verifier-stdout',body:bytes(packet.result.stdout,limits['verifier-stdout'])},{kind:'verifier-stderr',body:bytes(packet.result.stderr,limits['verifier-stderr'])}];index=0;
 }
 async function finish(guard){
  await drain();
  const manifest={version:1,type:'verifier-capture',operationId:plan.original.operationId,hash:plan.original.hash,
   contextSha256:plan.contextSha256,stdinSha256:plan.stdinSha256,resourceIdentity:plan.resourceIdentity,references:refs.slice(),
   exitCode:packet.result.exitCode,signal:packet.result.signal,lifecycle:packet.lifecycle,
   firstCause:causeData(packet.firstCause,packet.lifecycle.firstCausePresent),cleanupCause:causeData(packet.cleanupCause,packet.lifecycle.cleanupCausePresent)};
  queue=[{kind:'verifier-result',body:Buffer.from(JSON.stringify(manifest))}];index=0;await drain();
  waitingClose=packet.lifecycle.cleanupPending===true;done=!waitingClose;
  // Save first, then check account/lock/currentness or interpret stdout. No
  // late guard failure can discard returned bytes or cause another dispatch.
  guard.assert();
  if(waitingClose||packet.lifecycle.closeObserved!==true||packet.lifecycle.interruption!==null||packet.lifecycle.stdoutTruncated||packet.lifecycle.stderrTruncated||packet.lifecycle.firstCausePresent)fail('PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE');
  const result=parsePQTransferFinalityVerifierResult(plan.original,binding(),plan.expected,packet.result);
  guard.assert();const captured={...result,records:Object.freeze(refs.slice())};
  return Object.freeze({...captured,journalRecord:createPQFinalityRecord(plan.original,binding(),plan.expected,captured),independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false});
 }
 async function execute(guard){
  // Durable input capture must finish before spawning. Storage failure leaves
  // the single-use instance parked here; explicit save resumes, not run().
  await drain();
  guard.assert();phase='process';
  try{await verifier.run(plan.invocation);}catch{ /* exact first cause remains in private process snapshot */ }
  outcomes();return finish(guard);
 }
 let phase='inputs';
 return Object.freeze({
  assertSafeToClose:safe,
  retire(){verifier.retire();},
  join(){return verifier.join();},
  async run(original,selected,input,guard){
   if(entered)fail('PQ_FINALITY_CAPTURE_ALREADY_ENTERED');entered=true;active=true;
   try{
    guard.assert();if(types.isProxy(input))fail('PQ_FINALITY_CAPTURE_INVALID');
    exactData(input,['contextPath','contextSha256','contextBytes','expected','proof'],'PQ_FINALITY_CAPTURE_INVALID');
    const own=preparePQTransferOriginal(original,selected),capturedBinding=Object.freeze({account:own.original.account,networkId:own.binding.chainId});
    if(guard.account!==capturedBinding.account)fail('PQ_FINALITY_CAPTURE_INVALID');
    const invocation=preparePQTransferFinalityInvocation(own.original,capturedBinding,input.expected,input.proof);
    const context=bytes(input.contextBytes,limits['host-context']);
    if(!context.length||sha(context)!==input.contextSha256)fail('PQ_FINALITY_CONTEXT_UNVERIFIED');
    bindSavedPQTransferFinalityInvocation(own.original,capturedBinding,context,Buffer.from(invocation.stdin));
    const contextPath=input.contextPath;if(typeof contextPath!=='string')fail('PQ_FINALITY_CAPTURE_INVALID');
    plan=Object.freeze({original:own.original,binding:capturedBinding,expected:invocation.expected,stdinSha256:invocation.stdinSha256,contextSha256:input.contextSha256,resourceIdentity:typeof verifier.identity==='function'?verifier.identity():null,
     invocation:Object.freeze({contextPath,contextSha256:input.contextSha256,stdin:invocation.stdin})});
    queue=[{kind:'host-context',body:context},{kind:'verifier-stdin',body:Buffer.from(invocation.stdin)}];
    await drain();phase='ready';return await execute(guard);
   }finally{active=false;if(plan===null)done=true;}
  },
  async save(guard){
   if(active||!plan||done)fail('PQ_FINALITY_NO_HELD_EVIDENCE');guard.assert();
   if(guard.account!==plan.original.account)fail('PQ_FINALITY_CAPTURE_INVALID');active=true;
   try{
    if(held){refs.push(await evidence.flush(held.eventId));index++;held=null;}
    if(phase==='inputs'||phase==='ready'){await drain();phase='ready';return await execute(guard);}
    // A returned process is never run a second time. If cleanup was pending,
    // retain that same owner until its actual close and capture its final
    // bounded bytes as a new immutable generation, keeping the prior files.
    if(waitingClose){verifier.assertSafeToClose();outcomes();waitingClose=false;}
    return await finish(guard);
   }finally{active=false;}
  },
 });
}
