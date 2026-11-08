// Node compatibility facade; pending grammar lives in the sole shared core.
import{types}from'node:util';
import{inspectOriginalProductDeviceV4PendingScopeDATA as inspect}from'./original-product-device-v4-pending-scope-data-core.mjs';
export{PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PENDING_OPERATIONS}from'./original-product-device-v4-pending-scope-data-core.mjs';
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_DEVICE_PENDING_SCOPE'),{code:'AUTH_SOURCE_V2_DEVICE_PENDING_SCOPE'});};
function own(v){if(!v||typeof v!=='object'||types.isProxy(v))fail();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!Object.hasOwn(d[k],'value')))fail();return d;}
export function inspectOriginalProductDeviceV4PendingScopeDATA(scope,association,...args){const d=own(scope);own(d.expected?.value);own(association);return inspect(scope,association,...args);}
