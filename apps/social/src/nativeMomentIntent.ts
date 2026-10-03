import {runCurrentContactAction} from './contactActionGuard';
export type NativeMomentDraft={text:string;visibility:'public'|'contacts'|'private';media:{id:string;uri:string}[]};
export type NativeMomentIntent=NativeMomentDraft&{schemaVersion:1;account:string;idempotencyKey:string};
export interface MomentIntentStorage{read(key:string):Promise<string|null>;write(key:string,value:string):Promise<void>;remove(key:string):Promise<void>}
export function publishedMomentRecordId(value:unknown):string{
 if(!value||typeof value!=='object'||!('record' in value))throw new Error('Publication readback was not confirmed; original intent retained');
 const record=value.record;
 if(!record||typeof record!=='object'||!('id' in record)||typeof record.id!=='string'||!record.id||record.id.length>256)throw new Error('Publication readback was not confirmed; original intent retained');
 return record.id;
}
function storageKey(account:string){if(!/^ynx1[0-9a-z]{38}$/.test(account))throw new Error('Original Social account is required');return `ynx.social.moment.intent.v1.${account}`}
function checkedDraft(value:NativeMomentDraft):NativeMomentDraft{
 if(!value||typeof value.text!=='string'||value.text.length>20000||!['public','contacts','private'].includes(value.visibility)||!Array.isArray(value.media)||value.media.length>4)throw new Error('Original moment requires recovery');
 const seen=new Set<string>();const media=value.media.map(item=>{
  if(!item||typeof item.id!=='string'||!item.id||item.id.length>256||seen.has(item.id)||typeof item.uri!=='string'||item.uri.length>4096)throw new Error('Original moment media requires recovery');
  seen.add(item.id);return {id:item.id,uri:item.uri};
 });
 return {text:value.text,visibility:value.visibility,media};
}
export function checkedNativeMomentIntent(raw:string,account:string):NativeMomentIntent{
 storageKey(account);let value:NativeMomentIntent;
 try{value=JSON.parse(raw)}catch{throw new Error('Original moment storage requires recovery; nothing was replaced')}
 if(!value||Object.keys(value).sort().join(',')!=='account,idempotencyKey,media,schemaVersion,text,visibility'||value.schemaVersion!==1||value.account!==account||!/^native-moment-[a-f0-9]{32}$/.test(value.idempotencyKey))throw new Error('Original moment storage requires recovery; nothing was replaced');
 return {schemaVersion:1,account,idempotencyKey:value.idempotencyKey,...checkedDraft(value)};
}
// Existing secure storage holds the original submitted intent, not grants/keys.
// Local serialization does not claim a cross-process or server-side lock.
export class NativeMomentIntents{
 private busy=false;
 constructor(private storage:MomentIntentStorage,private nonce:()=>Promise<string>){}
 async load(account:string):Promise<NativeMomentIntent|null>{
  const raw=await this.storage.read(storageKey(account));return raw===null?null:checkedNativeMomentIntent(raw,account);
 }
 async prepare(account:string,draft:NativeMomentDraft,current:()=>boolean):Promise<NativeMomentIntent>{
  if(this.busy)throw new Error('Original moment operation is already pending');this.busy=true;
  try{
   if(!current())throw new Error('Review the moment with the original account again');
   const original=await this.load(account),snapshot=checkedDraft(draft);
   if(!current())throw new Error('Review the moment with the original account again');
   if(original){if(JSON.stringify(checkedDraft(original))!==JSON.stringify(snapshot))throw new Error('Restore and retry the original pending moment before changing it');return original}
   const nonce=await this.nonce();if(!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Original moment request identity is unavailable');
   if(!current())throw new Error('Review the moment with the original account again');
   const intent:NativeMomentIntent={schemaVersion:1,account,idempotencyKey:`native-moment-${nonce}`,...snapshot};
   await this.storage.write(storageKey(account),JSON.stringify(intent));
   if(!current())throw new Error('Original moment retained; account changed before sending');
   return intent;
  }finally{this.busy=false}
 }
 async acknowledge(intent:NativeMomentIntent,recordId:string,current:()=>boolean):Promise<boolean>{
  if(this.busy)throw new Error('Original moment operation is already pending');this.busy=true;
  try{
   if(!current())return false;
   if(typeof recordId!=='string'||!recordId||recordId.length>256)throw new Error('Publication readback was not confirmed; original intent retained');
   const original=await this.load(intent.account);
   if(!current())return false;
   if(!original||JSON.stringify(original)!==JSON.stringify(intent))throw new Error('Original publication identity changed; pending intent retained');
   await this.storage.remove(storageKey(intent.account));return current();
  }finally{this.busy=false}
 }
}
export async function publishOriginalNativeMoment(
 queue:NativeMomentIntents,account:string,draft:NativeMomentDraft,current:()=>boolean,
 send:(payload:{idempotencyKey:string;text:string;visibility:NativeMomentDraft['visibility'];media:string[]})=>Promise<unknown>,
 timeoutMs=30000,
 parent?:AbortSignal,
):Promise<boolean>{
 return runCurrentContactAction(current,async signal=>{
  const active=()=>current()&&!signal.aborted&&!parent?.aborted;
  const intent=await queue.prepare(account,draft,active);
  if(!active())throw new Error('Publication delivery is not confirmed; original intent retained');
  const result=await send({idempotencyKey:intent.idempotencyKey,text:intent.text,visibility:intent.visibility,media:intent.media.map(item=>item.id)});
  if(!active())throw new Error('Publication delivery is not confirmed; original intent retained');
  if(!await queue.acknowledge(intent,publishedMomentRecordId(result),active))throw new Error('Publication delivery is not confirmed; original intent retained');
 },timeoutMs,parent);
}
