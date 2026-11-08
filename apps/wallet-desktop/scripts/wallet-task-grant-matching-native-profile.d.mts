import type{Buffer}from'node:buffer';
export interface OriginalTaskGrantPlanDATA{readonly kind:'YNX_TASK_GRANT_MATCHING_PLAN/v1';readonly role:'YNX_TASK_GRANT_CURRENT_A_MATCHED_NATIVE/v1';readonly outputRoot:string;readonly commands:readonly Readonly<{name:string;tool:string;argv:readonly string[];electronRunAsNode?:boolean}>[];readonly newCPPCompiles:5;readonly newSwiftCompiles:0;readonly totalObjectCount:89;readonly GoBuild:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;}
export declare const TASK_GRANT_MATCHING_ROLE:'YNX_TASK_GRANT_CURRENT_A_MATCHED_NATIVE/v1';
export declare function composeOriginalTaskGrantRecipeDATA(outputRoot:string):OriginalTaskGrantPlanDATA;
export declare function planOriginalTaskGrantMatchingDATA(outputRoot:string):OriginalTaskGrantPlanDATA;
export declare function assertOriginalTaskGrantMatchingPlanDATA(plan:unknown):true;
export declare function captureOriginalTaskGrantInputPinsDATA(plan:OriginalTaskGrantPlanDATA):readonly Readonly<{path:string;bytes:number;sha256:string}>[];
export declare function createOriginalTaskGrantGatePayloadDATA(plan:OriginalTaskGrantPlanDATA,imageBytes:Buffer):unknown;
export declare function verifyOriginalTaskGrantCompletionDATA(record:unknown,plan:OriginalTaskGrantPlanDATA,moduleBytes:Buffer,runtimeFiles:readonly Readonly<{name:string;bytes:Buffer}>[]):Readonly<{newRecipeArtifactVerified:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
export declare function finalizeOriginalTaskGrantMatchingRecord(outputRoot:string):Readonly<{path:string;bytes:number;sha256:string;RootAdmission:false;SourceAdmission:false}>;
export declare function inspectOriginalTaskGrantDependencyDATA(plan:OriginalTaskGrantPlanDATA,index:0|1|2|3|4,rawMakeDependency:string):Readonly<{source:string;output:string;resolvedInputs:readonly Readonly<{path:string;bytes:number;sha256:string}>[]}>;
