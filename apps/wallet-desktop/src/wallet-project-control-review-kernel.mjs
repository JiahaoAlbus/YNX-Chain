import {isDeepStrictEqual} from 'node:util';
import {inspectWalletProjectControlReviewData} from './wallet-project-control-review-ui.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
// Main-owned lifecycle only. Auth still owns the accepted purpose/codec and
// Native owns the protected producer. The private isOwner recognizer MUST be
// the matching addon's original type/env recognizer, never an IPC callback.
// Persist writes public lifecycle DATA to the original protected journal, not
// keys/proofs or an authority record. No implicit transport, retry or sign.
export class WalletProjectControlReviewKernel {
 #deps;#owner=null;#review=null;#context=null;#selected=null;#phase='idle';#busy=false;#retired=false;#sequence=0;#first;#storage;#hasFirst=false;#hasStorage=false;#nativeEntered=false;
 #retainFirst(cause){if(!this.#hasFirst){this.#hasFirst=true;this.#first=cause;}}
 constructor({isOwner,persist,now=Date.now}){if([isOwner,persist,now].some(v=>typeof v!=='function'))fail('CONTROL_DEPENDENCY_REQUIRED');this.#deps={isOwner,persist,now};}
 #current(guard){
  if(this.#retired||!guard||guard.locked||guard.authenticating||guard.account!==this.#context.account||guard.revision!==this.#context.revision)fail('CONTROL_CONTEXT_CHANGED');
  const now=this.#deps.now();if(!Number.isSafeInteger(now)||now<this.#context.floor||BigInt(now)>=BigInt(this.#review.command.ExpiresMS))fail('CONTROL_EXPIRED');this.#context.floor=now;
  if(this.#owner.assertCurrent()!==undefined||this.#retired)fail('CONTROL_NATIVE_CURRENT_REFUSED');
 }
 status(){return Object.freeze({reviewId:this.#review?.reviewId??null,decision:this.#selected,phase:this.#phase,nativeEntered:this.#nativeEntered,retired:this.#retired,firstCausePresent:this.#hasFirst,storageCausePresent:this.#hasStorage,dataOnly:true,approved:false,committed:false,retryAuthorized:false});}
 async #save(){const record=Object.freeze({...this.status(),sequence:String(++this.#sequence),account:this.#review.account,command:this.#review.command,...(this.#review.publisher?{publisher:this.#review.publisher}:{})});try{await this.#deps.persist(record);}catch(e){if(!this.#hasStorage){this.#hasStorage=true;this.#storage=e;}throw e;}}
 async capture(owner,getGuard){
  if(this.#busy||this.#owner)fail('CONTROL_ORIGINAL_ALREADY_HELD');if(this.#deps.isOwner(owner)!==true)fail('CONTROL_ORIGINAL_NATIVE_REQUIRED');
  this.#owner=owner;this.#busy=true;
  try{
   if(owner.assertCurrent()!==undefined)fail('CONTROL_NATIVE_CURRENT_REFUSED');const at=this.#deps.now(),review=inspectWalletProjectControlReviewData(owner.copyOriginalReview(),at);
   const guard=getGuard();if(guard.account!==review.account)fail('CONTROL_ACCOUNT_CHANGED');
   this.#review=review;this.#context={account:guard.account,revision:guard.revision,floor:at};this.#current(guard);
   if(!isDeepStrictEqual(review,inspectWalletProjectControlReviewData(owner.copyOriginalReview(),at)))fail('CONTROL_ORIGINAL_CHANGED');
   this.#phase='review-ready';await this.#save();this.#current(getGuard());return review;
  }catch(e){this.#retainFirst(e);this.#phase='capture-unknown';throw e;}finally{this.#busy=false;}
 }
 async decide(reviewId,decision,getGuard){
  if(this.#busy||this.#selected||!this.#review||reviewId!==this.#review.reviewId||!['approve','reject','cancel'].includes(decision)||typeof getGuard!=='function')fail('CONTROL_DECISION_REFUSED');
  this.#busy=true;
  try{
   this.#current(getGuard());
   if(!isDeepStrictEqual(this.#review,inspectWalletProjectControlReviewData(this.#owner.copyOriginalReview(),this.#deps.now())))fail('CONTROL_ORIGINAL_CHANGED');
   this.#selected=decision;this.#phase='decision-selected';await this.#save();this.#current(getGuard());
   if(!isDeepStrictEqual(this.#review,inspectWalletProjectControlReviewData(this.#owner.copyOriginalReview(),this.#deps.now())))fail('CONTROL_ORIGINAL_CHANGED');
   this.#current(getGuard());
   // Reservation is durable before Native entry. A thrown/unknown result is
   // never permission to enter again, even if focus changes during this call.
   this.#nativeEntered=true;this.#phase='decision-unknown';
   if(this.#owner.selectOriginalDecision(reviewId,decision)!==undefined)fail('CONTROL_NATIVE_DECISION_UNKNOWN');
   const result=this.#owner.copyOriginalDecision();this.#adopt(result);await this.#save();return this.status();
  }catch(e){this.#retainFirst(e);if(this.#selected&&!['decision-retained','rejected','cancelled'].includes(this.#phase))this.#phase='decision-unknown';try{if(this.#review)await this.#save();}catch{}throw e;}finally{this.#busy=false;}
 }
 #adopt(result){
  if(!result||result.reviewId!==this.#review.reviewId||result.decision!==this.#selected||result.recorded!==true||!['decision-retained','rejected','cancelled','unknown'].includes(result.phase)||result.phase==='rejected'&&this.#selected!=='reject'||result.phase==='cancelled'&&this.#selected!=='cancel')fail('CONTROL_RESULT_UNKNOWN');
  const phase=result.phase==='unknown'?'decision-unknown':result.phase;
  if(['decision-retained','rejected','cancelled'].includes(this.#phase)&&phase!==this.#phase)fail('CONTROL_RESULT_REGRESSION');
  this.#phase=phase;
 }
 async observeOriginal(getGuard){
  if(this.#busy||!this.#review||!this.#selected||!this.#nativeEntered)fail('CONTROL_OBSERVE_REFUSED');this.#busy=true;
  try{
   const guard=getGuard();if(guard.locked||guard.authenticating||guard.account!==this.#context.account)fail('CONTROL_CONTEXT_CHANGED');
   // Query the SAME retained Native operation only. No assertCurrent or
   // signature/decision entry: expiry/revocation cannot erase held outcomes.
   this.#adopt(this.#owner.copyOriginalDecision());await this.#save();return this.status();
  }catch(e){this.#retainFirst(e);throw e;}finally{this.#busy=false;}
 }
 retire(){this.#retired=true;if(this.#owner)this.#owner.retire();return this.status();}
}
