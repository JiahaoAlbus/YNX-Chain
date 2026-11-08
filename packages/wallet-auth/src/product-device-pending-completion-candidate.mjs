// Private candidate DATA only. No Source brand, key, signature or publisher.
import {canonicalJSON} from './canonical.js';
import {createHash} from 'node:crypto';
import {inspectOriginalProductDeviceV4PendingScopeDATA} from '../native/original-product-device-v4-pending-source-contract.mjs';
import {productSessionApprovalDigest} from './product-session-v2.js';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
const sha=s=>createHash('sha256').update(s).digest('hex');
const parse=(s,max=65536)=>{if(typeof s!=='string'||Buffer.byteLength(s)>max)fail('PENDING_COMPLETION_ORIGINAL_SIZE');const v=JSON.parse(s);if(canonicalJSON(v)!==s)fail('PENDING_COMPLETION_CANONICAL');return v};
export function deriveOriginalPendingCompletionProfileCandidateDATA(profileBodyOriginal,originals,at,completionOperationId){
 const p=parse(profileBodyOriginal),old=p.selection?.productSessionDeviceV4Pending;
 if(p.version!==2||p.purpose!=='product-session-device-pending-source-v4'||!old||old.operation!=='registration-pop'||old.challengeOriginal!==null||!Number.isSafeInteger(at))fail('PENDING_COMPLETION_REGISTRATION_PROFILE_REQUIRED');
 // The independent next PROFILE plan supplies this constraint. Never allocate,
 // derive or silently reuse the original PAIR operation here. Both the normal
 // Wallet completion caller and the durable issuer reserve require a new ID.
 if(typeof completionOperationId!=='string'||!/^[a-f0-9]{64}$/.test(completionOperationId)||completionOperationId===old.pendingId)fail('PENDING_COMPLETION_DISTINCT_OPERATION_REQUIRED');
 if(!originals||originals.dataOnly!==true||originals.authorized!==false||originals.nativeAdmission!==false)fail('PENDING_COMPLETION_PROTECTED_ORIGINALS_REQUIRED');
 const post=parse(originals.pairInputOriginal,393216),result=parse(originals.pairResultOriginal,393216),c=parse(originals.challengeOriginal,16384);
 if(post.operationId!==old.pendingId||originals.operationId!==old.pendingId||post.registrationOriginal!==old.registrationOriginal||result.registrationOriginal!==old.registrationOriginal||canonicalJSON(post.request)!==old.requestOriginal||canonicalJSON(result.challenge)!==originals.challengeOriginal||c.approvalDigest!==old.approvalDigest||originals.inputSHA256!==sha(originals.pairInputOriginal)||originals.resultSHA256!==sha(originals.pairResultOriginal)||originals.registrationDigest!==old.expected.registrationDigest||originals.status!=='ISSUED')fail('PENDING_COMPLETION_CONTINUITY');
 if(productSessionApprovalDigest(post.approval)!==old.approvalDigest)fail('PENDING_COMPLETION_APPROVAL_CHANGED');
 inspectOriginalProductDeviceV4PendingScopeDATA(old,p.selection.association,old.expected.networkId,old.expected.canonicalOwner,p.issuedAtMs,p.expiresAtMs,at);
 const body=structuredClone(p);body.issuedAtMs=Math.max(p.issuedAtMs,Date.parse(c.issuedAt));body.expiresAtMs=Math.min(p.expiresAtMs,Date.parse(c.expiresAt),originals.expiresAtMs);
 body.selection.productSessionDeviceV4Pending={...old,operation:'challenge-completion',pendingId:completionOperationId,challengeOriginal:originals.challengeOriginal};
 const next=body.selection.productSessionDeviceV4Pending;
 inspectOriginalProductDeviceV4PendingScopeDATA(next,body.selection.association,next.expected.networkId,next.expected.canonicalOwner,body.issuedAtMs,body.expiresAtMs,at);
 const bodyOriginal=canonicalJSON(body);if(Buffer.byteLength(bodyOriginal)>65536)fail('PENDING_COMPLETION_PROFILE_SIZE');
 return Object.freeze({kind:2,profileBodyOriginal:bodyOriginal,profileBodySHA256:sha(bodyOriginal),scopeOriginal:canonicalJSON(next),currentHead:sha(canonicalJSON(next)),originalProfileBodySHA256:sha(profileBodyOriginal),pairOperationId:old.pendingId,operationId:completionOperationId,expiresAtMs:body.expiresAtMs,newIssuancePlanRequired:true,dataOnly:true,authorized:false,SourceAdmission:false,nativeAdmission:false});
}
