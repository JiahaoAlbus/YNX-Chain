import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {projectTransactionResolution,projectPendingTransactions} from "../src/transaction-resolution-display.mjs";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
const html=await readFile(new URL("../src/index.html",import.meta.url),"utf8");
const account="0x"+"1".repeat(40),hash="0x"+"2".repeat(64);
const record={account,hash,to:"0x"+"3".repeat(40),amount:"25.0",status:"uncertain",canRetryExact:true};
const unresolved=()=>({hash,account,status:"uncertain",durabilityStatus:"not_found",confirmed:false,consensusFinality:false,canRetryExact:true});
function harness(){
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1])),nodes=new Map(),reads=[],actions=[];
  function element(){return {textContent:"",children:[],hidden:false,disabled:false,dataset:{},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(type,fn){this[type]=fn}}}
  const get=selector=>{assert.ok(ids.has(selector.slice(1)),selector);if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector)};
  const context={projectTransactionResolution,projectPendingTransactions,document:{querySelector:get,createElement:element},activeAccount:account,keyState:{locked:false,revision:1},transactionRevision:0,transactionActionRevision:0,errorText:result=>result.error.message,assetRefreshes:0,historyRefreshes:0,
    refreshAssets(){context.assetRefreshes++},transactionHistoryUI:{refresh(){context.historyRefreshes++}},window:{ynxWallet:{pendingTransactions:()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),transactionStatus:h=>new Promise((resolve,reject)=>actions.push({hash:h,retry:false,resolve,reject})),retryTransaction:h=>new Promise((resolve,reject)=>actions.push({hash:h,retry:true,resolve,reject}))}}};
  const start=source.indexOf("function clearTransactionResolution()"),fallback=source.indexOf("async function refreshTransactions()"),end=source.indexOf("function clearAssetBalance()",fallback);
  const copyHelper=source.match(/function copyUI\([^\n]+/)[0];
  assert.ok(fallback>=0&&end>fallback);runInNewContext(copyHelper+"\n"+source.slice(start>=0?start:fallback,end),context);
  context.clearTransactionResolution??=()=>{context.transactionRevision++;context.transactionActionRevision++;get("#pending-transactions").replaceChildren();get("#transaction-resolution").hidden=true;get("#transaction-resolution-result").textContent=""};
  return {context,get,reads,actions,async load(response={ok:true,value:[record]}){const pending=context.refreshTransactions();reads.at(-1)?.resolve(response);await pending;return get("#pending-transactions").children[0]?.children.filter(item=>typeof item.click==="function")}};
}
test("account event clears stale resolution entry and original journal remains untouched",()=>{assert.ok(/function renderAccount\(payload\) \{\s*clearAssetBalance\(\);\s*clearTransactionResolution\(\);/.test(source));const h=harness();h.get("#transaction-resolution-result").textContent="old";h.context.clearTransactionResolution();assert.equal(h.get("#transaction-resolution-result").textContent,"");assert.equal(h.get("#transaction-resolution").hidden,true);assert.equal(h.actions.length,0);});
test("missing account never requests a transaction journal",async()=>{const h=harness();h.context.activeAccount=null;const pending=h.context.refreshTransactions();h.reads[0]?.resolve({ok:true,value:[]});await pending;assert.equal(h.reads.length,0);});
test("late journal exceptions cannot update another account",async()=>{const h=harness(),pending=h.context.refreshTransactions();h.context.activeAccount="other";h.reads[0].reject(Error("old"));await pending;assert.equal(h.get("#transaction-resolution-result").textContent,"");});
test("detached stale buttons cannot dispatch read or retry after same-account return",async()=>{const h=harness(),buttons=await h.load();h.context.clearTransactionResolution();const pending=buttons.map(button=>button.click());assert.equal(h.actions.length,0);await Promise.all(pending);});
test("locked direct retry handler never sends while public receipt check still works",async()=>{const h=harness(),[check,retry]=await h.load();h.context.keyState.locked=true;const denied=retry.click();assert.equal(h.actions.length,0);await denied;const pending=check.click();assert.equal(h.actions[0].retry,false);h.actions[0].resolve({ok:true,value:unresolved()});await pending;assert.equal(h.actions.length,1);});
test("duplicate click while receipt read is pending is single-use",async()=>{const h=harness(),[check]=await h.load(),pending=check.click(),duplicate=check.click();assert.equal(h.actions.length,1);await duplicate;h.actions[0].resolve({ok:true,value:unresolved()});await pending;assert.match(h.get("#transaction-resolution-result").textContent,/still unavailable/);});
for(const boundary of ["account-event","key-revision","newer-read"]){test(`late recovery success and exceptions stay silent after ${boundary}`,async()=>{for(const thrown of [false,true]){const h=harness(),[check]=await h.load(),pending=check.click();
  if(boundary==="account-event")h.context.clearTransactionResolution();else if(boundary==="key-revision")h.context.keyState.revision++;else{void (await h.load())[0].click();}
  const before=h.get("#transaction-resolution-result").textContent;
  if(thrown)h.actions[0].reject(Error("old"));else h.actions[0].resolve({ok:true,value:completed()});
  await pending;assert.equal(h.get("#transaction-resolution-result").textContent,before);assert.equal(h.context.assetRefreshes,0);assert.equal(h.context.historyRefreshes,0);
  if(boundary==="key-revision")assert.equal(check.disabled,false);
}});}
test("current confirmed recovery updates balance/history but does not claim consensus finality",async()=>{const h=harness(),[check]=await h.load(),pending=check.click();h.actions[0].resolve({ok:true,value:completed()});await pending;assert.match(h.get("#transaction-resolution-result").textContent,/Consensus finality is not established/);assert.equal(h.context.assetRefreshes,1);assert.equal(h.context.historyRefreshes,1);assert.equal(h.actions[0].hash,hash);});
const completed=()=>({hash,account,status:"confirmed",confirmed:true,successful:true,actualFee:"1.0",blockNumber:"0x1",confirmationScope:"local-snapshot",consensusFinality:false,canRetryExact:false});
for(const [name,change] of [
  ["another account",value=>({...value,account:"0x"+"4".repeat(40)})],
  ["another hash",value=>({...value,hash:"0x"+"5".repeat(64)})],
  ["truthy confirmed",value=>({...value,confirmed:"true"})],
  ["truthy success",value=>({...value,successful:"false"})],
  ["status mismatch",value=>({...value,status:"failed"})],
  ["consensus claim",value=>({...value,consensusFinality:true})],
  ["wrong scope",value=>({...value,confirmationScope:"consensus"})],
  ["missing block",value=>{delete value.blockNumber;return value}],
  ["zero block",value=>({...value,blockNumber:"0x0"})],
  ["invalid fee",value=>({...value,actualFee:"NaN"})],
  ["retryable completed transaction",value=>({...value,canRetryExact:true})],
  ["raw bytes in display DTO",value=>({...value,raw:"not-public"})],
])test(`mounted recovery rejects ${name} without completed facts or asset refresh`,async()=>{
  const h=harness(),[check]=await h.load(),pending=check.click();
  h.actions[0].resolve({ok:true,value:change(completed())});await pending;
  assert.equal(h.context.assetRefreshes,0);
  assert.match(h.get("#transaction-resolution-result").textContent,/could not be checked/);
});
test("mounted recovery rejects truthy IPC success",async()=>{const h=harness(),[check]=await h.load(),pending=check.click();h.actions[0].resolve({ok:"true",value:completed()});await pending;assert.equal(h.context.assetRefreshes,0);assert.match(h.get("#transaction-resolution-result").textContent,/could not be checked/);});
test("mounted original exact retry remains unresolved until receipt verification",async()=>{const h=harness(),[,retry]=await h.load(),pending=retry.click();h.actions[0].resolve({ok:true,value:{hash,account,status:"submitted",confirmed:false,retriedExactBytes:true}});await pending;assert.equal(h.context.assetRefreshes,0);assert.match(h.get("#transaction-resolution-result").textContent,/still unavailable/);assert.equal(h.actions.length,1);assert.equal(h.actions[0].retry,true);assert.equal(h.actions[0].hash,hash);});
test("mounted original durable pending result does not claim completion",async()=>{const h=harness(),[check]=await h.load(),pending=check.click();h.actions[0].resolve({ok:true,value:{...unresolved(),status:"pending_durable",durabilityStatus:"pending_durable"}});await pending;assert.equal(h.context.assetRefreshes,0);assert.match(h.get("#transaction-resolution-result").textContent,/has not been mined/);});
test("mounted completed original retry refreshes without rebroadcasting from UI",async()=>{const h=harness(),[,retry]=await h.load(),pending=retry.click();h.actions[0].resolve({ok:true,value:completed()});await pending;assert.equal(h.context.assetRefreshes,1);assert.equal(h.actions.length,1);assert.match(h.get("#transaction-resolution-result").textContent,/Consensus finality is not established/);});
for(const [name,change] of [
  ["foreign account",value=>({...value,account:"0x"+"4".repeat(40)})],
  ["invalid hash",value=>({...value,hash:"not-a-hash"})],
  ["truthy retry flag",value=>({...value,canRetryExact:"false"})],
  ["raw bytes",value=>({...value,raw:"not-public"})],
  ["zero amount",value=>({...value,amount:"0.0"})],
  ["self recipient",value=>({...value,to:account})],
  ["unknown status",value=>({...value,status:"invented"})],
])test(`pending inventory rejects ${name} before rendering action buttons`,async()=>{const h=harness();await h.load({ok:true,value:[change({...record})]});assert.equal(h.get("#pending-transactions").children.length,0);assert.match(h.get("#transaction-resolution-result").textContent,/journal is unavailable/);assert.equal(h.actions.length,0);});
test("pending inventory never runs a custom iterator",async()=>{const h=harness();let calls=0;const rows=[record];rows[Symbol.iterator]=function*(){calls++;yield record};await h.load({ok:true,value:rows});assert.equal(calls,0);assert.equal(h.get("#pending-transactions").children.length,0);});
test("pending inventory never runs indexed accessors",async()=>{const h=harness();let calls=0;const rows=[record];Object.defineProperty(rows,0,{get(){calls++;return record}});await h.load({ok:true,value:rows});assert.equal(calls,0);assert.equal(h.get("#pending-transactions").children.length,0);});
test("pending inventory cannot retain actions for rows rejected after a valid first row",async()=>{const h=harness();await h.load({ok:true,value:[record,{...record,account:"other"}]});assert.equal(h.get("#pending-transactions").children.length,0);});
test("pending inventory cannot execute record getters",async()=>{const h=harness();let calls=0;const value={...record};Object.defineProperty(value,"hash",{get(){calls++;return hash}});await h.load({ok:true,value:[value]});assert.equal(calls,0);assert.equal(h.get("#pending-transactions").children.length,0);});
test("mutating source inventory after mount cannot retarget check or exact retry",async()=>{for(const index of [0,1]){const h=harness(),value={...record},buttons=await h.load({ok:true,value:[value]});value.hash="other";value.account="other";const pending=buttons[index].click();assert.equal(h.actions.at(-1).hash,hash);assert.equal(h.actions.at(-1).retry,index===1);h.actions.at(-1).resolve({ok:true,value:unresolved()});await pending;assert.equal(h.actions.length,1);}});
test("legacy original inventory shows check-only note without recreating signature",async()=>{const h=harness(),buttons=await h.load({ok:true,value:[{...record,canRetryExact:false}]});assert.equal(buttons.length,1);assert.match(h.get("#pending-transactions").children[0].children.at(-1).textContent,/no original signed bytes/);assert.equal(h.actions.length,0);});
test("malformed replacement inventory retires old visible actions",async()=>{const h=harness(),[oldCheck]=await h.load();await h.load({ok:true,value:[{...record,amount:"invalid"}]});assert.equal(h.get("#pending-transactions").children.length,0);await oldCheck.click();assert.equal(h.actions.length,0);});
test("real recovery panel provides an explicit pending-inventory refresh control",()=>{assert.match(html,/<button[^>]+id="refresh-pending-transactions"[^>]*>Refresh pending transactions<\/button>/);});
test("failed startup inventory can be refreshed without account change or a transaction retry",async()=>{const h=harness();await h.load({ok:false,error:{code:"TEMPORARY",message:"Read unavailable"}});const button=h.get("#refresh-pending-transactions");assert.equal(button.disabled,false);const pending=button.click();assert.equal(h.reads.length,2);assert.equal(button.disabled,true);h.reads.at(-1).resolve({ok:true,value:[record]});await pending;assert.equal(button.disabled,false);assert.equal(h.get("#pending-transactions").children.length,1);assert.equal(h.actions.length,0);});
test("duplicate refresh clicks do not dispatch concurrent inventory reads",async()=>{const h=harness();await h.load();const button=h.get("#refresh-pending-transactions"),pending=button.click();await button.click();assert.equal(h.reads.length,2);h.reads.at(-1).resolve({ok:true,value:[record]});await pending;assert.equal(button.disabled,false);});
test("old refresh completion cannot enable the newer account's pending read",async()=>{const h=harness();await h.load();const button=h.get("#refresh-pending-transactions"),old=button.click();h.context.clearTransactionResolution();const fresh=h.context.refreshTransactions();h.reads[1].resolve({ok:true,value:[record]});await old;assert.equal(button.disabled,true);h.reads[2].resolve({ok:true,value:[record]});await fresh;assert.equal(button.disabled,false);});
test("refresh remains public while locked and performs no retry or signing",async()=>{const h=harness();await h.load();h.context.keyState.locked=true;const pending=h.get("#refresh-pending-transactions").click();h.reads.at(-1).resolve({ok:true,value:[record]});await pending;assert.equal(h.actions.length,0);assert.equal(h.get("#pending-transactions").children[0].children.filter(n=>n.click)[1].disabled,true);});
test("cleared account cannot dispatch a detached refresh control",async()=>{const h=harness();await h.load();h.context.activeAccount=null;h.context.clearTransactionResolution();await h.get("#refresh-pending-transactions").click();assert.equal(h.reads.length,1);assert.equal(h.get("#refresh-pending-transactions").disabled,true);});
