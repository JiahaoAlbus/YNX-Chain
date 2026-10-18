import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
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

export class OriginalHostTerminalJournal {
 #path;#original;#native;#loan;#records=new Map();#coldCount=0;#unknown=false;#cause;#causePresent=false;#retired=false;#nativeCloseSelected=false;#closeComplete=false;#cleanupCause;#cleanupCausePresent=false;#entered=0;#opened=false;#retireSelected=false;#retireCause;#retireCausePresent=false;#joinSelected=false;#joinCause;#joinCausePresent=false;
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
   row.original=this.#write(key+'.entered',{version:1,kind:'entered',requestDigest,associationDigest,operation:row.operation,phase:row.phase,requestId:row.requestId,stateBeforeDigest});
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
 retire(){
  this.#retired=true; // Fence new work before any Native cleanup or failure.
  if(this.#retireSelected){if(this.#retireCausePresent)throw this.#retireCause;return;}
  this.#retireSelected=true;
  try{if(this.#loan&&this.#native[names.retire](this.#loan)!==undefined)fail('HOST_TERMINAL_RETIRE_UNKNOWN');}
  catch(cause){this.#retireCausePresent=true;this.#retireCause=cause;this.#rememberCleanup(cause);throw cause;}
 }
 join(){
  // A local preflight refusal has not selected a Native join. After drain,
  // cleanup may enter it once; an actually entered Native failure is latched.
  if(!this.#retired||this.#entered){try{fail('HOST_TERMINAL_JOIN_PENDING');}catch(cause){this.#rememberCleanup(cause);throw cause;}}
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
  attempt(()=>this.retire());attempt(()=>this.join());
  attempt(()=>{
   if(this.#entered)fail('HOST_TERMINAL_JOIN_PENDING');
   this.#nativeCloseSelected=true; // Only after the local active-work guard.
   if(this.#loan){if(this.#native[names.close](this.#loan)!==undefined)fail('HOST_TERMINAL_CLOSE_UNKNOWN');}
   else if(this.#opened)fail('HOST_TERMINAL_CLOSE_UNKNOWN'); // No loan does not prove capture had no effect.
  });
  if(this.#cleanupCausePresent)throw this.#cleanupCause;
  this.#closeComplete=true;
 }
 status(){return Object.freeze({retired:this.#retired,unknown:this.#unknown||[...this.#records.values()].some(row=>!row.terminal),firstCausePresent:this.#causePresent,firstCause:this.#cause,cleanupCausePresent:this.#cleanupCausePresent,cleanupCause:this.#cleanupCause,cleanupComplete:this.#closeComplete});}
}
