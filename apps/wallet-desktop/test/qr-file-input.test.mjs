import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createQRFileInput} from "../src/qr-file-input.mjs";
import {createInvoiceReferenceUI} from "../src/wallet-invoice-reference-ui.mjs";
import {fileInputDOM} from "./fixture-file-input-dom.mjs";

function fixture(){
  let input;
  const node={id:"invoice-qr",accept:"image/png,image/jpeg,image/webp",ariaDescribedBy:"invoice-status",value:"",files:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},emit(type){return this.listeners.get(type)?.()},focus(){this.focused=true}};
  input=fileInputDOM(node,next=>input=next);
  return {document:{querySelector:()=>input},get input(){return input}};
}

test("cancel and empty selection never decode; detached cancellations cannot affect the current picker",()=>{
  const f=fixture();let cancelled=0,selected=0;
  const ui=createQRFileInput({document:f.document,selector:"#invoice-qr",onCancel:()=>cancelled++,onChange:()=>selected++});
  f.input.emit("cancel");f.input.emit("change");assert.equal(cancelled,2);assert.equal(selected,0);
  const old=f.input;ui.invalidate();old.emit("cancel");old.emit("change");assert.equal(cancelled,2);
  f.input.files=[{name:"current"}];f.input.emit("change");assert.equal(selected,1);
});

test("file chooser invalidation preserves original field attributes but detaches old callbacks and selections",()=>{
  const f=fixture(),selected=[],opened=[];
  const ui=createQRFileInput({document:f.document,selector:"#invoice-qr",onClick:()=>opened.push(true),onChange:file=>selected.push(file)}),old=f.input;
  old.value="chosen";old.files=[{name:"old"}];ui.invalidate();const fresh=f.input;
  assert.notEqual(fresh,old);assert.equal(old.value,"");assert.deepEqual(fresh.files,[]);
  for(const key of ["id","accept","ariaDescribedBy"])assert.equal(fresh[key],old[key]);
  old.emit("click");old.emit("change");assert.deepEqual(opened,[]);assert.deepEqual(selected,[]);
  ui.focus();assert.equal(fresh.focused,true);fresh.emit("click");fresh.files=[{name:"new"}];fresh.value="chosen";fresh.emit("change");
  assert.equal(opened.length,1);assert.equal(selected[0].name,"new");assert.equal(fresh.value,"");
});

test("every invalidation has its own node, so repeated close/reopen cannot resurrect an intermediate picker",()=>{
  const f=fixture(),selected=[],ui=createQRFileInput({document:f.document,selector:"#invoice-qr",onChange:file=>selected.push(file)}),old=f.input;
  ui.invalidate();const middle=f.input;ui.invalidate();const fresh=f.input;
  for(const node of [old,middle]){node.files=[{name:"stale"}];node.emit("change")}
  assert.deepEqual(selected,[]);fresh.files=[{name:"current"}];fresh.emit("change");assert.equal(selected[0].name,"current");
});

test("ordinary invoice picker cannot borrow a new same-account reference lease before any file read or IPC",async()=>{
  const f=fixture(),context={open:true,account:"original-public-account",keyRevision:1},views=[];let reference="new-draft",reads=0,decodes=0;
  const invoice=createInvoiceReferenceUI({getContext:()=>({...context}),request:()=>{throw Error("No service read")},requestQR:async()=>{decodes++;return {ok:true,value:{invoiceID:"inv_aaaaaaaaaaaaaaaaaaaa",decodedLocally:true,uploaded:false}}},applyReference:value=>reference=value,render:view=>views.push(view)});
  const chooser=createQRFileInput({document:f.document,selector:"#invoice-qr",onClick:()=>invoice.captureQRSelection(),onChange:file=>invoice.importSelectedQR(async()=>{reads++;return {mimeType:file.type,bytes:await file.arrayBuffer()}})});
  const old=f.input;old.emit("click");chooser.invalidate();invoice.clear();const current=f.input;current.emit("click");
  old.files=[{type:"image/png",arrayBuffer:()=>{throw Error("Old file must not be read")}}];await old.emit("change");
  assert.equal(reads,0);assert.equal(decodes,0);assert.equal(reference,"new-draft");
  current.files=[{type:"image/png",arrayBuffer:async()=>new ArrayBuffer(1)}];await current.emit("change");
  assert.equal(reads,1);assert.equal(decodes,1);assert.equal(reference,"inv_aaaaaaaaaaaaaaaaaaaa");assert.equal(views.at(-1).result,null);
});

test("normal renderer and protected Pay use rotating inputs at all existing close/edit/account boundaries",async()=>{
  const renderer=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8"),pay=await readFile(new URL("../src/wallet-pay-ui.mjs",import.meta.url),"utf8");
  assert.match(renderer,/const invoiceQR=createQRFileInput/);
  assert.match(renderer,/function clearInvoiceInput\(\)\{invoiceQR.invalidate\(\);invoiceUI.clear\(\)\}/);
  assert.match(renderer,/invoiceSheet.addEventListener\("close",clearInvoiceInput\)/);
  assert.match(renderer,/invoiceSheet.addEventListener\("cancel",clearInvoiceInput\)/);
  assert.match(renderer,/if \(state.revision !== keyState.revision \|\| state.locked !== keyState.locked\) clearInvoiceInput\(\)/);
  const account=renderer.slice(renderer.indexOf("function renderAccount("),renderer.indexOf("function renderAccount(")+200);assert.match(account,/clearInvoiceInput\(\)/);
  assert.match(pay,/const qrFile=createQRFileInput/);assert.match(pay,/const invalidate=\(\)=>\{qrRevision\+\+;qrIntent=null;qrFile.invalidate\(\)/);
  assert.match(pay,/reference.addEventListener\("input",\(\)=>\{qrRevision\+\+;qrIntent=null;qrFile.invalidate\(\)/);
});
