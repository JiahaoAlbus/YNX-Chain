import type {OriginalRuntimeImageAdmissionOwnerV1} from './original-auth-runtime-image-source-v1.js';
export interface OriginalWalletMainNamespaceStartupCompletionV1 {
 readonly admission:OriginalRuntimeImageAdmissionOwnerV1|null;
 readonly errorPresent:boolean;readonly error:unknown;
 readonly nativeOwnerPresent:false;readonly SourceAdmission:false;
 readonly NativeAdmission:false;readonly MainRegistered:false;
}
export interface OriginalWalletMainNamespaceStartupStatusV1 {
 readonly retired:boolean;readonly acquisitionComplete:boolean;readonly admissionPresent:boolean;
 readonly parentRetireSelected:boolean;readonly joinSelected:boolean;readonly joinComplete:boolean;
 readonly closeSelected:boolean;readonly closeComplete:boolean;
 readonly startupErrorPresent:boolean;readonly startupError:unknown;
 readonly cleanupErrorPresent:boolean;readonly cleanupError:unknown;
 readonly nativeOwnerPresent:false;readonly dataOnly:true;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly MainRegistered:false;
}
/** Synchronous custody controller. No Source/Native identity or admission. */
export interface OriginalWalletMainNamespaceStartupAttemptV1 {
 readonly completion:Promise<Readonly<OriginalWalletMainNamespaceStartupCompletionV1>>;
 /** Immediately denies startup. Original retire failure may be thrown, even false. */
 retire():void;
 /** Same sticky pending/debt; no replacement slot or successful retry on failure. */
 join():Promise<void>;
 close():Promise<void>;
 statusDATA():Readonly<OriginalWalletMainNamespaceStartupStatusV1>;
}
export declare function initializeOriginalWalletMainNamespaceV1():Readonly<OriginalWalletMainNamespaceStartupAttemptV1>;
