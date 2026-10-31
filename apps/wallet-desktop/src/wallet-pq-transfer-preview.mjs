import {createHash} from 'node:crypto';
import {canonicalJSON} from '@ynx-chain/wallet-auth';
import {encodePQNativeTransfer,decodePQTransferRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {pqTransferReviewBinding,exactData} from './features/pq-transaction/transfer-binding.mjs';

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
/** A stored pre-sign intent is the same bounded public preview, not a permit.
 * Rebuild both bindings from its original fields; never upgrade old UNKNOWN
 * markers by inventing a missing intent or accept a changed recipient/nonce.
 */
export function parsePQTransferPreviewIntent(value,account){
 exactData(value,['version','id','principal','purpose','networkId','nativeChainId','recipient','amount','fee','nonce','policyRevision','createdAt','expiresAt','transactionBinding','binding','approved','signed','submitted']);
 for(const name of ['transactionBinding','binding'])exactData(value[name],['bytes','sha3_512','sha512']);
 const request={id:value.id,origin:'ynx-wallet:local-pq',method:'ynx_signPQNativeTransfer',params:[],createdAt:value.createdAt,review:{title:'Stored transfer intent',account:value.principal,chainId:value.networkId,nativeChainId:value.nativeChainId,from:value.principal,to:value.recipient,amount:value.amount,fee:value.fee,nonce:value.nonce,policyRevision:value.policyRevision,expiresAt:value.expiresAt,warning:'Stored DATA only; not an approval'}};
 const expected=createPQTransferPreview(request,{account,networkId:value.networkId});
 if(canonicalJSON(value)!==canonicalJSON(expected))throw Object.assign(Error('Stored transfer intent differs from its exact original review'),{code:'PQ_TRANSFER_INTENT_BINDING'});
 return expected;
}
/** Check a captured PUBLIC signed result against its pre-Native intent.
 * This is a local identity check, never signature verification or permission.
 * The caller retains the first native member before entering this check.
 */
export function assertPQTransferIntentOriginal(intent,original){
 const reviewed=parsePQTransferPreviewIntent(intent,original.account);
 const {transfer}=decodePQTransferRequest(Buffer.from(original.wire,'base64url'));
 if(original.kind!=='pq-transfer'||original.operationId!==reviewed.id||
    canonicalJSON(bind(Buffer.from(encodePQNativeTransfer(transfer))))!==canonicalJSON(reviewed.transactionBinding))
  throw Object.assign(Error('Keep the returned original; it differs from the durable signing intent'),{code:'PQ_TRANSFER_INTENT_RESULT_MISMATCH'});
}
