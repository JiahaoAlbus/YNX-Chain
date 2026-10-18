import {verifyOriginalAuthSourceCurrentV2,verifyOriginalAuthSourceProfileV2,selectOriginalAuthSourceAlgorithm,type OriginalAuthSourceV2Registrations,type OriginalAuthSourceV2Policy} from '@ynx-chain/wallet-auth/auth-source-verification';
declare const registrations:OriginalAuthSourceV2Registrations;
declare const policy:OriginalAuthSourceV2Policy;
const previous={sequence:0,floor:0,head:'',timeFloor:0};
const data=verifyOriginalAuthSourceCurrentV2('root','enrollment','profile','current',policy,registrations,'nonce',previous,100);
const noGrant:false=data.nativeAdmission;
const height:string=data.executionHeight;
const principal:string=data.selection.association.account;
const profile=verifyOriginalAuthSourceProfileV2('root','enrollment','profile',policy,registrations,100);
const version=selectOriginalAuthSourceAlgorithm(registrations.subject,2);
// @ts-expect-error Signed original metadata is deeply read-only.
data.selection.association.account='replacement principal';
// @ts-expect-error This verified DATA cannot invoke a protected key.
data.invoke();
// @ts-expect-error This verified DATA cannot represent Native admission.
const authority:true=data.nativeAdmission;
// @ts-expect-error The canonical credential algorithm versions are 1 or 2.
selectOriginalAuthSourceAlgorithm(registrations.subject,3);
void [noGrant,height,principal,profile,version];
