import {originalIDEServiceAdmissionStartupSelection} from '../scripts/original-ide-service-admission-native-selection.mjs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
const requireNative=createRequire(import.meta.url);
let selectedParent=null;
const fail=code=>{throw Object.assign(Error('Original private IDE parent admission is unavailable'),{code});};
/** Actual fixedvendor Node caller, not renderer/ENV/project selection.
 * The fixed null branch never loads the original protected/crypto graph.
 * Installed receipt validation remains in prepareOriginalIDEServiceAdmissionStartup;
 * it MUST NOT be promoted into approval of an OS parent or its executor.
 * Configured callers select only the original Native acquisition implementation.
 * Native alone verifies Source/joint authority and completes the exclusive
 * prelude before returning. Its exact owner, including partial cleanup custody,
 * is returned unchanged; this adapter neither reads fd4 nor mints a guard. */
export async function acquireOriginalIDEAdmissionParentDelivery(actualEntryURL){
  if(originalIDEServiceAdmissionStartupSelection===null)return null;
  if(typeof actualEntryURL!=='string')fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
  let entry;
  try{const url=new URL(actualEntryURL);if(url.protocol!=='file:'||url.host||url.search||url.hash)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');entry=fileURLToPath(url);}catch{fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');}
  if(resolve(entry)!==entry||entry!==join(dirname(entry),'server.mjs')||typeof process.argv[1]!=='string'||resolve(process.argv[1])!==entry)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
  const native=requireNative(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
  if(typeof native.acquireOriginalIDEAdmissionParentDelivery!=='function')fail('IDE_ORIGINAL_PARENT_QUALIFICATION_NOT_SUPPLIED');
  // Do not inspect/current/close the returned owner here: partial acquisition
  // must remain reachable by the existing consumer's cleanup-only lifecycle.
  // No retry, alternate module, Socket or installed-frame read belongs here.
  if(selectedParent!==null)fail('IDE_ORIGINAL_PARENT_ALREADY_SELECTED');
  selectedParent={entry:actualEntryURL,native,binding:null,client:null};
  selectedParent.binding=native.acquireOriginalIDEAdmissionParentDelivery(actualEntryURL);
  return selectedParent.binding;
}

const clientError=code=>Object.assign(new Error('Original IDE private client is unavailable'),{code});
const clientNames={capture:'captureOriginalIDEPrivateClient',ready:'assertOriginalIDEPrivateClientReady',borrow:'captureOriginalNativePrivateServiceBorrow',current:'assertOriginalNativePrivateServiceCurrent',admit:'assertOriginalNativePrivateServiceAdmission',result:'captureOriginalIDEPrivateClientResult',terminal:'assertOriginalNativePrivateServiceTerminal',retire:'retireOriginalNativePrivateService',join:'joinOriginalNativePrivateService',close:'closeOriginalNativePrivateService'};
function clientState(entry){if(!selectedParent||selectedParent.entry!==entry)return null;return selectedParent.client;}
function latchClient(s,cause){
 if(!s.firstCausePresent){s.firstCausePresent=true;s.firstCause=cause;}
 if(s.waiter){s.waiter.resolve(null);s.waiter=null;}
 for(const row of s.rows.values())if(!row.terminal){row.unknown=true;if(!row.settled){row.settled=true;clearTimeout(row.timer);row.reject(cause);}}
}
function currentClient(s,operation){
 if(s.retired||!s.ready)throw s.firstCausePresent?s.firstCause:clientError('IDE_ORIGINAL_PRIVATE_CLIENT_NOT_READY');
 if(s.methods.ready(s.owner)!==undefined||s.methods.current(s.owner,operation)!==undefined)throw clientError('IDE_ORIGINAL_PRIVATE_CLIENT_CURRENT_INVALID');
 const r=s.owner.expectedRequest;
 s.admission.assertCurrent({service:r.service,productId:r.productId,platform:r.platform,gatewayOrigin:r.gatewayOrigin,operation:operation??r.operations[0]});
 if(s.retired)throw clientError('IDE_ORIGINAL_PRIVATE_CLIENT_RETIRED');
}
function retireClient(s,...cause){
 s.retired=true;s.transportRetired=true;if(cause.length)latchClient(s,cause[0]);
 else if([...s.rows.values()].some(row=>!row.terminal))latchClient(s,clientError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'));
 if(s.waiter){s.waiter.resolve(null);s.waiter=null;}
 if(s.retireSelected){if(s.retireFailed)throw s.retireCause;return undefined;}s.retireSelected=true;
 try{if(s.owner){if(s.methods.retire(s.owner)!==undefined)throw clientError('IDE_PRIVATE_RETIRE_INCOMPLETE');}else if(s.captureEntered)throw clientError('IDE_PRIVATE_CAPTURE_CUSTODY_UNKNOWN');return undefined;}
 catch(error){s.retireFailed=true;s.retireCause=error;throw error;}
}
function joinClient(s){
 if(s.joining)return s.joining;
 s.joining=Promise.resolve().then(async()=>{if(s.promise)await s.promise.catch(()=>{});if(!s.retireSelected)throw clientError('IDE_PRIVATE_NOT_RETIRED');if(s.owner){if(s.methods.join(s.owner)!==undefined)throw clientError('IDE_PRIVATE_JOIN_INCOMPLETE');}else if(s.captureEntered)throw clientError('IDE_PRIVATE_CAPTURE_CUSTODY_UNKNOWN');return undefined;});void s.joining.catch(()=>{});return s.joining;
}
function closeClient(s){
 if(s.closing)return s.closing;
 s.closing=Promise.resolve().then(async()=>{
  let failed=false,cause;const attempt=async fn=>{try{if(await fn()!==undefined)throw clientError('IDE_PRIVATE_CLEANUP_INCOMPLETE');}catch(error){if(!failed){failed=true;cause=error;}}};
  await attempt(()=>retireClient(s));await attempt(()=>joinClient(s));
  await attempt(()=>{if(s.owner){if(s.methods.close(s.owner)!==undefined)throw clientError('IDE_PRIVATE_CLOSE_INCOMPLETE');}else if(s.captureEntered)throw clientError('IDE_PRIVATE_CAPTURE_CUSTODY_UNKNOWN');});
  if(failed){s.cleanupFailurePresent=true;s.cleanupCause=cause;latchClient(s,cause);throw cause;}s.cleanupComplete=true;return undefined;
 });void s.closing.catch(()=>{});return s.closing;
}
function statusClient(s){return Object.freeze({ready:s.ready,retired:s.retired,transportRetired:s.transportRetired,unknown:s.captureEntered&&!s.owner||[...s.rows.values()].some(row=>row.unknown),retained:s.rows.size,firstCausePresent:s.firstCausePresent,cleanupFailurePresent:s.cleanupFailurePresent,cleanupComplete:s.cleanupComplete});}
function clientResponseDeadline(row){
 if(!row||performance.now()>=row.deadline)throw clientError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN');
}
function queuedClientResponseDeadline(s,raw){
 const frame=s.payload.parseOriginalIDEPrivatePayload(raw);
 clientResponseDeadline(s.rows.get(frame.operation+':'+frame.phase+':'+frame.requestId));
}
function stopClientTransport(s,...cause){
 s.transportRetired=true;
 if(cause.length)latchClient(s,cause[0]);
 else if([...s.rows.values()].some(row=>!row.terminal))latchClient(s,clientError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'));
 if(s.waiter){s.waiter.resolve(null);s.waiter=null;}
 return undefined; // Transport only. Entered caller diagnostics drain before Native retirement.
}
function assertClientTransportCurrent(s){
 if(s.firstCausePresent)throw s.firstCause;
 if(s.transportRetired)throw s.firstCausePresent?s.firstCause:clientError('IDE_PRIVATE_TRANSPORT_RETIRED');
 return currentClient(s);
}
function nextClientFrame(s){
 if(s.retired||s.transportRetired||s.firstCausePresent)return Promise.resolve(null);
 try{currentClient(s);}catch(cause){latchClient(s,cause);return Promise.reject(cause);}
 if(s.queue.length){const raw=s.queue.shift();try{queuedClientResponseDeadline(s,raw);return Promise.resolve(raw);}catch(cause){latchClient(s,cause);return Promise.reject(cause);}}
 if(s.waiter)throw clientError('IDE_PRIVATE_WRITER_ALREADY_SELECTED');
 return new Promise(resolve=>{s.waiter={resolve};});
}
function queueClientFrame(s,raw){
 if(s.waiter){const waiter=s.waiter;try{currentClient(s);queuedClientResponseDeadline(s,raw);s.waiter=null;waiter.resolve(raw);}catch(cause){latchClient(s,cause);throw cause;}}else s.queue.push(raw);
}
async function dispatchClient(s,raw){
 let row;
 try{
  if(s.transportRetired)throw s.firstCausePresent?s.firstCause:clientError('IDE_PRIVATE_TRANSPORT_RETIRED');
  if(s.firstCausePresent)throw s.firstCause;currentClient(s);
  const frameRaw=s.payload.createOriginalIDEPrivateRequestFrame(s.bindingDigest,raw),frame=s.payload.parseOriginalIDEPrivatePayload(frameRaw),key=frame.operation+':'+frame.phase+':'+frame.requestId;
  if(s.rows.has(key)||s.rows.size>=64)throw clientError('ORIGINAL_PRIVATE_ALREADY_ENTERED');
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});
  row={input:JSON.parse(raw),originalRaw:raw,requestDigest:frame.requestDigest,result:null,responseRaw:null,responseDigest:null,unknown:true,terminal:false,fulfilled:false,settled:false,resolve,reject,promise,timer:null,deadline:performance.now()+15000};s.rows.set(key,row);
  if(s.methods.admit(s.owner,row.input)!==undefined)throw clientError('IDE_PRIVATE_ADMISSION_INCOMPLETE');currentClient(s,frame.operation);
  row.timer=setTimeout(()=>{if(!row.settled)latchClient(s,clientError('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'));},15000);
  clientResponseDeadline(row);queueClientFrame(s,frameRaw);return promise;
 }catch(cause){latchClient(s,cause);throw cause;}
}
function receiveClientFrame(s,raw){
 let row;
 try{
  const frame=s.payload.parseOriginalIDEPrivatePayload(raw),key=frame.operation+':'+frame.phase+':'+frame.requestId;row=s.rows.get(key);
  if(frame.type==='request'||!row||frame.bindingDigest!==s.bindingDigest||frame.requestDigest!==row.requestDigest||row.responseRaw!==null)throw clientError('IDE_PRIVATE_RESPONSE_MISMATCH');
  row.originalReplyFrame=raw; // Retain before current, Native capture or failure.
  if(frame.type==='failure')throw clientError(frame.errorCode);
  row.responseRaw=frame.responseRaw;row.responseDigest=frame.responseDigest;row.result=s.payload.parseOriginalIDEPrivateResponse(frame.responseRaw,frame.requestId);
  if(s.retired||s.firstCausePresent)throw s.firstCausePresent?s.firstCause:clientError('IDE_PRIVATE_RETIRED');
  currentClient(s,frame.operation);clientResponseDeadline(row);
  if(s.methods.result(s.owner,frame.operation,frame.phase,frame.requestId,frame.responseRaw)!==undefined)throw clientError('IDE_PRIVATE_RESULT_CAPTURE_INCOMPLETE');
  currentClient(s,frame.operation);clientResponseDeadline(row);row.fulfilled=true;
  if(!row.settled){row.settled=true;clearTimeout(row.timer);row.resolve(row.result);}return undefined;
 }catch(cause){latchClient(s,cause);throw cause;}
}
function acknowledgeClient(s,operation,phase,requestId,digest){
 const row=s.rows.get(operation+':'+phase+':'+requestId);
 try{
  currentClient(s,operation);if(s.firstCausePresent)throw s.firstCause;
  if(!row?.fulfilled||row.terminal||digest!==row.responseDigest||s.canonicalJSON(row.result)!==row.responseRaw)throw clientError('IDE_PRIVATE_TERMINAL_INVALID');
  if(s.methods.terminal(s.owner,operation,phase,requestId,digest)!==undefined)throw clientError('IDE_PRIVATE_TERMINAL_INCOMPLETE');
  currentClient(s,operation);row.terminal=true;row.unknown=false;return undefined;
 }catch(cause){if(row)row.unknown=true;latchClient(s,cause);throw cause;}
}
function selectCurrentClientOutcome(s,operation,phase,requestId){
 const row=s.rows.get(operation+':'+phase+':'+requestId);
 try{currentClient(s,operation);if(!row)throw clientError('IDE_PRIVATE_OUTCOME_REQUIRED');const outcome=Object.freeze({result:row.result,unknown:row.unknown||s.firstCausePresent,terminal:row.terminal});currentClient(s,operation);return outcome;}
 catch(cause){if(row)row.unknown=true;latchClient(s,cause);throw cause;}
}
function readClientTerminalCustody(s,operation,phase,requestId){
 const row=s.rows.get(operation+':'+phase+':'+requestId);
 try{
  currentClient(s,operation);
  if(!row?.unknown||row.terminal||row.terminalReadSelected||typeof s.methods.readTerminal!=='function'||row.input.carrierVersion!=='YNX-PRODUCT-SESSION-PRIVATE/v4'||row.input.referenceAction!=='complete')throw clientError('IDE_PRIVATE_TERMINAL_CUSTODY_UNAVAILABLE');
  row.terminalReadSelected=true; // Native entry selected once even on refusal.
  row.originalTerminalCustodyProof=s.methods.readTerminal(s.owner,operation,phase,requestId); // Capture before validation/current.
  const data=s.payload.captureOriginalIDEPrivateTerminalCustodyData(row.originalTerminalCustodyProof,row.originalRaw,s.owner.association,row.responseRaw);
  currentClient(s,operation);row.terminalCustody=data;
  return data; // DATA only; original/global UNKNOWN and ACK state unchanged.
 }catch(cause){if(row)row.unknown=true;latchClient(s,cause);throw cause;}
}
function reserveClient(parent){
 const s={parent,owner:null,methods:null,captureEntered:false,ready:false,retired:false,transportRetired:false,firstCausePresent:false,firstCause:undefined,rows:new Map(),queue:[],waiter:null,payload:null,canonicalJSON:null,admission:null,bindingDigest:null,retireSelected:false,retireFailed:false,retireCause:undefined,joining:null,closing:null,cleanupComplete:false,cleanupFailurePresent:false,cleanupCause:undefined,promise:null};
 const cleanup=Object.freeze({retire(...cause){return retireClient(s,...cause);},join:()=>joinClient(s),close:()=>closeClient(s),status:()=>statusClient(s)});
 const original=Object.freeze({...cleanup,dispatch:raw=>dispatchClient(s,raw),acknowledge:(...args)=>acknowledgeClient(s,...args),selectCurrentOutcome:(...args)=>selectCurrentClientOutcome(s,...args),readTerminalCustody:(...args)=>readClientTerminalCustody(s,...args)});
 const framer=Object.freeze({nextOutboundFrame:()=>nextClientFrame(s),acceptInboundFrame:raw=>receiveClientFrame(s,raw),assertCurrent(){try{return assertClientTransportCurrent(s);}catch(cause){latchClient(s,cause);throw cause;}},retireTransport(...cause){return stopClientTransport(s,...cause);}});
 s.cleanup=cleanup;s.channel=Object.freeze({original,framer});return s;
}
/** Normal backend only; uses the SAME already acquired Native delivery. */
export async function acquireOriginalIDEPrivateServiceChannel(actualEntryURL){
 const parent=selectedParent;
 if(!parent||parent.entry!==actualEntryURL||!parent.binding)throw clientError('IDE_ORIGINAL_PRIVATE_PARENT_NOT_SUPPLIED');
 if(parent.client){if(parent.client.retired)throw parent.client.firstCausePresent?parent.client.firstCause:clientError('IDE_PRIVATE_RETIRED');return parent.client.promise;}
 const s=reserveClient(parent);parent.client=s;
 s.promise=Promise.resolve().then(async()=>{
  try{
   if(s.retired)throw clientError('IDE_PRIVATE_RETIRED');
   if(Object.values(clientNames).some(name=>typeof parent.native[name]!=='function'))throw clientError('IDE_PRIVATE_IMPLEMENTATION_NOT_SUPPLIED');
   s.methods=Object.freeze({...Object.fromEntries(Object.entries(clientNames).map(([key,name])=>[key,parent.native[name]])),readTerminal:typeof parent.native.readOriginalNativePrivateServiceTerminalResult==='function'?parent.native.readOriginalNativePrivateServiceTerminalResult:null});
   s.captureEntered=true;s.owner=s.methods.capture(parent.binding); // Partial before ready.
   if(!s.owner||typeof s.owner!=='object'||s.methods.ready(s.owner)!==undefined)throw clientError('IDE_PRIVATE_NOT_READY');
   if(s.methods.borrow(s.owner)!==s.owner)throw clientError('IDE_PRIVATE_ORIGINAL_OWNER_REQUIRED');
   s.payload=await import('./original-ide-private-payload.js');
   const {canonicalJSON}=await import('./canonical.js');s.canonicalJSON=canonicalJSON;
   const {prepareOriginalWalletServiceAdmission}=await import('./original-wallet-service-admission.js');
   s.bindingDigest=s.payload.originalIDEPrivateDeliveryBinding(s.owner);
   s.admission=prepareOriginalWalletServiceAdmission(s.owner.sourceSelection,s.owner.receiptSelection,s.owner.expectedRequest,()=>new Date());
   s.ready=true;currentClient(s);return s.channel;
  }catch(cause){latchClient(s,cause);throw cause;}
 });void s.promise.catch(()=>{});return s.promise;
}
/** Cleanup-only lookup for a failed selection, including falsy rejection. */
export function getOriginalIDEPrivateServiceChannelCleanup(actualEntryURL){return clientState(actualEntryURL)?.cleanup??null;}

// Independent cold DATA selection. Never reads or reconstructs selectedParent.
let selectedColdCustody=null;
const coldNames={capture:'acquireOriginalIDEColdTerminalCustody',ready:'assertOriginalHostTerminalJournalReady',read:'readOriginalHostRetainedTerminalCustody',retire:'retireOriginalHostTerminalJournal',join:'joinOriginalHostTerminalJournal',close:'closeOriginalHostTerminalJournal'};
function latchCold(s,cause){if(!s.firstCausePresent){s.firstCausePresent=true;s.firstCause=cause;}}
function currentCold(s){
 if(s.retired||s.firstCausePresent)throw s.firstCausePresent?s.firstCause:clientError('IDE_COLD_CUSTODY_RETIRED');
 if(!s.ready||s.methods.ready(s.owner)!==undefined)throw clientError('IDE_COLD_CUSTODY_NOT_READY');
}
function retireCold(s,...cause){
 s.retired=true;if(cause.length)latchCold(s,cause[0]);
 if(s.retireSelected){if(s.retireFailed)throw s.retireCause;return undefined;}s.retireSelected=true;
 try{if(s.owner){if(s.methods.retire(s.owner)!==undefined)throw clientError('IDE_COLD_RETIRE_INCOMPLETE');}else if(s.captureEntered)throw clientError('IDE_COLD_CAPTURE_CUSTODY_UNKNOWN');}
 catch(error){s.retireFailed=true;s.retireCause=error;throw error;}
}
function joinCold(s){
 if(!s.joining){s.joining=Promise.resolve().then(async()=>{await s.promise.catch(()=>{});if(!s.retireSelected)throw clientError('IDE_COLD_NOT_RETIRED');if(s.owner){if(s.methods.join(s.owner)!==undefined)throw clientError('IDE_COLD_JOIN_INCOMPLETE');}else if(s.captureEntered)throw clientError('IDE_COLD_CAPTURE_CUSTODY_UNKNOWN');});void s.joining.catch(()=>{});}return s.joining;
}
function closeCold(s){
 if(s.closing)return s.closing;
 // Cancellation is visible immediately, including before acquire/import resumes.
 s.retired=true;
 s.closing=Promise.resolve().then(async()=>{
  await s.promise.catch(()=>{});
  let failed=false,cause;const attempt=async fn=>{try{if(await fn()!==undefined)throw clientError('IDE_COLD_CLEANUP_INCOMPLETE');}catch(error){if(!failed){failed=true;cause=error;}}};
  await attempt(()=>retireCold(s));await attempt(()=>joinCold(s));
  await attempt(()=>{if(s.owner){if(s.methods.close(s.owner)!==undefined)throw clientError('IDE_COLD_CLOSE_INCOMPLETE');}else if(s.captureEntered)throw clientError('IDE_COLD_CAPTURE_CUSTODY_UNKNOWN');});
  if(failed){s.cleanupFailurePresent=true;s.cleanupCause=cause;latchCold(s,cause);throw cause;}s.cleanupComplete=true;
 });void s.closing.catch(()=>{});return s.closing;
}
function readCold(s,raw){
 try{
  currentCold(s);const input=s.payload.decodeOriginalIDEColdTerminalCustodyRequest(raw),key=input.requestId;
  if(s.rows.has(key)||s.rows.size>=64)throw clientError('IDE_COLD_TERMINAL_ALREADY_SELECTED');
  const row={raw,proof:null,data:null};s.rows.set(key,row); // Reserve before Native entry; never replay a refusal.
  row.proof=s.methods.read(s.owner,raw); // Retain before validation and late current fence.
  const data=s.payload.captureOriginalIDEColdTerminalCustodyData(row.proof,raw);
  currentCold(s);row.data=data;return data;
 }catch(cause){latchCold(s,cause);throw cause;}
}
function assertColdEntry(actualEntryURL){
 if(typeof actualEntryURL!=='string')fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
 let entry;try{const url=new URL(actualEntryURL);if(url.protocol!=='file:'||url.host||url.search||url.hash)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');entry=fileURLToPath(url);}catch{fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');}
 if(resolve(entry)!==entry||entry!==join(dirname(entry),'server.mjs')||typeof process.argv[1]!=='string'||resolve(process.argv[1])!==entry)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
}
/** Fixed Native cold reader only. Null startup selection is never a grant and
 * does not disable Native's independently qualified original Source acquisition. */
export async function acquireOriginalIDEColdTerminalCustody(actualEntryURL){
 assertColdEntry(actualEntryURL);
 if(selectedColdCustody){if(selectedColdCustody.entry!==actualEntryURL)throw clientError('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');if(selectedColdCustody.firstCausePresent||selectedColdCustody.retired)throw selectedColdCustody.firstCausePresent?selectedColdCustody.firstCause:clientError('IDE_COLD_CUSTODY_RETIRED');return selectedColdCustody.promise;}
 const s={entry:actualEntryURL,owner:null,methods:null,captureEntered:false,ready:false,retired:false,rows:new Map(),firstCausePresent:false,firstCause:undefined,retireSelected:false,retireFailed:false,retireCause:undefined,joining:null,closing:null,cleanupComplete:false,cleanupFailurePresent:false,cleanupCause:undefined,promise:null,payload:null};
 const cleanup=Object.freeze({retire:(...cause)=>retireCold(s,...cause),join:()=>joinCold(s),close:()=>closeCold(s),status:()=>Object.freeze({ready:s.ready,retired:s.retired,unknown:true,retained:s.rows.size,firstCausePresent:s.firstCausePresent,cleanupFailurePresent:s.cleanupFailurePresent,cleanupComplete:s.cleanupComplete})});
 s.cleanup=cleanup;s.client=Object.freeze({...cleanup,readTerminalCustody:raw=>readCold(s,raw)});selectedColdCustody=s;
 s.promise=Promise.resolve().then(async()=>{
  try{
   if(s.retired)throw clientError('IDE_COLD_CUSTODY_RETIRED');
   const native=requireNative(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
   if(Object.values(coldNames).some(name=>typeof native[name]!=='function'))throw clientError('IDE_COLD_IMPLEMENTATION_NOT_SUPPLIED');
   s.methods=Object.freeze(Object.fromEntries(Object.entries(coldNames).map(([k,name])=>[k,native[name]])));
   s.captureEntered=true;s.owner=s.methods.capture();
   if(!s.owner||typeof s.owner!=='object'||s.methods.ready(s.owner)!==undefined)throw clientError('IDE_COLD_CUSTODY_NOT_READY');
   s.payload=await import('./original-ide-private-payload.js');
   if(s.retired)throw s.firstCausePresent?s.firstCause:clientError('IDE_COLD_CUSTODY_RETIRED');
   if(s.methods.ready(s.owner)!==undefined)throw clientError('IDE_COLD_CUSTODY_NOT_READY');s.ready=true;return s.client;
  }catch(cause){latchCold(s,cause);throw cause;}
 });void s.promise.catch(()=>{});return s.promise;
}
/** Cleanup-only lookup also remains available after falsy partial failures. */
export function getOriginalIDEColdTerminalCustodyCleanup(actualEntryURL){return selectedColdCustody?.entry===actualEntryURL?selectedColdCustody.cleanup:null;}
