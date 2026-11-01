import {capturePQContractDeploymentMaterialData,encodePQContractDeploymentTransportData,decodePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
const material={artifactFile:new Uint8Array([1]),buildInfoFile:new Uint8Array([2])};
const data=capturePQContractDeploymentMaterialData({source:'x',material});
const raw=encodePQContractDeploymentTransportData({member:new Uint8Array([1]),source:data.source,material:data.material});
const decoded=decodePQContractDeploymentTransportData(raw);
const noGrant:false=decoded.nativeAdmission; const required:true=decoded.compilerMaterialValidationRequired;
// @ts-expect-error parsed artifact objects are not raw file bytes
capturePQContractDeploymentMaterialData({source:'x',material:{artifactFile:{},buildInfoFile:new Uint8Array([1])}});
// @ts-expect-error no caller supplied permission
capturePQContractDeploymentMaterialData({source:'x',material,authorized:true});
void [noGrant,required];
