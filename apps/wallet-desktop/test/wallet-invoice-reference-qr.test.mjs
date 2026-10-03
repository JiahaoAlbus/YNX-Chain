import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import {decodeInvoiceReferenceQR} from "../src/wallet-invoice-reference-qr.mjs";
import {createInvoiceReferenceUI} from "../src/wallet-invoice-reference-ui.mjs";
const id="invoice-original-001",reference=`ynxpay://invoice/${id}`,account="0x"+"1".repeat(40);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const fixture=text=>({bytes:Buffer.from("synthetic-image-container"),mimeType:"image/png",createImage:()=>({isEmpty:()=>false,getSize:()=>({width:1,height:1}),toBitmap:()=>Buffer.alloc(4)}),decode:()=>({data:text})});
test("real encoded invoice QR pixels independently decode through the production local decoder to an ID only",()=>{
  const qr=QRCode.create(reference,{errorCorrectionLevel:"M"}),scale=8,margin=4,width=(qr.modules.size+margin*2)*scale,pixels=Buffer.alloc(width*width*4,255);
  for(let y=0;y<qr.modules.size;y++)for(let x=0;x<qr.modules.size;x++)if(qr.modules.get(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++)pixels.set([0,0,0,255],(((y+margin)*scale+dy)*width+(x+margin)*scale+dx)*4);
  const result=decodeInvoiceReferenceQR({bytes:Buffer.from("synthetic-image-container"),mimeType:"image/png",createImage:()=>({isEmpty:()=>false,getSize:()=>({width,height:width}),toBitmap:()=>pixels})});
  assert.deepEqual(result,{invoiceID:id,decodedLocally:true,uploaded:false});assert.equal("amount" in result,false);assert.equal("uri" in result,false);
});
test("foreign origins, actions, encoded paths, pairing and arbitrary signed-looking JSON cannot become a reference",()=>{
  for(const text of [`https://evil.invalid/invoices/${id}`,reference+"?amount=25",reference+"#approve","ynxpay://invoice/%69nvoice-original-001","wc:synthetic@2?relay-protocol=irn",JSON.stringify({invoiceId:id,amount:25,signature:"untrusted"})])assert.throws(()=>decodeInvoiceReferenceQR(fixture(text)));
  assert.throws(()=>decodeInvoiceReferenceQR({...fixture(reference),mimeType:"image/svg+xml"}));
  assert.throws(()=>decodeInvoiceReferenceQR({...fixture(reference),bytes:Buffer.alloc(10*1024*1024+1)}));
});
function harness(){
  const context={open:true,account,keyRevision:1},references=[],views=[],decoded=deferred();let decodes=0,queries=0;
  const ui=createInvoiceReferenceUI({getContext:()=>({...context}),request:async()=>{queries++;throw Error("must not query")},requestQR:()=>{decodes++;return decoded.promise},applyReference:value=>references.push(value),render:view=>views.push(view)});
  return {ui,context,references,views,decoded,decodes:()=>decodes,queries:()=>queries};
}
test("QR decode fills only a public reference and never implicitly queries, signs or pays",async()=>{
  const h=harness(),job=h.ui.importQR(async()=>({bytes:new ArrayBuffer(1),mimeType:"image/png"}));await Promise.resolve();
  h.decoded.resolve({ok:true,value:{invoiceID:id,decodedLocally:true,uploaded:false}});await job;
  assert.deepEqual(h.references,[id]);assert.equal(h.queries(),0);assert.match(h.views.at(-1).notice,/Nothing was uploaded, queried or paid/);
});
for(const phase of ["file","decode"]){for(const change of ["account","lock","close","edit","same-account-reopen"]){test(`QR ${phase} late result is cancelled by ${change}`,async()=>{
  const h=harness(),file=deferred(),job=h.ui.importQR(()=>file.promise);
  if(phase==="decode"){file.resolve({bytes:new ArrayBuffer(1),mimeType:"image/png"});await Promise.resolve()}
  if(change==="account")h.context.account="other";if(change==="lock")h.context.keyRevision++;if(change==="close")h.context.open=false;if(["edit","same-account-reopen"].includes(change))h.ui.clear();
  const last=h.views.at(-1);file.resolve({bytes:new ArrayBuffer(1),mimeType:"image/png"});h.decoded.resolve({ok:true,value:{invoiceID:id,decodedLocally:true,uploaded:false}});await job;
  assert.deepEqual(h.references,[]);assert.equal(h.queries(),0);assert.equal(h.views.at(-1),last);if(phase==="file")assert.equal(h.decodes(),0);
})}}
test("nonlocal, uploaded, action-bearing and failed decode results cannot fill the invoice form",async()=>{
  for(const response of [{ok:false},{ok:true,value:{invoiceID:id,decodedLocally:false,uploaded:false}},{ok:true,value:{invoiceID:id,decodedLocally:true,uploaded:true}},{ok:true,value:{invoiceID:reference,decodedLocally:true,uploaded:false}}]){
    const h=harness(),job=h.ui.importQR(async()=>({}));await Promise.resolve();h.decoded.resolve(response);await job;assert.deepEqual(h.references,[]);assert.ok(h.views.at(-1).error);assert.equal(h.queries(),0);
  }
});
test("invoice chooser binds the account before opening and consumes selection once",async()=>{
  const h=harness();h.ui.captureQRSelection();let reads=0;
  const job=h.ui.importSelectedQR(async()=>{reads++;return {}});await Promise.resolve();
  await h.ui.importSelectedQR(async()=>{throw Error("second read")});
  h.decoded.resolve({ok:true,value:{invoiceID:id,decodedLocally:true,uploaded:false}});await job;
  assert.equal(reads,1);assert.equal(h.decodes(),1);assert.equal(h.queries(),0);assert.deepEqual(h.references,[id]);
});
for(const change of ["account","key-revision","close","edit","same-account-return"]){test(`invoice chooser opened before ${change} cannot read or decode its later selected file`,async()=>{
  const h=harness();h.ui.captureQRSelection();
  if(change==="account")h.context.account="other";
  if(change==="key-revision")h.context.keyRevision++;
  if(change==="close")h.context.open=false;
  if(change==="edit")h.ui.clear();
  if(change==="same-account-return"){h.ui.clear();h.context.account="other";h.ui.clear();h.context.account=account}
  let reads=0;await h.ui.importSelectedQR(async()=>{reads++;return {}});
  assert.equal(reads,0);assert.equal(h.decodes(),0);assert.equal(h.queries(),0);assert.deepEqual(h.references,[]);
})}
test("no account or closed sheet cannot capture a chooser intent",async()=>{
  for(const change of [{account:null},{open:false}]){const h=harness();Object.assign(h.context,change);h.ui.captureQRSelection();Object.assign(h.context,{account,open:true});await h.ui.importSelectedQR(async()=>{throw Error("must not read")});assert.equal(h.decodes(),0);assert.equal(h.queries(),0)}
});
