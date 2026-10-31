import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
// One fixed implementing image, shared by joint and device consumers.
// No provider, endpoint, path input or public loader setter.
const requireOriginal=createRequire(import.meta.url);
export const loadOriginalAuthIdentityNativeImage=()=>requireOriginal(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
const failure=code=>Object.assign(new Error(code),{code});
export function acquireOriginalProductSessionDeviceV4SourceStage(...args){
 if(args.length)throw failure('PRODUCT_DEVICE_V4_SOURCE_ARGUMENTS_INVALID');
 let native;try{native=loadOriginalAuthIdentityNativeImage();}catch(cause){throw Object.assign(failure('PRODUCT_DEVICE_V4_NATIVE_SOURCE_STAGE_NOT_SUPPLIED'),{cause});}
 const descriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4Source');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('PRODUCT_DEVICE_V4_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
 // Do not translate Native failure: preserve SAME error and its actual partial.
 return descriptor.value.call(native);
}
// Same fixed image and independent provisioning Source; never a keygen or
// approval alias for the original registered-device HTTP Source above.
export function acquireOriginalProductSessionDeviceV4ProvisioningSourceStage(...args){
 if(args.length)throw failure('DEVICE_PROVISIONING_SOURCE_ZERO_INPUT');
 let native;try{native=loadOriginalAuthIdentityNativeImage();}catch(cause){throw Object.assign(failure('DEVICE_PROVISIONING_NATIVE_SOURCE_STAGE_NOT_SUPPLIED'),{cause});}
 const descriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4ProvisioningSource');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('DEVICE_PROVISIONING_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
 // Preserve SAME Native error/partial: no fallback, retry, or DTO adapter.
 return descriptor.value.call(native);
}
// Independent cold-query Source. No creation terms, approval, registration,
// network recovery, provider input or writable journal capability is accepted.
export function acquireOriginalProductSessionDeviceV4QuerySourceStage(...args){
 if(args.length)throw failure('DEVICE_QUERY_SOURCE_ZERO_INPUT');
 let native;try{native=loadOriginalAuthIdentityNativeImage();}catch(cause){throw Object.assign(failure('DEVICE_QUERY_NATIVE_SOURCE_STAGE_NOT_SUPPLIED'),{cause});}
 const descriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4QuerySource');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('DEVICE_QUERY_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
 // Retain the exact thrown value and its partial; never translate a Native
 // Source failure into ABSENT, regenerate a device, or reopen the Source.
 return descriptor.value.call(native);
}
