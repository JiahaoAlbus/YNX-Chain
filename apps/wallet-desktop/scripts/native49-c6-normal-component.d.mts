/// <reference types="node" />
export interface Native49C6SourceRoles { readonly reusedCPPSourceCommit:string;readonly reusedCPPSourceTree:string;readonly swiftBuilderCommit:string;readonly swiftBuilderTree:string }
export interface Native49C6NodeResult { readonly kind:'YNX_NATIVE49_C6_NORMAL_NODE_COMPONENT/v1';readonly nodeArtifactBytesVerified:true;readonly recordBytesVerified:true;readonly helperQualification:'NOT_SUPPLIED_BY_THIS_NODE_ROLE';readonly JSRuntimeQualification:'SEPARATE_ROLE_REQUIRED';readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly actualPeer:false;readonly wholeAppReady:false;readonly installed:false;readonly businessVerified:false;readonly NativeLoaded:false }
export function inspectNative49C6NormalRecordDATA(original:Buffer,sourceRoles:Native49C6SourceRoles):Readonly<{recordDataVerified:true;artifactBytesVerified:false;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;wholeAppReady:false}>;
export function verifyNative49C6ArtifactDATA(relative:string,bytes:Buffer):Readonly<{bytesVerified:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
export function verifyNative49C6NormalNodeComponent(input:{recordBytes:Buffer;moduleBytes:Buffer;runtimeFiles:Record<string,Buffer>;sourceRoles:Native49C6SourceRoles}):Native49C6NodeResult;
/** Build-time ASAR/file reader only, never a Source/signer/provider. Reads fixed asset names. */
export function verifyNative49C6PackagedNode(input:{readPackedAsset:(relative:string)=>Buffer;sourceRoles:Native49C6SourceRoles}):Native49C6NodeResult;
export function verifyNative49C6PackageDirectoryDATA(root:string):Native49C6NodeResult;
export function readNative49C6NormalNodeComponent():Promise<Native49C6NodeResult & {originalNormalReader:unknown;sourceFilesVerified:number;directProofsVerified:number}>;
export const native49C6NormalNodeComponent:Readonly<{inspectRecord:typeof inspectNative49C6NormalRecordDATA;verify:typeof verifyNative49C6NormalNodeComponent;read:typeof readNative49C6NormalNodeComponent;verifyPackage:typeof verifyNative49C6PackagedNode;verifyDirectory:typeof verifyNative49C6PackageDirectoryDATA}>;
