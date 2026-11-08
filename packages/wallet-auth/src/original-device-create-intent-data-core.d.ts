export{DEVICE_CREATE_INTENT_DOMAIN,DEVICE_CREATE_IDENTITY_DOMAIN,DEVICE_PROVISIONING_SOURCE_PURPOSE,createOriginalDeviceCreateIntentDATA,inspectOriginalDeviceCreateIntentDATA,assertOriginalDeviceCreateSelectionDATA,assertOriginalDeviceCreateIntentUnchangedDATA,createOriginalDeviceIdentityDATA,inspectOriginalDeviceIdentityDATA}from'./original-device-create-intent.js';
export const ORIGINAL_DEVICE_CREATE_DATA_FIELDS:Readonly<{input:readonly string[];stable:readonly string[];identity:readonly string[];application:readonly string[]}>;
export function assertOriginalDeviceCreateViewDATA(view:unknown):void;

export const ORIGINAL_DEVICE_CREATE_IDENTITY_INPUT_FIELDS:readonly["networkId","canonicalOwner","account","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","deviceId"];
