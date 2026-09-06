import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import {readFile} from "node:fs/promises";
import {toYNXAddress} from "../src/wallet-address.js";
const source=(await readFile(new URL("../extension/vault.js",import.meta.url),"utf8")).replace(/^import .*;\n/gm,"");
const account="0x"+"a".repeat(40),hash="0x"+"b".repeat(64),rpc="https://evm.ynxweb4.com";
const pending=(legacy=false)=>({account,transactionHash:hash,status:legacy?"unresolved":"uncertain",blocksNewSend:true,durabilityConfirmed:false,legacyEvidenceUnavailable:legacy,rpcConfirmationRequired:legacy,rpcOrigin:legacy?null:rpc,configuredRpcOrigin:rpc,sourceOrigin:null,review:{from:account,to:"0x"+"c".repeat(40),valueWei:"2000000000000000000",nonce:"5",maximumFeeWei:"1000000000000000000"}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(transaction){
 const elements=new Map(),events=new Map(),calls=[],state={transaction};
 const element=id=>{if(!elements.has(id)){const listeners=new Map(),classes=new Set();elements.set(id,{value:"",checked:false,disabled:false,textContent:"",dataset:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name)},contains:name=>classes.has(name)},addEventListener:(event,fn)=>listeners.set(event,fn),fire:event=>listeners.get(event)?.()})}return elements.get(id)};
 const runtime=async input=>{calls.push(structuredClone(input));if(input.type==="YNX_VAULT_STATUS_V1")return{ok:true,configured:true,account,transaction:state.transaction};if(input.type==="YNX_VAULT_TRANSACTION_CHECK_V2")return{ok:true,transaction:state.transaction};if(input.type==="YNX_VAULT_TRANSACTION_RETRY_V2")return new Promise(resolve=>state.resolveRetry=resolve);if(input.type==="YNX_VAULT_TRANSACTION_CANCEL_V2")return{ok:true,cancelled:true};throw new Error("Unexpected UI action")};
 vm.runInContext(source,vm.createContext({document:{querySelector:element},navigator:{clipboard:{async writeText(value){state.copied=value}}},toYNXAddress,chrome:{runtime:{sendMessage:runtime}},crypto:webcrypto,Date,console,createEncryptedVault:async()=>{throw new Error("No key operation expected")},generateExtensionSecret:()=>{throw new Error("No signing expected")},confirm:()=>false,addEventListener:(name,fn)=>events.set(name,fn)}));await tick();return{element,calls,state,events};
}
test("actual vault UI shows original intent and requires explicit legacy RPC selection; status check sends no password",async()=>{
 const f=await fixture(pending(true));assert.equal(f.element("#transaction-check").disabled,true);assert.equal(f.element("#transaction-retry").disabled,true);assert.equal(f.element("#transaction-legacy").classList.contains("hidden"),false);assert.match(f.element("#transaction-review").textContent,/Amount: 2 YNXT/);assert.match(f.element("#transaction-review").textContent,/Ethereum nonce: 5/);
 f.element("#transaction-rpc-confirm").checked=true;f.element("#transaction-rpc-confirm").fire("change");assert.equal(f.element("#transaction-check").disabled,false);await f.element("#transaction-check").fire("click");
 const check=f.calls.find(c=>c.type==="YNX_VAULT_TRANSACTION_CHECK_V2");assert.deepEqual(check,{type:"YNX_VAULT_TRANSACTION_CHECK_V2",account,transactionHash:hash,selectedRpcOrigin:rpc});assert.equal(Object.hasOwn(check,"password"),false);assert.equal(f.calls.some(c=>c.type==="YNX_VAULT_TRANSACTION_RETRY_V2"),false);
});
test("actual vault displays and copies YNX while recovery requests retain the exact 0x account",async()=>{
 const f=await fixture(pending());assert.equal(f.element("#account").textContent,toYNXAddress(account));assert.equal(f.element("#evm-account").textContent,account);assert.match(f.element("#transaction-review").textContent,/From: ynx1/);
 f.element("#copy-address").fire("click");await tick();assert.equal(f.state.copied,toYNXAddress(account));
 await f.element("#transaction-check").fire("click");assert.equal(f.calls.find(c=>c.type==="YNX_VAULT_TRANSACTION_CHECK_V2").account,account);
});
test("actual vault Retry requires review/password and late ACK after cancel or pagehide never changes the UI",async()=>{
 for(const action of["cancel","pagehide"]){const f=await fixture(pending());f.element("#transaction-retry-confirm").checked=true;f.element("#transaction-password").value="fixture-password-only";f.element("#transaction-password").fire("input");assert.equal(f.element("#transaction-retry").disabled,false);
  const work=f.element("#transaction-retry").fire("click");await tick();const request=f.calls.find(c=>c.type==="YNX_VAULT_TRANSACTION_RETRY_V2");assert.equal(request.account,account);assert.equal(request.transactionHash,hash);assert.equal(request.reviewed,true);assert.equal(f.element("#transaction-password").value,"");
  if(action==="cancel")f.element("#transaction-cancel").fire("click");else f.events.get("pagehide")();const prior=f.element("#transaction-status").textContent;
  f.state.resolveRetry({ok:true,transaction:{...pending(),status:"confirmed",durabilityConfirmed:true,blocksNewSend:false,receiptStatus:"0x1"}});await work;
  assert.equal(f.element("#transaction-status").textContent,prior);assert.equal(f.element("#transaction-retry-confirm").checked,false);assert.equal(f.element("#transaction-password").value,"");assert.equal(f.calls.filter(c=>c.type==="YNX_VAULT_TRANSACTION_RETRY_V2").length,1);assert.equal(f.calls.find(c=>c.type==="YNX_VAULT_TRANSACTION_CANCEL_V2").requestId,request.requestId);
 }
});
