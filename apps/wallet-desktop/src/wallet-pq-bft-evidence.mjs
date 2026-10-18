import {createHash,timingSafeEqual} from 'node:crypto';
import {decodePQTransferRequest,decodePQMigrationRequest,decodePQRevocationRequest,pqU64} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQOriginalRecord} from './wallet-pq-intent-record.mjs';
// Candidate source contract only. Not deployed, no changed operator pin and
// NOT the native authoritative_producer/local-durability response contract.
export const PQ_BFT_CONTRACT_SOURCE='af1cbaf94313e628e212aabad60d05d85c2aa3fc';
const fail=()=>{throw Object.assign(Error('The BFT observation does not match this original.'),{code:'PQ_BFT_RESPONSE_INVALID'});};
const hexHash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const decimal=(v,positive=false)=>{if(typeof v!=='string')fail();let number;try{number=pqU64(v);}catch{fail();}if(positive&&number===0n)fail();return v;};
const allFields=['type','status','committed','source','nativeTransactionHash','abciTransactionHash','wire','executionHeight','cometIndex','from','to','amount','fee','nonce','transaction','readbackUrl','error'];
function expected(value){
 const original=parsePQOriginalRecord(value),wire=Buffer.from(original.wire,'base64url'),migration=original.kind==='pq-migration',revocation=original.kind==='pq-revocation';
 if(wire.length>(migration?262144:revocation?131072:65536))fail();
 const type=migration?'account_migration':revocation?'account_revocation':'pq_transfer';
 // Exactly consensus.PQTransaction {Version,Type,WireHex}, Go json.Marshal
 // order at the pinned source. These fixed strings and lowercase hex need no
 // Go HTML escaping. This envelope is hashed only, NEVER sent in place of wire.
 const envelope=Buffer.from(JSON.stringify({version:1,type,wireHex:wire.toString('hex')}));
 const abciHash='0x'+createHash('sha256').update(envelope).digest('hex');
 const decoded=migration?decodePQMigrationRequest(wire).intent:revocation?decodePQRevocationRequest(wire).intent:decodePQTransferRequest(wire).transfer;
 if(!migration&&!revocation&&decoded.fee!=='1')fail();
 return {original,wire,migration,revocation,type,abciHash,from:migration||revocation?decoded.owner:decoded.from,to:migration||revocation?decoded.owner:decoded.to,amount:migration||revocation?'0':decoded.amount,fee:'1',nonce:migration||revocation?decoded.ledgerNonce:decoded.nonce,...(revocation?{revocationIntent:decoded}:{})};
}
export function pqBFTOriginalIdentity(original){const e=expected(original);return Object.freeze({source:'comet-rpc',nativeTransactionHash:e.original.hash,abciTransactionHash:e.abciHash,readbackUrl:'/transactions/pq/originals/'+e.original.hash});}
const txFields=['hash','type','from','to','amount','fee','nonce','blockHash','blockNumber','timestamp','lotFlows','logs','memo','sponsor','sponsorPoolId','resourceSource','resourceType','resourceConsumed','actionReference'];
function transaction(value,e,height){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!txFields.includes(k)))fail();
 if(value.hash!==e.original.hash||value.type!==(e.migration?'account_migration':e.revocation?'account_revocation':'transfer')||value.from!==e.from||value.to!==e.to||value.memo!==(e.migration?'ynx-pq-migration-v1:':e.revocation?'ynx-pq-revocation-v1:':'ynx-pq-transfer-v1:')+e.wire.toString('hex'))fail();
 if(e.revocation&&height!==e.revocationIntent.executeAt)fail();
 if(typeof value.timestamp!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.timestamp)||!Number.isFinite(Date.parse(value.timestamp)))fail();
 for(const [key,wanted] of Object.entries({amount:e.amount,fee:e.fee,nonce:e.nonce,blockNumber:height})){
  if(!Object.hasOwn(value,key)){if(key==='amount'&&wanted==='0')continue;fail();}
  // Go legacy numbers are compatibility fields only. Unsafe rounded values
  // are never converted back to BigInt or used as the execution source.
  if(typeof value[key]!=='number'||!Number.isInteger(value[key])||value[key]<0||!Number.isFinite(value[key]))fail();
  if(value[key]!==Number(wanted))fail();
 }
 for(const key of ['blockHash','sponsor','sponsorPoolId','resourceSource','resourceType','actionReference'])if(Object.hasOwn(value,key)&&value[key]!=='')fail();
 if(Object.hasOwn(value,'resourceConsumed')&&value.resourceConsumed!==0)fail();
 if(Object.hasOwn(value,'logs')&&(!Array.isArray(value.logs)||value.logs.length))fail();
 if(e.revocation){
  // Frozen Go executor records precisely one actual 1-YNXT fee flow. Its
  // recipient may be a validator identity, not a 0x account. This validates
  // returned structure/binding only, not a fee-event proof or Source grant.
  if(!Array.isArray(value.lotFlows)||value.lotFlows.length!==1)fail();const flow=value.lotFlows[0];
  if(!flow||Object.getPrototypeOf(flow)!==Object.prototype||Object.keys(flow).sort().join()!=='amount,from,lotId,to'||flow.from!==e.from||flow.amount!==1||typeof flow.lotId!=='string'||!flow.lotId.trim()||typeof flow.to!=='string'||!flow.to.trim())fail();
 }else if(Object.hasOwn(value,'lotFlows')&&(!Array.isArray(value.lotFlows)||value.lotFlows.length))fail();
}
function parse(original,httpStatus,text,submission){
 try{
  const e=expected(original);
  if(typeof text!=='string'||Buffer.byteLength(text)>8*1024*1024)fail();
  const value=JSON.parse(text);
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!allFields.includes(k)))fail();
  for(const key of ['status','committed','source','nativeTransactionHash','readbackUrl','amount','fee','nonce','executionHeight'])if(!Object.hasOwn(value,key))fail();
  if(value.source!=='comet-rpc'||value.nativeTransactionHash!==e.original.hash||value.readbackUrl!=='/transactions/pq/originals/'+e.original.hash||typeof value.committed!=='boolean'||!['committed','unknown','rejected'].includes(value.status))fail();
  if(Object.hasOwn(value,'error')&&(typeof value.error!=='string'||value.error.length>2048))fail();
  for(const key of ['amount','fee','nonce','executionHeight'])decimal(value[key]);
  const hasWire=Object.hasOwn(value,'wire');
  if(hasWire){
   if(typeof value.wire!=='string'||value.wire.length>349528)fail();const wire=Buffer.from(value.wire,'base64');
   if(wire.toString('base64')!==value.wire||wire.length!==e.wire.length||!timingSafeEqual(wire,e.wire)||value.type!==e.type||!hexHash(value.abciTransactionHash)||value.abciTransactionHash!==e.abciHash)fail();
  }else if(Object.hasOwn(value,'type')||Object.hasOwn(value,'abciTransactionHash')||value.committed)fail();
  if(submission&&!hasWire)fail();
  if(Object.hasOwn(value,'cometIndex')&&(!Number.isSafeInteger(value.cometIndex)||value.cometIndex<0||value.cometIndex>4294967295))fail();
  const committed=value.status==='committed';
  if(value.committed!==committed||httpStatus!==(committed?200:value.status==='unknown'?202:submission?422:-1))fail();
  if(committed){
   if(!hasWire||!Object.hasOwn(value,'cometIndex')||value.from!==e.from||value.to!==e.to||value.amount!==e.amount||value.fee!==e.fee||value.nonce!==e.nonce)fail();
   if(Object.hasOwn(value,'error'))fail();decimal(value.executionHeight,true);transaction(value.transaction,e,value.executionHeight);
  }else{
   if(Object.hasOwn(value,'transaction')||Object.hasOwn(value,'from')||Object.hasOwn(value,'to')||value.amount!=='0'||value.fee!=='0'||value.nonce!=='0'||value.status==='unknown'&&(value.executionHeight!=='0'||Object.hasOwn(value,'cometIndex')))fail();
   if(value.status==='rejected'&&((value.executionHeight==='0')===Object.hasOwn(value,'cometIndex')))fail();
  }
  return Object.freeze({hash:e.original.hash,account:e.original.account,kind:e.original.kind,source:'comet-rpc',nativeTransactionHash:e.original.hash,...(hasWire?{abciTransactionHash:e.abciHash}:{}),outcome:committed?'bft-inclusion-observed':value.status==='rejected'?'rejection-observed':'outcome-unknown',executionHeight:value.executionHeight,...(committed?{decimalFields:Object.freeze({amount:value.amount,fee:value.fee,nonce:value.nonce}),cometIndex:value.cometIndex}:{}),...(committed&&e.revocation?{signedRevocation:Object.freeze({authorizingRevision:e.revocationIntent.authorizingRevision,throughRevision:e.revocationIntent.throughRevision,executeAt:e.revocationIntent.executeAt,revokeAt:e.revocationIntent.revokeAt}),feeLotFlowObserved:true,feeEffectsVerified:false}:{}),retryAuthorized:false,clearsOriginal:false,consensusFinality:false,producerDurability:false});
 }catch{fail();}
}
/** Binding/structure only, not transport authentication or a light-client
 * proof. A configured authenticated Comet source must be supplied separately.
 * No automatic POST, native parser fallback or ABCI/native hash reinterpretation. */
export const parsePQBFTOriginalResponse=(original,status,text)=>parse(original,status,text,false);
export const parsePQBFTSubmissionResponse=(original,status,text)=>parse(original,status,text,true);
