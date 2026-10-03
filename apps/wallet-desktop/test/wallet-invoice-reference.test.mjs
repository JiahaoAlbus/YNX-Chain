import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {WalletPayInvoiceClient,parseWalletPayInvoice,walletPayInvoiceID} from "../src/wallet-pay-invoice-reference.mjs";
import {createInvoiceReferenceService} from "../src/wallet-invoice-reference-service.mjs";
import {createInvoiceReferenceUI} from "../src/wallet-invoice-reference-ui.mjs";
const account="0x"+"1".repeat(40),payee=ynxAddressFromEVM("0x"+"2".repeat(40));
const invoice={id:"invoice-original-001",intentId:"intent-original-001",merchant:"Original merchant",payoutAddress:payee,amount:25,currency:"YNXT",status:"issued",createdAt:"2026-10-02T12:00:00Z",dueAt:"2026-10-03T12:00:00Z"};
const ok=value=>new Response(JSON.stringify(value));

test("Pay byte limit accepts exactly 32 KiB and preserves split UTF-8 characters", async () => {
  const empty = JSON.stringify({ ...invoice, ignoredMetadata: "" });
  const exact = JSON.stringify({ ...invoice, ignoredMetadata: "x".repeat(32768 - empty.length) });
  assert.equal(Buffer.byteLength(exact), 32768);
  assert.deepEqual(await new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => new Response(exact)).invoice(invoice.id, () => {}), invoice);
  const unicode = { ...invoice, merchant: "商戶 🚀" }, bytes = Buffer.from(JSON.stringify(unicode));
  let offset = 0;
  const body = new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    const next = Math.min(offset + 7, bytes.length);
    controller.enqueue(new Uint8Array(bytes.subarray(offset, next))); offset = next;
  } }, { highWaterMark: 0 });
  const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => new Response(body));
  assert.deepEqual(await client.invoice(invoice.id, () => {}), unicode);
});
test("non-streaming mobile transport retains finite reads and enforces UTF-8 bytes", async () => {
  for (const oversized of [false, true]) {
    const raw = JSON.stringify(oversized ? { ...invoice, ignoredMetadata: "界".repeat(20000) } : invoice);
    const response = { ok: true, redirected: false, url: "", text: async () => raw };
    const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => response);
    if (oversized) await assert.rejects(() => client.invoice(invoice.id, () => {}), /PAY_RESPONSE_TOO_LARGE/);
    else assert.deepEqual(await client.invoice(invoice.id, () => {}), invoice);
  }
});
for (const action of ["cancel", "timeout"]) test(`stalled Pay stream releases its reader after ${action}`, async () => {
  let cancelled = false, reading = false;
  const body = new ReadableStream({ pull() { reading = true; return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const abort = new AbortController();
  const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => new Response(body), action === "timeout" ? 5 : 8000);
  const pending = client.invoice(invoice.id, () => {}, abort.signal);
  if (action === "cancel") { await new Promise(resolve => setImmediate(resolve)); assert.equal(reading, true); abort.abort(); }
  await assert.rejects(pending, action === "cancel" ? /PAY_READ_CANCELLED/ : /PAY_READ_TIMEOUT/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
test("original Pay ID/deep link/checkout syntax accepts a reference only, never a supplied origin or action",()=>{
  for(const reference of [invoice.id,`ynxpay://invoice/${invoice.id}`,`https://pay.ynxweb4.com/invoices/${invoice.id}`,`/pay/checkout/${invoice.id}`])assert.equal(walletPayInvoiceID(reference),invoice.id);
  for(const reference of [`https://evil.invalid/invoices/${invoice.id}`,`https://pay.ynxweb4.com@evil.invalid/invoices/${invoice.id}`,`ynxpay://invoice/${invoice.id}?amount=1`,`ynxpay://invoice/${invoice.id}#approve`,`ynxpay://invoice/%69nvoice-original-001`,` ${invoice.id}`])assert.throws(()=>walletPayInvoiceID(reference));
});

for (const kind of ["declared", "multibyte", "stream"]) test(`Pay reference rejects ${kind} oversized bodies by bytes before parsing`, async () => {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { reads++; if (reads === 1) controller.enqueue(new Uint8Array(32769)); else controller.error(new Error("body must not be fully consumed")); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const response = kind === "stream" ? new Response(stream)
    : kind === "declared" ? new Response(JSON.stringify(invoice), { headers: { "content-length": "1073741824" } })
    : new Response(JSON.stringify({ ...invoice, ignoredMetadata: "界".repeat(20000) }));
  const client = new WalletPayInvoiceClient("https://api.ynxweb4.com", async () => response);
  await assert.rejects(() => client.invoice(invoice.id, () => {}), /PAY_RESPONSE_TOO_LARGE/);
  if (kind === "stream") { assert.equal(reads, 1); assert.equal(cancelled, true); }
});
test("legacy projection validates native checksum, exact invoice, whole amount, date and known status without claiming trust",()=>{
  assert.deepEqual(parseWalletPayInvoice(invoice,invoice.id),invoice);
  for(const patch of [{id:"other-invoice"},{currency:"ETH"},{amount:0.25},{amount:Number.MAX_SAFE_INTEGER},{payoutAddress:"0x"+"2".repeat(40)},{status:"success"},{dueAt:invoice.createdAt},{dueAt:"2027-02-30T12:00:00Z"}])assert.throws(()=>parseWalletPayInvoice({...invoice,...patch},invoice.id));
  const parsed=parseWalletPayInvoice({...invoice,status:"paid",signingPublicKey:"untrusted"},invoice.id);
  assert.equal(parsed.status,"paid");assert.equal("signingPublicKey" in parsed,false);assert.equal("paymentAuthorized" in parsed,false);
});
test("queries use only fixed existing GET with no session, secret, payment or QR-origin authority",async()=>{
  const calls=[];const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async(url,init)=>{calls.push(url);assert.equal(init.method,"GET");assert.equal(init.redirect,"error");assert.equal(init.credentials,"omit");assert.equal(init.headers["X-YNX-Client"],"ynx-wallet-v1");return ok(invoice)});
  await client.invoice(`ynxpay://invoice/${invoice.id}`,()=>{});assert.deepEqual(calls,[`https://api.ynxweb4.com/app/pay/invoices/${invoice.id}`]);
  await assert.rejects(()=>client.invoice(`https://evil.invalid/invoices/${invoice.id}`,()=>{}));assert.equal(calls.length,1);
});
test("session loss, redirect, oversized/malformed response and timeout fail without echoing server content",async()=>{
  for(const [response,code] of [[new Response("server-secret",{status:401}),"PAY_SESSION_REQUIRED"],[new Response("server-secret"),"PAY_INVALID_RESPONSE"],[new Response("x".repeat(32769)),"PAY_RESPONSE_TOO_LARGE"],[{ok:true,redirected:true,url:"https://evil.invalid"},"PAY_READ_ORIGIN_MISMATCH"]]){
    const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>response);await assert.rejects(()=>client.invoice(invoice.id,()=>{}),error=>error.message===code&&!error.message.includes("server-secret"));
  }
  const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>new Promise(()=>{}),5);await assert.rejects(()=>client.invoice(invoice.id,()=>{}),/PAY_READ_TIMEOUT/);
});
test("service reports a paid flag only as untrusted projection, never permission or verified settlement",async()=>{
  const request=createInvoiceReferenceService({client:new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>ok({...invoice,status:"paid"})),getContext:()=>({account,revision:1,focused:true})});
  const result=await request(invoice.id);assert.equal(result.paymentAuthorized,false);assert.equal(result.settlementVerified,false);assert.equal(result.trust,"legacy-service-projection-not-signed-invoice");
});
for(const change of ["account","lock","blur"]){test(`service cannot publish after ${change}`,async()=>{
  const context={account,revision:1,focused:true};let finish;
  const request=createInvoiceReferenceService({client:{origin:"https://api.ynxweb4.com",invoice:()=>new Promise(resolve=>finish=resolve)},getContext:()=>({...context})});
  const pending=request(invoice.id);if(change==="account")context.account="other";if(change==="lock")context.revision++;if(change==="blur")context.focused=false;finish(invoice);await assert.rejects(()=>pending,/context changed/);
})}
const result={invoice,account,source:"https://api.ynxweb4.com",trust:"legacy-service-projection-not-signed-invoice",paymentAuthorized:false,settlementVerified:false};
for(const change of ["close","account","lock","edit","same-account-reopen"]){test(`invoice UI ignores old response after ${change}`,async()=>{
  const context={open:true,account,keyRevision:1},views=[];let finish;
  const ui=createInvoiceReferenceUI({getContext:()=>({...context}),request:()=>new Promise(resolve=>finish=resolve),render:view=>views.push(view)});
  const pending=ui.check(invoice.id);if(change==="close")context.open=false;if(change==="account")context.account="other";if(change==="lock")context.keyRevision++;if(["edit","same-account-reopen"].includes(change))ui.clear();
  const last=views.at(-1);finish({ok:true,value:result});await pending;assert.equal(views.at(-1),last);
})}
test("UI never upgrades lookup to signing, paid proof, a different account or a new origin",async()=>{
  for(const patch of [{paymentAuthorized:true},{settlementVerified:true},{trust:"signed"},{account:"other"},{source:"https://evil.invalid"}]){
    let view;const ui=createInvoiceReferenceUI({getContext:()=>({open:true,account,keyRevision:1}),request:async()=>({ok:true,value:{...result,...patch}}),render:value=>view=value});await ui.check(invoice.id);assert.equal(view.result,null);assert.ok(view.error);
  }
  let view;const ui=createInvoiceReferenceUI({getContext:()=>({open:true,account,keyRevision:1}),request:async()=>({ok:true,value:result}),render:value=>view=value});await ui.check(invoice.id);assert.equal(view.result.invoice.id,invoice.id);
});
test("actual Wallet markup and main/preload entry mount query only, never a grey payment substitute",async()=>{
  const html=await readFile(new URL("../src/index.html",import.meta.url),"utf8"),main=await readFile(new URL("../src/main.mjs",import.meta.url),"utf8"),preload=await readFile(new URL("../src/preload.cjs",import.meta.url),"utf8");
  assert.match(html,/id="open-invoice"/);assert.match(html,/id="invoice-sheet"/);assert.match(html,/Cancel without payment/);
  assert.match(main,/handleWalletIPC\("wallet:invoice-reference"/);assert.match(preload,/invoiceReference: reference/);
  assert.doesNotMatch(html.match(/<dialog id="invoice-sheet"[\s\S]*?<\/dialog>/)[0],/id="(?:pay|approve-invoice|confirm-payment)"/);
});
test("mounted renderer opens invoice modal, queries only on explicit submit, and renders reported—not trusted—facts",async()=>{
  const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8"),nodes=new Map(),calls=[];
  const get=selector=>{if(!nodes.has(selector)){nodes.set(selector,{value:"",open:false,textContent:"",disabled:false,children:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},showModal(){this.open=true},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}})}return nodes.get(selector)};
  let qrReads=0;
  const document={querySelector:get,createElement:()=>({textContent:""})},api={async invoiceReferenceQR(input){qrReads++;assert.equal(input.mimeType,"image/png");assert.equal(input.bytes.byteLength,1);return {ok:true,value:{invoiceID:invoice.id,decodedLocally:true,uploaded:false}}},async invoiceReference(reference){calls.push(reference);return {ok:true,value:{...result,invoice:{...invoice,status:"paid",merchant:"<script>untrusted</script>"}}}}};
  const start=source.indexOf("const invoiceSheet="),end=source.indexOf("const contractSheet =",start);assert.ok(start>=0&&end>start);
  runInNewContext(source.slice(start,end),{document,window:{ynxWallet:api},createInvoiceReferenceUI,accountState:{account},keyState:{revision:1},nativeAccountLabel:value=>value});
  get("#open-invoice").listeners.get("click")();assert.equal(get("#invoice-sheet").open,true);assert.equal(calls.length,0);
  const fileInput={value:"chosen-file",files:[{type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)}]};
  // A synthetic/stale change without the chooser-opening intent is rejected.
  get("#invoice-qr").listeners.get("change")({target:fileInput});await new Promise(resolve=>setImmediate(resolve));assert.equal(qrReads,0);assert.equal(calls.length,0);
  get("#invoice-qr").listeners.get("click")();
  const changedFile={value:"chosen-file",files:[{type:"image/png",size:2,arrayBuffer:async()=>new ArrayBuffer(1)}]};
  get("#invoice-qr").listeners.get("change")({target:changedFile});await new Promise(resolve=>setImmediate(resolve));assert.equal(qrReads,0);assert.equal(calls.length,0);assert.match(get("#invoice-status").textContent,/No supported Pay invoice reference/);
  get("#invoice-qr").listeners.get("click")();
  get("#invoice-qr").listeners.get("change")({target:fileInput});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fileInput.value,"");assert.equal(qrReads,1);assert.equal(calls.length,0);assert.equal(get("#invoice-reference").value,invoice.id);assert.match(get("#invoice-status").textContent,/Nothing was uploaded, queried or paid/);
  get("#invoice-reference").value=invoice.id;get("#invoice-form").listeners.get("submit")({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[invoice.id]);assert.match(get("#invoice-status").textContent,/not a trusted signed invoice/);
  assert.ok(get("#invoice-facts").children.some(node=>node.textContent==="Reported merchant"));assert.ok(get("#invoice-facts").children.some(node=>node.textContent==="<script>untrusted</script>"));
  get("#invoice-sheet").open=false;get("#invoice-sheet").listeners.get("close")();assert.equal(get("#invoice-facts").children.length,0);
});
