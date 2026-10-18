import { digestHex } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import type { ProductSessionReview } from "./productSessionController";

export const AUTHORIZATION_AUDIT_KEY = "ynx.wallet.authorization-audit.v1";
const ACTIONS = new Set(["intent-approved", "approval-returned", "request-rejected", "approval-revoked"]);
const FIELDS = ["schemaVersion", "sequence", "at", "action", "requestDigest", "productClientId", "bundleId", "account", "scopes", "expiresAt", "previousHash", "hash"];
// Original storage handle only: serialize local read/modify/write owners.
// This is not cross-process CAS or a replacement authorization engine.
const mutationQueues=new WeakMap<SecureStorageAdapter,Promise<unknown>>();

export type AuthorizationAuditAction = "intent-approved"|"approval-returned"|"request-rejected"|"approval-revoked";
export type AuthorizationAuditRecord = Readonly<{
  schemaVersion:1;sequence:number;at:string;action:AuthorizationAuditAction;requestDigest:string;productClientId:string;bundleId:string;
  account:string;scopes:readonly string[];expiresAt:string;previousHash:string|null;hash:string;
}>;

export class AuthorizationAuditStore {
  constructor(private readonly storage:SecureStorageAdapter) {}
  private mutation<T>(action:()=>Promise<T>):Promise<T>{
    const prior=mutationQueues.get(this.storage)??Promise.resolve(),pass=prior.then(action,action);mutationQueues.set(this.storage,pass.then(()=>{},()=>{}));return pass;
  }

  async appendProductSession(review:ProductSessionReview, input:{action:AuthorizationAuditAction;account:string;at:string}):Promise<AuthorizationAuditRecord> {
    const request=review.request;
    return this.appendRecord({requestDigest:review.id,productClientId:request.clientId,bundleId:request.applicationId,scopes:request.scopes,expiresAt:request.expiresAt},input);
  }

  private async appendRecord(request:{requestDigest:string;productClientId:string;bundleId:string;scopes:readonly string[];expiresAt:string}, input:{action:AuthorizationAuditAction;account:string;at:string}):Promise<AuthorizationAuditRecord> {
    return this.mutation(async()=>{
    const records=await this.readAll();
    if(records.length>=1000)throw new Error('Wallet authorization audit capacity reached; preserve the original history');
    const unsigned={
      schemaVersion:1 as const,
      sequence:records.length+1,
      at:strictTime(input.at,"audit time"),
      action:strictAction(input.action),
      requestDigest:request.requestDigest,
      productClientId:request.productClientId,
      bundleId:request.bundleId,
      account:strictAccount(input.account),
      scopes:Object.freeze([...request.scopes]),
      expiresAt:strictTime(request.expiresAt,"authorization expiry"),
      previousHash:records.at(-1)?.hash??null,
    };
    const record=freeze({...unsigned,hash:digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned)});
    await this.publish([...records,record]);
    return record;
    });
  }

  async load():Promise<readonly AuthorizationAuditRecord[]> {
    return this.mutation(()=>this.readAll());
  }
  private async publish(records:readonly AuthorizationAuditRecord[]):Promise<void>{
    const text=JSON.stringify(records);await this.storage.setItem(AUTHORIZATION_AUDIT_KEY,text);
    if(await this.storage.getItem(AUTHORIZATION_AUDIT_KEY)!==text)throw new Error('Wallet authorization audit save is unconfirmed; preserve its original storage');
  }
  private async readAll():Promise<readonly AuthorizationAuditRecord[]> {
    const raw=await this.storage.getItem(AUTHORIZATION_AUDIT_KEY);
    if(raw===null)return Object.freeze([]);
    let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet authorization audit is unreadable")}
    if(!Array.isArray(value)||value.length>1000)throw new Error("Wallet authorization audit is invalid");
    const records:AuthorizationAuditRecord[]=[];
    for(let index=0;index<value.length;index++){
      const item=value[index];
      if(!plain(item)||Object.keys(item).sort().join("\n")!==[...FIELDS].sort().join("\n"))throw new Error("Wallet authorization audit schema was tampered");
      const unsigned={schemaVersion:item.schemaVersion,sequence:item.sequence,at:item.at,action:item.action,requestDigest:item.requestDigest,productClientId:item.productClientId,bundleId:item.bundleId,account:item.account,scopes:item.scopes,expiresAt:item.expiresAt,previousHash:item.previousHash};
      if(item.schemaVersion!==1||item.sequence!==index+1||item.previousHash!==(records.at(-1)?.hash??null)||typeof item.hash!=="string"||item.hash!==digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned))throw new Error("Wallet authorization audit hash chain was tampered");
      if(typeof item.requestDigest!=="string"||!/^[0-9a-f]{64}$/.test(item.requestDigest)||typeof item.productClientId!=="string"||typeof item.bundleId!=="string"||!Array.isArray(item.scopes)||item.scopes.some((scope:unknown)=>typeof scope!=="string"))throw new Error("Wallet authorization audit binding is invalid");
      strictTime(item.at,"audit time");strictTime(item.expiresAt,"authorization expiry");strictAction(item.action);strictAccount(item.account);
      records.push(freeze(item));
    }
    return Object.freeze(records);
  }

  async revokedRequestDigests():Promise<readonly string[]> {
    const records=await this.load();
    return Object.freeze([...new Set(records.filter((item)=>item.action==="approval-revoked").map((item)=>item.requestDigest))].sort());
  }

  async revoke(requestDigestValue:string,at:string):Promise<AuthorizationAuditRecord> {
    return this.mutation(async()=>{
    const records=await this.readAll();
    const source=[...records].reverse().find((item)=>item.requestDigest===requestDigestValue&&item.action==="approval-returned");
    if(!source)throw new Error("Approved Wallet authorization was not found");
    if(records.some((item)=>item.requestDigest===requestDigestValue&&item.action==="approval-revoked"))throw new Error("Wallet authorization is already revoked");
    if(records.length>=1000)throw new Error('Wallet authorization audit capacity reached; preserve the original history');
    const unsigned={schemaVersion:1 as const,sequence:records.length+1,at:strictTime(at,"audit time"),action:"approval-revoked" as const,requestDigest:source.requestDigest,productClientId:source.productClientId,bundleId:source.bundleId,account:source.account,scopes:source.scopes,expiresAt:source.expiresAt,previousHash:records.at(-1)?.hash??null};
    const record=freeze({...unsigned,hash:digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned)});
    await this.publish([...records,record]);
    return record;
    });
  }
}

function freeze(value:any):AuthorizationAuditRecord{return Object.freeze({...value,scopes:Object.freeze([...value.scopes])})}
function plain(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
function strictAction(value:unknown):AuthorizationAuditAction{if(typeof value!=="string"||!ACTIONS.has(value))throw new Error("Wallet authorization audit action is invalid");return value as AuthorizationAuditAction}
function strictAccount(value:unknown):string{if(typeof value!=="string"||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value))throw new Error("Wallet authorization audit account is invalid");return value}
function strictTime(value:unknown,label:string):string{if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)||new Date(value).toISOString()!==value)throw new Error(`${label} is invalid`);return value}
