import {acquireOriginalProductSessionDeviceV4SourceStage as acquireNative} from './original-auth-identity-private-joint-registration.js';
/** Fixed original image only. This consumer preserves actual Native held values
 * and original AbortContext. It supplies no key, proof producer or permission. */
export function acquireOriginalProductSessionDeviceV4SourceStage(...args){
 if(args.length)throw Object.assign(new Error('PRODUCT_DEVICE_V4_SOURCE_ARGUMENTS_INVALID'),{code:'PRODUCT_DEVICE_V4_SOURCE_ARGUMENTS_INVALID'});
 const native=acquireNative(); // Preserve the original error and its actual .partial.
 return Object.freeze({
  async readCurrent(...values){return native.readCurrent(...values);},
  assertCurrent(...values){return native.assertCurrent(...values);},
  readRegistrationOriginal(...values){return native.readRegistrationOriginal(...values);},
  readSessionOriginal(...values){return native.readSessionOriginal(...values);},
  readContext(...values){return native.readContext(...values);},
  retire(...values){return native.retire(...values);},join(...values){return native.join(...values);},close(...values){return native.close(...values);},status(...values){return native.status(...values);}
 });
}
