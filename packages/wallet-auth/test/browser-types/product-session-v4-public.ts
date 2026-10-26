import {inspectProductSessionHTTPProofV4Data,encodeProductSessionHTTPProofV4Message,type ProductSessionHTTPProofV4Expected} from '@ynx-chain/wallet-auth/product-session-proof-v4';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '@ynx-chain/wallet-auth/product-session-device-registration-v4';
declare const member:Uint8Array,expected:ProductSessionHTTPProofV4Expected;
const proof=inspectProductSessionHTTPProofV4Data(member,expected);
const message:Uint8Array=encodeProductSessionHTTPProofV4Message(expected.unsigned,expected.networkId);
const record=inspectProductSessionDeviceRegistrationOriginalV4Data(message);
// @ts-expect-error Public proof DATA never grants authority.
const approved:true=proof.authorized;
// @ts-expect-error Original record DATA never grants registration.
const registered:true=record.registered;
// @ts-expect-error Browser closure has no ambient Node Buffer.
Buffer.from(member);
void [approved,registered];
