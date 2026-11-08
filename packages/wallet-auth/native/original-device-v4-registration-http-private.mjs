// Fixed C4 Native HTTP loan consumer. Native owns class/tag/Source/context and
// inventory. SDK retains originals before failure and uses the SOLE decoder.
import{WalletAuthError}from'../src/canonical.js';
import{inspectOriginalDeviceV4HTTPResponseDATA}from'../src/original-product-device-v4-http-response-data.js';
const unknown=(operationId,cause)=>Object.assign(new WalletAuthError('PAIR_V4_HTTP_OUTCOME_UNKNOWN','Retain original operation/body; no resend is authorized'),{operationId,cause,recoverOnly:true,outcomeUnknown:true,retryAuthorized:false});
const nativeError=(failure,status)=>Object.assign(new WalletAuthError('DEVICE_REGISTRATION_NATIVE_FAILURE','Original Native failure'),{originalFailure:failure,originalStatus:status});
import{inspectNativeFailureDATA as failure,inspectNativeHttpStatusDATA as status,inspectNativeResponseDATA as response,inspectNativeDrainDATA as inspectDrain}from'./original-device-v4-registration-native-data.mjs';
export function createOriginalRegistrationHTTPFromFixedNative(nativeHost,pending,originalContext){
 const owned=[],observations=[];let firstPresent=false,first;const remember=e=>{if(!firstPresent){firstPresent=true;first=e}},call=(name,...args)=>Reflect.apply(Object.getOwnPropertyDescriptor(nativeHost,name).value,nativeHost,args);
 const httpCall=(ref,name)=>{if(call('isOriginalHttp',ref)!==true)throw new WalletAuthError('DEVICE_REGISTRATION_HTTP_BRAND','Genuine same-runtime HTTP owner required');const fn=ref[name];if(typeof fn!=='function')throw new WalletAuthError('DEVICE_REGISTRATION_HTTP_ABI','Original HTTP method required');return Reflect.apply(fn,ref,[])};
 async function send(kind,{originalBody,abortContext}){
  originalContext(abortContext);const operationId=JSON.parse(originalBody).operationId;let loan,submitted,copied,originalStatus,decoded,decodeCause,decodeFailed=false,nativeCausePresent=false,nativeCause;
  try{
   try{submitted=await call(kind===1?'submitOriginalDeviceV4Pair':'submitOriginalDeviceV4Completion',pending,abortContext,originalBody);}catch(e){nativeCausePresent=true;nativeCause=e;const d=e!==null&&(typeof e==='object'||typeof e==='function')?Object.getOwnPropertyDescriptor(e,'partial'):undefined;if(d&&Object.hasOwn(d,'value'))submitted=d.value;}
   // Direct SAME HTTPHost, or a genuine entered partial retained before error.
   // C/Native inventory adopts before return; retain SAME nonnull loan BEFORE
   // inspecting F24/shape. Never convert http_entered2 to a boolean success.
   if(submitted!==null&&submitted!==undefined){loan={owner:submitted,closeEntered:false,physicalDone:false};owned.push(loan);}
   if(loan){copied=response(httpCall(loan.owner,'readOriginalResponseDATA'));originalStatus=status(httpCall(loan.owner,'readOriginalStatusDATA'));observations.push(Object.freeze({response:copied,status:originalStatus,dataOnly:true}));}
   // Actual owned raw bytes/status are retained before any original/late error.
   if(copied?.responsePresent===true){try{decoded=inspectOriginalDeviceV4HTTPResponseDATA(copied.httpStatus,new Uint8Array(copied.bytes));}catch(e){decodeFailed=true;decodeCause=e;}}
   const f=Object.freeze({present:0,code:0,origin:0,platform_code:'0'});if(originalStatus?.first_failure.present)throw nativeError(originalStatus.first_failure,originalStatus);if(nativeCausePresent)throw nativeCause;if(copied){const c=failure(copied.failure);if(c.present)throw nativeError(c,originalStatus);}
   if(!loan||!originalStatus||typeof copied?.responsePresent!=='boolean'||originalStatus.response_present!==(copied.responsePresent?1:0)||copied.responsePresent&&originalStatus.http_status!==copied.httpStatus||originalStatus.http_entered===2&&!originalStatus.response_present||copied?.responsePresent!==true)throw nativeError(originalStatus?.first_failure??f,originalStatus);
   if(decodeFailed)throw decodeCause;originalContext(abortContext);return decoded;
  }catch(cause){const firstCause=originalStatus?.first_failure.present?nativeError(originalStatus.first_failure,originalStatus):nativeCausePresent?nativeCause:cause;remember(firstCause);const error=unknown(operationId,firstCause);if(copied?.responsePresent===true)Object.defineProperty(error,'originalResponse',{value:decodeFailed&&decodeCause?.originalResponse!==undefined?decodeCause.originalResponse:decoded??Object.freeze({httpStatus:copied.httpStatus,originalBytes:copied.bytes,dataOnly:true}),enumerable:true});if(originalStatus)Object.defineProperty(error,'originalNativeStatus',{value:originalStatus,enumerable:true});throw error;}
 }
 async function drain(){let physicalDone=true;for(const r of owned){if(r.physicalDone)continue;if(r.closeEntered){physicalDone=false;continue;}r.closeEntered=true;try{const d=inspectDrain(httpCall(r.owner,'close'));const f=failure(d.failure);r.physicalDone=d.physical_done===1;if(!r.physicalDone)physicalDone=false;if(f.present)remember(nativeError(f,d));}catch(e){remember(e);physicalDone=false;}}return Object.freeze({physicalDone,firstCausePresent:firstPresent,firstCause:first});}
 return Object.freeze({pairDeviceV4:i=>send(1,i),completeDeviceV4:i=>send(2,i),drain,readOriginalTransportStatusDATA:()=>Object.freeze({observations:Object.freeze([...observations]),retained:owned.length,outstanding:owned.filter(r=>!r.physicalDone).length,firstCausePresent:firstPresent,firstCause:first,dataOnly:true,SourceAdmission:false,NativeAdmission:false})});
}
