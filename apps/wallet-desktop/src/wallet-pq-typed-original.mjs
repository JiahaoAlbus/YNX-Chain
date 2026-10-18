import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {inspectPQReviewedTypedTransportOriginal} from './features/pq-transaction/typed-action-reviewed-transport.mjs';
import {PRIVATE_FILE_MAX_BYTES} from './bounded-private-file-read.mjs';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {createHash} from 'node:crypto';
const fail=()=>{throw Object.assign(new Error('Keep the original typed PQ record; its retained inputs could not be verified.'),{code:'PQ_TYPED_ORIGINAL_INVALID'})};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value};
function inspect(value){
 exactPQRecord(value,['version','account','kind','operationId','hash','wire','status','typed']);
 if(value.version!==2||value.kind!=='pq-typed-action'||value.status!=='signed-unsubmitted'||!/^0x[0-9a-f]{40}$/.test(value.account??'')||!/^0x[0-9a-f]{64}$/.test(value.hash??'')||typeof value.operationId!=='string'||!value.operationId||value.operationId.length>128||typeof value.wire!=='string'||value.wire.length>PRIVATE_FILE_MAX_BYTES||!value.wire.match(/^[A-Za-z0-9_-]+$/))fail();
 exactPQRecord(value.typed,['networkId','memberHash','review','reviewSnapshot','signingSnapshot']);
 const t=value.typed;if(!/^[0-9a-f]{64}$/.test(t.networkId??'')||!/^0x[0-9a-f]{64}$/.test(t.memberHash??''))fail();
 const wire=Buffer.from(value.wire,'base64url');if(!wire.length||wire.toString('base64url')!==value.wire)fail();
 const network={owner:value.account,chainId:t.networkId,nativeChainId:'6423'};
 // Parse both exact archived public snapshots using the original SDK. Never
 // fetch latest state, decrement a nonce, reconstruct H or register a review.
 const reviewSnapshot=parsePQAccountAuthorization(t.reviewSnapshot,network),signingSnapshot=parsePQAccountAuthorization(t.signingSnapshot,network);
 const result=inspectPQReviewedTypedTransportOriginal(t.review,wire,{reviewSnapshot,signingSnapshot,selectedBinding:{account:value.account,networkId:t.networkId},memberHash:t.memberHash,transportHash:value.hash});
 if(result.operationId!==value.operationId||Buffer.byteLength(JSON.stringify(value))>PRIVATE_FILE_MAX_BYTES-65536)fail();
 return result;
}
export function parsePQTypedOriginalRecord(value){
 try{inspect(value);return freeze(JSON.parse(JSON.stringify(value)))}catch{fail()}
}
/** Called only after Main has retained the returned Member in its original
 * pre-sign slot. Encoding is not signing, sending or permission acquisition. */
export function createPQTypedOriginalFromMember(member,{review,reviewSnapshot,signingSnapshot}){
 const wire=encodePQActionTransportData({member,originals:[]}),hash=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
 return {version:2,account:review.account,kind:'pq-typed-action',operationId:review.operationId,hash:hash(wire),wire:Buffer.from(wire).toString('base64url'),status:'signed-unsubmitted',typed:{networkId:review.networkId,memberHash:hash(member),review:JSON.parse(JSON.stringify(review)),reviewSnapshot:JSON.parse(JSON.stringify(reviewSnapshot)),signingSnapshot:JSON.parse(JSON.stringify(signingSnapshot))}};
}
export function pqTypedOriginalSummary(value){
 try{
  const result=inspect(value);
  return Object.freeze({account:result.account,kind:'pq-typed-action',operationId:result.operationId,hash:result.transportHash,memberHash:result.memberHash,networkId:result.networkId,
   actionKind:result.action.kind,nonce:result.action.nonce,reviewExecutionHeight:result.reviewExecutionHeight,executionHeight:result.executionHeight,
   status:'pq-signed-unsubmitted',outcome:'original-verified-locally',signatureVerified:true,classicWitnessValidationRequired:result.classicWitnessValidationRequired,
   networkQueryPerformed:false,dataOnly:true,nativeAdmission:false,permissionGranted:false,submitted:false,canRetryExact:false,canRetry:false,clearsOriginal:false,consensusFinality:false});
 }catch{fail()}
}
