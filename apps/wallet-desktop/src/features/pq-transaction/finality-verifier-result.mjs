import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData} from './transfer-binding.mjs';
import {preparePQTransferFinalityTarget} from './finality-invocation.mjs';

// Protocol c3c219d / 0345970 normal CLI DATA profile. This module never
// authenticates a binary, host context, clock, issuer or invocation history.
export const PQ_FINALITY_VERIFIER_RESULT_LIMITS=Object.freeze({stdoutBytes:64*1024,stderrBytes:64*1024});
const version='YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1';
const lightVersion='YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1';
const rootFields=['version','code','error','result'];
const resultFields=['version','classification','block','successor','transactionType','transactionHash','nativeWireHash',
  'height','index','total','executionCode','gasWanted','gasUsed','executionData','included','finalized','executionSuccessful','outcome','nativeGrant'];
const lightFields=['version','classification','chainId','genesisSha256','authorityThroughHeight','trustedHeight','trustedBlockHash',
  'headerHeight','blockHash','stateHeight','stateAppHash','validatorsHash','nextValidatorsHash','consensusHash','commitVerified','lightTransitionVerified'];
const statementFields=['chainId','headerHeight','blockHash','stateHeight','stateAppHash'];
const boolFields=new Set(['included','finalized','executionSuccessful','nativeGrant','commitVerified','lightTransitionVerified']);
const failures=new Set(['INVALID_ARGUMENTS','INVALID_REQUEST','TRUST_CONTEXT_INVALID','TRUST_SOURCE_INVALID','PROOF_REJECTED']);
const maxInt64=9223372036854775807n,minInt64=-9223372036854775808n;
const fail=code=>{throw Object.assign(Error(code),{code});};
const invalid=()=>fail('PQ_FINALITY_VERIFIER_RESULT_INVALID');
const mismatch=()=>fail('PQ_FINALITY_VERIFIER_RESULT_MISMATCH');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function closed(value,fields){
  if(types.isProxy(value))invalid();
  exactData(value,fields,'PQ_FINALITY_VERIFIER_RESULT_INVALID');
}
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const offsetOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const lengthOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
function snapshot(value,maximum,empty=false){
  if(types.isProxy(value)||!types.isUint8Array(value))invalid();
  try{
    const buffer=bufferOf.call(value),offset=offsetOf.call(value),length=lengthOf.call(value);
    if(types.isSharedArrayBuffer(buffer)||(!empty&&length===0)||length>maximum)invalid();
    return Buffer.from(new Uint8Array(buffer,offset,length));
  }catch{invalid();}
}

// The fixed transfer output has only three object levels and string/bool/null
// leaves. Decode keys before duplicate checks; reject arrays, numeric tokens,
// unknown fields and escaped aliases without generic recursive JSON objects.
function resultJSON(text){
  let at=0;
  const space=()=>{while(at<text.length&&[32,9,10,13].includes(text.charCodeAt(at)))at++;};
  const string=()=>{
    if(text[at]!== '"')invalid();const start=at++;
    while(at<text.length){
      const code=text.charCodeAt(at++);
      if(code===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}
      if(code<32)invalid();if(code===92)at++;
    }
    invalid();
  };
  const object=kind=>{
    space();if(text[at++]!=='{')invalid();
    const allowed=kind==='root'?rootFields:kind==='result'?resultFields:lightFields,result={},seen=new Set();
    space();
    if(text[at]!=='}')for(;;){
      space();const key=string();if(!allowed.includes(key)||seen.has(key))invalid();seen.add(key);
      space();if(text[at++]!==':')invalid();space();
      if(kind==='root'&&key==='result')result[key]=object('result');
      else if(kind==='result'&&(key==='block'||key==='successor'))result[key]=object('light');
      else if(boolFields.has(key)){
        if(text.slice(at,at+4)==='true'){result[key]=true;at+=4;}
        else if(text.slice(at,at+5)==='false'){result[key]=false;at+=5;}
        else invalid();
      }else if(kind==='result'&&key==='executionData'&&text.slice(at,at+4)==='null'){result[key]=null;at+=4;}
      else result[key]=string();
      space();if(text[at]==='}')break;if(text[at++]!==',')invalid();
    }
    if(text[at++]!=='}')invalid();return result;
  };
  const result=object('root');space();if(at!==text.length)invalid();return result;
}

function integer(value,{signed=false,maximum=maxInt64,nonzero=false}={}){
  if(typeof value!=='string'||value.length>20||!(signed?/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/:/^(0|[1-9][0-9]*)$/).test(value))invalid();
  const number=BigInt(value);
  if(number>maximum||number<(signed?minInt64:0n)||nonzero&&number===0n)invalid();return number;
}
function hash(value){if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))invalid();}
function light(value,expected){
  closed(value,lightFields);
  if(value.version!=='YNX-PQ-LIGHT-PROOF/v1'||value.classification!=='data'||value.commitVerified!==true||value.lightTransitionVerified!==true)invalid();
  for(const name of statementFields)if(value[name]!==expected[name])mismatch();
  const height=integer(value.headerHeight,{nonzero:true}),trusted=integer(value.trustedHeight,{nonzero:true});
  integer(value.stateHeight);
  const through=integer(value.authorityThroughHeight,{maximum:maxInt64-2n});
  // Original snapshot/ParamsAt allows two future heights, not an arbitrary
  // target and not a stricter through>=header rule.
  if(trusted>=height||height>through+2n)mismatch();
  for(const name of ['genesisSha256','trustedBlockHash','blockHash','stateAppHash','validatorsHash','nextValidatorsHash','consensusHash'])hash(value[name]);
}
function transferResult(value,code,expected){
  closed(value,resultFields);
  if(value.version!=='YNX-PQ-TRANSACTION-PROOF/v1'||value.classification!=='data'||value.transactionType!=='pq_transfer'||value.included!==true||value.finalized!==true||value.nativeGrant!==false)invalid();
  for(const [name,wanted] of [['transactionHash',expected.transactionHash],['nativeWireHash',expected.nativeWireHash],['height',expected.block.headerHeight],['index',expected.index]])if(value[name]!==wanted)mismatch();
  const index=integer(value.index,{maximum:4294967295n}),total=integer(value.total,{nonzero:true});
  if(index>=total)mismatch();
  const executionCode=integer(value.executionCode,{maximum:4294967295n});
  integer(value.gasWanted,{signed:true});integer(value.gasUsed,{signed:true});
  light(value.block,expected.block);light(value.successor,expected.successor);
  if(value.block.genesisSha256!==value.successor.genesisSha256||value.block.authorityThroughHeight!==value.successor.authorityThroughHeight||
    value.successor.trustedHeight!==value.block.headerHeight||value.successor.trustedBlockHash!==value.block.blockHash||
    value.successor.validatorsHash!==value.block.nextValidatorsHash)mismatch();
  if(code==='VERIFIED_TRANSACTION_DATA'){
    if(value.outcome!=='succeeded'||executionCode!==0n||value.executionSuccessful!==true||value.executionData!==Buffer.from('0x'+expected.transactionHash,'ascii').toString('base64'))mismatch();
  }else if(code==='VERIFIED_TRANSACTION_REJECTED_DATA'){
    if(value.outcome!=='rejected'||executionCode===0n||value.executionSuccessful!==false||value.executionData!==null)mismatch();
  }else invalid();
}

/** Parse only after the original caller preserves stdout/stderr/exit evidence.
 * Caller facts and matching host coordinates remain DATA, never provenance.
 * No raw bytes, stderr, remote error, wire or proof crosses the public result.
 * All finality/authorization/retry decisions remain with the original owner. */
export function parsePQTransferFinalityVerifierResult(original,binding,hostExpectedTransaction,execution){
  const expected=preparePQTransferFinalityTarget(original,binding,hostExpectedTransaction);
  closed(execution,['stdout','stderr','exitCode','signal']);
  const stdout=snapshot(execution.stdout,PQ_FINALITY_VERIFIER_RESULT_LIMITS.stdoutBytes);
  const stderr=snapshot(execution.stderr,PQ_FINALITY_VERIFIER_RESULT_LIMITS.stderrBytes,true);
  if(execution.signal!==null||![0,1].includes(execution.exitCode))fail('PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE');
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(stdout);}catch{invalid();}
  const parsed=resultJSON(text);let result=null;
  if(execution.exitCode===0){
    closed(parsed,['version','code','result']);if(parsed.version!==version)invalid();
    transferResult(parsed.result,parsed.code,expected);result=parsed.result;
  }else{
    closed(parsed,['version','code','error']);
    if(![version,lightVersion].includes(parsed.version)||!failures.has(parsed.code)||typeof parsed.error!=='string'||!parsed.error.length||Buffer.byteLength(parsed.error,'utf8')>4096)invalid();
    // INVALID_ARGUMENTS is emitted before the transaction profile is selected.
    if(parsed.code==='INVALID_ARGUMENTS'&&parsed.version!==lightVersion)invalid();
  }
  const observation=Object.freeze({
    account:original.account,operationId:original.operationId,kind:'pq-transfer',transactionType:'pq_transfer',
    nativeTransactionHash:'0x'+expected.nativeWireHash,abciTransactionHash:'0x'+expected.transactionHash,
    executionHeight:expected.block.headerHeight,cometIndex:Number(expected.index),
    status:result?'verifier-result-data':'verifier-error-data',verifierCode:parsed.code,
    reportedOutcome:result?.outcome??null,reportedExecutionSuccessful:result?.executionSuccessful??null,executionCode:result?.executionCode??null,
    proofVerification:'result-data-only',independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false,
  });
  return Object.freeze({observation,stdoutSha256:digest(stdout),stdoutByteLength:stdout.length,stderrSha256:digest(stderr),stderrByteLength:stderr.length});
}
