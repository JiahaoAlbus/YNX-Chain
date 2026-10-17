import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {decodePQTransferRequest,decodePQMigrationRequest,pqU64} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQOriginalRecord} from './wallet-pq-intent-record.mjs';
import {parseDurabilityProof,DURABILITY_MODEL} from './transaction-durability.mjs';
// Candidate source contract only; full Chain CI/deployment is a separate gate.
export const PQ_HTTP_CONTRACT_CANDIDATE='1646f01578e2d27409f24b081d93519df5dc24ce';
const fail=()=>{throw Object.assign(new Error('The PQ response cannot be bound to this original.'),{code:'PQ_RESPONSE_INVALID'});};
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const nativeHash=value=>typeof value==='string'&&/^(?:0x)?[0-9a-f]{64}$/.test(value)?(value.startsWith('0x')?value:'0x'+value):null;
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function bodyJSON(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>8*1024*1024)fail();
 let value;try{value=JSON.parse(text);}catch{fail();}
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail();return value;
}
function decimal(value,positive=false){if(typeof value!=='string')fail();let number;try{number=pqU64(value);}catch{fail();}if(positive&&number===0n)fail();return value;}
function expectation(value){
 const original=parsePQOriginalRecord(value),wire=Buffer.from(original.wire,'base64url'),migration=original.kind==='pq-migration';
 if(migration){const {intent}=decodePQMigrationRequest(wire);return {original,migration,wire,from:intent.owner,to:intent.owner,type:'account_migration',amount:'0',fee:'1',nonce:intent.ledgerNonce,revision:intent.newRevision,activationHeight:intent.activateAt};}
 const {transfer}=decodePQTransferRequest(wire);if(transfer.fee!=='1')fail();
 return {original,migration,wire,from:transfer.from,to:transfer.to,type:'transfer',amount:transfer.amount,fee:transfer.fee,nonce:transfer.nonce};
}
function decimals(value,e,{read=false,executionRequired=false}={}){
 const fields=['amount','fee','nonce',...(e.migration?['revision','activationHeight']:[]),...(read?['blockNumber']:[]),...(executionRequired||Object.hasOwn(value??{},'executionHeight')?['executionHeight']:[])];
 exactPQRecord(value,fields);const result={};for(const field of fields)result[field]=decimal(value[field],['nonce','revision','activationHeight','executionHeight'].includes(field));
 for(const field of ['amount','fee','nonce',...(e.migration?['revision','activationHeight']:[])])if(result[field]!==e[field])fail();
 return Object.freeze(result);
}
const TX_FIELDS=['hash','type','from','to','amount','fee','nonce','blockHash','blockNumber','timestamp','lotFlows','logs','memo','sponsor','sponsorPoolId','resourceSource','resourceType','resourceConsumed','actionReference'];
function transaction(value,e,exactFields){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(key=>!TX_FIELDS.includes(key)))fail();
 if(value.hash!==e.original.hash||value.type!==e.type||value.from!==e.from||value.to!==e.to||value.memo!==(e.migration?'ynx-pq-migration-v1:':'ynx-pq-transfer-v1:')+e.wire.toString('hex')||typeof value.timestamp!=='string'||value.timestamp.length>64||!Number.isFinite(Date.parse(value.timestamp)))fail();
 for(const key of ['amount','fee','nonce','blockNumber']){
  if(!Object.hasOwn(value,key)){if(key==='fee'||key==='nonce'||key==='amount'&&e.amount!=='0'||key==='blockNumber'&&exactFields.blockNumber&&exactFields.blockNumber!=='0')fail();continue;}
  const compat=value[key];if(typeof compat!=='number'||!Number.isFinite(compat)||!Number.isInteger(compat)||compat<0)fail();
  // Compatibility numbers are never used as the integer source. Compare
  // only values independently safe to compare; retain exact decimal strings.
  const expected=exactFields[key];if(expected!==undefined&&Number.isSafeInteger(compat)&&BigInt(compat)!==BigInt(expected))fail();
 }
}
const observation=(e,outcome,extra={})=>freeze({hash:e.original.hash,account:e.original.account,kind:e.original.kind,outcome,...extra,retryAuthorized:false,clearsOriginal:false,consensusFinality:false});
/** Structure/binding only. Original transport must authenticate its producer.
 * Neither HTTP status nor this parser grants retry, finality or journal deletion. */
export function parsePQSubmissionResponse(original,httpStatus,text){
 try{
  const e=expectation(original),value=bodyJSON(text);
  if([400,413,415,422].includes(httpStatus)){exactPQRecord(value,['error']);if(typeof value.error!=='string'||!value.error||value.error.length>2048)fail();return observation(e,'rejection-observed',{httpStatus});}
  if(httpStatus===503){
   exactPQRecord(value,['error','status','transactionHash','wireHash','decimalFields','durabilityVersion','ynxDurability']);
   if(typeof value.error!=='string'||value.error.length>2048||value.status!=='transaction_durability_uncertain'||value.transactionHash!==e.original.hash||value.wireHash!==e.original.hash||value.durabilityVersion!==DURABILITY_MODEL.version)fail();
   const fields=decimals(value.decimalFields,e),proof=parseDurabilityProof(value.ynxDurability,e.original.hash);if(proof.status!=='uncertain')fail();return observation(e,'outcome-unknown',{decimalFields:fields,durability:proof});
  }
  if(httpStatus!==200)fail();
  exactPQRecord(value,['transaction','wireHash','decimalFields','replayed','status',...(e.migration?['activationHeight','revision','executionHeight']:[])]);
  if(value.wireHash!==e.original.hash||typeof value.replayed!=='boolean'||!(e.migration?['registered_pending_activation','active','superseded']:['accepted']).includes(value.status))fail();
  const fields=decimals(value.decimalFields,e,{executionRequired:true});transaction(value.transaction,e,fields);
  const extra={decimalFields:fields,replayed:value.replayed,admissionStatus:value.status};
  if(e.migration){if(decimal(value.activationHeight,true)!==e.activationHeight||decimal(value.revision,true)!==e.revision)fail();extra.nextExecutionHeight=decimal(value.executionHeight,true);}
  return observation(e,'admitted-unconfirmed',extra);
 }catch{fail();}
}
export function parsePQReadResponse(original,httpStatus,text){
 try{
  const e=expectation(original),value=bodyJSON(text);
  if(httpStatus===404){
   exactPQRecord(value,['error','status','transactionHash','source','consensusFinality','ynxDurability']);
   if(value.error!=='transaction not found'||value.status!=='not_found'||value.transactionHash!==e.original.hash||value.source!=='authoritative_producer'||value.consensusFinality!==false)fail();
   const proof=parseDurabilityProof(value.ynxDurability,e.original.hash);if(proof.status!=='not_found')fail();return observation(e,'not-found-observed',{durability:proof});
  }
  if(httpStatus!==200)fail();
  const added=['transactionHash','wireHash','decimalFields','source','consensusFinality','ynxDurability'];
  if(Object.keys(value).some(key=>!TX_FIELDS.includes(key)&&!added.includes(key))||value.transactionHash!==e.original.hash||value.wireHash!==e.original.hash||!hash(value.hash)||value.source!=='authoritative_producer'||value.consensusFinality!==false)fail();
  const fields=decimals(value.decimalFields,e,{read:true,executionRequired:true});transaction(Object.fromEntries(Object.entries(value).filter(([key])=>TX_FIELDS.includes(key))),e,fields);
  const proof=parseDurabilityProof(value.ynxDurability,e.original.hash),block=BigInt(fields.blockNumber);
  if(proof.status==='not_found'||proof.status==='pending_durable'&&block!==0n||proof.status==='durable'&&block===0n)fail();
  if(block>0n){if(proof.blockNumber!=='0x'+block.toString(16)||nativeHash(value.blockHash)!==proof.blockHash)fail();}
  else if(Object.hasOwn(proof,'blockNumber')||value.blockHash)fail();
  const outcome=proof.status==='durable'?'local-inclusion-durable':proof.status==='pending_durable'?'pending-local-durable':'outcome-unknown';
  return observation(e,outcome,{decimalFields:fields,durability:proof});
 }catch{fail();}
}
