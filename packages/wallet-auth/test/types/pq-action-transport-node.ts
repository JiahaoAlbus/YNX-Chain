import {preparePQNativeActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport-node';
import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
declare const snapshot:PQAuthorizationSnapshot;
const result=preparePQNativeActionTransportData(snapshot,{member:new Uint8Array([1]),originals:[]});
const onlyData:true=result.dataOnly;
const noAdmission:false=result.nativeAdmission;
// @ts-expect-error an arbitrary DTO is not an SDK-branded snapshot
preparePQNativeActionTransportData({}, {member:new Uint8Array([1]),originals:[]});
// @ts-expect-error helper is not a transaction sender
result.send();
void [onlyData,noAdmission];
