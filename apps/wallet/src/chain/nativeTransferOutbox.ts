import { evmAddressFromYNX, ynxAddressFromEVM, nativeTransferHash, parseSignedNativeTransfer, type SignedNativeTransfer } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import { NativeChainClient, type BroadcastResult } from "./nativeTransfer";
import { verifyNativeDurability } from "./nativeDurability";

export const NATIVE_OUTBOX_PREFIX="ynx.wallet.native-outbox.v1.";
export const NATIVE_HISTORY_PREFIX="ynx.wallet.native-history.v1.";
/** Published Android archives must remain readable without rewriting their bytes. */
export const NATIVE_OUTBOX_HISTORY_PREFIX="ynx.wallet.native-outbox-history.v1.";
const HISTORY_HEAD_PREFIX="ynx.wallet.native-history-head.v1.";
const HISTORY_NODE_PREFIX="ynx.wallet.native-history-node.v1.";
export const NATIVE_PREPARATION_PREFIX="ynx.wallet.native-preparation.v1.";
type PreparationMarker=Readonly<{version:1;account:string;origin:string;createdAt:string;previousHash:string|null;phase:"preparing"|"unsigned_failed"|"signed"|"signed_failed";hash:string|null}>;
export type NativeTransferOutboxEntry=Readonly<{
  version:1;account:string;origin:string;payload:string;hash:string;transaction:SignedNativeTransfer;
  phase:"prepared"|"unknown"|"observed"|"accepted"|"done"|"pending_durable"|"uncertain"|"memory_only"|"not_found"|"unsupported";
  attempts:number;createdAt:string;updatedAt:string;replayed:boolean|null;
  durabilityEvidence:Readonly<Record<string,unknown>>|null;
  localRetention?:PublicOperationRetention;
}>;
export type PublicOperationCause=Readonly<{name:string;code:string|null;message:string}>;
export type PublicOperationRetention=Readonly<{scope:"operation-memory";durable:false;originalCause:PublicOperationCause|null;storageCause:PublicOperationCause|null}>;
export function publicOperationCause(error:unknown):PublicOperationCause|null{
  if(error===null||error===undefined)return null;
  if(error instanceof NativePreparationFailure)return publicOperationCause(error.failure);
  const e=error as {name?:unknown;code?:unknown;message?:unknown};
  return Object.freeze({name:typeof e.name==="string"?e.name.slice(0,128):"Error",code:typeof e.code==="string"?e.code.slice(0,128):null,message:typeof e.message==="string"?e.message.slice(0,2048):"Operation failed"});
}
export const PUBLIC_OPERATION_RETENTION_LIMIT=8;
type PublicNativeSlot={original:NativeTransferOutboxEntry|null;originalCause:unknown;storageCause:unknown};
const publicOriginals=new WeakMap<SecureStorageAdapter,Map<string,PublicNativeSlot>>();
function ownerOriginals(storage:SecureStorageAdapter){let entries=publicOriginals.get(storage);if(!entries){entries=new Map();publicOriginals.set(storage,entries)}return entries}
export type NativeTransferPrepared=Readonly<{payload:string;hash:string;transaction:SignedNativeTransfer}>;
export type NativeTransferResolution=Readonly<{version:1;account:string;origin:string;payload:string;hash:string;transaction:SignedNativeTransfer;resolvedAt:string;durabilityEvidence:Readonly<Record<string,unknown>>}>;
export type NativeTransferHistoryRecord=Readonly<{account:string;origin:string;hash:string;to:string;amount:number;fee:number;nonce:number;createdAt:string;verifiedAt:string;blockNumber:string;scope:"local-snapshot";consensusFinality:false}>;
export type NativeTransferHistory=Readonly<{records:readonly NativeTransferHistoryRecord[];nextCursor:string|null}>;
type Guard=()=>void;
const queues=new WeakMap<SecureStorageAdapter,Promise<unknown>>();
export class NativeOutboxBlocked extends Error {readonly code="NATIVE_OUTBOX_BLOCKED";constructor(){super("A stored transfer needs your review before this account can sign another transfer.")}}
export class NativeOutboxStorageError extends Error {readonly code="NATIVE_OUTBOX_STORAGE_FAILED";constructor(readonly retainedOriginal:NativeTransferPrepared|null=null,readonly storageCause:unknown=null,readonly originalCause:unknown=null){super("The transfer record could not be stored and verified. Sending is paused. Reopen the stored transfer to check its state.")}}
/** Local handoff of public signed bytes, not a signing/broadcast capability. */
export class NativePreparationFailure extends Error {
  readonly signed:NativeTransferPrepared|null;
  readonly code:string;
  constructor(readonly failure:unknown,signed:NativeTransferPrepared|null){
    super(failure instanceof Error?failure.message:"Native preparation failed");
    this.name="NativePreparationFailure";
    this.code=typeof (failure as {code?:unknown})?.code==="string"?(failure as {code:string}).code:"NATIVE_PREPARATION_FAILED";
    this.signed=signed?Object.freeze({payload:signed.payload,hash:signed.hash,transaction:parseSignedNativeTransfer(signed.payload)}):null;
    if(this.signed&&nativeTransferHash(this.signed.payload)!==this.signed.hash)throw new NativeOutboxStorageError();
  }
}
export class NativeSigningResultUnknown extends Error {
  readonly code="NATIVE_SIGNING_RESULT_UNKNOWN";
  constructor(readonly preparation:PreparationMarker){super("An interrupted signing operation requires review. Its result is unknown; do not sign or send a replacement.")}
}

/** Contains signed public wire bytes, never account keys. The ordinary SecureStore
 * namespace keeps this available for review after key invalidation or Wallet lock.
 * No request starts before its exact bytes and dispatch marker have been read back.
 * Process death after that marker is conservatively an unknown dispatch. */
export class NativeTransferOutbox {
  constructor(private readonly storage:SecureStorageAdapter,private readonly now:()=>Date=()=>new Date()){}
  read(account:string):Promise<NativeTransferOutboxEntry|null>{return this.serial(async()=>this.localOriginal(account)??this.load(account))}
  private localOriginal(account:string):NativeTransferOutboxEntry|null{
    key(account);const held=ownerOriginals(this.storage).get(account);if(!held?.original)return null;
    return Object.freeze({...held.original,localRetention:Object.freeze({scope:"operation-memory",durable:false,originalCause:publicOperationCause(held.originalCause),storageCause:publicOperationCause(held.storageCause)})});
  }
  private assertNoLocalOperation(account:string){if(ownerOriginals(this.storage).has(account))throw new NativeOutboxBlocked()}
  /** A separately verified Pay journal may inspect an exact historical hash.
   * Missing bytes here never clear the signing barrier or authorize dispatch. */
  readOriginal(account:string,reviewedHash:string):Promise<NativeTransferOutboxEntry|null>{return this.serial(async()=>{
    historyKey(account,reviewedHash);return this.localOriginal(account)??this.load(account,true);
  })}
  /** Known-hash lookup, not an enumeration claim: SecureStore has no key listing.
   * Both archive generations are signature/checkpoint verified, read-only. */
  resolution(account:string,hash:string):Promise<NativeTransferResolution|null>{return this.serial(async()=>{
    try{
      const currentKey=historyKey(account,hash);
      const legacyRaw=await this.storage.getItem(NATIVE_OUTBOX_HISTORY_PREFIX+account+"."+hash);
      const currentRaw=await this.storage.getItem(currentKey);
      const legacy=legacyRaw===null?null:parseResolution(legacyRaw,account,hash);
      const current=currentRaw===null?null:resolutionFromRecord(parseHistoryRecord(currentRaw,account,hash));
      if(legacy&&current&&(legacy.origin!==current.origin||legacy.payload!==current.payload))throw new Error();
      return legacy??current;
    }catch{throw new NativeOutboxStorageError()}
  })}
  /** Published reopen API, public original-hash reads only. Unlike the old
   * release, recovery NEVER auto-Dones an accepted Pay/transfer or frees it. */
  recover(account:string,client:NativeChainClient,assertCurrent:Guard):Promise<NativeTransferOutboxEntry|null>{return this.serial(async()=>{
    assertCurrent();const held=this.localOriginal(account);if(held)return held;const record=await this.load(account);assertCurrent();
    if(!record||record.phase==="done")return record;
    return this.checkLoadedStatus(record,client);
  })}
  /** Explicit recovery of public ORIGINAL bytes retained by the Pay journal if
   * process death happened between the two storage writes. Missing outbox never
   * proves non-submission: restore uncertain, not new/unsent, and never POST. */
  retainUnknown(account:string,origin:string,signed:NativeTransferPrepared,createdAt:string,assertCurrent:Guard):Promise<NativeTransferOutboxEntry>{return this.serial(async()=>{
    assertCurrent();const existing=await this.load(account,true);assertCurrent();
    const pending=await this.storage.getItem(NATIVE_PREPARATION_PREFIX+account);assertCurrent();
    if(pending!==null){const marker=parsePreparation(pending,account);if(marker.phase!=="unsigned_failed"&&(!["signed","signed_failed"].includes(marker.phase)||marker.hash!==signed.hash||marker.origin!==origin))throw new NativeSigningResultUnknown(marker)}
    if(existing){if(existing.payload!==signed.payload||existing.hash!==signed.hash||existing.origin!==origin)throw new NativeOutboxBlocked();return existing}
    const recovered=parse({version:1,account,origin,...signed,phase:"uncertain",attempts:0,createdAt,updatedAt:this.now().toISOString(),replayed:null,durabilityEvidence:null},account);
    let archived:string|null;
    try{archived=await this.storage.getItem(historyKey(account,signed.hash));assertCurrent()}catch{assertCurrent();throw new NativeOutboxStorageError()}
    if(archived!==null){
      const done=parseHistoryRecord(archived,account,signed.hash);
      if(done.payload!==signed.payload||done.origin!==origin)throw new NativeOutboxBlocked();
      await this.save(done);assertCurrent();return done;
    }
    await this.save(recovered);assertCurrent();return recovered;
  })}
  /** Account-bound history revalidates each saved signed original and checkpoint,
   * but returns public display fields only. An older version's last Done record
   * is retained before paging or before the next transfer can overwrite it. */
  history(account:string,assertCurrent:Guard,cursor:string|null=null,limit=20):Promise<NativeTransferHistory>{return this.serial(async()=>{
    key(account);assertCurrent();if(!Number.isInteger(limit)||limit<1||limit>50)throw new NativeOutboxStorageError();
    if(cursor===null){const latest=await this.load(account);assertCurrent();if(latest?.phase==="done")await this.archive(latest,assertCurrent)}
    const records:NativeTransferHistoryRecord[]=[],seen=new Set<string>();
    try{
      let hash=cursor??await this.storage.getItem(HISTORY_HEAD_PREFIX+account);assertCurrent();
      while(hash!==null&&records.length<limit){
        historyKey(account,hash);if(seen.has(hash))throw new Error();seen.add(hash);
        const node=await this.storage.getItem(HISTORY_NODE_PREFIX+account+"."+hash);assertCurrent();if(node===null)throw new Error();
        const previous=parseHistoryNode(node,account,hash);
        const raw=await this.storage.getItem(historyKey(account,hash));assertCurrent();if(raw===null)throw new Error();
        const record=parseHistoryRecord(raw,account,hash),receipt=record.durabilityEvidence!.receipt as Record<string,unknown>;
        records.push(Object.freeze({account,origin:record.origin,hash,to:ynxAddressFromEVM(record.transaction.to),amount:record.transaction.amount,fee:record.transaction.fee,nonce:record.transaction.nonce,createdAt:record.createdAt,verifiedAt:record.updatedAt,blockNumber:String(receipt.blockNumber),scope:"local-snapshot",consensusFinality:false}));
        hash=previous;
      }
      if(hash!==null&&seen.has(hash))throw new Error();
      return Object.freeze({records:Object.freeze(records),nextCursor:hash});
    }catch{assertCurrent();throw new NativeOutboxStorageError()}
  })}
  async sendNew(account:string,client:NativeChainClient,assertCurrent:Guard,prepare:()=>Promise<NativeTransferPrepared>,beforeBroadcast?:()=>Promise<void>):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      this.assertNoLocalOperation(account);
      assertCurrent();const existing=await this.load(account);assertCurrent();
      if(existing&&existing.phase!=="done")throw new NativeOutboxBlocked();
      if(existing)await this.archive(existing,assertCurrent);
      await client.requireDurabilityCapability();assertCurrent();
      const owner=ownerOriginals(this.storage);
      if(owner.size>=PUBLIC_OPERATION_RETENTION_LIMIT)throw new NativeOutboxBlocked();
      const slot:PublicNativeSlot={original:null,originalCause:null,storageCause:null};owner.set(account,slot);
      try{
      const time=this.now().toISOString();
      const marker:PreparationMarker=Object.freeze({version:1,account,origin:client.origin,createdAt:time,previousHash:existing?.hash??null,phase:"preparing",hash:null});
      // Verified durable intent MUST precede the opaque preparation callback.
      // Death or an unclassified callback failure is not proof of no signature.
      await this.savePreparation(marker);
      try{assertCurrent()}catch(error){await this.savePreparation({...marker,phase:"unsigned_failed"});throw error}
      let signed:NativeTransferPrepared;
      try{signed=await prepare()}catch(error){
        if(error instanceof NativePreparationFailure){
          if(error.signed){
            if(existing?.hash===error.signed.hash){slot.original=existing;slot.originalCause=error.failure;await this.savePreparation({...marker,phase:"signed",hash:existing.hash});owner.delete(account);throw error}
            const original=parse({version:1,account,origin:client.origin,...error.signed,phase:"prepared",attempts:0,createdAt:time,updatedAt:this.now().toISOString(),replayed:null,durabilityEvidence:null},account);
            slot.original=original;slot.originalCause=error.failure;
            await this.savePreparation({...marker,phase:"signed_failed",hash:original.hash});
            await this.save(original);
            owner.delete(account);
          }else await this.savePreparation({...marker,phase:"unsigned_failed"});
        }
        throw error;
      }
      const record=parse({version:1,account,origin:client.origin,...signed,phase:"prepared",attempts:0,createdAt:time,updatedAt:time,replayed:null,durabilityEvidence:null},account);
      slot.original=record;
      if(existing?.hash===record.hash){slot.original=existing;await this.savePreparation({...marker,phase:"signed",hash:existing.hash});owner.delete(account);throw new NativeOutboxBlocked()}
      // Saving a produced public result is independent of the secret lease.
      // Current authority remains mandatory before ANY outward effect.
      await this.savePreparation({...marker,phase:"signed",hash:record.hash});
      await this.save(record);owner.delete(account);assertCurrent();
      return this.dispatch(record,client,assertCurrent,true,beforeBroadcast);
      }catch(error){
        if(slot.original&&owner.get(account)===slot){slot.storageCause=error instanceof NativeOutboxStorageError?error.storageCause??error:error;throw new NativeOutboxStorageError(slot.original,slot.storageCause,slot.originalCause)}
        if(!slot.original)owner.delete(account);
        throw error;
      }
    });
  }
  async checkStatus(account:string,reviewedHash:string,client:NativeChainClient,assertCurrent:Guard):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      assertCurrent();const held=this.localOriginal(account);if(held){if(held.hash!==reviewedHash||held.origin!==client.origin)throw new NativeOutboxBlocked();return held}
      assertCurrent();const record=await this.load(account);assertCurrent();
      if(!record||record.hash!==reviewedHash||record.phase==="done")throw new NativeOutboxBlocked();
      return this.checkLoadedStatus(record,client);
    });
  }
  private async checkLoadedStatus(record:NativeTransferOutboxEntry,client:NativeChainClient):Promise<NativeTransferOutboxEntry>{
    if(record.origin!==client.origin)throw new Error("The stored transfer belongs to a different RPC origin. Restore that origin before checking its status.");
    // A revalidated retained checkpoint is monotonic evidence, not finality.
    // A later missing/changed node must not demote it and enable a resend.
    if(record.phase==="accepted")return record;
    const result=await client.checkTransferDurability(record.transaction,record.hash);
    // Preserve public network facts after cancellation; never use keys or POST.
    const checked=parse({...record,phase:result.status==="durable"?"accepted":result.status,durabilityEvidence:result.evidence,updatedAt:this.now().toISOString()},record.account);
    await this.save(checked);return checked;
  }
  async retry(account:string,reviewedHash:string,client:NativeChainClient,assertCurrent:Guard,authorize:()=>Promise<void>):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      this.assertNoLocalOperation(account);
      assertCurrent();const record=await this.load(account);assertCurrent();
      if(!record||record.hash!==reviewedHash||record.phase==="done"||record.phase==="accepted")throw new NativeOutboxBlocked();
      if(record.origin!==client.origin)throw new Error("The stored transfer belongs to a different RPC origin. Restore that origin before retrying.");
      const pending=await this.storage.getItem(NATIVE_PREPARATION_PREFIX+account);assertCurrent();
      if(pending!==null&&parsePreparation(pending,account).phase==="signed_failed")throw new NativeOutboxBlocked();
      await authorize();assertCurrent();
      // No nonce lookup, account-secret read, or signing call exists on this path.
      return this.dispatch(record,client,assertCurrent);
    });
  }
  async acknowledge(account:string,reviewedHash:string,assertCurrent:Guard):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      this.assertNoLocalOperation(account);
      assertCurrent();const record=await this.load(account);assertCurrent();
      if(!record||record.hash!==reviewedHash||record.phase!=="accepted")throw new NativeOutboxBlocked();
      await this.archive(record,assertCurrent);assertCurrent();
      const done=parse({...record,phase:"done",updatedAt:this.now().toISOString()},account);
      await this.save(done);return done;
    });
  }
  private async dispatch(record:NativeTransferOutboxEntry,client:NativeChainClient,assertCurrent:Guard,requireNewSendCapability=false,beforeBroadcast?:()=>Promise<void>):Promise<NativeTransferOutboxEntry>{
    assertCurrent();
    const dispatch=parse({...record,phase:"unknown",attempts:record.attempts+1,durabilityEvidence:null,updatedAt:this.now().toISOString()},record.account);
    await this.save(dispatch);assertCurrent();
    // The final storage await can span a node replacement. New sends must
    // recheck after its exact readback, immediately before the outward effect.
    // Failure leaves the conservative marker and original bytes, never a POST.
    if(requireNewSendCapability){await client.requireDurabilityCapability();assertCurrent()}
    // A narrower product authority may expire/revoke during the last storage
    // await. Re-introspect immediately before POST; failure preserves the exact
    // conservative unknown marker and bytes, never authorizes a replacement.
    if(beforeBroadcast){await beforeBroadcast();assertCurrent()}
    // From this point on, lifecycle cancellation must not erase a real network
    // result. UI owners check their lease separately before updating a screen.
    let result:BroadcastResult;
    try{result=await client.broadcast(dispatch.payload,dispatch.transaction,dispatch.hash)}catch{return dispatch}
    const outcome=parse({...dispatch,phase:"observed",replayed:result.replayed,durabilityEvidence:null,updatedAt:this.now().toISOString()},record.account);
    await this.save(outcome);
    return outcome;
  }
  private async load(account:string,historicalOnly=false):Promise<NativeTransferOutboxEntry|null>{
    try{
      const raw=await this.storage.getItem(key(account));
      if(raw!==null&&raw.length>8192)throw new Error();
      const record=raw===null?null:parse(JSON.parse(raw),account);
      const pending=await this.storage.getItem(NATIVE_PREPARATION_PREFIX+account);
      if(pending!==null){
        const marker=parsePreparation(pending,account);
        if(marker.phase!=="unsigned_failed"){
          const original=record&&record.origin===marker.origin&&(["signed","signed_failed"].includes(marker.phase)?marker.hash===record.hash:record.createdAt===marker.createdAt&&record.hash!==marker.previousHash);
          if(!original&&!historicalOnly)throw new NativeSigningResultUnknown(marker);
        }
      }
      return record;
    }catch(error){if(error instanceof NativeSigningResultUnknown)throw error;throw new NativeOutboxStorageError()}
  }
  private async savePreparation(marker:PreparationMarker):Promise<void>{
    try{const encoded=JSON.stringify(marker),k=NATIVE_PREPARATION_PREFIX+marker.account;parsePreparation(encoded,marker.account);await this.storage.setItem(k,encoded);const actual=await this.storage.getItem(k);if(actual!==encoded)throw new Error("Preparation marker readback mismatch");parsePreparation(actual,marker.account)}catch(error){throw new NativeOutboxStorageError(null,error)}
  }
  /** Publish immutable original + linked node + verified head BEFORE Done.
   * Interrupted publication is resumed, never pruned or overwritten. */
  private async archive(record:NativeTransferOutboxEntry,assertCurrent:Guard):Promise<void>{
    assertCurrent();const account=record.account,hash=record.hash;
    try{
      if(!["accepted","done"].includes(record.phase)||!verifyNativeDurability(record.durabilityEvidence,record.transaction,hash,record.origin))throw new Error();
      const archiveKey=historyKey(account,hash),headKey=HISTORY_HEAD_PREFIX+account,nodeKey=HISTORY_NODE_PREFIX+account+"."+hash;
      const head=await this.storage.getItem(headKey);assertCurrent();if(head!==null)historyKey(account,head);
      const existing=await this.storage.getItem(archiveKey);assertCurrent();
      const encoded=JSON.stringify({...record,phase:"done"});if(encoded.length>8192)throw new Error();
      if(existing!==null){const saved=parseHistoryRecord(existing,account,hash);
        if(saved.payload!==record.payload||saved.origin!==record.origin||saved.createdAt!==record.createdAt||JSON.stringify(saved.durabilityEvidence)!==JSON.stringify(record.durabilityEvidence))throw new Error();
      }else{await this.storage.setItem(archiveKey,encoded);assertCurrent()}
      const saved=await this.storage.getItem(archiveKey);assertCurrent();if(saved!== (existing??encoded))throw new Error();parseHistoryRecord(saved,account,hash);
      const prior=await this.storage.getItem(nodeKey);assertCurrent();
      if(head===hash){if(prior===null)throw new Error();parseHistoryNode(prior,account,hash);return}
      if(head!==null){
        const priorNode=await this.storage.getItem(HISTORY_NODE_PREFIX+account+"."+head);assertCurrent();if(priorNode===null)throw new Error();parseHistoryNode(priorNode,account,head);
        const priorRecord=await this.storage.getItem(historyKey(account,head));assertCurrent();if(priorRecord===null)throw new Error();parseHistoryRecord(priorRecord,account,head);
      }
      const node=JSON.stringify({version:1,account,hash,previous:head});if(prior!==null&&prior!==node)throw new Error();
      if(prior===null){await this.storage.setItem(nodeKey,node);assertCurrent()}
      if(await this.storage.getItem(nodeKey)!==node)throw new Error();assertCurrent();
      // Detect a changed head before publishing; no broad journal replacement.
      if(await this.storage.getItem(headKey)!==head)throw new Error();assertCurrent();
      await this.storage.setItem(headKey,hash);assertCurrent();if(await this.storage.getItem(headKey)!==hash)throw new Error();assertCurrent();
    }catch{assertCurrent();throw new NativeOutboxStorageError()}
  }
  private async save(record:NativeTransferOutboxEntry):Promise<void>{
    const encoded=JSON.stringify(record),storageKey=key(record.account);
    try{if(encoded.length>8192)throw new Error();await this.storage.setItem(storageKey,encoded);const readback=await this.storage.getItem(storageKey);if(readback!==encoded)throw new Error();parse(JSON.parse(readback),record.account)}catch(error){throw new NativeOutboxStorageError(Object.freeze({payload:record.payload,hash:record.hash,transaction:record.transaction}),error)}
  }
  private serial<T>(work:()=>Promise<T>):Promise<T>{const pending=(queues.get(this.storage)??Promise.resolve()).catch(()=>{}).then(work);queues.set(this.storage,pending);return pending}
}

function key(account:string):string{evmAddressFromYNX(account);return NATIVE_OUTBOX_PREFIX+account}
function parsePreparation(raw:string,account:string):PreparationMarker{
  if(raw.length>1024)throw new Error();const m=JSON.parse(raw);
  if(!m||Object.keys(m).sort().join(",")!=="account,createdAt,hash,origin,phase,previousHash,version"||m.version!==1||m.account!==account||!["preparing","unsigned_failed","signed","signed_failed"].includes(m.phase))throw new Error();
  key(account);if(new NativeChainClient(m.origin).origin!==m.origin||typeof m.createdAt!=="string"||new Date(m.createdAt).toISOString()!==m.createdAt)throw new Error();
  for(const hash of [m.hash,m.previousHash])if(hash!==null&&(typeof hash!=="string"||!/^0x[0-9a-f]{64}$/.test(hash)))throw new Error();
  if(["signed","signed_failed"].includes(m.phase)!==(m.hash!==null))throw new Error();return Object.freeze(m);
}
function historyKey(account:string,hash:string):string{key(account);if(!/^0x[0-9a-f]{64}$/.test(hash))throw new Error("Invalid saved native hash");return NATIVE_HISTORY_PREFIX+account+"."+hash}
function parseHistoryNode(raw:string,account:string,hash:string):string|null{
  if(raw.length>512)throw new Error();const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(",")!=="account,hash,previous,version"||value.version!==1||value.account!==account||value.hash!==hash)throw new Error();
  if(value.previous!==null){historyKey(account,value.previous);if(value.previous===hash)throw new Error()}
  return value.previous;
}
function parseHistoryRecord(raw:string,account:string,hash:string):NativeTransferOutboxEntry{
  if(raw.length>8192)throw new Error();const record=parse(JSON.parse(raw),account);
  if(record.hash!==hash||record.phase!=="done")throw new Error();return record;
}
function resolutionFromRecord(record:NativeTransferOutboxEntry):NativeTransferResolution{
  return Object.freeze({version:1,account:record.account,origin:record.origin,payload:record.payload,hash:record.hash,transaction:record.transaction,resolvedAt:record.updatedAt,durabilityEvidence:record.durabilityEvidence!});
}
function parseResolution(raw:string,account:string,hash:string):NativeTransferResolution{
  if(raw.length>8192)throw new Error();const value=JSON.parse(raw);
  const fields=["version","account","origin","payload","hash","transaction","resolvedAt","durabilityEvidence"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(field=>!Object.hasOwn(value,field))||value.version!==1||value.account!==account||value.hash!==hash||typeof value.payload!=="string"||value.payload.length>2048||typeof value.origin!=="string"||typeof value.resolvedAt!=="string"||value.resolvedAt.length!==24||!Number.isFinite(Date.parse(value.resolvedAt))||new Date(value.resolvedAt).toISOString()!==value.resolvedAt)throw new Error();
  const origin=new NativeChainClient(value.origin).origin,transaction=parseSignedNativeTransfer(value.payload);
  if(origin!==value.origin||nativeTransferHash(value.payload)!==hash||transaction.from!==evmAddressFromYNX(account)||JSON.stringify(transaction)!==JSON.stringify(value.transaction)||!Number.isSafeInteger(transaction.amount+transaction.fee)||!verifyNativeDurability(value.durabilityEvidence,transaction,hash,origin))throw new Error();
  return Object.freeze({...value,transaction});
}
function parse(value:any,account:string):NativeTransferOutboxEntry{
  const fields=["version","account","origin","payload","hash","transaction","phase","attempts","createdAt","updatedAt","replayed","durabilityEvidence"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(field=>!Object.prototype.hasOwnProperty.call(value,field))||value.version!==1||value.account!==account||typeof value.payload!=="string"||value.payload.length>2048||typeof value.origin!=="string"||!["prepared","unknown","observed","accepted","done","pending_durable","uncertain","memory_only","not_found","unsupported"].includes(value.phase)||!Number.isSafeInteger(value.attempts)||value.attempts<0||value.attempts>1000000||!(value.replayed===null||typeof value.replayed==="boolean"))throw new Error("Invalid stored native transfer");
  const origin=new NativeChainClient(value.origin).origin;if(origin!==value.origin)throw new Error("Invalid stored native origin");
  for(const time of [value.createdAt,value.updatedAt])if(typeof time!=="string"||time.length!==24||!Number.isFinite(Date.parse(time))||new Date(time).toISOString()!==time)throw new Error("Invalid stored native transfer time");
  const transaction=parseSignedNativeTransfer(value.payload);
  if(transaction.from!==evmAddressFromYNX(account)||JSON.stringify(transaction)!==JSON.stringify(value.transaction)||nativeTransferHash(value.payload)!==value.hash||!Number.isSafeInteger(transaction.amount+transaction.fee))throw new Error("Stored native transfer identity does not match");
  if(value.phase==="prepared"&&(value.attempts!==0||value.replayed!==null)||value.phase==="observed"&&(value.attempts===0||typeof value.replayed!=="boolean"))throw new Error("Invalid stored native transfer state");
  if(value.durabilityEvidence!==null&&(typeof value.durabilityEvidence!=="object"||Array.isArray(value.durabilityEvidence)))throw new Error("Invalid stored durability evidence");
  if(value.phase==="accepted"||value.phase==="done"){
    // Never trust a persisted phase bit. Recheck the exact checkpoint against the
    // signed original after restart and again before explicit acknowledgement.
    if(!verifyNativeDurability(value.durabilityEvidence,transaction,value.hash,value.origin))return Object.freeze({...value,transaction,phase:value.replayed===null?"uncertain":"observed",durabilityEvidence:null});
  }
  return Object.freeze({...value,transaction});
}
