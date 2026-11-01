import {openOriginalProductSessionDeviceV4PendingProofClient,type OriginalProductDeviceV4PendingOperation} from '../src/original-product-device-v4-pending-client.js';
import type {OriginalProductSessionDeviceProofOperationV4} from '../src/product-session-device-v4.js';
declare const controller:AbortController;
const client=await openOriginalProductSessionDeviceV4PendingProofClient();
const context=Object.freeze({signal:controller.signal});
const registration=await client.produceRegistrationProof(context);
const original:OriginalProductDeviceV4PendingOperation<'registration-pop'>=registration;
const size:string=original.readOriginalStatus().reportedLengthExact;
const unauthorized:false=original.readOriginalStatus().authorized;
const noManagement:false=client.capabilities.management;
const current:undefined=client.assertCurrent();
// @ts-expect-error There is no caller Source/JSON/provider/key selection input.
openOriginalProductSessionDeviceV4PendingProofClient({provider:'software'});
// @ts-expect-error A raw message is not an original AbortContext.
client.produceRegistrationProof(new Uint8Array());
// @ts-expect-error Pending registration is not a challenge-completion operation.
const challenge:OriginalProductDeviceV4PendingOperation<'challenge-completion'>=registration;
// @ts-expect-error A pending proof is not an existing-session GET proof operation.
const get:OriginalProductSessionDeviceProofOperationV4=registration;
// @ts-expect-error The API deliberately has no management producer/domain.
client.produceManagementProof(context);
// @ts-expect-error Client capabilities are readonly and cannot grant a session.
client.capabilities.newSession=true;
controller.abort();client.retire();await client.join();await client.close();
void [original,size,unauthorized,noManagement,current,challenge,get];
