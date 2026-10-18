import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {types} from 'node:util';
import {fileURLToPath} from 'node:url';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {originalPrivateCarrierBudget} from './original-wallet-service-private-carrier.js';
import {prepareOriginalPrivateTerminalV3} from '../native/terminal-custody-recovery-r30a-20261018/source/terminal-response-v3.mjs';

// Fixed original Native owner only. No production Node filesystem writer,
// alternate addon path, dependency callback or fallback implementation exists.
const requireNative=createRequire(import.meta.url);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw new WalletAuthError(code,'Original Host terminal custody unavailable');};
function terminalLinks(body,entered){
 if(![2,3].includes(body?.v))return body;
 exactFields(body,body.v===3?['v','k','e','s','x']:['v','k','e','q','a','o','p','id','r','b','s','x'],'Original compact terminal');
 if(body.k!=='terminal'||typeof body.x!=='string'||Buffer.byteLength(body.x)>65536||!digest(body.s)||body.v===2&&(!digest(body.r)||sha(body.x)!==body.r||!digest(body.b)))fail('HOST_TERMINAL_COLD_UNKNOWN');
 let response;try{response=JSON.parse(body.x);}catch{fail('HOST_TERMINAL_COLD_UNKNOWN');}
 if(canonicalJSON(response)!==body.x)fail('HOST_TERMINAL_COLD_UNKNOWN');
 exactFields(response,['status','headers','body'],'Original compact response');
 if(response.headers?.['x-request-id']!==(body.v===3?entered.requestId:body.id))fail('HOST_TERMINAL_COLD_UNKNOWN');
 if(body.v===3)return {kind:body.k,enteredDigest:body.e,requestDigest:entered.requestDigest,associationDigest:entered.associationDigest,operation:entered.operation,phase:entered.phase,requestId:entered.requestId,stateBeforeDigest:entered.stateBeforeDigest,stateAfterDigest:body.s};
 return {kind:body.k,enteredDigest:body.e,requestDigest:body.q,associationDigest:body.a,operation:body.o,phase:body.p,requestId:body.id,stateBeforeDigest:body.b,stateAfterDigest:body.s};
}
const names={open:'openOriginalHostTerminalJournal',ready:'assertOriginalHostTerminalJournalReady',list:'listOriginalHostTerminalJournal',read:'readOriginalHostTerminalJournal',write:'writeOriginalHostTerminalJournal',retire:'retireOriginalHostTerminalJournal',join:'joinOriginalHostTerminalJournal',close:'closeOriginalHostTerminalJournal'};


const firstEnterNames={capture:'captureOriginalPersistentFirstEnter',ready:'assertOriginalPersistentFirstEnterReady',challenge:'copyOriginalPersistentFirstEnterChallenge',accept:'acceptOriginalPersistentFirstEnterWitness',retire:'retireOriginalPersistentFirstEnter',join:'joinOriginalPersistentFirstEnter',close:'closeOriginalPersistentFirstEnter'};
function plainFields(value,fields){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('FIRST_ENTER_DATA_INVALID');
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))fail('FIRST_ENTER_DATA_INVALID');
}
function firstEnterRequest(raw){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>65536)fail('FIRST_ENTER_REQUEST_INVALID');
 let input;try{input=JSON.parse(raw);}catch{fail('FIRST_ENTER_REQUEST_INVALID');}
 originalPrivateCarrierBudget(input);
 if(canonicalJSON(input)!==raw||input.carrierVersion!=='YNX-PRODUCT-SESSION-PRIVATE/v4'||input.operation!=='handleReturn'||input.phase!=='effect'||input.referenceAction!=='complete')fail('FIRST_ENTER_REQUEST_INVALID');
 return input;
}
function firstEnterChallenge(value,raw,input){
 plainFields(value,['version','requestId','originalRequestRaw','binding','witnessNonce','dataOnly','nativeAdmission']);
 plainFields(value.binding,['requestDigest','enteredDigest','hostStateDigest']);
 if(value.version!=='YNX-AUTH-PERSISTENT-ENTERED/v1'||value.originalRequestRaw!==raw||value.requestId!==input.requestId||value.dataOnly!==true||value.nativeAdmission!==false||typeof value.witnessNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.witnessNonce)||Buffer.from(value.witnessNonce,'base64url').toString('base64url')!==value.witnessNonce||Object.values(value.binding).some(x=>!digest(x))||value.binding.requestDigest!==sha(raw))fail('FIRST_ENTER_DATA_INVALID');
 return Object.freeze({...value,binding:Object.freeze({...value.binding})});
}
function rememberFirstEnter(s,cause){s.unknown=true;if(!s.firstCausePresent){s.firstCausePresent=true;s.firstCause=cause;}s.remember?.(cause);}
function currentFirstEnter(s){
 if(s.retired||s.firstCausePresent)throw s.firstCausePresent?s.firstCause:Object.assign(new Error('First enter retired'),{code:'FIRST_ENTER_RETIRED'});
 s.current();if(!s.owner||s.methods.ready(s.owner)!==undefined)fail('FIRST_ENTER_NOT_READY');
}
function firstEnterCleanup(s,step){
 if(step==='retire')s.retired=true;
 if(s.active){const cause=Object.assign(new Error('First enter work pending'),{code:'FIRST_ENTER_JOIN_PENDING'});if(!s.cleanupCausePresent){s.cleanupCausePresent=true;s.cleanupCause=cause;}rememberFirstEnter(s,cause);throw cause;}
 const selected=step+'Selected',failed=step+'Failed',causeKey=step+'Cause';
 if(s[selected]){if(s[failed])throw s[causeKey];return;}
 s[selected]=true;
 try{if(s.owner){if(s.methods[step](s.owner)!==undefined)fail('FIRST_ENTER_CLEANUP_UNKNOWN');}else if(s.captureEntered)fail('FIRST_ENTER_CAPTURE_UNKNOWN');if(step==='close')s.closeConfirmed=true;}
 catch(cause){s[failed]=true;s[causeKey]=cause;if(!s.cleanupCausePresent){s.cleanupCausePresent=true;s.cleanupCause=cause;}rememberFirstEnter(s,cause);throw cause;}
}
function closeFirstEnter(s){
 s.retired=true;for(const step of ['retire','join','close'])try{firstEnterCleanup(s,step);}catch{/* retain first cleanup failure independently */}
 if(s.cleanupCausePresent)throw s.cleanupCause;s.cleanupComplete=true;
}
function firstEnterClient(s){return Object.freeze({
 copyChallenge(){s.active++;try{currentFirstEnter(s);if(s.acceptSelected)fail('FIRST_ENTER_ALREADY_SELECTED');if(!s.challenge){s.originalChallenge=s.methods.challenge(s.owner);const data=firstEnterChallenge(s.originalChallenge,s.raw,s.input);currentFirstEnter(s);s.challenge=data;}return s.challenge;}catch(cause){rememberFirstEnter(s,cause);throw cause;}finally{s.active--;}},
 acceptWitness(raw){s.active++;try{currentFirstEnter(s);if(s.acceptSelected||!s.challenge)fail('FIRST_ENTER_ALREADY_SELECTED');s.acceptSelected=true;
  if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>32768)fail('FIRST_ENTER_WITNESS_INVALID');let witness;try{witness=JSON.parse(raw);}catch{fail('FIRST_ENTER_WITNESS_INVALID');}
  if(canonicalJSON(witness)!==raw)fail('FIRST_ENTER_WITNESS_INVALID');s.witnessRaw=raw;
  if(s.methods.accept(s.owner,raw)!==undefined)fail('FIRST_ENTER_ACCEPT_UNKNOWN');currentFirstEnter(s);s.accepted=true;
 }catch(cause){rememberFirstEnter(s,cause);throw cause;}finally{s.active--;}},
 retire(){return firstEnterCleanup(s,'retire');},join(){if(!s.retired)fail('FIRST_ENTER_JOIN_PENDING');return firstEnterCleanup(s,'join');},close(){return closeFirstEnter(s);},
 status:()=>Object.freeze({retired:s.retired,accepted:s.accepted,unknown:s.unknown,firstCausePresent:s.firstCausePresent,firstCause:s.firstCause,cleanupCausePresent:s.cleanupCausePresent,cleanupCause:s.cleanupCause,cleanupComplete:s.cleanupComplete})
 });}

export class OriginalHostTerminalJournal {
 #firstEnters=new Map();#path;#original;#native;#loan;#records=new Map();#coldCount=0;#unknown=false;#cause;#causePresent=false;#retired=false;#nativeCloseSelected=false;#closeComplete=false;#cleanupCause;#cleanupCausePresent=false;#entered=0;#opened=false;#retireSelected=false;#retireCause;#retireCausePresent=false;#joinSelected=false;#joinCause;#joinCausePresent=false;
 constructor(statePath,originalNativeBorrow){
  if(typeof statePath!=='string'||!statePath.startsWith('/')||statePath.split('/').some(part=>part==='.'||part==='..')||statePath.includes('\0')||!originalNativeBorrow)fail('HOST_DIRFD_ORIGINAL_OWNER_REQUIRED');
  this.#path=statePath;this.#original=originalNativeBorrow;
 }
 #remember(cause){this.#unknown=true;if(!this.#causePresent){this.#causePresent=true;this.#cause=cause;}}
 open(){
  if(this.#opened||this.#retired||this.#unknown)fail('HOST_TERMINAL_ALREADY_SELECTED');this.#opened=true;
  try{
   this.#native=requireNative(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
   if(Object.values(names).some(name=>typeof this.#native[name]!=='function'))fail('HOST_DIRFD_IMPLEMENTATION_NOT_SUPPLIED');
   this.#loan=this.#native[names.open](this.#original,this.#path); // Capture partial before ready can fail.
   if(!this.#loan||this.#native[names.ready](this.#loan)!==undefined)fail('HOST_DIRFD_ORIGINAL_OWNER_REQUIRED');
   const files=this.#native[names.list](this.#loan);
   if(!Array.isArray(files)||files.length>128||new Set(files).size!==files.length||files.some(name=>typeof name!=='string'||!/^[a-f0-9]{64}\.(entered|terminal)$/.test(name)))fail('HOST_TERMINAL_COLD_UNKNOWN');
   for(const name of files){
    if(!name.endsWith('.entered'))continue;
    const key=name.slice(0,64);if(!files.includes(key+'.terminal'))fail('HOST_TERMINAL_COLD_UNKNOWN');
    const entered=this.#read(name),terminal=terminalLinks(this.#read(key+'.terminal').body,entered.body);
    if(entered.body.kind!=='entered'||terminal.kind!=='terminal'||terminal.enteredDigest!==sha(entered.raw)||sha(canonicalJSON({requestId:entered.body.requestId,operation:entered.body.operation,phase:entered.body.phase}))!==key||terminal.requestDigest!==entered.body.requestDigest||terminal.associationDigest!==entered.body.associationDigest||['operation','phase','requestId','stateBeforeDigest'].some(k=>terminal[k]!==entered.body[k]))fail('HOST_TERMINAL_COLD_UNKNOWN');
   }
   if(files.some(name=>name.endsWith('.terminal')&&!files.includes(name.slice(0,64)+'.entered')))fail('HOST_TERMINAL_COLD_UNKNOWN');
   this.#coldCount=files.length/2;this.#current();
  }catch(cause){this.#remember(cause);throw cause;}
 }
 #current(){
  if(this.#retired||this.#unknown||!this.#loan)fail('HOST_TERMINAL_UNRESOLVED');
  if(this.#native[names.ready](this.#loan)!==undefined)fail('HOST_TERMINAL_UNRESOLVED');
 }
 #read(name){
  this.#current();const raw=this.#native[names.read](this.#loan,name);
  if(typeof raw!=='string'||Buffer.byteLength(raw)>8192)fail('HOST_TERMINAL_FILE_INVALID');
  let body;try{body=JSON.parse(raw);}catch{fail('HOST_TERMINAL_FILE_INVALID');}
  if(canonicalJSON(body)!==raw)fail('HOST_TERMINAL_FILE_INVALID');
  this.#current();return {raw:Buffer.from(raw),body};
 }
 #write(name,body){
  this.#current();const raw=canonicalJSON(body);if(Buffer.byteLength(raw)>8192)fail('HOST_TERMINAL_CAPACITY');
  if(this.#native[names.write](this.#loan,name,raw)!==undefined)fail('HOST_TERMINAL_WRITE_UNKNOWN');
  const read=this.#read(name);if(read.raw.toString()!==raw)fail('HOST_TERMINAL_READBACK_MISMATCH');return read;
 }
 /** Captures the exact original writer loan; no caller may supply a Native
  * owner, path, Source, clock, signer or callback. Failed capture is once-only. */
 capturePersistentFirstEnter(raw){
  this.#entered++;let s;
  try{
   const prior=[...this.#firstEnters.values()].find(s=>s.raw===raw);if(prior){if(prior.firstCausePresent)throw prior.firstCause;fail('FIRST_ENTER_ALREADY_CAPTURED');}
   this.#current();if([...this.#records.values()].some(row=>!row.terminal))fail('HOST_TERMINAL_PREVIOUS_UNKNOWN');const input=firstEnterRequest(raw),key=sha(canonicalJSON({requestId:input.requestId,operation:input.operation,phase:input.phase}));
   if(this.#firstEnters.has(key)||this.#records.has(key)||this.#coldCount+new Set([...this.#records.keys(),...this.#firstEnters.keys()]).size>=64)fail('FIRST_ENTER_ALREADY_CAPTURED');
   s={raw,input,key,owner:null,methods:null,captureEntered:false,active:1,retired:false,unknown:true,accepted:false,acceptSelected:false,challenge:null,firstCausePresent:false,firstCause:undefined,cleanupCausePresent:false,cleanupCause:undefined,cleanupComplete:false,closeConfirmed:false,current:()=>this.#current(),remember:cause=>this.#remember(cause)};
   s.client=firstEnterClient(s);this.#firstEnters.set(key,s); // Reserve before partial Native capture.
   if(Object.values(firstEnterNames).some(name=>typeof this.#native[name]!=='function'))fail('FIRST_ENTER_IMPLEMENTATION_NOT_SUPPLIED');
   s.methods=Object.freeze(Object.fromEntries(Object.entries(firstEnterNames).map(([k,name])=>[k,this.#native[name]])));
   s.captureEntered=true;
   try{s.owner=s.methods.capture(this.#loan,raw);}catch(cause){
    // R51 fixed capture alone guarantees this exact Native error precedes any
    // NEW child allocation. It says nothing about business UNKNOWN or effects.
    const code=cause&&!types.isProxy(cause)&&types.isNativeError(cause)?Object.getOwnPropertyDescriptor(cause,'code'):null;
    if(!s.owner&&code&&Object.hasOwn(code,'value')&&code.value==='HOST_TERMINAL_PREVIOUS_UNKNOWN')s.captureEntered=false;
    throw cause;
   }
   currentFirstEnter(s);return s.client;
  }catch(cause){if(s)rememberFirstEnter(s,cause);this.#remember(cause);throw cause;}finally{if(s)s.active=0;this.#entered--;}
 }
 getPersistentFirstEnterCleanup(raw){
  if(typeof raw!=='string')return null;for(const s of this.#firstEnters.values())if(s.raw===raw)return Object.freeze({retire:s.client.retire,join:s.client.join,close:s.client.close,status:s.client.status});return null;
 }
 reserve(input,association,stateBeforeDigest){
  this.#entered++;
  try{
   this.#current();const budget=originalPrivateCarrierBudget(input);if(Buffer.byteLength(canonicalJSON(input))>budget.envelope)fail('HOST_TERMINAL_CAPACITY');
   if([...this.#records.values()].some(row=>!row.terminal))fail('HOST_TERMINAL_PREVIOUS_UNKNOWN');
   if(!/^req_[A-Za-z0-9_-]{12,80}$/.test(input.requestId)||!['beginYNX','handleReturn','restore','disconnect'].includes(input.operation)||!['time','effect'].includes(input.phase)||!digest(stateBeforeDigest))fail('HOST_TERMINAL_BINDING_INVALID');
   exactFields(association,['account','clientId','productId','platform','applicationId','deviceId'],'Original Host association');
   if(Object.values(association).some(value=>typeof value!=='string'||!value||value.length>512))fail('HOST_TERMINAL_BINDING_INVALID');
   const associationDigest=sha(canonicalJSON(association)),requestDigest=sha(canonicalJSON(input));
   // Same operation ID cannot be reused with altered body/proof/association.
   const key=sha(canonicalJSON({requestId:input.requestId,operation:input.operation,phase:input.phase}));
   if(this.#records.has(key)||this.#coldCount+this.#records.size>=64)fail('HOST_TERMINAL_ALREADY_ENTERED');
   const row={key,entered:true,terminal:false,requestDigest,associationDigest,operation:input.operation,phase:input.phase,requestId:input.requestId,stateBeforeDigest,inputRaw:canonicalJSON(input),associationRaw:canonicalJSON(association),recoverable:input.carrierVersion==='YNX-PRODUCT-SESSION-PRIVATE/v4'&&input.referenceAction==='complete'};
   this.#records.set(key,row); // Preserve original even on late fsync/read failure.
   const entered={version:1,kind:'entered',requestDigest,associationDigest,operation:row.operation,phase:row.phase,requestId:row.requestId,stateBeforeDigest},attempt=this.#firstEnters.get(key);
   if(attempt){
    currentFirstEnter(attempt);if(!attempt.accepted||attempt.raw!==row.inputRaw||!attempt.challenge)fail('FIRST_ENTER_ACCEPT_REQUIRED');
    row.original=this.#read(key+'.entered'); // R48 Native accept already durably wrote this exact entry.
    if(row.original.raw.toString()!==canonicalJSON(entered)||sha(row.original.raw)!==attempt.challenge.binding.enteredDigest)fail('FIRST_ENTER_ENTERED_MISMATCH');
   }else row.original=this.#write(key+'.entered',entered);
   row.claim=Object.freeze({key});return row.claim;
  }catch(cause){this.#remember(cause);throw cause;}finally{this.#entered--;}
 }
 prepare(claim,response,stateAfterDigest){
  this.#entered++;
  try{
   this.#current();const row=this.#records.get(claim?.key);
   if(!row||row.claim!==claim||row.claimed||row.terminal||row.prepared||!digest(stateAfterDigest))fail('HOST_TERMINAL_ORIGINAL_CLAIM_REQUIRED');
   const original=this.#read(row.key+'.entered');if(!original.raw.equals(row.original.raw))fail('HOST_TERMINAL_ENTERED_CHANGED');
   const responseDigest=sha(canonicalJSON(response));
   const body=Object.freeze(row.recoverable?JSON.parse(prepareOriginalPrivateTerminalV3({enteredRaw:row.original.raw.toString(),inputRaw:row.inputRaw,associationRaw:row.associationRaw,responseRaw:canonicalJSON(response),stateAfterDigest}).raw):{version:1,kind:'terminal',enteredDigest:sha(row.original.raw),requestDigest:row.requestDigest,associationDigest:row.associationDigest,operation:row.operation,phase:row.phase,requestId:row.requestId,responseDigest,stateBeforeDigest:row.stateBeforeDigest,stateAfterDigest});
   if(Buffer.byteLength(canonicalJSON(body))>8192)fail('HOST_TERMINAL_CAPACITY');
   row.prepared=Object.freeze({body,responseDigest,stateAfterDigest});return undefined;
  }catch(cause){this.#remember(cause);throw cause;}finally{this.#entered--;}
 }
 commit(claim,response,stateAfterDigest){
  this.#entered++;
  try{
   this.#current();const row=this.#records.get(claim?.key);if(!row||row.claimed||row.terminal||!digest(stateAfterDigest))fail('HOST_TERMINAL_ORIGINAL_CLAIM_REQUIRED');
   // Only identical private claim object may complete this original reservation.
   if(row.claim!==claim)fail('HOST_TERMINAL_ORIGINAL_CLAIM_REQUIRED');
   if(!row.prepared)this.prepare(claim,response,stateAfterDigest);
   const responseDigest=sha(canonicalJSON(response));
   if(row.prepared.responseDigest!==responseDigest||row.prepared.stateAfterDigest!==stateAfterDigest)fail('HOST_TERMINAL_PREPARED_MISMATCH');
   row.claimed=true;
   const original=this.#read(row.key+'.entered');if(!original.raw.equals(row.original.raw))fail('HOST_TERMINAL_ENTERED_CHANGED');
   row.result=this.#write(row.key+'.terminal',row.prepared.body);
   row.terminal=true;return Object.freeze({key:row.key,responseDigest});
  }catch(cause){this.#remember(cause);throw cause;}finally{this.#entered--;}
 }
 assertTerminal(claim,response){
  try{
   this.#current();const row=this.#records.get(claim?.key);if(!row?.terminal||row.claim!==claim)fail('HOST_TERMINAL_UNKNOWN');
   const entered=this.#read(row.key+'.entered'),terminal=this.#read(row.key+'.terminal');
   if(!entered.raw.equals(row.original.raw)||!terminal.raw.equals(row.result.raw)||(row.recoverable?sha(terminal.body.x):terminal.body.responseDigest)!==sha(canonicalJSON(response)))fail('HOST_TERMINAL_READBACK_MISMATCH');
   this.#current();return undefined;
  }catch(cause){this.#remember(cause);throw cause;}
 }

 #rememberCleanup(cause){
  if(!this.#cleanupCausePresent){this.#cleanupCausePresent=true;this.#cleanupCause=cause;}this.#remember(cause);
 }
 #prepareFirstEnterCleanup(){
  for(const s of this.#firstEnters.values())try{closeFirstEnter(s);}catch(cause){this.#rememberCleanup(cause);}
  if([...this.#firstEnters.values()].some(s=>!s.closeConfirmed)){if(this.#cleanupCausePresent)throw this.#cleanupCause;fail('FIRST_ENTER_CLEANUP_UNKNOWN');}
 }
 retire(){
  this.#retired=true; // Fence new work before any Native cleanup or failure.
  this.#prepareFirstEnterCleanup(); // Local child preflight precedes Native once-selection.
  if(this.#retireSelected){if(this.#retireCausePresent)throw this.#retireCause;return;}
  this.#retireSelected=true;
  try{if(this.#loan&&this.#native[names.retire](this.#loan)!==undefined)fail('HOST_TERMINAL_RETIRE_UNKNOWN');}
  catch(cause){this.#retireCausePresent=true;this.#retireCause=cause;this.#rememberCleanup(cause);throw cause;}
 }
 join(){
  // A local preflight refusal has not selected a Native join. After drain,
  // cleanup may enter it once; an actually entered Native failure is latched.
  if(!this.#retired||this.#entered){try{fail('HOST_TERMINAL_JOIN_PENDING');}catch(cause){this.#rememberCleanup(cause);throw cause;}}
  this.#prepareFirstEnterCleanup();
  if(this.#joinSelected){if(this.#joinCausePresent)throw this.#joinCause;return;}
  this.#joinSelected=true;
  try{if(this.#loan&&this.#native[names.join](this.#loan)!==undefined)fail('HOST_TERMINAL_JOIN_PENDING');}
  catch(cause){this.#joinCausePresent=true;this.#joinCause=cause;this.#rememberCleanup(cause);throw cause;}
 }
 close(){
  if(this.#nativeCloseSelected||this.#closeComplete){if(this.#cleanupCausePresent)throw this.#cleanupCause;if(!this.#closeComplete)fail('HOST_TERMINAL_CLOSE_UNKNOWN');return;}
  this.#retired=true;
  const attempt=action=>{try{action();}catch(cause){this.#rememberCleanup(cause);}};
  // Each Native step is selected once, including when a preceding step throws.
  // The owning Native close still enforces its independent busy/owner guards.
  for(const s of this.#firstEnters.values())attempt(()=>closeFirstEnter(s));
  attempt(()=>this.retire());attempt(()=>this.join());
  attempt(()=>{
   if(this.#entered)fail('HOST_TERMINAL_JOIN_PENDING');
   if([...this.#firstEnters.values()].some(s=>!s.closeConfirmed))fail('FIRST_ENTER_CLEANUP_UNKNOWN');
   this.#nativeCloseSelected=true; // Only after the local active-work guard.
   if(this.#loan){if(this.#native[names.close](this.#loan)!==undefined)fail('HOST_TERMINAL_CLOSE_UNKNOWN');}
   else if(this.#opened)fail('HOST_TERMINAL_CLOSE_UNKNOWN'); // No loan does not prove capture had no effect.
  });
  if(this.#cleanupCausePresent)throw this.#cleanupCause;
  this.#closeComplete=true;
 }
 status(){return Object.freeze({retired:this.#retired,unknown:this.#unknown||[...this.#records.values()].some(row=>!row.terminal),firstCausePresent:this.#causePresent,firstCause:this.#cause,cleanupCausePresent:this.#cleanupCausePresent,cleanupCause:this.#cleanupCause,cleanupComplete:this.#closeComplete});}
}
