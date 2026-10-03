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

function security(h,state){
 if(!h.context.renderKeyState){Object.assign(h.context,{securityViewRevision:0,approvalQueue:{clear(){},suspend(){}},authorizationChoices:new Map(),presentApproval(){}});h.context.passwordUI.cancel=()=>{};
 const a=source.indexOf("function renderKeyState(state)"),b=source.indexOf("passwordUI = createPasswordVaultUI",a);runInNewContext(source.slice(a,b),h.context);}
 h.context.renderKeyState(state);
}
for(const later of [false,true])test(`actual import own-event acknowledgement, later security journey=${later}`,async()=>{
 const h=harness();h.event(status());security(h,{locked:false,revision:1,account,authenticating:false});
 h.get('#import-kind').value='private-key';const pending=h.get('#import-form').emit('submit');
 security(h,{locked:true,revision:2,account:other,authenticating:false});h.event(status(other));
 if(later){security(h,{locked:false,revision:2,account:other,authenticating:false});security(h,{locked:true,revision:3,account:other,authenticating:false});h.get('#import-result').textContent='newer security journey notice';}
 h.requests.get('importAccount')[0].resolve(status(other));await pending;
 assert.equal(h.get('#import-result').textContent,later?'newer security journey notice':'Account imported. Save a backup and keep it safe.');
});
test('actual backup stale finally cannot enable a later same-account backup after lock/unlock',async()=>{
 const h=harness();h.event(status());security(h,{locked:false,revision:1,account,authenticating:false});
 h.get('#backup-password').value=h.get('#backup-confirm').value='public dummy only';const old=h.get('#backup-form').emit('submit');
 security(h,{locked:true,revision:2,account,authenticating:false});security(h,{locked:false,revision:2,account,authenticating:false});
 h.get('#backup-password').value=h.get('#backup-confirm').value='new dummy only';const fresh=h.get('#backup-form').emit('submit');
 assert.equal(h.get('#save-backup').disabled,true);h.requests.get('saveBackup')[0].resolve({ok:true,value:{saved:true}});await old;
 const disabled=h.get('#save-backup').disabled;h.requests.get('saveBackup')[1].resolve({ok:true,value:{saved:false}});await fresh;assert.equal(disabled,true,'old finally enabled newer pending action');
});

function controls(h){
 h.context.document.querySelectorAll=selector=>selector.startsWith('#create-account,')?[h.get('#create-account'),h.get('#add-account'),h.get('#import-form button'),h.get('#save-backup')]:[];
}
test('normal own import commit survives unchanged security notifications without repeating account rendering',async()=>{
 const h=harness();h.event(status());security(h,{locked:false,revision:1,account,authenticating:false});controls(h);
 h.get('#import-kind').value='private-key';const pending=h.get('#import-form').emit('submit');
 const committed={locked:true,revision:4,account:other,authenticating:false};security(h,committed);h.event(status(other));security(h,{...committed});
 const view=h.context.accountViewRevision;h.requests.get('importAccount')[0].resolve(status(other));await pending;
 assert.equal(h.get('#import-result').textContent,'Account imported. Save a backup and keep it safe.');assert.equal(h.context.accountViewRevision,view);
});
test('unchanged normal lifecycle refresh preserves current backup busy state and successful receipt',async()=>{
 const h=harness();h.event(status());const state={locked:false,revision:1,account,authenticating:false};security(h,state);controls(h);
 h.get('#backup-password').value=h.get('#backup-confirm').value='public dummy only';const pending=h.get('#backup-form').emit('submit');
 security(h,{...state});assert.equal(h.get('#save-backup').disabled,true);
 h.requests.get('saveBackup')[0].resolve({ok:true,value:{saved:true}});await pending;
 assert.equal(h.get('#backup-result').textContent,'Encrypted backup saved. Keep its password separately.');assert.equal(h.get('#save-backup').disabled,false);
});
for(const outcome of ['success','failure','throw'])test(`old same-account backup ${outcome} leaves newer action, notice and draft owned`,async()=>{
 const h=harness();h.event(status());security(h,{locked:false,revision:1,account,authenticating:false});controls(h);
 h.get('#backup-password').value=h.get('#backup-confirm').value='old public dummy';const old=h.get('#backup-form').emit('submit');
 security(h,{locked:true,revision:2,account,authenticating:false});security(h,{locked:false,revision:2,account,authenticating:false});
 h.get('#backup-password').value=h.get('#backup-confirm').value='fresh public dummy';const fresh=h.get('#backup-form').emit('submit');
 h.get('#backup-result').textContent='newer pending backup notice';h.get('#backup-password').value='newer unsent draft';
 const request=h.requests.get('saveBackup')[0];if(outcome==='throw')request.reject(Error('old IPC failed'));else request.resolve(outcome==='success'?{ok:true,value:{saved:true}}:{ok:false,error:{message:'old refusal'}});
 await old;assert.equal(h.get('#save-backup').disabled,true);assert.equal(h.get('#backup-result').textContent,'newer pending backup notice');assert.equal(h.get('#backup-password').value,'newer unsent draft');
 h.requests.get('saveBackup')[1].resolve({ok:true,value:{saved:false}});await fresh;assert.equal(h.get('#backup-result').textContent,'Backup was not saved.');assert.equal(h.get('#save-backup').disabled,false);
});
test('old import receipt and finally cannot claim a later same-account import operation',async()=>{
 const h=harness();h.event(status());security(h,{locked:false,revision:1,account,authenticating:false});controls(h);
 h.get('#import-kind').value='private-key';const old=h.get('#import-form').emit('submit');
 security(h,{locked:true,revision:2,account:other,authenticating:false});h.event(status(other));security(h,{locked:false,revision:2,account:other,authenticating:false});
 const fresh=h.get('#import-form').emit('submit');h.get('#import-result').textContent='newer import notice';h.get('#import-file').value='newer file draft';
 h.requests.get('importAccount')[0].resolve(status(other));await old;
 assert.equal(h.get('#import-form button').disabled,true);assert.equal(h.get('#import-result').textContent,'newer import notice');assert.equal(h.get('#import-file').value,'newer file draft');
 security(h,{locked:true,revision:3,account:other,authenticating:false});h.event(status(other));h.requests.get('importAccount')[1].resolve(status(other));await fresh;
 assert.equal(h.get('#import-result').textContent,'Account imported. Save a backup and keep it safe.');
});
test('new invalid backup submission owns its notice over an older pending receipt',async()=>{
 const h=harness();h.event(status());security(h,{locked:false,revision:1,account,authenticating:false});
 h.get('#backup-password').value=h.get('#backup-confirm').value='old public dummy';const old=h.get('#backup-form').emit('submit');
 h.get('#backup-password').value='different';h.get('#backup-confirm').value='confirmation';await h.get('#backup-form').emit('submit');
 h.requests.get('saveBackup')[0].resolve({ok:true,value:{saved:true}});await old;
 assert.equal(h.get('#backup-result').textContent,'The backup passwords do not match.');assert.equal(h.get('#backup-password').value,'different');
});
