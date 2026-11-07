import {NativeModules} from 'react-native';

export type PQNativeCause=Readonly<{kind:'native-code';code:number}>;
export type PQPublicOutcome=Readonly<{
 version:1;state:'unprepared'|'prepared'|'signing-unknown'|'signed-unsubmitted'|'submission-unknown'|'restore-unknown'|'registered-slot-restored'|'os-operation-retained';
 operationSucceeded:boolean;signEntered:boolean;submitEntered:boolean;restoreEntered:boolean;
 queryEntered:boolean;storageConfirmed:boolean;cancelled:boolean;closed:boolean;
 primitiveStatus:number;primitiveCleanup:number;
 firstCause:PQNativeCause|null;cleanupCause:PQNativeCause|null;
 /** Projection only. Signed originals stay native and are never returned. */
 account:string|null;networkId:string|null;requestDigest:string|null;transactionHash:string|null;
 memberRetained:boolean;reviewAvailable:boolean;submissionObserved:boolean;queryObserved:boolean;
 osOperation:Readonly<{action:'import-absent'|'remove-exact';phase:'entered'|'unknown'|'recorded';effectPossible:boolean;ackConfirmed:boolean;firstCause:PQNativeCause|null}>|null;
 canRetry:false;consensusFinality:false;clearsOriginal:false;
}>;
declare const nativeHeldOperation:unique symbol;
export interface PQHeldOperation {
 readonly [nativeHeldOperation]:never;
 captureOriginalReview():Promise<PQPublicOutcome>;
 signOnce():Promise<PQPublicOutcome>;
 /** Requires a separate original native broadcast approval. */
 submitSignedOnce():Promise<PQPublicOutcome>;
 /** Same owner and original operation only; never signing or sending. */
 queryOriginal():Promise<PQPublicOutcome>;
 restoreRegisteredEmptyOnce():Promise<PQPublicOutcome>;
 cancel():Promise<PQPublicOutcome>;
 copyOriginalPublicOutcome():Promise<PQPublicOutcome>;
 /** Flush only the SAME native signed original after an unconfirmed ACK. */
 saveOriginal():Promise<PQPublicOutcome>;
 retire():Promise<PQPublicOutcome>;
 /** Queue fence only. close/outcome confirms actual cleanup separately. */
 join():Promise<PQPublicOutcome>;
 close():Promise<PQPublicOutcome>;
}
type Mode='transaction'|'registered-restore'|'original-query';
type NativeAPI={prepare(reference:string,mode:Mode):Promise<PQHeldOperation>;assertRuntimeCurrent?:()=>void;requestAppRetire?:()=>void};
type NativeInstaller={install():boolean;readPublicStatus?():unknown};
let installed:NativeAPI|null=null;
export type PQPublicRuntime='not-installed'|'initializing'|'ready'|'retaining';
export type PQPublicStatus=Readonly<{
 version:1;nativeLink:'native-reported'|'not-observed';runtime:PQPublicRuntime|'not-observed';
 held:Readonly<{operations:number;coreUncertain:number;osUncertain:number;osRecorded:number;cleanupFaults:number;workerBusy:boolean}>|null;
 inventoryScope:'current-process-held-only';snapshot:'last-completed-job';
 durableInventory:'not-inspected';authority:'not-inspected';osProtection:'not-inspected';keyHealth:'not-inspected';
 protectedSelection:'not-supplied';canSign:false;canRestore:false;canSubmit:false;
 statusReason:null|'native-status-not-supplied'|'native-status-invalid'|'native-status-read-failed';
}>;
const passiveStatus=Object.freeze({version:1 as const,inventoryScope:'current-process-held-only' as const,snapshot:'last-completed-job' as const,
 durableInventory:'not-inspected' as const,authority:'not-inspected' as const,osProtection:'not-inspected' as const,keyHealth:'not-inspected' as const,
 protectedSelection:'not-supplied' as const,canSign:false as const,canRestore:false as const,canSubmit:false as const});
const unavailableStatus=(statusReason:PQPublicStatus['statusReason']):PQPublicStatus=>Object.freeze({...passiveStatus,nativeLink:'not-observed',runtime:'not-observed',held:null,statusReason});
const isPublicRuntime=(value:unknown):value is PQPublicRuntime=>value==='not-installed'||value==='initializing'||value==='ready'||value==='retaining';
const isHeldCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=64;
/** Passive Native report only. Never calls install/prepare or probes a reference.
 * Counts cover held process state at the last completed worker job, not cold
 * records. Ready/link/counts never establish Source, protection or permission. */
export function readPQPublicStatus():PQPublicStatus{
 try{
  const module=NativeModules.YNXPQCustody as NativeInstaller|undefined;
  if(!module||typeof module.readPublicStatus!=='function')return unavailableStatus('native-status-not-supplied');
  const raw=module.readPublicStatus();
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return unavailableStatus('native-status-invalid');
  const ds=Object.getOwnPropertyDescriptors(raw),fields=['version','runtime','heldOperations','heldCoreUncertain','heldOSUncertain','heldOSRecorded','heldCleanupFaults','workerBusy'];
  if(Reflect.ownKeys(ds).length!==fields.length)return unavailableStatus('native-status-invalid');
  const data:Record<string,unknown>={};
  for(const key of fields){
   const descriptor=ds[key];
   if(!descriptor||!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))return unavailableStatus('native-status-invalid');
   data[key]=descriptor.value;
  }
  const {version,runtime,heldOperations:operations,heldCoreUncertain:coreUncertain,heldOSUncertain:osUncertain,
   heldOSRecorded:osRecorded,heldCleanupFaults:cleanupFaults,workerBusy}=data;
  if(version!==1||!isPublicRuntime(runtime)||typeof workerBusy!=='boolean'||!isHeldCount(operations)||!isHeldCount(coreUncertain)||
     !isHeldCount(osUncertain)||!isHeldCount(osRecorded)||!isHeldCount(cleanupFaults))return unavailableStatus('native-status-invalid');
  if(coreUncertain>operations||osUncertain+osRecorded>operations||cleanupFaults>operations||
     (runtime==='not-installed'||runtime==='initializing')&&(operations!==0||workerBusy))return unavailableStatus('native-status-invalid');
  return Object.freeze({...passiveStatus,nativeLink:'native-reported',runtime,
   held:Object.freeze({operations,coreUncertain,osUncertain,osRecorded,cleanupFaults,workerBusy}),statusReason:null});
 }catch{return unavailableStatus('native-status-read-failed');}
}
/** Normal platform native module only, no injected provider or Node SDK.
 * Native performs authorization and retains all failures independently of UI. */
function native():NativeAPI{
 if(installed)return installed;
 const installer=NativeModules.YNXPQCustody as NativeInstaller|undefined;
 if(!installer||installer.install()!==true)throw Error('PQ_MOBILE_NATIVE_NOT_SUPPLIED');
 const api=(globalThis as typeof globalThis&{__ynxPQCustodyV1?:NativeAPI}).__ynxPQCustodyV1;
 if(!api||typeof api.prepare!=='function')throw Error('PQ_MOBILE_NATIVE_NOT_SUPPLIED');
 installed=api;return api;
}
/** Explicit application boot only. Does not select an account or establish
 * registered/Source/review authority. Uses the SAME normal installer/cache. */
export function initializePQNativeRuntime():PQPublicStatus{
 if(arguments.length)throw Error('PQ_ARGUMENTS_INVALID');
 const api=native();if(typeof api.assertRuntimeCurrent!=='function')throw Error('PQ_MOBILE_NATIVE_LIFECYCLE_NOT_SUPPLIED');api.assertRuntimeCurrent();return readPQPublicStatus();
}
/** Native runtime lifetime check only; not account/Source current permission. */
export function assertPQNativeRuntimeCurrent():void{
 if(arguments.length)throw Error('PQ_ARGUMENTS_INVALID');
 if(!installed||typeof installed.assertRuntimeCurrent!=='function')throw Error('PQ_MOBILE_NATIVE_LIFECYCLE_NOT_SUPPLIED');installed.assertRuntimeCurrent();
}
/** APP SHUTDOWN ONLY, not project-view close. Synchronously revokes new work
 * and account pickers; Native module teardown must still join/close actual
 * custody and UI debts. This call is not a completed-cleanup receipt. */
export function requestPQNativeAppRetire():void{
 if(arguments.length)throw Error('PQ_ARGUMENTS_INVALID');
 if(!installed||typeof installed.requestAppRetire!=='function')throw Error('PQ_MOBILE_NATIVE_LIFECYCLE_NOT_SUPPLIED');installed.requestAppRetire();
}
export function preparePQOperation(input:Readonly<{reference:string;mode:Mode}>):Promise<PQHeldOperation>{
 if(!input||Object.keys(input).sort().join()!=='mode,reference'||typeof input.reference!=='string'||
    !/^[\x21-\x7e]{1,128}$/.test(input.reference)||!['transaction','registered-restore','original-query'].includes(input.mode))throw Error('PQ_MOBILE_SELECTION_INVALID');
 return native().prepare(input.reference,input.mode);
}
