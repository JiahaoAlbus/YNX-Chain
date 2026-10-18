import {types} from 'node:util';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import {decodePQFinalityCollectorData} from './finality-collector.mjs';

const fail=code=>{throw Object.assign(Error(code),{code})};
const invalid=()=>fail('PQ_TYPED_FINALITY_RESPONSE_INVALID');
const responseFields=['method','requestPath','status','contentType','cacheControl','body'];
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get;
const detached=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached').get;
// Original Protocol fixes the conflicting ServeMux pattern using this exact
// ABCI-only route. No fallback to the colliding actions/{hash} pattern.
const path=hash=>'/txs/'+hash+'/pq-action-finality-proof';
function responseData(input){
 if(!input||typeof input!=='object'||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(ds);
 if(keys.length!==responseFields.length||keys.some(k=>!responseFields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))invalid();
 const response=Object.fromEntries(responseFields.map(k=>[k,ds[k].value]));
 if(response.method!=='GET'||typeof response.requestPath!=='string'||!/^\/txs\/0x[0-9a-f]{64}\/pq-action-finality-proof$/.test(response.requestPath)||response.cacheControl!=='no-store'||typeof response.contentType!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.contentType))invalid();
 if(types.isProxy(response.body)||!types.isUint8Array(response.body))invalid();
 const buffer=bufferOf.call(response.body);
 if(types.isSharedArrayBuffer(buffer)||resizable.call(buffer)||detached.call(buffer))invalid();
 return response;
}

/** Fixed ABCI route observes committed and rejected DATA. No authority or I/O. */
export function planPQReviewedTypedActionFinalityCollector(review,raw,original){
 const local=inspectPQReviewedTypedTransportOriginal(review,raw,original);
 return Object.freeze({method:'GET',path:path(local.transportHash)});
}

/** Original Main owns raw evidence and proof; only observation may reach UI.
 * The exact original full transport and both snapshots are validated by aeeb.
 * Existing collector JSON/proof DATA grammar is reused, not a proof verifier.
 * Observed H/index are independent from original signing H/Member index. */
export function inspectPQReviewedTypedActionFinalityCollector(review,raw,original,response){
 const local=inspectPQReviewedTypedTransportOriginal(review,raw,original),http=responseData(response);
 if(http.requestPath!==path(local.transportHash))fail('PQ_FINALITY_ORIGINAL_MISMATCH');
 const {view,proof,rawSha256,byteLength}=decodePQFinalityCollectorData({nativeTransactionHash:local.memberHash,abciTransactionHash:local.transportHash},http.status,http.body);
 const observation=Object.freeze({kind:'pq-typed-action',transactionType:'pq_action',operationId:local.operationId,
  account:local.account,networkId:local.networkId,memberHash:local.memberHash,transportHash:local.transportHash,requestDigest:local.requestDigest,
  actionKind:local.action.kind,nonce:local.action.nonce,policyRevision:local.policyRevision,
  reviewExecutionHeight:local.reviewExecutionHeight,signingExecutionHeight:local.executionHeight,
  memberCount:1,memberIndex:0,signatureVerified:true,classicWitnessValidationRequired:local.classicWitnessValidationRequired,
  source:'configured-comet-rpc',status:view.status,observedExecutionStatus:view.observedExecutionStatus??null,
  observedNativeTransactionHash:view.nativeTransactionHash,observedABCITransactionHash:view.abciTransactionHash,
  observedExecutionHeight:view.executionHeight,cometIndex:view.cometIndex??null,requestPath:http.requestPath,httpStatus:http.status,
  dataOnly:true,observationOnly:true,httpResponseInspected:true,proofVerification:'not-performed',independentFinality:false,
  nativeAdmission:false,permissionGranted:false,submitted:false,canRetry:false,clearsOriginal:false,consensusFinality:false});
 return Object.freeze({observation,proof,rawSha256,byteLength});
}
