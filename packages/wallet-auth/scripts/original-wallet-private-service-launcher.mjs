import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonicalJSON,WalletAuthError} from '../src/canonical.js';
import {assertOriginalWalletRuntimeObserverLifetime} from './original-wallet-runtime-observer-launcher.mjs';
import {createOriginalWalletServicePrivateDispatch,decodeOriginalWalletServicePrivateRequest,beginOriginalWalletServicePrivateDispatchAcquisition,closeOriginalWalletServicePrivateDispatchAcquisition,originalWalletServicePrivateDispatchAcquisitionStatus} from '../src/original-wallet-service-private-dispatch.js';

// Original daemon only. No options, provider, endpoint, path, FD or Native owner
// is accepted from a renderer, command line, project or environment variable.
const requireNative=createRequire(import.meta.url),acquisitions=new WeakMap();
const names={acquire:'acquireOriginalNativePrivateServiceOwner',ready:'assertOriginalNativePrivateServiceOwnerReady',read:'readOriginalNativePrivateServiceRequest',write:'writeOriginalNativePrivateServiceResponse',retire:'retireOriginalNativePrivateServiceOwner',join:'joinOriginalNativePrivateServiceOwner',close:'closeOriginalNativePrivateServiceOwner'};
const fail=code=>{throw new WalletAuthError(code,'Original private service runtime is unavailable');};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function owned(ref){const s=acquisitions.get(ref);if(!s)fail('ORIGINAL_PRIVATE_RUNTIME_OWNER_REQUIRED');return s;}
function remember(s,cause,uncertain=true){if(!s.firstCausePresent){s.firstCausePresent=true;s.firstCause=cause;s.rejectFailure(cause);}if(uncertain)s.unknown=true;}
function loadFixedOriginalPrivateService(){
 const native=requireNative(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
 if(Object.values(names).some(name=>typeof native?.[name]!=='function'))fail('ORIGINAL_PRIVATE_SERVICE_IMPLEMENTATION_NOT_SUPPLIED');
 return Object.freeze(Object.fromEntries(Object.entries(names).map(([key,name])=>[key,native[name]])));
}
export function beginOriginalWalletPrivateServiceAcquisition(){
 let rejectFailure;const failure=new Promise((_resolve,reject)=>{rejectFailure=reject;});void failure.catch(()=>{});
 const ref=Object.freeze({});acquisitions.set(ref,{selected:false,acquireEntered:false,native:null,owner:null,host:null,runtime:null,dispatchAcquisition:null,dispatch:null,rows:new Map(),active:null,timer:null,pending:null,retired:false,closing:null,cleanupComplete:false,cleanupFailurePresent:false,cleanupCause:undefined,unknown:false,firstCausePresent:false,firstCause:undefined,failure,rejectFailure});return ref;
}
function current(s){
 if(s.retired||s.firstCausePresent)fail('ORIGINAL_PRIVATE_RUNTIME_RETIRED');
 assertOriginalWalletRuntimeObserverLifetime(s.runtime,s.host);
 if(!s.owner||s.native.ready(s.owner)!==undefined)fail('ORIGINAL_PRIVATE_OWNER_NOT_READY');
}
function currentResult(s,row){
 current(s);const observed=s.dispatch.selectCurrentOutcome(row.input.operation,row.input.phase,row.input.requestId);
 if(observed.result!==row.result||observed.unknown!==false||observed.terminal!==true||canonicalJSON(observed.result)!==row.responseRaw)fail('ORIGINAL_PRIVATE_TERMINAL_UNRESOLVED');
 current(s);
}
async function step(s){
 current(s);
 if(s.active===null){
  const raw=s.native.read(s.owner);
  if(raw===null){current(s);return;} // Idle/partial frame, never a result or grant.
  const row={originalRaw:raw,input:null,result:null,responseRaw:null,writeStarted:false,transportComplete:false,unknown:true};s.active=row;
  if(typeof raw!=='string')fail('ORIGINAL_PRIVATE_CHANNEL_RESPONSE_INVALID');
  const input=decodeOriginalWalletServicePrivateRequest(raw);row.input=input;
  const key=input.operation+':'+input.phase+':'+input.requestId;
  if(s.rows.has(key)||s.rows.size>=64)fail('ORIGINAL_PRIVATE_ALREADY_ENTERED');s.rows.set(key,row);
  current(s);row.result=await s.dispatch.dispatch(raw); // One business entry only.
  row.responseRaw=canonicalJSON(row.result);
  if(Buffer.byteLength(row.responseRaw)>65536)fail('ORIGINAL_PRIVATE_RESPONSE_CAPACITY');
  current(s);
  if(s.dispatch.acknowledge(input.operation,input.phase,input.requestId,hash(row.responseRaw))!==undefined)fail('ORIGINAL_PRIVATE_TERMINAL_INVALID');
  currentResult(s,row);
 }
 const row=s.active;currentResult(s,row);row.writeStarted=true;
 const written=s.native.write(s.owner,row.responseRaw);
 if(written===null){currentResult(s,row);return;} // Same pending write/offset/raw.
 if(written!==undefined)fail('ORIGINAL_PRIVATE_CHANNEL_RESPONSE_INVALID');
 currentResult(s,row);row.transportComplete=true;row.unknown=false;s.active=null;
}
function schedule(s){
 if(s.retired||s.firstCausePresent||s.timer!==null||s.pending!==null)return;
 s.timer=setTimeout(()=>{
  s.timer=null;if(s.retired||s.firstCausePresent)return;
  const pending=Promise.resolve().then(()=>step(s));s.pending=pending;
  void pending.then(()=>{if(s.pending===pending)s.pending=null;schedule(s);},cause=>{if(s.pending===pending)s.pending=null;remember(s,cause);});
 },25);
}
export function openOriginalWalletPrivateServiceAfterListen(host,runtime,acquisition){
 const s=owned(acquisition);if(s.selected)fail('ORIGINAL_PRIVATE_RUNTIME_ALREADY_SELECTED');s.selected=true;s.host=host;s.runtime=runtime;
 try{
  assertOriginalWalletRuntimeObserverLifetime(runtime,host);
  s.native=loadFixedOriginalPrivateService();s.acquireEntered=true;
  s.owner=s.native.acquire(); // Retain partial before ready/current can fail.
  if(!s.owner||typeof s.owner!=='object'||s.native.ready(s.owner)!==undefined)fail('ORIGINAL_PRIVATE_OWNER_NOT_READY');
  s.dispatchAcquisition=beginOriginalWalletServicePrivateDispatchAcquisition();
  s.dispatch=createOriginalWalletServicePrivateDispatch(host,runtime,s.owner,s.dispatchAcquisition);
  current(s);schedule(s);
  return Object.freeze({retire(){retire(s);},join(){return join(s);},close(){return closeOriginalWalletPrivateServiceAcquisition(acquisition);},status(){return originalWalletPrivateServiceAcquisitionStatus(acquisition);},whenFailed(){return s.failure;}});
 }catch(cause){
  remember(s,cause,s.acquireEntered&&!s.owner);
  try{retire(s);}catch(cleanupCause){s.cleanupFailurePresent=true;s.cleanupCause=cleanupCause;}
  throw cause;
 }
}
function retire(s){s.retired=true;if(s.timer!==null){clearTimeout(s.timer);s.timer=null;}s.dispatch?.retire();return undefined;}
async function join(s){if(s.pending)await Promise.allSettled([s.pending]);if(s.dispatch)await s.dispatch.join();return undefined;}
export function closeOriginalWalletPrivateServiceAcquisition(ref){
 const s=owned(ref);if(s.closing)return s.closing;
 s.closing=Promise.resolve().then(async()=>{
  let failed=false,cause;const cleanup=async action=>{try{if(await action()!==undefined)fail('ORIGINAL_PRIVATE_RUNTIME_CLEANUP_INCOMPLETE');}catch(error){if(!failed){failed=true;cause=error;}}};
  await cleanup(()=>retire(s));await cleanup(()=>join(s));
  let delegated=false;
  if(s.dispatchAcquisition){delegated=originalWalletServicePrivateDispatchAcquisitionStatus(s.dispatchAcquisition).captured;await cleanup(()=>closeOriginalWalletServicePrivateDispatchAcquisition(s.dispatchAcquisition));}
  // Once capture handed custody to the original dispatcher, its memoized close
  // owns Native disposal. Never invoke a second Native close on that same owner.
  if(!delegated&&s.owner){await cleanup(()=>s.native.retire(s.owner));await cleanup(()=>s.native.join(s.owner));await cleanup(()=>s.native.close(s.owner));}
  else if(!delegated&&s.acquireEntered&&!s.owner)await cleanup(()=>fail('ORIGINAL_PRIVATE_ACQUIRE_CUSTODY_UNKNOWN'));
  if(failed){s.cleanupFailurePresent=true;s.cleanupCause=cause;remember(s,cause);throw cause;}
  s.cleanupComplete=true;return undefined;
 });return s.closing;
}
export function originalWalletPrivateServiceAcquisitionStatus(ref){
 const s=owned(ref),dispatch=s.dispatchAcquisition?originalWalletServicePrivateDispatchAcquisitionStatus(s.dispatchAcquisition):null;
 return Object.freeze({selected:s.selected,captured:!!s.owner,businessFailurePresent:s.firstCausePresent||dispatch?.businessFailurePresent===true,cleanupFailurePresent:s.cleanupFailurePresent||dispatch?.cleanupFailurePresent===true,cleanupComplete:s.cleanupComplete,unknown:s.unknown||s.active!==null||dispatch?.unknown===true,retained:s.rows.size,retired:s.retired});
}
