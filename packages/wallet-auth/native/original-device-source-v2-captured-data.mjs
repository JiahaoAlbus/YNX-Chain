// Original Node entry: same closed API, shared sole Source pipeline.
import{originalDeviceSourceV2NodeKernel}from'./original-auth-source-v2-device-node.mjs';
import{makeCapturedDeviceCollectorFromFixedKernel}from'./original-device-source-v2-captured-kernel.mjs';
export const collectOriginalDeviceSourceV2CapturedDATA=makeCapturedDeviceCollectorFromFixedKernel(originalDeviceSourceV2NodeKernel);
