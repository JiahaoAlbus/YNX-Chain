import{acquireOriginalProductSessionDeviceV4ServerCurrent,assertOriginalProductSessionDeviceV4ServerCurrentOwner}from'../src/product-pair-session-v4-source.js';
import type{ProductSessionGatewayNodeHostOptions}from'../src/product-session-gateway-node-host.js';
import type{ProductSessionDeviceCurrentExpectedV4,ProductSessionDeviceAbortContextV4}from'../src/product-session-device-v4.js';
const r=await acquireOriginalProductSessionDeviceV4ServerCurrent();
if(r.error===null&&r.deviceCurrent){const owner=assertOriginalProductSessionDeviceV4ServerCurrentOwner(r.owner),options:ProductSessionGatewayNodeHostOptions={now:()=>new Date(),statePath:'/PUBLIC/types-only/state.json',tokenFactory:()=>'',deviceCurrent:owner.deviceCurrent};declareExpected(options);owner.retire();await owner.join();await owner.close();}
declare function declareExpected(v:ProductSessionGatewayNodeHostOptions):void;
declare const expected:ProductSessionDeviceCurrentExpectedV4,ctx:ProductSessionDeviceAbortContextV4;
const owner=assertOriginalProductSessionDeviceV4ServerCurrentOwner(r.owner),held=await owner.deviceCurrent.readCurrent(expected,ctx);await owner.deviceCurrent.assertCurrent(held,ctx);
// @ts-expect-error no caller Source/Root/provider selection
acquireOriginalProductSessionDeviceV4ServerCurrent({approved:true});
// @ts-expect-error DTO cannot replace an owned current original
owner.deviceCurrent.readSessionOriginal({approved:true});
// @ts-expect-error whole context object is required, not a bare abort signal
owner.deviceCurrent.readCurrent(expected,ctx.signal);
// @ts-expect-error server Source cannot be a device signer
owner.deviceCurrent.produceHTTPProof({});
