import type {SocialOrdinaryEnrollmentBodyV2DATA,SocialOrdinaryEnrollmentEnvelopeV2DATA} from '../src/social-ordinary-enrollment-v2.js';
declare const b:SocialOrdinaryEnrollmentBodyV2DATA;declare const e:SocialOrdinaryEnrollmentEnvelopeV2DATA;
const version:2=b.version;const profile:1=b.platformProfile;const scopeCounter:bigint=b.scope.sourceGeneration;
// @ts-expect-error ordinary enrollment is not strong Registration1
const strong:1=b.version;
// @ts-expect-error no strong counterFloor material
b.counterFloor;
// @ts-expect-error Root signature not verified by DATA parser
const verified:true=e.signatureVerified;
// @ts-expect-error parsing does not return an enrolled resource
const admitted:true=e.enrolledResource;
// @ts-expect-error independent tuple fields use decimal strings
const invalid:SocialOrdinaryEnrollmentBodyV2DATA={...b,keyEpoch:1};
