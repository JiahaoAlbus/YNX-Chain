import assert from "node:assert/strict";
import {realpathSync} from "node:fs";
import {pathToFileURL} from "node:url";
import path from "node:path";

// Read-only gate for normal CUA/human-operated journeys in an isolated profile.
// Does not enter credentials, create accounts, activate windows or bypass locks.
const [port,productDirectory,stage="empty-profile"]=process.argv.slice(2);
if(!/^\d{1,5}$/.test(port??"")||!productDirectory||!["empty-profile","two-accounts","receive","send-review","locked"].includes(stage))throw Error("usage: desktop-product-ui-qa.mjs <local CDP port> <exact product directory> [empty-profile|two-accounts|receive|send-review|locked]");
const expected=pathToFileURL(path.join(realpathSync(productDirectory),"src/index.html")).href;
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target=targets.find(item=>item.type==="page"&&item.url===expected);
if(!target)throw Error("The exact isolated Wallet page was not found");
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true})});
try {
  const state=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Wallet public state timed out")),10000);
    socket.addEventListener("message",event=>{
      const response=JSON.parse(event.data);if(response.id!==1)return;clearTimeout(timer);
      if(response.error||response.result?.exceptionDetails)reject(Error("Wallet public state read failed"));
      else resolve(response.result.result.value);
    });
    socket.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{awaitPromise:true,returnByValue:true,expression:`(async()=>({
      account:await window.ynxWallet.accountStatus(),security:await window.ynxWallet.securityStatus(),focused:document.hasFocus(),
      passwordInputLengths:Array.from(document.querySelectorAll('input[type=password]'),field=>field.value.length),
      receive:{open:document.querySelector('#receive-sheet').open,address:document.querySelector('#receive-address').value,qrVisible:!document.querySelector('#receive-qr').hidden},
      sendOpen:document.querySelector('#send-sheet').open,reviewOpen:document.querySelector('#transfer-review').open,
      historyRows:document.querySelectorAll('#transaction-history-list article').length,historyStatus:document.querySelector('#transaction-history-status').textContent
    }))()`}}));
  });
  assert.equal(state.account.ok,true);assert.equal(state.account.value.secretExported,false);
  if(stage==="empty-profile"){assert.equal(state.account.value.accounts.length,0);assert.equal(state.account.value.passwordConfigured,false);assert.equal(state.security.locked,true)}
  if(stage==="two-accounts"){assert.equal(state.account.value.accounts.length,2);assert.equal(state.account.value.passwordConfigured,true)}
  if(stage==="receive"){assert.equal(state.receive.open,true);assert.equal(state.receive.qrVisible,true);assert.equal(state.receive.address,state.account.value.ynxAccount)}
  if(stage==="send-review"){assert.equal(state.security.locked,false);assert.equal(state.reviewOpen,true)}
  if(stage==="locked"){assert.equal(state.security.locked,true);assert.equal(state.sendOpen,false);assert.equal(state.reviewOpen,false);assert.ok(state.passwordInputLengths.every(length=>length===0))}
  console.log(JSON.stringify({stage,gatePassed:true,focused:state.focused,accountCount:state.account.value.accounts.length,selectedAccount:state.account.value.account,locked:state.security.locked,secretExported:false,historyRows:state.historyRows,historyStatus:state.historyStatus,credentialEntryPerformed:false,chainWritesPerformed:false,completeJourneyVerified:false,installedReleaseVerified:false}));
}finally{socket.close()}
