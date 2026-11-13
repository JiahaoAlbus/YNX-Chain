/** Fixed private DATA methods on the pending collector. */
export interface OriginalDeviceRegistrationPublicOriginalsDATA {
  readonly creationOperationId: string;
  readonly operationId: string;
  readonly creationIntentOriginal: string;
  readonly allocationOriginal: string;
  readonly registrationOriginal: string;
  readonly registrationDigest: string;
  readonly requestOriginal: string;
  readonly requestDigest: string;
  readonly dataOnly: true;
  readonly userApproved: false;
  readonly registered: false;
  readonly SourceAdmission: false;
  readonly NativeAdmission: false;
}

export interface OriginalDeviceRegistrationAllocationDATA {
  readonly creationOperationId: string;
  readonly mainDeviceOperationId: string;
  readonly operationId: string;
  readonly allocationOriginal: string;
  readonly dataOnly: true;
  readonly userApproved: false;
  readonly SourceAdmission: false;
  readonly NativeAdmission: false;
}

export function createOriginalDeviceRegistrationPublicOriginalsDATA(
  creationIntentOriginal: string,
  pkAOriginal: ArrayBuffer,
  pkBOriginal: ArrayBuffer,
  allocationOriginal: string,
): OriginalDeviceRegistrationPublicOriginalsDATA;

export function createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA(
  seedOriginal: string,
): OriginalDeviceRegistrationAllocationDATA;
