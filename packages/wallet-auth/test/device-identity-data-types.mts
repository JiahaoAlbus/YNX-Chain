import{createOriginalDeviceIdentityDATA,inspectOriginalDeviceIdentityDATA,type OriginalDeviceIdentityInputDATA,type OriginalDeviceApplicationBindingDATA}from'../src/original-device-create-intent.js';
declare const input:OriginalDeviceIdentityInputDATA,app:OriginalDeviceApplicationBindingDATA,raw:Uint8Array;
const view=createOriginalDeviceIdentityDATA(input);inspectOriginalDeviceIdentityDATA(raw,app);const falseFlag:false=view.currentVerified;
// @ts-expect-error Original bytes required, not JSON string.
inspectOriginalDeviceIdentityDATA(view.stableDeviceIdentity,app);
// @ts-expect-error Independent application tuple is required.
inspectOriginalDeviceIdentityDATA(raw);
// @ts-expect-error A new operation cannot alter the query slot.
createOriginalDeviceIdentityDATA({...input,operationId:'new-operation'});
// @ts-expect-error Query DATA is not a Native creation intent.
view.nativeIntentDATA;
// @ts-expect-error Query DATA never grants authority.
const approved:true=view.userApproved;
