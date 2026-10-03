import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {renderPermissionError} from "../src/permission-error-ui.mjs";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
const account="0x"+"11".repeat(20),other="0x"+"22".repeat(20);
const status=(selected=account)=>({ok:true,value:{initialized:true,passwordConfigured:true,account:selected,ynxAccount:selected,accounts:[account,other].map(value=>({account:value,ynxAccount:value}))}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const nodes=new Map(),requests=new Map();let eventHandler,elementId=0;
  const get=selector=>{if(!nodes.has(selector)){const listeners=new Map();nodes.set(selector,{value:"",textContent:"",hidden:false,disabled:false,dataset:{},children:[],files:[],
    addEventListener(type,listener){listeners.set(type,listener);},emit(type){return listeners.get(type)?.({preventDefault(){},target:this});},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
    querySelector(){return get(selector+" button");},close(){},focus(){}});}return nodes.get(selector);};
  const document={querySelector:get,querySelectorAll:()=>[],createElement:()=>get("element-"+(++elementId))};
  const api={onAccountStatus(handler){eventHandler=handler;}};
  for(const method of ["accountStatus","createAccount","addAccount","selectAccount","importAccount","saveBackup"]){requests.set(method,[]);api[method]=(...args)=>new Promise((resolve,reject)=>requests.get(method).push({args,resolve,reject}));}
  const context={document,window:{ynxWallet:api},activeAccount:null,accountState:null,accountViewRevision:0,keyState:{locked:false,revision:1},renderPermissionError,
    errorText:result=>result.error.message,clearAssetBalance(){},clearTransactionResolution(){},clearInvoiceInput(){},invalidateWalletConnectSessions(){},invalidatePaymentInput(){},contractUI:{clear(){}},receiveShareUI:{invalidate(){}},receiveCodeUI:{clear(){},refresh(){}},transactionHistoryUI:{clear(){},refresh(){}},passwordUI:{render(){}},renderKeyDetail(){},refreshTransactions(){},refreshAssets(){},setView(){},nativeAccountLabel:value=>value,transferReview:null};
  for(const [name,id]of Object.entries({accountTitle:"account-title",accountDetail:"account-detail",accountShort:"account-short",signingShort:"signing-short",createAccount:"create-account",addAccount:"add-account",accountList:"account-list"}))context[name]=get("#"+id);
  const start=source.indexOf("function renderAccount(payload)"),end=source.indexOf("const walletConnectTitle",start);
  const importStart=source.indexOf('document.querySelector("#import-kind").addEventListener'),importEnd=source.indexOf('document.querySelector("#transfer-form").addEventListener',importStart);
  assert.ok(start>=0&&end>start&&importStart>=0&&importEnd>importStart);
  runInNewContext(source.match(/^function copyUI\([^\n]+/m)[0]+"\n"+source.match(/^function showAccountError\([^\n]+/m)[0]+"\n"+source.slice(start,end)+source.slice(importStart,importEnd),context);
  return{get,context,requests,event:payload=>eventHandler(payload)};
}
for(const response of ["success","failure","throw"])test(`actual initial status ${response} cannot overwrite a newer account event`,async()=>{
  const h=harness();h.event(status(other));
  const request=h.requests.get("accountStatus")[0];
  if(response==="throw")request.reject(Error("old startup read failed"));else request.resolve(response==="success"?status():{ok:false,error:{code:"OLD",message:"old read failed"}});
  await settle();assert.equal(h.context.activeAccount,other);assert.equal(h.get("#account-detail").textContent,other);
});
for(const operation of ["createAccount","addAccount","selectAccount","importAccount"])for(const response of ["success","failure","throw"])test(`actual ${operation} late ${response} does not replace newer account or notice`,async()=>{
  const h=harness();h.event(status());
  let pending;
  if(operation==="selectAccount")pending=h.get("#account-list").children[1].emit("click");
  else if(operation==="importAccount"){h.get("#import-kind").value="private-key";h.get("#import-value").value="not-a-real-key";pending=h.get("#import-form").emit("submit");}
  else pending=h.get(operation==="createAccount"?"#create-account":"#add-account").emit("click");
  h.event(status(other));h.get("#import-result").textContent="new import notice";h.get("#import-file").value="new file draft";
  const control=operation==="importAccount"?h.get("#import-form button"):operation==="createAccount"?h.get("#create-account"):operation==="addAccount"?h.get("#add-account"):null;
  if(control)control.disabled=true;
  const request=h.requests.get(operation)[0];assert.ok(request);
  if(response==="throw")request.reject(Error("old operation failed"));else request.resolve(response==="success"?status():{ok:false,error:{code:"OLD",message:"old operation failed"}});
  await pending;assert.equal(h.context.activeAccount,other);assert.equal(h.get("#account-detail").textContent,other);assert.equal(h.get("#import-result").textContent,"new import notice");
  if(control)assert.equal(control.disabled,true,"old finally cannot enable a newer in-flight action");
  assert.equal(h.get("#import-file").value,"new file draft");
});
for(const invalidation of ["lock","new-unlocked-account"])for(const response of ["success","failure","throw"])test(`actual backup late ${response} remains silent after ${invalidation}`,async()=>{
  const h=harness();h.event(status());h.get("#backup-password").value=h.get("#backup-confirm").value="public-test-only";
  const pending=h.get("#backup-form").emit("submit");
  assert.equal(h.get("#backup-password").value,"");assert.equal(h.get("#backup-confirm").value,"");
  h.context.keyState={locked:invalidation==="lock",revision:2};h.event(status(other));h.get("#backup-result").textContent="new backup notice";h.get("#save-backup").disabled=true;
  const request=h.requests.get("saveBackup")[0];
  if(response==="throw")request.reject(Error("old backup failed"));else request.resolve(response==="success"?{ok:true,value:{saved:true}}:{ok:false,error:{message:"old backup failed"}});
  await pending;assert.equal(h.get("#backup-result").textContent,"new backup notice");assert.equal(h.get("#save-backup").disabled,true);
});
test("actual current initial read and current account actions still publish valid status",async()=>{
  const h=harness();h.requests.get("accountStatus")[0].resolve(status());await settle();assert.equal(h.context.activeAccount,account);
  const pending=h.get("#add-account").emit("click");h.requests.get("addAccount")[0].resolve(status(other));await pending;assert.equal(h.context.activeAccount,other);
});
test("actual current transport failures show a retryable notice without replacing account records",async()=>{
  const h=harness();h.event(status());const pending=h.get("#add-account").emit("click");h.requests.get("addAccount")[0].reject(Error("transport closed"));await pending;
  assert.equal(h.context.activeAccount,account);assert.match(h.get("#account-detail").textContent,/Reopen the current Wallet/);assert.equal(h.get("#add-account").disabled,false);
});
test("ordinary import own account event is acknowledged without rereading or republishing its old status",async()=>{
  const h=harness();h.event(status());h.get("#import-kind").value="private-key";
  const pending=h.get("#import-form").emit("submit");
  h.context.keyState={locked:true,revision:2,account:other,authenticating:false};h.event(status(other));
  const view=h.context.accountViewRevision;h.requests.get("importAccount")[0].resolve(status(other));await pending;
  assert.equal(h.context.activeAccount,other);assert.equal(h.context.accountViewRevision,view);
  assert.equal(h.get("#import-result").textContent,"Account imported. Save a backup and keep it safe.");
});
