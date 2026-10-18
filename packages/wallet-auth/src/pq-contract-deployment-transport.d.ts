/** Exact raw compiler files; their authentication remains the original Go callee. */
export interface PQContractCompilerMaterial { readonly artifactFile:Uint8Array; readonly buildInfoFile:Uint8Array; }
export interface PQContractDeploymentMaterialInput { readonly source:string; readonly material:PQContractCompilerMaterial; }
export interface PQContractDeploymentMaterialData extends PQContractDeploymentMaterialInput { readonly dataOnly:true; readonly nativeAdmission:false; readonly compilerMaterialValidationRequired:true; }
export interface PQContractDeploymentTransportInput extends PQContractDeploymentMaterialInput { readonly member:Uint8Array; }
export interface PQContractDeploymentTransportData extends PQContractDeploymentMaterialData { readonly member:Uint8Array; readonly memberValidationRequired:true; }
export const PQ_CONTRACT_DEPLOYMENT_SOURCE_MAX_BYTES:number;
export const PQ_CONTRACT_DEPLOYMENT_ARTIFACT_MAX_BYTES:number;
export const PQ_CONTRACT_DEPLOYMENT_BUILD_INFO_MAX_BYTES:number;
/** Pre-key availability/copy DATA fence. Does not trim or authenticate source. */
export function capturePQContractDeploymentMaterialData(input:PQContractDeploymentMaterialInput):Readonly<PQContractDeploymentMaterialData>;
/** Go ordered version/type/wireHex/source/material JSON with standard Base64 files. */
export function encodePQContractDeploymentTransportData(input:PQContractDeploymentTransportInput):Uint8Array;
export function decodePQContractDeploymentTransportData(raw:Uint8Array):Readonly<PQContractDeploymentTransportData>;
