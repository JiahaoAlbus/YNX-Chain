import {
  canonicalJSON, createFinanceOrderApprovalRequest, createFinanceOrderOpaqueCompleteRequest,
  createFinanceOrderOpaqueLaunchURL,
  createSignedFinanceOrderApproval, createSignedFinanceOrderApprovalRevocation,
  createSignedFinanceOrderOpaqueClaim, createSignedFinanceOrderOpaqueReject, createSignedFinanceOrderLegacyRecovery,
  FINANCE_ORDER_STATE_BINDING_SHA256,FINANCE_ORDER_STATE_BINDING_LEGACY_RAW,
  financeOrderApprovalDigest, financeOrderOpaqueTicketHash, parseFinanceOrderOpaqueClaimResponse,
  parseFinanceOrderOpaqueCompleteResponse, parseFinanceOrderOpaqueLaunchURL, parseFinanceOrderLegacyRecoveryResponse,
  parseFinanceOrderOpaqueCallbackURL,
  parseFinanceOrderApprovalRequest, parseSignedFinanceOrderApproval,
  verifySignedFinanceOrderApproval, verifySignedFinanceOrderApprovalRevocationAgainstUnsigned,
} from "@ynx-chain/wallet-auth";
import type { FinanceOrderApprovalRequest, FinanceOrderOpaqueCompleteRequest, FinanceOrderStateBinding, SignedFinanceOrderApproval, SignedFinanceOrderApprovalRevocation } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";
import type { FinanceOrderApprovalReview } from "./financeOrderApprovalController";

export const FINANCE_ORDER_OPAQUE_REPLAY_KEY="ynx.wallet.finance-order-approval-v2.replay";
type Decision="approved"|"rejected"|"revoked";
type Row={ticket:string;ticketHash:string;stateBinding:FinanceOrderStateBinding;request:FinanceOrderApprovalRequest;digest:string;status:"pending"|Decision;
  proof:FinanceOrderOpaqueCompleteRequest["proof"]|null;returnURL:string|null};
type Pending={review:FinanceOrderApprovalReview;row:Row};
type Dependencies={
  storage:SecureStorageAdapter;selectedAccount:()=>WalletAccount|null;
  withAccountSecret:<T>(account:string,assertCurrent:()=>void,use:(secret:string,assertKeyCurrent:()=>void)=>T|Promise<T>)=>Promise<T>;
  currentTime:(assertCurrent:()=>void)=>Promise<Date>;
  randomToken:()=>Promise<string>;
  claim:(input:Readonly<{ticket:string;claim:ReturnType<typeof createSignedFinanceOrderOpaqueClaim>}>)=>Promise<unknown>;
  complete:(input:FinanceOrderOpaqueCompleteRequest)=>Promise<unknown>;
  recoverLegacy:(input:Readonly<{requestId:string;claim:ReturnType<typeof createSignedFinanceOrderLegacyRecovery>}>)=>Promise<unknown>;
  inspectLegacy:(url:string)=>Promise<Readonly<{request:FinanceOrderApprovalRequest;status:"pending"|"approved"|"rejected"|"revoked";approval:SignedFinanceOrderApproval|null;revocation:SignedFinanceOrderApprovalRevocation|null}>>;
  openURL:(url:string)=>Promise<unknown>;
};
const MAX_ROWS=128,MAX_JOURNAL_CHARS=1024*1024;
let journalQueue:Promise<unknown>=Promise.resolve();
let journalUncertain=false;

/** V2 native Finance review. A ticket cannot fetch an order without the selected account's read-only claim signature. */
export class FinanceOrderOpaqueController {
  private pending:Pending|null=null;
  private generation=0;
  private busy=false;
  constructor(private readonly dependencies:Dependencies){}
  get current():FinanceOrderApprovalReview|null{return this.pending?.review??null}
  hasReturn(id:string):boolean{return this.pending?.review.id===id&&this.pending.row.status!=="pending"}
  canRevoke(id:string):boolean{return this.pending?.review.id===id&&this.pending.row.status==="approved"}
  cancel():void{this.generation++;this.pending=null}
  async isExpired(id:string):Promise<boolean>{
    const p=this.require(id),generation=this.generation;
    const at=await this.time(()=>this.check(p,generation));
    return at.getTime()>=Date.parse(p.row.request.unsigned.expiresAt);
  }
  async receive(url:string):Promise<FinanceOrderApprovalReview>{
    return this.exclusive(async()=>{
      this.healthy();
      if(url.startsWith("ynxwallet://finance-order-approval?request="))
        return this.receiveLegacy(url);
      return this.receiveTicket(url);
    });
  }
  private async receiveLegacy(url:string):Promise<FinanceOrderApprovalReview>{
    const generation=this.generation,legacy=await this.dependencies.inspectLegacy(url);
    const selected=this.snapshotSelected(),challenge=legacy.request.unsigned;
    if(selected.account!==challenge.account||selected.accountPublicKey!==challenge.accountPublicKey)
      throw new Error("Legacy Finance order belongs to another Wallet account");
    const at=await this.time(()=>this.assertSelected(selected,generation));
    const nonce=await this.dependencies.randomToken();this.assertSelected(selected,generation);
    const claim=await this.dependencies.withAccountSecret(selected.account,()=>this.assertSelected(selected,generation),async(secret,assertKeyCurrent)=>{
      assertKeyCurrent();this.assertSelected(selected,generation);
      return createSignedFinanceOrderLegacyRecovery({challenge,nonce},at,secret);
    });
    const recovered=parseFinanceOrderLegacyRecoveryResponse(await this.dependencies.recoverLegacy({requestId:challenge.requestId,claim}),{requestId:challenge.requestId});
    this.assertSelected(selected,generation);
    const review=await this.receiveTicket(createFinanceOrderOpaqueLaunchURL(recovered.ticket),legacy.request,FINANCE_ORDER_STATE_BINDING_LEGACY_RAW);
    if(legacy.status==="pending")return review;
    const p=this.require(review.id);
    if(p.row.status!=="pending")return review;
    let proof:FinanceOrderOpaqueCompleteRequest["proof"];
    if(legacy.status==="approved"){
      if(!legacy.approval)throw new Error("Legacy approved proof is absent");
      proof=verifySignedFinanceOrderApproval(legacy.approval,challenge,at);
    }else if(legacy.status==="revoked"){
      if(!legacy.revocation)throw new Error("Legacy revocation proof is absent");
      proof=verifySignedFinanceOrderApprovalRevocationAgainstUnsigned(legacy.revocation,challenge,at);
    }else{
      proof=await this.dependencies.withAccountSecret(selected.account,()=>this.assertSelected(selected,generation),async(secret,assertKeyCurrent)=>{
        assertKeyCurrent();this.assertSelected(selected,generation);
        return createSignedFinanceOrderOpaqueReject({ticket:p.row.ticket,challenge},at,secret);
      });
    }
    this.assertSelected(selected,generation);
    await this.mutate(async()=>{
      const rows=await this.readRows(at),index=rows.findIndex(row=>row.digest===p.row.digest);
      const stored=rows[index];if(!stored||stored.status!=="pending"||stored.ticketHash!==p.row.ticketHash)
        throw new Error("Legacy Finance migration result changed");
      const next:Row={...stored,status:legacy.status,proof,returnURL:null},updated=[...rows];updated[index]=next;
      await this.writeRows(updated);p.row=next;
    });
    p.review=Object.freeze({...review,decision:legacy.status});
    return p.review;
  }
  private async receiveTicket(url:string,expectedLegacy:FinanceOrderApprovalRequest|null=null,
    stateBinding:FinanceOrderStateBinding=FINANCE_ORDER_STATE_BINDING_SHA256):Promise<FinanceOrderApprovalReview>{
      const generation=this.generation,ticket=parseFinanceOrderOpaqueLaunchURL(url).ticket,ticketHash=financeOrderOpaqueTicketHash(ticket);
      const selected=this.snapshotSelected();
      if(this.pending){if(this.pending.row.ticketHash===ticketHash){this.check(this.pending,generation);return this.pending.review}throw new Error("Finish the current Finance order approval first")}
      const at=await this.time(()=>this.assertSelected(selected,generation));
      const existing=(await this.readRows(at)).find(row=>row.ticketHash===ticketHash);
      this.assertSelected(selected,generation);
      if(existing){
        if(existing.stateBinding!==stateBinding)throw new Error("Finance callback state binding differs from recovered ticket");
        if(expectedLegacy&&canonicalJSON(existing.request.unsigned)!==canonicalJSON(expectedLegacy.unsigned))
          throw new Error("Recovered Finance order differs from legacy challenge");
        if(existing.request.unsigned.account!==selected.account||existing.request.unsigned.accountPublicKey!==selected.accountPublicKey)throw new Error("Finance order belongs to another Wallet account");
        const review=Object.freeze({id:existing.digest,request:existing.request,account:selected,decision:existing.status});
        this.pending={review,row:existing};return review;
      }
      if(!selected.backupConfirmed)throw new Error("Confirm this Wallet account backup before claiming a Finance order");
      const nonce=await this.dependencies.randomToken();this.assertGeneration(generation);
      const claim=await this.dependencies.withAccountSecret(selected.account,()=>this.assertSelected(selected,generation),async(secret,assertKeyCurrent)=>{
        assertKeyCurrent();this.assertSelected(selected,generation);
        return createSignedFinanceOrderOpaqueClaim({ticket,accountSecret:secret,nonce,issuedAt:at.toISOString(),expiresAt:new Date(at.getTime()+60_000).toISOString()});
      });
      this.assertSelected(selected,generation);
      const response=parseFinanceOrderOpaqueClaimResponse(await this.dependencies.claim(Object.freeze({ticket,claim})),{ticket,account:selected.account,accountPublicKey:selected.accountPublicKey});
      this.assertSelected(selected,generation);
      const request=createFinanceOrderApprovalRequest(response.challenge,new Date(response.serverTime));
      if(expectedLegacy&&canonicalJSON(request.unsigned)!==canonicalJSON(expectedLegacy.unsigned))
        throw new Error("Recovered Finance order differs from legacy challenge");
      const digest=financeOrderApprovalDigest(request.unsigned);
      const row:Row={ticket,ticketHash,stateBinding,request,digest,status:"pending",proof:null,returnURL:null};
      await this.mutate(async()=>{const current=await this.readRows(new Date(response.serverTime));this.assertSelected(selected,generation);
        if(current.length>=MAX_ROWS||current.some(item=>item.ticketHash===ticketHash||item.request.unsigned.requestId===request.unsigned.requestId||item.request.unsigned.orderHash===request.unsigned.orderHash))
          throw new Error("Finance order ticket or exact order was already reviewed");
        await this.writeRows([...current,row]);
      });
      const review=Object.freeze({id:digest,request,account:selected,decision:"pending" as const});
      this.pending={review,row};return review;
  }
  async approve(id:string):Promise<void>{return this.decide(id,"approved")}
  async reject(id:string):Promise<void>{return this.decide(id,"rejected")}
  async revokeUnused(id:string):Promise<void>{return this.decide(id,"revoked")}
  async retryReturn(id:string):Promise<void>{
    return this.exclusive(async()=>{const p=this.require(id);if(p.row.status==="pending")throw new Error("No signed Finance decision is available");
      await this.deliver(p,this.generation);
    });
  }
  private async decide(id:string,status:Decision):Promise<void>{
    return this.exclusive(async()=>{
      const p=this.require(id),generation=this.generation;
      this.check(p,generation);
      if(status==="revoked"?p.row.status!=="approved":p.row.status!=="pending")throw new Error("Finance order has an incompatible persisted decision");
      if(!p.review.account.backupConfirmed)throw new Error("Confirm account backup before signing");
      const at=await this.time(()=>this.check(p,generation));
      parseFinanceOrderApprovalRequest(p.row.request,at);
      const proof=await this.dependencies.withAccountSecret(p.review.account.account,()=>this.check(p,generation),async(secret,assertKeyCurrent)=>{
        assertKeyCurrent();this.check(p,generation);
        if(status==="approved")return createSignedFinanceOrderApproval({accountSecret:secret,approval:p.row.request.unsigned},at);
        if(status==="rejected")return createSignedFinanceOrderOpaqueReject({ticket:p.row.ticket,challenge:p.row.request.unsigned},at,secret);
        if(p.row.status!=="approved"||!p.row.proof)throw new Error("No unused approved proof is available");
        return createSignedFinanceOrderApprovalRevocation({accountSecret:secret,approval:parseSignedFinanceOrderApproval(p.row.proof)},at);
      });
      this.check(p,generation);
      await this.mutate(async()=>{
        const rows=await this.readRows(at),index=rows.findIndex(row=>row.digest===id),stored=rows[index];
        if(!stored||stored.ticketHash!==p.row.ticketHash||stored.status!==p.row.status)throw new Error("Finance order decision changed");
        const next={...stored,status,proof,returnURL:null} as Row;
        const updated=[...rows];updated[index]=next;
        await this.writeRows(updated);
        p.row=next;
      });
      await this.deliver(p,generation);
    });
  }
  private async deliver(p:Pending,generation:number):Promise<void>{
    this.check(p,generation);
    const at=await this.time(()=>this.check(p,generation));
    if(!p.row.proof||p.row.status==="pending")throw new Error("Finance result is not signed");
    const request=createFinanceOrderOpaqueCompleteRequest(p.row.ticket,p.row.status,p.row.proof,p.row.request.unsigned,at);
    const response=parseFinanceOrderOpaqueCompleteResponse(await this.dependencies.complete(request),{ticket:p.row.ticket,challenge:p.row.request.unsigned},p.row.stateBinding);
    this.check(p,generation);
    await this.mutate(async()=>{
      const rows=await this.readRows(at),index=rows.findIndex(row=>row.digest===p.row.digest);
      const stored=rows[index];
      if(!stored||stored.status!==p.row.status||canonicalJSON(stored.proof)!==canonicalJSON(p.row.proof))
        throw new Error("Finance result changed before callback");
      const next:Row={...stored,returnURL:response.callbackURL};
      const updated=[...rows];updated[index]=next;await this.writeRows(updated);p.row=next;
    });
    this.check(p,generation);
    await this.dependencies.openURL(response.callbackURL);
    if(this.pending===p)this.pending=null;
  }
  private snapshotSelected():WalletAccount{
    const account=this.dependencies.selectedAccount();
    if(!account)throw new Error("Select the Finance order Wallet account");
    return Object.freeze({...account});
  }
  private assertSelected(account:WalletAccount,generation:number):void{
    this.assertGeneration(generation);
    const current=this.dependencies.selectedAccount();
    if(!current||current.account!==account.account||current.accountPublicKey!==account.accountPublicKey||current.backupConfirmed!==account.backupConfirmed)
      throw new Error("Selected Wallet account changed");
  }
  private require(id:string):Pending{
    if(!this.pending||this.pending.review.id!==id)throw new Error("Finance order review is no longer active");
    return this.pending;
  }
  private check(p:Pending,generation:number):void{
    this.assertGeneration(generation);
    if(this.pending!==p)throw new Error("Finance order review changed");
    this.assertSelected(p.review.account,generation);
  }
  private assertGeneration(generation:number):void{this.healthy();if(this.generation!==generation)throw new Error("Finance order review cancelled")}
  private healthy():void{if(journalUncertain)throw new Error("Finance order journal write uncertain; restart Wallet")}
  private async time(check:()=>void):Promise<Date>{check();const at=await this.dependencies.currentTime(check);check();if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw new Error("Finance authority time unavailable");return at}
  private async exclusive<T>(fn:()=>Promise<T>):Promise<T>{if(this.busy)throw new Error("Finance order action already in progress");this.busy=true;try{return await fn()}finally{this.busy=false}}
  private async mutate<T>(fn:()=>Promise<T>):Promise<T>{const task=journalQueue.catch(()=>{}).then(()=>{this.healthy();return fn()});journalQueue=task;return task}
  private async readRows(at:Date):Promise<Row[]>{
    this.healthy();const raw=await this.dependencies.storage.getItem(FINANCE_ORDER_OPAQUE_REPLAY_KEY);
    if(raw===null)return[];
    if(raw.length>MAX_JOURNAL_CHARS)throw new Error("Finance order journal too large");
    let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw new Error("Finance order journal invalid")}
    const value=exact(parsed,["schemaVersion","rows"]);
    if(value.schemaVersion!==2||!Array.isArray(value.rows)||value.rows.length>MAX_ROWS)throw new Error("Finance order journal invalid");
    const rows:Row[]=[];
    for(const item of value.rows){
      const row=exact(item,["ticket","ticketHash","stateBinding","request","digest","status","proof","returnURL"]);
      const ticket=parseFinanceOrderOpaqueLaunchURL("ynxwallet://finance-order-approval?ticket="+row.ticket).ticket;
      const request=parseFinanceOrderApprovalRequest(row.request,new Date(row.request?.unsigned?.issuedAt));
      if(row.ticketHash!==financeOrderOpaqueTicketHash(ticket)||row.digest!==financeOrderApprovalDigest(request.unsigned))throw new Error("Finance order journal binding invalid");
      if(row.stateBinding!==FINANCE_ORDER_STATE_BINDING_SHA256&&row.stateBinding!==FINANCE_ORDER_STATE_BINDING_LEGACY_RAW)
        throw new Error("Finance order journal state binding invalid");
      if(!["pending","approved","rejected","revoked"].includes(row.status))throw new Error("Finance order journal status invalid");
      if(row.status==="pending"?(row.proof!==null||row.returnURL!==null):row.proof===null)throw new Error("Finance order journal decision invalid");
      if(row.returnURL!==null&&typeof row.returnURL!=="string")throw new Error("Finance order journal callback invalid");
      if(row.returnURL!==null)parseFinanceOrderOpaqueCallbackURL(row.returnURL,{requestId:request.unsigned.requestId,
        callbackStateHash:request.unsigned.callbackStateHash},row.stateBinding);
      if(rows.some(existing=>existing.ticketHash===row.ticketHash||existing.request.unsigned.requestId===request.unsigned.requestId||existing.request.unsigned.orderHash===request.unsigned.orderHash))
        throw new Error("Finance order journal replay collision");
      rows.push({ticket,ticketHash:row.ticketHash,stateBinding:row.stateBinding,request,digest:row.digest,status:row.status,proof:row.proof,returnURL:row.returnURL});
    }
    return rows.filter(row=>Date.parse(row.request.unsigned.expiresAt)>at.getTime());
  }
  private async writeRows(rows:Row[]):Promise<void>{
    this.healthy();const encoded=JSON.stringify({schemaVersion:2,rows});
    if(encoded.length>MAX_JOURNAL_CHARS)throw new Error("Finance order journal too large");
    try{await this.dependencies.storage.setItem(FINANCE_ORDER_OPAQUE_REPLAY_KEY,encoded);
      if(await this.dependencies.storage.getItem(FINANCE_ORDER_OPAQUE_REPLAY_KEY)!==encoded)throw new Error("Finance order journal readback changed")}
    catch(error){journalUncertain=true;throw error}
  }
}
function exact(value:unknown,keys:string[]):Record<string,any>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||
    Object.keys(value).sort().join(",")!==[...keys].sort().join(",")||Reflect.ownKeys(value).length!==keys.length)
    throw new Error("Finance order journal shape invalid");
  return value as Record<string,any>;
}
