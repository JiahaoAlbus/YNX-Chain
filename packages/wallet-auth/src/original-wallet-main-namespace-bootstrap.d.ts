import type {OriginalRuntimeImageAdmissionOwnerV1} from './original-auth-runtime-image-source-v1.js';
import type {OriginalWalletMainNodeLoadResultV1} from './original-wallet-main-namespace-node-loader-private.js';
export interface OriginalWalletMainNamespaceStartupCompletionV1 {
 readonly admission:OriginalRuntimeImageAdmissionOwnerV1|null;
 /** SAME returned/nonnull own partial candidate, retained before recognition. */
 readonly nativeOwner:unknown;readonly nativeOwnerPresent:boolean;
 readonly loadResult:Readonly<OriginalWalletMainNodeLoadResultV1>|null;
 readonly errorPresent:boolean;readonly error:unknown;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly MainRegistered:false;
}
export interface OriginalWalletMainNamespaceStartupStatusV1 {
 readonly retired:boolean;readonly acquisitionComplete:boolean;readonly admissionPresent:boolean;
 readonly parentRetireSelected:boolean;readonly nativeInitializationEntered:boolean;
 readonly nativeOwnerPresent:boolean;readonly nativeOwnerRecognized:boolean;readonly nativeCustodyUnknown:boolean;
 readonly nodeLoadSelected:boolean;readonly nodeLoadComplete:boolean;
 readonly nativeRetireSelected:boolean;readonly nativeJoinSelected:boolean;readonly nativeJoinComplete:boolean;
 readonly nativeCloseSelected:boolean;readonly nativeCloseComplete:boolean;
 readonly joinSelected:boolean;readonly joinComplete:boolean;readonly closeSelected:boolean;readonly closeComplete:boolean;
 readonly startupErrorPresent:boolean;readonly startupError:unknown;readonly identityErrorPresent:boolean;readonly identityError:unknown;
 readonly cleanupErrorPresent:boolean;readonly cleanupError:unknown;readonly dataOnly:true;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly MainRegistered:false;
}
/** Synchronous custody controller. Native recognition/current is not a status flag. */
export interface OriginalWalletMainNamespaceStartupAttemptV1 {
 readonly completion:Promise<Readonly<OriginalWalletMainNamespaceStartupCompletionV1>>;
 /** Loader retirement, then cached Native retirement; exact failure may throw. */
 retire():void;
 /** Waits late import, closes SAME joined Native child, then joins image parent. */
 join():Promise<void>;
 /** Child completion before image close; failure/UNKNOWN retains original debt. */
 close():Promise<void>;
 statusDATA():Readonly<OriginalWalletMainNamespaceStartupStatusV1>;
}
export declare function initializeOriginalWalletMainNamespaceV1():Readonly<OriginalWalletMainNamespaceStartupAttemptV1>;
