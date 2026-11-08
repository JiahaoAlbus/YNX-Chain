// A DISTINCT compiled private pending-only Source role. No creation/primary/query grant.
import{inspectOriginalProductDeviceV4PendingScopeDATA,PRODUCT_DEVICE_V4_PENDING_PURPOSE as PURPOSE,PRODUCT_DEVICE_V4_PENDING_OPERATIONS as operations}from'./original-product-device-v4-pending-scope-data-core.mjs';
const rule=Object.freeze({field:'productSessionDeviceV4Pending',operations,headError:'AUTH_SOURCE_V2_DEVICE_PENDING_HEAD',inspect:inspectOriginalProductDeviceV4PendingScopeDATA});
function inspectRuntimeBinding(){throw Object.assign(Error('AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE'),{code:'AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE'});}
export const pendingDeviceScopeRegistry=Object.freeze({platformRole:'android-source-private-v1',has:p=>p===PURPOSE,entry:p=>p===PURPOSE?rule:undefined,inspectRuntimeBinding});
