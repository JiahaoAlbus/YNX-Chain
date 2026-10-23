import {createHash} from 'node:crypto';
import {types} from 'node:util';
import path from 'node:path';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQFinalityTarget as preparePQTransferFinalityTarget,bindPQFinalityContext as bindPQTransferFinalityContext} from './wallet-pq-finality-original.mjs';
import {PQ_FINALITY_EVIDENCE_LIMITS} from './wallet-pq-finality-evidence.mjs';

// Exact Protocol57d2d90 host_context{,_command}.go DATA ABI. The old034 proof
// executable does not have this mode. Parsing this DTO never supplies a Host
// grant or substitutes for fixed binary identity/original protected evidence.
export const PQ_HOST_LIMITS=Object.freeze({request:4096,source:16384,lifecycle:4096,stdout:104521276,stderr:65536,context:PQ_FINALITY_EVIDENCE_LIMITS['host-context']});
const resultVersion='YNX-CONSENSUS-PROOF-HOST-RESULT/v1',exportVersion='YNX-CONSENSUS-PROOF-HOST-CONTEXT/v1',transactionVersion='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1';
const failureCodes=new Set(['INVALID_ARGUMENTS','INVALID_REQUEST','HOST_SOURCE_INVALID','HOST_SOURCE_NOT_CURRENT','HOST_EXPORT_BOUNDS']);
const fail=code=>{throw Object.assign(Error(code),{code});},invalid=()=>fail('PQ_HOST_CONTEXT_INVALID'),mismatch=()=>fail('PQ_HOST_CONTEXT_MISMATCH');
const digest=b=>createHash('sha256').update(b).digest('hex');
function closed(value,fields){if(types.isProxy(value))invalid();exactData(value,fields,'PQ_HOST_CONTEXT_INVALID');}
function hash(value){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value)||/^0{64}$/.test(value))invalid();return value;}
function decimal(value,max,nonzero=false){if(typeof value!=='string'||value.length>20||!/^(0|[1-9][0-9]*)$/.test(value))invalid();const n=BigInt(value);if(n>max||nonzero&&n===0n)invalid();return n;}
function absolute(value){if(typeof value!=='string'||Buffer.byteLength(value)>4096||!path.isAbsolute(value)||path.normalize(value)!==value||value.includes('\0')||Buffer.from(value).toString()!==value)invalid();return value;}
function selected(value){
 closed(value,['sourcePath','sourceSha256','sourceId','epoch']);absolute(value.sourcePath);hash(value.sourceSha256);
 if(typeof value.sourceId!=='string'||! /^[A-Za-z0-9._:-]{1,128}$/.test(value.sourceId))invalid();decimal(value.epoch,18446744073709551615n,true);
 return Object.freeze({...value});
}
export function preparePQHostSourceRequest(selection,operation,sourceFingerprint=''){
 const own=selected(selection);if(operation!=='acquire'&&operation!=='current')invalid();
 if(operation==='current')hash(sourceFingerprint);else if(sourceFingerprint!=='')invalid();
 const stdin=JSON.stringify({version:'YNX-CONSENSUS-PROOF-HOST-REQUEST/v1',operation,sourceId:own.sourceId,epoch:own.epoch,sourceFingerprint});
 if(Buffer.byteLength(stdin)>PQ_HOST_LIMITS.request)invalid();
 return Object.freeze({selection:own,stdin,stdinSha256:digest(stdin)});
}
const schemas={
 root:['version','code','error','context'],
 export:['version','classification','sourceId','epoch','sourceFingerprint','sourceBytes','sourceSHA256','lifecycleBytes','lifecycleSHA256','contextVersion','contextPath','contextBytes','contextSHA256','expectedTransaction','chainId','engineHeight','engineAppHash','trustedLightBlockSHA256','expiresAt','currentChecked','nativeRootAuthorized','sourceDeploymentQualified','proofVerified'],
 expected:['block','successor','transactionType','envelope','nativeWire','transactionHash','nativeWireHash','index'],
 statement:['chainId','headerHeight','blockHash','stateHeight','stateAppHash'],
 source:['version','sourceId','epoch','contextFile','contextSHA256','lifecycleFile','lifecycleSHA256','migrationSHA256','genesisSHA256','stateSHA256','scheduleSHA256','runtimePlanSHA256','trustedLightBlockSHA256'],
 lifecycle:['version','sourceId','epoch','status'],
};
const bools=new Set(['currentChecked','nativeRootAuthorized','sourceDeploymentQualified','proofVerified']);
// Fixed object grammar, no arrays or number coercion; decoded duplicate keys
// (including escaped aliases) are rejected before constructing bound objects.
function json(text,profile){
 let at=0;const space=()=>{while(at<text.length&&[32,9,10,13].includes(text.charCodeAt(at)))at++;};
 const string=()=>{if(text[at++]!=='"')invalid();const start=at-1;while(at<text.length){const code=text.charCodeAt(at++);if(code===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}if(code<32)invalid();if(code===92)at++;}invalid();};
 const object=kind=>{
  space();if(text[at++]!=='{')invalid();const value={},seen=new Set(),fields=schemas[kind];space();
  if(text[at]!=='}')for(;;){
   space();const key=string();if(!fields.includes(key)||seen.has(key))invalid();seen.add(key);space();if(text[at++]!==':')invalid();space();
   if(kind==='root'&&key==='context')value[key]=object('export');
   else if(kind==='export'&&key==='expectedTransaction'){
    if(text.slice(at,at+4)==='null'){value[key]=null;at+=4;}else value[key]=object('expected');
   }
   else if(kind==='expected'&&(key==='block'||key==='successor'))value[key]=object('statement');
   else if(kind==='export'&&bools.has(key)){
    if(text.slice(at,at+4)==='true'){value[key]=true;at+=4;}else if(text.slice(at,at+5)==='false'){value[key]=false;at+=5;}else invalid();
   }else value[key]=string();
   space();if(text[at]==='}')break;if(text[at++]!==',')invalid();
  }
  if(text[at++]!=='}')invalid();if(kind!=='root')closed(value,fields);return value;
 };
 const out=object(profile);space();if(at!==text.length)invalid();return out;
}
const typed=Object.getPrototypeOf(Uint8Array.prototype),bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get,offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,lengthOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get;
function snapshot(value,maximum,empty=false){
 if(types.isProxy(value)||!types.isUint8Array(value))invalid();
 try{const buffer=bufferOf.call(value),offset=offsetOf.call(value),length=lengthOf.call(value);if(types.isSharedArrayBuffer(buffer)||!empty&&!length||length>maximum)invalid();return Buffer.from(new Uint8Array(buffer,offset,length));}catch{invalid();}
}
function decodeUTF8(bytes){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{invalid();}}
function base64(value,maximum,pin){
 hash(pin);if(typeof value!=='string'||!value.length||value.length>4*Math.ceil(maximum/3))invalid();
 const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length>maximum||bytes.toString('base64')!==value||digest(bytes)!==pin)mismatch();return bytes;
}
function same(a,b){if(a!==b)mismatch();}

/** Must run only AFTER bounded process stdout/stderr/exit has been retained.
 * The returned context is private Main DATA. Never project paths/bytes/target
 * to renderer or infer a Native/Host/proof grant from this result. */
export function parsePQTransferHostContext(original,binding,selection,execution,prior=null){
 const own=selected(selection);closed(execution,['stdout','stderr','exitCode','signal']);
 const stdout=snapshot(execution.stdout,PQ_HOST_LIMITS.stdout),stderr=snapshot(execution.stderr,PQ_HOST_LIMITS.stderr,true);
 if(execution.signal!==null||![0,1].includes(execution.exitCode))fail('PQ_HOST_PROCESS_INCOMPLETE');
 const parsed=json(decodeUTF8(stdout),'root');same(parsed.version,resultVersion);
 if(execution.exitCode===1){
  closed(parsed,['version','code','error']);if(!failureCodes.has(parsed.code)||typeof parsed.error!=='string'||!parsed.error.length||Buffer.byteLength(parsed.error)>4096)invalid();
  throw Object.assign(Error('PQ_HOST_SOURCE_UNAVAILABLE'),{code:'PQ_HOST_SOURCE_UNAVAILABLE',reportedCode:parsed.code,stdoutSha256:digest(stdout),stderrSha256:digest(stderr)});
 }
 closed(parsed,['version','code','context']);same(parsed.code,'EXPORTED_PROOF_TRUST_DATA');const c=parsed.context;
 same(c.version,exportVersion);same(c.classification,'data');same(c.sourceId,own.sourceId);same(c.epoch,own.epoch);hash(c.sourceFingerprint);
 if(c.currentChecked!==true||c.nativeRootAuthorized!==false||c.sourceDeploymentQualified!==false||c.proofVerified!==false)invalid();
 same(c.contextVersion,transactionVersion);if(c.expectedTransaction===null)fail('PQ_HOST_TRANSFER_CONTEXT_REQUIRED');
 absolute(c.contextPath);same(c.sourceSHA256,own.sourceSha256);
 const sourceBytes=base64(c.sourceBytes,PQ_HOST_LIMITS.source,c.sourceSHA256),lifecycleBytes=base64(c.lifecycleBytes,PQ_HOST_LIMITS.lifecycle,c.lifecycleSHA256),contextBytes=base64(c.contextBytes,PQ_HOST_LIMITS.context,c.contextSHA256);
 const s=json(decodeUTF8(sourceBytes),'source'),life=json(decodeUTF8(lifecycleBytes),'lifecycle'),context=bindPQTransferFinalityContext(original,binding,contextBytes);
 same(s.version,'YNX-CONSENSUS-PROOF-HOST-SOURCE/v1');same(s.sourceId,own.sourceId);same(s.epoch,own.epoch);same(s.contextFile,c.contextPath);same(s.contextSHA256,c.contextSHA256);same(s.lifecycleSHA256,c.lifecycleSHA256);absolute(s.lifecycleFile);
 same(life.version,'YNX-CONSENSUS-PROOF-HOST-LIFECYCLE/v1');same(life.sourceId,own.sourceId);same(life.epoch,own.epoch);same(life.status,'current');same(context.contextSha256,c.contextSHA256);
 const expected=preparePQTransferFinalityTarget(original,binding,c.expectedTransaction),storedExpected=context.expected;
 // Source key order is immaterial. Rebuild both through the original target
 // validator; compare every exact statement/byte string without re-encoding
 // the retained source/context bodies themselves.
 for(const key of schemas.expected){if(key==='block'||key==='successor'){for(const name of schemas.statement)same(expected[key][name],storedExpected[key][name]);}else same(expected[key],storedExpected[key]);}
 const light=context.lightTrust;same(light.version,'YNX-CONSENSUS-PROOF-TRUST/v1');
 for(const [a,b]of [['chainId','chainId'],['engineHeight','engineHeight'],['engineAppHash','engineAppHash'],['trustedLightBlockSHA256','trustedLightBlockSHA256']])same(c[a],light[b]);
 same(c.chainId,expected.block.chainId);decimal(c.engineHeight,9223372036854775805n);hash(c.engineAppHash);hash(c.trustedLightBlockSHA256);
 for(const [a,b]of [['expectedHeaderHeight','headerHeight'],['expectedBlockHash','blockHash'],['expectedStateHeight','stateHeight'],['expectedStateAppHash','stateAppHash']])same(light[a],expected.block[b]);
 for(const key of ['migrationFile','genesisFile','stateFile','scheduleFile','trustedLightBlockFile'])absolute(light[key]);
 const paths=[own.sourcePath,s.lifecycleFile,s.contextFile,...['migrationFile','genesisFile','stateFile','scheduleFile','trustedLightBlockFile'].map(k=>light[k]),...(light.runtimePlanFile?[light.runtimePlanFile]:[])];
 if(new Set(paths).size!==paths.length)mismatch();
 for(const key of ['migrationSHA256','genesisSHA256','stateSHA256','scheduleSHA256','trustedLightBlockSHA256'])hash(s[key]);
 same(s.genesisSHA256,light.consensusGenesisSHA256);same(s.trustedLightBlockSHA256,c.trustedLightBlockSHA256);
 if((s.runtimePlanSHA256==='')!==(light.runtimePlanFile===''))mismatch();
 if(s.runtimePlanSHA256!==''){hash(s.runtimePlanSHA256);absolute(light.runtimePlanFile);hash(light.runtimePlanHash);}else same(light.runtimePlanHash,'');
 // Go's RFC3339Nano may carry nanoseconds; never parse epoch/height as Number.
 if(typeof c.expiresAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(c.expiresAt)||!Number.isFinite(Date.parse(c.expiresAt))||new Date(Date.parse(c.expiresAt)).toISOString().slice(0,19)!==c.expiresAt.slice(0,19))invalid();
 if(prior!==null){
  closed(prior,['sourceId','epoch','sourceFingerprint','sourceSha256','lifecycleSha256','contextSha256']);
  for(const [a,b]of [['sourceId','sourceId'],['epoch','epoch'],['sourceFingerprint','sourceFingerprint'],['sourceSha256','sourceSHA256'],['lifecycleSha256','lifecycleSHA256'],['contextSha256','contextSHA256']])same(prior[a],c[b]);
 }
 return Object.freeze({sourceId:c.sourceId,epoch:c.epoch,sourceFingerprint:c.sourceFingerprint,sourceSha256:c.sourceSHA256,lifecycleSha256:c.lifecycleSHA256,contextPath:c.contextPath,contextSha256:c.contextSHA256,contextBytes,sourceBytes,lifecycleBytes,expected,expiresAt:c.expiresAt,stdoutSha256:digest(stdout),stderrSha256:digest(stderr),classification:'data',nativeRootAuthorized:false,sourceDeploymentQualified:false,proofVerified:false,independentFinality:false,canRetry:false,clearsOriginal:false});
}
