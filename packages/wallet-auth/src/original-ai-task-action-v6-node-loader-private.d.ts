/** PRIVATE Node ESM import provenance/custody; not Root/Source or mobile bridge. */
export interface OriginalAITaskActionClientV6NodeLoadResult {readonly portPresent:boolean;readonly portOriginal:unknown;readonly namespacePresent:boolean;readonly namespaceOriginal:unknown;readonly errorPresent:boolean;readonly error:unknown;readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;}
export interface OriginalAITaskActionClientV6NodeLoadAttempt {readonly completion:Promise<Readonly<OriginalAITaskActionClientV6NodeLoadResult>>;retire():void;join():Promise<void>;statusDATA():Readonly<{retired:boolean;complete:boolean;portPresent:boolean;namespacePresent:boolean;errorPresent:boolean;error:unknown;importConsumed:boolean;dataOnly:true;SourceAdmission:false;NativeAdmission:false}>;}
export function startOriginalAITaskActionClientV6NodeLoadV1(sameNativeOwner:unknown):Readonly<OriginalAITaskActionClientV6NodeLoadAttempt>;
export function isOriginalAITaskActionClientV6ModuleImportDATA(sameNativeOwner:unknown,sameActualESMNamespace:unknown):boolean;
/** One consume, exclusively within SAME actual Native synchronous acceptCompleted call. */
export function consumeOriginalAITaskActionClientV6ModuleImportDATA(sameNativeOwner:unknown,sameActualESMNamespace:unknown):boolean;
export function captureOriginalAITaskActionClientV6LoaderBindingV1():Readonly<{image:object;open:(sameNativeOwner:unknown)=>unknown;waitReady:(sameNativeOwner:unknown)=>Promise<void>}>;
