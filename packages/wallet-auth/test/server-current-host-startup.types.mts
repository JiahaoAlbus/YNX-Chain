import {ProductSessionGatewayNodeHost,type ProductSessionGatewayNodeHostOptions,type OriginalAccountPolicyBinaryV5Runner} from '../src/product-session-gateway-node-host.js';
import {openOriginalDeviceV4ServerCurrentBeforeHost,originalDeviceV4ServerCurrentHostOptions,originalDeviceV4ServerCurrentStartupStatus,closeOriginalDeviceV4ServerCurrentAfterHost,drainOriginalDeviceV4ServerCurrentPartial} from '../scripts/original-device-v4-server-current-launcher.mjs';
import {acquireOriginalProductSessionDeviceV4ServerCurrent,assertOriginalProductSessionDeviceV4ServerCurrentResult} from '../src/product-pair-session-v4-source.js';
declare const registry:unknown;
declare const originalOptions:ProductSessionGatewayNodeHostOptions;
const result=await acquireOriginalProductSessionDeviceV4ServerCurrent();
const ownedPartial=result.owner; // retain before testing any error or guard
void ownedPartial;
const actual=assertOriginalProductSessionDeviceV4ServerCurrentResult(result);
new ProductSessionGatewayNodeHost(registry,{...originalOptions,deviceCurrent:actual.deviceCurrent});
const startup=await openOriginalDeviceV4ServerCurrentBeforeHost();
new ProductSessionGatewayNodeHost(registry,{...originalOptions,...originalDeviceV4ServerCurrentHostOptions(startup)});
const closed:Promise<void>=closeOriginalDeviceV4ServerCurrentAfterHost(startup);
const drain:Promise<void>=drainOriginalDeviceV4ServerCurrentPartial(startup);
void closed;void drain;
// @ts-expect-error caller Root/provider is not an acquisition operand
await openOriginalDeviceV4ServerCurrentBeforeHost({approved:true});
// @ts-expect-error structural metadata is not original startup custody
originalDeviceV4ServerCurrentHostOptions({});
// @ts-expect-error this DATA status cannot assert Root qualification
const granted:true=originalDeviceV4ServerCurrentStartupStatus(startup).configured;
void granted;
// @ts-expect-error a server-current startup ref is not a signer
startup.sign(new Uint8Array());
declare const accountCurrent:OriginalAccountPolicyBinaryV5Runner;
// @ts-expect-error independent account-current runner is not deviceCurrent
new ProductSessionGatewayNodeHost(registry,{...originalOptions,deviceCurrent:accountCurrent});
