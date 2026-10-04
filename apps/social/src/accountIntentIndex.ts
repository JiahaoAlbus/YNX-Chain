import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

type Storage = { read(key:string):Promise<string|null>; write(key:string,value:string):Promise<void>; remove(key:string):Promise<void> };
type Index = { version:1; account:string; keys:string[]; deleted:boolean; cleanupComplete:boolean };
const validAccount=(account:string)=>/^ynx1[0-9a-z]{38}$/.test(account);
const indexKey=(account:string)=>`ynx.social.intent.index.v1.${account}`;
const attemptKey=(account:string)=>`ynx.social.deletion.attempt.v1.${account}`;
const hash=(value:unknown)=>bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))));
function boundRecord(key:string,raw:string,account:string){
  if(raw.length>65536)throw new Error('Original account intent requires recovery');
  const value=JSON.parse(raw);
  if(!value||value.account!==account)throw new Error('Original account intent binding changed; data retained');
  const expected=key.startsWith('ynx.social.moment.report.v1.')
    ? `ynx.social.moment.report.v1.${hash([account,'moment',value.body?.targetId])}`
    : key.startsWith('ynx.social.moment.action.v1.')
      ? `ynx.social.moment.action.v1.${hash([account,value.action?.kind,value.action?.subject])}`
      : `ynx.social.moment.intent.v1.${account}`;
  if(key!==expected)throw new Error('Original account intent key changed; data retained');
}
function decode(raw:string|null,account:string):Index{
  if(raw===null)return {version:1,account,keys:[],deleted:false,cleanupComplete:false};
  if(raw.length>400000)throw new Error('Account intent index requires recovery');
  const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(',')!=='account,cleanupComplete,deleted,keys,version'||value.version!==1||value.account!==account||
    typeof value.deleted!=='boolean'||typeof value.cleanupComplete!=='boolean'||!Array.isArray(value.keys)||value.keys.length>2048||new Set(value.keys).size!==value.keys.length||
    value.keys.some((key:unknown)=>typeof key!=='string'||!(key===`ynx.social.moment.intent.v1.${account}`||/^ynx\.social\.moment\.(report|action)\.v1\.[0-9a-f]{64}$/.test(key)))){
    throw new Error('Account intent index requires recovery; original data retained');
  }
  return value as Index;
}

/** A local, per-account serialization/index, not authority or cross-process CAS. */
export class AccountIntentIndex{
  private queues=new Map<string,Promise<unknown>>();
  constructor(private storage:Storage){}
  private async serial<T>(account:string,operation:()=>Promise<T>):Promise<T>{
    if(!validAccount(account))throw new Error('Original Social account is required');
    const previous=this.queues.get(account)??Promise.resolve();
    const next=previous.catch(()=>undefined).then(operation);
    this.queues.set(account,next);
    try{return await next}finally{if(this.queues.get(account)===next)this.queues.delete(account)}
  }
  bind(account:string,current:()=>boolean):Storage{
    const check=()=>{if(!current())throw new Error('Social account changed; original intent retained')};
    const checkedIndex=async()=>{
      check();const index=decode(await this.storage.read(indexKey(account)),account);check();
      if(index.deleted)throw new Error('Account deletion was confirmed; retained local data requires recovery');
      return index;
    };
    return {
      read:key=>this.serial(account,async()=>{await checkedIndex();const raw=await this.storage.read(key);check();if(raw!==null)boundRecord(key,raw,account);return raw}),
      write:(key,value)=>this.serial(account,async()=>{
        check();boundRecord(key,value,account);const index=await checkedIndex();
        if(!index.keys.includes(key)){
          if(index.keys.length>=2048)throw new Error('Account intent index is full; original data retained');
          index.keys.push(key);check();await this.storage.write(indexKey(account),JSON.stringify(index));check();
        }
        await this.storage.write(key,value);check();
      }),
      remove:key=>this.serial(account,async()=>{await checkedIndex();const raw=await this.storage.read(key);check();if(raw!==null){boundRecord(key,raw,account);await this.storage.remove(key);check()}}),
    };
  }
  async beginDeletion(account:string,current:()=>boolean){
    return this.serial(account,async()=>{
      const check=()=>{if(!current())throw new Error('Original deletion account changed; nothing was resent')};
      check();const previous=await this.storage.read(attemptKey(account));check();
      const index=decode(await this.storage.read(indexKey(account)),account);check();
      if(index.deleted||previous!==null)throw new Error('Original deletion requires recovery; do not repeat the server deletion');
      await this.storage.write(attemptKey(account),JSON.stringify({version:1,account,status:'unknown'}));check();
    });
  }
  async recordConfirmedDeletion(account:string,current:()=>boolean){
    return this.serial(account,async()=>{
      const check=()=>{if(!current())throw new Error('Deletion confirmation changed account; remaining data retained')};
      check();const index=decode(await this.storage.read(indexKey(account)),account);check();
      index.deleted=true;await this.storage.write(indexKey(account),JSON.stringify(index));check();
    });
  }
  async reviewDeletionRecovery(account:string,current:()=>boolean){
    return this.serial(account,async()=>{
      const check=()=>{if(!current())throw new Error('Review local recovery again with the original account')};
      check();const raw=await this.storage.read(indexKey(account));check();const index=decode(raw,account);
      if(raw!==null&&index.deleted)return Object.freeze({account,state:'confirmed' as const,cleanupComplete:index.cleanupComplete});
      const attempt=await this.storage.read(attemptKey(account));check();
      if(attempt===null)return null;
      const value=JSON.parse(attempt);
      if(!value||Object.keys(value).sort().join(',')!=='account,status,version'||value.version!==1||value.account!==account||value.status!=='unknown')throw new Error('Original deletion attempt requires recovery; data retained');
      return Object.freeze({account,state:'unknown' as const,cleanupComplete:false});
    });
  }
  async cleanupConfirmed(account:string,current:()=>boolean){return this.cleanup(account,current,false)}
  async resumeCleanup(account:string,current:()=>boolean){return this.cleanup(account,current,true)}
  private async cleanup(account:string,current:()=>boolean,requireFence:boolean){
    return this.serial(account,async()=>{
      const check=()=>{if(!current())throw new Error('Deletion cleanup stopped after authorization changed; remaining data retained')};
      check();const raw=await this.storage.read(indexKey(account));check();const index=decode(raw,account);
      if(requireFence&&(raw===null||!index.deleted))throw new Error('No retained deletion confirmation; local data was not erased');
      // Persist the write fence before erasing any indexed records. Retain the
      // references on failure so explicit local recovery need not repeat DELETE.
      index.deleted=true;check();await this.storage.write(indexKey(account),JSON.stringify(index));check();
      let removed=0;
      for(const key of index.keys){
        check();const raw=await this.storage.read(key);check();
        if(raw!==null){boundRecord(key,raw,account);check();await this.storage.remove(key);check();removed++}
      }
      index.cleanupComplete=true;check();await this.storage.write(indexKey(account),JSON.stringify(index));check();
      return {knownRecordsRemoved:removed,legacyUnindexedPreserved:true as const};
    });
  }
}
