import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {preparePQAccountInitialTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const invalid=()=>{throw Object.assign(Error('The retained initial account Member cannot be verified.'),{code:'PQ_ORIGINAL_RECORD_INVALID'});};
// Public mathematical binding only. Original Genesis admission, occupancy and
// signing permission remain with their original owners, not this journal DTO.
export function parsePQAccountInitialOriginal(value){
 try{
  exactPQRecord(value,['version','account','kind','operationId','hash','wire','status','initialBinding','abciTransactionHash']);
  exactPQRecord(value.initialBinding,['chainId','owner','pkA','pkB','executionHeight']);
  if(value.version!==1||value.kind!=='pq-account-initial'||value.status!=='signed-unsubmitted'||typeof value.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)||typeof value.wire!=='string'||value.wire.length>131072||! /^[A-Za-z0-9_-]+$/.test(value.wire))invalid();
  const wire=Buffer.from(value.wire,'base64url');if(!wire.length||wire.toString('base64url')!==value.wire)invalid();
  const expected=Object.freeze({...value.initialBinding}),plan=preparePQAccountInitialTransport(wire,expected);
  if(value.account!==expected.owner||value.hash!==plan.transportHash||value.abciTransactionHash!==plan.abciTransactionHash)invalid();
  return Object.freeze({...value,initialBinding:expected});
 }catch{invalid();}
}
export function createPQAccountInitialOriginalFromMember(member,{expected,operationId}){
 const plan=preparePQAccountInitialTransport(member,expected);
 return parsePQAccountInitialOriginal({version:1,account:expected.owner,kind:'pq-account-initial',operationId,hash:plan.transportHash,wire:Buffer.from(plan.body).toString('base64url'),status:'signed-unsubmitted',initialBinding:expected,abciTransactionHash:plan.abciTransactionHash});
}
