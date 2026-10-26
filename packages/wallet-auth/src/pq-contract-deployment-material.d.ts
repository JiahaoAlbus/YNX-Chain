export type PQBoundedDeploymentContractName='SampleEVMWriteCounter'|'SampleYNXTCompatibleERC20';
export interface PQContractDeploymentMaterialInput {
 readonly name:PQBoundedDeploymentContractName;
 /** Exact already-trimmed request-source original, not source-file newline. */
 readonly source:string;
 readonly material:{readonly artifactFile:Uint8Array;readonly buildInfoFile:Uint8Array};
 /** Explicit user constructor argument; canonical decimal U64, no default. */
 readonly constructorArgs:readonly [string];
}
export interface PQContractDeploymentMaterialData {
 readonly name:PQBoundedDeploymentContractName;readonly sourceHash:string;
 readonly deployedBytecodeHash:string;readonly compilerConfigHash:string;
 readonly constructorArgs:readonly [string];readonly value:'0';readonly fee:'10';
 readonly source:string;
 /** Every read returns detached copies of exact fourth-handoff originals. */
 readonly material:{readonly artifactFile:Uint8Array;readonly buildInfoFile:Uint8Array};
 readonly compilerMaterialValidationRequired:true;readonly dataOnly:true;
 readonly authorized:false;readonly nativeAdmission:false;
}
/** Portable DATA-only fixed registry/material selection and original Go hashParts
 * commitments. No nonce/owner/policy fabricated, no compiler or approval. */
export declare function preparePQContractDeploymentMaterialData(input:PQContractDeploymentMaterialInput):Readonly<PQContractDeploymentMaterialData>;
