export interface OriginalShopRegisteredReadImportResult {
 readonly portPresent:boolean;readonly portOriginal:unknown;
 readonly namespacePresent:boolean;readonly namespaceOriginal:unknown;readonly accepted:boolean;
 readonly errorPresent:boolean;readonly error:unknown;readonly dataOnly:true;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly NativeSlotEnabled:false;
}
export interface OriginalShopRegisteredReadImportAttempt {
 readonly completion:Promise<Readonly<OriginalShopRegisteredReadImportResult>>;
 retire():void;join():Promise<void>;
 statusDATA():Readonly<Omit<OriginalShopRegisteredReadImportResult,'portOriginal'|'namespaceOriginal'>&{retired:boolean;complete:boolean}>;
}
/** Native recognizes the actual owner and supplies the canonical reviewed URI.
 * This reference is never a Source factory, public callback or locator setter. */
export function startOriginalShopRegisteredReadNodeLoadV1(owner:object):Readonly<OriginalShopRegisteredReadImportAttempt>;
/** Import evidence DATA only, never Native/Source permission. */
export function isOriginalShopRegisteredReadNamespaceImportDATA(owner:unknown,namespace:unknown):boolean;
/** One-shot only during synchronous Native acceptCompleted. */
export function consumeOriginalShopRegisteredReadNamespaceImportDATA(owner:unknown,namespace:unknown):boolean;
