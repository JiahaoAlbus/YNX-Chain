// PRIVATE server lifecycle. A directly constructed kernel is a PUBLIC fixture,
// never a recognized Source owner, deployment selection or account grant.
import {randomBytes} from 'node:crypto';
import {canonicalJSON} from './canonical.js';
import {pqDecodeBase64url,exactPQRecord} from './pq-wallet-contract.js';
import {evmAddressFromYNX} from './crypto.js';
import {parseProductSessionRequest,createProductSessionChallenge,productSessionRequestDigest} from './product-session-v2.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {verifyProductSessionApprovalV4Data,verifyProductSessionDeviceRegistrationProofV4Data,verifyProductSessionV4CompletionData} from './product-session-pq-v4-codec.js';
import {readProductSessionAccountPolicy} from './product-session-account-policy.js';
import {assertSessionAccountPolicy} from './product-session-account-private.js';
import {pairV4Digest} from './product-pair-session-v4-store.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const parse=raw=>{if(typeof raw!=='string'||Buffer.byteLength(raw)>393216)fail('PAIR_V4_BODY_SIZE');const v=JSON.parse(raw);if(canonicalJSON(v)!==raw)fail('PAIR_V4_CANONICAL');return v;};
// Same original issuer actor namespace; DATA hashing only, not a device codec or grant.
export function productPairSessionV4ActorDATA(r,record,account){return pairV4Digest(canonicalJSON({networkId:record.networkId,canonicalOwner:evmAddressFromYNX(account),productId:r.productId,clientId:r.clientId,platform:r.platform,applicationId:r.applicationId,bundleId:r.bundleId,packageId:r.packageId,origin:r.origin,callback:r.callback,deviceId:record.deviceId}));}
export class ProductPairSessionV4IssuerKernel {
 #registry;#store;#source;#clock;#floor=0;#active=0;#closed=false;#closeSelected=false;#closeError;
 constructor(registry,store,originalSource,clock=Date.now){this.#registry=structuredClone(registry);this.#store=store;this.#source=originalSource;this.#clock=clock;}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<this.#floor||n<0)fail('PAIR_V4_CLOCK_ROLLBACK');this.#floor=n;return n;}
 #alive(){if(this.#closed)fail('PAIR_V4_RETIRED');}
 #actor(r,record,account){return productPairSessionV4ActorDATA(r,record,account);}
 async #held(request,registration,account,work){
  this.#alive();this.#active++;let held,error,result,deadline=Infinity;
  try{
   const at=this.#now(),view=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registration)),r=parseProductSessionRequest(this.#registry,request,new Date(at));
   if(r.version!=='4'||view.record.canonicalOwner!==evmAddressFromYNX(account)||view.registrationDigest!==r.deviceRegistrationDigest||view.record.registrationId!==r.deviceRegistrationId||view.record.revision!==r.deviceRegistrationRevision)fail('PAIR_V4_ORIGINAL_BINDING');
   // Concrete release-selected factory owns this source; a kernel fixture is
   // not branded as production. No HTTP endpoint accepts source/policy refs.
   held=await this.#source.acquire({request:r,registrationOriginal:registration,account,at});
   deadline=Math.min(held.expiresAtMs,Date.parse(r.expiresAt),Date.parse(view.record.expiresAt));
   const limit=n=>{if(!Number.isSafeInteger(n))fail('PAIR_V4_TIME');deadline=Math.min(deadline,n);};
   const current=async()=>{this.#alive();const n=this.#now();await held.recheck(n);const last=this.#now();if(last<n||last>=deadline)fail('PAIR_V4_POST_EXPIRED');held.assertCurrent(last);const final=this.#now();if(final>=deadline)fail('PAIR_V4_POST_EXPIRED');return final;};
   await current();result=await work({r,view,held,actor:this.#actor(r,view.record,account),current,limit});await current();
  }catch(e){error={cause:e};}
  // Preserve result+partial even when completion-current or teardown fails.
  if(held)for(const close of [()=>held.retire(),()=>held.join(),()=>held.close()])try{await close();}catch(e){error??={cause:e};}
  try{if(this.#now()>=deadline)fail('PAIR_V4_POST_CLEANUP_EXPIRED');}catch(e){error??={cause:e};}
  this.#active--;if(error)throw Object.assign(Error('PAIR_V4_OPERATION_UNRESOLVED'),{code:'PAIR_V4_OPERATION_UNRESOLVED',cause:error.cause,partial:result??null,recoverOnly:true});return result;
 }
 async pair(raw){const body=parse(raw);exactPQRecord(body,['operationId','request','registrationOriginal','registrationMember','approval']);
  return this.#held(body.request,body.registrationOriginal,body.approval.account,async({r,view,held,actor,current,limit})=>{
   const before=await current(),at=new Date(before);
   verifyProductSessionDeviceRegistrationProofV4Data(Buffer.from(body.registrationOriginal),pqDecodeBase64url(body.registrationMember,{max:98304}),at);
   const approval=verifyProductSessionApprovalV4Data(this.#registry,r,body.approval,held.policyRef,Buffer.from(body.registrationOriginal),at);limit(Date.parse(approval.approval.expiresAt));
   const reserved=this.#store.reserve({actor,operation:body.operationId,kind:'PAIR',input:raw,at:await current()});if(reserved.recoveryOnly)return Object.freeze({...reserved,registered:false,newSession:false});
   // Random challenge is generated ONLY for a fresh durable ENTERED ticket.
   const challenge=createProductSessionChallenge(this.#registry,r,approval.approval,{challenge:randomBytes(32).toString('base64url')},new Date(this.#now()),approval.verifiedApproval,new Date(this.#now()));
   limit(Date.parse(challenge.expiresAt));const challengeRaw=canonicalJSON(challenge),result=canonicalJSON({registrationOriginal:body.registrationOriginal,challenge});
   const after=await current();if(after>=Date.parse(challenge.expiresAt)||after>=Date.parse(approval.approval.expiresAt))fail('PAIR_V4_POST_EXPIRED');
   const original=this.#store.commitPairChallenge(reserved.ticket,{registrationId:view.record.registrationId,registrationDigest:view.registrationDigest,registrationOriginal:body.registrationOriginal,challengeId:challenge.challenge,challengeOriginal:challengeRaw,requestDigest:productSessionRequestDigest(this.#registry,r,new Date(after)),nonce:r.nonce,state:r.state,pairExpiresMs:Date.parse(view.record.expiresAt),challengeExpiresMs:Date.parse(challenge.expiresAt),result},after);
   return Object.freeze({original,operationId:body.operationId,durable:true,sourceAdmission:false,nativeAdmission:false,newSession:false});
  });
 }
 async complete(raw){const body=parse(raw);exactPQRecord(body,['operationId','request','registrationOriginal','approval','completion']);
  return this.#held(body.request,body.registrationOriginal,body.approval.account,async({r,view,held,actor,current,limit})=>{
   let at=await current();const p=this.#store.readPair({actor,registrationId:view.record.registrationId,at});if(p.original!==body.registrationOriginal||p.registration_digest!==view.registrationDigest)fail('PAIR_V4_PAIR_BINDING');
   const verified=verifyProductSessionV4CompletionData(this.#registry,r,body.approval,body.completion,held.policyRef,Buffer.from(body.registrationOriginal),new Date(at)),session=verified.session;limit(Math.min(Date.parse(session.expiresAt),Date.parse(body.completion.challenge.expiresAt)));
   const reserved=this.#store.reserve({actor,operation:body.operationId,kind:'COMPLETE',input:raw,at:await current()});if(reserved.recoveryOnly)return Object.freeze({...reserved,newSession:false});
   at=await current();if(at>=Date.parse(session.expiresAt)||at>=Date.parse(body.completion.challenge.expiresAt))fail('PAIR_V4_POST_EXPIRED');
   const original=this.#store.commitSession(reserved.ticket,{registrationId:view.record.registrationId,registrationDigest:view.registrationDigest,challengeId:body.completion.challenge.challenge,challengeOriginal:canonicalJSON(body.completion.challenge),sessionBinding:session.sessionBinding,sessionOriginal:canonicalJSON(session),sessionExpiresMs:Date.parse(session.expiresAt),result:canonicalJSON(session)},at);
   return Object.freeze({original,operationId:body.operationId,durable:true,sourceAdmission:false,nativeAdmission:false});
  });
 }
 async challenge(raw){const body=parse(raw);exactPQRecord(body,['operationId','request','registrationOriginal','approval']);return this.#held(body.request,body.registrationOriginal,body.approval.account,async({r,view,held,actor,current})=>{let at=await current();const pair=this.#store.readPair({actor,registrationId:view.record.registrationId,at});if(pair.original!==body.registrationOriginal||pair.registration_digest!==view.registrationDigest)fail('PAIR_V4_PAIR_BINDING');const approval=verifyProductSessionApprovalV4Data(this.#registry,r,body.approval,held.policyRef,Buffer.from(body.registrationOriginal),new Date(at));const reserved=this.#store.reserve({actor,operation:body.operationId,kind:'CHALLENGE',input:raw,at:await current()});if(reserved.recoveryOnly)return reserved;at=await current();const challenge=createProductSessionChallenge(this.#registry,r,approval.approval,{challenge:randomBytes(32).toString('base64url')},new Date(at),approval.verifiedApproval,new Date(at));at=await current();if(at>=Date.parse(challenge.expiresAt)||at>=Date.parse(approval.approval.expiresAt))fail('PAIR_V4_POST_EXPIRED');const original=this.#store.commitChallenge(reserved.ticket,{registrationId:view.record.registrationId,registrationDigest:view.registrationDigest,challengeId:challenge.challenge,challengeOriginal:canonicalJSON(challenge),requestDigest:productSessionRequestDigest(this.#registry,r,new Date(at)),nonce:r.nonce,state:r.state,challengeExpiresMs:Date.parse(challenge.expiresAt),result:canonicalJSON(challenge)},at);return Object.freeze({original,durable:true,sourceAdmission:false,nativeAdmission:false,newSession:false});});}
 async revoke(raw){const body=parse(raw);exactPQRecord(body,['operationId','request','registrationOriginal','account','sessionBinding']);return this.#held(body.request,body.registrationOriginal,body.account,async({view,held,actor,current})=>{const at=await current();await held.assertRevocationAllowed(body.sessionBinding,at);const r=this.#store.reserve({actor,operation:body.operationId,kind:'REVOKE',input:raw,at:await current()});if(r.recoveryOnly)return r;const result=canonicalJSON({registrationId:view.record.registrationId,sessionBinding:body.sessionBinding,revoked:true});const original=this.#store.revoke(r.ticket,{registrationId:body.sessionBinding===null?view.record.registrationId:null,sessionBinding:body.sessionBinding,result},await current());return Object.freeze({original,durable:true,globalRevocation:false});});}
 async cancel(raw){const body=parse(raw);exactPQRecord(body,['operationId','request','registrationOriginal','account','challengeId']);return this.#held(body.request,body.registrationOriginal,body.account,async({held,actor,current})=>{await held.assertCancellationAllowed(body.challengeId,await current());const r=this.#store.reserve({actor,operation:body.operationId,kind:'CANCEL',input:raw,at:await current()});if(r.recoveryOnly)return r;return Object.freeze({original:this.#store.cancel(r.ticket,{challengeId:body.challengeId,result:canonicalJSON({challengeId:body.challengeId,cancelled:true})},await current()),durable:true});});}
 async active(raw){const body=parse(raw);exactPQRecord(body,['request','registrationOriginal','account','sessionBinding']);return this.#held(body.request,body.registrationOriginal,body.account,async({view,held,actor,current})=>{const at=await current(),stored=this.#store.readSession({actor,sessionBinding:body.sessionBinding,at}),session=JSON.parse(stored.original);if(stored.registration_id!==view.record.registrationId||session.deviceRegistrationDigest!==view.registrationDigest)fail('PAIR_V4_PAIR_BINDING');assertSessionAccountPolicy(session,readProductSessionAccountPolicy(held.policyRef,body.account,new Date(at)));return Object.freeze({original:stored.original,sourceAdmission:false,nativeAdmission:false});});}
 async recover(raw){const body=parse(raw);exactPQRecord(body,['request','registrationOriginal','account','operationId']);return this.#held(body.request,body.registrationOriginal,body.account,async({actor,current})=>{await current();const record=this.#store.recover({actor,operation:body.operationId});return Object.freeze({record,recoverOnly:true,newSession:false,sourceAdmission:false,nativeAdmission:false});});}
 retire(){this.#closed=true;}
 join(){if(!this.#closed||this.#active)fail('PAIR_V4_JOIN_PENDING');}
 close(){if(this.#closeSelected){if(this.#closeError)throw this.#closeError.cause;return;}this.retire();this.join();this.#closeSelected=true;for(const close of [()=>this.#store.close(),()=>this.#source.close()])try{close();}catch(e){this.#closeError??={cause:e};}if(this.#closeError)throw this.#closeError.cause;}
}
