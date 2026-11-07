export const SOURCE_PARENT_NORMAL_PROFILE_KIND:'YNX_SOURCE_PARENT_NORMAL_BUILD_PROFILE/v1';
export interface SourceParentFilePin {readonly path:string;readonly bytes:number;readonly sha256:string}
export interface SourceParentImageRecord {readonly image:SourceParentFilePin;readonly sourceCommit:string;readonly sourceTree:string;readonly record:SourceParentFilePin}
export interface SourceParentObserverApplication {readonly migration:string;readonly state:string;readonly stateLayout:'atomic-json'|'snapshot-journal'|'block-journal';readonly genesisHash:string;readonly originalGenesisHash:string;readonly migrationHash:string;readonly schedule:string;readonly scheduleHash:string;readonly runtimePlan:string;readonly runtimePlanHash:string;readonly invoiceSchedule:string;readonly invoiceScheduleHash:string}
export interface SourceParentObserverOptions {readonly home:string;readonly application:SourceParentObserverApplication}
export interface SourceParentNormalProfile {readonly version:1;readonly kind:typeof SOURCE_PARENT_NORMAL_PROFILE_KIND;readonly images:Readonly<{parent:SourceParentImageRecord;Core:SourceParentImageRecord;Native:SourceParentImageRecord}>;readonly observerOptions:SourceParentObserverOptions}
export interface SourceParentNormalProfileBuildInput {readonly sourceRoot:string;readonly profileOriginal:string;readonly independentOriginal:string}
export interface SourceParentNormalProfileDATA {readonly profileOriginal:string;readonly profileSHA256:string;readonly images:readonly [string,string,string];readonly observerOptions:SourceParentObserverOptions;readonly dataOnly:true;readonly postbuildBytesVerified:true;readonly normalExecutionVerified:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly qualifiedRuntimeResource:false}
export function inspectSourceParentNormalProfileDATA(profileOriginal:string,independentOriginal:string):SourceParentNormalProfile;
export function materializeSourceParentNormalProfileDATA(input:SourceParentNormalProfileBuildInput):Readonly<SourceParentNormalProfileDATA>;
/** Detached DATA module only; installing it never qualifies a Core runtime getter. */
export function encodeSourceParentNormalProfileModuleDATA(input:SourceParentNormalProfileBuildInput):string;
