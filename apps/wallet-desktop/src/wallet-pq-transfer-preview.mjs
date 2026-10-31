import {createHash} from 'node:crypto';
import {canonicalJSON} from '@ynx-chain/wallet-auth';
import {encodePQNativeTransfer} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {pqTransferReviewBinding} from './features/pq-transaction/transfer-binding.mjs';

const bind=bytes=>Object.freeze({bytes:String(bytes.length),sha3_512:createHash('sha3-512').update(bytes).digest('hex'),sha512:createHash('sha512').update(bytes).digest('hex')});
/** Public immutable display DATA from the existing trusted pending review.
 * Neither digest is a signature/permission. The existing signer still signs
 * the SDK's complete native transfer bytes, never this local display digest.
 */
export function createPQTransferPreview(request,expected){
 const original=pqTransferReviewBinding(request,expected);
 const transfer=Object.fromEntries(['chainId','nativeChainId','from','to','amount','fee','nonce'].map(key=>[key,original[key]]));
 const transactionBinding=bind(Buffer.from(encodePQNativeTransfer(transfer)));
 const display=Object.freeze({version:'YNX-WALLET-PENDING-TRANSFER/v1',id:request.id,principal:original.account,purpose:'pq-native-transfer',networkId:original.chainId,nativeChainId:original.nativeChainId,recipient:original.to,amount:original.amount,fee:original.fee,nonce:original.nonce,policyRevision:original.policyRevision,createdAt:original.createdAt,expiresAt:original.expiresAt,transactionBinding});
 return Object.freeze({...display,binding:bind(Buffer.from(canonicalJSON(display),'utf8')),approved:false,signed:false,submitted:false});
}
