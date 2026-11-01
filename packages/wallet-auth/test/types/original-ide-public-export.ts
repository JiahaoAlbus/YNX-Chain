import {acquireOriginalIDEAdmissionParentDelivery,acquireOriginalIDEPrivateServiceChannel,acquireOriginalIDEColdTerminalCustody,type OriginalIDEColdTerminalCustody} from '@ynx-chain/wallet-auth/original-ide-admission';
const entry='file:///original/server.mjs';
void acquireOriginalIDEAdmissionParentDelivery(entry);
void acquireOriginalIDEPrivateServiceChannel(entry);
void acquireOriginalIDEColdTerminalCustody(entry);
declare const cold:OriginalIDEColdTerminalCustody;
const data=cold.readTerminalCustody('canonical original');
const noReplay:false=data.proof.effectRetryAuthorized;
const noAdmission:false=data.proof.nativeAdmission;
// @ts-expect-error A cold terminal DATA reader is not an effect dispatcher.
cold.dispatch('new request');
// @ts-expect-error A login/entry argument is not a caller-selected key or grant.
acquireOriginalIDEAdmissionParentDelivery(entry,{grant:true});
void [noReplay,noAdmission];
