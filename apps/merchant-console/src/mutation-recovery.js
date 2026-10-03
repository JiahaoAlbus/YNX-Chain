import {httpBodyDigest} from '@ynx-chain/wallet-auth';
const PREFIX='ynx-merchant-mutation-v1:';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=httpBodyDigest;
export class UnresolvedMutationError extends Error{constructor(){super('An earlier merchant request is still unconfirmed. Restore its original inputs to check the original request before creating a replacement.');this.code='MERCHANT_MUTATION_UNRESOLVED'}}
// Persist only opaque retry identity and input digest. Private form contents,
// account, merchant records and credentials are never stored in this journal.
export function createMutationRecovery({storage,withLock=(key,work)=>{if(!globalThis.navigator?.locks)throw new Error('Safe merchant recovery requires Web Locks support.');return navigator.locks.request(key,work)},digest=hash,newKey=()=>crypto.randomUUID()}={}){
 const durable=()=>storage??globalThis.localStorage;
 function namespace({account,merchantId},operation){if(typeof account!=='string'||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(account)||typeof merchantId!=='string'||!/^mrc_[A-Za-z0-9._:-]{3,127}$/.test(merchantId)||typeof operation!=='string'||operation.length<1||operation.length>200)throw new Error('An authenticated merchant and account are required.');return PREFIX+digest(canonical({account,merchantId,operation}))}
 function read(key){const text=durable().getItem(key);if(text===null)return null;const record=JSON.parse(text);if(!record||Object.keys(record).sort().join(',')!=='digest,key'||typeof record.key!=='string'||record.key.length<8||record.key.length>128||!/^[a-f0-9]{64}$/.test(record.digest))throw new Error('Original merchant recovery data is invalid. Preserve it before sending another request.');return record}
 function revision(key){const value=durable().getItem(key+':revision');if(value!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw new Error('Original merchant recovery revision is invalid. Preserve it before sending another request.');return value}
 function clear(key,record,assertCurrent){assertCurrent();const pending=read(key);if(!pending||pending.key!==record.key||pending.digest!==record.digest)throw new Error('Original merchant recovery identity changed. Preserve the received result.');const next=crypto.randomUUID();durable().setItem(key+':revision',next);if(durable().getItem(key+':revision')!==next)throw new Error('Merchant recovery completion could not be saved. Check the original records.');assertCurrent();durable().removeItem(key);if(durable().getItem(key)!==null)throw new Error('The original merchant recovery identity could not be cleared. Check the original records before retrying.');durable().removeItem(key+':phase');}
 return Object.freeze({
  async pending(subject,operation){return read(namespace(subject,operation))},
  async discardPrepared(subject,operation,assertCurrent){const key=namespace(subject,operation),observed=read(key),observedRevision=revision(key);assertCurrent();return withLock(key,()=>{assertCurrent();if(revision(key)!==observedRevision)throw new Error('This merchant request was already completed or replaced. Refresh its records.');const pending=read(key);if(!observed||!pending||pending.key!==observed.key)throw new Error('No original merchant request is pending.');if(durable().getItem(key+':phase')!=='prepared')throw new UnresolvedMutationError();clear(key,pending,assertCurrent);});},
  async execute(subject,operation,input,assertCurrent,send,recover,recoverOnly=false){
   const originalText=canonical(input),original=JSON.parse(originalText);
   const namespaceKey=namespace(subject,operation),fingerprint=digest(originalText);assertCurrent();
   const observed=read(namespaceKey),observedRevision=revision(namespaceKey);
   let isOriginal=false;
   const record=await withLock(namespaceKey,()=>{assertCurrent();if(revision(namespaceKey)!==observedRevision)throw new Error('This merchant request was already completed or replaced. Refresh its records.');const previous=read(namespaceKey);if(observed&&(!previous||previous.key!==observed.key))throw new Error('This merchant request was already completed or replaced. Refresh its records.');if(previous){if(previous.digest!==fingerprint)throw new UnresolvedMutationError();isOriginal=recoverOnly||durable().getItem(namespaceKey+':phase')!=='prepared';return previous}if(recoverOnly)throw new Error('No original merchant request is pending.');const created={key:newKey(),digest:fingerprint};const encoded=JSON.stringify(created);durable().setItem(namespaceKey,encoded);if(durable().getItem(namespaceKey)!==encoded)throw new Error('Merchant recovery identity could not be saved. No request was sent.');durable().setItem(namespaceKey+':phase','prepared');if(durable().getItem(namespaceKey+':phase')!=='prepared')throw new Error('Merchant recovery phase could not be saved. No request was sent.');return created});
   assertCurrent();
   return withLock(namespaceKey,async()=>{assertCurrent();const pending=read(namespaceKey);if(!pending||pending.key!==record.key||pending.digest!==record.digest)throw new Error('This merchant request was already completed or replaced. Refresh its records.');isOriginal=isOriginal||durable().getItem(namespaceKey+':phase')!=='prepared';
    const wire={...original,idempotencyKey:record.key};
    if(isOriginal&&typeof recover!=='function')throw new UnresolvedMutationError();
    const markUnknown=()=>{assertCurrent();if(read(namespaceKey)?.key!==record.key)throw new Error('Original merchant recovery identity changed.');durable().setItem(namespaceKey+':phase','unknown');if(durable().getItem(namespaceKey+':phase')!=='unknown')throw new Error('Merchant recovery phase could not be saved. No request was sent.');assertCurrent();};
    const result=await (isOriginal?recover(wire):send(wire,markUnknown));assertCurrent();clear(namespaceKey,record,assertCurrent);return result});
  }
 });
}
