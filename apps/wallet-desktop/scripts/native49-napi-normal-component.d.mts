import type{Buffer}from'node:buffer';
/** Build/public-artifact verification only; never Source or helper admission. */
export interface NAPIComponentSourceRoles {
 readonly reusedCPPSourceCommit:string; readonly reusedCPPSourceTree:string;
 readonly swiftBuilderCommit:string; readonly swiftBuilderTree:string;
 readonly relinkProducerCommit:string; readonly relinkProducerTree:string;
}
export type ReadPackedAsset=(relative:string)=>Buffer;
export interface NAPIComponentResult {readonly nodeArtifactBytesVerified:true;readonly recordBytesVerified:true;readonly reusedCPP:84;readonly reusedSwift:1;readonly newCPPCompiles:0;readonly newSwiftCompiles:0;readonly ledgerActions:16;readonly NodeLoadRecorded:true;readonly ElectronLoadRecorded:true;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly NativeLoadedByReader:false;readonly wholeAppReady:false;readonly installed:false;}
export declare function inspectNative49NAPINormalRecordDATA(recordBytes:Buffer,sourceRoles:NAPIComponentSourceRoles):Readonly<{newRecordDataVerified:true;actual16LedgerAndBothRuntimeOriginalsBound:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
export declare function verifyNative49NAPINormalNodeComponent(input:{recordBytes:Buffer;moduleBytes:Buffer;runtimeFiles:Record<string,Buffer>;sourceRoles:NAPIComponentSourceRoles}):NAPIComponentResult;
export declare function readNative49NAPINormalNodeComponent():NAPIComponentResult;
export declare function verifyNative49NAPIPackagedNode(input:{readPackedAsset:ReadPackedAsset;sourceRoles:NAPIComponentSourceRoles}):NAPIComponentResult;
export declare function stageNative49NAPIFixedInput(freshAbsoluteOutputRoot:string):NAPIComponentResult & {inputRoot:string;assets:10;old4207Overwritten:false;recordRewritten:false};
export declare const native49NAPINormalNodeComponent:Readonly<{inspectRecord:typeof inspectNative49NAPINormalRecordDATA;verify:typeof verifyNative49NAPINormalNodeComponent;read:typeof readNative49NAPINormalNodeComponent;verifyPackage:typeof verifyNative49NAPIPackagedNode;stageFixedInput:typeof stageNative49NAPIFixedInput}>;
