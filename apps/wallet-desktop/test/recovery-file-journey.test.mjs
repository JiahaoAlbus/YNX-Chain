import test from "node:test";
import assert from "node:assert/strict";
const {createPasswordVaultUI}=await import(process.env.YNX_RECOVERY_UI_SOURCE??"../src/password-vault-ui.mjs");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function fixture(){
  const nodes=new Map(),calls=[];let keyState={locked:true,revision:1};
  const accounts=["account-a","account-b"].map(account=>({account,ynxAccount:account,state:"protected"}));
  const status={initialized:true,passwordConfigured:true,account:"account-a",accounts};
  const fieldIDs=["local-password","local-confirm","recovery-value","recovery-file","recovery-backup-password","recovery-current-password","recovery-new-password","recovery-confirm"];
  class Node{
    constructor(id=""){this.id=id;this.listeners={};this._value="";this.files=[];this.open=false;this.hidden=false;this.disabled=false;this.children=[];this.ownerDocument=doc;this.textContent=""}
    set value(value){this._value=value;if(this.id==="recovery-file"&&value==="")this.files=[]}
    get value(){return this._value}
    set textContent(value){this.children=[];this._text=String(value)}
    get textContent(){return this.children.length?this.children.map(child=>child.textContent??"").join(""):this._text??""}
    addEventListener(type,handler){this.listeners[type]=handler}
    emit(type){return this.listeners[type]?.({preventDefault(){}})}
    showModal(){this.open=true} close(){this.open=false} focus(){}
    append(...items){this.children.push(...items)} replaceChildren(...items){this.children=items}
    cloneNode(){const node=new Node(this.id);node.disabled=this.disabled;return node}
    replaceWith(node){if(nodes.get(this.id)===this)nodes.set(this.id,node)}
  }
  const get=id=>{id=id.replace(/^#/,"");if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id)};
  const doc={documentElement:{},querySelector:get,querySelectorAll:selector=>{
    if(selector==="[data-custody-cancel]")return[get("cancel-custody")];
    if(selector.includes("#password-sheet input"))return fieldIDs.map(get);
    if(selector.includes("#password-form input"))return [...fieldIDs,"commit-recovery","submit-password","recovery-kind","recovery-account","recovery-password-mode"].map(get);
    return[];
  },createElement:()=>new Node(),createTextNode:text=>({textContent:text})};
  const api={lock:async()=>{keyState={locked:true,revision:keyState.revision+1};return keyState},accountStatus:async()=>({ok:true,value:status}),recoveryHistory:async()=>({ok:true,value:[]}),
    prepareRecovery:async input=>{calls.push({...input});return{ok:true,value:{previewId:"review-a",account:input.account,resetPassword:input.resetPassword,recoveryRequiredAccounts:[],expiresAt:Date.now()+60_000}}},commitRecovery:async id=>{calls.push({commit:id});return{ok:true,value:status}}};
  const ui=createPasswordVaultUI({api,document:doc,getKeyState:()=>keyState,getAccountStatus:()=>status,renderAccount(){}});
  const open=async()=>{await get("recover-wallet").emit("click");get("recovery-account").value=status.account;get("recovery-kind").value="encrypted-json";get("recovery-password-mode").value="keep";};
  const choose=(node,file)=>{node.emit("click");node.files=[file];node.emit("change")};
  const submit=()=>get("recovery-form").emit("submit");
  return{get,api,ui,calls,status,open,choose,submit};
}
const backup=text=>({size:Buffer.byteLength(text),text:async()=>text.replace(/^\uFEFF/,""),arrayBuffer:async()=>new TextEncoder().encode(text).buffer,slice(start,end){return backup(text.slice(start,end))}});
for(const boundary of ["same-account-reopen","account-switch","source-change"])test(`native chooser from ${boundary} cannot supply a backup to the new recovery draft`,async()=>{
  const h=fixture();await h.open();const old=h.get("recovery-file");old.emit("click");
  if(boundary==="source-change"){h.get("recovery-kind").value="private-key";h.get("recovery-kind").emit("change");h.get("recovery-kind").value="encrypted-json";h.get("recovery-kind").emit("change")}
  else{h.ui.cancel();if(boundary==="account-switch")h.status.account="account-b";await h.open()}
  old.files=[backup("OLD encrypted JSON")];old.emit("change");await h.submit();
  assert.equal(h.calls.length,0);assert.equal(h.get("recovery-review").hidden,true);
});
test("an old chooser cannot overwrite the fresh file deliberately selected in a reopened same-account recovery",async()=>{
  const h=fixture();await h.open();const old=h.get("recovery-file");old.emit("click");h.ui.cancel();await h.open();
  h.choose(h.get("recovery-file"),backup("NEW encrypted JSON"));old.files=[backup("OLD encrypted JSON")];old.emit("change");await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].value,"NEW encrypted JSON");assert.equal(h.calls[0].account,"account-a");
});
test("normal explicit file selection, bounded read, account preview and commit use only the current draft",async()=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].value,"CURRENT encrypted JSON");assert.equal(h.get("recovery-review").hidden,false);
  await h.get("commit-recovery").emit("click");assert.equal(h.calls[1].commit,"review-a");
});
test("late backup read after cancel cannot call prepareRecovery or clear a new form draft",async()=>{
  const h=fixture();await h.open();const pending=deferred(),file={size:4,text:()=>pending.promise,arrayBuffer:async()=>new TextEncoder().encode(await pending.promise).buffer,slice(){return this}};
  h.choose(h.get("recovery-file"),file);const old=h.submit();h.ui.cancel();await h.open();h.get("recovery-current-password").value="new fictional draft";
  pending.resolve("OLD!");await old;assert.equal(h.calls.length,0);assert.equal(h.get("recovery-current-password").value,"new fictional draft");
});
test("file text exceeding the declared selection size is refused before custody IPC",async()=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),{size:4,text:async()=>"longer changed file",arrayBuffer:async()=>new TextEncoder().encode("longer changed file").buffer,slice(){return this}});await h.submit();
  assert.equal(h.calls.length,0);assert.equal(h.get("recovery-review").hidden,true);
});
for(const control of ["recovery-account","recovery-kind","recovery-password-mode"])test(`late local backup bytes cannot become custody input after a new ${control} draft`,async()=>{
  const h=fixture();await h.open();const pending=deferred(),file={size:4,text:()=>pending.promise,arrayBuffer:async()=>new TextEncoder().encode(await pending.promise).buffer,slice(){return this}};
  h.choose(h.get("recovery-file"),file);const old=h.submit();
  h.get(control).value=control==="recovery-account"?"account-b":control==="recovery-kind"?"private-key":"reset";h.get(control).emit("change");
  h.get("recovery-new-password").value="new fictional password draft";pending.resolve("OLD!");await old;
  assert.equal(h.calls.length,0);assert.equal(h.get("recovery-new-password").value,"new fictional password draft");assert.equal(h.get("commit-recovery").disabled,false);
});
test("bounded UTF-8 recovery read preserves existing BOM and Unicode JSON compatibility",async()=>{
  const h=fixture();await h.open();const text='\uFEFF{"label":"离线备份"}';h.choose(h.get("recovery-file"),backup(text));await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].value,'{"label":"离线备份"}');
});
for(const delta of [{account:"account-b"},{previewId:""},{previewId:"x".repeat(129)},{resetPassword:true},{recoveryRequiredAccounts:["unknown-account"]},{recoveryRequiredAccounts:["account-a"]},{recoveryRequiredAccounts:["account-b","account-b"]},{expiresAt:0}])test(`a recovery review projection must match the selected account, mode and retained accounts: ${JSON.stringify(delta)}`,async()=>{
  const h=fixture();await h.open();h.api.prepareRecovery=async input=>({ok:true,value:{previewId:"review-a",account:input.account,resetPassword:input.resetPassword,recoveryRequiredAccounts:[],expiresAt:Date.now()+60_000,...delta}});
  h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();await h.get("commit-recovery").emit("click");
  assert.equal(h.get("recovery-review").hidden,true);assert.equal(h.calls.length,0);assert.match(h.get("recovery-result").textContent,/Recovery did not finish/);
});
test("changing the selected historic Wallet invalidates its pending preview, not a later recovery draft",async()=>{
  const h=fixture();await h.open();h.get("recovery-kind").value="previous-password";h.get("recovery-kind").emit("change");h.get("recovery-history").value="old-history";
  const pending=deferred();h.api.prepareRecovery=()=>pending.promise;const old=h.submit();
  h.get("recovery-history").value="new-history";h.get("recovery-history").emit("change");h.get("recovery-backup-password").value="new fictional password draft";
  pending.resolve({ok:true,value:{previewId:"old-review",account:"account-a",resetPassword:false,recoveryRequiredAccounts:[],expiresAt:Date.now()+60_000}});await old;
  assert.equal(h.get("recovery-review").hidden,true);assert.equal(h.get("recovery-backup-password").value,"new fictional password draft");await h.get("commit-recovery").emit("click");assert.equal(h.calls.length,0);
});
