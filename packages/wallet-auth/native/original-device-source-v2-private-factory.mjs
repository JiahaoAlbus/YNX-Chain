// Fixed bundle evaluates to this private lexical factory, never a global
// setter/import loader. Native owns the provided immutable two-function object.
import{createOriginalDeviceSourceV2PrivateKernel}from'./original-auth-source-v2-device-private.mjs';
import{makeCapturedDeviceCollectorFromFixedKernel}from'./original-device-source-v2-captured-kernel.mjs';
export default function originalDeviceSourceV2PrivateFactory(nativeObject){if(arguments.length!==1)throw Object.assign(Error('SOURCE_FIXED_FACTORY_ARGUMENTS'),{code:'SOURCE_FIXED_FACTORY_ARGUMENTS'});return makeCapturedDeviceCollectorFromFixedKernel(createOriginalDeviceSourceV2PrivateKernel(nativeObject));}
