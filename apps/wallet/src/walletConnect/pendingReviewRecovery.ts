import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import type { WalletConnectProposal, WalletConnectRequest } from "./runtime";
import type { WalletConnectRequestReview } from "@ynx-chain/wallet-auth";

const KEY="ynx.wallet.walletconnect.pending-reviews.v1";
type Kind="request"|"proposal";
export type PendingReviewRecord={kind:Kind;key:string;event:any;digest:string;account:string;session:string|null;receivedAt:number;deadline:number;eligible:boolean;state:"undecided"|"decided"|"outcome-unconfirmed";review:WalletConnectRequestReview|null;reviewedAt:number|null};
const failure=(code:string)=>Object.assign(new Error(`${code}: Return to the app for a fresh request; existing Wallet data is retained.`),{code});
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export const pendingReviewKey=(kind:Kind,event:any)=>kind==="request"?`request:${event.topic}:${event.id}`:`proposal:${event.id}`;
const canonical=(value:any):string=>JSON.stringify(value&&typeof value==="object"?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const fingerprint=(kind:Kind,event:any)=>bytesToHex(sha256(utf8ToBytes(canonical(kind==="request"?{id:event.id,topic:event.topic,params:event.params,verifyContext:event.verifyContext}:{id:event.id,params:event.params}))));
export const pendingSessionBinding=(session:any)=>canonical({topic:session.topic,namespaces:session.namespaces,peer:session.peer,expiry:session.expiry});

/** Uses the original platform secure adapter. Neither a password nor a key,
 * signature or executed result is copied into this independent versioned key. */
export class PendingReviewRecovery {
  #queue:Promise<void>=Promise.resolve();
  #quarantined=new Set<string>();
  constructor(private readonly storage:SecureStorageAdapter,private readonly now=()=>Date.now()){}
  #serialize<T>(action:()=>Promise<T>):Promise<T>{const task=this.#queue.then(action);this.#queue=task.then(()=>{},()=>{});return task;}
  async #read():Promise<PendingReviewRecord[]>{
    const raw=await this.storage.getItem(KEY);if(raw===null)return [];
    if(raw.length>1_048_576)throw failure("WALLETCONNECT_RECOVERY_STORAGE_INVALID");
    let value:any;try{value=JSON.parse(raw);}catch{throw failure("WALLETCONNECT_RECOVERY_STORAGE_INVALID");}
    if(![1,2].includes(value?.version)||Object.keys(value).sort().join(",")!==(value.version===2?"quarantined,records,version":"records,version")||!Array.isArray(value.records)||value.records.length>128||value.version===2&&(!Array.isArray(value.quarantined)||value.quarantined.length>128||value.quarantined.some((key:any)=>typeof key!=="string"||!/^(request:[a-f0-9]{64}:[0-9]+|proposal:[0-9]+)$/.test(key))))throw failure("WALLETCONNECT_RECOVERY_STORAGE_INVALID");
    this.#quarantined=new Set(value.quarantined??[]);
    const keys=new Set<string>(),valid:PendingReviewRecord[]=[];
    for(const record of value.records){let accepted=false;try{accepted=Boolean(record&&["request","proposal"].includes(record.kind)&&record.event&&record.key===pendingReviewKey(record.kind,record.event)&&!keys.has(record.key)&&record.digest===fingerprint(record.kind,record.event)&&/^0x[0-9a-fA-F]{40}$/.test(record.account)&&typeof record.eligible==="boolean"&&(record.session===null||typeof record.session==="string")&&Number.isSafeInteger(record.receivedAt)&&Number.isSafeInteger(record.deadline)&&record.deadline>record.receivedAt&&record.deadline<=record.receivedAt+300_000&&["undecided","decided","outcome-unconfirmed"].includes(record.state)&&(record.reviewedAt===null||Number.isSafeInteger(record.reviewedAt))&&(record.review===null||record.review&&typeof record.review.requestDigest==="string"&&Number.isFinite(Date.parse(record.review.expiresAt))&&Date.parse(record.review.expiresAt)<=record.deadline));}catch{}
      if(accepted){keys.add(record.key);valid.push(record);}else{
        // A damaged review with an identifiable ID stays a tombstone. Unrelated
        // fresh IDs can still be reviewed; never manufacture its lost deadline.
        if(typeof record?.key!=="string"||!/^(request:[a-f0-9]{64}:[0-9]+|proposal:[0-9]+)$/.test(record.key))throw failure("WALLETCONNECT_RECOVERY_STORAGE_INVALID");this.#quarantined.add(record.key);
      }
    }
    if(valid.length+this.#quarantined.size>128)throw failure("WALLETCONNECT_RECOVERY_LIMIT");
    return valid.filter(record=>!this.#quarantined.has(record.key));
  }
  async #write(records:PendingReviewRecord[]):Promise<void>{const encoded=JSON.stringify({version:2,records,quarantined:[...this.#quarantined].sort()});if(encoded.length>1_048_576)throw failure("WALLETCONNECT_RECOVERY_LIMIT");await this.storage.setItem(KEY,encoded);if(await this.storage.getItem(KEY)!==encoded)throw failure("WALLETCONNECT_RECOVERY_WRITE_UNCONFIRMED");}
  async reconcilePending(keys:readonly string[]):Promise<void>{return this.#serialize(async()=>{const records=await this.#read(),live=new Set(keys);await this.#write(records.filter(record=>record.deadline>this.now()||live.has(record.key)));});}
  capture(kind:Kind,event:WalletConnectRequest|WalletConnectProposal,account:string,session:string|null,receivedAt:Date,deadline:number,eligible=true):Promise<PendingReviewRecord>{return this.#serialize(async()=>{
    const records=await this.#read(),key=pendingReviewKey(kind,event),digest=fingerprint(kind,event),existing=records.find(record=>record.key===key);
    if(this.#quarantined.has(key))throw failure("WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE");
    if(existing){if(existing.state!=="undecided"||existing.digest!==digest||existing.account!==account||existing.session!==session||existing.deadline<=this.now())throw failure("WALLETCONNECT_REQUEST_ALREADY_DECIDED_OR_CHANGED");return clone(existing);}
    if(records.length+this.#quarantined.size>=128||!Number.isSafeInteger(deadline)||deadline<=this.now()||deadline<=receivedAt.getTime()||deadline>receivedAt.getTime()+300_000||!/^0x[0-9a-fA-F]{40}$/.test(account)||!eligible)throw failure("WALLETCONNECT_REQUEST_RECOVERY_UNAVAILABLE");
    const record:PendingReviewRecord={kind,key,event:clone(event),digest,account,session,receivedAt:receivedAt.getTime(),deadline,eligible,state:"undecided",review:null,reviewedAt:null};records.push(record);await this.#write(records);return clone(record);
  });}
  recover(kind:Kind,sdk:any,account:string,session:string|null):Promise<PendingReviewRecord>{return this.#serialize(async()=>{
    const records=await this.#read(),key=pendingReviewKey(kind,sdk),record=records.find(item=>item.key===key);
    if(!record||record.state!=="undecided"||!record.eligible||record.account!==account||record.session!==session||record.deadline<=this.now()||fingerprint(kind,sdk)!==record.digest)throw failure("WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE");
    // The SDK does not persist proposal verification context. Return only the
    // original context stored on live receipt; never synthesize VALID.
    return clone(record);
  });}
  get(event:WalletConnectRequest):Promise<PendingReviewRecord|null>{return this.#serialize(async()=>{const record=(await this.#read()).find(item=>item.key===pendingReviewKey("request",event));return record?clone(record):null;});}
  remember(event:WalletConnectRequest,review:WalletConnectRequestReview,at:Date,assertCurrent:()=>void):Promise<void>{return this.#update("request",event,record=>{assertCurrent();if(record.state!=="undecided"||record.deadline<=this.now()||Date.parse(review.expiresAt)>record.deadline)throw failure("WALLETCONNECT_REQUEST_EXPIRED");if(record.review&&record.review.requestDigest!==review.requestDigest)throw failure("WALLETCONNECT_REQUEST_ID_CONFLICT");record.review=review;record.reviewedAt=at.getTime();},assertCurrent);}
  decide(kind:Kind,event:any,assertCurrent:()=>void=()=>{}):Promise<void>{return this.#update(kind,event,record=>{assertCurrent();if(record.state!=="undecided"||record.deadline<=this.now())throw failure("WALLETCONNECT_REQUEST_ALREADY_DECIDED_OR_CHANGED");record.state="decided";},assertCurrent);}
  assertDecided(event:WalletConnectRequest):Promise<void>{return this.#serialize(async()=>{const record=(await this.#read()).find(item=>item.key===pendingReviewKey("request",event));if(!record||record.state!=="decided"||record.digest!==fingerprint("request",event))throw failure("WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE");});}
  end(kind:Kind,event:any):Promise<void>{return this.#update(kind,event,record=>{record.state="outcome-unconfirmed";},()=>{},true);}
  #update(kind:Kind,event:any,update:(record:PendingReviewRecord)=>void,assertCurrent:()=>void=()=>{},missingIsCleanup=false):Promise<void>{return this.#serialize(async()=>{const records=await this.#read(),record=records.find(item=>item.key===pendingReviewKey(kind,event));if(!record){if(missingIsCleanup)return;throw failure("WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE");}if(record.digest!==fingerprint(kind,event))throw failure("WALLETCONNECT_REQUEST_ID_CONFLICT");update(record);assertCurrent();await this.#write(records);assertCurrent();});}
}
