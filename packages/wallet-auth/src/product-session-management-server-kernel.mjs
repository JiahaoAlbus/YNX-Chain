// PRIVATE Auth orchestration. Direct construction is a PUBLIC seam only;
// actual HTTP accepts only the normal factory's independent Source brand.
import {canonicalJSON} from './canonical.js';
import {pairV4Digest} from './product-pair-session-v4-store.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS,productSessionHTTPProofV4ReplayKey} from './product-session-device-v4.js';
import {productPairSessionV4ActorDATA} from './product-pair-session-v4-issuer.js';
import {decodeProductSessionProofHeaderV4,inspectProductSessionHTTPProofHeaderV4Data} from './product-session-proof-v4.js';
import {decodeProductSessionManagementV4RequestDATA,inspectProductSessionManagementV4ProofDATA,assertProductSessionManagementV4RecoveryDATA,encodeProductSessionManagementV4ResponseDATA,PRODUCT_SESSION_MANAGEMENT_V4_ROUTES} from './product-session-management-v4.js';
import {OriginalReadOnlyChildDebtV4} from './original-readonly-child-debt-v4.js';
import {types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
export const ORIGINAL_MANAGEMENT_SOURCE_PURPOSE='product-session-registered-management-service-v4';
export const ORIGINAL_COMPLETION_QUERY_SOURCE_PURPOSE='product-session-completion-query-service-v4';
const productionMath=Object.freeze({header:inspectProductSessionHTTPProofHeaderV4Data,body:inspectProductSessionManagementV4ProofDATA});
const TA=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(TA,'buffer').get,getLength=Object.getOwnPropertyDescriptor(TA,'byteLength').get,set=Uint8Array.prototype.set,abort=AbortSignal.prototype.throwIfAborted;
function original(raw){if(types.isProxy(raw)||!Buffer.isBuffer(raw))fail('PAIR_V4_MANAGEMENT_INPUT');const n=getLength.call(raw);if(types.isSharedArrayBuffer(getBuffer.call(raw))||n<1||n>393216)fail('PAIR_V4_MANAGEMENT_INPUT');const out=Buffer.alloc(n);set.call(out,raw);return out;}

export class ProductSessionManagementServerKernelV4 {
 #source;#math;#clock;#floor=0;#retired=false;#pending=new Set();#debts=new Map();#closed=false;#sourceDebt;#first;#closing;
 constructor(source,math=productionMath,clock=Date.now){this.#source=source;this.#math=math;this.#clock=clock;}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<0||n<this.#floor)fail('PAIR_V4_MANAGEMENT_CLOCK');this.#floor=n;return n;}
 #active(signal){if(this.#retired)fail('PAIR_V4_MANAGEMENT_RETIRED');if(signal!==undefined)abort.call(signal);}
 #retain(owner){const debt=new OriginalReadOnlyChildDebtV4(owner);this.#debts.set(owner,debt);return debt;}
 async #dispose(owner,debt){await debt.drain();if(debt.closed)this.#debts.delete(owner);}
 execute(operation,bodyOriginal,proofHeader,signal){
  this.#active(signal);if(!Object.hasOwn(PRODUCT_SESSION_MANAGEMENT_V4_ROUTES,operation)||this.#pending.size>=8||this.#debts.size>=32)fail('PAIR_V4_MANAGEMENT_INPUT');
  const raw=original(bodyOriginal),p=Promise.resolve().then(()=>this.#execute(operation,raw,proofHeader,signal));this.#pending.add(p);const done=()=>this.#pending.delete(p);p.then(done,done);return p;
 }
 async #execute(op,raw,header,signal){
  let lease,leaseDebt,reader,readerDebt,result,error,entered=false,deadline=Infinity;
  try{
   this.#active(signal);const at=this.#now(),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),body=JSON.parse(text);
   if(canonicalJSON(body)!==text||typeof body.registrationOriginal!=='string'||typeof body.account!=='string')fail('PAIR_V4_MANAGEMENT_ORIGINAL');
   const view=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(body.registrationOriginal)),record=view.record;
   const action=op==='recover'?'completion-query-original':op==='revoke'?(body.sessionBinding===null?'revoke-registration':'revoke-session'):op==='cancel'?'cancel-challenge':'active';
   const purpose=op==='recover'?ORIGINAL_COMPLETION_QUERY_SOURCE_PURPOSE:ORIGINAL_MANAGEMENT_SOURCE_PURPOSE;
   if(this.#source.purpose!==purpose||!this.#source.operations.includes(action))fail('PAIR_V4_MANAGEMENT_ROLE_ALLOWLIST');
   lease=await this.#source.acquire(body.registrationOriginal,body.account,at);if(lease)leaseDebt=this.#retain(lease);
   if(!lease||!Number.isSafeInteger(lease.expiresAtMs))fail('PAIR_V4_MANAGEMENT_LEASE');
   const claimed=decodeProductSessionProofHeaderV4(header),window=this.#source.window;
   if(Date.parse(claimed.issuedAt)>at||at>=Date.parse(claimed.expiresAt)||Date.parse(claimed.issuedAt)<window.issuedAtMs||Date.parse(claimed.expiresAt)>window.expiresAtMs||claimed.issuedAt<record.registeredAt||claimed.expiresAt>record.expiresAt)fail('PAIR_V4_MANAGEMENT_PROOF_WINDOW');
   deadline=Math.min(lease.expiresAtMs,Date.parse(claimed.expiresAt),Date.parse(record.expiresAt));
   const {member,...candidate}=claimed;
   const unsigned={...candidate,version:'4',productId:record.productId,clientId:record.clientId,applicationId:record.applicationId,bundleId:record.bundleId,packageId:record.packageId,origin:record.origin,callback:record.callback,account:body.account,canonicalOwner:record.canonicalOwner,deviceId:record.deviceId,deviceRegistrationId:record.registrationId,deviceRegistrationRevision:record.revision,deviceRegistrationDigest:view.registrationDigest,method:'POST',path:PRODUCT_SESSION_MANAGEMENT_V4_ROUTES[op],bodyDigest:pairV4Digest(raw)};
   const expected={networkId:record.networkId,unsigned,pkA:record.pkA,pkB:record.pkB};
   const current=async()=>{this.#active(signal);const n=this.#now();if(n>=lease.expiresAtMs||n>=Date.parse(unsigned.expiresAt))fail('PAIR_V4_MANAGEMENT_POST_EXPIRED');if(await lease.recheck(n)!==undefined)fail('PAIR_V4_MANAGEMENT_CURRENT_REFUSED');this.#active(signal);if(lease.assertCurrent(this.#now())!==undefined)fail('PAIR_V4_MANAGEMENT_CURRENT_REFUSED');if(this.#now()>=Date.parse(unsigned.expiresAt))fail('PAIR_V4_MANAGEMENT_POST_EXPIRED');};
   await current();const proof=this.#math.header(header,expected);if(proof?.signatureVerified!==true)fail('PAIR_V4_MANAGEMENT_REGISTERED_N1_REQUIRED');await current();
   const actor=productPairSessionV4ActorDATA(record,record,body.account),registry=this.#source.registry;
   let decoded,originalDigest=null,original=null,state='OBSERVED',code=null;
   if(op==='recover'){
    // Read-only intended COMPLETE binding is never an active-session lease.
    const old=this.#source.captureOperation(actor,body.operationId,'COMPLETE');old.assertCurrent();const input=JSON.parse(old.inputOriginal);
    if(input.operationId!==body.operationId||input.registrationOriginal!==body.registrationOriginal||canonicalJSON(input.request)!==canonicalJSON(body.request)||input.approval?.account!==body.account||!input.completion?.challenge)fail('PAIR_V4_MANAGEMENT_RECOVERY_BINDING');
    const target={kind:'completion',operationId:body.operationId,approvalOriginal:canonicalJSON(input.approval),challengeOriginal:canonicalJSON(input.completion.challenge)};
    decoded=this.#math.body(registry,op,raw,header,expected,target);if(decoded?.signatureVerified!==true)fail('PAIR_V4_MANAGEMENT_REGISTERED_N1_REQUIRED');
    assertProductSessionManagementV4RecoveryDATA(decoded,{operationId:body.operationId,originalBodyDigest:old.inputDigest,originalBodyOriginal:Buffer.from(old.inputOriginal)});
    old.assertCurrent();originalDigest=old.inputDigest;state=old.phase==='UNKNOWN'?'UNKNOWN':'OBSERVED';original=state==='OBSERVED'?old.original:null;code=state==='UNKNOWN'?'PAIR_V4_RECOVER_ORIGINAL_ONLY':null;
    await current();old.assertCurrent();
   }else{
    decoded=this.#math.body(registry,op,raw,header,expected);if(decoded?.signatureVerified!==true)fail('PAIR_V4_MANAGEMENT_REGISTERED_N1_REQUIRED');
    const kind=op==='revoke'?'REVOKE':'CANCEL';
    const prior=op==='active'?null:this.#source.captureOperation(actor,body.operationId,kind,true);
    if(prior){
     // Same original op/body only: final-observe/UNKNOWN, no new nonce consume
     // or effect, and no old target-active predicate after legitimate revoke.
     prior.assertCurrent();if(prior.inputOriginal!==text||prior.inputDigest!==pairV4Digest(raw))fail('PAIR_V4_IDEMPOTENCY_MISMATCH');
     state=prior.phase==='UNKNOWN'?'UNKNOWN':'OBSERVED';original=state==='OBSERVED'?prior.original:null;code=state==='UNKNOWN'?'PAIR_V4_RECOVER_ORIGINAL_ONLY':null;
     if(state==='OBSERVED')this.#source.terminalTarget(actor,record.registrationId,op==='revoke'?body.sessionBinding:null,op==='cancel'?body.challengeId:null);
     await current();prior.assertCurrent();
    }else{
     reader=this.#source.createCurrentReader();readerDebt=this.#retain(reader);const context=Object.freeze({signal:signal??new AbortController().signal});
     const e={...record,account:body.account,sessionBinding:claimed.sessionBinding,registrationDigest:view.registrationDigest};const expectedCurrent=Object.fromEntries(PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS.map(k=>[k,e[k]]));
     const ref=await reader.readCurrent(expectedCurrent,context);const readerCurrent=async()=>{if(await reader.assertCurrent(ref,context)!==undefined)fail('PAIR_V4_MANAGEMENT_CURRENT_REFUSED');};await readerCurrent();
     if(!Buffer.from(reader.readRegistrationOriginal(ref)).equals(Buffer.from(body.registrationOriginal)))fail('PAIR_V4_MANAGEMENT_REGISTRATION_CHANGED');
     const sessionOriginal=reader.readSessionOriginal(ref);await readerCurrent();await current();
     if(Date.parse(claimed.expiresAt)>Date.parse(JSON.parse(sessionOriginal).expiresAt))fail('PAIR_V4_MANAGEMENT_SESSION_WINDOW');
     if(op==='active'){
      entered=true;this.#source.consumeNonce({actor,sessionBinding:claimed.sessionBinding,replayKey:productSessionHTTPProofV4ReplayKey(header),expiresMs:Date.parse(claimed.expiresAt),at:this.#now()});
      await readerCurrent();original=sessionOriginal;await current();
     }else{
      await readerCurrent();const target=this.#source.targetCurrent(actor,record.registrationId,op==='revoke'?body.sessionBinding:null,op==='cancel'?body.challengeId:null,this.#now());
      if(op==='revoke'&&target.original!==(body.sessionBinding===null?body.registrationOriginal:sessionOriginal))fail('PAIR_V4_MANAGEMENT_TARGET_CHANGED');
      // Stop/close the pre-state active lease BEFORE mutation. Independent
      // Source/Root/account-current lease remains held through terminal check.
      await this.#dispose(reader,readerDebt);reader=null;readerDebt=null;await current();
      if(this.#now()>=target.expiresAtMs)fail('PAIR_V4_MANAGEMENT_TARGET_EXPIRED');
      entered=true;this.#source.consumeNonce({actor,sessionBinding:claimed.sessionBinding,replayKey:productSessionHTTPProofV4ReplayKey(header),expiresMs:Date.parse(claimed.expiresAt),at:this.#now()});
      if(lease.assertCurrent(this.#now())!==undefined)fail('PAIR_V4_MANAGEMENT_CURRENT_REFUSED');const reserved=this.#source.reserve({actor,operation:body.operationId,kind,input:text,at:this.#now()});
      if(reserved.recoveryOnly)fail('PAIR_V4_RECOVER_ORIGINAL_ONLY');if(lease.assertCurrent(this.#now())!==undefined)fail('PAIR_V4_MANAGEMENT_CURRENT_REFUSED');
      const terminal=op==='revoke'?canonicalJSON({registrationId:record.registrationId,sessionBinding:body.sessionBinding,revoked:true}):canonicalJSON({challengeId:body.challengeId,cancelled:true});
      original=op==='revoke'?this.#source.revoke(reserved.ticket,{registrationId:body.sessionBinding===null?record.registrationId:null,sessionBinding:body.sessionBinding,result:terminal,expectedOriginal:target.original},this.#now()):this.#source.cancel(reserved.ticket,{challengeId:body.challengeId,result:terminal,expectedOriginal:target.original},this.#now());
      result={original}; // Retain actual public terminal BEFORE late fences.
      const observed=this.#source.captureOperation(actor,body.operationId,kind);observed.assertCurrent();const changed=this.#source.terminalTarget(actor,record.registrationId,op==='revoke'?body.sessionBinding:null,op==='cancel'?body.challengeId:null);
      if(observed.phase!=='COMMITTED'||observed.original!==original||observed.inputOriginal!==text||observed.inputDigest!==pairV4Digest(raw)||changed.original!==target.original||original!==terminal)fail('PAIR_V4_MANAGEMENT_TERMINAL_MISMATCH');
      await current();observed.assertCurrent();
     }
    }
   }
   const selection={operation:op,operationId:op==='active'?null:body.operationId,requestBodyDigest:pairV4Digest(raw),originalRequestBodyDigest:originalDigest};
   result=Buffer.from(encodeProductSessionManagementV4ResponseDATA({version:'4',...selection,state,original,code},selection));await current();
  }catch(cause){error={cause};}
  for(const[owner,debt]of[[reader,readerDebt],[lease,leaseDebt]])if(owner&&debt)try{await this.#dispose(owner,debt)}catch(cause){error??={cause};}
  try{this.#active(signal);if(this.#now()>=deadline)fail('PAIR_V4_MANAGEMENT_POST_CLEANUP_EXPIRED');}catch(cause){error??={cause};}
  if(error){this.#first??=error;throw Object.assign(Error('PAIR_V4_MANAGEMENT_UNRESOLVED'),{code:'PAIR_V4_MANAGEMENT_UNRESOLVED',cause:error.cause,partial:result??null,recoverOnly:entered||result!==undefined});}return result;
 }
 retire(){this.#retired=true;}
 async join(){if(!this.#retired)fail('PAIR_V4_MANAGEMENT_NOT_RETIRED');while(this.#pending.size)await Promise.allSettled([...this.#pending]);for(const[owner,debt]of this.#debts)await this.#dispose(owner,debt);if(this.#debts.size)fail('PAIR_V4_MANAGEMENT_CHILD_DEBT');}
 async #drain(){this.retire();await this.join();this.#sourceDebt??=new OriginalReadOnlyChildDebtV4(this.#source);await this.#sourceDebt.drain();if(this.#sourceDebt.closed)this.#closed=true;}
 close(){if(!this.#closing)this.#closing=this.#drain().catch(cause=>{this.#first??={cause};throw cause;});return this.#closing;}
 async drainPartial(){if(!this.#closing)fail('PAIR_V4_MANAGEMENT_NOT_CLOSING');await this.#drain();}
 status(){return Object.freeze({retired:this.#retired,closed:this.#closed,pending:this.#pending.size,childDebt:this.#debts.size,firstCausePresent:!!this.#first,firstCause:this.#first?.cause});}
}
