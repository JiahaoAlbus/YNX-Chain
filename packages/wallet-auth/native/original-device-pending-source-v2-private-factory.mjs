import{createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA,createOriginalDeviceRegistrationPublicOriginalsDATA}from'./original-device-registration-public-originals-private.mjs';
// DISTINCT pending-only immutable compile entry. Auth/P02 confirmed kind4.
// Capture JSON cannot choose another role.
import{createOriginalPendingDeviceSourceV2PrivateKernel}from'./original-auth-source-v2-pending-private.mjs';
import{makeCapturedDeviceCollectorFromFixedParts}from'./original-device-source-v2-captured-pipeline.mjs';
import{projectVerifiedPendingDeviceSourceCapturedDATA as project}from'./original-device-pending-source-v2-typed-projection.mjs';
import{PRODUCT_DEVICE_V4_PENDING_PURPOSE}from'./original-product-device-v4-pending-scope-data-core.mjs';
import{inspectOriginalDeviceCreateIntentDATA,ORIGINAL_DEVICE_CREATE_IDENTITY_INPUT_FIELDS}from'../src/original-device-create-intent-data-core.js';
import{SourceUTF8Encoder}from'./original-source-private-utf8.mjs';
const identityUTF8=new SourceUTF8Encoder();
function inspectOriginalDeviceCreationIdentityDATA(originalIntentString){if(arguments.length!==1||typeof originalIntentString!=='string')throw Object.assign(Error('DEVICE_CREATE_INTENT_DATA_INVALID'),{code:'DEVICE_CREATE_INTENT_DATA_INVALID'});const original=identityUTF8.encode(originalIntentString);if(!original.length||original.length>16384)throw Object.assign(Error('DEVICE_CREATE_INTENT_DATA_INVALID'),{code:'DEVICE_CREATE_INTENT_DATA_INVALID'});const view=inspectOriginalDeviceCreateIntentDATA(original);if(view.approvedTerms!==originalIntentString)throw Object.assign(Error('DEVICE_CREATE_INTENT_DATA_INVALID'),{code:'DEVICE_CREATE_INTENT_DATA_INVALID'});return Object.freeze({identityBinding:Object.freeze(Object.fromEntries(ORIGINAL_DEVICE_CREATE_IDENTITY_INPUT_FIELDS.map(k=>[k,view.terms[k]]))),generation:view.terms.generation,stableDeviceIdentity:view.stableDeviceIdentity,approvedTerms:view.approvedTerms,dataOnly:true,userApproved:false,SourceAdmission:false,NativeAdmission:false});}
const purposes=Object.freeze([PRODUCT_DEVICE_V4_PENDING_PURPOSE]);
export default function originalPendingDeviceSourceV2PrivateFactory(nativeObject){if(arguments.length!==1)throw Object.assign(Error('SOURCE_FIXED_FACTORY_ARGUMENTS'),{code:'SOURCE_FIXED_FACTORY_ARGUMENTS'});const collect=makeCapturedDeviceCollectorFromFixedParts(Object.freeze({kernel:createOriginalPendingDeviceSourceV2PrivateKernel(nativeObject),purposes,project}));Object.defineProperty(collect,'inspectOriginalDeviceCreationIdentityDATA',{value:inspectOriginalDeviceCreationIdentityDATA});Object.defineProperties(collect,{
  createOriginalDeviceRegistrationPublicOriginalsDATA:{value:createOriginalDeviceRegistrationPublicOriginalsDATA},
  createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA:{value:createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA},
});return Object.freeze(collect);}
