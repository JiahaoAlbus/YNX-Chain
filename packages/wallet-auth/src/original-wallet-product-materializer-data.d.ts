/** Build-only DATA contract; these types create no Native/Root/Source authority. */
export type OriginalRole = 'enrollment' | 'profile';
export type FilePin = Readonly<{path:string;bytes:number;sha256:string}>;
export type Previous = Readonly<{sequence:number;floor:number;head:string;timeFloor:number;executionHeight:string}>;
export type PublicOriginals = Readonly<{root:string;enrollment:string;profile:string;acquisitionHead:string;freshCurrent:string}>;
export type RegisteredRoles = Readonly<Record<'root'|'profile'|'current'|'subject', unknown>>;
export type WPRBuildDATA = Readonly<{root:FilePin;enrollment:FilePin;verifier:FilePin;node:FilePin;runtime:Readonly<{proofContract:'YNX-AUTH-IDENTITY-PROOF-DATA/v1';packageRoot:string;manifest:FilePin;dispatch:FilePin}>;nativeNode:Readonly<{origin:string;spki:string;nativeChainId:string}>;applicationId:string;productId:'wallet';platform:'macos';uid:number;resourceDirectory:string}>;
export interface WPRMaterializationDATA {
 readonly originals:PublicOriginals;
 readonly policy:Readonly<Record<string,unknown>>;
 readonly registrations:Readonly<{acquisition:RegisteredRoles;fresh:RegisteredRoles}>;
 readonly currentContext:Readonly<{acquisitionNonce:string;freshNonce:string;previous:Previous;atMs:number}>;
 readonly approvals:readonly Readonly<{role:OriginalRole;approvalRaw:string;approvalDigest:string}>[];
 readonly build:WPRBuildDATA;
 /** Independently reviewed exact16 WPR3 build tuple canonical original. */
 readonly independentBuildOriginal:string;
 readonly buildOriginals:Readonly<Record<'root'|'enrollment'|'verifier'|'node'|'runtimeManifest'|'dispatch',Uint8Array>>;
}
export type WPRPublicMaterializationDATA = Readonly<{manifestOriginal:string;manifestSHA256:string;typedBuildOriginal:string;publicOriginalsOriginal:string;dataOnly:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;keysOpened:false;signaturesIssued:false;filesPublished:false}>;
export declare function materializeOriginalWalletProductPublicDATA(input:WPRMaterializationDATA):WPRPublicMaterializationDATA;
export declare function selectReviewedWalletProductMaterialization():WPRPublicMaterializationDATA;
/** ADDITIVE REQUIRED Native issuer/publication custody port, NOT supplied by this
 * SDK. No public constructor/provider/register/setter exists. Auth must acquire
 * it independently of the target consumer whose public originals are absent.
 * Fresh registered/current observation is distinct from captured original bytes.
 */
export interface RequiredWPRIssuerPublicOriginalLoanV1 {
 readCapturedPublicOriginals():Readonly<Omit<PublicOriginals,'freshCurrent'>>;
 readIndependentMaterializationDATA():WPRMaterializationDATA;
 assertCurrent():void;
 recheck():Promise<void>;
 retire():void;
 join():Promise<void>;
 close():Promise<void>;
 isClosed():boolean;
}
export type RequiredWPRIssuerPublicOriginalOutcomeV1 = Readonly<{owner:RequiredWPRIssuerPublicOriginalLoanV1|null;errorPresent:true;error:unknown}> | Readonly<{owner:RequiredWPRIssuerPublicOriginalLoanV1;errorPresent:false}>;
