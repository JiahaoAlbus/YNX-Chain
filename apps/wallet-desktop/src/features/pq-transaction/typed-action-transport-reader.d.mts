import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import type {PQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
export type PQTypedTransportExpected=Readonly<{account:string;networkId:string;memberHash:string;transportHash:string}>;
export type PQTypedTransportOriginalData=Readonly<{
 account:string;networkId:string;memberHash:string;transportHash:string;
 action:PQNativeAction;keyVersion:string;executionHeight:string;purpose:string;
 memberCount:number;memberIndex:number;originalsCount:number;
 signatureVerified:true;classicWitnessValidationRequired:boolean;dataOnly:true;
 nativeAdmission:false;permissionGranted:false;submitted:false;canRetry:false;clearsOriginal:false;consensusFinality:false;
 body:Uint8Array;member:Uint8Array;originals:readonly Uint8Array[];
}>;
/** Original retained signing snapshot only. Not a Source/grant, replay permit,
 * classic witness verification or substitute for local N1/index0 inspection.
 * Body/member/originals accessors return detached byte copies. */
export function inspectPQTypedActionTransportOriginal(snapshot:PQAuthorizationSnapshot,raw:Uint8Array,expected:PQTypedTransportExpected):PQTypedTransportOriginalData;
export type PQContractDeploymentOriginalData=PQTypedTransportOriginalData & Readonly<{source:string;material:Readonly<{artifactFile:Uint8Array;buildInfoFile:Uint8Array}>;compilerMaterialValidationRequired:true}>;
export function inspectPQContractDeploymentTransportOriginal(snapshot:PQAuthorizationSnapshot,raw:Uint8Array,expected:PQTypedTransportExpected):PQContractDeploymentOriginalData;
