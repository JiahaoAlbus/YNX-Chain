// Node public entry keeps its original Proxy/accessor guards. The sole DATA
// grammar/view brand lives in the shared core, also used by private SOURCE JSON.
import{types}from'node:util';
import{WalletAuthError}from'./canonical.js';
import*as core from'./original-device-create-intent-data-core.js';
export{DEVICE_CREATE_INTENT_DOMAIN,DEVICE_CREATE_IDENTITY_DOMAIN,DEVICE_PROVISIONING_SOURCE_PURPOSE}from'./original-device-create-intent-data-core.js';
const fail=()=>{throw new WalletAuthError('DEVICE_CREATE_INTENT_DATA_INVALID','Original device creation intent DATA is invalid')};
function plain(v,keys){if(!v||typeof v!=='object'||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);if(names.length!==keys.length||names.some(n=>typeof n!=='string')||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();}
function bytes(v){if(types.isProxy(v)||!types.isUint8Array(v))fail();}
export function createOriginalDeviceCreateIntentDATA(v){plain(v,core.ORIGINAL_DEVICE_CREATE_DATA_FIELDS.input);return core.createOriginalDeviceCreateIntentDATA(v);}
export function inspectOriginalDeviceCreateIntentDATA(v){bytes(v);return core.inspectOriginalDeviceCreateIntentDATA(v);}
export function assertOriginalDeviceCreateSelectionDATA(view,independent){core.assertOriginalDeviceCreateViewDATA(view);plain(independent,core.ORIGINAL_DEVICE_CREATE_DATA_FIELDS.stable);return core.assertOriginalDeviceCreateSelectionDATA(view,independent);}
export function assertOriginalDeviceCreateIntentUnchangedDATA(a,b){return core.assertOriginalDeviceCreateIntentUnchangedDATA(a,b);}
export function createOriginalDeviceIdentityDATA(v){plain(v,core.ORIGINAL_DEVICE_CREATE_DATA_FIELDS.identity);return core.createOriginalDeviceIdentityDATA(v);}
export function inspectOriginalDeviceIdentityDATA(v,app){bytes(v);plain(app,core.ORIGINAL_DEVICE_CREATE_DATA_FIELDS.application);return core.inspectOriginalDeviceIdentityDATA(v,app);}
