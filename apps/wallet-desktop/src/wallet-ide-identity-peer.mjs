import {acquireOriginalIDEWalletIdentitySource,isOriginalIDEWalletIdentitySource} from '@ynx-chain/wallet-auth/original-ide-admission';
import {parseOriginalAuthIdentityRequest,inspectOriginalAuthIdentityRequest} from '@ynx-chain/wallet-auth/auth-identity-contract';
import {acquireOriginalWalletRegisteredBinding,isOriginalWalletRegisteredBinding,RegisteredBindingResourceKernel} from './original-policy-supplier/registered-binding-resource.mjs';
import {WalletIDEIdentityPeerKernel} from './wallet-ide-identity-peer-kernel.mjs';
import {WalletIDEIdentityEvidence} from './wallet-ide-identity-evidence.mjs';
import {createWalletIDEIdentityReview} from './wallet-ide-identity-review.mjs';
/** Original Main-only fixed production wiring; requires matching SDK330/R114.
 * No caller-selected Native module, Source purpose/path/FD/PID/root, snapshot,
 * signer, approval flag or clock. The registered resource supplies DATA only.
 */
export function createWalletIDEIdentityPeer({vault,directory}){
 const evidence=new WalletIDEIdentityEvidence({directory});
 const inspect=raw=>{const body=parseOriginalAuthIdentityRequest(raw);return inspectOriginalAuthIdentityRequest(raw,raw,body.purpose,String(Date.now())).body;};
 return new WalletIDEIdentityPeerKernel({evidence,acquireSource:()=>acquireOriginalIDEWalletIdentitySource(),isSource:isOriginalIDEWalletIdentitySource,inspect,
  createReview:args=>createWalletIDEIdentityReview({...args,vault,evidence}),
  acquirePolicy:body=>acquireOriginalWalletRegisteredBinding({networkId:body.networkId,nativeChainId:'6423',owner:body.owner,operation:'read-registered-binding',at:new Date().toISOString()}),
  isPolicy:isOriginalWalletRegisteredBinding,isPolicyCleanupOwner:value=>isOriginalWalletRegisteredBinding(value)||value instanceof RegisteredBindingResourceKernel});
}
