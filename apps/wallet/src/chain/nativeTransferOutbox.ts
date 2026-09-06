import { evmAddressFromYNX, nativeTransferHash, parseSignedNativeTransfer, type SignedNativeTransfer } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import { NativeChainClient, verifyNativeDurability, type NativeDurabilityVerifier, type BroadcastResult } from "./nativeTransfer";

export const NATIVE_OUTBOX_PREFIX="ynx.wallet.native-outbox.v1.";
export type NativeTransferOutboxEntry=Readonly<{
  version:1;account:string;origin:string;payload:string;hash:string;transaction:SignedNativeTransfer;
  phase:"prepared"|"unknown"|"observed"|"accepted"|"done";
  attempts:number;createdAt:string;updatedAt:string;replayed:boolean|null;
  durabilityEvidence:Readonly<Record<string,unknown>>|null;
}>;
export type NativeTransferPrepared=Readonly<{payload:string;hash:string;transaction:SignedNativeTransfer}>;
type Guard=()=>void;
const queues=new WeakMap<SecureStorageAdapter,Promise<unknown>>();
export class NativeOutboxBlocked extends Error {readonly code="NATIVE_OUTBOX_BLOCKED";constructor(){super("A stored transfer needs your review before this account can sign another transfer.")}}
export class NativeOutboxStorageError extends Error {readonly code="NATIVE_OUTBOX_STORAGE_FAILED";constructor(){super("The transfer record could not be stored and verified. Sending is paused. Reopen the stored transfer to check its state.")}}

/** Contains signed public wire bytes, never account keys. The ordinary SecureStore
 * namespace keeps this available for review after key invalidation or Wallet lock.
 * No request starts before its exact bytes and dispatch marker have been read back.
 * Process death after that marker is conservatively an unknown dispatch. */
export class NativeTransferOutbox {
  constructor(private readonly storage:SecureStorageAdapter,private readonly now:()=>Date=()=>new Date(),private readonly verifyDurability:NativeDurabilityVerifier=verifyNativeDurability){}
  read(account:string):Promise<NativeTransferOutboxEntry|null>{return this.serial(()=>this.load(account))}
  async sendNew(account:string,client:NativeChainClient,assertCurrent:Guard,prepare:()=>Promise<NativeTransferPrepared>):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      assertCurrent();const existing=await this.load(account);assertCurrent();
      if(existing&&existing.phase!=="done")throw new NativeOutboxBlocked();
      const signed=await prepare();assertCurrent();
      const time=this.now().toISOString();
      const record=parse({version:1,account,origin:client.origin,...signed,phase:"prepared",attempts:0,createdAt:time,updatedAt:time,replayed:null,durabilityEvidence:null},account,this.verifyDurability);
      await this.save(record);assertCurrent();
      return this.dispatch(record,client,assertCurrent);
    });
  }
  async retry(account:string,reviewedHash:string,client:NativeChainClient,assertCurrent:Guard,authorize:()=>Promise<void>):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      assertCurrent();const record=await this.load(account);assertCurrent();
      if(!record||record.hash!==reviewedHash||record.phase==="done"||record.phase==="accepted")throw new NativeOutboxBlocked();
      if(record.origin!==client.origin)throw new Error("The stored transfer belongs to a different RPC origin. Restore that origin before retrying.");
      await authorize();assertCurrent();
      // No nonce lookup, account-secret read, or signing call exists on this path.
      return this.dispatch(record,client,assertCurrent);
    });
  }
  async acknowledge(account:string,reviewedHash:string,assertCurrent:Guard):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      assertCurrent();const record=await this.load(account);assertCurrent();
      if(!record||record.hash!==reviewedHash||record.phase!=="accepted")throw new NativeOutboxBlocked();
      const done=parse({...record,phase:"done",updatedAt:this.now().toISOString()},account,this.verifyDurability);
      await this.save(done);return done;
    });
  }
  private async dispatch(record:NativeTransferOutboxEntry,client:NativeChainClient,assertCurrent:Guard):Promise<NativeTransferOutboxEntry>{
    assertCurrent();
    const dispatch=parse({...record,phase:"unknown",attempts:record.attempts+1,updatedAt:this.now().toISOString()},record.account,this.verifyDurability);
    await this.save(dispatch);assertCurrent();
    // From this point on, lifecycle cancellation must not erase a real network
    // result. UI owners check their lease separately before updating a screen.
    let result:BroadcastResult;
    try{result=await client.broadcast(dispatch.payload,dispatch.transaction,dispatch.hash)}catch{return dispatch}
    const outcome=parse({...dispatch,phase:result.durabilityConfirmed?"accepted":"observed",replayed:result.replayed,durabilityEvidence:result.durabilityEvidence,updatedAt:this.now().toISOString()},record.account,this.verifyDurability);
    await this.save(outcome);
    return outcome;
  }
  private async load(account:string):Promise<NativeTransferOutboxEntry|null>{
    try{const raw=await this.storage.getItem(key(account));if(raw===null)return null;if(raw.length>8192)throw new Error();return parse(JSON.parse(raw),account,this.verifyDurability)}catch{throw new NativeOutboxStorageError()}
  }
  private async save(record:NativeTransferOutboxEntry):Promise<void>{
    const encoded=JSON.stringify(record),storageKey=key(record.account);
    try{if(encoded.length>8192)throw new Error();await this.storage.setItem(storageKey,encoded);const readback=await this.storage.getItem(storageKey);if(readback!==encoded)throw new Error();parse(JSON.parse(readback),record.account,this.verifyDurability)}catch{throw new NativeOutboxStorageError()}
  }
  private serial<T>(work:()=>Promise<T>):Promise<T>{const pending=(queues.get(this.storage)??Promise.resolve()).catch(()=>{}).then(work);queues.set(this.storage,pending);return pending}
}

function key(account:string):string{evmAddressFromYNX(account);return NATIVE_OUTBOX_PREFIX+account}
function parse(value:any,account:string,verifyDurability:NativeDurabilityVerifier):NativeTransferOutboxEntry{
  const fields=["version","account","origin","payload","hash","transaction","phase","attempts","createdAt","updatedAt","replayed","durabilityEvidence"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(field=>!Object.prototype.hasOwnProperty.call(value,field))||value.version!==1||value.account!==account||typeof value.payload!=="string"||value.payload.length>2048||typeof value.origin!=="string"||!["prepared","unknown","observed","accepted","done"].includes(value.phase)||!Number.isSafeInteger(value.attempts)||value.attempts<0||value.attempts>1000000||!(value.replayed===null||typeof value.replayed==="boolean"))throw new Error("Invalid stored native transfer");
  const origin=new NativeChainClient(value.origin).origin;if(origin!==value.origin)throw new Error("Invalid stored native origin");
  for(const time of [value.createdAt,value.updatedAt])if(typeof time!=="string"||time.length!==24||!Number.isFinite(Date.parse(time))||new Date(time).toISOString()!==time)throw new Error("Invalid stored native transfer time");
  const transaction=parseSignedNativeTransfer(value.payload);
  if(transaction.from!==evmAddressFromYNX(account)||JSON.stringify(transaction)!==JSON.stringify(value.transaction)||nativeTransferHash(value.payload)!==value.hash||!Number.isSafeInteger(transaction.amount+transaction.fee))throw new Error("Stored native transfer identity does not match");
  if(value.phase==="prepared"&&(value.attempts!==0||value.replayed!==null)||value.phase!=="prepared"&&value.attempts===0||["observed","accepted","done"].includes(value.phase)&&typeof value.replayed!=="boolean")throw new Error("Invalid stored native transfer state");
  if(value.durabilityEvidence!==null&&(typeof value.durabilityEvidence!=="object"||Array.isArray(value.durabilityEvidence)))throw new Error("Invalid stored durability evidence");
  if(value.phase==="accepted"||value.phase==="done"){
    // Never trust a persisted phase bit. Recheck the exact checkpoint against the
    // signed original after restart and again before explicit acknowledgement.
    let verified=false;try{verified=value.durabilityEvidence!==null&&verifyDurability(value.durabilityEvidence,transaction,value.hash)===true}catch{}
    if(!verified)return Object.freeze({...value,transaction,phase:"observed",durabilityEvidence:null});
  }
  return Object.freeze({...value,transaction});
}
