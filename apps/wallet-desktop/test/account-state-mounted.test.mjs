import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {renderPermissionError} from "../src/permission-error-ui.mjs";
import {createMnemonicImportUI} from "../src/mnemonic-ui.mjs";
const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
const account="0x"+"11".repeat(20),other="0x"+"22".repeat(20);
const status=(selected=account)=>({ok:true,value:{initialized:true,passwordConfigured:true,account:selected,ynxAccount:selected,accounts:[account,other].map(value=>({account:value,ynxAccount:value}))}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const nodes=new Map(),requests=new Map();let eventHandler,elementId=0;
  const get=selector=>{if(!nodes.has(selector)){const listeners=new Map();nodes.set(selector,{value:"",textContent:"",hidden:false,disabled:false,open:false,dataset:{},children:[],files:[],attributes:new Map(),
    addEventListener(type,listener){const list=listeners.get(type)??[];list.push(listener);listeners.set(type,list);},emit(type){let result;for(const listener of listeners.get(type)??[])result=listener({preventDefault(){},target:this});return result;},
    setAttribute(key,value){this.attributes.set(key,value)},getAttribute(key){return this.attributes.get(key)},showModal(){this.open=true},
    append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
    querySelector(){return get(selector+" button");},close(){this.open=false;this.emit('close')},focus(){}});}return nodes.get(selector);};
  const document={querySelector:selector=>selector==='dialog[open]'?[...nodes.values()].find(node=>node.open)??null:get(selector),querySelectorAll:()=>[],createElement:()=>get("element-"+(++elementId))};
  const api={onAccountStatus(handler){eventHandler=handler;}};
  for(const method of ["accountStatus","createAccount","addAccount","selectAccount","importAccount","saveBackup"]){requests.set(method,[]);api[method]=(...args)=>new Promise((resolve,reject)=>requests.get(method).push({args,resolve,reject}));}
  const context={document,window:{ynxWallet:api},familyUI:{invalidate(){}},multichainUI:{render(){}},activeAccount:null,accountState:null,accountViewRevision:0,keyState:{locked:false,revision:1},renderPermissionError,
    errorText:result=>result.error.message,clearAssetBalance(){},clearTransactionResolution(){},clearInvoiceInput(){},invalidateWalletConnectSessions(){},invalidatePaymentInput(){},contractUI:{clear(){}},receiveShareUI:{invalidate(){}},receiveCodeUI:{clear(){},refresh(){}},transactionHistoryUI:{clear(){},refresh(){}},passwordUI:{render(){}},renderKeyDetail(){},refreshTransactions(){},refreshAssets(){},setView(){},nativeAccountLabel:value=>value,transferReview:null};
  for(const [name,id]of Object.entries({accountTitle:"account-title",accountDetail:"account-detail",accountShort:"account-short",signingShort:"signing-short",createAccount:"create-account",addAccount:"add-account",accountList:"account-list"}))context[name]=get("#"+id);
  const start=source.indexOf("function renderAccount(payload)"),end=source.indexOf("const walletConnectTitle",start);
  const importStart=source.indexOf('document.querySelector("#import-kind").addEventListener'),importEnd=source.indexOf('document.querySelector("#transfer-form").addEventListener',importStart);
  assert.ok(start>=0&&end>start&&importStart>=0&&importEnd>importStart);
  runInNewContext(source.match(/^function copyUI\([^\n]+/m)[0]+"\n"+source.match(/^function showAccountError\([^\n]+/m)[0]+"\n"+source.slice(start,end)+source.slice(importStart,importEnd),context);
  return{get,context,requests,event:payload=>eventHandler(payload),enableEditor(){context.mnemonicImportUI=createMnemonicImportUI({document,getState:()=>context.keyState,getAccount:()=>context.activeAccount});return context.mnemonicImportUI;}};
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
  assert.equal(h.get('#receive-address').value,status(other).value.ynxAccount);
  assert.equal(h.get('#receive-evm-address').value,other);
  assert.equal(h.get("#import-result").textContent,"Account imported. Save a backup and keep it safe.");
});

for(const count of [12,24])test(`actual modal ${count}-word editor submits ordered public fixture once and acknowledges its exact own commit`,async()=>{
 const h=harness(),editor=h.enableEditor();h.event(status());h.get('#open-import').emit('click');h.get('#import-word-count').value=String(count);h.get('#import-word-count').emit('change');
 const words=Array(count).fill('abandon');words[count-1]=count===12?'about':'art';const inputs=h.get('#import-word-grid').children.map(label=>label.children[1]);assert.equal(inputs.length,count);inputs.forEach((input,i)=>input.value=words[i]);
 const pending=h.get('#import-form').emit('submit');h.get('#import-form').emit('submit');assert.equal(h.requests.get('importAccount').length,1);assert.equal(h.requests.get('importAccount')[0].args[0].kind,'recovery-phrase');assert.equal(h.requests.get('importAccount')[0].args[0].value,words.join(' '));assert.ok(inputs.every(input=>input.value===''));
 h.context.keyState={locked:true,revision:2,account:other,authenticating:false};h.event(status(other));const view=h.context.accountViewRevision;h.requests.get('importAccount')[0].resolve(status(other));await pending;
 assert.equal(h.context.accountViewRevision,view);assert.equal(h.get('#import-result').textContent,'Account imported. Save a backup and keep it safe.');assert.equal(h.get('#import-sheet').open,false);assert.equal(editor.beginSubmission(),null);
});
for(const response of ['success','failure','throw'])test(`actual modal cancel retires late ${response} without another import or notice`,async()=>{
 const h=harness();h.enableEditor();h.event(status());h.get('#open-import').emit('click');h.get('#import-word-grid').children.forEach(label=>label.children[1].value='abandon');const pending=h.get('#import-form').emit('submit');h.get('#import-close').emit('click');h.get('#open-import').emit('click');assert.equal(h.get('#import-sheet').open,false);h.get('#import-result').textContent='newer journey';
 const request=h.requests.get('importAccount')[0];if(response==='throw')request.reject(Error('public transport error'));else request.resolve(response==='success'?status(other):{ok:false,error:{message:'public invalid phrase'}});await pending;
 assert.equal(h.get('#import-result').textContent,'newer journey');assert.equal(h.requests.get('importAccount').length,1);h.get('#open-import').emit('click');assert.equal(h.get('#import-sheet').open,true);assert.ok(h.get('#import-word-grid').children.every(label=>label.children[1].value===''));
});
test('actual modal current import failure is visible inside the dialog; private key and encrypted JSON remain normal import inputs',async()=>{
 const h=harness();h.enableEditor();h.event(status());h.get('#open-import').emit('click');h.get('#import-kind').value='private-key';h.get('#import-kind').emit('change');h.get('#import-value').value='public-not-a-key';const pending=h.get('#import-form').emit('submit');assert.equal(h.requests.get('importAccount')[0].args[0].value,'public-not-a-key');h.requests.get('importAccount')[0].resolve({ok:false,error:{code:'INVALID',message:'Invalid private key'}});await pending;assert.equal(h.get('#import-editor-result').textContent,'Invalid private key');assert.equal(h.get('#import-sheet').open,true);
 h.get('#import-kind').value='encrypted-json';h.get('#import-kind').emit('change');h.get('#import-file').files=[{size:2,text:async()=> '{}'}];h.get('#import-password').value='public-test-backup-password';const next=h.get('#import-form').emit('submit');await settle();const request=h.requests.get('importAccount')[1];assert.equal(request.args[0].value,'{}');assert.equal(request.args[0].password,'public-test-backup-password');assert.equal(h.get('#import-password').value,'');request.resolve({ok:false,error:{code:'INVALID',message:'Invalid backup'}});await next;
});
test('cancel during an encrypted-file read prevents the later import IPC, without retrying',async()=>{
 const h=harness();h.enableEditor();h.event(status());h.get('#open-import').emit('click');h.get('#import-kind').value='encrypted-json';h.get('#import-kind').emit('change');let finishRead;h.get('#import-file').files=[{size:2,text:()=>new Promise(resolve=>finishRead=resolve)}];const pending=h.get('#import-form').emit('submit');h.get('#import-close').emit('click');finishRead('{}');await pending;assert.equal(h.requests.get('importAccount').length,0);assert.equal(h.get('#import-sheet').open,false);
});
