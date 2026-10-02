import {evmAddressFromYNX,nativeTransferHash,parseSignedNativeTransfer} from "@ynx-chain/wallet-auth";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import type {SecureStorageAdapter} from "../storage/walletRepository";
import {NativeChainClient} from "../chain/nativeTransfer";
import {verifyNativeDurability} from "../chain/nativeDurability";
import {NativeTransferOutbox,type NativeTransferOutboxEntry,type NativeTransferPrepared} from "../chain/nativeTransferOutbox";
import {WalletPayInvoiceClient,WalletPayError,assertWalletPayReview,parseWalletPayInvoice,parseWalletPaySettlement,type WalletPayInvoice,type WalletPaySettlement} from "../chain/walletPayInvoice";

const PREFIX="ynx.wallet.pay-binding.v1.";
const RECEIPT_PREFIX="ynx.wallet.pay-receipt.v1.";
const PAID_INVOICE_PREFIX="ynx.wallet.pay-invoice-paid.v1.";
const queues=new WeakMap<SecureStorageAdapter,Promise<unknown>>();
type Guard=()=>void;
export type WalletPayBinding=Readonly<{version:1;account:string;invoice:WalletPayInvoice;origin:string;hash:string;
  phase:"prepared"|"settlement_unknown"|"settled";idempotencyKey:string;settlement:WalletPaySettlement|null}>;
export type WalletPayReceipt=Readonly<{binding:WalletPayBinding;transfer:NativeTransferOutboxEntry}>;
/** All key access and Pay session authority remain in existing owners. The UI
 * supplies its protected signing callback only after explicit payment review.
 * This controller owns public invoice/hash bindings, never a second vault. */
export class WalletPayFlow {
  constructor(private readonly storage:SecureStorageAdapter,private readonly outbox:NativeTransferOutbox,
    private readonly pay:WalletPayInvoiceClient,private readonly now:()=>number=Date.now){}
  read(account:string):Promise<WalletPayBinding|null>{return this.serial(()=>this.load(account))}
  receipt(account:string,hash:string):Promise<WalletPayReceipt|null>{return this.serial(async()=>{
    const key=this.receiptKey(account,hash);
    try{const raw=await this.storage.getItem(key);return raw===null?null:this.parseReceipt(raw,account,hash)}
    catch{throw new WalletPayError("PAY_RECEIPT_STORAGE_UNAVAILABLE")}
  })}
  /** Explicit completion only after a bound settlement and native durability.
   * Archive and verify the full public receipt BEFORE releasing either journal.
   * A crash at any await is recoverable; unknown results cannot be discarded. */
  async acknowledgeSettled(account:string,reviewedHash:string,guard:Guard):Promise<WalletPayReceipt>{
    return this.serial(async()=>{
      guard();const binding=await this.load(account);guard();
      if(!binding||binding.hash!==reviewedHash||binding.phase!=="settled")throw new WalletPayError("PAY_SETTLED_REVIEW_REQUIRED");
      const original=await this.outbox.read(account);guard();
      if(!original||original.hash!==binding.hash||original.origin!==binding.origin)throw new WalletPayError("PAY_ORIGINAL_TRANSFER_MISSING");
      parseWalletPaySettlement(binding.settlement,binding.invoice,account,original);
      const receipt=Object.freeze({binding,transfer:original}),raw=JSON.stringify(receipt),key=this.receiptKey(account,reviewedHash);
      try{
        if(raw.length>16384)throw new Error();
        const prior=await this.storage.getItem(key);
        // Recovery may find the same receipt archived before acknowledgement.
        // Never overwrite a different receipt, even for the same hash.
        if(prior!==null){const saved=this.parseReceipt(prior,account,reviewedHash);
          if(JSON.stringify(saved.binding)!==JSON.stringify(binding)||saved.transfer.payload!==original.payload)throw new Error();
        }else await this.storage.setItem(key,raw);
        const saved=await this.storage.getItem(key);if(saved===null||prior===null&&saved!==raw)throw new Error();
        this.parseReceipt(saved,account,reviewedHash);
        const invoiceKey=PAID_INVOICE_PREFIX+account+"."+binding.invoice.id;
        const priorInvoice=await this.storage.getItem(invoiceKey);
        if(priorInvoice!==null&&priorInvoice!==saved)throw new Error();
        if(priorInvoice===null)await this.storage.setItem(invoiceKey,saved);
        if(await this.storage.getItem(invoiceKey)!==saved)throw new Error();
      }catch{throw new WalletPayError("PAY_RECEIPT_STORAGE_UNAVAILABLE")}
      guard();if(original.phase==="accepted")await this.outbox.acknowledge(account,reviewedHash,guard);guard();
      try{await this.storage.deleteItem(PREFIX+account);if(await this.storage.getItem(PREFIX+account)!==null)throw new Error()}
      catch{throw new WalletPayError("PAY_BINDING_STORAGE_UNAVAILABLE")}
      return receipt;
    });
  }
  async payReviewed(invoice:WalletPayInvoice,account:string,chain:NativeChainClient,guard:Guard,
    prepare:(current:WalletPayInvoice)=>Promise<NativeTransferPrepared>):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      guard();if(await this.load(account))throw new WalletPayError("PAY_ORIGINAL_PAYMENT_REQUIRES_REVIEW");guard();
      // A stale issued projection must never reopen an already paid invoice.
      const reviewed=parseWalletPayInvoice(invoice,invoice.id);
      let paid:string|null;try{paid=await this.storage.getItem(PAID_INVOICE_PREFIX+account+"."+reviewed.id)}
      catch{throw new WalletPayError("PAY_RECEIPT_STORAGE_UNAVAILABLE")}
      guard();if(paid!==null)throw new WalletPayError("PAY_INVOICE_ALREADY_PAID");
      const fresh=await this.pay.invoice(invoice.id,guard);guard();assertWalletPayReview(fresh,account,this.now());
      // Changed merchant/amount/expiry needs a new visible review, not consent
      // inherited from an old QR or from an earlier version of the invoice.
      if(JSON.stringify(fresh)!==JSON.stringify(invoice))throw new WalletPayError("PAY_INVOICE_CHANGED_REVIEW_AGAIN");
      return this.outbox.sendNew(account,chain,guard,async()=>{
        guard();assertWalletPayReview(fresh,account,this.now());const signed=await prepare(fresh);guard();
        const tx=parseSignedNativeTransfer(signed.payload);
        if(JSON.stringify(tx)!==JSON.stringify(signed.transaction)||nativeTransferHash(signed.payload)!==signed.hash||
          tx.from!==evmAddressFromYNX(account)||tx.to!==evmAddressFromYNX(fresh.payoutAddress)||tx.amount!==fresh.amount||tx.fee!==1)
          throw new WalletPayError("PAY_SIGNED_TRANSFER_REVIEW_MISMATCH");
        let used:string|null;try{used=await this.storage.getItem(this.receiptKey(account,signed.hash))}
        catch{throw new WalletPayError("PAY_RECEIPT_STORAGE_UNAVAILABLE")}
        guard();if(used!==null)throw new WalletPayError("PAY_SIGNED_TRANSFER_ALREADY_USED");
        assertWalletPayReview(fresh,account,this.now());
        const idempotencyKey="wallet-pay-"+bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([account,fresh.id,signed.hash]))));
        await this.save(Object.freeze({version:1,account,invoice:fresh,origin:chain.origin,hash:signed.hash,phase:"prepared",idempotencyKey,settlement:null}));
        guard();return signed;
      });
    });
  }
  /** Public original-hash status only. Does not sign, resend or settle. */
  async checkOriginal(account:string,chain:NativeChainClient,guard:Guard):Promise<NativeTransferOutboxEntry>{
    return this.serial(async()=>{
      guard();const binding=await this.load(account);guard();if(!binding)throw new WalletPayError("PAY_ORIGINAL_PAYMENT_MISSING");
      if(binding.origin!==chain.origin)throw new WalletPayError("PAY_ORIGINAL_CHAIN_ORIGIN_REQUIRED");
      return this.outbox.checkStatus(account,binding.hash,chain,guard);
    });
  }
  /** Caller supplies the existing Pay session/proof implementation. A failed
   * settlement never authorizes another native transfer. Same exact key/hash
   * are retained for explicit settlement recovery after restart. */
  async settleOriginal(account:string,guard:Guard,submit:(binding:WalletPayBinding)=>Promise<unknown>):Promise<WalletPayBinding>{
    return this.serial(async()=>{
      guard();const binding=await this.load(account);guard();if(!binding)throw new WalletPayError("PAY_ORIGINAL_PAYMENT_MISSING");
      const original=await this.outbox.read(account);guard();
      if(!original||original.hash!==binding.hash||original.origin!==binding.origin)throw new WalletPayError("PAY_ORIGINAL_TRANSFER_MISSING");
      if(binding.phase==="settled"){
        parseWalletPaySettlement(binding.settlement,binding.invoice,account,original);return binding;
      }
      // Revalidate the persisted durable native proof before any settlement
      // write; a phase string or broadcast ACK is not authoritative payment.
      if(!["accepted","done"].includes(original.phase)||!verifyNativeDurability(original.durabilityEvidence,original.transaction,original.hash,original.origin))throw new WalletPayError("PAY_TRANSFER_NOT_DURABLE");
      const pending=Object.freeze({...binding,phase:"settlement_unknown" as const});await this.save(pending);guard();
      let response:unknown;
      try{response=await submit(pending)}catch{throw new WalletPayError("PAY_SETTLEMENT_RESULT_UNKNOWN")}
      const settlement=parseWalletPaySettlement(response,binding.invoice,account,original);
      // Preserve a real bound response even if background/lock cancelled the
      // initiating view. The UI checks its guard before displaying any result.
      const settled=Object.freeze({...pending,phase:"settled" as const,settlement});await this.save(settled);return settled;
    });
  }
  private async load(account:string):Promise<WalletPayBinding|null>{
    evmAddressFromYNX(account);
    try{
      const raw=await this.storage.getItem(PREFIX+account);if(raw===null)return null;if(raw.length>8192)throw new Error();
      return this.parseBinding(raw,account);
    }catch{throw new WalletPayError("PAY_BINDING_STORAGE_UNAVAILABLE")}
  }
  private parseBinding(raw:string,account:string):WalletPayBinding{
      const v=JSON.parse(raw);if(!v||typeof v!=="object"||Object.keys(v).sort().join(",")!=="account,hash,idempotencyKey,invoice,origin,phase,settlement,version"||v.version!==1||v.account!==account||
        !/^0x[0-9a-f]{64}$/.test(v.hash)||!/^wallet-pay-[0-9a-f]{64}$/.test(v.idempotencyKey)||!["prepared","settlement_unknown","settled"].includes(v.phase)||new NativeChainClient(v.origin).origin!==v.origin)throw new Error();
      const invoice=parseWalletPayInvoice(v.invoice,v.invoice.id);
      const expectedKey="wallet-pay-"+bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([account,invoice.id,v.hash]))));
      if(v.idempotencyKey!==expectedKey||v.phase==="settled"&&!v.settlement||v.phase!=="settled"&&v.settlement!==null)throw new Error();
      return Object.freeze({...v,invoice});
  }
  private receiptKey(account:string,hash:string):string{
    evmAddressFromYNX(account);if(!/^0x[0-9a-f]{64}$/.test(hash))throw new WalletPayError("PAY_INVALID_RECEIPT_HASH");
    return RECEIPT_PREFIX+account+"."+hash;
  }
  private parseReceipt(raw:string,account:string,hash:string):WalletPayReceipt{
    if(raw.length>16384)throw new Error();const v=JSON.parse(raw);
    if(!v||typeof v!=="object"||Object.keys(v).sort().join(",")!=="binding,transfer")throw new Error();
    const binding=this.parseBinding(JSON.stringify(v.binding),account),transfer=v.transfer as NativeTransferOutboxEntry;
    if(binding.phase!=="settled"||binding.hash!==hash||!transfer||transfer.hash!==hash||transfer.origin!==binding.origin||
      typeof transfer.payload!=="string"||transfer.payload.length>2048||nativeTransferHash(transfer.payload)!==hash||
      JSON.stringify(parseSignedNativeTransfer(transfer.payload))!==JSON.stringify(transfer.transaction))throw new Error();
    parseWalletPaySettlement(binding.settlement,binding.invoice,account,transfer);
    return Object.freeze({binding,transfer:Object.freeze(transfer)});
  }
  private async save(binding:WalletPayBinding):Promise<void>{
    const raw=JSON.stringify(binding),key=PREFIX+binding.account;
    try{if(raw.length>8192)throw new Error();await this.storage.setItem(key,raw);if(await this.storage.getItem(key)!==raw)throw new Error()}
    catch{throw new WalletPayError("PAY_BINDING_STORAGE_UNAVAILABLE")}
  }
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const p=(queues.get(this.storage)??Promise.resolve()).catch(()=>{}).then(operation);queues.set(this.storage,p);return p;}
}
