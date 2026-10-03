import {canonicalJSON,evmAddressFromYNX,parseProductSession} from "@ynx-chain/wallet-auth";
import type {createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";
import type {SecureStorageAdapter} from "../storage/walletRepository";
import type {NativeChainClient} from "../chain/nativeTransfer";
import {NativeTransferOutbox,type NativeTransferOutboxEntry} from "../chain/nativeTransferOutbox";
import {verifyNativeDurability} from "../chain/nativeDurability";
import {verifyWalletPayQuote} from "../chain/walletPayQuote";
import {prepareSignedPayTransfer,assertSignedPayProductSession,assertSignedPaySessionBinding,type WalletPayAuthorityLease} from "../security/prepareSignedPayTransfer";
import {parseWalletSignedPayRecord,SIGNED_PAY_BINDING_PREFIX,type WalletSignedPayRecord} from "./walletSignedPayRecord";
import type {WalletPayFlow} from "./walletPayFlow";
import {
  assertSignedPayOriginal,parseSignedPaySettlementResponse,parseSignedPaySettlementState,parseWalletSignedPayReceipt,signedPayIdempotencyKey,
  SIGNED_PAY_SETTLEMENT_PREFIX,SIGNED_PAY_RECEIPT_PREFIX,SIGNED_PAY_PAID_INVOICE_PREFIX,SIGNED_PAY_HISTORY_HEAD_PREFIX,SIGNED_PAY_HISTORY_NODE_PREFIX,
  type SignedPaySettlementState,type WalletSignedPayReceipt,
} from "./walletSignedPaySettlement";
type Policy=ReturnType<typeof createPayInvoiceSignerPolicy>;
const queues=new WeakMap<SecureStorageAdapter,Promise<unknown>>();
export type SignedPayRecovery=Readonly<{record:WalletSignedPayRecord;original:NativeTransferOutboxEntry|null;
  state:"original_unavailable"|"transfer_unconfirmed"|"settlement_pending"|"settlement_unknown"|"settled";
  actions:readonly ("check"|"read-receipt"|"settle"|"done")[];paymentAuthorized:false;settlementVerified:boolean}>;
/** A's canonical authenticated actor/device/origin transport, never public GET
 * or caller-created HMAC/bearer. Methods bind the ORIGINAL full record, guard
 * before each outward effect, and implement the current atomic business fence.
 * A fresh same-account session may READ an old result, never rebind its intent. */
export type WalletSignedSettlementTransport=Readonly<{
  authority:Pick<WalletPayAuthorityLease,"session"|"assertCurrent"|"refresh">;
  submitOriginal:(record:WalletSignedPayRecord,idempotencyKey:string,guard:()=>void)=>Promise<unknown>;
  readOriginal:(record:WalletSignedPayRecord,guard:()=>void)=>Promise<unknown>;
}>;
/** Signed contract successor uses the SAME storage and original native outbox.
 * It never converts legacy records, imports keys, manufactures authority, or
 * retries a payment with a new nonce/result. No default authority adapter. */
export class WalletSignedPayFlow{
  constructor(private readonly storage:SecureStorageAdapter,private readonly outbox:NativeTransferOutbox,private readonly legacy:Pick<WalletPayFlow,"read"|"hasPaidInvoice">,private readonly now:()=>number=Date.now){}
  read(account:string,policy:Policy,guard:()=>void):Promise<WalletSignedPayRecord|null>{return this.serial(()=>this.load(account,policy,guard))}
  payReviewed(input:Parameters<typeof prepareSignedPayTransfer>[0]&{chain:NativeChainClient}):Promise<NativeTransferOutboxEntry>{return this.serial(async()=>{
    const {lease,authority,policy}=input;lease.assert();
    if(!authority)throw Error("PAY_CURRENT_AUTHORITY_REQUIRED");
    const account=input.review.account,captured=parseProductSession(authority.session),session=canonicalJSON(captured),now=input.now??Date.now;
    if(lease.account!==account)throw Error("PAY_EXPLICIT_REVIEW_MISMATCH");
    const guard=()=>{
      lease.assert();authority.assertCurrent();
      const current=parseProductSession(authority.session),at=now();
      if(canonicalJSON(current)!==session||!Number.isFinite(at)||at<Date.parse(current.issuedAt)||at>=Date.parse(current.expiresAt))throw Error("PAY_CURRENT_AUTHORITY_CHANGED_OR_EXPIRED");
    };
    const quote=verifyWalletPayQuote(input.rawInvoice,input.rawIntent,policy,guard,now()),review=Object.freeze({...input.review});
    if(quote.intentDigest!==input.reviewedIntentDigest)throw Error("PAY_EXPLICIT_REVIEW_MISMATCH");
    const preparedInput={...input,review,rawInvoice:quote.invoice,rawIntent:quote.intent,client:input.chain};
    guard();if(await this.load(account,policy,guard))throw Error("PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW");guard();
    if(await this.legacy.read(account))throw Error("PAY_LEGACY_ORIGINAL_REQUIRES_REVIEW");guard();
    if(await this.storage.getItem(SIGNED_PAY_PAID_INVOICE_PREFIX+account+"."+quote.invoice.id)!==null||await this.legacy.hasPaidInvoice(account,quote.invoice.id))throw Error("PAY_INVOICE_ALREADY_PAID");guard();
    let retained:WalletSignedPayRecord|null=null;
    const dispatchGuard=()=>{guard();if(retained&&now()>=Date.parse(retained.intent.quoteExpiresAt))throw Error("PAY_QUOTE_EXPIRED")};
    return this.outbox.sendNew(account,input.chain,dispatchGuard,async()=>{
      const signed=await prepareSignedPayTransfer(preparedInput);dispatchGuard();
      const record={version:2,account,origin:input.chain.origin,invoice:quote.invoice,intent:quote.intent,paymentResult:signed.paymentResult,session:captured,
        transfer:{payload:signed.payload,hash:signed.hash,transaction:signed.transaction}};
      // Normalize the signed invoice first: unsigned status/descriptions/remote
      // settlement cannot contaminate immutable retained evidence.
      const raw=canonicalJSON(record);retained=parseWalletSignedPayRecord(raw,account,policy,dispatchGuard);
      await this.save(retained,policy,dispatchGuard);dispatchGuard();return retained.transfer;
    },async()=>{
      dispatchGuard();const fresh=await authority.refresh();dispatchGuard();
      if(canonicalJSON(parseProductSession(fresh))!==session)throw Error("PAY_CURRENT_SESSION_CHANGED");
      const saved=await this.load(account,policy,dispatchGuard);dispatchGuard();
      if(!saved||!retained||canonicalJSON(saved)!==canonicalJSON(retained))throw Error("PAY_SIGNED_RECORD_UNAVAILABLE");
      // The readback can span revocation. Final re-introspection is the last
      // outward read before outbox dispatch; it cannot create a new session.
      const final=await authority.refresh();dispatchGuard();
      if(canonicalJSON(parseProductSession(final))!==session)throw Error("PAY_CURRENT_SESSION_CHANGED");
      await authority.verifyInvoicePayable(quote.invoice,quote.intent);dispatchGuard();
    });
  })}
  recovery(account:string,policy:Policy,guard:()=>void):Promise<SignedPayRecovery|null>{return this.serial(async()=>{
    const record=await this.load(account,policy,guard);guard();if(!record)return null;
    const original=await this.outbox.read(account);guard();
    if(original&&(original.hash!==record.transfer.hash||original.payload!==record.transfer.payload||original.origin!==record.origin))throw Error("PAY_SIGNED_ORIGINAL_MISMATCH");
    const durable=!!original&&["accepted","done"].includes(original.phase)&&verifyNativeDurability(original.durabilityEvidence,original.transaction,original.hash,original.origin);
    const state=durable?await this.loadSettlement(record,original!,policy,guard):null;guard();
    const verified=state?.phase==="verified";
    return Object.freeze({record,original,state:!original?"original_unavailable":!durable?"transfer_unconfirmed":verified?"settled":state?.phase==="unknown"?"settlement_unknown":"settlement_pending",
      actions:Object.freeze(verified?["done"] as const:durable?["read-receipt","settle"] as const:["check"] as const),paymentAuthorized:false,settlementVerified:verified});
  })}
  /** Explicit submission only within the original intent/session lifetime.
   * Unknown is stored/read back BEFORE effect. No signing/broadcast occurs. */
  settleOriginal(account:string,policy:Policy,guard:()=>void,transport:WalletSignedSettlementTransport):Promise<SignedPaySettlementState>{return this.serial(async()=>{
    const {record,original}=await this.originalForSettlement(account,policy,guard);
    const authority=this.settlementAuthority(record,transport,guard,true);await authority.refresh();
    const prior=await this.loadSettlement(record,original,policy,authority.guard);authority.guard();if(prior?.phase==="verified")return prior;
    const pending:SignedPaySettlementState=Object.freeze({version:2,account,hash:record.transfer.hash,intentDigest:record.paymentResult.intentDigest,idempotencyKey:signedPayIdempotencyKey(record),phase:"unknown",settlement:null});
    await this.saveSettlement(pending,record,original,policy,authority.guard);await authority.refresh();authority.guard();
    let response:unknown;try{response=await transport.submitOriginal(record,pending.idempotencyKey,authority.guard)}catch{throw Error("PAY_SIGNED_SETTLEMENT_RESULT_UNKNOWN")}
    // A trusted bound business response is public retained evidence after an
    // actual effect. Lock/background suppresses UI, never erases that fact.
    const settlement=parseSignedPaySettlementResponse(response,record,original,policy,()=>{});
    const verified:SignedPaySettlementState=Object.freeze({...pending,phase:"verified",settlement});
    await this.saveSettlement(verified,record,original,policy,()=>{});guard();return verified;
  })}
  /** Authenticated observation with a fresh same-account authority may recover
   * an old receipt. It cannot replace/re-sign/rebind the old intent or submit. */
  readOriginalReceipt(account:string,policy:Policy,guard:()=>void,transport:WalletSignedSettlementTransport):Promise<SignedPaySettlementState>{return this.serial(async()=>{
    const {record,original}=await this.originalForSettlement(account,policy,guard);
    const authority=this.settlementAuthority(record,transport,guard,false);await authority.refresh();authority.guard();
    const response=await transport.readOriginal(record,authority.guard);
    const settlement=parseSignedPaySettlementResponse(response,record,original,policy,()=>{});
    const verified:SignedPaySettlementState=Object.freeze({version:2,account,hash:record.transfer.hash,intentDigest:record.paymentResult.intentDigest,idempotencyKey:signedPayIdempotencyKey(record),phase:"verified",settlement});
    await this.saveSettlement(verified,record,original,policy,()=>{});guard();return verified;
  })}
  acknowledgeSettled(account:string,reviewedHash:string,policy:Policy,guard:()=>void):Promise<WalletSignedPayReceipt>{return this.serial(async()=>{
    const {record,original}=await this.originalForSettlement(account,policy,guard);
    if(record.transfer.hash!==reviewedHash)throw Error("PAY_SIGNED_SETTLED_REVIEW_REQUIRED");
    const state=await this.loadSettlement(record,original,policy,guard);guard();if(state?.phase!=="verified"||!state.settlement)throw Error("PAY_SIGNED_SETTLED_REVIEW_REQUIRED");
    const receipt:WalletSignedPayReceipt=Object.freeze({version:2,record,original,settlement:state.settlement,consensusFinality:false}),key=this.receiptKey(account,reviewedHash);
    let encoded=canonicalJSON(receipt);
    try{
      const prior=await this.storage.getItem(key);guard();
      if(prior!==null){const saved=parseWalletSignedPayReceipt(prior,account,reviewedHash,policy,guard);
        if(canonicalJSON(saved.record)!==canonicalJSON(record)||canonicalJSON(saved.settlement)!==canonicalJSON(state.settlement)||saved.original.payload!==original.payload||saved.original.origin!==original.origin||canonicalJSON(saved.original.durabilityEvidence)!==canonicalJSON(original.durabilityEvidence))throw Error();encoded=prior;
      }else{parseWalletSignedPayReceipt(encoded,account,reviewedHash,policy,guard);await this.storage.setItem(key,encoded);guard()}
      if(await this.storage.getItem(key)!==encoded)throw Error();guard();
      const marker=SIGNED_PAY_PAID_INVOICE_PREFIX+account+"."+record.invoice.id,paid=await this.storage.getItem(marker);guard();
      if(paid!==null&&paid!==encoded)throw Error();if(paid===null){await this.storage.setItem(marker,encoded);guard()}
      if(await this.storage.getItem(marker)!==encoded)throw Error();guard();await this.appendHistory(account,reviewedHash,policy,guard);
    }catch{guard();throw Error("PAY_SIGNED_RECEIPT_STORAGE_UNAVAILABLE")}
    if(original.phase==="accepted")await this.outbox.acknowledge(account,reviewedHash,guard);guard();
    // Only release the current binding after immutable receipt/paid marker and
    // history are verified. Cleanup interruption retains a recoverable receipt.
    try{
      await this.storage.deleteItem(SIGNED_PAY_SETTLEMENT_PREFIX+account);guard();
      if(await this.storage.getItem(SIGNED_PAY_SETTLEMENT_PREFIX+account)!==null)throw Error();guard();
      await this.storage.deleteItem(SIGNED_PAY_BINDING_PREFIX+account);guard();
      if(await this.storage.getItem(SIGNED_PAY_BINDING_PREFIX+account)!==null)throw Error();guard();
    }catch{guard();throw Error("PAY_SIGNED_RECORD_UNAVAILABLE")}
    return parseWalletSignedPayReceipt(encoded,account,reviewedHash,policy,guard);
  })}
  history(account:string,policy:Policy,guard:()=>void,cursor:string|null=null,limit=20):Promise<Readonly<{receipts:readonly WalletSignedPayReceipt[];nextCursor:string|null}>>{return this.serial(async()=>{
    guard();evmAddressFromYNX(account);if(!Number.isInteger(limit)||limit<1||limit>50)throw Error("PAY_INVALID_HISTORY_PAGE");
    const receipts:WalletSignedPayReceipt[]=[],seen=new Set<string>();
    try{
      let hash=cursor??await this.storage.getItem(SIGNED_PAY_HISTORY_HEAD_PREFIX+account);guard();
      while(hash!==null&&receipts.length<limit){
        const key=this.receiptKey(account,hash);if(seen.has(hash))throw Error();seen.add(hash);
        const node=await this.storage.getItem(SIGNED_PAY_HISTORY_NODE_PREFIX+account+"."+hash);guard();if(node===null)throw Error();
        const previous=this.parseHistoryNode(node,account,hash);
        const raw=await this.storage.getItem(key);guard();if(raw===null)throw Error();receipts.push(parseWalletSignedPayReceipt(raw,account,hash,policy,guard));hash=previous;
      }
      if(hash!==null&&seen.has(hash))throw Error();return Object.freeze({receipts:Object.freeze(receipts),nextCursor:hash});
    }catch{guard();throw Error("PAY_SIGNED_RECEIPT_STORAGE_UNAVAILABLE")}
  })}
  private async originalForSettlement(account:string,policy:Policy,guard:()=>void){
    const record=await this.load(account,policy,guard);guard();if(!record)throw Error("PAY_SIGNED_ORIGINAL_UNAVAILABLE");
    const original=await this.outbox.read(account);guard();if(!original)throw Error("PAY_SIGNED_ORIGINAL_UNAVAILABLE");assertSignedPayOriginal(record,original);return {record,original};
  }
  private settlementAuthority(record:WalletSignedPayRecord,transport:WalletSignedSettlementTransport,guard:()=>void,submit:boolean){
    if(!transport?.authority||typeof transport.authority.refresh!=="function"||typeof transport.authority.assertCurrent!=="function"||typeof transport.readOriginal!=="function"||typeof transport.submitOriginal!=="function")throw Error("PAY_CURRENT_SETTLEMENT_AUTHORITY_REQUIRED");
    const captured=parseProductSession(transport.authority.session),snapshot=canonicalJSON(captured);assertSignedPayProductSession(captured,record.account);
    if(submit){assertSignedPaySessionBinding(captured,record.intent,record.account);if(snapshot!==canonicalJSON(record.session))throw Error("PAY_CURRENT_SESSION_CHANGED")}
    const current=()=>{
      guard();transport.authority.assertCurrent();const at=this.now();
      if(canonicalJSON(parseProductSession(transport.authority.session))!==snapshot||!Number.isFinite(at)||at<Date.parse(captured.issuedAt)||at>=Date.parse(captured.expiresAt)||submit&&at>=Date.parse(record.intent.quoteExpiresAt))throw Error("PAY_CURRENT_SETTLEMENT_AUTHORITY_CHANGED_OR_EXPIRED");
    };
    const refresh=async()=>{current();const fresh=await transport.authority.refresh();current();if(canonicalJSON(parseProductSession(fresh))!==snapshot)throw Error("PAY_CURRENT_SESSION_CHANGED")};
    current();return {guard:current,refresh};
  }
  private async loadSettlement(record:WalletSignedPayRecord,original:NativeTransferOutboxEntry,policy:Policy,guard:()=>void){
    guard();try{
      const raw=await this.storage.getItem(SIGNED_PAY_SETTLEMENT_PREFIX+record.account);guard();
      if(raw!==null)return parseSignedPaySettlementState(raw,record,original);
      // Cleanup may have deleted the transient state just before process death.
      // Recover ONLY from the already verified immutable archive, not a phase
      // flag or unsigned server status. Reads do not mutate either journal.
      const archived=await this.storage.getItem(this.receiptKey(record.account,record.transfer.hash));guard();if(archived===null)return null;
      const receipt=parseWalletSignedPayReceipt(archived,record.account,record.transfer.hash,policy,guard);
      if(canonicalJSON(receipt.record)!==canonicalJSON(record)||receipt.original.payload!==original.payload||receipt.original.origin!==original.origin)throw Error();
      return Object.freeze({version:2 as const,account:record.account,hash:record.transfer.hash,intentDigest:record.paymentResult.intentDigest,idempotencyKey:signedPayIdempotencyKey(record),phase:"verified" as const,settlement:receipt.settlement});
    }catch{guard();throw Error("PAY_SIGNED_SETTLEMENT_STORAGE_UNAVAILABLE")}
  }
  private async saveSettlement(state:SignedPaySettlementState,record:WalletSignedPayRecord,original:NativeTransferOutboxEntry,policy:Policy,guard:()=>void){
    const key=SIGNED_PAY_SETTLEMENT_PREFIX+record.account,raw=canonicalJSON(state);parseSignedPaySettlementState(raw,record,original);guard();
    try{
      const prior=await this.loadSettlement(record,original,policy,guard);guard();
      if(prior?.phase==="verified"&&canonicalJSON(prior)!==raw)throw Error();
      await this.storage.setItem(key,raw);guard();if(await this.storage.getItem(key)!==raw)throw Error();guard();
    }catch{guard();throw Error("PAY_SIGNED_SETTLEMENT_STORAGE_UNAVAILABLE")}
  }
  private receiptKey(account:string,hash:string){evmAddressFromYNX(account);if(!/^0x[a-f0-9]{64}$/.test(hash))throw Error("PAY_INVALID_RECEIPT_HASH");return SIGNED_PAY_RECEIPT_PREFIX+account+"."+hash}
  private parseHistoryNode(raw:string,account:string,hash:string):string|null{
    if(raw.length>512)throw Error();const value=JSON.parse(raw);
    if(!value||Object.keys(value).sort().join(",")!=="account,hash,previous,version"||value.version!==2||value.account!==account||value.hash!==hash)throw Error();
    if(value.previous!==null){this.receiptKey(account,value.previous);if(value.previous===hash)throw Error()}return value.previous;
  }
  private async appendHistory(account:string,hash:string,policy:Policy,guard:()=>void){
    const headKey=SIGNED_PAY_HISTORY_HEAD_PREFIX+account,nodeKey=SIGNED_PAY_HISTORY_NODE_PREFIX+account+"."+hash;
    const head=await this.storage.getItem(headKey);guard();if(head!==null)this.receiptKey(account,head);
    const prior=await this.storage.getItem(nodeKey);guard();
    if(head===hash){if(prior===null)throw Error();this.parseHistoryNode(prior,account,hash);return}
    if(head!==null){const node=await this.storage.getItem(SIGNED_PAY_HISTORY_NODE_PREFIX+account+"."+head);guard();if(node===null)throw Error();this.parseHistoryNode(node,account,head);
      const receipt=await this.storage.getItem(this.receiptKey(account,head));guard();if(receipt===null)throw Error();parseWalletSignedPayReceipt(receipt,account,head,policy,guard)}
    const raw=canonicalJSON({version:2,account,hash,previous:head});if(prior!==null&&prior!==raw)throw Error();
    if(prior===null){await this.storage.setItem(nodeKey,raw);guard()}if(await this.storage.getItem(nodeKey)!==raw)throw Error();guard();
    await this.storage.setItem(headKey,hash);guard();if(await this.storage.getItem(headKey)!==hash)throw Error();guard();
  }
  checkOriginal(account:string,policy:Policy,chain:NativeChainClient,guard:()=>void):Promise<NativeTransferOutboxEntry>{return this.serial(async()=>{
    const record=await this.load(account,policy,guard);guard();if(!record)throw Error("PAY_SIGNED_ORIGINAL_UNAVAILABLE");
    let original=await this.outbox.read(account);guard();
    if(chain.origin!==record.origin)throw Error("PAY_SIGNED_ORIGINAL_MISMATCH");
    if(!original){original=await this.outbox.retainUnknown(account,record.origin,record.transfer,record.paymentResult.issuedAt,guard);guard()}
    if(original.hash!==record.transfer.hash||original.payload!==record.transfer.payload||original.origin!==record.origin)throw Error("PAY_SIGNED_ORIGINAL_MISMATCH");
    if(original.phase==="done")return original;
    return this.outbox.checkStatus(account,original.hash,chain,guard);
  })}
  private async load(account:string,policy:Policy,guard:()=>void){
    guard();evmAddressFromYNX(account);try{const raw=await this.storage.getItem(SIGNED_PAY_BINDING_PREFIX+account);guard();return raw===null?null:parseWalletSignedPayRecord(raw,account,policy,guard)}catch{guard();throw Error("PAY_SIGNED_RECORD_UNAVAILABLE")}
  }
  private async save(record:WalletSignedPayRecord,policy:Policy,guard:()=>void){
    const key=SIGNED_PAY_BINDING_PREFIX+record.account,raw=canonicalJSON(record);guard();
    try{
      const prior=await this.storage.getItem(key);guard();if(prior!==null&&prior!==raw)throw Error();
      if(prior===null){await this.storage.setItem(key,raw);guard()}
      const saved=await this.storage.getItem(key);guard();if(saved!==raw)throw Error();parseWalletSignedPayRecord(saved,record.account,policy,guard);
    }catch{guard();throw Error("PAY_SIGNED_RECORD_UNAVAILABLE")}
  }
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const pending=(queues.get(this.storage)??Promise.resolve()).catch(()=>{}).then(operation);queues.set(this.storage,pending);return pending}
}
