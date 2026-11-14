import type {ProductBusinessReadInput} from '@ynx-chain/wallet-auth';
import type {ProductSessionBusinessReadProofV4} from '@ynx-chain/wallet-auth/product-session-device-v4';
/** Backend-owned lifetime. This interface never supplies Root or Native admission. */
export interface OriginalIDEHeldRead {
 assertCurrent():Promise<void>;
 createBusinessProof(input:ProductBusinessReadInput):Promise<ProductSessionBusinessReadProofV4>;
 retire():void;
 close():Promise<void>;
 status():Readonly<{ready:boolean;retired:boolean;closed:boolean;acquisitionEntered:boolean;ownerRetained:boolean;activeOperations:number;firstCausePresent:boolean;cleanupFailed:boolean;cleanupPending:boolean;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;connected:false;newSession:false}>;
}
/** Production always selects the original zero-input Node SDK factory. */
export function createOriginalIDEHeldRead():OriginalIDEHeldRead;
