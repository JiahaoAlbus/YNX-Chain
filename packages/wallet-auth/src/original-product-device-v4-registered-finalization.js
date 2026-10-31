// Sole fixed-image, zero-DTO Native acquisition. No Source installer, expected
// values, key generation, path/provider selection or automatic retry.
import{types}from'node:util';
import{loadOriginalAuthIdentityNativeImage}from'./original-auth-identity-fixed-native-image.js';
const fail=code=>{throw Object.assign(Error(code),{code})};
export function acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource(...args){
 if(args.length)fail('DEVICE_REGISTERED_FINALIZATION_ZERO_INPUT');
 const image=loadOriginalAuthIdentityNativeImage();if(!image||types.isProxy(image))fail('DEVICE_REGISTERED_FINALIZATION_NATIVE_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptor(image,'acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource');
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('DEVICE_REGISTERED_FINALIZATION_NATIVE_NOT_SUPPLIED');
 // Return the actual Native envelope unchanged: adopt owner BEFORE inspecting
 // error, including false/0/null/undefined. Never reconstruct an opaque owner.
 // Any thrown original/partial is deliberately propagated without translation.
 return d.value.call(image);
}
