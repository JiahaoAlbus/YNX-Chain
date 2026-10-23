import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_IDENTITY_PEER_PACKET_INVALID');const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);if(names.length!==keys.length||names.some(k=>!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('AUTH_IDENTITY_PEER_PACKET_INVALID');};
const raw=v=>{if(typeof v!=='string'||!v.length||Buffer.byteLength(v)>16384||Buffer.from(v).toString()!==v)fail('AUTH_IDENTITY_PEER_PACKET_INVALID');return v;};
const sync=(object,name,...args)=>{if(object[name](...args)!==undefined)fail('AUTH_IDENTITY_PEER_CALLEE_INVALID');};
/** PUBLIC control kernel. The normal factory alone fixes actual SDK Native
 * recognition, original read-only policy supplier, inspector, signer/review,
 * clock and protected evidence. No fixture instance is a Native admission.
 */
export class WalletIDEIdentityPeerKernel {
 #deps;#own=null;#busy=false;#work=null;#activeGuard=null;
 constructor(deps){this.#deps=deps;for(const k of ['acquireSource','isSource','inspect','createReview','acquirePolicy','isPolicy','isPolicyCleanupOwner'])if(typeof deps[k]!=='function')fail('AUTH_IDENTITY_PEER_DEPENDENCY_REQUIRED');}
 #remember(cause,kind='first'){const o=this.#own;if(!o[kind+'Present']){o[kind+'Present']=true;o[kind]=cause;}}
 #guard(guard,effect=false){if(!guard)fail('AUTH_IDENTITY_PEER_LEASE_REQUIRED');if(effect)guard.assertEffectCurrent();else guard.assert();if(!this.#own||guard.account!==this.#own.account)fail('AUTH_IDENTITY_PEER_ACCOUNT_CHANGED');}
 #current(guard=this.#activeGuard,effect=false){this.#guard(guard,effect);const o=this.#own;if(o.retired)fail('AUTH_IDENTITY_PEER_RETIRED');sync(o.source,'current');if(o.policy)sync(o.policy,'assertCurrent');this.#guard(guard,effect);if(o.retired)fail('AUTH_IDENTITY_PEER_RETIRED');}
 #record(){const o=this.#own;return {operationId:o.id,sequence:String(o.sequence),account:o.account,requestOriginal:o.raw,invocationOriginal:o.invocation,reviewId:o.review?.describe().reviewId??null,phase:o.phase,decision:o.decision,wire:o.wire,sendSelected:o.sendSelected,sendStarted:o.sendStarted,sendReturned:o.sendReturned,closed:o.closed,firstCausePresent:o.firstPresent,firstCause:o.first,cleanupCausePresent:o.cleanupPresent,cleanupCause:o.cleanup,storageCausePresent:o.storagePresent,storageCause:o.storage};}
 async #store(){const o=this.#own;o.needsSave=true;try{if(o.sequence>=Number.MAX_SAFE_INTEGER)fail('AUTH_IDENTITY_PEER_SEQUENCE_EXHAUSTED');o.sequence++;await this.#deps.evidence.persistPeer(this.#record());o.needsSave=false;}catch(e){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'cause'):null;this.#remember(d&&Object.hasOwn(d,'value')?d.value:e,'storage');throw e;}}
 #capture(){const o=this.#own,r=o.review?.readOriginalResult();if(r?.wire){if(o.wire&&Buffer.compare(Buffer.from(o.wire),Buffer.from(r.wire))!==0)fail('AUTH_IDENTITY_PEER_RESULT_CHANGED');o.wire=new Uint8Array(r.wire);}}
 #run(action,guard=null){if(this.#busy)fail('AUTH_IDENTITY_PEER_BUSY');this.#busy=true;this.#activeGuard=guard;const p=Promise.resolve().then(action).catch(async cause=>{this.#remember(cause);try{this.#capture();}catch(e){this.#remember(e,'cleanup');}this.retire();this.#own.phase='failed';this.#own.needsSave=true;
   // Never automatically flush an uncertain write, nor try a foreign review's
   // held original. The explicit save route reconciles that exact owner first.
   if(!this.#deps.evidence.pending()&&!this.#own.storagePresent)try{await this.#store();}catch{}throw cause;
  }).finally(()=>{this.#busy=false;this.#activeGuard=null;});this.#work=p;void p.catch(()=>{});return p;}
 status(){const o=this.#own;return Object.freeze({operationId:o?.id??null,reviewId:o?.review?.describe().reviewId??null,phase:o?.phase??'idle',decision:o?.decision??null,busy:this.#busy,retired:o?.retired??false,closed:o?.closed??false,hasSignedResult:!!o?.wire,sendSelected:o?.sendSelected??false,sendStarted:o?.sendStarted??false,sendReturned:o?.sendReturned??false,firstCausePresent:o?.firstPresent??false,storageCausePresent:o?.storagePresent??false,cleanupCausePresent:o?.cleanupPresent??false,localSaveRequired:o?.needsSave??false,dataOnly:true,userApproved:false,handoffAuthorized:false,retryAuthorized:false});}
 review(){const o=this.#own;if(!o?.review)return null;const detail=o.review.describe();return Object.freeze({...detail,approvalAvailable:o.purpose!=='AUTH-PROTECTED-KEY-CALL',approvalUnavailableCode:o.purpose==='AUTH-PROTECTED-KEY-CALL'?(detail.publication?'AUTH_IDENTITY_PUBLICATION_APPROVAL_NOT_SUPPLIED':'AUTH_IDENTITY_KEY_CALL_REVIEW_NOT_SUPPLIED'):null});}
 start(guard){
  if(this.#busy||this.#own&&!this.#own.closed)fail('AUTH_IDENTITY_PEER_PENDING');this.assertSafeToClose();guard.assert();
  this.#own={id:randomUUID(),sequence:0,account:guard.account,source:null,sourceKnown:false,policy:null,policyKnown:false,review:null,raw:null,invocation:null,purpose:null,decision:null,wire:null,phase:'launch-selected',sendSelected:false,sendStarted:false,sendReturned:false,retired:false,closed:false,needsSave:false,firstPresent:false,storagePresent:false,cleanupPresent:false,cleanupDebt:false,nativeRetired:false,policyRetired:false,nativeCloseSelected:false,policyCloseSelected:false,nativeClosed:false,policyClosed:false};
  return this.#run(async()=>{
   await this.#store();this.#guard(guard);const o=this.#own;
   o.source=await this.#deps.acquireSource(); // Keep cleanup partial BEFORE recognition/readiness.
   if(this.#deps.isSource(o.source)!==true)fail('AUTH_IDENTITY_PEER_SOURCE_REQUIRED');o.sourceKnown=true;this.#guard(guard);sync(o.source,'assertReady');sync(o.source,'launch');
   const packet=await o.source.receiveRequest();exact(packet,['requestRaw','invocationRaw']);o.raw=raw(packet.requestRaw);o.invocation=packet.invocationRaw===null?null:raw(packet.invocationRaw);o.phase='request-captured';await this.#store();
   // Native has already bound this packet. Never call bindRequest again.
   this.#current(guard);if(o.source.copyRequestOriginal()!==o.raw)fail('AUTH_IDENTITY_PEER_ORIGINAL_CHANGED');const body=this.#deps.inspect(o.raw);o.purpose=body.purpose;
   if(!['AUTH-IDENTITY-RECEIVE','AUTH-IDENTITY-RECOVER','AUTH-PROTECTED-KEY-CALL'].includes(o.purpose)||body.owner!==o.account||(o.purpose==='AUTH-PROTECTED-KEY-CALL')!==(o.invocation!==null))fail('AUTH_IDENTITY_PEER_REQUEST_REFUSED');
   o.review=this.#deps.createReview({requestOriginal:o.raw,expectedOriginal:o.raw,invocationOriginal:o.invocation,purpose:o.purpose,assertCurrent:()=>this.#current(),getSnapshot:()=>{if(!o.policy||!o.policyKnown)fail('AUTH_IDENTITY_POLICY_REQUIRED');sync(o.policy,'assertCurrent');return o.policy.readOriginal().authorization;}});
   o.phase='review-ready';await this.#store();this.#current(guard);return this.review();
  },guard);
 }
 decide(reviewId,decision,guard){
  const o=this.#own;if(!o?.review||o.review.describe().reviewId!==reviewId||!['approve','reject','cancel'].includes(decision)||o.decision!==null)fail('AUTH_IDENTITY_PEER_REVIEW_INVALID');
  // Parsed publication semantics are DATA, not independently current publisher
  // authority, explicit release approval or a once-only Native signing effect.
  // A digest/manifest alone cannot open this gate. Reject/cancel remain usable.
  if(decision==='approve'&&o.purpose==='AUTH-PROTECTED-KEY-CALL')fail(o.review.describe().publication?'AUTH_IDENTITY_PUBLICATION_APPROVAL_NOT_SUPPLIED':'AUTH_IDENTITY_KEY_CALL_REVIEW_NOT_SUPPLIED');
  return this.#run(async()=>{
   this.#current(guard);o.decision=decision;o.phase='decision-selected';await this.#store();this.#current(guard);
   if(decision==='approve'){
    const body=this.#deps.inspect(o.raw);try{o.policy=await this.#deps.acquirePolicy(body);}catch(e){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'partial'):null;if(d&&Object.hasOwn(d,'value')){o.policy=d.value;o.policyKnown=this.#deps.isPolicyCleanupOwner(o.policy)===true;}throw e;}
    if(this.#deps.isPolicy(o.policy)!==true)fail('AUTH_IDENTITY_POLICY_REQUIRED');o.policyKnown=true;this.#current(guard);if(await o.policy.recheck()!==undefined)fail('AUTH_IDENTITY_POLICY_RECHECK_INVALID');this.#current(guard);
   }
   const selected=await o.review.decide(reviewId,decision,guard);this.#capture();this.#current(guard);if(o.policy){if(await o.policy.recheck()!==undefined)fail('AUTH_IDENTITY_POLICY_RECHECK_INVALID');this.#current(guard);}
   // The original proof/choice is durable before selecting a sole Native send.
   // A selected-but-failed save/send never becomes permission to resend later.
   o.sendSelected=true;o.phase='send-selected';await this.#store();this.#current(guard);
   const send=async()=>{o.sendStarted=true;try{return await o.source.sendDecision(decision,decision==='approve'?new Uint8Array(o.wire):undefined);}catch(e){this.#remember(e);throw e;}};
   if(await guard.deliver(send)!==undefined)fail('AUTH_IDENTITY_PEER_SEND_UNKNOWN');o.sendReturned=true;o.phase='send-returned';await this.#store();
   this.#current(guard,true);if(o.policy){if(await o.policy.recheck()!==undefined)fail('AUTH_IDENTITY_POLICY_RECHECK_INVALID');this.#current(guard,true);}
   return Object.freeze({...selected,sendReturned:true,effectAcknowledged:false,handoffAuthorized:false});
  },guard);
 }
 retire(){const o=this.#own;if(!o)return;o.retired=true;o.review?.retire();for(const [name,known,selected]of [['source','sourceKnown','nativeRetired'],['policy','policyKnown','policyRetired']])if(o[name]&&o[known]&&!o[selected]){o[selected]=true;try{sync(o[name],'retire');}catch(e){this.#remember(e,'cleanup');o.cleanupDebt=true;}}}
 async #cleanup(){
  const o=this.#own;this.retire();for(const [name,known,selected,closed]of [['source','sourceKnown','nativeCloseSelected','nativeClosed'],['policy','policyKnown','policyCloseSelected','policyClosed']]){
   if(!o[name]){o[closed]=true;continue;}if(o[closed])continue;if(!o[known]||o[selected])fail('AUTH_IDENTITY_PEER_CLEANUP_UNKNOWN');
   try{if(await o[name].join()!==undefined)fail('AUTH_IDENTITY_PEER_JOIN_UNKNOWN');}catch(e){this.#remember(e,'cleanup');throw e;}
   o[selected]=true;try{if(await o[name].close()!==undefined)fail('AUTH_IDENTITY_PEER_CLOSE_UNKNOWN');o[closed]=true;}catch(e){this.#remember(e,'cleanup');o.cleanupDebt=true;throw e;}
  }
  if(o.cleanupDebt)fail('AUTH_IDENTITY_PEER_CLEANUP_UNKNOWN');o.closed=true;o.phase='closed';await this.#store();
 }
 save(guard){if(!this.#own)fail('AUTH_IDENTITY_PEER_NO_ORIGINAL');return this.#run(async()=>{
  this.#guard(guard);const o=this.#own,pending=this.#deps.evidence.pending(),r=o.review;
  if(r&&pending?.reviewId===r.describe().reviewId&&r.status().decision&&!r.status().recorded)await r.save(guard);
  await this.#store();if(r&&r.status().decision&&!r.status().recorded)await r.save(guard);await this.#cleanup();return Object.freeze({operationId:o.id,saved:true,closed:o.closed,handoffAuthorized:false,retryAuthorized:false});
 },guard);}
 async shutdown(){if(!this.#own)return;this.retire();await this.#work?.catch(()=>{});if(this.#busy)fail('AUTH_IDENTITY_PEER_BUSY');if(this.#own.needsSave||this.#deps.evidence.pending())fail('AUTH_IDENTITY_PEER_LOCAL_SAVE_REQUIRED');return this.#run(()=>this.#cleanup());}
 async history(guard){
  guard.assert();const found=await this.#deps.evidence.candidates(),latest=new Map();for(const ref of found.candidates){const body=await this.#deps.evidence.read(ref);guard.assert();if(body.version!=='YNX-WALLET-IDE-PEER-EVIDENCE/v1'||body.account!==guard.account)continue;const prior=latest.get(body.operationId);if(prior&&prior.sequence===body.sequence&&JSON.stringify(prior)!==JSON.stringify(body))fail('AUTH_IDENTITY_PEER_HISTORY_CONFLICT');if(!prior||BigInt(body.sequence)>BigInt(prior.sequence))latest.set(body.operationId,body);}
  guard.assert();return Object.freeze({records:Object.freeze([...latest.values()].map(o=>Object.freeze({operationId:o.operationId,sequence:o.sequence,reviewId:o.reviewId,phase:o.phase,decision:o.decision,hasSignedResult:o.wire!==null,sendSelected:o.sendSelected,sendStarted:o.sendStarted,sendReturned:o.sendReturned,closed:o.closed,firstCausePresent:o.firstCause.present===true,storageCausePresent:o.storageCause.present===true,cleanupCausePresent:o.cleanupCause.present===true,dataOnly:true,effectAcknowledged:false,handoffAuthorized:false,retryAuthorized:false}))),unreadable:found.unreadable});
 }
 assertSafeToClose(){this.#deps.evidence.assertSafeToClose();const o=this.#own;if(this.#busy||o&&(!o.closed||o.needsSave||o.cleanupDebt))fail('AUTH_IDENTITY_PEER_CLOSE_UNCONFIRMED');o?.review?.assertSafeToClose();}
}
