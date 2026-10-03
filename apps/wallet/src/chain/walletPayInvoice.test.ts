import assert from "node:assert/strict";
import test from "node:test";
import {ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {WalletPayInvoiceClient,assertWalletPayReview,parseWalletPayInvoice,parseWalletPaySettlement,walletPayInvoiceID} from "./walletPayInvoice";
import type {NativeTransferOutboxEntry} from "./nativeTransferOutbox";

const account=ynxAddressFromEVM("0x"+"1".repeat(40)),payee=ynxAddressFromEVM("0x"+"2".repeat(40));
const value={id:"invoice-original-001",intentId:"intent-original-001",merchant:"Original merchant",payoutAddress:payee,amount:25,currency:"YNXT",status:"issued",createdAt:"2026-10-02T12:00:00Z",dueAt:"2026-10-03T12:00:00Z"};
const invoice=()=>parseWalletPayInvoice(value,value.id);
const ok=(v:unknown)=>new Response(JSON.stringify(v),{status:200});

test("Pay byte limit accepts exactly 32 KiB and preserves split UTF-8 characters", async () => {
  const empty = JSON.stringify({ ...value, ignoredMetadata: "" });
  const exact = JSON.stringify({ ...value, ignoredMetadata: "x".repeat(32768 - empty.length) });
  assert.equal(Buffer.byteLength(exact), 32768);
  assert.deepEqual(await new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => new Response(exact)).invoice(value.id, () => {}), value);
  const unicode = { ...value, merchant: "商戶 🚀" }, bytes = Buffer.from(JSON.stringify(unicode));
  let offset = 0;
  const body = new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    const next = Math.min(offset + 7, bytes.length);
    controller.enqueue(new Uint8Array(bytes.subarray(offset, next))); offset = next;
  } }, { highWaterMark: 0 });
  const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => new Response(body));
  assert.deepEqual(await client.invoice(value.id, () => {}), unicode);
});
test("non-streaming mobile transport retains finite reads and enforces UTF-8 bytes", async () => {
  for (const oversized of [false, true]) {
    const raw = JSON.stringify(oversized ? { ...value, ignoredMetadata: "界".repeat(20000) } : value);
    const response = { ok: true, redirected: false, url: "", text: async () => raw } as Response;
    const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => response);
    if (oversized) await assert.rejects(() => client.invoice(value.id, () => {}), /PAY_RESPONSE_TOO_LARGE/);
    else assert.deepEqual(await client.invoice(value.id, () => {}), value);
  }
});
for (const action of ["cancel", "timeout"]) test(`stalled Pay stream releases its reader after ${action}`, async () => {
  let cancelled = false, reading = false;
  const body = new ReadableStream({ pull() { reading = true; return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const abort = new AbortController();
  const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => new Response(body), action === "timeout" ? 5 : 8000);
  const pending = client.invoice(value.id, () => {}, abort.signal);
  if (action === "cancel") { await new Promise(resolve => setImmediate(resolve)); assert.equal(reading, true); abort.abort(); }
  await assert.rejects(pending, action === "cancel" ? /PAY_READ_CANCELLED/ : /PAY_READ_TIMEOUT/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("original invoice IDs, deep links and checkout paths remain public references only",()=>{
  for(const reference of [value.id,`ynxpay://invoice/${value.id}`,`https://pay.ynxweb4.com/invoices/${value.id}`,`https://pay.ynxweb4.com/pay/checkout/${value.id}`,`/pay/checkout/${value.id}`])assert.equal(walletPayInvoiceID(reference),value.id);
  for(const reference of [`https://evil.invalid/invoices/${value.id}`,`https://pay.ynxweb4.com@evil.invalid/invoices/${value.id}`,`ynxpay://invoice/${value.id}?amount=1`,`ynxpay://invoice/${value.id}#approve`,`ynxpay://invoice/%69nvoice-original-001`,` ${value.id}`])assert.throws(()=>walletPayInvoiceID(reference));
});

for (const kind of ["declared", "multibyte", "stream"]) test(`Pay reference rejects ${kind} oversized bodies by bytes before parsing`, async () => {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { reads++; if (reads === 1) controller.enqueue(new Uint8Array(32769)); else controller.error(new Error("body must not be fully consumed")); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const response = kind === "stream" ? new Response(stream)
    : kind === "declared" ? new Response(JSON.stringify(value), { headers: { "content-length": "1073741824" } })
    : new Response(JSON.stringify({ ...value, ignoredMetadata: "界".repeat(20000) }));
  const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => response);
  await assert.rejects(() => client.invoice(value.id, () => {}), /PAY_RESPONSE_TOO_LARGE/);
  if (kind === "stream") { assert.equal(reads, 1); assert.equal(cancelled, true); }
});
test("invoice identity, native checksum, status, safe whole units and expiry bind the review",()=>{
  assertWalletPayReview(invoice(),account,Date.parse("2026-10-02T13:00:00Z"));
  assert.throws(()=>parseWalletPayInvoice({...value,id:"other-invoice"},value.id),/PAY_INVOICE_ID_MISMATCH/);
  for(const change of [{currency:"ETH"},{amount:0.25},{amount:Number.MAX_SAFE_INTEGER},{payoutAddress:payee.slice(0,-1)+(payee.endsWith("q")?"p":"q")},{status:"success"},{dueAt:value.createdAt},{dueAt:"2027-02-30T12:00:00Z"},{dueAt:"2027-02-28T12:00Z"}])assert.throws(()=>parseWalletPayInvoice({...value,...change},value.id));
  for(const change of [{status:"paid"},{status:"expired"},{dueAt:"2026-10-02T13:00:00Z"}])assert.throws(()=>assertWalletPayReview(parseWalletPayInvoice({...value,...change},value.id),account,Date.parse("2026-10-02T13:00:00Z")),/PAY_INVOICE_NOT_PAYABLE/);
});
test("reads use the existing Wallet client header and fixed API, never the scanned origin",async()=>{
  const calls:string[]=[];
  const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async(url,init)=>{calls.push(url);assert.equal(init.method,"GET");assert.equal(init.redirect,"error");assert.equal(init.credentials,"omit");assert.equal((init.headers as Record<string,string>)["X-YNX-Client"],"ynx-wallet-v1");return ok(value)});
  assert.deepEqual(await client.invoice(`ynxpay://invoice/${value.id}`,()=>{}),invoice());
  assert.deepEqual(calls,[`https://api.ynxweb4.com/app/pay/invoices/${value.id}`]);
  await assert.rejects(()=>client.invoice(`https://evil.invalid/invoices/${value.id}`,()=>{}));assert.equal(calls.length,1);
});
test("late body reads and transports that ignore abort still have a finite cancellation result",async()=>{
  const stopped=new AbortController();
  const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>({ok:true,redirected:false,url:"",text:()=>new Promise(()=>{})} as Response));
  const result=client.invoice(value.id,()=>{},stopped.signal);stopped.abort();
  await assert.rejects(result,/PAY_READ_CANCELLED/);
  const timeout=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>new Promise(()=>{}),5);
  await assert.rejects(()=>timeout.invoice(value.id,()=>{}),/PAY_READ_TIMEOUT/);
});
test("lock or account change after a read cannot publish another account invoice",async()=>{
  let active=true;
  const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>{active=false;return ok(value)});
  await assert.rejects(()=>client.invoice(value.id,()=>{if(!active)throw new Error("lease cancelled")}),/lease cancelled/);
});
test("auth loss, nonJSON and external redirects are typed failures without server text leaks",async()=>{
  for(const [response,code] of [[new Response("private-server-secret",{status:401}),"PAY_SESSION_REQUIRED"],[new Response("private-server-secret"),"PAY_INVALID_RESPONSE"],[{ok:true,redirected:true,url:"https://evil.invalid"},"PAY_READ_ORIGIN_MISMATCH"]] as const){
    const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>response as Response);
    await assert.rejects(()=>client.invoice(value.id,()=>{}),error=>error instanceof Error&&error.message===code&&!error.message.includes("private-server-secret"));
  }
});
test("a Pay paid flag cannot override an unknown native outbox or fabricated accepted phase",()=>{
  const settlement={id:"settlement-original-001",intentId:value.intentId,invoiceId:value.id,merchant:value.merchant,payoutAddress:payee,payer:account,amount:25,currency:"YNXT",transactionHash:"0x"+"a".repeat(64),blockNumber:2,status:"paid",auditHash:"b".repeat(64),createdAt:value.createdAt};
  for(const phase of ["unknown","observed","accepted","done"]){
    const transfer={account,phase,hash:settlement.transactionHash,origin:"https://rpc-testnet.ynxweb4.com",durabilityEvidence:null,transaction:{}} as NativeTransferOutboxEntry;
    assert.throws(()=>parseWalletPaySettlement(settlement,invoice(),account,transfer),/PAY_TRANSFER_NOT_DURABLE/);
  }
});
