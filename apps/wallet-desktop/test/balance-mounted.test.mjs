import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {renderPermissionError} from "../src/permission-error-ui.mjs";
import {initWalletLocale,WALLET_LOCALES,WALLET_COPY} from "../src/wallet-locale.mjs";
import {PERMISSION_STORE_NOTICE} from "../src/wallet-locale-permissions.mjs";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
const html=await readFile(new URL("../src/index.html",import.meta.url),"utf8");
const account="0x"+"1".repeat(40),other="0x"+"2".repeat(40);
const good=(selected=account,formatted="25")=>({ok:true,value:{account:selected,formatted,checkedAt:"2026-10-03T00:00:00Z",transferEnabled:false}});
function harness(){
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1])),nodes=new Map(),requests=[];
  const get=selector=>{assert.ok(ids.has(selector.slice(1)),selector);if(!nodes.has(selector))nodes.set(selector,{textContent:"",value:"",hidden:false,disabled:false,open:false,close(){this.open=false},replaceChildren(){},addEventListener(){}});return nodes.get(selector)};
  const context={document:{querySelector:get},window:{ynxWallet:{balance:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}},activeAccount:account,balanceRevision:0,accountState:{account,initialized:true},keyState:{locked:true},
    renderPermissionError,errorText:result=>result.error.message,invoiceUI:{clear(){}},invoiceQR:{invalidate(){}},contractUI:{clear(){}},receiveShareUI:{invalidate(){}},receiveCodeUI:{clear(){},refresh(){}},transactionHistoryUI:{clear(){},refresh(){}},invalidatePaymentInput(){},passwordUI:{render(){}},renderKeyDetail(){},refreshTransactions(){},clearTransactionResolution(){},setView(){},nativeAccountLabel:value=>value,
    accountTitle:get("#account-title"),accountDetail:get("#account-detail"),accountShort:get("#account-short"),signingShort:get("#signing-short"),createAccount:get("#create-account"),addAccount:get("#add-account"),accountList:get("#account-list"),transferReview:null};
  const start=source.indexOf("function clearAssetBalance("),refreshStart=source.indexOf("async function refreshAssets()"),end=source.indexOf('document.querySelector("#refresh-balance")',refreshStart);
  const renderStart=source.indexOf("function renderAccount(payload)"),renderEnd=source.indexOf('createAccount.addEventListener("click"',renderStart);
  assert.ok(refreshStart>=0&&end>refreshStart&&renderStart>=0&&renderEnd>renderStart);
  const copyHelper=source.match(/^function copyUI\([^\n]+/m)?.[0];assert.ok(copyHelper);
  const invoiceClear=source.match(/^function clearInvoiceInput\([^\n]+/m)?.[0];assert.ok(invoiceClear);
  const errorHelper=source.match(/^function showAccountError\([^\n]+/m)?.[0];assert.ok(errorHelper);
  runInNewContext(copyHelper+"\n"+invoiceClear+"\n"+errorHelper+"\n"+source.slice(start>=0?start:refreshStart,end)+"\n"+source.slice(renderStart,renderEnd),context);
  return {context,get,requests};
}
test("actual failed account status clears stale balances and localizes the permission refusal without changing diagnostics",()=>{
  const h=harness(),doc={documentElement:{},querySelector:()=>null,querySelectorAll:()=>[]};
  h.get("#account-detail").ownerDocument=doc;const locale=initWalletLocale({document:doc});
  h.context.renderAccount({ok:false,error:{code:"PERMISSION_STORE_INVALID",message:PERMISSION_STORE_NOTICE}});
  for(const language of WALLET_LOCALES){locale.select(language);assert.equal(h.get("#account-detail").textContent,WALLET_COPY[language][PERMISSION_STORE_NOTICE]);}
  assert.equal(h.context.activeAccount,null);assert.equal(h.get("#balance-value").textContent,"—");assert.equal(h.requests.length,0);
  h.context.renderAccount({ok:false,error:{code:"REMOTE_ERROR",message:"Original <diagnostic>"}});locale.select("zh-Hans");
  assert.equal(h.get("#account-detail").textContent,"REMOTE_ERROR: Original <diagnostic>");
});
for(const response of ["failure","throw","success"]){test(`actual renderer drops late ${response} after failed account status`,async()=>{
  const h=harness(),pending=h.context.refreshAssets();h.get("#balance-value").textContent="old balance";
  h.context.renderAccount({ok:false,error:{code:"ACCOUNT_UNAVAILABLE",message:"Try again"}});
  assert.equal(h.get("#balance-value").textContent,"—");assert.equal(h.get("#asset-balance").textContent,"—");
  if(response==="throw")h.requests[0].reject(Error("offline"));else h.requests[0].resolve(response==="success"?good():{ok:false,error:{message:"stale account error"}});
  await pending;assert.equal(h.get("#balance-status").textContent,"");assert.equal(h.get("#balance-value").textContent,"—");
});}
test("actual renderer makes no balance IPC request without an active account",async()=>{const h=harness();h.context.activeAccount=null;const pending=h.context.refreshAssets();h.requests[0]?.resolve(good());await pending;assert.equal(h.requests.length,0);assert.equal(h.get("#balance-status").textContent,"");});
test("empty account event cancels previous request and removes old amounts",async()=>{const h=harness(),pending=h.context.refreshAssets();h.context.renderAccount({ok:true,value:{initialized:false,passwordConfigured:false}});h.requests[0].resolve(good());await pending;assert.equal(h.get("#balance-value").textContent,"—");assert.equal(h.get("#balance-status").textContent,"");});
test("newest refresh wins while old success and failures stay silent",async()=>{const h=harness(),old=h.context.refreshAssets(),latest=h.context.refreshAssets();h.requests[1].resolve(good(account,"70"));await latest;h.requests[0].reject(Error("old outage"));await old;assert.equal(h.get("#balance-value").textContent,"70");assert.match(h.get("#balance-status").textContent,/Legacy whole-YNXT/);});
test("account changes during request suppress both returned and thrown errors",async()=>{for(const thrown of [false,true]){const h=harness(),pending=h.context.refreshAssets();h.context.activeAccount=other;const status=h.get("#balance-status").textContent;if(thrown)h.requests[0].reject(Error("offline"));else h.requests[0].resolve({ok:false,error:{message:"wrong account"}});await pending;assert.equal(h.get("#balance-status").textContent,status);}});
test("mismatched account success is never published",async()=>{const h=harness(),pending=h.context.refreshAssets();h.requests[0].resolve(good(other));await pending;assert.equal(h.get("#balance-value").textContent,"—");});
test("returning to the same account cannot revive its previous request",async()=>{
  const h=harness(),old=h.context.refreshAssets();h.context.renderAccount({ok:true,value:{initialized:false}});
  h.context.renderAccount({ok:true,value:{initialized:true,account,ynxAccount:"qa-public-account"}});
  assert.equal(h.requests.length,2);h.requests[1].resolve(good(account,"90"));await new Promise(resolve=>setImmediate(resolve));
  h.requests[0].resolve(good(account,"10"));await old;assert.equal(h.get("#balance-value").textContent,"90");
});
test("current request failures remain visible and a new refresh recovers",async()=>{
  for(const thrown of [false,true]){const h=harness(),pending=h.context.refreshAssets();if(thrown)h.requests[0].reject(Error("offline"));else h.requests[0].resolve({ok:false,error:{message:"Network unavailable"}});
    await pending;assert.match(h.get("#balance-status").textContent,thrown?/Balance unavailable/:/Network unavailable/);
    const retry=h.context.refreshAssets();h.requests[1].resolve(good());await retry;assert.equal(h.get("#balance-value").textContent,"25");}
});
