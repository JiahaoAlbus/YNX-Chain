import { evmAddressFromYNX } from "@ynx-chain/wallet-auth";
import { parsePaymentRecipient } from "./paymentRequest";
import { verifyNativeDurability } from "./nativeDurability";
import type { NativeTransferOutboxEntry } from "./nativeTransferOutbox";

/** Existing native Pay projection. Never owns keys, submits a transaction or
 * creates a product session. Signed Pay-product invoices use a different wire
 * contract and must not silently be reinterpreted as this legacy projection. */
export type WalletPayInvoice = Readonly<{
  id:string; intentId:string; merchant:string; payoutAddress:string; amount:number;
  currency:"YNXT"; status:"issued"|"paid"|"expired"|"cancelled"; createdAt:string; dueAt:string;
}>;
export type WalletPaySettlement = Readonly<{
  id:string; intentId:string; invoiceId:string; merchant:string; payoutAddress:string;
  payer:string; amount:number; currency:"YNXT"; transactionHash:string; blockNumber:number;
  status:"paid"; auditHash:string; createdAt:string;
}>;
export class WalletPayError extends Error {
  constructor(readonly code:string) { super(code); this.name="WalletPayError"; }
}
function fail(code:string):never {throw new WalletPayError(code)}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function text(v:unknown,max=128):string {
  if(typeof v!=="string"||!v||v.trim()!==v||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail("PAY_INVALID_RESPONSE");
  return v;
}
function identifier(v:unknown):string { const s=text(v); if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(s))fail("PAY_INVALID_IDENTIFIER");return s; }
function whole(v:unknown):number {if(typeof v!=="number"||!Number.isSafeInteger(v)||v<=0)fail("PAY_WHOLE_YNXT_REQUIRED");return v;}
function time(v:unknown):string {
  const s=text(v,40),parsed=Date.parse(s);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(s)||!Number.isFinite(parsed)||
    new Date(parsed).toISOString().slice(0,19)!==s.slice(0,19))fail("PAY_INVALID_TIME");
  return s;
}
function address(v:unknown):string {try{const result=parsePaymentRecipient(text(v));if(result.kind!=="address")fail("PAY_INVALID_RECIPIENT");return result.recipient}catch{return fail("PAY_INVALID_RECIPIENT")}}

/** Extract only a reference; never navigate/fetch a QR-provided origin. Existing
 * identifiers and the old Pay deep link remain compatible; no amount/token,
 * callback, URL credentials, encoded path or action may ride along. */
export function walletPayInvoiceID(value:unknown):string {
  const s=text(value,512);
  if(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(s))return s;
  const deep=/^ynxpay:\/\/invoice\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})$/.exec(s);
  if(deep)return deep[1]!;
  const web=/^(?:https:\/\/pay\.ynxweb4\.com)?\/(?:invoices|pay\/checkout)\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})$/.exec(s);
  if(web)return web[1]!;
  return fail("PAY_INVALID_REFERENCE");
}
export function parseWalletPayInvoice(value:unknown,expectedID:string):WalletPayInvoice {
  if(!object(value)||value.currency!=="YNXT"||!["issued","paid","expired","cancelled"].includes(String(value.status)))fail("PAY_INVALID_INVOICE");
  const id=identifier(value.id);if(id!==walletPayInvoiceID(expectedID))fail("PAY_INVOICE_ID_MISMATCH");
  const result={id,intentId:identifier(value.intentId),merchant:text(value.merchant),payoutAddress:address(value.payoutAddress),amount:whole(value.amount),currency:"YNXT" as const,
    status:value.status as WalletPayInvoice["status"],createdAt:time(value.createdAt),dueAt:time(value.dueAt)};
  if(!Number.isSafeInteger(result.amount+1)||Date.parse(result.dueAt)<=Date.parse(result.createdAt))fail("PAY_INVALID_INVOICE");
  return Object.freeze(result);
}
export function assertWalletPayReview(invoice:WalletPayInvoice,account:string,now=Date.now()):void {
  evmAddressFromYNX(account);
  parseWalletPayInvoice(invoice,invoice.id);
  if(invoice.status!=="issued"||Date.parse(invoice.dueAt)<=now)fail("PAY_INVOICE_NOT_PAYABLE");
}
export function parseWalletPaySettlement(value:unknown,invoice:WalletPayInvoice,account:string,transfer:NativeTransferOutboxEntry):WalletPaySettlement {
  if(!object(value)||value.status!=="paid"||value.currency!=="YNXT")fail("PAY_SETTLEMENT_NOT_PAID");
  if(transfer.account!==account||!["accepted","done"].includes(transfer.phase)||
    !verifyNativeDurability(transfer.durabilityEvidence,transfer.transaction,transfer.hash,transfer.origin))fail("PAY_TRANSFER_NOT_DURABLE");
  const result={id:identifier(value.id),intentId:identifier(value.intentId),invoiceId:identifier(value.invoiceId),merchant:text(value.merchant),payoutAddress:address(value.payoutAddress),
    payer:text(value.payer),amount:whole(value.amount),currency:"YNXT" as const,transactionHash:text(value.transactionHash),blockNumber:whole(value.blockNumber),status:"paid" as const,auditHash:text(value.auditHash),createdAt:time(value.createdAt)};
  const payer=evmAddressFromYNX(account),payee=evmAddressFromYNX(invoice.payoutAddress);
  if(result.invoiceId!==invoice.id||result.intentId!==invoice.intentId||result.merchant!==invoice.merchant||result.payoutAddress!==invoice.payoutAddress||
    result.amount!==invoice.amount||result.transactionHash!==transfer.hash||!(result.payer===account||result.payer===payer)||
    transfer.transaction.from!==payer||transfer.transaction.to!==payee||transfer.transaction.amount!==invoice.amount||transfer.transaction.fee!==1||
    !/^0x[0-9a-f]{64}$/.test(result.transactionHash)||! /^[0-9a-f]{64}$/.test(result.auditHash))fail("PAY_SETTLEMENT_BINDING_MISMATCH");
  // Pay's settlement record can commit after the payment transaction. Never
  // invent equality between two different ledger record heights.
  return Object.freeze(result);
}

type FetchLike=(url:string,options:RequestInit)=>Promise<Response>;
const MAX_PAY_RESPONSE_BYTES = 32768;
async function boundedPayText(response:Response, signal:AbortSignal):Promise<string> {
  const declared = response.headers?.get("content-length");
  if (declared != null) {
    if (!/^\d+$/.test(declared)) fail("PAY_INVALID_RESPONSE");
    if (Number(declared) > MAX_PAY_RESPONSE_BYTES) fail("PAY_RESPONSE_TOO_LARGE");
  }
  // React Native transports without a streaming body retain the finite timeout.
  // Validate UTF-8 bytes without allocating a second potentially large buffer.
  if (typeof response.body?.getReader !== "function") {
    const raw = await response.text();
    if (raw.length > MAX_PAY_RESPONSE_BYTES) fail("PAY_RESPONSE_TOO_LARGE");
    let bytes = 0;
    for (const character of raw) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > MAX_PAY_RESPONSE_BYTES) fail("PAY_RESPONSE_TOO_LARGE");
    }
    return raw;
  }
  const reader = response.body.getReader(), bytes = new Uint8Array(MAX_PAY_RESPONSE_BYTES);
  let length = 0;
  const cancel = () => {
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    try { reader.releaseLock(); } catch {}
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) fail("PAY_READ_CANCELLED");
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) fail("PAY_READ_CANCELLED");
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) fail("PAY_INVALID_RESPONSE");
      if (chunk.value.byteLength > MAX_PAY_RESPONSE_BYTES - length) fail("PAY_RESPONSE_TOO_LARGE");
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { return fail("PAY_INVALID_RESPONSE"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}
export class WalletPayInvoiceClient {
  readonly origin:string;
  constructor(origin="https://api.ynxweb4.com",private readonly fetcher:FetchLike=fetch,private readonly timeoutMs=8000) {
    let url:URL;try{url=new URL(origin)}catch{fail("PAY_INVALID_API_ORIGIN")}
    if(url.origin!==origin||url.protocol!=="https:"||url.username||url.password)fail("PAY_INVALID_API_ORIGIN");this.origin=origin;
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>8000)fail("PAY_INVALID_READ_TIMEOUT");
  }
  async invoice(reference:string,assertCurrent:()=>void,signal?:AbortSignal):Promise<WalletPayInvoice> {
    const id=walletPayInvoiceID(reference);assertCurrent();
    const value=await this.read(`/app/pay/invoices/${id}`,signal);assertCurrent();
    return parseWalletPayInvoice(value,id);
  }
  async settlement(invoice:WalletPayInvoice,account:string,transfer:NativeTransferOutboxEntry,assertCurrent:()=>void,signal?:AbortSignal):Promise<WalletPaySettlement> {
    assertCurrent();const value=await this.read(`/app/pay/invoices/${identifier(invoice.id)}/settlement`,signal);assertCurrent();
    return parseWalletPaySettlement(value,invoice,account,transfer);
  }
  private async read(route:string,signal?:AbortSignal):Promise<unknown> {
    const controller=new AbortController();let rejectStopped!:(error:Error)=>void;
    const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject});
    const stop=(code:string)=>{rejectStopped(new WalletPayError(code));controller.abort()};
    const abort=()=>stop("PAY_READ_CANCELLED");signal?.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(()=>stop("PAY_READ_TIMEOUT"),this.timeoutMs);
    try {
      if(signal?.aborted)fail("PAY_READ_CANCELLED");
      return await Promise.race([(async()=>{
        const url=this.origin+route;
        const response=await this.fetcher(url,{method:"GET",redirect:"error",credentials:"omit",signal:controller.signal,headers:{Accept:"application/json","X-YNX-Client":"ynx-wallet-v1"}});
        if(response.redirected||response.url&&response.url!==url)fail("PAY_READ_ORIGIN_MISMATCH");
        if(!response.ok)fail(response.status===401||response.status===403?"PAY_SESSION_REQUIRED":"PAY_READ_UNAVAILABLE");
        const raw=await boundedPayText(response,controller.signal);
        try{return JSON.parse(raw) as unknown}catch{return fail("PAY_INVALID_RESPONSE")}
      })(),stopped]);
    } catch(error) {if(error instanceof WalletPayError)throw error;return fail("PAY_READ_UNAVAILABLE")}
    finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);controller.abort()}
  }
}
