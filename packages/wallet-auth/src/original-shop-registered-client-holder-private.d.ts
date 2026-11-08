import type {ProductBusinessReadInput} from './index.js';
import type {ProductSessionBusinessReadProofV4} from './product-session-device-v4.js';
declare const originalReadHolder:unique symbol;
/** Private SDK child reference; neither a Native grant nor a session credential.
 * Public constructors and DTOs cannot populate the two original inventories.
 * No Shop V2/POST proof or Auth strong-owner CABI is implemented here. */
export interface OriginalRegisteredClientReadHolder {
 readonly [originalReadHolder]:never;
 assertCurrent():void;
 /** SAME already-held actual Native Device Source object for the fixed Native
  * strong matcher. Borrow only: no Source acquisition, close or authority. */
 readOriginalNativeDeviceSource():unknown;
 createBusinessProof(input:ProductBusinessReadInput):Promise<ProductSessionBusinessReadProofV4>;
 /** Drops this reference only. Never closes the Native Source parent. */
 release():void;
 statusDATA():Readonly<{released:boolean;readOnly:true;NativeAdmission:false;SourceAdmission:false}>;
}
/** Only a child returned by the original normal factory AND a device/current
 * pair from the zeroarg fixed Native acquisition is accepted at runtime. */
export function captureOriginalRegisteredClientReadHolder(read:unknown):OriginalRegisteredClientReadHolder;

export type OriginalRegisteredClientGETProofOriginal=Readonly<{
 proofHeaderName:'x-ynx-product-session-proof-v4';proofHeader:string;
 issuedAt:string;expiresAt:string;issuedAtMs:number;expiresAtMs:number;
}>;
/** Same private captured loan, one original GET path and one proof flight.
 * Times come exclusively from the sole-decoded SAME original V4 header.
 * No SourceComparison/Native Shop identity is granted by this function. */
export function createOriginalRegisteredClientGETProof(loan:OriginalRegisteredClientReadHolder,originalPath:string):Promise<OriginalRegisteredClientGETProofOriginal>;

export interface OriginalDeviceSourceReferenceDATA {
 readonly purpose:'product-session-device-source-v4';readonly sourceId:string;readonly instanceId:string;
 /** Source generation, never device generation; exact safe integer. */
 readonly generation:number;readonly accountIssuer:string;readonly accountSubject:string;
}
export function readOriginalRegisteredClientSourceReferenceDATA(loan:OriginalRegisteredClientReadHolder|OriginalRegisteredProductReadHolder):Readonly<OriginalDeviceSourceReferenceDATA>;
declare const productScopedRead:unique symbol;
/** Native true ProductBorrow/current and actual recognized DEVICE/env/actor/current matcher remain
 * independently required. This SDK scope DATA match grants neither. */
export interface OriginalRegisteredProductReadHolder {
 readonly [productScopedRead]:never;
 assertCurrent():void;readOriginalNativeDeviceSource():unknown;release():void;
 statusDATA():Readonly<{released:boolean;readOnly:true;NativeAdmission:false;SourceAdmission:false}>;
}
export function captureOriginalRegisteredClientReadHolderForProductSource(read:unknown,scopeDATA:import('../native/original-wallet-product-source-contract.mjs').WalletProductSourceScopeV1):OriginalRegisteredProductReadHolder;
export function createOriginalRegisteredClientGETProof(loan:OriginalRegisteredProductReadHolder,originalPath:string):Promise<OriginalRegisteredClientGETProofOriginal>;
