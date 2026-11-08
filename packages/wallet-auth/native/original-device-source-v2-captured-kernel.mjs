// Original three-purpose static composition, same captured pipeline body.
import{makeCapturedDeviceCollectorFromFixedParts}from'./original-device-source-v2-captured-pipeline.mjs';
import{projectVerifiedDeviceSourceCapturedDATA as project}from'./original-device-source-v2-typed-projection.mjs';
import{PRODUCT_DEVICE_V4_SOURCE_PURPOSE as PRIMARY,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE as PROVISION,PRODUCT_DEVICE_V4_QUERY_PURPOSE as QUERY}from'./original-source-device-family-constants.mjs';
const purposes=Object.freeze([PRIMARY,PROVISION,QUERY]);
export function makeCapturedDeviceCollectorFromFixedKernel(kernel){return makeCapturedDeviceCollectorFromFixedParts(Object.freeze({kernel,purposes,project}));}
