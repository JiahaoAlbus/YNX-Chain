import assert from "node:assert/strict";
import test from "node:test";
import {createRecipientScanUI} from "../src/recipient-scan-ui.mjs";
function mounted(){
  const node=()=>({value:"",hidden:true,files:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn},focus(){this.focused=true}}),entry=node(),panel=node(),input=node(),calls=[];
  const context={open:true,locked:false,account:"original-public-account",keyRevision:2,draftRevision:3};
  const document={querySelector:selector=>({"#scan-recipient":entry,"#recipient-scan-panel":panel,"#recipient-qr-file":input})[selector]};
  const ui=createRecipientScanUI({document,getContext:()=>({...context}),image:file=>calls.push(file)});
  return{ui,context,entry,panel,input,calls};
}
test("normal Scan entry opens an image chooser without decoding, camera, signing or paying",()=>{
  const h=mounted();h.entry.listeners.click();assert.equal(h.panel.hidden,false);assert.equal(h.input.focused,true);assert.deepEqual(h.calls,[]);
  const file={type:"image/png"};h.input.files=[file];h.input.listeners.change();assert.deepEqual(h.calls,[file]);assert.equal(h.input.value,"");h.input.listeners.change();assert.equal(h.calls.length,1);
});
test("account, lock, key revision, draft changes and closure invalidate a previously opened chooser",()=>{
  for(const mutation of [{account:"other"},{locked:true},{keyRevision:3},{draftRevision:4},{open:false}]){const h=mounted();h.entry.listeners.click();Object.assign(h.context,mutation);h.input.files=[{type:"image/png"}];h.input.listeners.change();assert.deepEqual(h.calls,[])}
  const h=mounted();h.entry.listeners.click();h.ui.invalidate();assert.equal(h.panel.hidden,true);h.input.listeners.change();assert.deepEqual(h.calls,[]);
});
test("a locked, closed or missing-account Send draft never opens a scan chooser",()=>{
  for(const mutation of [{locked:true},{open:false},{account:null}]){const h=mounted();Object.assign(h.context,mutation);h.entry.listeners.click();assert.equal(h.panel.hidden,true);assert.deepEqual(h.calls,[])}
});
