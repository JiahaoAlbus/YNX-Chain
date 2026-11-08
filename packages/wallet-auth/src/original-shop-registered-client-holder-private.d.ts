import type {ProductBusinessReadInput} from './index.js';
import type {ProductSessionBusinessReadProofV4} from './product-session-device-v4.js';
declare const originalReadHolder:unique symbol;
/** Private SDK child reference; neither a Native grant nor a session credential.
 * Public constructors and DTOs cannot populate the two original inventories.
 * No Shop V2/POST proof or Auth strong-owner CABI is implemented here. */
export interface OriginalRegisteredClientReadHolder {
 readonly [originalReadHolder]:never;
 assertCurrent():void;
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
