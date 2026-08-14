import { digestHex, requestDigest, type AuthorizationRequest } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";

export const AUTHORIZATION_AUDIT_KEY = "ynx.wallet.authorization-audit.v1";
const MAX_AUDIT_RECORDS=1000;
const MAX_AUDIT_BYTES=1024*1024;
const ACTIONS = new Set(["intent-approved", "approval-returned", "request-rejected", "approval-revoked"]);
const FIELDS = ["schemaVersion", "sequence", "at", "action", "requestDigest", "productClientId", "bundleId", "account", "scopes", "expiresAt", "previousHash", "hash"];

export type AuthorizationAuditAction = "intent-approved"|"approval-returned"|"request-rejected"|"approval-revoked";
export type AuthorizationAuditRecord = Readonly<{
  schemaVersion:1;sequence:number;at:string;action:AuthorizationAuditAction;requestDigest:string;productClientId:string;bundleId:string;
  account:string;scopes:readonly string[];expiresAt:string;previousHash:string|null;hash:string;
}>;

export class AuthorizationAuditStore {
  private pending:Promise<void>=Promise.resolve();
  constructor(private readonly storage:SecureStorageAdapter) {}

  async append(request:AuthorizationRequest, input:{action:AuthorizationAuditAction;account:string;at:string}, assertActive:()=>void=()=>{}):Promise<AuthorizationAuditRecord> {
    return this.enqueue(()=>this.appendExclusive(request,input,assertActive));
  }

  private async appendExclusive(request:AuthorizationRequest, input:{action:AuthorizationAuditAction;account:string;at:string}, assertActive:()=>void):Promise<AuthorizationAuditRecord> {
    const records=await this.load();
    if(records.length>=MAX_AUDIT_RECORDS)throw new Error("Wallet authorization audit capacity is exhausted");
    const action=strictAction(input.action),digest=requestDigest(request),account=strictAccount(input.account);
    assertDecisionTransition(records,digest,action,account);
    const unsigned={
      schemaVersion:1 as const,
      sequence:records.length+1,
      at:strictTime(input.at,"audit time"),
      action,
      requestDigest:digest,
      productClientId:request.productClientId,
      bundleId:request.bundleId,
      account,
      scopes:Object.freeze([...request.scopes]),
      expiresAt:strictTime(request.expiresAt,"authorization expiry"),
      previousHash:records.at(-1)?.hash??null,
    };
    const record=freeze({...unsigned,hash:digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned)});
    assertActive();
    await this.save([...records,record]);
    return record;
  }

  async load():Promise<readonly AuthorizationAuditRecord[]> {
    const raw=await this.storage.getItem(AUTHORIZATION_AUDIT_KEY);
    if(raw===null)return Object.freeze([]);
    if(raw.length>MAX_AUDIT_BYTES)throw new Error("Wallet authorization audit is too large");
    let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet authorization audit is unreadable")}
    if(!Array.isArray(value)||value.length>MAX_AUDIT_RECORDS)throw new Error("Wallet authorization audit is invalid");
    const records:AuthorizationAuditRecord[]=[];
    for(let index=0;index<value.length;index++){
      const item=value[index];
      if(!plain(item)||Object.keys(item).sort().join("\n")!==[...FIELDS].sort().join("\n"))throw new Error("Wallet authorization audit schema was tampered");
      const unsigned={schemaVersion:item.schemaVersion,sequence:item.sequence,at:item.at,action:item.action,requestDigest:item.requestDigest,productClientId:item.productClientId,bundleId:item.bundleId,account:item.account,scopes:item.scopes,expiresAt:item.expiresAt,previousHash:item.previousHash};
      if(item.schemaVersion!==1||item.sequence!==index+1||item.previousHash!==(records.at(-1)?.hash??null)||typeof item.hash!=="string"||item.hash!==digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned))throw new Error("Wallet authorization audit hash chain was tampered");
      if(typeof item.requestDigest!=="string"||!/^[0-9a-f]{64}$/.test(item.requestDigest)||typeof item.productClientId!=="string"||typeof item.bundleId!=="string"||!Array.isArray(item.scopes)||item.scopes.some((scope:unknown)=>typeof scope!=="string"))throw new Error("Wallet authorization audit binding is invalid");
      strictTime(item.at,"audit time");strictTime(item.expiresAt,"authorization expiry");strictAction(item.action);strictAccount(item.account);
      const record=freeze(item);assertStoredTransition(records,record);records.push(record);
    }
    return Object.freeze(records);
  }

  async revokedRequestDigests():Promise<readonly string[]> {
    const records=await this.load();
    return Object.freeze([...new Set(records.filter((item)=>item.action==="approval-revoked").map((item)=>item.requestDigest))].sort());
  }

  async revoke(requestDigestValue:string,at:string,assertActive:()=>void=()=>{}):Promise<AuthorizationAuditRecord> {
    return this.enqueue(()=>this.revokeExclusive(requestDigestValue,at,assertActive));
  }

  private async revokeExclusive(requestDigestValue:string,at:string,assertActive:()=>void):Promise<AuthorizationAuditRecord> {
    const records=await this.load();
    if(records.length>=MAX_AUDIT_RECORDS)throw new Error("Wallet authorization audit capacity is exhausted");
    const source=[...records].reverse().find((item)=>item.requestDigest===requestDigestValue&&item.action==="approval-returned");
    if(!source)throw new Error("Approved Wallet authorization was not found");
    if(records.some((item)=>item.requestDigest===requestDigestValue&&item.action==="approval-revoked"))throw new Error("Wallet authorization is already revoked");
    const unsigned={schemaVersion:1 as const,sequence:records.length+1,at:strictTime(at,"audit time"),action:"approval-revoked" as const,requestDigest:source.requestDigest,productClientId:source.productClientId,bundleId:source.bundleId,account:source.account,scopes:source.scopes,expiresAt:source.expiresAt,previousHash:records.at(-1)?.hash??null};
    const record=freeze({...unsigned,hash:digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned)});
    assertActive();
    await this.save([...records,record]);
    return record;
  }

  private async save(records:readonly AuthorizationAuditRecord[]):Promise<void>{
    if(records.length>MAX_AUDIT_RECORDS)throw new Error("Wallet authorization audit capacity is exhausted");
    const serialized=JSON.stringify(records);
    if(serialized.length>MAX_AUDIT_BYTES)throw new Error("Wallet authorization audit capacity is exhausted");
    await this.storage.setItem(AUTHORIZATION_AUDIT_KEY,serialized);
  }

  private enqueue<T>(operation:()=>Promise<T>):Promise<T>{
    const result=this.pending.then(operation);
    this.pending=result.then(()=>undefined,()=>undefined);
    return result;
  }
}

function freeze(value:any):AuthorizationAuditRecord{return Object.freeze({...value,scopes:Object.freeze([...value.scopes])})}
function plain(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
function strictAction(value:unknown):AuthorizationAuditAction{if(typeof value!=="string"||!ACTIONS.has(value))throw new Error("Wallet authorization audit action is invalid");return value as AuthorizationAuditAction}
function strictAccount(value:unknown):string{if(typeof value!=="string"||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value))throw new Error("Wallet authorization audit account is invalid");return value}
function strictTime(value:unknown,label:string):string{if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)||new Date(value).toISOString()!==value)throw new Error(`${label} is invalid`);return value}
function assertDecisionTransition(records:readonly AuthorizationAuditRecord[],digest:string,action:AuthorizationAuditAction,account:string):void{
  const decisions=records.filter(record=>record.requestDigest===digest);
  if(action==="approval-revoked")throw new Error("Wallet authorization revocation must use the verified revoke operation");
  if(action==="intent-approved"||action==="request-rejected"){
    if(decisions.some(record=>record.action==="intent-approved"||record.action==="approval-returned"||record.action==="request-rejected"))throw new Error("Wallet authorization request is already decided");
    return;
  }
  const intent=decisions.find(record=>record.action==="intent-approved");
  if(!intent)throw new Error("Wallet authorization approval intent was not recorded");
  if(intent.account!==account)throw new Error("Wallet authorization callback account differs from its approval intent");
  if(decisions.some(record=>record.action==="request-rejected"))throw new Error("Wallet authorization request was rejected");
  if(decisions.some(record=>record.action==="approval-returned"))throw new Error("Wallet authorization callback was already returned");
}
function assertStoredTransition(records:readonly AuthorizationAuditRecord[],record:AuthorizationAuditRecord):void{
  const prior=records.filter(item=>item.requestDigest===record.requestDigest);
  if(record.action==="intent-approved"||record.action==="request-rejected"){
    if(prior.some(item=>item.action==="intent-approved"||item.action==="approval-returned"||item.action==="request-rejected"))throw new Error("Wallet authorization audit contains conflicting decisions");
    return;
  }
  if(record.action==="approval-returned"){
    const intent=prior.find(item=>item.action==="intent-approved");
    if(!intent)throw new Error("Wallet authorization audit callback has no approval intent");
    if(intent.account!==record.account)throw new Error("Wallet authorization audit callback account differs from its approval intent");
    if(prior.some(item=>item.action==="request-rejected"||item.action==="approval-returned"))throw new Error("Wallet authorization audit callback transition is invalid");
    return;
  }
  const returned=prior.find(item=>item.action==="approval-returned");
  if(!returned)throw new Error("Wallet authorization audit revocation has no returned approval");
  if(returned.account!==record.account)throw new Error("Wallet authorization audit revocation account differs from its approval");
  if(prior.some(item=>item.action==="approval-revoked"))throw new Error("Wallet authorization audit contains duplicate revocation");
}
