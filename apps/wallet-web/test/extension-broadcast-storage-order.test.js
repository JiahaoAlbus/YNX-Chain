import assert from "node:assert/strict";
import test from "node:test";
import {Wallet,Transaction} from "ethers";
import {ExtensionBroadcastJournal,BROADCAST_JOURNAL_PREFIX} from "../src/extension-broadcast-journal.js";
import {DURABILITY_MODEL} from "../src/extension-durability.js";
import {NATIVE_FEE_MODEL} from "../src/extension-fee-model.js";
const raw=await new Wallet("0x"+"47".repeat(32)).signTransaction({chainId:6423,nonce:0,to:"0x"+"36".repeat(20),value:2n*10n**18n,gasLimit:25000n,gasPrice:40000000000000n,type:0,data:"0x"}),tx=Transaction.from(raw),account=tx.from.toLowerCase(),hash=tx.hash,key=BROADCAST_JOURNAL_PREFIX+account,history=BROADCAST_JOURNAL_PREFIX+"hash."+hash;
function reordered(value){if(Array.isArray(value))return value.map(reordered);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,reordered(value[key])]));return value}
const receipt=()=>({transactionHash:hash,from:account,to:tx.to.toLowerCase(),blockNumber:"0x2",blockHash:"0x"+"a".repeat(64),status:"0x1",type:"0x0",contractAddress:null,gasUsed:NATIVE_FEE_MODEL.gas,effectiveGasPrice:NATIVE_FEE_MODEL.gasPrice,ynxFeeWei:NATIVE_FEE_MODEL.feeWei,ynxNativeTransaction:{type:"transfer",amountYNXT:"2",feeYNXT:"1",nonce:"0x1"},ynxDurability:{version:DURABILITY_MODEL.version,scope:"local-snapshot",status:"durable",transactionHash:hash,blockNumber:"0x2",blockHash:"0x"+"a".repeat(64),checkpointBlockNumber:"0x2",checkpointBlockHash:"0x"+"a".repeat(64),snapshotIntegrity:"0x"+"b".repeat(64)}});
function setup(){
 const data={},hooks={},posts=[];let readbacks=0;
 const storage={async set(values){Object.assign(data,reordered(structuredClone(values)))},async get(keys){const many=Array.isArray(keys);const values=Object.fromEntries((many?keys:[keys]).filter(k=>Object.hasOwn(data,k)).map(k=>[k,reordered(structuredClone(data[k]))]));if(many){readbacks++;hooks.read?.(values)}return values}};
 const rpc=async method=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL,eth_getTransactionReceipt:hooks.receipt??null})[method];
 const journal=new ExtensionBroadcastJournal(storage),options={account,origin:"https://fixture.example",signed:{rawTransaction:raw,transactionHash:hash},rpc,assertAuthorized:async()=>{},broadcast:async bytes=>{assert(readbacks>0);assert.equal(data[key].rawTransaction,raw);assert.deepEqual(data[key],data[history]);assert.equal(bytes,raw);posts.push(bytes);if(hooks.reject)throw hooks.reject;return hash}};
 return{data,hooks,posts,storage,rpc,journal,options,retry:()=>journal.retry(account,{transactionHash:hash,rpc,broadcast:options.broadcast,authorize:async()=>{},assertAuthorized:async()=>{}})};
}
test("reordered browser storage permits the first exact POST and reload-verifiable nested receipt",async()=>{
 const f=setup();assert.equal(await f.journal.broadcast(f.options),hash);assert.deepEqual(f.posts,[raw]);assert.equal(f.data[key].status,"acknowledged");
 f.hooks.receipt=receipt();const result=await f.journal.status(account,{rpc:f.rpc,refresh:true});assert.equal(result.durabilityConfirmed,true);assert.equal(result.blocksNewSend,false);assert.equal((await new ExtensionBroadcastJournal(f.storage).status(account)).durabilityConfirmed,true);assert.deepEqual(f.data[key],f.data[history]);
});
test("reordered storage preserves unknown history across restart and exact-byte Retry",async()=>{
 const f=setup();f.hooks.reject=new Error("fixture missing ACK");await assert.rejects(f.journal.broadcast(f.options),{code:-32002});assert.equal(f.data[key].unknownHistory,true);
 delete f.hooks.reject;await f.retry();assert.deepEqual(f.posts,[raw,raw]);assert.equal(f.data[key].attempt,2);assert.equal((await new ExtensionBroadcastJournal(f.storage).status(account)).blocksNewSend,true);
});
test("every readback field in each stored copy remains exact despite order normalization",async()=>{
 const corruptions=[r=>{r.rawTransaction=raw.toUpperCase()},r=>{r.transactionHash="0x"+"f".repeat(64)},r=>{r.account="0x"+"0".repeat(40)},r=>{r.origin="https://foreign.example"},r=>{r.attempt="1"},r=>{r.unknownHistory=0},r=>{delete r.createdAt},r=>{r.extra=null},r=>{r.extra=undefined},r=>{r.createdAt=NaN},r=>{r.createdAt=null}];
 for(const copy of[key,history])for(const corrupt of corruptions){const f=setup();f.hooks.read=values=>corrupt(values[copy]);await assert.rejects(f.journal.broadcast(f.options),{code:"BROADCAST_RECORD_UNAVAILABLE"});assert.equal(f.posts.length,0);assert.equal(f.data[key].rawTransaction,raw);assert.equal(f.data[history].rawTransaction,raw)}
});
test("nested resolution readback cannot drop, add, retype or alter proof fields",async()=>{
 const corruptions=[r=>{delete r.resolution.receipt.ynxDurability.snapshotIntegrity},r=>{r.resolution.receipt.ynxNativeTransaction.amountYNXT=2},r=>{r.resolution.receipt.ynxDurability.blockHash="0x"+"c".repeat(64)},r=>{r.resolution.model.extra=true},r=>{r.resolution.receipt.contractAddress={}}];
 for(const copy of[key,history])for(const corrupt of corruptions){const f=setup();await f.journal.broadcast(f.options);f.hooks.receipt=receipt();f.hooks.read=values=>{if(values[copy]?.status==="confirmed")corrupt(values[copy])};await assert.rejects(f.journal.status(account,{rpc:f.rpc,refresh:true}),{code:"BROADCAST_RECORD_UNAVAILABLE"});assert.equal(f.posts.length,1);assert.equal(f.data[key].rawTransaction,raw)}
});
