// Dedicated read-only cold query DATA. No creation terms, device key access,
// PoP, registration, recovery or slot creation. Stable codec is SOLE SDK-owned.
import * as deviceIdentityCodec from '../src/original-device-create-intent.js';
import {canonicalJSON} from '../src/canonical.js';
import {exactPQRecord} from '../src/pq-wallet-contract.js';
export const PRODUCT_DEVICE_V4_QUERY_PURPOSE='product-session-device-query-source-v4';
export const PRODUCT_DEVICE_V4_QUERY_OPERATIONS=Object.freeze(['device.original-query']);
const IDENTITY_FIELDS=Object.freeze(['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId']);
const APPLICATION_FIELDS=Object.freeze(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback']);
const fail=code=>{throw Object.assign(Error(code),{code});};
export function inspectOriginalProductDeviceV4QueryScopeDATA(scope,association,networkId,subjectOwner,issued,expires,at){
 exactPQRecord(scope,['version','stableDeviceIdentity','identityBinding']);
 exactPQRecord(scope.identityBinding,IDENTITY_FIELDS);
 exactPQRecord(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(scope.version!=='4'||typeof scope.stableDeviceIdentity!=='string'||!scope.stableDeviceIdentity.length||Buffer.byteLength(scope.stableDeviceIdentity)>1024)fail('AUTH_SOURCE_V2_DEVICE_QUERY_SCOPE');
 // This export is supplied only by the original SDK. Absence is unavailable,
 // never a locally invented parser/encoder or a fallback through creation DATA.
 if(typeof deviceIdentityCodec.inspectOriginalDeviceIdentityDATA!=='function')fail('AUTH_SOURCE_V2_DEVICE_QUERY_SDK_STABLE_CODEC_NOT_SUPPLIED');
 const application=Object.fromEntries(APPLICATION_FIELDS.map(k=>[k,scope.identityBinding[k]]));
 const view=deviceIdentityCodec.inspectOriginalDeviceIdentityDATA(Buffer.from(scope.stableDeviceIdentity,'utf8'),application);
 const binding=scope.identityBinding;
 if(view.stableDeviceIdentity!==scope.stableDeviceIdentity||canonicalJSON(view.applicationBinding)!==canonicalJSON(application)||binding.networkId!==networkId||binding.canonicalOwner!==subjectOwner)fail('AUTH_SOURCE_V2_DEVICE_QUERY_IDENTITY');
 for(const key of ['networkId','canonicalOwner','account','productId','clientId','deviceId'])if(view.identity[key]!==binding[key])fail('AUTH_SOURCE_V2_DEVICE_QUERY_IDENTITY');
 for(const key of Object.keys(association))if(association[key]!==binding[key])fail('AUTH_SOURCE_V2_DEVICE_QUERY_ASSOCIATION');
 // Independent Source profile window, not creation's <=30s terms window.
 // Original enrollment/profile/current AND checks remain upstream/downstream.
 if(![issued,expires,at].every(Number.isSafeInteger)||issued<0||expires<=issued||expires-issued>86400000||at<issued||at>=expires)fail('AUTH_SOURCE_V2_DEVICE_QUERY_WINDOW');
 return Object.freeze({stableDeviceIdentity:view.stableDeviceIdentity,identity:view.identity,applicationBinding:view.applicationBinding,expiresAtMs:expires,queryOnly:true,devicePublic:null,accountAuthorization:null,dataOnly:true,userApproved:false,registrationPerformed:false,deviceKeyAccess:false,authorized:false,nativeAdmission:false});
}
