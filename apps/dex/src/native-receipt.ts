import { nativeInteger, nativeLedgerAddress, NATIVE_SOURCE } from './native-snapshot';

const BASE=(import.meta.env.VITE_DEX_GATEWAY_URL||import.meta.env.VITE_DEX_API_URL||'').replace(/\/$/,'');
const U64=18446744073709551615n;
export const RECEIPT_SCHEMA='ynx-native-finance-transaction-v1';
export class NativeReceiptError extends Error {
  constructor(public code:'INVALID_HASH'|'UNAVAILABLE'|'INVALID_RESPONSE'){super(code);}
}
const invalid=():never=>{throw new NativeReceiptError('INVALID_RESPONSE');};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
const digest=(v:unknown):string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)?v:invalid();
export function canonicalTransactionHash(v:string):string {
  if(!/^0x[0-9a-f]{64}$/.test(v))throw new NativeReceiptError('INVALID_HASH');
  return v;
}
export type NativeReceiptStatus='not_found'|'memory_only'|'uncertain'|'pending_durable'|'durable';
/** Hash-bound node observation, not a signature validator or consensus proof. */
export function parseNativeReceipt(raw:unknown,requestedHash:string,httpStatus=200) {
  const hash=canonicalTransactionHash(requestedHash),v=object(raw);
  if(httpStatus===404){
    if(v.status!=='not_found'||v.transactionHash!==hash)invalid();
    return {hash,status:'not_found' as NativeReceiptStatus,transaction:null,durability:null,consensusFinality:false as const};
  }
  if(httpStatus!==200||v.schemaVersion!==RECEIPT_SCHEMA||v.source!==NATIVE_SOURCE||v.integerEncoding!=='decimal-string'||v.consensusFinality!==false)invalid();
  const status=v.status;
  if(!['memory_only','uncertain','pending_durable','durable'].includes(String(status)))invalid();
  const t=object(v.transaction),d=object(v.durability);
  if(t.hash!==hash||d.version!=='ynx-local-durability-v1'||d.scope!=='local-snapshot')invalid();
  let account:string;try{account=nativeLedgerAddress(String(t.from));}catch{return invalid();}
  if(account!==t.from)invalid();
  const blockNumber=nativeInteger(t.blockNumber,U64),blockHash=t.blockHash===''?'':digest(t.blockHash);
  if((blockNumber==='0')!==(blockHash===''))invalid();
  const nonce=nativeInteger(t.nonce,U64),fee=nativeInteger(t.fee);
  if(typeof t.type!=='string'||!/^dex_(swap_exact_input|swap_exact_output|liquidity_add|liquidity_remove)$/.test(t.type))invalid();
  if(typeof t.to!=='string'||!/^dex_[a-z0-9][a-z0-9_-]{2,59}$/.test(t.to))invalid();
  if(fee!=='1'||nonce==='0')invalid();
  const checkpointHeight=nativeInteger(d.checkpointHeight,U64);
  const locallyDurable=status==='durable'||status==='pending_durable';
  const checkpointHash=locallyDurable?digest(d.checkpointHash):d.checkpointHash===''?'':invalid();
  const snapshotIntegrity=locallyDurable?digest(d.snapshotIntegrity):d.snapshotIntegrity===''?'':invalid();
  if(!locallyDurable&&checkpointHeight!=='0')invalid();
  if(status==='durable'&&(blockNumber==='0'||BigInt(blockNumber)>BigInt(checkpointHeight)))invalid();
  if(status==='pending_durable'&&blockNumber!=='0')invalid();
  if(typeof t.timestamp!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(t.timestamp)||!Number.isFinite(Date.parse(t.timestamp)))invalid();
  return {hash,status:status as NativeReceiptStatus,transaction:{account,action:String(t.type),pool:String(t.to),nonce,fee,blockNumber,blockHash,timestamp:String(t.timestamp)},
    durability:{checkpointHeight,checkpointHash,snapshotIntegrity,scope:'local-snapshot' as const},consensusFinality:false as const};
}
export type NativeReceipt=ReturnType<typeof parseNativeReceipt>;
/** Always one bounded read. No nonce allocation, signer call, retry or broadcast. */
export async function loadNativeReceipt(hash:string,signal?:AbortSignal):Promise<NativeReceipt>{
  canonicalTransactionHash(hash);
  let response:Response;
  try{response=await fetch(`${BASE}/v1/native-transactions/${hash}`,{method:'GET',credentials:'omit',cache:'no-store',signal,headers:{Accept:'application/json'}});}
  catch(error){if(signal?.aborted)throw error;throw new NativeReceiptError('UNAVAILABLE');}
  if(response.status!==200&&response.status!==404)throw new NativeReceiptError('UNAVAILABLE');
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))invalid();
  let raw:unknown;try{const text=await response.text();if(text.length>1024*1024)invalid();raw=JSON.parse(text);}catch{throw new NativeReceiptError('INVALID_RESPONSE');}
  return parseNativeReceipt(raw,hash,response.status);
}
