/** PRIVATE Root-port consumer, not a public Source or provider interface. */
export interface OriginalWalletMainNodeLoadResultV1 {
 readonly portPresent:boolean;readonly portOriginal:unknown;
 readonly namespacePresent:boolean;readonly namespaceOriginal:unknown;
 readonly errorPresent:boolean;readonly error:unknown;readonly dataOnly:true;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly MainRegistered:false;
}
export interface OriginalWalletMainNodeLoadStatusV1 {
 readonly retired:boolean;readonly complete:boolean;readonly portPresent:boolean;readonly namespacePresent:boolean;
 readonly errorPresent:boolean;readonly error:unknown;readonly dataOnly:true;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly MainRegistered:false;
}
export interface OriginalWalletMainNodeLoadAttemptV1 {
 readonly completion:Promise<Readonly<OriginalWalletMainNodeLoadResultV1>>;
 /** Denies acceptance immediately. Actual tagged startup owner retires separately. */
 retire():void;
 /** Waits actual import settlement. Never releases original startup owner. */
 join():Promise<void>;
 statusDATA():Readonly<OriginalWalletMainNodeLoadStatusV1>;
}
/** Fixed Native opener independently validates SAME actual Root-owned handle.
 * No URI or callback/provider accepted. Retain controller before awaiting.
 * Caller must keep original startup owner alive until this attempt joins. */
export declare function startOriginalWalletMainNamespaceNodeLoadV1(actualStartupOwner:unknown):Readonly<OriginalWalletMainNodeLoadAttemptV1>;

/** PRIVATE import provenance only, not Root, current, or Source permission.
 * Exact SAME owner/namespace; false for absent/error/retired imports. */
export declare function isOriginalWalletMainNamespaceImportDATA(actualStartupOwner:unknown,sameNamespace:unknown):boolean;
/** One-shot, only during synchronous Native acceptCompleted boundary.
 * A successful consume does not invalidate subsequent non-consuming checks. */
export declare function consumeOriginalWalletMainNamespaceImportDATA(actualStartupOwner:unknown,sameNamespace:unknown):boolean;

/** PRIVATE immutable fixed-image/open snapshot; zero caller inputs, no authority. */
export declare function captureOriginalWalletMainNamespaceLoaderBindingV1():Readonly<{image:object;open:(actualStartupOwner:unknown)=>unknown}>;
