export const WPR_NORMAL_INPUT_PROVENANCE:'YNX-WALLET-PRODUCT-TYPED-NORMAL-PROVENANCE/v1';
export interface WPRNormalFilePin {path:string;bytes:number;sha256:string}
export interface WPRNormalInputProvenance {version:typeof WPR_NORMAL_INPUT_PROVENANCE;typedBuildOriginal:string;independentOriginalPin:WPRNormalFilePin;runtimeLeafPins:WPRNormalFilePin[]}
export interface WPRTypedHeaderPin extends WPRNormalFilePin {inputDigest:string}
export interface WPRBoundTypedHeaderPin extends WPRTypedHeaderPin {affectedCompileCommands:number;compileBindingSHA256:string}
export interface WPRNormalCommand {tool:string;argv:string[]}
export interface WPRNormalPlan {commands:WPRNormalCommand[];objectOutputs:string[];output:string;sourceInputs?:WPRNormalFilePin[];reusedCPPObjects?:unknown[];reusedObjectInputs?:unknown[]}
export interface WPRNormalBoundPlan extends WPRNormalPlan {sourceInputs:WPRNormalFilePin[];externalTypedProductSourceRelease:WPRBoundTypedHeaderPin;externalTypedProductSourceProvenance:WPRNormalInputProvenance}
export interface WPRNormalExecutionRecord {compiledByThisInvocation:true;commands:WPRNormalCommand[];externalTypedProductSourceRelease:WPRBoundTypedHeaderPin;externalTypedProductSourceProvenance:WPRNormalInputProvenance;image:WPRNormalFilePin;objects:WPRNormalFilePin[];RootAdmission:false;SourceAdmission:false;NativeAdmission:false;reusedCPPObjects?:unknown[]}
export function inspectWalletProductNormalInputProvenanceDATA(value:WPRNormalInputProvenance):WPRNormalInputProvenance;
export function walletProductNormalInputFilesDATA(value:WPRNormalInputProvenance):WPRNormalFilePin[];
export function walletProductNormalInputCapDATA(file:string,value:WPRNormalInputProvenance):number;
export function bindWalletProductNormalInputsPlanDATA<T extends WPRNormalPlan>(plan:T,typed:WPRTypedHeaderPin,provenance:WPRNormalInputProvenance):T&WPRNormalBoundPlan;
export function assertWalletProductNormalInputsPlanDATA(plan:WPRNormalBoundPlan):Readonly<{normalTypedInputsMatched:true;publicOriginalFiles:number;allCompileBindingsMatched:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
export function assertWalletProductNormalExecutionRecordDATA(record:WPRNormalExecutionRecord,plan:WPRNormalBoundPlan):Readonly<{artifactPathsMatched:true;normalTypedInputsMatched:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
