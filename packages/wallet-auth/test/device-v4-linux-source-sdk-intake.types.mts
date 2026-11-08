import type{OriginalPrimaryDeviceV4SourcePolicy,OriginalAuthSourceV2Policy}from'../native/original-auth-identity-source-v2-verifier.mjs';
const base={rootDigest:'a',enrollmentDigest:'b',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'c',signatureContract:{purpose:'product-session-device-source-v4',enrollmentFrame:'original',profileFrame:'original',currentFrame:'original'},applicationId:'original.application',productId:'developer'}as const;
const legacy:OriginalPrimaryDeviceV4SourcePolicy=base;
const linux:OriginalPrimaryDeviceV4SourcePolicy={...base,platform:'linux'};
const generic:OriginalAuthSourceV2Policy=linux;
// @ts-expect-error Explicit macOS eighth key is not the legacy absent-key policy.
const mac:OriginalPrimaryDeviceV4SourcePolicy={...base,platform:'macos'};
// @ts-expect-error Other desktop OS is not this primary DEVICE policy.
const windows:OriginalPrimaryDeviceV4SourcePolicy={...base,platform:'windows'};
// @ts-expect-error Mobile policy cannot migrate through this Source family.
const mobile:OriginalPrimaryDeviceV4SourcePolicy={...base,platform:'android'};
// @ts-expect-error Present undefined is not absent under exact optional properties.
const undefinedPlatform:OriginalPrimaryDeviceV4SourcePolicy={...base,platform:undefined};
// @ts-expect-error Pending purpose does not inherit this primary-only platform field.
const pending:OriginalPrimaryDeviceV4SourcePolicy={...base,signatureContract:{...base.signatureContract,purpose:'product-session-device-pending-source-v4'},platform:'linux'};
void[legacy,linux,generic,mac,windows,mobile,undefinedPlatform,pending];
