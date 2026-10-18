import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import {decodePQTypedActionBroadcastResponse} from './typed-action-query.mjs';

export const PQ_TYPED_ACTION_BROADCAST_PATH='/transactions/pq/actions/broadcast';
export const PQ_TYPED_ACTION_BROADCAST_RPC_BYTES=792658;
const fail=code=>{throw Object.assign(Error(code),{code})};

/** Original raw transport only. This plan grants no authority and makes no I/O.
 * Protocol3163 profile includes JSON-RPC base64 framing; never strip material.
 * SDK332 lacks complete deploy material; Main fences it before keys, and this
 * retained-original plan also refuses it before any network I/O. */
export function preparePQReviewedTypedActionBroadcast(review,raw,original){
 const local=inspectPQReviewedTypedTransportOriginal(review,raw,original);
 if(local.action.kind==='contract_deploy')fail('PQ_TYPED_CONTRACT_MATERIAL_UNAVAILABLE');
 if(4*Math.ceil(local.body.byteLength/3)+74>PQ_TYPED_ACTION_BROADCAST_RPC_BYTES)fail('PQ_TYPED_ACTION_RPC_PROFILE_EXCEEDED');
 const request={method:'POST',path:PQ_TYPED_ACTION_BROADCAST_PATH,contentType:'application/json',memberHash:local.memberHash,transportHash:local.transportHash,admissionIsFinality:false};
 Object.defineProperty(request,'body',{enumerable:true,get:()=>local.body});
 return Object.freeze(request);
}

/** Parse only after original Main has retained complete HTTP response bytes.
 * Error-only responses provide no body identity and remain outcome-unknown. */
export function inspectPQReviewedTypedActionBroadcast(review,raw,original,response){
 const local=inspectPQReviewedTypedTransportOriginal(review,raw,original),decoded=decodePQTypedActionBroadcastResponse(response),v=decoded.view;
 if(v&&(v.nativeTransactionHash!==local.memberHash||v.abciTransactionHash!==local.transportHash||v.type!==local.action.kind||v.from!==local.account||v.fee!==local.action.fee||v.nonce!==local.action.nonce||!Buffer.from(v.wire,'base64').equals(local.member)||!Buffer.from(v.transport,'base64').equals(local.body)))fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 const outcome=v?.status==='committed'?'inclusion-observed':v?.status==='rejected'?'rejection-observed':'outcome-unknown';
 return Object.freeze({kind:'pq-typed-action',operationId:local.operationId,account:local.account,networkId:local.networkId,
  memberHash:local.memberHash,transportHash:local.transportHash,requestDigest:local.requestDigest,actionKind:local.action.kind,nonce:local.action.nonce,
  policyRevision:local.policyRevision,reviewExecutionHeight:local.reviewExecutionHeight,signingExecutionHeight:local.executionHeight,
  memberCount:1,memberIndex:0,signatureVerified:true,classicWitnessValidationRequired:local.classicWitnessValidationRequired,
  requestPath:decoded.requestPath,httpStatus:decoded.httpStatus,outcome,observedStatus:v?.status??null,
  observedExecutionHeight:v?.executionHeight??null,cometIndex:v?.cometIndex??null,bodyIdentityObserved:!decoded.errorOnly,
  httpResponseInspected:true,dataOnly:true,observationOnly:true,effectsVerified:false,proofVerification:'not-performed',independentFinality:false,
  nativeAdmission:false,permissionGranted:false,submitted:false,canRetry:false,clearsOriginal:false,consensusFinality:false});
}
