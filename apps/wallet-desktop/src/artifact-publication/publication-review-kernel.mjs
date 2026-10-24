import {isDeepStrictEqual,types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
const id=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const nativePhases=new Set(['not-entered','signing-outcome-unknown','signed-outcome-unknown','signed-unhanded','failed','unknown','cancelled']);
const bounded=v=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=256&&!/[\u0000-\u001f\u007f]/.test(v);
const typed=Object.getPrototypeOf(Uint8Array.prototype),getter=key=>Object.getOwnPropertyDescriptor(typed,key).get;
const bufferOf=getter('buffer'),offsetOf=getter('byteOffset'),lengthOf=getter('byteLength');
function copiedResult(value){
 if(types.isProxy(value)||!types.isUint8Array(value)||['buffer','byteOffset','byteLength','length'].some(k=>Object.hasOwn(value,k)))fail('AUTH_IDENTITY_PUBLICATION_RESULT_INVALID');
 const buffer=bufferOf.call(value),offset=offsetOf.call(value),length=lengthOf.call(value);
 if(types.isSharedArrayBuffer(buffer)||!length||length>262144)fail('AUTH_IDENTITY_PUBLICATION_RESULT_INVALID');
 return Buffer.from(new Uint8Array(buffer,offset,length));
}
/** PUBLIC control kernel around the existing review and the original Native
 * approval holder. Only the normal Main factory fixes captureNative; this
 * class/its metadata do not create Source, key or remote publication grants.
 * Rejection/cancellation keep the existing review/evidence and original parent
 * channel. Approval uses the Native publisher journal, never the Auth signer.
 */
export class WalletIDEPublicationReviewKernel {
 #base;#captureNative;#current;#invocation;#native=null;#nativeView=null;#selected=null;#active=false;#retired=false;#closed=false;#wire=null;#stored=false;#effectEntered=null;#signed=false;#nativePhase='not-entered';#phase='pending';#first;#hasFirst=false;#cleanup;#hasCleanup=false;#cleanupDebt=false;
 constructor({base,captureNative,assertCurrent,invocationOriginal}){this.#base=base;this.#captureNative=captureNative;this.#current=assertCurrent;this.#invocation=invocationOriginal;}
 #remember(cause){if(!this.#hasFirst){this.#hasFirst=true;this.#first=cause;}}
 #rememberCleanup(cause,debt=false){if(!this.#hasCleanup){this.#hasCleanup=true;this.#cleanup=cause;}if(debt)this.#cleanupDebt=true;}
 #live(guard){guard.assert();if(guard.account!==this.#base.describe().account||this.#retired)fail('AUTH_IDENTITY_ACTION_RETIRED');if(this.#current()!==undefined)fail('AUTH_IDENTITY_CURRENT_INVALID');guard.assert();}
 prepare(){
  if(this.#native||this.#nativeView||this.#hasFirst)return;
  try{
   this.#native=this.#captureNative(); // adopt original cleanup partial FIRST
   const view=this.#native.copyOriginalReview(),base=this.#base.describe();
   if(view?.purpose!=='ARTIFACT-RELEASE'||view.requestId!==base.requestId||view.account!==base.account||view.networkId!==base.networkId||!id.test(view.reviewId)||!isDeepStrictEqual(view.publication,JSON.parse(this.#invocation))||['publisherId','publisherRegistrationRef','publisherRevision','publisherKeyVersion'].some(k=>!bounded(view[k]))||['signOriginalRelease','copyOriginalSigningOutcome','saveOriginalSigningOutcome','copyOriginalPublicationResult','sendOriginalPublicationResult'].some(k=>typeof this.#native[k]!=='function'))fail('AUTH_IDENTITY_PUBLICATION_NATIVE_REVIEW_REQUIRED');
   this.#nativeView=view;
  }catch(cause){this.#remember(cause);}
 }
 publicationReady(){return !!this.#nativeView&&!this.#hasFirst&&!this.#retired&&this.#selected===null;}
 describe(){const base=this.#base.describe();return Object.freeze({...base,...(this.#nativeView?{nativePublication:Object.freeze({publisherId:this.#nativeView.publisherId,publisherRegistrationRef:this.#nativeView.publisherRegistrationRef,publisherRevision:this.#nativeView.publisherRevision,publisherKeyVersion:this.#nativeView.publisherKeyVersion,dataOnly:true})}:{})});}
 status(){if(this.#selected!=='approve')return Object.freeze({...this.#base.status(),signingSelected:false,nativeResultStored:false,nativePhase:this.#nativePhase,firstCausePresent:this.#hasFirst||this.#base.status().firstCausePresent});return Object.freeze({reviewId:this.describe().reviewId,decision:this.#selected,phase:this.#phase,active:this.#active,recorded:this.#stored&&(!this.#signed||this.#wire!==null),hasSignedResult:this.#signed,signingSelected:this.#effectEntered===true,nativeResultStored:this.#stored,nativePhase:this.#nativePhase,retired:this.#retired,firstCausePresent:this.#hasFirst,cleanupCausePresent:this.#hasCleanup,retryAuthorized:false,handoffAuthorized:false});}
 #capture(){
  if(!this.#native)return;const result=this.#native.copyOriginalSigningOutcome();if(['stored','effectEntered','hasSignedResult'].some(k=>typeof result[k]!=='boolean')||!nativePhases.has(result.phase))fail('AUTH_IDENTITY_PUBLICATION_RESULT_INVALID');if(this.#stored&&!result.stored||this.#signed&&!result.hasSignedResult||this.#effectEntered===true&&!result.effectEntered)fail('AUTH_IDENTITY_RESULT_CHANGED');this.#stored=result.stored;this.#effectEntered=result.effectEntered;this.#signed=result.hasSignedResult;this.#nativePhase=result.phase;
  if(result.hasSignedResult===true){const copy=copiedResult(this.#native.copyOriginalPublicationResult());if(this.#wire&&!this.#wire.equals(copy))fail('AUTH_IDENTITY_RESULT_CHANGED');this.#wire=copy;}
 }
 readOriginalResult(){const result=this.#selected==='approve'?{...this.status(),wire:this.#wire?new Uint8Array(this.#wire):null,dataOnly:true}:this.#base.readOriginalResult();return Object.freeze({...result,firstCausePresent:this.#hasFirst||result.firstCausePresent===true,firstCause:this.#hasFirst?this.#first:result.firstCause,cleanupCause:this.#cleanup});}
 async decide(reviewId,decision,guard){
  if(this.#selected!==null||this.#active)fail('AUTH_IDENTITY_PROOF_ALREADY_ENTERED');
  if(reviewId!==this.describe().reviewId||!['approve','reject','cancel'].includes(decision))fail('AUTH_IDENTITY_APPROVAL_INVALID');
  if(decision!=='approve'){this.#selected=decision;return this.#base.decide(reviewId,decision,guard);}
  if(!this.publicationReady())fail('AUTH_IDENTITY_PUBLICATION_APPROVAL_NOT_SUPPLIED');this.#live(guard);this.#selected='approve';this.#active=true;this.#phase='signing';
  try{
   const approved=this.#native.approveOriginalReview(this.#nativeView.reviewId);
   if(!id.test(approved?.actualApprovalRef))fail('AUTH_IDENTITY_PUBLICATION_APPROVAL_REF_INVALID');
   let failed=false,cause;try{this.#native.signOriginalRelease(approved.actualApprovalRef);}catch(error){failed=true;cause=error;this.#remember(error);}
   try{this.#capture();}catch(error){if(!failed){failed=true;cause=error;}else this.#rememberCleanup(error);}
   if(failed)throw cause;if(!this.#wire||!this.#stored)fail('AUTH_IDENTITY_PUBLICATION_RESULT_UNCONFIRMED');
   this.#live(guard);this.#phase='recorded-unhanded';return Object.freeze({reviewId,decision,recorded:true});
  }catch(cause){this.#remember(cause);try{this.#capture();}catch(error){this.#rememberCleanup(error);}this.#phase=this.#signed?'signed-outcome-unknown':'decision-outcome-unknown';throw this.#first;}
  finally{this.#active=false;}
 }
 sendOriginalPublicationResult(){if(this.#selected!=='approve'||this.#phase!=='recorded-unhanded'||!this.#stored||!this.#wire||this.#retired)fail('AUTH_IDENTITY_PUBLICATION_RESULT_UNCONFIRMED');return this.#native.sendOriginalPublicationResult();}
 async save(guard){
  if(this.#selected!=='approve')return this.#base.save(guard);
  if(this.#active)fail('AUTH_IDENTITY_NO_HELD_RESULT');guard.assert();if(guard.account!==this.describe().account)fail('AUTH_IDENTITY_APPROVAL_INVALID');
  if(!this.#stored&&this.#effectEntered!==false)this.#native.saveOriginalSigningOutcome();this.#capture();if(this.#effectEntered!==false&&(!this.#stored||this.#signed&&!this.#wire))fail('AUTH_IDENTITY_PUBLICATION_RESULT_UNCONFIRMED');return Object.freeze({reviewId:this.describe().reviewId,decision:'approve',recorded:this.#stored,noSigningEffect:this.#effectEntered===false,handoffAuthorized:false});
 }
 retire(){this.#retired=true;this.#base.retire();try{this.#native?.retire();}catch(cause){this.#rememberCleanup(cause,true);}}
 assertSafeToClose(){this.#base.assertSafeToClose();if(this.#active||this.#selected==='approve'&&this.#effectEntered!==false&&(!this.#stored||this.#signed&&!this.#wire)||this.#cleanupDebt)fail('AUTH_IDENTITY_RESULT_SAVE_UNCONFIRMED');}
 close(){if(this.#closed)return;this.retire();this.assertSafeToClose();if(this.#native&&this.#native.close()!==undefined)fail('AUTH_IDENTITY_PEER_CLOSE_UNKNOWN');this.#closed=true;}
}
