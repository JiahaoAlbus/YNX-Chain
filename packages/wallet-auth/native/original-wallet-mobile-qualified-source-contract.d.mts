export type MobileMode=1|2|3;
export type SourceRole='enrollment'|'profile'|'current';
export type RawField='binding'|'message'|'policy'|'keyVersion'|'executionHeight'|'review'|'encryptedBackup';
export type RawOriginals=Readonly<Record<RawField,Uint8Array>>;
export interface MobileContext {readonly networkId:string;readonly account:string;readonly platform:'ios'|'android';readonly applicationId:string;readonly protectedResourceRef:string;readonly nativeChainID:string;readonly vaultRevision:string;readonly registrationDigest:string;readonly keyVersion:string;readonly executionHeight:string;readonly nonce:string;readonly spendingBudgetOriginalDigest:string;}
export interface MobileScope {readonly version:'1';readonly mode:MobileMode;readonly reference:string;readonly originalOperationID:string;readonly context:MobileContext;readonly originals:Readonly<Record<RawField,Readonly<{bytes:number;sha256:string}>>>;readonly issuedAtMs:number;readonly expiresAtMs:number;}
export type IndependentMobileSelection=Pick<MobileScope,'mode'|'reference'|'originalOperationID'|'context'|'issuedAtMs'|'expiresAtMs'>;
export interface MobileStage {readonly scopeOriginal:string;readonly operation:string;readonly dataOnly:true;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;}
export interface SourceStatementBinding {readonly networkId:string;readonly owner:string;readonly keyVersion:string;readonly executionHeight:string;}
export declare const WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE:'wallet-mobile-qualified-source-v1';
export declare const WALLET_MOBILE_QUALIFIED_SOURCE_SELECTION_KEY:'walletMobileQualifiedV1';
export declare const WALLET_MOBILE_QUALIFIED_SOURCE_OPERATIONS:readonly ['mobile.transaction','mobile.registered-restore','mobile.original-query'];
export declare function inspectWalletMobileQualifiedSourceScopeV1DATA(value:MobileScope):Readonly<MobileScope & {operation:string;dataOnly:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
export declare function captureWalletMobileQualifiedOriginalsV1DATA(scope:MobileScope,independentSelection:IndependentMobileSelection,rawOriginals:RawOriginals,atMs:number):MobileStage;
export declare function assertWalletMobileQualifiedOriginalsUnchangedV1DATA(stage:MobileStage,rawOriginals:RawOriginals):MobileStage;
export declare function inspectWalletMobileQualifiedPhaseV1DATA(stage:MobileStage,phase:1|2|3|4|5,flags:number,osOutcomeAvailable:boolean):Readonly<{phase:number;readOnly:boolean;requiresRestoredCurrent:boolean;dataOnly:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
export declare function encodeWalletMobileQualifiedSourceStatementV1DATA(role:SourceRole,independentFrame:string,binding:SourceStatementBinding,bodyOriginal:string):Uint8Array;
export declare function encodeWalletMobileQualifiedSourceEnvelopeV1DATA(role:SourceRole,binding:SourceStatementBinding,bodyOriginal:string,member:Uint8Array):string;
