import {isDeepStrictEqual} from 'node:util';
import {inspectWalletProjectControlReviewData} from './wallet-project-control-review-ui.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const retainedPhases=['decision-retained','rejected','cancelled','approval-proof-retained','approval-failed'];
const nativeProgress=['effectSelected','effectEntered','hasSignedResult','resultStored','cleanupPending'];
// Main-owned lifecycle only. Auth still owns the accepted purpose/codec and
// Native owns the protected producer. The private isOwner recognizer MUST be
// the matching addon's original type/env recognizer, never an IPC callback.
// Persist writes public lifecycle DATA to the original protected journal, not
// keys/proofs or an authority record. No implicit transport, retry or sign.
export class WalletProjectControlReviewKernel {
 #deps;#owner=null;#review=null;#context=null;#selected=null;#phase='idle';#busy=false;#retired=false;#sequence=0;#first;#storage;#hasFirst=false;#hasStorage=false;#needsSave=false;#nativeEntered=false;
 #progress={effectSelected:false,effectEntered:false,hasSignedResult:false,resultStored:false,cleanupPending:false};
 #retainFirst(cause){if(!this.#hasFirst){this.#hasFirst=true;this.#first=cause;}}
 constructor({isOwner,persist,now=Date.now,accountMatches=(original,selected)=>original===selected}){if([isOwner,persist,now,accountMatches].some(v=>typeof v!=='function'))fail('CONTROL_DEPENDENCY_REQUIRED');this.#deps={isOwner,persist,now,accountMatches};}
 #current(guard){
  if(this.#retired||!guard||guard.locked||guard.authenticating||guard.account!==this.#context.account||guard.revision!==this.#context.revision)fail('CONTROL_CONTEXT_CHANGED');
  const now=this.#deps.now();if(!Number.isSafeInteger(now)||now<this.#context.floor||BigInt(now)>=BigInt(this.#review.command.ExpiresMS))fail('CONTROL_EXPIRED');this.#context.floor=now;
  if(this.#owner.assertCurrent()!==undefined||this.#retired)fail('CONTROL_NATIVE_CURRENT_REFUSED');
 }
 status(){return Object.freeze({reviewId:this.#review?.reviewId??null,decision:this.#selected,phase:this.#phase,recorded:retainedPhases.includes(this.#phase),nativeEntered:this.#nativeEntered,...this.#progress,retired:this.#retired,needsSave:this.#needsSave,firstCausePresent:this.#hasFirst,storageCausePresent:this.#hasStorage,dataOnly:true,approved:false,committed:false,retryAuthorized:false});}
 async #save(){const record=Object.freeze({...this.status(),sequence:String(++this.#sequence),account:this.#review.account,command:this.#review.command,...(this.#review.publisher?{publisher:this.#review.publisher}:{})});try{await this.#deps.persist(record);this.#needsSave=false;}catch(e){this.#needsSave=true;if(!this.#hasStorage){this.#hasStorage=true;this.#storage=e;}throw e;}}
 async capture(owner,getGuard){
  if(this.#busy||this.#owner)fail('CONTROL_ORIGINAL_ALREADY_HELD');if(this.#deps.isOwner(owner)!==true)fail('CONTROL_ORIGINAL_NATIVE_REQUIRED');
  this.#owner=owner;this.#busy=true;
  try{
   if(owner.assertCurrent()!==undefined)fail('CONTROL_NATIVE_CURRENT_REFUSED');const at=this.#deps.now(),review=inspectWalletProjectControlReviewData(owner.copyOriginalReview(),at);
   const guard=getGuard();if(this.#deps.accountMatches(review.account,guard.account)!==true)fail('CONTROL_ACCOUNT_CHANGED');
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
   let failed=false,cause;
   try{if(this.#owner.selectOriginalDecision(reviewId,decision)!==undefined)fail('CONTROL_NATIVE_DECISION_UNKNOWN');}catch(e){failed=true;cause=e;this.#retainFirst(e);}
   // Always consume the same Native partial before considering its callback
   // error/current loss. Reading this result never enters the effect again.
   try{this.#adopt(this.#owner.copyOriginalDecision());await this.#save();}catch(e){if(!failed){failed=true;cause=e;}this.#retainFirst(e);}
   if(failed)throw cause;return this.status();
  }catch(e){this.#retainFirst(e);if(this.#selected&&!retainedPhases.includes(this.#phase)&&this.#phase!=='approval-outcome-unknown')this.#phase='decision-unknown';try{if(this.#review)await this.#save();}catch{}throw e;}finally{this.#busy=false;}
 }
 #adopt(result){
  if(!result||result.reviewId!==this.#review.reviewId||result.decision!==this.#selected||result.recorded!==true||![...retainedPhases,'approval-outcome-unknown','unknown'].includes(result.phase)||result.phase==='rejected'&&this.#selected!=='reject'||result.phase==='cancelled'&&this.#selected!=='cancel')fail('CONTROL_RESULT_UNKNOWN');
  let progress=this.#progress;
  if(nativeProgress.some(k=>Object.hasOwn(result,k))){
   if(nativeProgress.some(k=>typeof result[k]!=='boolean')||nativeProgress.slice(0,4).some(k=>this.#progress[k]&&!result[k])||result.effectSelected&&this.#selected!=='approve'||result.effectEntered&&!result.effectSelected||result.hasSignedResult&&!result.effectEntered||result.resultStored&&!result.effectSelected||result.phase==='approval-proof-retained'&&!result.hasSignedResult||result.phase==='approval-failed'&&result.hasSignedResult)fail('CONTROL_NATIVE_PROGRESS_REFUSED');
   progress=Object.fromEntries(nativeProgress.map(k=>[k,result[k]]));
  }else if(result.phase.startsWith('approval-'))fail('CONTROL_NATIVE_PROGRESS_REQUIRED');
  const phase=result.phase==='unknown'?'decision-unknown':result.phase;
  if(['rejected','cancelled','approval-proof-retained','approval-failed'].includes(this.#phase)&&phase!==this.#phase||this.#phase==='decision-retained'&&!['decision-retained','approval-proof-retained','approval-failed','approval-outcome-unknown'].includes(phase))fail('CONTROL_RESULT_REGRESSION');
  // Validate the COMPLETE transition before publishing any progress. A
  // rejected late callback cannot mutate cleanup/sign flags as a side effect.
  if((phase==='decision-retained'||phase.startsWith('approval-'))&&this.#selected!=='approve')fail('CONTROL_NATIVE_PROGRESS_REFUSED');
  this.#progress=progress;this.#phase=phase;
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
