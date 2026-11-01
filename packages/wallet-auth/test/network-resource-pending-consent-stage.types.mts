import{prepareOriginalNetworkPendingConsentStageV1DATA as prepare,readOriginalNetworkPendingConsentStatementV1DATA as read,type OriginalNetworkPendingConsentInputV1,type OriginalNetworkPendingConsentStageV1DATA}from'../native/original-network-resource-pending-consent-v1.mjs';
import{openOriginalNetworkPendingConsentSourceV1 as open}from'../native/original-network-resource-pending-source-factory.mjs';
import type{NetworkResourceOriginalsV1}from'../native/original-network-resource-source-v2-contract.mjs';
declare const input:OriginalNetworkPendingConsentInputV1;declare const stage:OriginalNetworkPendingConsentStageV1DATA;
prepare(input);read(stage);open();
// @ts-expect-error no DTO or approval boolean can forge opaque staged DATA
const fake:OriginalNetworkPendingConsentStageV1DATA={approved:true};
// @ts-expect-error no callback/provider/Root row argument on fixed Source factory
open({stage,approved:true});
// @ts-expect-error principal member is forbidden, not optional/empty
const signed:OriginalNetworkPendingConsentInputV1={...input,principalMapping:{...input.principalMapping,memberOriginal:new Uint8Array()}};
// @ts-expect-error pending DATA stage is not execution13 originals
const execution:NetworkResourceOriginalsV1=stage;
// @ts-expect-error pending preparation input is not its opaque staged result
read(input);
void[fake,signed,execution];
