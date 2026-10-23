import type {PQAuthorizationSnapshot} from './pq-wallet-policy.js';
import type {PQNativeAction} from './pq-native-action.js';
import type {PQContractDeploymentTransportInput} from './pq-contract-deployment-transport.js';
/** Original full Member/Action/snapshot math. No compiler validation, Source grant or send. */
export function preparePQContractDeploymentTransportData(snapshot:PQAuthorizationSnapshot,input:PQContractDeploymentTransportInput):Readonly<{
 action:PQNativeAction; body:Uint8Array; chainId:string; owner:string; keyVersion:string;
 executionHeight:string; purpose:string; memberCount:number; memberIndex:number;
 signatureVerified:true; dataOnly:true; nativeAdmission:false; compilerMaterialValidationRequired:true;
}>;
