// DISTINCT pending-only immutable compile entry. Auth/P02 confirmed kind4.
// Capture JSON cannot choose another role.
import{createOriginalPendingDeviceSourceV2PrivateKernel}from'./original-auth-source-v2-pending-private.mjs';
import{makeCapturedDeviceCollectorFromFixedParts}from'./original-device-source-v2-captured-pipeline.mjs';
import{projectVerifiedPendingDeviceSourceCapturedDATA as project}from'./original-device-pending-source-v2-typed-projection.mjs';
import{PRODUCT_DEVICE_V4_PENDING_PURPOSE}from'./original-product-device-v4-pending-scope-data-core.mjs';
const purposes=Object.freeze([PRODUCT_DEVICE_V4_PENDING_PURPOSE]);
export default function originalPendingDeviceSourceV2PrivateFactory(nativeObject){if(arguments.length!==1)throw Object.assign(Error('SOURCE_FIXED_FACTORY_ARGUMENTS'),{code:'SOURCE_FIXED_FACTORY_ARGUMENTS'});return makeCapturedDeviceCollectorFromFixedParts(Object.freeze({kernel:createOriginalPendingDeviceSourceV2PrivateKernel(nativeObject),purposes,project}));}
