import {encodeProductSessionHTTPProofV4Message,inspectProductSessionHTTPProofV4Data,inspectProductSessionHTTPProofHeaderV4Data,encodeProductSessionProofHeaderV4,decodeProductSessionProofHeaderV4,type ProductSessionHTTPProofV4Expected} from '../../src/product-session-proof-v4.js';
declare const expected:ProductSessionHTTPProofV4Expected;
const wire=new Uint8Array(),m=encodeProductSessionHTTPProofV4Message(expected.unsigned,expected.networkId),h=encodeProductSessionProofHeaderV4(expected.unsigned,wire),r=inspectProductSessionHTTPProofV4Data(wire,expected);
const version:'4'=decodeProductSessionProofHeaderV4(h).version;const current:false=inspectProductSessionHTTPProofHeaderV4Data(h,expected).current;void[m,version,current];
// @ts-expect-error No implicit expected request or independently registered full pair.
inspectProductSessionHTTPProofV4Data(wire);
// @ts-expect-error Exact U64 revision strings, never rounded JS Number.
expected.unsigned.deviceRegistrationRevision=1;
// @ts-expect-error Math does not grant registration/current.
const grant:true=r.registered;
// @ts-expect-error A version4 proof cannot reinterpret version2 fields.
encodeProductSessionProofHeaderV4({...expected.unsigned,version:'2'},wire);
void grant;
