import {verifyOriginalAuthSourceCurrentV2,verifyOriginalAuthSourceProfileV2,selectOriginalAuthSourceAlgorithm,type OriginalAuthSourceV2Registrations,type OriginalAuthSourceV2Policy} from '@ynx-chain/wallet-auth/auth-source-verification';
declare const registrations:OriginalAuthSourceV2Registrations;
declare const policy:OriginalAuthSourceV2Policy;
const previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'};
const data=verifyOriginalAuthSourceCurrentV2('root','enrollment','profile','current',policy,registrations,'nonce',previous,100);
const noGrant:false=data.nativeAdmission;
const height:string=data.executionHeight;
const principal:string=data.selection.association.account;
const profile=verifyOriginalAuthSourceProfileV2('root','enrollment','profile',policy,registrations,100);
const signedEnrollmentHeight:string=profile.credentialIssuedHeights.enrollment;
const version=selectOriginalAuthSourceAlgorithm(registrations.subject,2);
// @ts-expect-error Signed original metadata is deeply read-only.
data.selection.association.account='replacement principal';
// @ts-expect-error This verified DATA cannot invoke a protected key.
data.invoke();
// @ts-expect-error This verified DATA cannot represent Native admission.
const authority:true=data.nativeAdmission;
// @ts-expect-error The canonical credential algorithm versions are 1 or 2.
selectOriginalAuthSourceAlgorithm(registrations.subject,3);
// @ts-expect-error Retained observation height is required, with no silent default.
verifyOriginalAuthSourceCurrentV2('root','enrollment','profile','current',policy,registrations,'nonce',{sequence:0,floor:0,head:'',timeFloor:0},100);
// @ts-expect-error U64 observed height cannot be rounded into JS Number.
verifyOriginalAuthSourceCurrentV2('root','enrollment','profile','current',policy,registrations,'nonce',{...previous,executionHeight:1},100);
// @ts-expect-error Signed height cannot be relabeled to latest observed H.
profile.credentialIssuedHeights.enrollment='new observed H';
void [noGrant,height,principal,profile,version,signedEnrollmentHeight];
import {verifyOriginalAuthSourceTransitionV2,type OriginalAuthSourceV2CurrentData} from '@ynx-chain/wallet-auth/auth-source-verification';
const historical=verifyOriginalAuthSourceTransitionV2('root','enrollment','profile','current',policy,registrations,'nonce',previous,40000);
const isHistorical:true=historical.historical;
const signedStatementHeight:string=historical.statementExecutionHeight;
const terminalOrActive:'active'|'revoked'|'retired'=historical.status;
// @ts-expect-error Historical terminal DATA is not active current data.
const currentAdmissionData:OriginalAuthSourceV2CurrentData=historical;
// @ts-expect-error No extra mode override can relax current verification.
verifyOriginalAuthSourceCurrentV2('root','enrollment','profile','current',policy,registrations,'nonce',previous,100,true);
// @ts-expect-error No runtime mode switch on historical verification.
verifyOriginalAuthSourceTransitionV2('root','enrollment','profile','current',policy,registrations,'nonce',previous,100,false);
void [isHistorical,signedStatementHeight,terminalOrActive];
