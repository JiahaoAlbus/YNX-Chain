import type {ContactReview} from './contactRequestFlow';
export type NativeContactIntent=Readonly<{schemaVersion:1;account:string;source:ContactReview['source'];value:string;personId:string;idempotencyKey:string;message:string;operationReturned?:true}>;
export interface NativeContactStorage{read(key:string):Promise<string|null>;write(key:string,value:string):Promise<void>}
const activeAccounts=new Set<string>();
function key(account:string){if(!/^ynx1[0-9a-z]{38}$/.test(account))throw new Error('Original Social account is required');return `ynx.social.contact.intent.v1.${account}`}
export function checkedNativeContactIntent(value:unknown,account:string):NativeContactIntent{
 key(account);const record=value as NativeContactIntent;
 const fields=record?.operationReturned===undefined?'account,idempotencyKey,message,personId,schemaVersion,source,value':'account,idempotencyKey,message,operationReturned,personId,schemaVersion,source,value';
 if(!record||Object.keys(record).sort().join(',')!==fields||record.schemaVersion!==1||record.account!==account||!['handle','qr','invite','contacts','recommendation'].includes(record.source)||typeof record.value!=='string'||!record.value||record.value.length>2048||typeof record.personId!=='string'||!/^sp_[A-Za-z0-9_-]{32}$/.test(record.personId)||typeof record.idempotencyKey!=='string'||!/^native-contact-[A-Za-z0-9_-]{16,64}$/.test(record.idempotencyKey)||typeof record.message!=='string'||record.message!==record.message.trim()||Array.from(record.message).length>200||record.operationReturned!==undefined&&record.operationReturned!==true)throw new Error('Original contact intent requires recovery; nothing was replaced');
 return Object.freeze({...record});
}
// One active recovery intent per original account. Unknown delivery blocks
// replacing that intent; a returned API operation is not recipient acceptance.
export class NativeContactIntents{
 constructor(private storage:NativeContactStorage){}
 private enter(account:string):()=>void{const slot=key(account);if(activeAccounts.has(slot))throw new Error('Original contact storage is busy; retry recovery');activeAccounts.add(slot);return()=>{activeAccounts.delete(slot)}}
 private async readStored(account:string):Promise<NativeContactIntent|null>{
  const raw=await this.storage.read(key(account));if(raw===null)return null;
  let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error('Original contact intent requires recovery; nothing was replaced')}
  return checkedNativeContactIntent(value,account);
 }
 async load(account:string):Promise<NativeContactIntent|null>{const release=this.enter(account);try{return await this.readStored(account)}finally{release()}}
 async prepare(candidate:NativeContactIntent,current:()=>boolean):Promise<NativeContactIntent>{
  candidate=checkedNativeContactIntent(candidate,candidate.account);
  const release=this.enter(candidate.account);
  try{
   const original=await this.readStored(candidate.account);
   if(!current())throw new Error('Contact review changed; original intent retained');
   if(original){
    const comparable={...original};delete comparable.operationReturned;
    if(JSON.stringify(comparable)===JSON.stringify(candidate))return original;
    if(!original.operationReturned||original.idempotencyKey===candidate.idempotencyKey)throw new Error('Restore the original pending request before changing it');
   }
   await this.storage.write(key(candidate.account),JSON.stringify(candidate));
   if(!current())throw new Error('Contact review changed; original intent retained');return candidate;
  }finally{release()}
 }
 async returned(supplied:NativeContactIntent,current:()=>boolean):Promise<boolean>{
  if(!current())return false;
  const intent=checkedNativeContactIntent(supplied,supplied.account);
  const release=this.enter(intent.account);
  try{
   const original=await this.readStored(intent.account);
   if(!current())return false;
   if(!original||JSON.stringify(original)!==JSON.stringify(intent))throw new Error('Original contact request changed; recovery intent retained');
   await this.storage.write(key(intent.account),JSON.stringify({...original,operationReturned:true}));return current();
  }finally{release()}
 }
}
