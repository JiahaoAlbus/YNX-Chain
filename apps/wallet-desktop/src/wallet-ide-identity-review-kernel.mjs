import {randomUUID} from 'node:crypto';
import {encodeIDEIdentityPeerDecision} from './wallet-ide-identity-peer-wire.mjs';
const purposes=new Set(['AUTH-IDENTITY-RECEIVE','AUTH-IDENTITY-RECOVER','AUTH-PROTECTED-KEY-CALL']);
const fail=code=>{throw Object.assign(Error(code),{code});};
/** PUBLIC test kernel, not a Native/source/provider constructor. The normal
 * factory fixes the real inspector/signer action and clock. Original Main
 * alone supplies admitted request/current and protected-result persistence.
 */
export class WalletIDEIdentityReviewKernel {
 #raw;#expected;#purpose;#snapshot;#vault;#sourceCurrent;#persist;#inspect;#createAction;#now;#publication;
 #id=randomUUID();#body;#selected=null;#phase='pending';#active=false;#action=null;#wire=null;#payload=null;#stored=false;#saveAttempted=false;#saveUnconfirmed=false;#retired=false;#first;#hasFirst=false;#cleanup;#hasCleanup=false;
 constructor({vault,requestOriginal,expectedOriginal,purpose,snapshot,publication=null,assertCurrent,persistOriginal,inspect,createAction,now=Date.now}){
  if(!purposes.has(purpose)||[assertCurrent,persistOriginal,inspect,createAction,now].some(x=>typeof x!=='function'))fail('AUTH_IDENTITY_PRIVATE_APPROVAL_REQUIRED');
  this.#vault=vault;this.#raw=requestOriginal;this.#expected=expectedOriginal;this.#purpose=purpose;this.#snapshot=snapshot;this.#publication=publication;this.#sourceCurrent=assertCurrent;this.#persist=persistOriginal;this.#inspect=inspect;this.#createAction=createAction;this.#now=now;
  this.#current();this.#body=this.#inspect(requestOriginal,expectedOriginal,purpose,this.#at()).body;this.#current();
 }
 #at(){const n=this.#now();if(!Number.isSafeInteger(n)||n<0)fail('AUTH_IDENTITY_CLOCK_INVALID');return String(n);}
 #remember(cause){if(!this.#hasFirst){this.#hasFirst=true;this.#first=cause;}}
 #current(){if(this.#retired)fail('AUTH_IDENTITY_ACTION_RETIRED');if(this.#sourceCurrent()!==undefined)fail('AUTH_IDENTITY_CURRENT_INVALID');if(this.#retired)fail('AUTH_IDENTITY_ACTION_RETIRED');this.#inspect(this.#raw,this.#expected,this.#purpose,this.#at());}
 #guard(guard){guard.assert();if(guard.account!==this.#body.owner)fail('AUTH_IDENTITY_APPROVAL_INVALID');}
 #capture(){const saved=this.#action?.readOriginalResult();if(saved?.wire){if(this.#wire===null)this.#wire=new Uint8Array(saved.wire);else if(Buffer.compare(Buffer.from(this.#wire),Buffer.from(saved.wire))!==0)fail('AUTH_IDENTITY_RESULT_CHANGED');}}
 async #save(){
  // Exact returned proof/choice survives a late lock/current failure. The
  // protected store must retain its first failed/partial attempt, never replay.
  const record=Object.freeze({reviewId:this.#id,requestOriginal:this.#raw,expectedOriginal:this.#expected,purpose:this.#purpose,decision:this.#selected,phase:this.#phase,wire:this.#wire?new Uint8Array(this.#wire):null,payload:this.#payload?{kind:this.#payload.kind,bytes:Buffer.from(this.#payload.payload)}:null,firstCausePresent:this.#hasFirst,firstCause:this.#first,handoffAuthorized:false});
  this.#saveAttempted=true;
  try{if(await this.#persist(record)!==undefined)fail('AUTH_IDENTITY_RESULT_SAVE_UNCONFIRMED');this.#stored=true;this.#saveUnconfirmed=false;}
  catch(cause){this.#saveUnconfirmed=true;if(!this.#hasCleanup){this.#hasCleanup=true;this.#cleanup=cause;}throw cause;}
 }
 describe(){const detail={};for(const k of ['principalId','productId','applicationId','deviceId','requestDigest','credentialDigest','keyVersion','executionHeight','issuedAtMs'])if(typeof this.#body[k]==='string')detail[k]=this.#body[k];if(this.#publication!==null)detail.publication=this.#publication;return Object.freeze({reviewId:this.#id,requestId:this.#body.requestId,purpose:this.#purpose,account:this.#body.owner,networkId:this.#body.networkId,expiresAtMs:this.#body.expiresAtMs,...detail});}
 status(){return Object.freeze({reviewId:this.#id,decision:this.#selected,phase:this.#phase,active:this.#active,recorded:this.#stored,hasSignedResult:this.#wire!==null,retired:this.#retired,firstCausePresent:this.#hasFirst,cleanupCausePresent:this.#hasCleanup,retryAuthorized:false,handoffAuthorized:false});}
 readOriginalResult(){return Object.freeze({...this.status(),requestOriginal:this.#raw,purpose:this.#purpose,wire:this.#wire?new Uint8Array(this.#wire):null,payload:this.#payload?{kind:this.#payload.kind,bytes:Buffer.from(this.#payload.payload)}:null,firstCause:this.#first,cleanupCause:this.#cleanup,dataOnly:true});}
 retire(){this.#retired=true;this.#action?.retire();}
 assertSafeToClose(){if(this.#active||this.#selected!==null&&!this.#stored||this.#saveUnconfirmed)fail('AUTH_IDENTITY_RESULT_SAVE_UNCONFIRMED');}
 async decide(reviewId,decision,guard){
  if(reviewId!==this.#id||!['approve','reject','cancel'].includes(decision))fail('AUTH_IDENTITY_APPROVAL_INVALID');
  if(this.#active||this.#selected!==null)fail('AUTH_IDENTITY_PROOF_ALREADY_ENTERED');this.#active=true;
  try{this.#guard(guard);this.#current();}catch(cause){this.#active=false;throw cause;}
  this.#selected=decision;this.#phase='deciding';
  try{
   if(decision==='approve'){
    this.#phase='signing';
    const permission=Object.freeze({assertOriginalAuthIdentity:(raw,purpose)=>{if(this.#selected!=='approve'||this.#phase!=='signing'||raw!==this.#raw||purpose!==this.#purpose)fail('AUTH_IDENTITY_APPROVAL_INVALID');this.#guard(guard);this.#current();return undefined;}});
    this.#action=this.#createAction({vault:this.#vault,requestOriginal:this.#raw,expectedOriginal:this.#expected,purpose:this.#purpose,snapshot:this.#snapshot,permission,assertCurrent:()=>{this.#guard(guard);this.#current();},now:this.#now});
    let failed=false,cause;
    try{await this.#action.sign();}catch(e){failed=true;cause=e;this.#remember(e);}
    try{this.#capture();}catch(e){if(!failed){failed=true;cause=e;}else if(!this.#hasCleanup){this.#hasCleanup=true;this.#cleanup=e;}}
    if(failed)throw cause;
    if(this.#wire===null)fail('AUTH_IDENTITY_VAULT_ACTION_INCOMPLETE');
   }
   this.#guard(guard);this.#current();
   this.#payload=encodeIDEIdentityPeerDecision({decision,requestRaw:this.#raw,proof:decision==='approve'?this.#wire:null});this.#phase='recorded-unhanded';await this.#save();this.#guard(guard);this.#current();
   return Object.freeze({reviewId:this.#id,decision,recorded:true});
  }catch(cause){
   this.#remember(cause);this.#phase=this.#wire?'signed-outcome-unknown':'decision-outcome-unknown';
   if(this.#stored){this.#stored=false;this.#saveUnconfirmed=true;}
   // Never retry a store that already failed: keep the same retained result
   // until explicit local save. No second signing or decision is possible.
   if(!this.#saveAttempted)try{await this.#save();}catch{ /* Same retained pending result; explicit local save only. */ }
   throw this.#first;
  }finally{this.#active=false;}
 }
 async save(guard){
  if(this.#active||this.#selected===null||this.#stored)fail('AUTH_IDENTITY_NO_HELD_RESULT');this.#active=true;
  try{this.#guard(guard);await this.#save();return Object.freeze({reviewId:this.#id,decision:this.#selected,recorded:true,handoffAuthorized:false});}finally{this.#active=false;}
 }
}
