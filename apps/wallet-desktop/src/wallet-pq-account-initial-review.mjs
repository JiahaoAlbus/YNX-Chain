import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {pqPublicBindingToRegistrationKeys,encodePQRegistrationIntent,decodePQAccountInitialRequest,pqU64} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountInitialOriginal} from './wallet-pq-account-initial-original.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,data:{code}});};
const hash=b=>createHash('sha256').update(b).digest('hex');
function context(value){
 exactPQRecord(value,['account','networkId','operationId','createdAt','expiresAt']);
 if(!/^0x[0-9a-f]{40}$/.test(value.account??'')||! /^[0-9a-f]{64}$/.test(value.networkId??'')||! /^[A-Za-z0-9_-]{1,128}$/.test(value.operationId??''))fail('PQ_INITIAL_REVIEW_BINDING');
 const at=Date.parse(value.createdAt),end=Date.parse(value.expiresAt);
 if(!Number.isSafeInteger(at)||!Number.isSafeInteger(end)||new Date(at).toISOString()!==value.createdAt||new Date(end).toISOString()!==value.expiresAt||end<=at||end-at>30000)fail('PQ_INITIAL_REVIEW_TIME');
 return value;
}
// A fixed request for a future original Auth permission, NOT a permission.
// No active-policy placeholder, Genesis trust claim or transferable capability.
function request(action,intent,c,extra={}){
 context(c);if(intent.owner!==c.account||intent.chainId!==c.networkId)fail('PQ_INITIAL_REVIEW_BINDING');
 return Object.freeze({version:1,kind:'account-initial',action,purpose:'TX-BATCH',networkId:c.networkId,nativeChainId:'6423',account:c.account,operationId:c.operationId,origin:'ynx-wallet:local-pq',requestDigest:hash(encodePQRegistrationIntent(intent)),intent:Object.freeze({...intent}),createdAt:c.createdAt,expiresAt:c.expiresAt,dataOnly:true,bootstrapAdmission:false,...extra});
}
export function normalizePQAccountInitialInput(input){
 if(types.isProxy(input))fail('PQ_INITIAL_ACTIVATION_REQUIRED');
 exactPQRecord(input,['activateAt']);
 if(typeof input.activateAt!=='string'||!pqU64(input.activateAt))fail('PQ_INITIAL_ACTIVATION_REQUIRED');
 return Object.freeze({activateAt:input.activateAt});
}
export function preparePQAccountInitialSignReview(binding,input,c){
 const selected=normalizePQAccountInitialInput(input);
 const keys=pqPublicBindingToRegistrationKeys(binding),intent=Object.freeze({...keys,priorRevision:'0',newRevision:'1',ledgerNonce:'1',activateAt:selected.activateAt});
 return request('sign',intent,c);
}
export function preparePQAccountInitialBroadcastReview(value,c){
 const original=parsePQAccountInitialOriginal(value),decoded=decodePQAccountInitialRequest(Buffer.from(original.wire,'base64url'),original.initialBinding);
 return request('broadcast',decoded.intent,c,{originalOperationId:original.operationId,transportHash:original.hash,abciTransactionHash:original.abciTransactionHash,executionHeight:original.initialBinding.executionHeight});
}
export function projectPQAccountInitialReview(request){
 return Object.freeze({title:request.action==='sign'?'预览新账户登记签名 / Preview initial registration signing':'预览提交原登记 / Preview original registration submission',account:request.account,networkId:request.networkId,nativeChainId:request.nativeChainId,operationId:request.operationId,action:request.action,purpose:request.purpose,requestDigest:request.requestDigest,priorRevision:'0',newRevision:'1',nonce:'1',registrationFee:'0 YNXT',activateAt:request.intent.activateAt,publicKeyASHA256:hash(Buffer.from(request.intent.pkA,'hex')),publicKeyBSHA256:hash(Buffer.from(request.intent.pkB,'hex')),...(request.action==='broadcast'?{originalOperationId:request.originalOperationId,transportHash:request.transportHash,abciTransactionHash:request.abciTransactionHash,executionHeight:request.executionHeight}:{}),expiresAt:request.expiresAt,effectReady:false,warning:'仅预览固定新账户登记，不是迁移或活动策略。尚未验证原 Genesis、独立 pin、空闲账户及 Native 许可；确认不能签名或发送。签名和提交需分别批准，UNKNOWN 不允许重试。 / Preview only, not migration or active policy. Original Genesis, independent pin, unused owner and Native permission are not yet verified. Confirmation cannot sign or send. Signing and submission require separate approvals; UNKNOWN never permits retry.'});
}
