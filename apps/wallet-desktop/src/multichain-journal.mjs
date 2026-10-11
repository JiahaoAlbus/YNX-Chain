import {AtomicMultiFile,exactObject,multiError,validateNetwork} from './multichain-config.mjs';
import {verifySignedRecord} from './multichain-evm.mjs';

const states=new Set(['prepared','signed','unknown','submitted','included','reverted','cancelled','local-cancelled-before-broadcast']);
const unresolved=new Set(['prepared','signed','unknown','submitted']);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const quantity=value=>typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value)&&BigInt(value)<(1n<<256n);
export function validateJournal(value){
  exactObject(value,['version','records']);if(value.version!==1||!Array.isArray(value.records)||value.records.length>512)throw Error('Invalid journal');
  for(const r of value.records){
    exactObject(r,['id','network','account','nonce','asset','to','amount','transaction','state','raw','hash','createdAt','updatedAt','receipt']);
    const {id,family,...network}=r.network;const checked=validateNetwork(network);if(checked.id!==id||family!=='evm'||typeof r.id!=='string'||! /^[0-9a-f-]{36}$/.test(r.id)||! /^0x[0-9a-f]{40}$/.test(r.account)||! /^0x[0-9a-f]{40}$/.test(r.to)||!quantity(r.nonce)||!quantity(r.amount)||BigInt(r.amount)===0n||!(r.asset==='native'||/^0x[0-9a-f]{40}$/.test(r.asset))||!states.has(r.state)||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.updatedAt)||r.createdAt<0||r.updatedAt<r.createdAt)throw Error('Invalid transaction record');
    exactObject(r.transaction,['chainId','nonce','to','value','data','gasLimit','gasPrice','type']);
    const tx=r.transaction;if(tx.chainId!==checked.chainId||tx.nonce!==r.nonce||! /^0x[0-9a-f]{40}$/.test(tx.to)||![tx.value,tx.gasLimit,tx.gasPrice].every(quantity)||BigInt(tx.gasLimit)<21000n||BigInt(tx.gasPrice)===0n||tx.type!==0||typeof tx.data!=='string'||! /^0x(?:[0-9a-f]{2})*$/.test(tx.data)||tx.data.length>1000)throw Error('Invalid reviewed transaction');
    if((r.asset==='native'&&(tx.to!==r.to||tx.value!==r.amount||tx.data!=='0x'))||(r.asset!=='native'&&(tx.to!==r.asset||tx.value!=='0')))throw Error('Invalid asset transaction');
    if(r.raw!==null&&(typeof r.raw!=='string'||! /^0x(?:[0-9a-f]{2})+$/.test(r.raw)||r.raw.length>32768)||r.hash!==null&&!hash(r.hash)||['prepared','cancelled'].includes(r.state)&&(r.raw!==null||r.hash!==null)||!['prepared','cancelled'].includes(r.state)&&(r.raw===null||r.hash===null))throw Error('Invalid signed intent');
    if(r.raw!==null)verifySignedRecord(r.raw,r);
    if(r.receipt!==null){exactObject(r.receipt,['hash','blockHash','blockNumber','status','confirmationScope']);if(r.receipt.hash!==r.hash||!hash(r.receipt.blockHash)||!quantity(r.receipt.blockNumber)||![0,1].includes(r.receipt.status)||r.receipt.confirmationScope!=='rpc-block-inclusion')throw Error('Invalid receipt')}
    if(['included','reverted'].includes(r.state)&&!r.receipt)throw Error('Missing inclusion receipt');
    if(r.state==='local-cancelled-before-broadcast'&&r.receipt!==null)throw Error('Local cancellation is not an inclusion receipt');
  }
  if(new Set(value.records.map(r=>r.id)).size!==value.records.length)throw Error('Duplicate intent');
  return value;
}
export class MultiJournal{
  #uncertain=new Set();
  constructor({filePath,file}={}){this.file=file??new AtomicMultiFile({filePath,initial:{version:1,records:[]},validate:validateJournal,maxBytes:5_000_000})}
  async list(networkId,account){const value=await this.file.read();return value.records.filter(r=>r.network.id===networkId&&r.account===account).map(r=>structuredClone(r))}
  async blocking(networkId,account){return (await this.list(networkId,account)).filter(r=>unresolved.has(r.state)||this.#uncertain.has(r.id))}
  async pendingNetwork(networkId){return (await this.file.read()).records.filter(r=>r.network.id===networkId&&(unresolved.has(r.state)||this.#uncertain.has(r.id))).length}
  async reserve(record){
    await this.file.mutate(value=>{if(value.records.some(r=>r.network.id===record.network.id&&r.account===record.account&&(unresolved.has(r.state)||this.#uncertain.has(r.id))))throw multiError('MULTICHAIN_RESOLUTION_REQUIRED','Resolve the recorded transaction before sending another.');value.records.push(structuredClone(record));return value});
    // This closure exists only for this new live reservation. It cannot be
    // reconstructed from a reopened record, an IPC boolean or a missing receipt.
    let open=true,submissionStarted=false,cancelling=false;
    const binding=JSON.stringify([record.network,record.account,record.nonce,record.asset,record.to,record.amount,record.transaction]);
    const assert=()=>{if(!open||submissionStarted||cancelling||this.#uncertain.has(record.id))throw multiError('MULTICHAIN_INTENT_CONFLICT','The original pre-submit attempt is no longer available.')};
    return Object.freeze({
      beginSubmit:()=>{assert();submissionStarted=true},
      retire:()=>{open=false},
      cancelSigned:async updatedAt=>{
        assert();cancelling=true;
        try{return await this.file.mutate(value=>{const r=value.records.find(r=>r.id===record.id);if(!open||submissionStarted||!r||r.state!=='signed'||JSON.stringify([r.network,r.account,r.nonce,r.asset,r.to,r.amount,r.transaction])!==binding||updatedAt<r.updatedAt)throw multiError('MULTICHAIN_INTENT_CONFLICT','Keep the original signed record.');r.state='local-cancelled-before-broadcast';r.updatedAt=updatedAt;return value})}
        catch(error){
          // A rejected write is never a successful cancellation receipt. Keep a
          // live hold and attempt a durable UNKNOWN quarantine with the same bytes.
          this.#uncertain.add(record.id);
          await this.file.mutate(value=>{const r=value.records.find(r=>r.id===record.id);if(r&&['signed','local-cancelled-before-broadcast'].includes(r.state)){r.state='unknown';r.updatedAt=Math.max(r.updatedAt,updatedAt)}return value}).catch(()=>{});
          throw error;
        }
      }
    });
  }
  async transition(id,next){const result=await this.file.mutate(value=>{const r=value.records.find(r=>r.id===id);if(!r)throw multiError('MULTICHAIN_UNKNOWN_INTENT','The transaction record was not found.');
    exactObject(next,['state','raw','hash','receipt','updatedAt']);
    const allowed={prepared:['signed','cancelled'],signed:['submitted','unknown','included','reverted'],unknown:['unknown','submitted','included','reverted'],submitted:['unknown','submitted','included','reverted'],included:['included','unknown'],reverted:['reverted','unknown'],cancelled:[],'local-cancelled-before-broadcast':['unknown']};
    if(!allowed[r.state].includes(next.state)||next.updatedAt<r.updatedAt||r.raw!==null&&next.raw!==undefined&&next.raw!==r.raw||r.hash!==null&&next.hash!==undefined&&next.hash!==r.hash)throw multiError('MULTICHAIN_INTENT_CONFLICT','Keep the original transaction record; it cannot be replaced.');
    Object.assign(r,next);return value});if(['included','reverted'].includes(next.state))this.#uncertain.delete(id);return result}
}
