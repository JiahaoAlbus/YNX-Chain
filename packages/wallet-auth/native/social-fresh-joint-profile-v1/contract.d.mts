/** Reference metadata types only; runtime implementation is Go body.go.
 * No JS encoder, protected owner, signer, Source or permission is supplied. */
declare const decimalU64:unique symbol;
export type LosslessU64DecimalDATA=string&{readonly [decimalU64]:never};
export interface Scope7DATA{readonly source:string;readonly store:string;readonly schema:string;readonly inode:string;readonly restore:string;readonly sourceGeneration:LosslessU64DecimalDATA;readonly nativeRestoreIncarnation:LosslessU64DecimalDATA;}
export interface FreshCapturedOriginalsDATA{readonly historyEnvelopeOriginal:Uint8Array;readonly issuerCredentialOriginal:Uint8Array;readonly anchorCredentialOriginal:Uint8Array;readonly registrationOriginal:Uint8Array;readonly scope:Scope7DATA;readonly issuerEpoch:LosslessU64DecimalDATA;readonly anchorEpoch:LosslessU64DecimalDATA;readonly historyIssuedMS:number;readonly historyExpiresMS:number;readonly capturedDeadlineMS:number;}
export interface JointProfilePlanDATA{readonly bodyOriginal:Uint8Array;readonly historyOriginalSHA256:string;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;}
/** Go uint64 body JSON numbers are not JS Number. These are transport/collector
 * metadata strings only and must never change original signed body encoding. */
export interface SourceRoleSignatureFactsDATA{readonly domain:'YNX/SOCIAL/SOURCE-PROOF/V1\0';readonly issuerRole:'record-issuer';readonly anchorRole:'record-anchor';readonly classicPublic:Uint8Array;readonly pqPublic:Uint8Array;}
