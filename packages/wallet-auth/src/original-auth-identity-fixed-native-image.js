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
