import {createHash} from 'node:crypto';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {ProductSessionGatewayNodeHost,captureOriginalWalletServiceRuntimeHostSource} from './product-session-gateway-node-host.js';
import {prepareOriginalWalletServiceAdmission} from './original-wallet-service-admission.js';

// Fixed original Native implementation must be linked here when its actual ABI
// is supplied. No public setter/callback/DTO can install an approving source.
// Dispatcher/kernel CODE exists below; actual Native acquisition still missing.
const originalNativeServiceBinding=null;
const pendingCustody=new Set();
const selectedNativeOriginals=new WeakSet();
const acquisitionStates=new WeakMap();
const fail=code=>{throw new WalletAuthError(code,'Original private service is unavailable');};
const hash=value=>createHash('sha256').update(value).digest('hex');
const operations=new Set(['beginYNX','handleReturn','restore','disconnect']);
export function decodeOriginalWalletServicePrivateRequest(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)fail('ORIGINAL_PRIVATE_CAPACITY');
 let value;try{value=JSON.parse(raw);}catch{fail('ORIGINAL_PRIVATE_REQUEST_INVALID');}
 exactFields(value,['requestId','operation','phase','body','proofHeader'],'Original private request');
 if(canonicalJSON(value)!==raw||!/^req_[A-Za-z0-9_-]{12,80}$/.test(value.requestId)||!operations.has(value.operation)||!['time','effect'].includes(value.phase))fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
 if(value.phase==='time'){if(value.body!==null||value.proofHeader!==null)fail('ORIGINAL_PRIVATE_REQUEST_INVALID');}
 else{
  if(typeof value.body!=='string'||Buffer.byteLength(value.body)>49152||!(value.proofHeader===null||typeof value.proofHeader==='string'&&Buffer.byteLength(value.proofHeader)<=16384))fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
  let body;try{body=JSON.parse(value.body);}catch{fail('ORIGINAL_PRIVATE_REQUEST_INVALID');}if(canonicalJSON(body)!==value.body)fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
  const fields={beginYNX:['request','approval'],handleReturn:['request','approval','completion'],restore:['requiredScopes'],disconnect:[]};exactFields(body,fields[value.operation],'Original four-op body');
  if(['beginYNX','handleReturn'].includes(value.operation)?value.proofHeader!==null:value.proofHeader===null)fail('ORIGINAL_PRIVATE_REQUEST_INVALID');
 }
 return Object.freeze(value);
}
// Cleanup-only owner is reserved by the normal daemon before entering capture.
// It cannot supply a Native implementation or access the original custody.
export function beginOriginalWalletServicePrivateDispatchAcquisition(){
 const ref=Object.freeze({});acquisitionStates.set(ref,{selected:false,close:null,state:null});return ref;
}
export function closeOriginalWalletServicePrivateDispatchAcquisition(ref){
 const acquired=acquisitionStates.get(ref);if(!acquired)fail('ORIGINAL_PRIVATE_ACQUISITION_INVALID');
 return acquired.close?acquired.close():Promise.resolve(undefined);
}
export function originalWalletServicePrivateDispatchAcquisitionStatus(ref){
 const acquired=acquisitionStates.get(ref);if(!acquired)fail('ORIGINAL_PRIVATE_ACQUISITION_INVALID');const s=acquired.state;
 return Object.freeze({captured:!!s,businessFailurePresent:s?.firstCausePresent===true,cleanupFailurePresent:s?.cleanupFailed===true,cleanupComplete:s?.cleanupComplete===true,unknown:s?[...s.records.values()].some(row=>row.unknown):false});
}
export function createOriginalWalletServicePrivateDispatch(host,runtime,nativeBorrow,acquisition=beginOriginalWalletServicePrivateDispatchAcquisition()){
 const acquired=acquisitionStates.get(acquisition);if(!acquired||acquired.selected)fail('ORIGINAL_PRIVATE_ACQUISITION_INVALID');acquired.selected=true;
 if(originalNativeServiceBinding===null)fail('ORIGINAL_PRIVATE_NATIVE_BINDING_NOT_IMPLEMENTED');
 // This fixed implementing source, NOT caller properties, recognizes custody.
 const original=originalNativeServiceBinding.capture(nativeBorrow);
 if(!original||typeof original!=='object')fail('ORIGINAL_PRIVATE_NATIVE_BINDING_INVALID');
 if(selectedNativeOriginals.has(original))fail('ORIGINAL_PRIVATE_BINDING_ALREADY_SELECTED');selectedNativeOriginals.add(original);
 let retired=false,closing=null,first,firstPresent=false,cleanupCause,cleanupFailed=false;
 const entered=new Set(),records=new Map();
 const remember=cause=>{if(!firstPresent){first=cause;firstPresent=true;state.firstCause=cause;state.firstCausePresent=true;}};
 const state={original,records,cleanupComplete:false,cleanupFailed:false};acquired.state=state;pendingCustody.add(state); // Before post-capture validation.
 let admission=null;
 const current=operation=>{
  if(retired)fail('ORIGINAL_PRIVATE_RETIRED');
  if(state.hostSource)captureOriginalWalletServiceRuntimeHostSource(state.hostSource);
  if(originalNativeServiceBinding.assertCurrent(original,operation)!==undefined)fail('ORIGINAL_PRIVATE_CURRENT_INVALID');
  if(admission)admission.assertCurrent({service:original.expectedRequest.service,productId:original.expectedRequest.productId,platform:original.expectedRequest.platform,gatewayOrigin:original.expectedRequest.gatewayOrigin,operation:operation??original.expectedRequest.operations[0]});
  if(retired)fail('ORIGINAL_PRIVATE_RETIRED');
 };
 const close=()=>{
  if(closing)return closing;retired=true;
  closing=Promise.resolve().then(async()=>{
   if(originalNativeServiceBinding.retire(original)!==undefined)fail('ORIGINAL_PRIVATE_CLEANUP_INCOMPLETE');
   while(entered.size)await Promise.allSettled([...entered]);
   if(await originalNativeServiceBinding.join(original)!==undefined||await originalNativeServiceBinding.close(original)!==undefined)fail('ORIGINAL_PRIVATE_CLEANUP_INCOMPLETE');
   state.cleanupComplete=true;pendingCustody.delete(state);return undefined;
  }).catch(cause=>{cleanupCause=cause;cleanupFailed=true;state.cleanupFailed=true;state.cleanupCause=cause;throw cause;});return closing;
 };
 acquired.close=close;
 try{current(null);state.hostSource=ProductSessionGatewayNodeHost.prototype.captureOriginalWalletServiceRuntimeSource.call(host);admission=prepareOriginalWalletServiceAdmission(original.sourceSelection,original.receiptSelection,original.expectedRequest,()=>new Date());current(null);}catch(cause){remember(cause);retired=true;void close().catch(()=>{});throw cause;}
 return Object.freeze({
  dispatch(raw){
   const input=decodeOriginalWalletServicePrivateRequest(raw);current(input.operation);
   if([...records.values()].some(row=>row.localFailurePresent))fail('ORIGINAL_PRIVATE_LOCAL_FAILURE_UNRESOLVED');
   const key=input.operation+':'+input.phase+':'+input.requestId;if(records.has(key))fail('ORIGINAL_PRIVATE_ALREADY_ENTERED');if(records.size>=64)fail('ORIGINAL_PRIVATE_CAPACITY');
   const row={inputDigest:hash(raw),result:null,unknown:false,terminal:false,fulfilled:false,localFailurePresent:false,localCause:undefined};records.set(key,row);
   const promise=Promise.resolve().then(()=>{
    try{
    current(input.operation);
    // Recheck at execution, not just reservation. The synchronous catch below
    // latches a failed transaction before the next already queued callback runs.
    if([...records.values()].some(other=>other!==row&&other.localFailurePresent))fail('ORIGINAL_PRIVATE_LOCAL_FAILURE_UNRESOLVED');
    // Selected Native source enforces account/run/executor/workspace association
    // and the original service admission; no service proof from self DTO fields.
    if(originalNativeServiceBinding.assertAdmission(original,input)!==undefined)fail('ORIGINAL_PRIVATE_ADMISSION_INVALID');
    const observation=runtime.capture(records.size);
    runtime.assertObservationCurrent(observation);current(input.operation);
    row.unknown=true;
    if([...records.values()].some(other=>other!==row&&other.localFailurePresent))fail('ORIGINAL_PRIVATE_LOCAL_FAILURE_UNRESOLVED');
    const result=ProductSessionGatewayNodeHost.prototype.handleOriginalWalletServicePrivateRequest.call(host,input,row,original.association);
    row.result=result;current(input.operation);runtime.assertObservationCurrent(observation);current(input.operation);
    row.fulfilled=true;return result;
    }catch(cause){remember(cause);row.localFailurePresent=true;row.localCause=cause;row.unknown=true;throw cause;}
   });
   entered.add(promise);void promise.then(()=>entered.delete(promise),()=>entered.delete(promise));return promise;
  },
  acknowledge(operation,phase,requestId,resultDigest){current(operation);const row=records.get(operation+':'+phase+':'+requestId);if(!row?.result||!row.fulfilled||row.localFailurePresent||row.terminal||hash(canonicalJSON(row.result))!==resultDigest)fail('ORIGINAL_PRIVATE_TERMINAL_INVALID');if(originalNativeServiceBinding.assertTerminal(original,operation,phase,requestId,resultDigest)!==undefined)fail('ORIGINAL_PRIVATE_TERMINAL_INVALID');current(operation);row.terminal=true;row.unknown=false;return undefined;},
  selectOutcome(operation,phase,requestId){const row=records.get(operation+':'+phase+':'+requestId);if(!row)fail('ORIGINAL_PRIVATE_OUTCOME_REQUIRED');return Object.freeze({result:row.result,unknown:row.unknown,terminal:row.terminal});},
  retire(){retired=true;return undefined;},
  join:async()=>{while(entered.size)await Promise.allSettled([...entered]);return undefined;},close,
  status:()=>Object.freeze({retired,firstCausePresent:firstPresent,cleanupFailurePresent:cleanupFailed,unknown:[...records.values()].some(row=>row.unknown)})
 });
}
