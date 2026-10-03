import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {WALLET_COPY,WALLET_LOCALES,WALLET_STATIC_COPY,initWalletLocale} from "../src/wallet-locale.mjs";
import {PAY_COPY} from "../src/wallet-locale-pay.mjs";
import {PAY_NOTICE_COPY} from "../src/wallet-locale-pay-notices.mjs";
import {mountDesktopPayUI} from "../src/wallet-pay-ui.mjs";
import {signedPayFixture} from "./fixture-signed-pay.mjs";
test("all 58 Pay labels/notices are explicitly translated in each existing locale with unchanged parameters",()=>{
  const params=value=>[...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match=>match[1]).sort();
  assert.deepEqual(Object.keys(PAY_COPY),WALLET_LOCALES);assert.deepEqual(Object.keys(PAY_NOTICE_COPY),WALLET_LOCALES);
  for(const locale of WALLET_LOCALES)for(const source of [PAY_COPY,PAY_NOTICE_COPY]){
    assert.equal(Object.keys(source[locale]).length,Object.keys(source.en).length);
    for(const key of Object.keys(source.en)){assert.ok(source[locale][key]);assert.equal(WALLET_COPY[locale][key],source[locale][key]);assert.deepEqual(params(source[locale][key]),params(key));if(locale!=="en")assert.notEqual(source[locale][key],key)}
  }
});
test("actual protected Pay controls and disclaimers are enrolled, never original data or reference inputs",async()=>{
  const html=await readFile(new URL("../src/index.html",import.meta.url),"utf8"),ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
  for(const selector of ["#open-protected-pay","#protected-pay-title","#protected-pay-review","#protected-pay-approve","#protected-pay-next","#protected-pay-restore","#protected-pay-check","#protected-pay-settle","#protected-pay-receipt","#protected-pay-done","#protected-pay-history-title","#protected-pay-history","#protected-pay-older"]){assert.ok(ids.has(selector.slice(1)));assert.ok(WALLET_STATIC_COPY[selector]);for(const locale of WALLET_LOCALES)assert.ok(WALLET_COPY[locale][WALLET_STATIC_COPY[selector]])}
  for(const selector of ["#protected-pay-reference","#protected-pay-facts","#protected-pay-qr","#protected-pay-history-list","#protected-pay-status"])assert.equal(WALLET_STATIC_COPY[selector],undefined);
  for(const selector of ["#protected-pay-sheet > p:first-of-type","#protected-pay-sheet details > p","#protected-pay-sheet > p.muted"]){assert.ok(WALLET_STATIC_COPY[selector]);for(const locale of WALLET_LOCALES)assert.ok(WALLET_COPY[locale][WALLET_STATIC_COPY[selector]])}
});
test("Pay long-copy controls wrap at desktop modal widths and raw reference keeps LTR isolation",async()=>{
  const css=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(css,/#protected-pay-reference\{direction:ltr;unicode-bidi:isolate;text-align:start\}/);
  assert.match(css,/#protected-pay-sheet \.actions\{flex-wrap:wrap;gap:10px\}/);
  assert.match(css,/#protected-pay-sheet \.actions button\{flex:1 1 11rem;min-width:0;min-height:44px\}/);
  assert.match(css,/#protected-pay-sheet button\{max-width:100%;white-space:normal;overflow-wrap:anywhere\}/);
  assert.match(css,/#protected-pay-sheet \.network-facts\{grid-template-columns:minmax\(0,9rem\) minmax\(0,1fr\)\}/);
  assert.match(css,/#protected-pay-sheet \.network-facts dd\[dir\]\{unicode-bidi:isolate\}/);
  assert.match(css,/@media\(max-width:620px\)\{#protected-pay-sheet \.network-facts\{grid-template-columns:1fr;gap:4px\}/);
});
class Element {
  constructor(document,tag="p"){this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.open=false;this.hidden=false;this.disabled=false;this.value="";this.isConnected=true;this.text="";this.dir=""}
  set textContent(value){this.children=[];this.text=String(value)}
  get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text}
  replaceChildren(...children){for(const child of this.children)if(child instanceof Element)child.isConnected=false;this.children=children;this.text="";for(const child of children)if(child instanceof Element)child.isConnected=true}
  append(...children){this.children.push(...children);for(const child of children)if(child instanceof Element)child.isConnected=true}
  addEventListener(type,fn){this.listeners.set(type,fn)}
  emit(type,event={}){return this.listeners.get(type)?.(event)}
  showModal(){this.open=true}
  close(){this.open=false;this.emit("close")}
  focus(){}
}
function documentFixture(){
  const nodes=new Map();let document;
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element(document));return nodes.get(selector)};
  document={documentElement:{},querySelector:selector=>selector==="#wallet-language"||selector==="#wallet-language-status"?null:get(selector),querySelectorAll:selector=>Object.hasOwn(WALLET_STATIC_COPY,selector)&&selector.includes("protected-pay")?[get(selector)]:[],createElement:tag=>new Element(document,tag),createTextNode:text=>({textContent:text})};
  return {document,get};
}
const flush=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve))};
test("mounted review/recovery/history localize in twelve locales without re-review, mutation, signing or raw value translation",async()=>{
  const f=signedPayFixture(5),{document,get}=documentFixture(),locale=initWalletLocale({document}),calls=[],merchant="<img src=x onerror=approve()> اسْم Merchant",invoice=f.input.rawInvoice.id,account=f.identity.account,hash="0x"+"c".repeat(64),digest=f.input.reviewedIntentDigest;
  let retained=null;
  const api={payCancel:async()=>{calls.push({method:"cancel"});return {ok:true,value:{cancelled:true}}},payStatus:async()=>({ok:true,value:{available:true,paymentAuthorized:false}}),payRestore:async()=>({ok:true,value:{kind:"original",original:retained}}),payReview:async reference=>{calls.push({method:"review",reference});return {ok:true,value:{kind:"review",review:{id:"original-review-id",account,invoiceId:invoice,merchant,recipient:f.input.rawInvoice.payoutAddress,amount:25,fee:1,total:26,expiresAt:f.input.rawIntent.quoteExpiresAt,intentDigest:digest,paymentAuthorized:false}}}},payAction:async input=>{
    calls.push({method:"action",input:structuredClone(input)});
    if(input.action==="approve"){assert.equal(input.id,"original-review-id");retained={account,hash,invoiceId:invoice,merchant,recipient:f.input.rawInvoice.payoutAddress,amount:25,fee:1,total:26,status:"transfer_unconfirmed",checkpointVerified:false,settlementVerified:false,settlementAttempted:false,broadcastAttempted:true,consensusFinality:false}}
    else{assert.equal(input.id,hash);if(input.action==="check")retained={...retained,status:"settlement_pending",checkpointVerified:true};if(input.action==="settle")retained={...retained,status:"settled",settlementVerified:true,settlementAttempted:true};if(input.action==="done")retained={...retained,status:"archived"}}
    return {ok:true,value:{kind:input.action==="done"?"archived":"original",original:retained}};
  },payHistory:async()=>{calls.push({method:"history"});return {ok:true,value:{account,records:[retained],nextCursor:null}}},invoiceReferenceQR:async()=>{throw Error("Locale must not decode QR")},onSecurityState:()=>{},onAccountStatus:()=>{}};
  mountDesktopPayUI({document,api,getContext:()=>({account,keyRevision:7,locked:false})});
  get("#open-protected-pay").emit("click");await flush();get("#protected-pay-reference").value=invoice;get("#protected-pay-form").emit("submit",{preventDefault(){}});await flush();
  const field=(key,language)=>{const fields=get("#protected-pay-facts").children;const index=fields.findIndex(node=>node.textContent===WALLET_COPY[language][key]);assert.ok(index>=0,`${language} ${key}`);return fields[index+1]};
  for(const language of WALLET_LOCALES){
    const before=structuredClone(calls);locale.select(language);assert.deepEqual(calls,before);assert.equal(document.documentElement.dir,language==="ar"?"rtl":"ltr");
    assert.equal(get("#protected-pay-approve").textContent,WALLET_COPY[language]["Approve exact payment"]);assert.equal(get("#protected-pay-reference").value,invoice);
    for(const [key,value]of [["Invoice",invoice],["Merchant",merchant],["Paying account",account],["Recipient",f.input.rawInvoice.payoutAddress],["Amount","25 YNXT"],["Network fee","1 YNXT"],["Total","26 YNXT"],["Quote expires",f.input.rawIntent.quoteExpiresAt],["Quote digest",digest]])assert.equal(field(key,language).textContent,value);
    assert.equal(field("Merchant",language).dir,"auto");assert.equal(field("Paying account",language).dir,"ltr");assert.equal(field("Quote digest",language).dir,"ltr");
  }
  get("#protected-pay-approve").emit("click");await flush();const stages={transfer_unconfirmed:"Transfer outcome unconfirmed",settlement_pending:"Transfer verified — settlement pending",settled:"Settlement verified",archived:"Receipt archived"};
  for(const action of [null,"check","settle","done"]){if(action){get(`#protected-pay-${action}`).emit("click");await flush()}for(const language of WALLET_LOCALES){const before=structuredClone(calls);locale.select(language);assert.deepEqual(calls,before);assert.equal(field("Original hash",language).textContent,hash);assert.equal(field("Saved state",language).textContent,WALLET_COPY[language][stages[retained.status]]);assert.equal(field("Merchant",language).textContent,merchant)}}
  get("#protected-pay-history").emit("click");await flush();const row=get("#protected-pay-history-list").children[0];
  for(const language of WALLET_LOCALES){const before=structuredClone(calls);locale.select(language);assert.deepEqual(calls,before);const isolated=row.children.filter(child=>child.tagName==="BDI");assert.deepEqual(isolated.map(child=>child.textContent),[merchant,"25","1",invoice,hash]);assert.equal(isolated[0].dir,"auto");assert.ok(isolated.slice(1).every(child=>child.dir==="ltr"));assert.ok(row.textContent.includes(WALLET_COPY[language]["{name} · {amount} YNXT + {fee} YNXT fee · {invoice} · {hash} · verified Pay settlement, local native checkpoint (not consensus finality)"].split("{hash}")[1]));}
  assert.equal(calls.filter(call=>call.method==="review").length,1);assert.deepEqual(calls.filter(call=>call.method==="action").map(call=>call.input),[{action:"approve",id:"original-review-id"},{action:"check",id:hash},{action:"settle",id:hash},{action:"done",id:hash}]);
  assert.equal(row.children.some(child=>child.tagName==="IMG"||child.tagName==="SCRIPT"),false);assert.equal(account,f.identity.account);assert.equal(digest,f.input.reviewedIntentDigest);
});
