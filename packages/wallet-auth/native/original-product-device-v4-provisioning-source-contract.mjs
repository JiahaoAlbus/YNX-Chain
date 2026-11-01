// Separate creation Source DATA contract. Uses sole SDK canonical intent;
// never borrows pending PoP/HTTP/BIRTH/asset policy or proves user approval.
import{inspectOriginalDeviceCreateIntentDATA}from'../src/original-device-create-intent.js';
import{canonicalJSON}from'../src/canonical.js';
import{exactPQRecord}from'../src/pq-wallet-contract.js';
export const PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE='product-session-device-provisioning-source-v4';
export const PRODUCT_DEVICE_V4_PROVISIONING_OPERATIONS=Object.freeze(['device.creation-prepare','device.original-query']);
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_DEVICE_PROVISIONING_SCOPE'),{code:'AUTH_SOURCE_V2_DEVICE_PROVISIONING_SCOPE'});};
export function inspectOriginalProductDeviceV4ProvisioningScopeDATA(scope,association,networkId,subjectOwner,issued,expires,at){
 exactPQRecord(scope,['version','intentOriginal','nativeIntentDATA']);exactPQRecord(association,['account','clientId','productId','platform','applicationId','deviceId']);
 exactPQRecord(scope.nativeIntentDATA,['network','stableDeviceIdentity','approvedTerms','issuedAtMs','expiresAtMs']);
 if(scope.version!=='4'||typeof scope.intentOriginal!=='string'||Buffer.byteLength(scope.intentOriginal)>16384)fail();
 const view=inspectOriginalDeviceCreateIntentDATA(Buffer.from(scope.intentOriginal,'utf8')),t=view.terms;
 if(canonicalJSON(scope.nativeIntentDATA)!==canonicalJSON(view.nativeIntentDATA)||t.networkId!==networkId||t.canonicalOwner!==subjectOwner)fail();
 for(const key of Object.keys(association))if(association[key]!==t[key])fail();
 const begin=Number(view.nativeIntentDATA.issuedAtMs),end=Number(view.nativeIntentDATA.expiresAtMs);
 if(![issued,expires,at].every(Number.isSafeInteger)||issued<begin||expires>end||expires<=issued||at<issued||at>=expires)fail();
 return Object.freeze({creationIntent:view.nativeIntentDATA,expiresAtMs:Math.min(expires,end),devicePublic:null,accountAuthorization:null,dataOnly:true,userApproved:false,registered:false,authorized:false,nativeAdmission:false});
}
