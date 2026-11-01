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
type NativeAPI={prepare(reference:string,mode:Mode):Promise<PQHeldOperation>};
type NativeInstaller={install():boolean};
let installed:NativeAPI|null=null;
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
export function preparePQOperation(input:Readonly<{reference:string;mode:Mode}>):Promise<PQHeldOperation>{
 if(!input||Object.keys(input).sort().join()!=='mode,reference'||typeof input.reference!=='string'||
    !/^[\x21-\x7e]{1,128}$/.test(input.reference)||!['transaction','registered-restore','original-query'].includes(input.mode))throw Error('PQ_MOBILE_SELECTION_INVALID');
 return native().prepare(input.reference,input.mode);
}
