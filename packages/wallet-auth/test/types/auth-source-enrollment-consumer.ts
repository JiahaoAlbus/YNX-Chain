import {verifyOriginalAuthSourceEnrollmentV2,type OriginalAuthSourceV2Policy,type OriginalAuthSourceV2Registrations} from '@ynx-chain/wallet-auth/auth-source-verification';
declare const policy:OriginalAuthSourceV2Policy;
declare const registrations:OriginalAuthSourceV2Registrations;
const result=verifyOriginalAuthSourceEnrollmentV2('root','enrollment',policy,registrations,100);
const noGrant:false=result.nativeAdmission;
const onlyData:true=result.dataOnly;
const signedHeight:string=result.enrollmentBinding.executionHeight;
const observedHeight:string=result.executionHeight;
// @ts-expect-error Enrollment DATA is not Native admission.
const grant:true=result.nativeAdmission;
// @ts-expect-error Enrollment DATA has no verified profile or subject grant.
result.profile;
// @ts-expect-error Signed enrollment binding cannot be mutated.
result.enrollmentBinding.executionHeight='replacement';
// @ts-expect-error Observed height remains exact U64 string, never Number.
const rounded:number=result.executionHeight;
// @ts-expect-error An arbitrary missing registration role cannot be substituted.
verifyOriginalAuthSourceEnrollmentV2('root','enrollment',policy,{root:registrations.root},100);
// @ts-expect-error No trailing permission or mode override.
verifyOriginalAuthSourceEnrollmentV2('root','enrollment',policy,registrations,100,true);
void [noGrant,onlyData,signedHeight,observedHeight,grant,rounded];
