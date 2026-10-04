import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
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
    prepareRecovery:async input=>{calls.push({...input});return{ok:true,value:{previewId:"review-a",account:input.account,resetPassword:input.resetPassword,recoveryRequiredAccounts:[],expiresAt:Date.now()+60_000}}},commitRecovery:async id=>{calls.push({commit:id});return{ok:true,value:{...status,remoteDisconnectFailures:[]}}}};
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
for(const delta of [{account:"account-b"},{initialized:false},{passwordConfigured:false},{accounts:[]},{accounts:[{account:"account-a",state:"protected"}]},{accounts:[{account:"account-a",state:"protected"},{account:"account-a",state:"protected"}]},{accounts:[{account:"account-a",state:"recovery-required"},{account:"account-b",state:"protected"}]}])test(`commit acknowledgement cannot report a different recovery outcome: ${JSON.stringify(delta)}`,async()=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();
  h.api.commitRecovery=async()=>({ok:true,value:{...h.status,remoteDisconnectFailures:[],...delta}});
  await h.get("commit-recovery").emit("click");assert.equal(h.get("recovery-sheet").open,true);
  assert.ok(!h.get("unlock-result").textContent.includes("Account recovery is saved"));
  assert.match(h.get("recovery-result").textContent,/Recovery did not finish/);
});
for(const failures of [[{topic:"retained-topic",code:"RELAY_UNAVAILABLE"}],undefined,"invalid",[null]])test(`saved recovery does not silently claim remote cleanup for ${JSON.stringify(failures)}`,async()=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();
  h.api.commitRecovery=async()=>({ok:true,value:{...h.status,remoteDisconnectFailures:failures}});
  await h.get("commit-recovery").emit("click");assert.equal(h.get("recovery-sheet").open,false);
  assert.match(h.get("unlock-result").textContent,/Account recovery is saved/);
  assert.match(h.get("unlock-result").textContent,/Remote app connection cleanup is unconfirmed/);
});
test("successful exact recovery with confirmed empty failures remains locked-facing without an extra cleanup warning",async()=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();await h.get("commit-recovery").emit("click");
  assert.match(h.get("unlock-result").textContent,/Unlock with the current local password/);
  assert.ok(!h.get("unlock-result").textContent.includes("cleanup is unconfirmed"));assert.equal(h.get("recovery-sheet").open,false);
});
test("reset-password preview must enumerate every other retained account before explicit commit",async()=>{
  const h=fixture();await h.open();h.get("recovery-password-mode").value="reset";h.get("recovery-password-mode").emit("change");
  h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();await h.get("commit-recovery").emit("click");
  assert.equal(h.calls.some(call=>call.commit),false);assert.equal(h.get("recovery-review").hidden,true);
});
test("matching reset-password outcome confirms the reviewed account and keeps every other account recovery-required",async()=>{
  const h=fixture();await h.open();h.get("recovery-password-mode").value="reset";h.get("recovery-password-mode").emit("change");
  h.api.prepareRecovery=async input=>({ok:true,value:{previewId:"reset-review",account:input.account,resetPassword:true,recoveryRequiredAccounts:["account-b"],expiresAt:Date.now()+60_000}});
  h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();
  h.api.commitRecovery=async()=>({ok:true,value:{...h.status,accounts:h.status.accounts.map(item=>({...item,state:item.account==="account-a"?"protected":"recovery-required"})),remoteDisconnectFailures:[]}});
  await h.get("commit-recovery").emit("click");assert.equal(h.get("recovery-sheet").open,false);assert.match(h.get("unlock-result").textContent,/Account recovery is saved/);
});
test("late saved acknowledgement after explicit cancel/reopen cannot close or alter the new recovery draft",async()=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();
  const pending=deferred();h.api.commitRecovery=()=>pending.promise;const old=h.get("commit-recovery").emit("click");
  h.ui.cancel({explicit:true});await h.open();h.get("recovery-current-password").value="new fictional draft";h.get("unlock-result").textContent="new view notice";
  pending.resolve({ok:true,value:{...h.status,remoteDisconnectFailures:[]}});await old;
  assert.equal(h.get("recovery-sheet").open,true);assert.equal(h.get("recovery-current-password").value,"new fictional draft");assert.equal(h.get("unlock-result").textContent,"new view notice");
});
for(const remoteFailure of [false,true])test(`actual main custody-change result composes with recovery UI; remoteFailure=${remoteFailure}`,async t=>{
  const h=fixture();await h.open();h.choose(h.get("recovery-file"),backup("CURRENT encrypted JSON"));await h.submit();
  const life=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},method:"controlled-no-key-custody"}});
  life.setFocused(true);life.setAccount("account-a");t.after(()=>life.lock());
  const calls=[],events=[],pending=[{key:"old-request"}],sessions=[{topic:"old-session"}];
  const context={accountChangeInProgress:false,walletConnectProposalActions:new Set(),keyAccess:life,
    walletConnectInbox:{pending:()=>pending,finish:key=>calls.push(`finish:${key}`)},terminateWalletConnectReview:async(entry,reason)=>calls.push(`terminate:${reason}`),
    walletAuthority:{permissions:{revokeAll:async()=>{assert.equal(life.status().locked,true);calls.push("revoke-local")}}},
    walletConnect:{sessions:()=>sessions,disconnectSession:async()=>{calls.push("disconnect-remote");if(remoteFailure)throw Error("controlled remote failure")}},
    mainWindow:{webContents:{send:(name,value)=>events.push({name,value})}},safeCode:()=>"CONTROLLED_REMOTE_FAILURE"};
  const source=readFileSync(new URL("../src/main.mjs",import.meta.url),"utf8"),start=source.indexOf("async function custodyChange("),end=source.indexOf('app.on("open-url"',start);
  assert.ok(start>=0&&end>start);runInNewContext(source.slice(start,end),context);
  h.api.commitRecovery=async()=>({ok:true,value:await context.custodyChange(async(guard,beforePublish)=>{guard.assert();await beforePublish();guard.assert();calls.push("publish-controlled-status");return h.status;})});
  await h.get("commit-recovery").emit("click");
  assert.deepEqual(calls,["finish:old-request","terminate:ACCOUNT_CHANGED","revoke-local","publish-controlled-status","disconnect-remote"]);
  assert.equal(life.status().locked,true);assert.equal(context.accountChangeInProgress,false);
  assert.equal(events.at(-1).value.type,"custody-changed");assert.equal(events.at(-1).value.remoteDisconnectFailures.length,remoteFailure?1:0);
  assert.equal(h.get("unlock-result").textContent.includes("cleanup is unconfirmed"),remoteFailure);
  assert.equal(h.get("recovery-sheet").open,false);
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
