import type{OriginalAuthSourceV2Service,OriginalAuthSourceV2Operations}from'../native/original-auth-identity-source-v2-verifier.mjs';
import{PRODUCT_DEVICE_MANAGEMENT_V4_SOURCE_PURPOSE,inspectOriginalProductDeviceV4ManagementScopeDATA}from'../native/management-source-contract.mjs';
const purpose:OriginalAuthSourceV2Service=PRODUCT_DEVICE_MANAGEMENT_V4_SOURCE_PURPOSE;
const ops:OriginalAuthSourceV2Operations=['session.active','session.revoke','challenge.cancel','completion.recover'];
const inspect:typeof inspectOriginalProductDeviceV4ManagementScopeDATA=inspectOriginalProductDeviceV4ManagementScopeDATA;void[purpose,ops,inspect];
// @ts-expect-error unrelated capability cannot become management operation
const bad:import('../native/management-source-contract.mjs').ManagementOperation='device.http-proof';void bad;
