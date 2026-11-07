// PRIVATE registered Host dispatch only. No endpoint, IPC wire, generic
// provider or credential-to-JSON capability conversion is introduced here.
import {types} from 'node:util';
import {PRODUCT_SESSION_V4_HEADER_MAX_BYTES} from './product-session-proof-v4.js';
import {ProductSessionGatewayNodeHost} from './product-session-gateway-node-host.js';
import {PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS} from './product-session-device-v4.js';
const fail=code=>{throw Object.assign(Error(code),{code})};
function record(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('SOCIAL_DIRECTORY_DISPATCH_DATA');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail('SOCIAL_DIRECTORY_DISPATCH_DATA');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function capture(input){const v=record(input,['requestId','method','path','body','proofHeader','expected']);if(typeof v.requestId!=='string'||!/^req_[A-Za-z0-9_-]{12,80}$/.test(v.requestId)||v.method!=='GET'||!['/v4/devices/directory','/m1qa/v4/devices/directory'].includes(v.path)||v.body!==''||typeof v.proofHeader!=='string'||v.proofHeader.length<1||v.proofHeader.length>PRODUCT_SESSION_V4_HEADER_MAX_BYTES)fail('SOCIAL_DIRECTORY_EXACT_REQUEST_REQUIRED');const e=record(v.expected,PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS);if(e.productId!=='social')fail('SOCIAL_DIRECTORY_PRODUCT_REQUIRED');for(const value of Object.values(e))if(value!==null&&typeof value!=='string')fail('SOCIAL_DIRECTORY_EXPECTED_DATA');return Object.freeze({...v,expected:Object.freeze(e)});}
export function openOriginalSocialDeviceDirectoryPrincipalDispatchV4(actualHost,sameAcceptedRequest,operation){
 if(arguments.length!==3||!actualHost||types.isProxy(actualHost)||!['currentExistingSocialDeviceDirectoryPrincipalV4','recheckExistingSocialDeviceDirectoryPrincipalV4'].includes(operation))fail('SOCIAL_DIRECTORY_PRIVATE_DISPATCH_REQUIRED');
 const captured=capture(sameAcceptedRequest),runMethod=ProductSessionGatewayNodeHost.prototype[operation],completeMethod=ProductSessionGatewayNodeHost.prototype.assertOriginalSocialDeviceDirectoryPrincipalDeliveryV4;
 let promise=null,result,retired=false,entered=false,settled=false,closed=false,firstPresent=false,first;
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e;}};
 const unchanged=()=>{const current=capture(sameAcceptedRequest);if(Object.keys(captured).some(k=>k!=='expected'&&current[k]!==captured[k])||PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS.some(k=>current.expected[k]!==captured.expected[k]))fail('SOCIAL_DIRECTORY_ORIGINAL_REQUEST_CHANGED');};
 function run(){if(promise)return promise;if(retired||closed)fail('SOCIAL_DIRECTORY_DISPATCH_RETIRED');promise=Promise.resolve().then(async()=>{try{if(firstPresent)throw first;if(retired||closed)fail('SOCIAL_DIRECTORY_DISPATCH_RETIRED');unchanged();entered=true;result=await Reflect.apply(runMethod,actualHost,[captured]); // retain before late/current
  unchanged();if(retired)fail('SOCIAL_DIRECTORY_DISPATCH_UNKNOWN');Reflect.apply(completeMethod,actualHost,[result]);return result;
 }catch(e){remember(e);throw e;}finally{entered=false;settled=true;}});return promise;}
 const retire=()=>{retired=true;};
 function join(){if(!retired||entered||promise&&!settled)fail('SOCIAL_DIRECTORY_DISPATCH_JOIN_PENDING');}
 function close(){join();closed=true;}
 return Object.freeze({run,retire,join,close,readCapturedAcceptedRequestDATA(){return captured;},readRetainedOriginalRootResponseForCleanupDATA(){return result;},readOriginalRootResponse(){if(firstPresent)throw first;try{if(!settled||retired||closed)fail('SOCIAL_DIRECTORY_ORIGINAL_RESPONSE_NOT_READY');unchanged();Reflect.apply(completeMethod,actualHost,[result]);return result;}catch(e){remember(e);throw e;}},statusDATA:()=>Object.freeze({retired,entered,settled,closed,originalResponseRetained:result!==undefined,firstCausePresent:firstPresent,firstCause:first,RootAdmission:false,SourceAdmission:false,remoteReceiptProved:false})});
}
