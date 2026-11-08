// SOURCE-only compiled3 role. This is not an input-selected registry/provider.
// Other DEVICE families remain in the original Node composition unchanged.
import{inspectOriginalProductDeviceV4SourceScopeDATA as originalPrimary}from'./original-product-device-v4-scope-data-core.mjs';
import{inspectOriginalProductDeviceV4ProvisioningScopeDATA as provision}from'./original-product-device-v4-provisioning-source-contract.mjs';
import{inspectOriginalProductDeviceV4QueryScopeDATA as query}from'./original-product-device-v4-query-source-contract.mjs';
import{PRODUCT_DEVICE_V4_SOURCE_PURPOSE as PRIMARY,PRODUCT_DEVICE_V4_SOURCE_OPERATIONS as PRIMARY_OPS,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE as PROVISION,PRODUCT_DEVICE_V4_PROVISIONING_OPERATIONS as PROVISION_OPS,PRODUCT_DEVICE_V4_QUERY_PURPOSE as QUERY,PRODUCT_DEVICE_V4_QUERY_OPERATIONS as QUERY_OPS}from'./original-source-device-family-constants.mjs';
import registry from'../product-session-registry.json'with{type:'json'};
import{productPlatformBinding}from'./original-source-finite-product-registry.mjs';
// Explicit private image role fence; the general Node scope remains unchanged.
function primary(scope,...rest){const b=productPlatformBinding(registry,scope.expected.productId,scope.expected.platform);for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'])if(scope.expected[k]!==b[k])throw Object.assign(Error('SOURCE_PRODUCT_ROLE_NOT_SUPPORTED'),{code:'SOURCE_PRODUCT_ROLE_NOT_SUPPORTED'});return originalPrimary(scope,...rest);}
const entries=Object.freeze({[PRIMARY]:Object.freeze({field:'productSessionDeviceV4',operations:PRIMARY_OPS,headError:'AUTH_SOURCE_V2_DEVICE_HEAD',inspect:primary}),[PROVISION]:Object.freeze({field:'productSessionDeviceV4Provisioning',operations:PROVISION_OPS,headError:'AUTH_SOURCE_V2_DEVICE_PROVISIONING_HEAD',inspect:provision}),[QUERY]:Object.freeze({field:'productSessionDeviceV4Query',operations:QUERY_OPS,headError:'AUTH_SOURCE_V2_DEVICE_QUERY_HEAD',inspect:query})});
// Existing image-binding policy permits only finalization/http/WPR, none of
// this compiled3. Preserve that ORIGINAL purpose rejection before body access.
function inspectRuntimeBinding(_value,purpose){if(Object.hasOwn(entries,purpose))throw Object.assign(Error('AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE'),{code:'AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE'});throw Object.assign(Error('SOURCE_DEVICE_FAMILY_NOT_REGISTERED'),{code:'SOURCE_DEVICE_FAMILY_NOT_REGISTERED'});}
export const deviceScopeRegistry=Object.freeze({has:purpose=>Object.hasOwn(entries,purpose),entry:purpose=>entries[purpose],inspectRuntimeBinding});
