import {createHash,randomUUID} from 'node:crypto';
import {canonicalJSON,productSessionApprovalDigest,createProductSessionReferenceReturnURL} from '@ynx-chain/wallet-auth';
import {PRODUCT_SESSION_REGISTRY} from './wallet-auth-contract.mjs';
import {parseSessionOriginal} from './wallet-session-original.mjs';
const fail=()=>{throw Object.assign(Error('Preserve the original publication; its binding or outcome could not be verified.'),{code:'SESSION_PUBLICATION_UNKNOWN'});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join()!==keys.sort().join())fail();};

export function sessionPublicationIdentity(input){
 const original=parseSessionOriginal(input);
 if(original.approval?.version!=='3'||!original.cleanupComplete||original.cleanupCause||original.deliveryAttempted)fail();
 const identity={account:original.account,requestDigest:original.requestDigest,requestId:original.requestId,approvalDigest:productSessionApprovalDigest(original.approval)};
 return Object.freeze({...identity,publicationRequestId:'req_'+createHash('sha256').update(canonicalJSON(['YNX-WALLET-ORIGINAL-PUBLICATION/v1',identity])).digest('hex')});
}
export function parseSessionPublication(input,original){
 exact(input,['version','account','requestDigest','requestId','approvalDigest','publicationRequestId','status','result']);
 if(input.version!==1||!['publish-unknown','reference-ready'].includes(input.status))fail();
 const identity=sessionPublicationIdentity({...original,deliveryAttempted:false});
 for(const key of Object.keys(identity))if(input[key]!==identity[key])fail();
 if(input.status==='publish-unknown'){if(input.result!==null)fail();}
 else{
  exact(input.result,['reference','nonce','state','expiresAt']);
  // Retention parsing uses original signed time, not current wall clock. A
  // fresh SDK request/source validation is still required for actual delivery.
  createProductSessionReferenceReturnURL(PRODUCT_SESSION_REGISTRY,original.request,input.result,new Date(original.createdAt));
  if(input.result.expiresAt>original.approval.expiresAt)fail();
 }
 return Object.freeze({...input,result:input.result?Object.freeze({...input.result}):null});
}
export function sessionPublicationOutcome(input,original){
 if(input?.state==='not_found'){
  exact(input,['state','retryAuthorized']);if(input.retryAuthorized!==false)fail();return null;
 }
 exact(input,['state','reference','expiresAt','requestDigest','account','approvalDigest','retryAuthorized']);
 if(!['pending','completed'].includes(input.state)||input.retryAuthorized!==false||input.account!==original.approval.account||input.requestDigest!==original.requestDigest||input.approvalDigest!==productSessionApprovalDigest(original.approval))fail();
 const result={reference:input.reference,expiresAt:input.expiresAt,nonce:original.request.nonce,state:original.request.state};
 parseSessionPublication({version:1,...sessionPublicationIdentity({...original,deliveryAttempted:false}),status:'reference-ready',result},original);
 return Object.freeze(result);
}
/** Exact original SDK callee, main-only. There is no alternate HTTP endpoint,
 * public request-ID lookup, DApp signer, local session, or publish retry here. */
export async function prepareSessionPublicationReturn({store,client,original,guard,clock=()=>new Date(),readRequestId=()=> 'req_'+randomUUID().replaceAll('-','')}){
 guard();sessionPublicationIdentity(original);
 if(typeof client?.publishReturn!=='function'||typeof client?.publicationOutcome!=='function')fail();
 const admission=await store.beginSessionPublication(original.account,original.requestDigest,guard);guard();
 let result=admission.publication.result;
 if(!result){
  if(admission.created){
   // Marker is durably acknowledged BEFORE the sole mutating request. Lost
   // HTTP ACK leaves it UNKNOWN; all later attempts select only outcome reads.
   result=await client.publishReturn({requestId:admission.publication.publicationRequestId,request:original.request,approval:original.approval});
  }else{
   const outcome=await client.publicationOutcome({requestId:readRequestId(),publicationRequestId:admission.publication.publicationRequestId,request:original.request,approval:original.approval});
   result=sessionPublicationOutcome(outcome,original);
   if(!result)fail();
  }
  // Capture/save before a post-response lock can discard the original ref.
  await store.saveSessionPublicationResult(original.account,original.requestDigest,result);
 }
 guard();
 return createProductSessionReferenceReturnURL(PRODUCT_SESSION_REGISTRY,original.request,result,clock());
}
