import {socialDiscoveryEntry,type SocialDiscoveryEntry,type ContactReview} from './contactRequestFlow';
export function isOriginalDiscoveryReview(entry:SocialDiscoveryEntry,review:Pick<ContactReview,'source'|'value'>):boolean{
 if(review.source!==entry.source)return false;
 return review.value===entry.value||(entry.source==='invite'&&review.value===entry.value.slice('https://social.ynxweb4.com/invite/'.length));
}
export interface DiscoveryIntentStorage{read():Promise<string|null>;write(value:string):Promise<void>}
function checked(raw:string|null):SocialDiscoveryEntry[]{
 if(raw===null)return [];
 let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error('Original discovery storage requires recovery; nothing was reset')}
 if(!value||typeof value!=='object'||!('schemaVersion' in value)||value.schemaVersion!==1||!('entries' in value)||!Array.isArray(value.entries)||value.entries.length>16||Object.keys(value).sort().join(',')!=='entries,schemaVersion')throw new Error('Original discovery storage requires recovery; nothing was reset');
 const seen=new Set<string>();return value.entries.map(entry=>{
  const parsed=socialDiscoveryEntry(entry);if(!parsed||seen.has(parsed.value))throw new Error('Original discovery storage requires recovery; nothing was reset');seen.add(parsed.value);return parsed;
 });
}
// Business links only: no account, callback, grant, contact approval or key.
// Existing device-only secure storage keeps invitation capabilities off plaintext
// preferences. Local serialization is not a cross-process transaction claim.
export class NativeDiscoveryIntents{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private storage:DiscoveryIntentStorage){}
 private serial<T>(action:()=>Promise<T>):Promise<T>{const next=this.queue.then(action);this.queue=next.then(()=>{},()=>{});return next}
 load():Promise<SocialDiscoveryEntry|null>{return this.serial(async()=>checked(await this.storage.read()).at(-1)??null)}
 save(input:SocialDiscoveryEntry):Promise<void>{return this.serial(async()=>{
  const entry=socialDiscoveryEntry(input.value);if(!entry||entry.source!==input.source)throw new Error('Use an original Social discovery link');
  const entries=checked(await this.storage.read());
  if(entries.some(item=>item.value===entry.value))return;
  if(entries.length>=16)throw new Error('Review or dismiss an original discovery entry before opening another; originals were retained');
  entries.push(entry);await this.storage.write(JSON.stringify({schemaVersion:1,entries:entries.map(item=>item.value)}));
 })}
 consume(originalValue:string):Promise<boolean>{return this.serial(async()=>{
  if(!socialDiscoveryEntry(originalValue))throw new Error('Original discovery entry is required');
  const entries=checked(await this.storage.read()),remaining=entries.filter(item=>item.value!==originalValue);
  if(remaining.length===entries.length)return false;
  await this.storage.write(JSON.stringify({schemaVersion:1,entries:remaining.map(item=>item.value)}));return true;
 })}
}
