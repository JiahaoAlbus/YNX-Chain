import {verifyOriginalAuthIdentityProofFrameData} from '@ynx-chain/wallet-auth/auth-identity-verification';
const data=verifyOriginalAuthIdentityProofFrameData('canonical frame');
const count:1=data.memberCount;
const index:0=data.memberIndex;
const noAdmission:false=data.nativeAdmission;
const noRetry:false=data.effectRetryAuthorized;
const noAuthority:false=data.authorized;
const proofDigest:string=data.proofDigest;
const purpose:'AUTH-IDENTITY-RECEIVE'|'AUTH-IDENTITY-RECOVER'|'AUTH-PROTECTED-KEY-CALL'=data.purpose;
// @ts-expect-error Frame input cannot be a renderer object with getters.
verifyOriginalAuthIdentityProofFrameData({});
// @ts-expect-error Fixed input has no provider, expected or clock injection args.
verifyOriginalAuthIdentityProofFrameData('frame',{provider:'alternate'});
// @ts-expect-error Mathematical DATA contains no protected invocation owner.
data.invoke();
// @ts-expect-error Immutable DATA cannot be promoted to Native authority.
data.nativeAdmission=true;
// @ts-expect-error The closed frame consumer never returns LOGIN approval.
const login:'AUTH-LOGIN'=data.purpose;
void [count,index,noAdmission,noRetry,noAuthority,proofDigest,purpose];
