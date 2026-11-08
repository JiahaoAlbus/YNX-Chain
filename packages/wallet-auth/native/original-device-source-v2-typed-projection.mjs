// PRIVATE post-verification projection. Called only after the SAME sole full
// kernel accepted immutable originals/current/registrations. This DATA helper
// does not authenticate a caller DTO or mint a Source/Root/approval brand.
import{sourceCanonicalV2,parseOriginalSourceCanonicalV2}from'./original-auth-source-v2-public-codec.mjs';
import{SourceUTF8Encoder}from'./original-source-private-utf8.mjs';
import{inspectOriginalDeviceCreateIntentDATA}from'../src/original-device-create-intent-data-core.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'../src/product-session-device-registration-v4.js';
import{pqHexBytes}from'../src/pq-public-bytes.js';
import{PRODUCT_DEVICE_V4_SOURCE_PURPOSE as PRIMARY,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE as PROVISION,PRODUCT_DEVICE_V4_QUERY_PURPOSE as QUERY}from'./original-source-device-family-constants.mjs';
const utf8=new SourceUTF8Encoder(),fail=()=>{throw Object.assign(Error('DEVICE_SOURCE_TYPED_PROJECTION'),{code:'DEVICE_SOURCE_TYPED_PROJECTION'});};
export function projectVerifiedDeviceSourceCapturedDATA(projection,enrollmentBody,profileBody,currentBody,afterAtMs){
 // These are the parsed SAME original bodies retained by the sole collector,
 // not a second parser/verification path. No fields come from a UI request.
 if(!projection||projection.dataOnly!==true||projection.nativeAdmission!==false||projection.status!=='active'||projection.sourceId!==profileBody.sourceId||projection.instanceId!==profileBody.instanceId||projection.generation!==profileBody.generation||!Number.isSafeInteger(profileBody.generation)||profileBody.generation<1)fail();
 const purpose=profileBody.purpose,association=projection.selection.association,sourceGeneration=String(profileBody.generation);
 let kind,value,namespace=null,termBegin=0,termEnd=Number.MAX_SAFE_INTEGER;
 if(purpose===PROVISION){
  kind=1;const scope=projection.selection.productSessionDeviceV4Provisioning,n=scope.nativeIntentDATA,terms=inspectOriginalDeviceCreateIntentDATA(utf8.encode(scope.intentOriginal)).terms;
  value=Object.freeze({network:n.network,account:association.account,stableDeviceIdentity:n.stableDeviceIdentity,intentOriginal:scope.intentOriginal,sourceId:projection.sourceId,instanceId:projection.instanceId,sourceGeneration,deviceGeneration:terms.generation,canonicalOwner:terms.canonicalOwner});termBegin=Number(n.issuedAtMs);termEnd=Number(n.expiresAtMs);
 }else if(purpose===PRIMARY){
  kind=2;const scope=projection.selection.productSessionDeviceV4,r=inspectProductSessionDeviceRegistrationOriginalV4Data(utf8.encode(scope.registrationOriginal)).record;
  value=Object.freeze({registrationOriginal:scope.registrationOriginal,pkA:new Uint8Array(pqHexBytes(r.pkA,2592)).buffer,pkB:new Uint8Array(pqHexBytes(r.pkB,64)).buffer,account:association.account,network:r.networkId,deviceGeneration:r.generation,canonicalOwner:r.canonicalOwner});
  // Primary namespace ONLY. Neither intent nor a query identity can provide it.
  namespace=Object.freeze({issuer:enrollmentBody.gatewayOrigin,subject:association.account});
 }else if(purpose===QUERY){
  kind=3;const scope=projection.selection.productSessionDeviceV4Query;
  value=Object.freeze({account:scope.identityBinding.account,network:scope.identityBinding.networkId,stableDeviceIdentity:scope.stableDeviceIdentity,sourceGeneration,canonicalOwner:scope.identityBinding.canonicalOwner});
 }else fail();
 const notBeforeMs=Math.max(enrollmentBody.issuedAtMs,profileBody.issuedAtMs,currentBody.issuedAtMs,termBegin),expiresAtMs=Math.min(projection.expiresAtMs,termEnd);
 if(![notBeforeMs,expiresAtMs,afterAtMs].every(Number.isSafeInteger)||notBeforeMs<0||expiresAtMs<=notBeforeMs||afterAtMs<notBeforeMs||afterAtMs>=expiresAtMs)fail();
 const accountComparisonDATA=Object.freeze({purpose,sourceId:projection.sourceId,instanceId:projection.instanceId,sourceGeneration,accountIssuer:enrollmentBody.gatewayOrigin,accountSubject:association.account});
 const window=Object.freeze({notBeforeMs,expiresAtMs}),previousCanonical=sourceCanonicalV2({sequence:projection.sequence,floor:projection.floor,head:projection.head,timeFloor:projection.timeFloor,executionHeight:projection.executionHeight});
 if(utf8.encode(previousCanonical).length>4096)fail();
 return Object.freeze({kind,value,window,namespace,accountComparisonDATA,previousCanonical,dataOnly:true,RootAdmission:false,SourceAdmission:false,nativeAdmission:false,platformRuntimeVerified:false});
}
