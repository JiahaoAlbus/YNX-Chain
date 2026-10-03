import {canonicalJSON,evmAddressFromYNX,parseProductSession} from "@ynx-chain/wallet-auth";
import type {createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";
import type {SecureStorageAdapter} from "../storage/walletRepository";
import type {NativeChainClient} from "../chain/nativeTransfer";
import {NativeTransferOutbox,type NativeTransferOutboxEntry} from "../chain/nativeTransferOutbox";
import {verifyNativeDurability} from "../chain/nativeDurability";
import {verifyWalletPayQuote} from "../chain/walletPayQuote";
import {prepareSignedPayTransfer} from "../security/prepareSignedPayTransfer";
import {parseWalletSignedPayRecord,SIGNED_PAY_BINDING_PREFIX,type WalletSignedPayRecord} from "./walletSignedPayRecord";
import type {WalletPayFlow} from "./walletPayFlow";
type Policy=ReturnType<typeof createPayInvoiceSignerPolicy>;
const queues=new WeakMap<SecureStorageAdapter,Promise<unknown>>();
export type SignedPayRecovery=Readonly<{record:WalletSignedPayRecord;original:NativeTransferOutboxEntry|null;
  state:"original_unavailable"|"transfer_unconfirmed"|"settlement_pending";
  actions:readonly "check"[];paymentAuthorized:false;settlementVerified:false}>;
/** Signed contract successor uses the SAME storage and original native outbox.
 * It never converts legacy records, imports keys, manufactures authority, or
 * retries a payment with a new nonce/result. No default authority adapter. */
export class WalletSignedPayFlow{
  constructor(private readonly storage:SecureStorageAdapter,private readonly outbox:NativeTransferOutbox,private readonly legacy:Pick<WalletPayFlow,"read">){}
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
    });
  })}
  recovery(account:string,policy:Policy,guard:()=>void):Promise<SignedPayRecovery|null>{return this.serial(async()=>{
    const record=await this.load(account,policy,guard);guard();if(!record)return null;
    const original=await this.outbox.read(account);guard();
    if(original&&(original.hash!==record.transfer.hash||original.payload!==record.transfer.payload||original.origin!==record.origin))throw Error("PAY_SIGNED_ORIGINAL_MISMATCH");
    const durable=!!original&&["accepted","done"].includes(original.phase)&&verifyNativeDurability(original.durabilityEvidence,original.transaction,original.hash,original.origin);
    return Object.freeze({record,original,state:!original?"original_unavailable":durable?"settlement_pending":"transfer_unconfirmed",
      actions:Object.freeze(original?.phase!=="done"?["check"] as const:[]),paymentAuthorized:false,settlementVerified:false});
  })}
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
