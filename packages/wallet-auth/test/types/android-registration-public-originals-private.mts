import type { OriginalPendingCollectorWithCreationIdentityDATA } from '../../native/original-device-pending-source-v2-private-factory.mjs';

declare const collect: OriginalPendingCollectorWithCreationIdentityDATA;
declare const seed: string;
declare const intent: string;
declare const pkA: ArrayBuffer;
declare const pkB: ArrayBuffer;

const allocated = collect.createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA(seed);
const result = collect.createOriginalDeviceRegistrationPublicOriginalsDATA(
  intent, pkA, pkB, allocated.allocationOriginal,
);
const approved: false = allocated.userApproved;
const admitted: false = result.SourceAdmission;
const registered: false = result.registered;
const mainID: string = allocated.mainDeviceOperationId;
void [approved, admitted, registered, mainID];

// @ts-expect-error The private method takes one canonical primitive string.
collect.createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA({ seed });
// @ts-expect-error The private method takes the original ArrayBuffer.
collect.createOriginalDeviceRegistrationPublicOriginalsDATA(intent, new Uint8Array(pkA), pkB, allocated.allocationOriginal);
// @ts-expect-error The collector properties are readonly.
collect.createOriginalDeviceRegistrationPublicOriginalsDATA = () => result;
