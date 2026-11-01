import{createOriginalDeviceCreateIntentDATA,inspectOriginalDeviceCreateIntentDATA,assertOriginalDeviceCreateSelectionDATA,assertOriginalDeviceCreateIntentUnchangedDATA}from'@ynx-chain/wallet-auth/original-device-create-intent';
import type{OriginalDeviceCreateIntentInputDATA,OriginalDeviceCreateSelectionDATA}from'@ynx-chain/wallet-auth/original-device-create-intent';
declare const input:OriginalDeviceCreateIntentInputDATA,expected:OriginalDeviceCreateSelectionDATA,bytes:Uint8Array;
const intent=createOriginalDeviceCreateIntentDATA(input),decoded=inspectOriginalDeviceCreateIntentDATA(bytes);
const falseApproval:false=intent.userApproved,falseSource:false=assertOriginalDeviceCreateSelectionDATA(intent,expected).SourceAdmission;
assertOriginalDeviceCreateIntentUnchangedDATA(intent,decoded);const ms:string=intent.nativeIntentDATA.expiresAtMs;
// @ts-expect-error creation DATA is not a real approval
const approved:true=intent.userApproved;
// @ts-expect-error generation is not the immutable device identity slot
intent.nativeIntentDATA.stableDeviceGeneration;
// @ts-expect-error binary inspector accepts original bytes, not JSON DTO
inspectOriginalDeviceCreateIntentDATA(input);
// @ts-expect-error canonical generation cannot be a JS number
createOriginalDeviceCreateIntentDATA({...input,generation:1});
void [falseApproval,falseSource,ms,approved];
