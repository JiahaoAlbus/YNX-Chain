import { requestDigest, type AuthorizationRequest } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const STORE_KEY="ynx.wallet.authorization-callbacks.v2";
const LEGACY_NONCE_KEY="ynx.wallet.auth-nonces.v1";
const MAX_RECORDS=4096,MAX_STORE_BYTES=1024*1024,MAX_RESPONSE_URL_BYTES=256*1024;
const DIGEST=/^[0-9a-f]{64}$/,NONCE=/^[A-Za-z0-9_-]{32,64}$/,TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACCOUNT=/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/,BUNDLE=/^[A-Za-z][A-Za-z0-9._-]{2,127}$/;

type Binding=Readonly<{requestDigest:string;nonce:string;expiresAt:string;account:string;bundleId:string;callback:string}>;
type StoredRecord=Readonly<Binding&{state:"pending"|"delivered";responseURL:string|null}>;

export class PersistentAuthorizationCallbackStore{
  private pending:Promise<void>=Promise.resolve();
  constructor(private readonly storage:SecureStorageAdapter){}

  prepare(request:AuthorizationRequest,account:string,createResponse:()=>Promise<string>,now:()=>Date=()=>new Date(),assertActive:()=>void=()=>{}):Promise<string>{
    return this.enqueue(()=>this.prepareExclusive(binding(request,account),createResponse,now,assertActive));
  }
  complete(request:AuthorizationRequest,responseURL:string):Promise<void>{return this.enqueue(()=>this.completeExclusive(requestDigest(request),responseURL))}
  discardExpired(at=new Date()):Promise<number>{return this.enqueue(()=>this.discardExpiredExclusive(at))}

  private async prepareExclusive(bound:Binding,createResponse:()=>Promise<string>,now:()=>Date,assertActive:()=>void):Promise<string>{
    assertBinding(bound,now());const {records,legacyNonces}=await this.load();
    const existing=records.find(item=>item.requestDigest===bound.requestDigest);
    if(existing){if(!sameBinding(existing,bound))throw new Error("Wallet pending authorization callback binding differs from this request");if(existing.state!=="pending"||existing.responseURL===null)throw new Error("Wallet authorization callback was already delivered");assertResponse(existing.responseURL,bound.callback);assertActive();assertBinding(bound,now());return existing.responseURL}
    if(records.some(item=>item.nonce===bound.nonce)||legacyNonces.has(bound.nonce))throw new Error("Wallet authorization nonce was already used");
    if(records.length+legacyNonces.size>=MAX_RECORDS)throw new Error("Wallet authorization callback capacity is exhausted");
    const responseURL=await createResponse();assertResponse(responseURL,bound.callback);assertActive();assertBinding(bound,now());
    await this.save([...records,Object.freeze({...bound,state:"pending" as const,responseURL})].sort((a,b)=>a.requestDigest.localeCompare(b.requestDigest)));return responseURL;
  }
  private async completeExclusive(digest:string,responseURL:string):Promise<void>{
    if(!DIGEST.test(digest))throw new Error("Wallet authorization callback digest is invalid");const {records}=await this.load(),index=records.findIndex(item=>item.requestDigest===digest);if(index<0)throw new Error("Wallet pending authorization callback is missing");const current=records[index]!;
    if(current.state!=="pending"||current.responseURL===null)throw new Error("Wallet authorization callback was already delivered");if(current.responseURL!==responseURL)throw new Error("Wallet authorization callback completion response differs from pending state");
    await this.save(records.map((item,i)=>i===index?Object.freeze({...item,state:"delivered" as const,responseURL:null}):item));
  }
  private async discardExpiredExclusive(at:Date):Promise<number>{
    if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw new Error("Wallet authorization callback cleanup time is invalid");const {records}=await this.load();let discarded=0;const timestamp=at.toISOString();
    const next=records.map(item=>{if(item.state==="pending"&&item.expiresAt<=timestamp){discarded++;return Object.freeze({...item,state:"delivered" as const,responseURL:null})}return item});if(discarded)await this.save(next);return discarded;
  }
  private async load():Promise<{records:StoredRecord[];legacyNonces:Set<string>}>{const [raw,legacy]=await Promise.all([this.storage.getItem(STORE_KEY),this.storage.getItem(LEGACY_NONCE_KEY)]);const records=parseStore(raw),legacyNonces=parseLegacy(legacy);if(records.some(item=>legacyNonces.has(item.nonce)))throw new Error("Wallet authorization callback state conflicts with legacy replay state");return{records,legacyNonces}}
  private async save(records:readonly StoredRecord[]):Promise<void>{const serialized=JSON.stringify({schemaVersion:2,records});if(serialized.length>MAX_STORE_BYTES)throw new Error("Wallet authorization callback storage capacity is exhausted");await this.storage.setItem(STORE_KEY,serialized)}
  private enqueue<T>(operation:()=>Promise<T>):Promise<T>{const result=this.pending.then(operation);this.pending=result.then(()=>undefined,()=>undefined);return result}
}

function binding(request:AuthorizationRequest,account:string):Binding{return Object.freeze({requestDigest:requestDigest(request),nonce:request.nonce,expiresAt:request.expiresAt,account,bundleId:request.bundleId,callback:request.callback})}
function parseStore(raw:string|null):StoredRecord[]{if(raw===null)return[];if(raw.length>MAX_STORE_BYTES)throw new Error("Wallet authorization callback state is too large");let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet authorization callback state is unreadable")}if(!plain(value)||Object.keys(value).sort().join(",")!=="records,schemaVersion"||value.schemaVersion!==2||!Array.isArray(value.records)||value.records.length>MAX_RECORDS)throw new Error("Wallet authorization callback state is invalid");const records=value.records.map(parseStoredRecord);for(let i=1;i<records.length;i++)if(records[i-1]!.requestDigest>=records[i]!.requestDigest||records.slice(0,i).some(item=>item.nonce===records[i]!.nonce))throw new Error("Wallet authorization callback state is not canonical");return records}
function parseStoredRecord(value:unknown):StoredRecord{if(!plain(value)||Object.keys(value).sort().join(",")!=="account,bundleId,callback,expiresAt,nonce,requestDigest,responseURL,state")throw new Error("Wallet authorization callback record is invalid");const bound={requestDigest:value.requestDigest,nonce:value.nonce,expiresAt:value.expiresAt,account:value.account,bundleId:value.bundleId,callback:value.callback};assertBindingShape(bound);if(value.state!=="pending"&&value.state!=="delivered")throw new Error("Wallet authorization callback state is invalid");if(value.state==="pending"){if(typeof value.responseURL!=="string")throw new Error("Wallet pending authorization callback response is missing");assertResponse(value.responseURL,bound.callback)}else if(value.responseURL!==null)throw new Error("Wallet delivered authorization callback must not retain its response");return Object.freeze({...bound,state:value.state,responseURL:value.responseURL}) as StoredRecord}
function parseLegacy(raw:string|null):Set<string>{if(raw===null)return new Set();if(raw.length>512*1024)throw new Error("Wallet legacy authorization replay state is too large");let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet legacy authorization replay state is unreadable")}if(!Array.isArray(value)||value.length>MAX_RECORDS)throw new Error("Wallet legacy authorization replay state is invalid");const result=new Set<string>();let prior="";for(const item of value){if(!Array.isArray(item)||item.length!==2||typeof item[0]!=="string"||!NONCE.test(item[0])||item[0]<=prior||!validTime(item[1]))throw new Error("Wallet legacy authorization replay state is invalid or noncanonical");result.add(item[0]);prior=item[0]}return result}
function assertBinding(value:Binding,at:Date){assertBindingShape(value);if(!(at instanceof Date)||!Number.isFinite(at.getTime())||at.toISOString()>=value.expiresAt)throw new Error("Wallet authorization callback binding is expired")}
function assertBindingShape(value:{requestDigest:unknown;nonce:unknown;expiresAt:unknown;account:unknown;bundleId:unknown;callback:unknown}):asserts value is Binding{if(typeof value.requestDigest!=="string"||!DIGEST.test(value.requestDigest)||typeof value.nonce!=="string"||!NONCE.test(value.nonce)||!validTime(value.expiresAt)||typeof value.account!=="string"||!ACCOUNT.test(value.account)||typeof value.bundleId!=="string"||!BUNDLE.test(value.bundleId)||typeof value.callback!=="string")throw new Error("Wallet authorization callback binding is invalid");let callback:URL;try{callback=new URL(value.callback)}catch{throw new Error("Wallet authorization callback route is invalid")}if(callback.toString()!==value.callback||callback.username||callback.password||callback.port||callback.search||callback.hash||callback.protocol==="http:")throw new Error("Wallet authorization callback route is not canonical")}
function assertResponse(responseURL:string,callback:string){if(responseURL.length>MAX_RESPONSE_URL_BYTES)throw new Error("Wallet authorization callback response is too large");let parsed:URL;try{parsed=new URL(responseURL)}catch{throw new Error("Wallet authorization callback response is invalid")}const keys=[...parsed.searchParams.keys()],response=keys.length===1&&keys[0]==="response"?parsed.searchParams.get("response"):null;if(!response||!/^[A-Za-z0-9_-]+$/.test(response)||responseURL!==`${callback}?response=${response}`)throw new Error("Wallet authorization callback response does not match its registered route")}
function sameBinding(a:Binding,b:Binding){return a.requestDigest===b.requestDigest&&a.nonce===b.nonce&&a.expiresAt===b.expiresAt&&a.account===b.account&&a.bundleId===b.bundleId&&a.callback===b.callback}
function validTime(value:unknown):value is string{if(typeof value!=="string"||!TIME.test(value))return false;const parsed=Date.parse(value);return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value}
function plain(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
