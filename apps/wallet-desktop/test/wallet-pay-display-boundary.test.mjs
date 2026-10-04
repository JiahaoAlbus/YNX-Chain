import test from "node:test";
import assert from "node:assert/strict";
import {createDesktopPayUI,mountDesktopPayUI} from "../src/wallet-pay-ui.mjs";
import {fileInputDOM} from "./fixture-file-input-dom.mjs";

// Public renderer DTOs only. No factory, authority, real key or payment exists
// in this harness; malformed displays must never unlock an approval action.
const account="original-account",invoiceId="inv_"+"a".repeat(20);
const review=()=>({id:"original-review",account,invoiceId,merchant:"Merchant",recipient:"recipient",amount:25,fee:1,total:26,
  expiresAt:"2026-10-04T00:00:00Z",intentDigest:"a".repeat(64),paymentAuthorized:false});
const archived=()=>({account,hash:"0x"+"b".repeat(64),invoiceId,merchant:"Merchant",recipient:"recipient",amount:25,fee:1,total:26,
  status:"archived",checkpointVerified:true,settlementVerified:true,settlementAttempted:true,broadcastAttempted:true,consensusFinality:false});
function harness(){
  const views=[],calls={restore:0,approve:0};
  let status={ok:true,value:{available:true,reason:null,paymentAuthorized:false}},response={ok:true,value:{kind:"review",review:review()}};
  const api={payCancel:async()=>({ok:true}),payStatus:async()=>status,payRestore:async()=>{calls.restore++;return {ok:true,value:{kind:"original",original:null}}},
    payReview:async()=>response,payHistory:async()=>response,payAction:async()=>{calls.approve++;throw Error("No payment exists")}};
  const ui=createDesktopPayUI({api,getContext:()=>({open:true,account,keyRevision:1,locked:false}),render:value=>views.push(value)});
  return {ui,views,calls,status:value=>status=value,response:value=>response=value};
}
test("Pay readiness requires literal boolean success, never truthy status",async()=>{
  for(const ok of [1,"true",{},[]]){
    const h=harness();h.status({ok,value:{available:true,paymentAuthorized:false}});await h.ui.open();
    assert.equal(h.views.at(-1).available,false);assert.equal(h.calls.restore,0);assert.ok(h.views.at(-1).error);
  }
});
test("Pay review requires literal boolean success before approval",async()=>{
  for(const ok of [1,"true",{},[]]){
    const h=harness();await h.ui.open();h.response({ok,value:{kind:"review",review:review()}});await h.ui.review(invoiceId);
    assert.equal(h.views.at(-1).review,null);assert.ok(h.views.at(-1).error);await h.ui.approve();assert.equal(h.calls.approve,0);
  }
});
test("Pay response accessors are rejected without running them",async()=>{
  for(const location of ["envelope","review","history-row","history-array"]){
    const h=harness();await h.ui.open();let reads=0,value;
    if(location==="envelope")value={get ok(){reads++;return true},value:{kind:"review",review:review()}};
    if(location==="review"){const item=review();Object.defineProperty(item,"id",{enumerable:true,get(){reads++;return "unsafe-review"}});value={ok:true,value:{kind:"review",review:item}};}
    if(location==="history-row"){const row=archived();Object.defineProperty(row,"hash",{enumerable:true,get(){reads++;return "0x"+"b".repeat(64)}});value={ok:true,value:{account,records:[row],nextCursor:null}};}
    if(location==="history-array"){const rows=[archived()];Object.defineProperty(rows,"0",{enumerable:true,get(){reads++;return archived()}});value={ok:true,value:{account,records:rows,nextCursor:null}};}
    h.response(value);if(location.startsWith("history"))assert.equal(await h.ui.history(),null);else await h.ui.review(invoiceId);
    assert.equal(reads,0,location);assert.ok(h.views.at(-1).error,location);assert.equal(h.views.at(-1).review,null);
  }
});
test("Pay display rejects custom prototypes cycles and oversized hidden fields",async()=>{
  const exotic=Object.assign(Object.create({}),review()),cyclic=review();cyclic.self=cyclic;
  for(const item of [exotic,cyclic,{...review(),metadata:"x".repeat(513)}]){
    const h=harness();await h.ui.open();h.response({ok:true,value:{kind:"review",review:item}});await h.ui.review(invoiceId);
    assert.equal(h.views.at(-1).review,null);assert.ok(h.views.at(-1).error);await h.ui.approve();assert.equal(h.calls.approve,0);
  }
});
test("Pay histories reject sparse rows and custom iterators without executing them",async()=>{
  const sparse=new Array(1);let iterations=0;const iterable=[archived()];iterable[Symbol.iterator]=function*(){iterations++;yield archived()};
  for(const records of [sparse,iterable]){
    const h=harness();await h.ui.open();h.response({ok:true,value:{account,records,nextCursor:null}});
    assert.equal(await h.ui.history(),null);assert.ok(h.views.at(-1).error);
  }
  assert.equal(iterations,0);
});
test("valid Pay review and archived display facts are detached and frozen",async()=>{
  const h=harness();await h.ui.open();const item=review();h.response({ok:true,value:{kind:"review",review:item}});await h.ui.review(invoiceId);
  const saved=h.views.at(-1).review;assert.equal(saved.id,"original-review");assert.equal(Object.isFrozen(saved),true);item.id="replacement";assert.equal(saved.id,"original-review");
  const row=archived();h.response({ok:true,value:{kind:"archived",original:row}});await h.ui.restore();
  // Restore's harness returns null; use the actual review result branch for an
  // archived paid invoice rather than manufacturing a main operation.
  h.response({ok:true,value:{kind:"archived",original:row}});await h.ui.review(invoiceId);
  const original=h.views.at(-1).original;assert.equal(original.hash,row.hash);assert.equal(Object.isFrozen(original),true);
  row.status="transfer_unconfirmed";assert.equal(original.status,"archived");
});
test("null-prototype public DTOs and shared references remain compatible",async()=>{
  const h=harness();await h.ui.open();const item=Object.assign(Object.create(null),review());
  h.response({ok:true,value:{kind:"review",review:item,metadata:item}});await h.ui.review(invoiceId);
  assert.equal(h.views.at(-1).review.id,"original-review");assert.equal(Object.isFrozen(h.views.at(-1).review),true);assert.equal(h.views.at(-1).error,null);
});
test("mounted Pay QR accepts only detached literal success and never reviews or pays by scanning",async()=>{
  let reads=0;const qr={invoiceID:invoiceId,decodedLocally:true,uploaded:false},accessor={...qr};
  Object.defineProperty(accessor,"invoiceID",{enumerable:true,get(){reads++;return invoiceId}});
  for(const response of [{ok:"true",value:qr},{ok:true,value:accessor},{ok:true,value:Object.assign(Object.create({}),qr)},{ok:true,value:{...qr,uploaded:true}},{ok:true,value:qr}]){
    const nodes=new Map(),get=selector=>{
      if(!nodes.has(selector))nodes.set(selector,{open:false,value:"",hidden:false,disabled:false,textContent:"",children:[],listeners:new Map(),
        addEventListener(type,fn){this.listeners.set(type,fn)},emit(type,event={}){return this.listeners.get(type)?.(event)},
        showModal(){this.open=true},close(){this.open=false;this.listeners.get("close")?.()},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});
      return nodes.get(selector);
    };
    let reviews=0,actions=0;
    const api={payCancel:async()=>({ok:true}),payStatus:async()=>({ok:true,value:{available:true,paymentAuthorized:false}}),
      payRestore:async()=>({ok:true,value:{kind:"original",original:null}}),payReview:async()=>{reviews++;throw Error("No automatic review")},
      payAction:async()=>{actions++;throw Error("No automatic action")},invoiceReferenceQR:async()=>response,onSecurityState:()=>{},onAccountStatus:()=>{}};
    mountDesktopPayUI({document:{querySelector:selector=>fileInputDOM(get(selector),next=>nodes.set(selector,next)),createElement:()=>({textContent:""})},api,
      getContext:()=>({account,keyRevision:1,locked:false})});
    get("#open-protected-pay").emit("click");await new Promise(resolve=>setImmediate(resolve));
    get("#protected-pay-reference").value="existing-reference";
    const input=get("#protected-pay-qr");input.emit("click");input.files=[{type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)}];await input.emit("change");
    assert.equal(get("#protected-pay-reference").value,response.value===qr&&response.ok===true?invoiceId:"existing-reference");
    assert.equal(reviews,0);assert.equal(actions,0);get("#protected-pay-sheet").close();
  }
  assert.equal(reads,0);
});
