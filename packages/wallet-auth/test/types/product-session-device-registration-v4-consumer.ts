import {parseProductSessionDeviceRegistrationV4Data,inspectProductSessionDeviceRegistrationOriginalV4Data,inspectProductSessionHTTPProofForDeviceRecordV4Data,type ProductSessionDeviceRegistrationV4} from '../../src/product-session-device-registration-v4.js';
import type {ProductSessionHTTPProofV4Unsigned} from '../../src/product-session-proof-v4.js';
declare const record:ProductSessionDeviceRegistrationV4;declare const unsigned:ProductSessionHTTPProofV4Unsigned;
const original=new Uint8Array(),d=inspectProductSessionDeviceRegistrationOriginalV4Data(original),r=inspectProductSessionHTTPProofForDeviceRecordV4Data('',original,{networkId:record.networkId,unsigned,at:'2026-10-26T00:00:00.000Z'});
const noGrant:false=d.registered;const generation:string=d.record.generation;const math:true=r.signatureVerified;void[noGrant,generation,math,parseProductSessionDeviceRegistrationV4Data(record)];
// @ts-expect-error Generation is original positive U64 text, not a JS Number.
record.generation=1;
// @ts-expect-error Public record data never implies active registration.
const grant:true=d.current;
// @ts-expect-error Exact independently selected request and authority time are required.
inspectProductSessionHTTPProofForDeviceRecordV4Data('',original,{networkId:record.networkId,unsigned});
// @ts-expect-error No public activity flag can grant an original Source.
inspectProductSessionHTTPProofForDeviceRecordV4Data('',original,{networkId:record.networkId,unsigned,at:'',active:true});
void grant;
