import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createPaymentRecipientUI} from "../src/payment-recipient-ui.mjs";
import {createRecipientScanUI} from "../src/recipient-scan-ui.mjs";
import {fileInputDOM} from "./fixture-file-input-dom.mjs";

const address="ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt";
const result={ok:true,value:{ynxAccount:address,chainId:"ynx_6423-1",asset:"YNXT"}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function mounted({decode=async()=>result,parse=async()=>result}={}){
  const nodes=new Map();
  function node(){return {listeners:{},value:"",files:[],open:true,hidden:true,addEventListener(type,fn){this.listeners[type]=fn},focus(){}}}
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector)};
  nodes.set("#recipient-qr-file",fileInputDOM(node(),next=>nodes.set("#recipient-qr-file",next)));
  const events=[],camera={starts:0,stops:0,start(){this.starts++},stop(){this.stops++}};
  const document={querySelector:get,createElement:()=>({}),addEventListener(){},hasFocus:()=>true,visibilityState:"visible"};
  const source=readFileSync(new URL("../src/renderer.js",import.meta.url),"utf8");
  const start=source.indexOf("let paymentDraftRevision = 0;"),end=source.indexOf("// Public metadata was identity-checked",start);
  assert.ok(start>=0&&end>start);
  const context={document,keyState:{locked:false,authenticating:false,revision:1},accountState:{account:"original-public"},transferReview:{id:"old-review"},
    createPaymentRecipientUI,createRecipientScanUI,createRecipientCameraUI:()=>camera,captureRecipientFrame:()=>{},
    navigator:{mediaDevices:{}},copyUI:(node,text)=>{node.textContent=text;events.push(text)},
    window:{addEventListener(){},ynxWallet:{paymentRecipient:parse,paymentQR:decode}}};
  runInNewContext(source.slice(start,end)+"\nglobalThis.input=paymentRecipientUI;globalThis.draft=()=>paymentDraftRevision;",context);
  const image=(bytes=async()=>new ArrayBuffer(1))=>context.input.image({type:"image/png",size:1,arrayBuffer:bytes});
  const choose=()=>get("#scan-recipient").listeners.click();
  return {get,context,camera,events,image,choose};
}

for(const replacement of ["chooser","camera"])for(const stage of ["bytes","decode","paste"]){
  test(`new ${replacement} retires old recipient ${stage} without filling or clearing the new draft`,async()=>{
    const pending=deferred();
    const h=mounted({decode:()=>stage==="decode"?pending.promise:Promise.resolve(result),parse:()=>pending.promise});
    const old=stage==="paste"?h.context.input.text(address):h.image(stage==="bytes"?()=>pending.promise:undefined);
    await tick();
    const before=h.context.draft();
    if(replacement==="chooser")h.choose();else h.get("#start-recipient-camera").listeners.click();
    h.get("#transfer-to").value="new draft recipient";h.get("#transfer-amount").value="27";
    h.get("#recipient-status").textContent="new input notice";
    pending.resolve(stage==="bytes"?new ArrayBuffer(1):result);await old;await tick();
    assert.equal(h.get("#transfer-to").value,"new draft recipient");
    assert.equal(h.get("#transfer-amount").value,"27");
    assert.equal(h.get("#recipient-status").textContent,"new input notice");
    assert.ok(h.context.draft()>before,"explicit replacement must own a new Send draft");
    assert.equal(h.camera.starts,replacement==="camera"?1:0);
  });
}
test("fresh chooser result still fills only recipient and requires a new amount/review",async()=>{
  const h=mounted();h.choose();
  const input=h.get("#recipient-qr-file");input.listeners.click();
  input.files=[{type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)}];input.listeners.change();await tick();
  assert.equal(h.get("#transfer-to").value,address);assert.equal(h.get("#transfer-amount").value,"");
  assert.equal(h.context.transferReview,null);assert.equal(h.camera.starts,0);
});
test("starting camera retires an outstanding native chooser before its file returns",async()=>{
  let decodes=0;
  const h=mounted({decode:async()=>{decodes++;return result}});h.choose();
  const old=h.get("#recipient-qr-file");old.listeners.click();
  h.get("#start-recipient-camera").listeners.click();
  assert.notEqual(h.get("#recipient-qr-file"),old);
  old.files=[{type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)}];old.listeners.change();await tick();
  assert.equal(decodes,0);assert.equal(h.get("#transfer-to").value,"");assert.equal(h.camera.starts,1);
});
