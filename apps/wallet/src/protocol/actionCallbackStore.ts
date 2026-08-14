import type { SecureStorageAdapter } from "../storage/walletRepository";

const CALLBACK_STORE_KEY="ynx.wallet.action-callbacks.v2";
const LEGACY_REPLAY_KEY="ynx.wallet.action-replays.v1";
const MAX_RECORDS=4096;
const MAX_STORE_BYTES=1024*1024;
const MAX_RESPONSE_URL_BYTES=256*1024;
const EXACT_KEY=/^(exchange|developer|dex|quant):[0-9a-f]{64}$/;
const EXACT_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACCOUNT=/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const BUNDLE=/^[A-Za-z][A-Za-z0-9._-]{2,127}$/;

export type ActionCallbackBinding=Readonly<{key:string;expiresAt:string;account:string;bundleId:string;callback:string}>;
type StoredRecord=Readonly<ActionCallbackBinding&{state:"pending"|"delivered";responseURL:string|null}>;

export class PersistentActionCallbackStore{
  private pending:Promise<void>=Promise.resolve();
  constructor(private readonly storage:SecureStorageAdapter){}

  prepare(binding:ActionCallbackBinding,createResponse:()=>Promise<string>,now:()=>Date=()=>new Date(),assertActive:()=>void=()=>{}):Promise<string>{
    return this.enqueue(()=>this.prepareExclusive(binding,createResponse,now,assertActive));
  }

  complete(key:string,responseURL:string):Promise<void>{return this.enqueue(()=>this.completeExclusive(key,responseURL))}

  discardExpired(at=new Date()):Promise<number>{return this.enqueue(()=>this.discardExpiredExclusive(at))}

  private async prepareExclusive(binding:ActionCallbackBinding,createResponse:()=>Promise<string>,now:()=>Date,assertActive:()=>void):Promise<string>{
    assertBinding(binding,now());
    const {records,legacyKeys}=await this.load();
    const existing=records.find(record=>record.key===binding.key);
    if(existing){
      if(!sameBinding(existing,binding))throw new Error("Wallet pending callback binding differs from this action request");
      if(existing.state!=="pending"||existing.responseURL===null)throw new Error("Wallet action request was already delivered");
      assertResponseURL(existing.responseURL,binding.callback);
      assertActive();assertBinding(binding,now());
      return existing.responseURL;
    }
    if(legacyKeys.has(binding.key))throw new Error("Wallet action request was already used");
    if(records.length+legacyKeys.size>=MAX_RECORDS)throw new Error("Wallet action callback capacity is exhausted");
    const responseURL=await createResponse();
    assertResponseURL(responseURL,binding.callback);
    assertActive();assertBinding(binding,now());
    const next=[...records,Object.freeze({...binding,state:"pending" as const,responseURL})].sort((left,right)=>left.key.localeCompare(right.key));
    await this.save(next);
    return responseURL;
  }

  private async completeExclusive(key:string,responseURL:string):Promise<void>{
    if(!EXACT_KEY.test(key))throw new Error("Wallet action callback key is invalid");
    const {records}=await this.load(),index=records.findIndex(record=>record.key===key);
    if(index<0)throw new Error("Wallet pending callback is missing");
    const current=records[index]!;
    if(current.state!=="pending"||current.responseURL===null)throw new Error("Wallet action callback was already delivered");
    if(current.responseURL!==responseURL)throw new Error("Wallet action callback completion response differs from pending state");
    const next=records.map((record,recordIndex)=>recordIndex===index?Object.freeze({...record,state:"delivered" as const,responseURL:null}):record);
    await this.save(next);
  }

  private async discardExpiredExclusive(at:Date):Promise<number>{
    if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw new Error("Wallet action callback cleanup time is invalid");
    const {records}=await this.load(),now=at.toISOString();let discarded=0;
    const next=records.map(record=>{if(record.state==="pending"&&record.expiresAt<=now){discarded+=1;return Object.freeze({...record,state:"delivered" as const,responseURL:null})}return record});
    if(discarded>0)await this.save(next);
    return discarded;
  }

  private async load():Promise<{records:StoredRecord[];legacyKeys:Set<string>}>{
    const [raw,legacyRaw]=await Promise.all([this.storage.getItem(CALLBACK_STORE_KEY),this.storage.getItem(LEGACY_REPLAY_KEY)]);
    const records=parseStore(raw),legacyKeys=parseLegacy(legacyRaw);
    if(records.some(record=>legacyKeys.has(record.key)))throw new Error("Wallet action callback state conflicts with legacy replay state");
    return{records,legacyKeys};
  }

  private async save(records:readonly StoredRecord[]):Promise<void>{
    const serialized=JSON.stringify({schemaVersion:2,records});
    if(serialized.length>MAX_STORE_BYTES)throw new Error("Wallet action callback storage capacity is exhausted");
    await this.storage.setItem(CALLBACK_STORE_KEY,serialized);
  }

  private enqueue<T>(operation:()=>Promise<T>):Promise<T>{const result=this.pending.then(operation);this.pending=result.then(()=>undefined,()=>undefined);return result}
}

function parseStore(raw:string|null):StoredRecord[]{
  if(raw===null)return[];
  if(raw.length>MAX_STORE_BYTES)throw new Error("Wallet action callback state is too large");
  let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet action callback state is unreadable")}
  if(!plain(value)||Object.keys(value).sort().join(",")!=="records,schemaVersion"||value.schemaVersion!==2||!Array.isArray(value.records)||value.records.length>MAX_RECORDS)throw new Error("Wallet action callback state is invalid");
  const records=value.records.map(parseRecord);
  for(let index=1;index<records.length;index++)if(records[index-1]!.key>=records[index]!.key)throw new Error("Wallet action callback state is not canonical");
  return records;
}

function parseRecord(value:unknown):StoredRecord{
  if(!plain(value)||Object.keys(value).sort().join(",")!=="account,bundleId,callback,expiresAt,key,responseURL,state")throw new Error("Wallet action callback record is invalid");
  const binding={key:value.key,expiresAt:value.expiresAt,account:value.account,bundleId:value.bundleId,callback:value.callback};
  assertBindingShape(binding);
  if(value.state!=="pending"&&value.state!=="delivered")throw new Error("Wallet action callback state is invalid");
  if(value.state==="pending"){if(typeof value.responseURL!=="string")throw new Error("Wallet pending callback response is missing");assertResponseURL(value.responseURL,binding.callback)}
  else if(value.responseURL!==null)throw new Error("Wallet delivered callback must not retain its response");
  return Object.freeze({...binding,state:value.state,responseURL:value.responseURL}) as StoredRecord;
}

function parseLegacy(raw:string|null):Set<string>{
  if(raw===null)return new Set();
  if(raw.length>512*1024)throw new Error("Wallet legacy action replay state is too large");
  let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet legacy action replay state is unreadable")}
  if(!Array.isArray(value)||value.length>MAX_RECORDS)throw new Error("Wallet legacy action replay state is invalid");
  const keys=new Set<string>();let previous="";
  for(const item of value){if(!Array.isArray(item)||item.length!==2||typeof item[0]!=="string"||typeof item[1]!=="string"||!EXACT_KEY.test(item[0])||!validTime(item[1])||item[0]<=previous)throw new Error("Wallet legacy action replay state is invalid or noncanonical");keys.add(item[0]);previous=item[0]}
  return keys;
}

function assertBinding(binding:ActionCallbackBinding,at:Date):void{assertBindingShape(binding);if(!(at instanceof Date)||!Number.isFinite(at.getTime())||at.toISOString()>=binding.expiresAt)throw new Error("Wallet action callback binding is expired")}
function assertBindingShape(binding:{key:unknown;expiresAt:unknown;account:unknown;bundleId:unknown;callback:unknown}):asserts binding is ActionCallbackBinding{
  if(typeof binding.key!=="string"||!EXACT_KEY.test(binding.key)||typeof binding.expiresAt!=="string"||!validTime(binding.expiresAt)||typeof binding.account!=="string"||!ACCOUNT.test(binding.account)||typeof binding.bundleId!=="string"||!BUNDLE.test(binding.bundleId)||typeof binding.callback!=="string")throw new Error("Wallet action callback binding is invalid");
  let callback:URL;try{callback=new URL(binding.callback)}catch{throw new Error("Wallet action callback route is invalid")}
  if(callback.toString()!==binding.callback||callback.username||callback.password||callback.port||callback.search||callback.hash||callback.protocol==="http:")throw new Error("Wallet action callback route is not canonical");
}
function assertResponseURL(responseURL:string,callback:string):void{
  if(responseURL.length>MAX_RESPONSE_URL_BYTES)throw new Error("Wallet action callback response is too large");
  let parsed:URL;try{parsed=new URL(responseURL)}catch{throw new Error("Wallet action callback response is invalid")}
  const keys=[...parsed.searchParams.keys()],response=keys.length===1&&keys[0]==="response"?parsed.searchParams.get("response"):null;
  if(!response||!/^[A-Za-z0-9_-]+$/.test(response)||responseURL!==`${callback}?response=${response}`)throw new Error("Wallet action callback response does not match its registered route");
}
function sameBinding(left:ActionCallbackBinding,right:ActionCallbackBinding):boolean{return left.key===right.key&&left.expiresAt===right.expiresAt&&left.account===right.account&&left.bundleId===right.bundleId&&left.callback===right.callback}
function validTime(value:string):boolean{if(!EXACT_TIME.test(value))return false;const parsed=Date.parse(value);return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value}
function plain(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
