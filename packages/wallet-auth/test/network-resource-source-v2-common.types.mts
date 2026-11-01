import{captureOriginalNetworkResourceOriginalsV1DATA as capture,assertOriginalNetworkResourceOriginalsCurrentV1DATA as fence,decodeOriginalNetworkResourceOriginalsTransportV1DATA as decode,type NetworkResourceOriginalsV1,type NetworkResourceGoConsumerV1,type NetworkResourceSourceScopeV2,type NetworkResourceOriginalsNativeIOV1}from'../native/original-network-resource-source-v2-contract.mjs';
declare const o:NetworkResourceOriginalsV1;const c=capture(o);fence(c,o);
// @ts-expect-error DTO cannot impersonate branded registration/capture
fence(o);
// @ts-expect-error decoded transport never returns independent Native originals
capture(decode({}));
// @ts-expect-error all 13 exact originals are mandatory
capture({inputOriginal:new Uint8Array()});
// @ts-expect-error Go identity never Node compatibility
const wrongRuntime:NetworkResourceGoConsumerV1={runtimeKind:'node',appId:'x',productId:'network',platform:'macos',vnode:{device:'1',inode:'2'},imageSHA256:'a'};
declare const s:NetworkResourceSourceScopeV2;
// @ts-expect-error histogram contract cannot alias governance/stake/install
s.operation='governance.vote';
// @ts-expect-error synchronous typed owner getter cannot return Promise
const asyncGetter:NetworkResourceOriginalsNativeIOV1={readNetworkResourceOriginalsV1:async()=>o};
// @ts-expect-error DTO registration missing SDK unique brand
const dto:NetworkResourceOriginalsV1={...o,issuerRegistration:{...o.issuerRegistration,brand:true}};
void[c,wrongRuntime,asyncGetter,dto];
