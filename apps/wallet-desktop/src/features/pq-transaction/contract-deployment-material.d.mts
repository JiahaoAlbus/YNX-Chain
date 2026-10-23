import type {PQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import type {PQContractDeploymentMaterialInput} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
export function inspectPQGoValidatedContractMaterial(action:PQNativeAction,input:PQContractDeploymentMaterialInput):Readonly<{
 contractName:string;sourceSha256:string;artifactSha256:string;buildInfoSha256:string;goSourceCommit:string;materialHandoffSha256:string;
 goMaterialPinsMatched:true;dataOnly:true;nativeAdmission:false;permissionGranted:false;submitted:false;canRetry:false;consensusFinality:false;
}>;
