import {preparePQContractDeploymentMaterialData,type PQContractDeploymentMaterialInput} from '@ynx-chain/wallet-auth/pq-contract-deployment-material';
declare const input:PQContractDeploymentMaterialInput;
const result=preparePQContractDeploymentMaterialData(input);
const noAdmission:false=result.nativeAdmission;void noAdmission;
