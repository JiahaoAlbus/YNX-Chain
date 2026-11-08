// Confirmed independent capture kind4 (not operation enum1/2). SAME verified scope,
// never approval, Root/Source, a new decoder or a device/current grant.
import{sourceCanonicalV2}from'./original-auth-source-v2-public-codec.mjs';
import{SourceUTF8Encoder}from'./original-source-private-utf8.mjs';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'../src/product-session-device-registration-v4.js';
import{pqHexBytes}from'../src/pq-public-bytes.js';
import{PRODUCT_DEVICE_V4_PENDING_PURPOSE as PURPOSE}from'./original-product-device-v4-pending-scope-data-core.mjs';
const utf8=new SourceUTF8Encoder(),fail=()=>{throw Object.assign(Error('DEVICE_PENDING_TYPED_PROJECTION'),{code:'DEVICE_PENDING_TYPED_PROJECTION'});};
export function projectVerifiedPendingDeviceSourceCapturedDATA(projection,enrollmentBody,profileBody,currentBody,afterAtMs){
 if(!projection||projection.dataOnly!==true||projection.nativeAdmission!==false||projection.status!=='active'||profileBody.purpose!==PURPOSE||projection.sourceId!==profileBody.sourceId||projection.instanceId!==profileBody.instanceId||projection.generation!==profileBody.generation||!Number.isSafeInteger(profileBody.generation)||profileBody.generation<1)fail();
 const scope=projection.selection.productSessionDeviceV4Pending,association=projection.selection.association,r=inspectProductSessionDeviceRegistrationOriginalV4Data(utf8.encode(scope.registrationOriginal)).record,sourceGeneration=String(profileBody.generation);
 const notBeforeMs=Math.max(enrollmentBody.issuedAtMs,profileBody.issuedAtMs,currentBody.issuedAtMs),expiresAtMs=projection.expiresAtMs;
 if(![notBeforeMs,expiresAtMs,afterAtMs].every(Number.isSafeInteger)||notBeforeMs<0||expiresAtMs<=notBeforeMs||afterAtMs<notBeforeMs||afterAtMs>=expiresAtMs)fail();
 const value=Object.freeze({scope,sourceId:projection.sourceId,instanceId:projection.instanceId,sourceGeneration,pkA:new Uint8Array(pqHexBytes(r.pkA,2592)).buffer,pkB:new Uint8Array(pqHexBytes(r.pkB,64)).buffer});
 const previousCanonical=sourceCanonicalV2({sequence:projection.sequence,floor:projection.floor,head:projection.head,timeFloor:projection.timeFloor,executionHeight:projection.executionHeight});if(utf8.encode(previousCanonical).length>4096)fail();
 return Object.freeze({kind:4,value,window:Object.freeze({notBeforeMs,expiresAtMs}),namespace:null,accountComparisonDATA:null,previousCanonical,dataOnly:true,RootAdmission:false,SourceAdmission:false,nativeAdmission:false,platformRuntimeVerified:false});
}
