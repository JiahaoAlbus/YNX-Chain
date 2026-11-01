import{captureOriginalNetworkPendingConsentOriginalsV1DATA as capture,assertOriginalNetworkPendingConsentOriginalsCurrentV1DATA as fence,type NetworkPendingConsentOriginalsV1}from'../native/original-network-resource-pending-source-contract.mjs';
import{captureOriginalNetworkResourceOriginalsV1DATA as execution}from'../native/original-network-resource-source-v2-contract.mjs';
declare const o:NetworkPendingConsentOriginalsV1;const c=capture(o);fence(c,o);
// @ts-expect-error execution13 requires actual principal member
execution(o);
// @ts-expect-error no principal member in Auth-locked pending13
const signed:NetworkPendingConsentOriginalsV1={...o,principalMapping:{...o.principalMapping,memberOriginal:new Uint8Array()}};
// @ts-expect-error opaque execution capture cannot become pending capture
fence(execution({...o,principalMapping:{...o.principalMapping,memberOriginal:new Uint8Array()}}));
// @ts-expect-error received DTO lacks independent SDK registered view brand
const dto:NetworkPendingConsentOriginalsV1={...o,principalRegistration:{owner:'x'}};
void[signed,dto];
