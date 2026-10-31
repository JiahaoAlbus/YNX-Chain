import type{ProductSessionPlatform}from'./index.js';
import type{PublicContentBinding}from'./public-content-binding.js';
export declare const DEVICE_CREATE_INTENT_DOMAIN:'YNX-PRODUCT-DEVICE-CREATE/v1';
export declare const DEVICE_CREATE_IDENTITY_DOMAIN:'YNX-PRODUCT-DEVICE-IDENTITY/v1';
export declare const DEVICE_PROVISIONING_SOURCE_PURPOSE:'product-session-device-provisioning-source-v4';
export interface OriginalDeviceCreateIntentInputDATA {
 readonly networkId:string;readonly canonicalOwner:string;readonly account:string;
 readonly productId:string;readonly clientId:string;readonly platform:ProductSessionPlatform;
 readonly applicationId:string;readonly bundleId:string|null;readonly packageId:string|null;readonly origin:string;readonly callback:string;
 readonly deviceId:string;readonly generation:string;readonly operationId:string;readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;
}
export type OriginalDeviceCreateSelectionDATA=Pick<OriginalDeviceCreateIntentInputDATA,'networkId'|'canonicalOwner'|'account'|'productId'|'clientId'|'deviceId'>;
export interface OriginalDeviceCreateIntentDATA {
 readonly terms:Readonly<OriginalDeviceCreateIntentInputDATA&{version:'1';domain:typeof DEVICE_CREATE_INTENT_DOMAIN}>;
 readonly approvedTerms:string;readonly stableDeviceIdentity:string;
 readonly binding:PublicContentBinding;readonly stableIdentityBinding:PublicContentBinding;
 /** DATA mapping for Auth's NEW Native contract. The historical approvedTerms
  * field name is not consent. Auth must independently cap the native window to
  * the earliest admitted Source/profile/actual Main approval expiry. */
 readonly nativeIntentDATA:Readonly<{network:string;stableDeviceIdentity:string;approvedTerms:string;issuedAtMs:string;expiresAtMs:string}>;
 readonly timeBasis:'original-issued-at-data-only';readonly dataOnly:true;readonly userApproved:false;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
export function createOriginalDeviceCreateIntentDATA(input:OriginalDeviceCreateIntentInputDATA):OriginalDeviceCreateIntentDATA;
export function inspectOriginalDeviceCreateIntentDATA(originalBytes:Uint8Array):OriginalDeviceCreateIntentDATA;
export function assertOriginalDeviceCreateSelectionDATA(view:OriginalDeviceCreateIntentDATA,independent:OriginalDeviceCreateSelectionDATA):Readonly<{selectionMatches:true;dataOnly:true;userApproved:false;SourceAdmission:false;NativeAdmission:false}>;
export function assertOriginalDeviceCreateIntentUnchangedDATA(original:OriginalDeviceCreateIntentDATA,current:OriginalDeviceCreateIntentDATA):Readonly<{originalMatches:true;dataOnly:true;userApproved:false;SourceAdmission:false;NativeAdmission:false}>;
