// Protocol Host selection DATA ABI. Only the private, independently pinned
// new-version packaged caller may execute this mode. A catalog or selection is
// NOT Native authority, proof verification, registration or source admission.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQFinalityOriginal} from './wallet-pq-finality-original.mjs';
import {preparePQHostSourceRequest} from './wallet-pq-host-context.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const invalid=()=>fail('PQ_HOST_SELECTION_INVALID');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=['sourcePath','sourceSha256','sourceId','epoch'];
function closed(value,fields){if(types.isProxy(value))invalid();exactData(value,fields,'PQ_HOST_SELECTION_INVALID');}
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const get=key=>Object.getOwnPropertyDescriptor(typed,key).get;
const bufferOf=get('buffer'),offsetOf=get('byteOffset'),lengthOf=get('byteLength');
function snapshot(value,max){
 if(types.isProxy(value)||!types.isUint8Array(value))invalid();
 const buffer=bufferOf.call(value),offset=offsetOf.call(value),length=lengthOf.call(value);
 if(types.isSharedArrayBuffer(buffer)||length>max)invalid();
 return Buffer.from(new Uint8Array(buffer,offset,length));
}
export function preparePQHostSelectionRequest(original,binding){
 const own=preparePQFinalityOriginal(original,binding);
 const nativeHash=own.original.kind==='pq-typed-action'?own.original.typed.memberHash:own.original.hash;
 const body={version:'YNX-CONSENSUS-PROOF-HOST-SELECTION-REQUEST/v1',operationId:own.original.operationId,account:own.original.account,networkId:own.binding.chainId,transactionHash:own.binding.abciTransactionHash.slice(2),nativeWireHash:nativeHash.slice(2)};
 for(const key of ['transactionHash','nativeWireHash'])if(!/^[0-9a-f]{64}$/.test(body[key]))invalid();
 const stdin=JSON.stringify(body);if(Buffer.byteLength(stdin)>4096)invalid();
 return Object.freeze({stdin,stdinSha256:hash(stdin)});
}
// Exactly four flat JSON strings, rejecting duplicate decoded keys (including
// escaped aliases) BEFORE parsing into a normal object. No nested extensions.
function parse(text){
 let at=0;const value={},seen=new Set();
 const ws=()=>{while(/[ \t\r\n]/.test(text[at]??'!'))at++;};
 const string=()=>{
  const start=at;if(text[at++]!=='"')invalid();
  while(at<text.length){const c=text.charCodeAt(at++);if(c===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}if(c<32)invalid();if(c===92)at++;}
  invalid();
 };
 ws();if(text[at++]!=='{')invalid();ws();
 if(text[at]!=='}')for(;;){
  ws();const key=string();if(!keys.includes(key)||seen.has(key))invalid();seen.add(key);
  ws();if(text[at++]!==':')invalid();ws();value[key]=string();ws();
  if(text[at]==='}')break;if(text[at++]!==',')invalid();
 }
 if(text[at++]!=='}')invalid();ws();if(at!==text.length||seen.size!==4)invalid();
 return value;
}
/** Parse only after the original process owner has retained raw output and
 * lifecycle. A clean exit alone does not establish source current or trust. */
export function parsePQHostSelectionResult(execution){
 closed(execution,['stdout','stderr','exitCode','signal']);
 const stdout=snapshot(execution.stdout,16384),stderr=snapshot(execution.stderr,65536);
 if(execution.signal!==null||execution.exitCode!==0)throw Object.assign(Error('PQ_HOST_SELECTION_UNAVAILABLE'),{code:'PQ_HOST_SELECTION_UNAVAILABLE',stdoutSha256:hash(stdout),stderrSha256:hash(stderr)});
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(stdout);}catch{invalid();}
 return preparePQHostSourceRequest(parse(text),'acquire').selection;
}
