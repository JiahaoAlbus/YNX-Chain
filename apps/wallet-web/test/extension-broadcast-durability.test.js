import assert from "node:assert/strict";
import test from "node:test";
import {Wallet,Transaction} from "ethers";
import {ExtensionBroadcastJournal,BROADCAST_JOURNAL_PREFIX} from "../src/extension-broadcast-journal.js";
import {DURABILITY_MODEL} from "../src/extension-durability.js";
import {NATIVE_FEE_MODEL} from "../src/extension-fee-model.js";
import {YNX_RPC_URL} from "../src/extension-rpc.js";
const raw=await new Wallet("0x"+"46".repeat(32)).signTransaction({chainId:6423,nonce:0,to:"0x"+"35".repeat(20),value:2n*10n**18n,gasLimit:25000n,gasPrice:40000000000000n,type:0,data:"0x"}),tx=Transaction.from(raw),account=tx.from.toLowerCase(),hash=tx.hash,key=BROADCAST_JOURNAL_PREFIX+account,historyKey=BROADCAST_JOURNAL_PREFIX+"hash."+hash;
const receipt=()=>({transactionHash:hash,from:account,to:tx.to.toLowerCase(),blockNumber:"0x2",blockHash:"0x"+"a".repeat(64),status:"0x1",type:"0x0",contractAddress:null,gasUsed:NATIVE_FEE_MODEL.gas,effectiveGasPrice:NATIVE_FEE_MODEL.gasPrice,ynxFeeWei:NATIVE_FEE_MODEL.feeWei,ynxNativeTransaction:{type:"transfer",amountYNXT:"2",feeYNXT:"1",nonce:"0x1"},ynxDurability:{version:DURABILITY_MODEL.version,scope:"local-snapshot",status:"durable",transactionHash:hash,blockNumber:"0x2",blockHash:"0x"+"a".repeat(64),checkpointBlockNumber:"0x2",checkpointBlockHash:"0x"+"a".repeat(64),snapshotIntegrity:"0x"+"b".repeat(64)}});
function setup(existing={}){
 const state={...structuredClone(existing)},calls=[],hooks={},storage={async get(keys){const result=Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(state,k)).map(k=>[k,structuredClone(state[k])]));return hooks.read?hooks.read(result,keys):result},async set(values){if(hooks.beforeWrite)await hooks.beforeWrite(values);Object.assign(state,structuredClone(values));if(hooks.afterWrite)await hooks.afterWrite(values)}};
 const journal=new ExtensionBroadcastJournal(storage),rpc=async(method,params)=>{calls.push({method,params});if(hooks.rpc)return hooks.rpc(method,params);return{eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL,eth_getTransactionReceipt:null}[method]},options={account,origin:"https://fixture-dapp.example",signed:{rawTransaction:raw,transactionHash:hash},rpc,assertAuthorized:async()=>{},broadcast:async bytes=>{calls.push({method:"eth_sendRawTransaction",params:[bytes]});if(hooks.broadcast)return hooks.broadcast(bytes);return hash}};
 return{state,calls,hooks,journal,rpc,options,async pending(){hooks.broadcast=()=>{throw new Error("ACK lost")};await assert.rejects(journal.run(account,()=>journal.broadcast(options)),{code:-32002});delete hooks.broadcast},retry(extra={}){return journal.retry(account,{transactionHash:hash,rpc,broadcast:options.broadcast,authorize:async()=>{},assertAuthorized:async()=>{},...extra})}};
}
test("journal requires capability before first POST and writes exact bytes before dispatch",async()=>{
 const f=setup();f.hooks.rpc=method=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:{...DURABILITY_MODEL,extra:true}})[method];await assert.rejects(f.journal.broadcast(f.options),{code:"DURABILITY_UNCONFIRMED"});assert.equal(f.state[key],undefined);
 delete f.hooks.rpc;f.hooks.beforeWrite=()=>{throw new Error("disk unavailable")};await assert.rejects(f.journal.broadcast(f.options));assert.equal(f.calls.some(c=>c.method==="eth_sendRawTransaction"),false);
 delete f.hooks.beforeWrite;f.hooks.read=(value,keys)=>{if(Array.isArray(keys)&&keys.includes(historyKey))delete value[historyKey];return value};await assert.rejects(f.journal.broadcast(f.options),{code:"BROADCAST_RECORD_UNAVAILABLE"});assert.equal(f.calls.some(c=>c.method==="eth_sendRawTransaction"),false);assert.equal((await f.journal.status(account)).blocksNewSend,true);
});
test("receipt without exact proof, pending, null or unsupported model cannot clear unknown",async()=>{
 const f=setup();await f.pending();const original=structuredClone(f.state[key]);
 for(const value of[null,{...receipt(),ynxDurability:undefined},{...receipt(),ynxDurability:{version:DURABILITY_MODEL.version,scope:"local-snapshot",status:"pending_durable",transactionHash:hash,checkpointBlockNumber:"0x2",checkpointBlockHash:receipt().blockHash,snapshotIntegrity:receipt().ynxDurability.snapshotIntegrity}}]){
  f.hooks.rpc=method=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL,eth_getTransactionReceipt:value})[method];
  if(value===null)assert.equal((await f.journal.status(account,{rpc:f.rpc,refresh:true})).blocksNewSend,true);else await assert.rejects(f.journal.status(account,{rpc:f.rpc,refresh:true}),{code:"DURABILITY_UNCONFIRMED"});assert.deepEqual(f.state[key],original);
 }
});
test("durable evidence is stored and verified again on reload; every tampered resolution remains unresolved",async()=>{
 const f=setup();await f.pending();f.hooks.rpc=method=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL,eth_getTransactionReceipt:receipt()})[method];
 const result=await f.journal.status(account,{rpc:f.rpc,refresh:true});assert.equal(result.durabilityConfirmed,true);assert.equal(result.consensusFinality,false);assert.equal(result.blocksNewSend,false);assert.equal(result.receiptStatus,"0x1");assert.deepEqual(f.state[key],f.state[historyKey]);
 assert.equal((await setup(f.state).journal.status(account)).durabilityConfirmed,true);
 for(const mutate of[r=>delete r.resolution,r=>delete r.resolution.receipt.ynxDurability,r=>r.resolution.receipt.ynxNativeTransaction.nonce="0x2",r=>r.resolution.model.consensusFinality=true,r=>r.resolution.receipt.ynxDurability.checkpointBlockHash="0x"+"c".repeat(64),r=>r.resolution.rpcOrigin="https://other.example"]){const saved=structuredClone(f.state);mutate(saved[key]);const view=await setup(saved).journal.status(account);assert.equal(view.status,"unresolved");assert.equal(view.durabilityConfirmed,false);assert.equal(saved[key].rawTransaction,raw)}
});
test("all V1 terminal records keep original bytes and require explicit RPC selection before any lookup",async()=>{
 for(const status of["confirmed","rejected","cancelled"]){const legacy={version:1,chainId:"0x1917",account,origin:"https://unverified-old-site.example",rawTransaction:raw,transactionHash:hash,status,createdAt:1},f=setup({[key]:legacy});
  const view=await f.journal.status(account);assert.equal(view.status,"unresolved");assert.equal(view.rpcOrigin,null);assert.equal(view.legacyEvidenceUnavailable,true);assert.equal(view.sourceOrigin,legacy.origin);
  await assert.rejects(f.journal.status(account,{rpc:f.rpc,refresh:true}),{code:"RECOVERY_RPC_CONFIRMATION_REQUIRED"});await assert.rejects(f.retry(),{code:"RECOVERY_RPC_CONFIRMATION_REQUIRED"});assert.equal(f.calls.length,0);
  assert.equal((await f.journal.status(account,{rpc:f.rpc,refresh:true,selectedRpcOrigin:YNX_RPC_URL})).blocksNewSend,true);assert.equal(f.calls.some(c=>c.method==="eth_sendRawTransaction"),false);assert.deepEqual(f.state[key],legacy);
  await f.retry({selectedRpcOrigin:YNX_RPC_URL});assert.equal(f.calls.filter(c=>c.method==="eth_sendRawTransaction").length,1);assert.equal(f.state[key].rawTransaction,raw);assert.equal(f.state[key].rpcOrigin,null);assert.equal(f.state[key].unknownHistory,true);
 }
});
test("exact raw retry remains pending after ACK and every later error; no replacement signature",async()=>{
 const f=setup();await f.pending();const retried=await f.retry();assert.equal(retried.status,"acknowledged");assert.equal(retried.blocksNewSend,true);
 f.hooks.broadcast=()=>{throw Object.assign(new Error("nonce consumed"),{code:-32003,rpcResponseValidated:true})};await assert.rejects(f.retry(),{code:-32002});assert.equal(f.state[key].status,"uncertain");assert.equal(f.state[key].attempt,3);assert.equal(f.state[key].unknownHistory,true);
 assert.deepEqual(f.calls.filter(c=>c.method==="eth_sendRawTransaction").map(c=>c.params),[[raw],[raw],[raw]]);
 await assert.rejects(f.journal.run(account,()=>assert.fail("must not sign replacement")),{code:-32002});await assert.rejects(f.retry({transactionHash:"0x"+"f".repeat(64)}),{code:"TRANSACTION_CHANGED"});
});
test("cancel, storage failure, concurrent retry and late outcome preserve original unknown history",async()=>{
 const f=setup();await f.pending();let release;const hold=new Promise(resolve=>release=resolve);let reached;const started=new Promise(resolve=>reached=resolve);
 const active=f.retry({authorize:async()=>{reached();await hold}});await started;await assert.rejects(f.retry(),{code:"TRANSACTION_IN_PROGRESS"});await assert.rejects(f.journal.status(account,{refresh:true,rpc:f.rpc}),{code:"TRANSACTION_IN_PROGRESS"});release();await active;
 const before=f.calls.filter(c=>c.method==="eth_sendRawTransaction").length;await assert.rejects(f.retry({assertAuthorized:async()=>{throw Object.assign(new Error("cancelled"),{code:"RECOVERY_CANCELLED"})}}),{code:"RECOVERY_CANCELLED"});assert.equal(f.calls.filter(c=>c.method==="eth_sendRawTransaction").length,before);
 f.hooks.afterWrite=()=>{throw new Error("readback lost")};await assert.rejects(f.retry());assert.equal(f.calls.filter(c=>c.method==="eth_sendRawTransaction").length,before);assert.equal((await f.journal.status(account)).blocksNewSend,true);
});
test("first known before-dispatch cancellation and exact rejection resolve with explicit evidence only",async()=>{
 const cancelled=setup();let count=0;await assert.rejects(cancelled.journal.broadcast({...cancelled.options,assertAuthorized:async()=>{if(++count>1)throw new Error("revoked before POST")}}));assert.equal((await setup(cancelled.state).journal.status(account)).status,"cancelled");assert.equal(cancelled.calls.some(c=>c.method==="eth_sendRawTransaction"),false);
 const rejected=setup();rejected.hooks.broadcast=()=>{throw Object.assign(new Error("rejected"),{code:-32003,rpcResponseValidated:true})};await assert.rejects(rejected.journal.broadcast(rejected.options),{code:-32003});assert.equal((await setup(rejected.state).journal.status(account)).blocksNewSend,false);
 for(const f of[cancelled,rejected]){delete f.state[key].resolution;assert.equal((await setup(f.state).journal.status(account)).status,"unresolved")}
});

test("a storage error cannot masquerade as a first server rejection after a successful POST",async()=>{
 const f=setup();f.hooks.afterWrite=values=>{if(values[key].status==="acknowledged")throw Object.assign(new Error("storage failure"),{code:-32003,rpcResponseValidated:true})};await assert.rejects(f.journal.broadcast(f.options),{code:-32002});assert.equal(f.state[key].status,"uncertain");assert.equal(f.calls.filter(c=>c.method==="eth_sendRawTransaction").length,1);assert.equal((await setup(f.state).journal.status(account)).blocksNewSend,true);
});

test("receipt final model response cannot hide a chain switch after the earlier chain check",async()=>{
 const f=setup();await f.pending();let chain="0x1917",models=0;
 f.hooks.rpc=method=>{if(method==="ynx_getDurabilityModel"&&++models===2)chain="0x1";return{eth_chainId:chain,ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL,eth_getTransactionReceipt:receipt()}[method]};
 await assert.rejects(f.journal.status(account,{rpc:f.rpc,refresh:true}),{code:"WRONG_NETWORK"});assert.equal(f.state[key].status,"uncertain");assert.equal((await setup(f.state).journal.status(account)).blocksNewSend,true);
});
test("password waiting and dispatch readback drift cannot send to a changed chain or disabled native model",async()=>{
 for(const mode of["chain","fee","durability"]){const f=setup();await f.pending();let changed=false;
  f.hooks.rpc=method=>({eth_chainId:changed&&mode==="chain"?"0x1":"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:!(changed&&mode==="fee")},ynx_getDurabilityModel:changed&&mode==="durability"?{...DURABILITY_MODEL,extra:true}:DURABILITY_MODEL})[method];
  await assert.rejects(f.retry({authorize:async()=>{changed=true}}));assert.equal(f.calls.filter(c=>c.method==="eth_sendRawTransaction").length,1);assert.equal(f.state[key].unknownHistory,true);assert.equal(f.state[key].rawTransaction,raw);
 }
 const f=setup();let changed=false;f.hooks.rpc=method=>({eth_chainId:changed?"0x1":"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL})[method];
 f.hooks.read=(result,keys)=>{if(Array.isArray(keys)&&keys.includes(historyKey))changed=true;return result};
 await assert.rejects(f.journal.broadcast(f.options),{code:"WRONG_NETWORK"});assert.equal(f.calls.filter(c=>c.method==="eth_sendRawTransaction").length,0);assert.equal(f.state[key].rawTransaction,raw);assert.equal(f.state[key].resolution.kind,"cancelled-before-dispatch");
});
