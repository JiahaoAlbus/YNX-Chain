import {collectOriginalDeviceSourceV2CapturedDATA,type CapturedDeviceSourcePolicyV2} from '../native/original-device-source-v2-captured-data.mjs';
const out=collectOriginalDeviceSourceV2CapturedDATA('canonical private captured DATA');const flag:false=out.SourceAdmission;const data:true=out.dataOnly;
declare const policy:CapturedDeviceSourcePolicyV2;
// @ts-expect-error input must be primitive canonical bytes, not DTO authority
collectOriginalDeviceSourceV2CapturedDATA({policy});
// @ts-expect-error no provider/clock/expected callback injection
collectOriginalDeviceSourceV2CapturedDATA('{}',()=>true);
