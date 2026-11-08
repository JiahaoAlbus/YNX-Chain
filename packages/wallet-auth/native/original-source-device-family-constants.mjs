// Existing DEVICE Source-v2 constants moved into the SOURCE-only dependency
// boundary. No new Root purpose, operation, platform or capability is created.
export const PRODUCT_DEVICE_V4_SOURCE_PURPOSE='product-session-device-source-v4';
export const PRODUCT_DEVICE_V4_SOURCE_OPERATIONS=Object.freeze(['device.current','device.http-proof']);
export const PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE='product-session-device-provisioning-source-v4';
export const PRODUCT_DEVICE_V4_PROVISIONING_OPERATIONS=Object.freeze(['device.creation-prepare','device.original-query']);
export const PRODUCT_DEVICE_V4_QUERY_PURPOSE='product-session-device-query-source-v4';
export const PRODUCT_DEVICE_V4_QUERY_OPERATIONS=Object.freeze(['device.original-query']);
