import{NETWORK_CURRENT_PUBLISHER_OPERATIONS,type NetworkCurrentPublisherScopeV1DATA}from'../native/original-network-current-publisher-source-contract.mjs';
import{acquireOriginalNetworkResourceCurrentPublisherReferenceV1,readOriginalNetworkResourceCurrentPublisherReferenceV1,assertOriginalNetworkResourceCurrentPublisherReferenceV1,type OriginalNetworkResourceCurrentPublisherReferenceV1}from'../native/original-network-current-publisher-reference-private.mjs';
const op:'resource.current.publish'=NETWORK_CURRENT_PUBLISHER_OPERATIONS[0];void op;
// @ts-expect-error no request/provider/path argument
acquireOriginalNetworkResourceCurrentPublisherReferenceV1({});
// @ts-expect-error caller DTO cannot brand capture
readOriginalNetworkResourceCurrentPublisherReferenceV1({});
// @ts-expect-error caller callback cannot supply Source
assertOriginalNetworkResourceCurrentPublisherReferenceV1(()=>true);
// @ts-expect-error no constructing opaque original reference from lifecycle alone
const fake:OriginalNetworkResourceCurrentPublisherReferenceV1={retire:async()=>{},join:async()=>{},close:async()=>{}};void fake;
// @ts-expect-error resource execution is outside publisher-only operation
const wrong:NetworkCurrentPublisherScopeV1DATA['operation']='resource.public-block-histogram';void wrong;

import{acquireOriginalNetworkResourceCurrentPublisherNormalV1}from'../native/original-network-current-publisher-loader-private.mjs';
async function discriminant(){const r=await acquireOriginalNetworkResourceCurrentPublisherNormalV1();if(!r.errorPresent){r.owner.publishOnce();const ok:null=r.error;void ok;}else{
// @ts-expect-error failure inventory is not guaranteed to be a ready publisher
r.owner.publishOnce();
}}void discriminant;
