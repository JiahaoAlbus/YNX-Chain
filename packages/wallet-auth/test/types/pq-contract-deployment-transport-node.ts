import {preparePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport-node';
import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
declare const snapshot:PQAuthorizationSnapshot;
const input={member:new Uint8Array([1]),source:'x',material:{artifactFile:new Uint8Array([1]),buildInfoFile:new Uint8Array([2])}};
const result=preparePQContractDeploymentTransportData(snapshot,input);
const onlyData:true=result.dataOnly; const noAdmission:false=result.nativeAdmission; const stillRequired:true=result.compilerMaterialValidationRequired;
// @ts-expect-error an arbitrary object is not the branded snapshot
preparePQContractDeploymentTransportData({},input);
// @ts-expect-error there is no transaction sender
result.send();
void [onlyData,noAdmission,stillRequired];
