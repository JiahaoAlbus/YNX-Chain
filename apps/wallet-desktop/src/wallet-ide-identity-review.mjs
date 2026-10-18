import {inspectOriginalAuthIdentityRequest} from '@ynx-chain/wallet-auth/auth-identity-contract';
import {createOriginalAuthIdentityProofAction} from './original-auth-identity-proof-action.mjs';
import {WalletIDEIdentityReviewKernel} from './wallet-ide-identity-review-kernel.mjs';
import {isWalletIDEIdentityEvidence} from './wallet-ide-identity-evidence.mjs';
// Original-Main-only factory. No caller-selected inspector, signer, native
// provider, clock, key/FD, request-purpose override or renderer permission.
export function createWalletIDEIdentityReview({vault,requestOriginal,expectedOriginal,purpose,snapshot,getSnapshot,assertCurrent,evidence}){
 if(!isWalletIDEIdentityEvidence(evidence))throw Object.assign(Error('Protected original result storage is required.'),{code:'AUTH_IDENTITY_PRIVATE_STORAGE_REQUIRED'});evidence.assertSafeToClose();
 if(getSnapshot!==undefined&&(typeof getSnapshot!=='function'||snapshot!==undefined))throw Object.assign(Error('Original registered snapshot selection is ambiguous.'),{code:'AUTH_IDENTITY_POLICY_REQUIRED'});
 return new WalletIDEIdentityReviewKernel({vault,requestOriginal,expectedOriginal,purpose,snapshot,assertCurrent,persistOriginal:record=>evidence.persist(record),inspect:inspectOriginalAuthIdentityRequest,createAction:args=>createOriginalAuthIdentityProofAction({...args,snapshot:getSnapshot?getSnapshot():args.snapshot}),now:Date.now});
}
