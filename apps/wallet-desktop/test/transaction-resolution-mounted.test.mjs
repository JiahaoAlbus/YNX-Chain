import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
const html=await readFile(new URL("../src/index.html",import.meta.url),"utf8");
const account="0x"+"1".repeat(40),hash="0x"+"2".repeat(64);
const record={account,hash,to:"0x"+"3".repeat(40),amount:"25",canRetryExact:true};
function harness(){
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1])),nodes=new Map(),reads=[],actions=[];
  function element(){return {textContent:"",children:[],hidden:false,disabled:false,dataset:{},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(type,fn){this[type]=fn}}}
  const get=selector=>{assert.ok(ids.has(selector.slice(1)),selector);if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector)};
  const context={document:{querySelector:get,createElement:element},activeAccount:account,keyState:{locked:false,revision:1},transactionRevision:0,transactionActionRevision:0,errorText:result=>result.error.message,assetRefreshes:0,historyRefreshes:0,
    refreshAssets(){context.assetRefreshes++},transactionHistoryUI:{refresh(){context.historyRefreshes++}},window:{ynxWallet:{pendingTransactions:()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),transactionStatus:h=>new Promise((resolve,reject)=>actions.push({hash:h,retry:false,resolve,reject})),retryTransaction:h=>new Promise((resolve,reject)=>actions.push({hash:h,retry:true,resolve,reject}))}}};
  const start=source.indexOf("function clearTransactionResolution()"),fallback=source.indexOf("async function refreshTransactions()"),end=source.indexOf("function clearAssetBalance()",fallback);
  const copyHelper=source.match(/function copyUI\([^\n]+/)[0];
  assert.ok(fallback>=0&&end>fallback);runInNewContext(copyHelper+"\n"+source.slice(start>=0?start:fallback,end),context);
  context.clearTransactionResolution??=()=>{context.transactionRevision++;context.transactionActionRevision++;get("#pending-transactions").replaceChildren();get("#transaction-resolution").hidden=true;get("#transaction-resolution-result").textContent=""};
  return {context,get,reads,actions,async load(){const pending=context.refreshTransactions();reads.at(-1)?.resolve({ok:true,value:[record]});await pending;return get("#pending-transactions").children[0]?.children.filter(item=>typeof item.click==="function")}};
}
test("account event clears stale resolution entry and original journal remains untouched",()=>{assert.ok(/function renderAccount\(payload\) \{\s*clearAssetBalance\(\);\s*clearTransactionResolution\(\);/.test(source));const h=harness();h.get("#transaction-resolution-result").textContent="old";h.context.clearTransactionResolution();assert.equal(h.get("#transaction-resolution-result").textContent,"");assert.equal(h.get("#transaction-resolution").hidden,true);assert.equal(h.actions.length,0);});
test("missing account never requests a transaction journal",async()=>{const h=harness();h.context.activeAccount=null;const pending=h.context.refreshTransactions();h.reads[0]?.resolve({ok:true,value:[]});await pending;assert.equal(h.reads.length,0);});
test("late journal exceptions cannot update another account",async()=>{const h=harness(),pending=h.context.refreshTransactions();h.context.activeAccount="other";h.reads[0].reject(Error("old"));await pending;assert.equal(h.get("#transaction-resolution-result").textContent,"");});
test("detached stale buttons cannot dispatch read or retry after same-account return",async()=>{const h=harness(),buttons=await h.load();h.context.clearTransactionResolution();const pending=buttons.map(button=>button.click());assert.equal(h.actions.length,0);await Promise.all(pending);});
test("locked direct retry handler never sends while public receipt check still works",async()=>{const h=harness(),[check,retry]=await h.load();h.context.keyState.locked=true;const denied=retry.click();assert.equal(h.actions.length,0);await denied;const pending=check.click();assert.equal(h.actions[0].retry,false);h.actions[0].resolve({ok:true,value:{confirmed:false}});await pending;assert.equal(h.actions.length,1);});
test("duplicate click while receipt read is pending is single-use",async()=>{const h=harness(),[check]=await h.load(),pending=check.click(),duplicate=check.click();assert.equal(h.actions.length,1);await duplicate;h.actions[0].resolve({ok:true,value:{confirmed:false}});await pending;assert.match(h.get("#transaction-resolution-result").textContent,/still unavailable/);});
for(const boundary of ["account-event","key-revision","newer-read"]){test(`late recovery success and exceptions stay silent after ${boundary}`,async()=>{for(const thrown of [false,true]){const h=harness(),[check]=await h.load(),pending=check.click();
  if(boundary==="account-event")h.context.clearTransactionResolution();else if(boundary==="key-revision")h.context.keyState.revision++;else{void (await h.load())[0].click();}
  const before=h.get("#transaction-resolution-result").textContent;
  if(thrown)h.actions[0].reject(Error("old"));else h.actions[0].resolve({ok:true,value:{confirmed:true,successful:true,actualFee:"1"}});
  await pending;assert.equal(h.get("#transaction-resolution-result").textContent,before);assert.equal(h.context.assetRefreshes,0);assert.equal(h.context.historyRefreshes,0);
  if(boundary==="key-revision")assert.equal(check.disabled,false);
}});}
test("current confirmed recovery updates balance/history but does not claim consensus finality",async()=>{const h=harness(),[check]=await h.load(),pending=check.click();h.actions[0].resolve({ok:true,value:{confirmed:true,successful:true,actualFee:"1"}});await pending;assert.match(h.get("#transaction-resolution-result").textContent,/Consensus finality is not established/);assert.equal(h.context.assetRefreshes,1);assert.equal(h.context.historyRefreshes,1);assert.equal(h.actions[0].hash,hash);});
