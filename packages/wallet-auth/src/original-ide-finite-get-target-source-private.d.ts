/** PRIVATE required Native pre-proof ABI. No package export or provider setter. */
declare const targetScope:unique symbol;
export interface OriginalIDEFiniteGETTargetScope {readonly [targetScope]:never;}
export interface OriginalIDEFiniteGETTargetSource {
 assertCurrent():undefined;
 /** SAME opaque Native capture identity; not the cap29 DATA projection. */
 readOriginalTargetScope():OriginalIDEFiniteGETTargetScope;
 retire():void;
 /** First unique close Promise is preserved even if rejected. */
 close():Promise<void>;
 /** Explicit SAME-owner debt continuation after a failed first close. */
 drainOriginal():Promise<void>;
 statusDATA():Readonly<{retired:boolean;closed:boolean;cleanupDebt:boolean;firstCausePresent:boolean;firstCause:unknown;RootAdmission:false;SourceAdmission:false;TargetAdmission:false}>;
}
/** Synchronous fixed-image getter. Native must recognize SAME actual selection.
 * Root0/missing body refuses. Failure retains .partial cleanup custody, with
 * originalFailurePresent and original cause including false/null/undefined.
 */
export declare function acquireOriginalIDEFiniteGETTargetSource(actualSelection:unknown):OriginalIDEFiniteGETTargetSource;

/** Distinct required fixed Native callee; no fallback to old no-scope getter.
 * Actual Auth image must validate the same selection/scope identity. */
export declare function acquireOriginalIDECloudGETSourceWithTargetScope(actualSelection:unknown):Readonly<{
 assertCurrent():undefined;recheck():Promise<void>;
 captureOriginalGETRequest(request:unknown,sameContext:unknown):unknown;
 retire():void;join():Promise<void>;close():Promise<void>;
 statusDATA():Readonly<Record<string,unknown>>;
}>;
