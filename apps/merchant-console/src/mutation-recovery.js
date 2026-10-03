import {httpBodyDigest} from '@ynx-chain/wallet-auth';
const PREFIX='ynx-merchant-mutation-v1:';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=httpBodyDigest;
export class UnresolvedMutationError extends Error{constructor(){super('An earlier merchant request is still unconfirmed. Restore its original inputs and retry before creating a replacement.');this.code='MERCHANT_MUTATION_UNRESOLVED'}}
// Persist only opaque retry identity and input digest. Private form contents,
// account, merchant records and credentials are never stored in this journal.
export function createMutationRecovery({storage,withLock=(key,work)=>{if(!globalThis.navigator?.locks)throw new Error('Safe merchant recovery requires Web Locks support.');return navigator.locks.request(key,work)},digest=hash,newKey=()=>crypto.randomUUID()}={}){
 const durable=()=>storage??globalThis.localStorage;
 function namespace({account,merchantId},operation){if(typeof account!=='string'||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(account)||typeof merchantId!=='string'||!/^mrc_[A-Za-z0-9._:-]{3,127}$/.test(merchantId)||typeof operation!=='string'||operation.length<1||operation.length>200)throw new Error('An authenticated merchant and account are required.');return PREFIX+digest(canonical({account,merchantId,operation}))}
 function read(key){const text=durable().getItem(key);if(text===null)return null;const record=JSON.parse(text);if(!record||Object.keys(record).sort().join(',')!=='digest,key'||typeof record.key!=='string'||record.key.length<8||record.key.length>128||!/^[a-f0-9]{64}$/.test(record.digest))throw new Error('Original merchant recovery data is invalid. Preserve it before sending another request.');return record}
 return Object.freeze({
  async pending(subject,operation){return read(namespace(subject,operation))},
  async execute(subject,operation,input,assertCurrent,send){
   const originalText=canonical(input),original=JSON.parse(originalText);
   const namespaceKey=namespace(subject,operation),fingerprint=digest(originalText);assertCurrent();
   const observed=read(namespaceKey);
   const record=await withLock(namespaceKey,()=>{assertCurrent();const previous=read(namespaceKey);if(observed&&(!previous||previous.key!==observed.key))throw new Error('This merchant request was already completed or replaced. Refresh its records.');if(previous){if(previous.digest!==fingerprint)throw new UnresolvedMutationError();return previous}const created={key:newKey(),digest:fingerprint};const encoded=JSON.stringify(created);durable().setItem(namespaceKey,encoded);if(durable().getItem(namespaceKey)!==encoded)throw new Error('Merchant recovery identity could not be saved. No request was sent.');return created});
   assertCurrent();
   return withLock(namespaceKey,async()=>{assertCurrent();const pending=read(namespaceKey);if(!pending||pending.key!==record.key||pending.digest!==record.digest)throw new Error('This merchant request was already completed or replaced. Refresh its records.');const result=await send({...original,idempotencyKey:record.key});assertCurrent();if(read(namespaceKey)?.key!==record.key)throw new Error('Original merchant recovery identity changed. Preserve the received result.');durable().removeItem(namespaceKey);if(durable().getItem(namespaceKey)!==null)throw new Error('The merchant request succeeded but its recovery identity could not be cleared. Check the original records before retrying.');return result});
  }
 });
}
