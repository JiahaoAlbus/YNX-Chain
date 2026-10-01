import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
const source=await readFile(new URL("../src/hosted-wallet-app.js",import.meta.url),"utf8");
function fixture(){
  const nodes={"transaction-panel":{hidden:false},"transaction-status":{dataset:{}}};
  const context=vm.createContext({vault:{account:"A"},transactionReadRevision:0,transactionAccount:"A",transactionRecord:{transactionHash:"original",status:"signed",blocksNewSend:true},transactionError:null,transactionBusy:false,$:id=>nodes[id],copy:k=>k,fail:c=>{throw Object.assign(new Error(c),{code:c});},assertSelectedAccount:async()=>{},forwardExtensionRpc(){throw new Error("Unexpected RPC");},broadcastJournal:{status:async()=>null},withHostedAccountLock:async(_,fn)=>fn()});
  const render=source.slice(source.indexOf("function renderTransactionStatus()"),source.indexOf("function applyLocale("));
  const refresh=source.slice(source.indexOf("async function refreshTransactionStatus("),source.indexOf("function reply("));
  context.transactionRefreshFlight=null;
  vm.runInContext(render+refresh,context);return {context,nodes,refresh:(refresh=true)=>vm.runInContext(`refreshTransactionStatus(${refresh})`,context)};
}
test("temporary lock conflict preserves original journal view; a later locked read clears only busy",async()=>{
  const f=fixture();let reads=0;
  f.context.broadcastJournal.status=async()=>{reads++;return {transactionHash:"original",status:"signed",blocksNewSend:true};};
  f.context.withHostedAccountLock=async()=>{throw Object.assign(new Error("busy"),{code:"HOSTED_ACCOUNT_BUSY"});};
  await f.refresh();assert.equal(reads,0);assert.equal(f.context.transactionRecord.transactionHash,"original");assert.equal(f.context.transactionError,null);assert.equal(f.context.transactionBusy,true);assert.equal(f.nodes["transaction-status"].textContent,"txBusy");
  f.context.withHostedAccountLock=async(_,fn)=>fn();await f.refresh();assert.equal(reads,1);assert.equal(f.context.transactionBusy,false);assert.equal(f.context.transactionRecord.blocksNewSend,true);
});
test("account switch fences a delayed original-account journal read",async()=>{
  const f=fixture();let release;f.context.broadcastJournal.status=()=>new Promise(r=>release=r);
  const pending=f.refresh();await new Promise(r=>setImmediate(r));f.context.vault={account:"B"};f.context.transactionRecord={transactionHash:"new-account"};release({transactionHash:"old-account"});await pending;assert.equal(f.context.transactionRecord.transactionHash,"new-account");
});
test("real journal failures remain unavailable rather than classified as temporary busy",async()=>{
  const f=fixture();f.context.broadcastJournal.status=async()=>{throw Object.assign(new Error("invalid"),{code:"HOSTED_JOURNAL_INVALID"});};await f.refresh();assert.equal(f.context.transactionBusy,false);assert.equal(f.context.transactionError,"HOSTED_JOURNAL_INVALID");assert.equal(f.context.transactionRecord,null);
});
test("older same-account refresh cannot overwrite a later confirmed status",async()=>{
  const f=fixture();let done;f.context.broadcastJournal.status=()=>new Promise(r=>done=r);const old=f.refresh(false);await new Promise(r=>setImmediate(r));
  f.context.broadcastJournal.status=async()=>({transactionHash:"same-hash",status:"confirmed",blocksNewSend:false});await f.refresh();done({transactionHash:"same-hash",status:"broadcast-unknown",blocksNewSend:true});await old;assert.equal(f.context.transactionRecord.status,"confirmed");
});
test("repeated local Refresh shares its held-lock read and cannot strand busy after confirmed result",async()=>{
  const f=fixture();let held=false,release,reads=0;
  f.context.withHostedAccountLock=async(_,fn)=>{if(held)throw Object.assign(new Error("busy"),{code:"HOSTED_ACCOUNT_BUSY"});held=true;try{return await fn();}finally{held=false;}};
  f.context.broadcastJournal.status=()=>{reads++;return new Promise(r=>release=r);};
  const first=f.refresh();await new Promise(r=>setImmediate(r));const second=f.refresh();release({transactionHash:"original",status:"confirmed",blocksNewSend:false});await Promise.all([first,second]);
  assert.equal(reads,1);assert.equal(held,false);assert.equal(f.context.transactionBusy,false);assert.equal(f.context.transactionRecord.status,"confirmed");assert.equal(f.context.transactionRefreshFlight,null);
});
test("displaying an externally selected account synchronously clears old-account hash without journal writes",()=>{
  const f=fixture();f.context.vault={account:"B"};f.context.renderManagerLock=()=>{};f.context.toYNXAddress=x=>x;
  for(const id of ["account-card","account-ynx","account-evm"])f.nodes[id]={};
  vm.runInContext(source.slice(source.indexOf("function displayAccount()"),source.indexOf("async function refreshAccountList()")),f.context);
  vm.runInContext("displayAccount()",f.context);assert.equal(f.context.transactionAccount,"B");assert.equal(f.context.transactionRecord,null);assert.equal(f.nodes["transaction-panel"].hidden,true);assert.equal(f.nodes["transaction-status"].textContent,"");
});
