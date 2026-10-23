import {types} from 'node:util';
import {inspectPQTypedActionMember} from './typed-action-caller.mjs';
import {inspectPQTypedActionTransportOriginal,inspectPQContractDeploymentTransportOriginal} from './typed-action-transport-reader.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
function exact(value,fields){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID');
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length!==fields.length||keys.some(k=>!fields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID');
 return Object.fromEntries(fields.map(k=>[k,ds[k].value]));
}

/** Main's retained review + transport read. Both snapshots and both hashes
 * come from original custody, never latest-state reconstruction. This composes
 * the existing readers; it registers no review and invokes no signer/sender.
 * Original operation ID is validated journal metadata, not a signed claim. */
export function inspectPQReviewedTypedTransportOriginal(archivedReview,rawTransport,original){
 const saved=exact(original,['reviewSnapshot','signingSnapshot','selectedBinding','memberHash','transportHash']);
 const selected=exact(saved.selectedBinding,['account','networkId']);
 // Read only DATA descriptors to select the codec. The full review is still
 // verified below against both original snapshots and the retained Member.
 if(!archivedReview||types.isProxy(archivedReview))fail('PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID');
 const ad=Object.getOwnPropertyDescriptor(archivedReview,'action');
 if(!ad||!Object.hasOwn(ad,'value')||!ad.value||types.isProxy(ad.value))fail('PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID');
 const kd=Object.getOwnPropertyDescriptor(ad.value,'kind');
 if(!kd||!Object.hasOwn(kd,'value'))fail('PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID');
 const deployment=kd.value==='contract_deploy';
 // f160 verifies the retained transport hash BEFORE decoding, then the Member
 // hash and SDK332 policy/full dual-AND signature semantics. Capture is private
 // to that reader and accessors return fresh byte copies.
 const transport=(deployment?inspectPQContractDeploymentTransportOriginal:inspectPQTypedActionTransportOriginal)(saved.signingSnapshot,rawTransport,
  {account:selected.account,networkId:selected.networkId,memberHash:saved.memberHash,transportHash:saved.transportHash});
 // 371 verifies the complete archived review against both original snapshots,
 // exact action/digest/pair/revision/H/nonce and the original local N1/index0.
 const member=inspectPQTypedActionMember(archivedReview,transport.member,
  {reviewSnapshot:saved.reviewSnapshot,signingSnapshot:saved.signingSnapshot,selectedBinding:selected});
 if(member.memberHash!==transport.memberHash||member.account!==transport.account||member.networkId!==transport.networkId||member.policyRevision!==transport.keyVersion||member.executionHeight!==transport.executionHeight||member.memberCount!==transport.memberCount||member.memberIndex!==transport.memberIndex||member.purpose!==transport.purpose)fail('PQ_REVIEWED_TRANSPORT_BINDING_MISMATCH');
 const result={operationId:member.operationId,account:member.account,networkId:member.networkId,
  action:member.action,pair:member.pair,requestDigest:member.requestDigest,policyRevision:member.policyRevision,
  reviewExecutionHeight:saved.reviewSnapshot.executionHeight,executionHeight:member.executionHeight,
  memberHash:member.memberHash,transportHash:transport.transportHash,purpose:member.purpose,
  memberCount:1,memberIndex:0,originalsCount:transport.originalsCount,signatureVerified:true,
  classicWitnessValidationRequired:transport.classicWitnessValidationRequired,dataOnly:true,nativeAdmission:false,
  permissionGranted:false,submitted:false,canRetry:false,clearsOriginal:false,consensusFinality:false,
  // Do not spread transport: that would materialize mutable byte properties.
  get body(){return transport.body;},get member(){return transport.member;},get originals(){return transport.originals;}};
 if(deployment)Object.defineProperties(result,{compilerMaterialValidationRequired:{value:true,enumerable:true},source:{value:transport.source,enumerable:true},material:{get:()=>transport.material,enumerable:true}});
 return Object.freeze(result);
}
