/** Node DATA only; no grant, signing, current, TPM floor or MAC verification. */
export interface SocialFD2InitializationDATA {readonly version:2;readonly kind:'firstDeviceInitializationSet';readonly storageGeneration:string;readonly policyGeneration:string;readonly requestDigest:string;readonly storeReference:string;readonly policyHead:string;readonly aads:readonly[string,string,string,string,string];readonly journalDigest:string;readonly ciphertextSetDigest:string}
export interface SocialFD2EngineCommitBodyDATA {readonly version:1;readonly purpose:'SOCIAL_FIRST_DEVICE_ENGINE_COMMIT_V1';readonly account:string;readonly device:string;readonly rootDigest:string;readonly registrationDigest:string;readonly deviceClassic:string;readonly devicePQ:string;readonly operation:string;readonly nonce:string;readonly baseRevision:'0';readonly nextRevision:'1';readonly baseHash:string;readonly nextHash:string;readonly cipherHash:string;readonly journalDigest:string;readonly sourceHead:string;readonly initialization:SocialFD2InitializationDATA}
export interface SocialFD2FactsOnly {readonly dataOnly:true;readonly ActualSource:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly MACVerified:false;readonly signatureVerified:false;readonly authorized:false}
export const SOCIAL_FD2_INITIALIZATION_FIELDS:readonly string[];
export const SOCIAL_FD2_ENGINE_COMMIT_FRAME:'YNX/SOCIAL/FIRST-DEVICE-ENGINE-COMMIT/V1\0';
export function inspectSocialFD2InitializationDATA(input:unknown):Readonly<SocialFD2InitializationDATA>;
export function decodeSocialFD2InitializationContextDATA(contextOriginal:Uint8Array,engineOriginal:Uint8Array):Readonly<SocialFD2FactsOnly&{initialization:SocialFD2InitializationDATA;contextOriginal:Uint8Array;engineOriginal:Uint8Array}>;
export function encodeSocialFD2InitializationDATA(input:SocialFD2InitializationDATA):Uint8Array;
export function inspectSocialFD2EngineCommitBodyDATA(input:unknown):Readonly<SocialFD2EngineCommitBodyDATA>;
export function encodeSocialFD2EngineCommitBodyDATA(input:SocialFD2EngineCommitBodyDATA):Uint8Array;
export function decodeSocialFD2EngineCommitBodyDATA(original:Uint8Array):Readonly<SocialFD2FactsOnly&{body:SocialFD2EngineCommitBodyDATA}>;
export function assertSocialFD2EngineOriginalBindingDATA(body:SocialFD2EngineCommitBodyDATA,contextOriginal:Uint8Array,engineOriginal:Uint8Array,journalOriginal:Uint8Array):Readonly<SocialFD2FactsOnly&{body:SocialFD2EngineCommitBodyDATA}>;
