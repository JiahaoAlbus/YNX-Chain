// Fixed Node composition of the existing six DEVICE families. Not selected by
// an input/module/provider argument. Private SOURCE build binds its fixed3 file.
import{inspectOriginalProductDeviceV4SourceScopeDATA as primary}from'./original-product-device-v4-source-contract.mjs';
import{inspectOriginalProductDeviceV4ProvisioningScopeDATA as provision}from'./original-product-device-v4-provisioning-source-contract.mjs';
import{inspectOriginalProductDeviceV4QueryScopeDATA as query}from'./original-product-device-v4-query-source-contract.mjs';
import{inspectOriginalProductDeviceV4PendingScopeDATA as pending}from'./original-product-device-v4-pending-source-contract.mjs';
import{inspectOriginalProductDeviceV4RegisteredFinalizationScopeDATA as finalization}from'./original-product-device-v4-registered-finalization-source-contract.mjs';
import{inspectOriginalProductSessionHTTPProofV5SourceScopeDATA as http}from'./original-product-session-http-v5-source-contract.mjs';
import{inspectOriginalAuthRuntimeImageBindingV1DATA as inspectRuntimeBinding}from'./original-auth-runtime-image-binding-v1.mjs';
const entries=Object.freeze({
 'product-session-device-source-v4':Object.freeze({field:'productSessionDeviceV4',operations:Object.freeze(['device.current','device.http-proof']),headError:'AUTH_SOURCE_V2_DEVICE_HEAD',inspect:primary}),
 'product-session-device-provisioning-source-v4':Object.freeze({field:'productSessionDeviceV4Provisioning',operations:Object.freeze(['device.creation-prepare','device.original-query']),headError:'AUTH_SOURCE_V2_DEVICE_PROVISIONING_HEAD',inspect:provision}),
 'product-session-device-query-source-v4':Object.freeze({field:'productSessionDeviceV4Query',operations:Object.freeze(['device.original-query']),headError:'AUTH_SOURCE_V2_DEVICE_QUERY_HEAD',inspect:query}),
 'product-session-device-pending-source-v4':Object.freeze({field:'productSessionDeviceV4Pending',operations:Object.freeze(['device.registration-pop','device.challenge-completion']),headError:'AUTH_SOURCE_V2_DEVICE_PENDING_HEAD',inspect:pending}),
 'product-session-device-registered-finalization-source-v4':Object.freeze({field:'productSessionDeviceV4RegisteredFinalization',operations:Object.freeze(['device.registered-finalize']),headError:'AUTH_SOURCE_V2_DEVICE_REGISTERED_FINALIZATION_HEAD',inspect:finalization}),
 'product-session-device-http-binary-source-v5':Object.freeze({field:'productSessionHTTPProofV5',operations:Object.freeze(['device.current','device.http-proof-v5']),headError:'AUTH_SOURCE_V2_HTTP_V5_HEAD',inspect:http})});
export const deviceScopeRegistry=Object.freeze({has:purpose=>Object.hasOwn(entries,purpose),entry:purpose=>entries[purpose],inspectRuntimeBinding});
