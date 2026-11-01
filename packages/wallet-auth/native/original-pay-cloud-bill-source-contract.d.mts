import type{OriginalAuthSourceV2Policy}from'./original-auth-identity-source-v2-verifier.mjs';
export const PAY_NATIVE_CLOUD_BILL_SOURCE_PURPOSE:'pay-native-cloud-bill-source-v1';
export const PAY_NATIVE_CLOUD_BILL_SELECTION_KEY:'payNativeCloudBillV1';
export const PAY_NATIVE_CLOUD_BILL_OPERATIONS:readonly ['create','read','lookup','merchant_review','submit_merchant_member','reconcile','prepare_terms','register_terms','review_settlement','settle','review_refund','refund'];
export type PayNativeCloudBillOperation=typeof PAY_NATIVE_CLOUD_BILL_OPERATIONS[number];
export interface OriginalPayCloudBillSourceV2Policy extends OriginalAuthSourceV2Policy {
 readonly platform:'linux'|'macos'|'windows';readonly productId:string;readonly applicationId:string;
 readonly signatureContract:Readonly<{purpose:typeof PAY_NATIVE_CLOUD_BILL_SOURCE_PURPOSE;enrollmentFrame:string;profileFrame:string;currentFrame:string}>;
}
export interface PayCloudBillLocatorV1 {
 readonly owner:string;readonly requestId:string;readonly period:string;readonly projectId:string;
 readonly projectRef:Readonly<{realm:string;tenant:string;kind:string;id:string;rev:string}>;
 readonly resourceId:string;readonly manifestSHA256:string;readonly artifactSHA256:string;
}
export interface PayCloudBillNativeTermsV1 {
 readonly invoiceId:string;readonly sessionId:string;readonly recipient:string;readonly payer:string;
 readonly assetId:'YNXT';readonly unitVersion:'1';readonly feeRule:'native-transfer-fee-one/v1';
 readonly keyEpoch:string;readonly revision:string;readonly amountAtoms:string;readonly maxFeeAtoms:'1';readonly expiresAtHeight:string;
}
export interface PayCloudBillMappingRecordV1 {
 /** Exact original Go json.Marshal NativeInvoiceProductIntent; never sorted or replaced. */
 readonly intentOriginal:string;readonly productMerchantID:string;readonly terms:PayCloudBillNativeTermsV1;
 readonly operations:readonly PayNativeCloudBillOperation[];readonly untilMs:number;readonly cloudOriginal:PayCloudBillLocatorV1;
}
export interface PayCloudBillCallerMappingV1 {
 readonly service:string;readonly principal:string;readonly peerUID:number;readonly peerPID:number;
 readonly operations:readonly PayNativeCloudBillOperation[];
 readonly routes:Readonly<Record<string,readonly PayNativeCloudBillOperation[]>>;
 readonly untilMs:number;readonly bills:readonly PayCloudBillMappingRecordV1[];
 /** Independent exact Action.SigningBytes SHA256 windows; DATA alone cannot submit. */
 readonly submissions:Readonly<Record<string,number>>;
}
export interface OriginalPayCloudBillMappingV1 {
 readonly version:'1';readonly bindings:readonly PayCloudBillCallerMappingV1[];
 /** Locator of separately authenticated proof anchor, never Root from JSON. */
 readonly anchor:Readonly<{path:string;sha256:string;chainId:string;trustingPeriodMs:number;maxClockDriftMs:number;trustNumerator:number;trustDenominator:number}>;
}
export interface OriginalPayCloudBillMappingInspectionV1DATA {
 readonly mappingOriginal:string;readonly mapping:OriginalPayCloudBillMappingV1;readonly effectExpiresAtMs:number;
 readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly approval:false;readonly submitAuthority:false;readonly proofAnchorTrusted:false;
}
export function inspectOriginalPayCloudBillMappingV1DATA(value:unknown,networkId:string,subjectOwner:string,profileExpiresAtMs:number,atMs:number):OriginalPayCloudBillMappingInspectionV1DATA;
