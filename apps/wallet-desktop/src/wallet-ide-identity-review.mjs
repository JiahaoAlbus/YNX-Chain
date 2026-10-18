import {inspectOriginalAuthIdentityRequest} from '@ynx-chain/wallet-auth/auth-identity-contract';
import {createOriginalAuthIdentityProofAction} from './original-auth-identity-proof-action.mjs';
import {WalletIDEIdentityReviewKernel} from './wallet-ide-identity-review-kernel.mjs';
// Original-Main-only factory. No caller-selected inspector, signer, native
// provider, clock, key/FD, request-purpose override or renderer permission.
export function createWalletIDEIdentityReview({vault,requestOriginal,expectedOriginal,purpose,snapshot,assertCurrent,persistOriginal}){
 return new WalletIDEIdentityReviewKernel({vault,requestOriginal,expectedOriginal,purpose,snapshot,assertCurrent,persistOriginal,inspect:inspectOriginalAuthIdentityRequest,createAction:createOriginalAuthIdentityProofAction,now:Date.now});
}
