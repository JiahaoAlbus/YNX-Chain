import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {Wallet,Transaction} from "ethers";
import {DURABILITY_MODEL,parseDurabilityModel,parseTransactionDurability,verifyDurableNativeReceipt,durabilityQuantity,durabilityInt64} from "../src/extension-durability.js";
import {forwardExtensionRpc} from "../src/extension-rpc.js";
import {publicBridgeError} from "../src/extension-bridge.js";
const fixture=JSON.parse(await readFile(new URL("./fixtures/core-0468-ethereum-block-marker.json",import.meta.url))),receipt=fixture.recoveredReceipt,hash=receipt.transactionHash;
// Public Ethereum test key from the frozen Core fixture; no production custody.
const signed=Transaction.from(await new Wallet("0x"+"46".repeat(32)).signTransaction({chainId:6423,nonce:0,to:receipt.to,value:2n*10n**18n,gasLimit:25000n,gasPrice:40000000000000n,type:0,data:"0x"}));
const reject=fn=>assert.throws(fn,{code:"DURABILITY_UNCONFIRMED"});
test("literal Core 0468 receipt binds an independently signed exact Ethereum intent",()=>{
  assert.equal(signed.hash,hash);const verified=verifyDurableNativeReceipt(receipt,signed,hash,DURABILITY_MODEL);
  assert.equal(verified.ynxDurability.status,"durable");assert.equal(verified.ynxNativeTransaction.nonce,"0x1");assert.equal(Object.hasOwn(verified,"logs"),false);
  assert.deepEqual(verifyDurableNativeReceipt({...receipt,unrelatedOuterMetadata:true},signed,hash,DURABILITY_MODEL),verified);
});
test("capability is exact eight fields and every proof/native field is mandatory",()=>{
  assert.equal(Object.keys(DURABILITY_MODEL).length,8);assert.equal(Object.keys(receipt.ynxDurability).length,9);assert.equal(Object.keys(receipt.ynxNativeTransaction).length,4);
  for(const key of Object.keys(DURABILITY_MODEL)){const model={...DURABILITY_MODEL};delete model[key];reject(()=>parseDurabilityModel(model))}
  reject(()=>parseDurabilityModel({...DURABILITY_MODEL,enabled:true}));reject(()=>parseDurabilityModel({...DURABILITY_MODEL,consensusFinality:true}));
  for(const field of["ynxDurability","ynxNativeTransaction"]){for(const key of Object.keys(receipt[field])){const bad=structuredClone(receipt);delete bad[field][key];reject(()=>verifyDurableNativeReceipt(bad,signed,hash,DURABILITY_MODEL))}reject(()=>verifyDurableNativeReceipt({...receipt,[field]:{...receipt[field],extra:true}},signed,hash,DURABILITY_MODEL))}
});
test("canonical uint64 and int64 parse with BigInt, never rounded Number values",()=>{
  assert.equal(durabilityQuantity("0xffffffffffffffff"),18446744073709551615n);assert.equal(durabilityInt64("9223372036854775807"),9223372036854775807n);assert.equal(durabilityInt64("-9223372036854775808"),-9223372036854775808n);
  for(const value of["0x00","0x01","0X1","0xA","0x10000000000000000","1",1,1n,null])reject(()=>durabilityQuantity(value));
  for(const value of["01","+1","-0","1.0","9223372036854775808","-9223372036854775809",1,1n,null])reject(()=>durabilityInt64(value));
});
test("checkpoint covers mined block and exactly binds all native transfer fields",()=>{
  for(const patch of[{checkpointBlockNumber:"0x1"},{checkpointBlockHash:"0x"+"f".repeat(64)},{blockNumber:"0x0"},{snapshotIntegrity:"0x"+"A".repeat(64)},{transactionHash:"0x"+"f".repeat(64)},{blockHash:"0x"+"f".repeat(64)}])reject(()=>verifyDurableNativeReceipt({...receipt,ynxDurability:{...receipt.ynxDurability,...patch}},signed,hash,DURABILITY_MODEL));
  assert.equal(verifyDurableNativeReceipt({...receipt,ynxDurability:{...receipt.ynxDurability,checkpointBlockNumber:"0xffffffffffffffff",checkpointBlockHash:"0x"+"f".repeat(64)}},signed,hash,DURABILITY_MODEL).ynxDurability.checkpointBlockNumber,"0xffffffffffffffff");
  for(const patch of[{amountYNXT:"0"},{amountYNXT:"2000000000000000000"},{amountYNXT:"1"},{feeYNXT:"0"},{feeYNXT:"1000000000000000000"},{nonce:"0x0"},{nonce:"0x2"},{type:"call"}])reject(()=>verifyDurableNativeReceipt({...receipt,ynxNativeTransaction:{...receipt.ynxNativeTransaction,...patch}},signed,hash,DURABILITY_MODEL));
  for(const patch of[{from:receipt.to},{to:receipt.from},{contractAddress:undefined},{type:"0x2"},{blockNumber:"0x3"},{gasUsed:"0x0"},{ynxFeeWei:"0x0"}])reject(()=>verifyDurableNativeReceipt({...receipt,...patch},signed,hash,DURABILITY_MODEL));
});
test("pending, missing and memory-only proofs never mean mined durable",()=>{
  const base={version:DURABILITY_MODEL.version,scope:"local-snapshot",transactionHash:hash};
  for(const status of["not_found","uncertain","memory_only","pending_durable"]){const proof={...base,status,...(status==="pending_durable"?{checkpointBlockNumber:"0x0",checkpointBlockHash:"0x"+"a".repeat(64),snapshotIntegrity:"0x"+"b".repeat(64)}:{})};assert.equal(parseTransactionDurability(proof,hash).status,status);reject(()=>verifyDurableNativeReceipt({...receipt,ynxDurability:proof},signed,hash,DURABILITY_MODEL))}
  for(const patch of[{status:"future"},{status:"not_found",blockNumber:"0x2"},{status:"uncertain",blockHash:receipt.blockHash}])reject(()=>parseTransactionDurability({...base,...patch},hash));
});
test("RPC exact discovery and status methods preserve bounded Core errors",async()=>{
  const rpc=result=>async()=>({ok:true,redirected:false,url:"https://evm.ynxweb4.com/",json:async()=>({jsonrpc:"2.0",id:6423,result})});
  assert.deepEqual(await forwardExtensionRpc("ynx_getDurabilityModel",[],rpc(DURABILITY_MODEL)),DURABILITY_MODEL);
  assert.equal((await forwardExtensionRpc("ynx_getTransactionDurability",[hash],rpc(receipt.ynxDurability))).transactionHash,hash);
  await assert.rejects(forwardExtensionRpc("ynx_getDurabilityModel",[hash],rpc(DURABILITY_MODEL)),{code:-32602});
  await assert.rejects(forwardExtensionRpc("ynx_getTransactionDurability",[hash],rpc({...receipt.ynxDurability,extra:true})),{code:"DURABILITY_UNCONFIRMED"});
  const error=fixture.uncertainReceipt.error;assert.deepEqual(publicBridgeError({...error,data:{...error.data,rawTransaction:"private"}}).data,error.data);
  const invalid=publicBridgeError({...error,data:{...error.data,ynxDurability:{...error.data.ynxDurability,extra:true}}});assert.equal(Object.hasOwn(invalid.data,"ynxDurability"),false);
});

test("different heights cannot reuse the mined hash and status zero cannot confirm a native transfer",()=>{
  reject(()=>verifyDurableNativeReceipt({...receipt,status:"0x0"},signed,hash,DURABILITY_MODEL));
  reject(()=>verifyDurableNativeReceipt({...receipt,ynxDurability:{...receipt.ynxDurability,checkpointBlockNumber:"0x3"}},signed,hash,DURABILITY_MODEL));
});

test("hash-shaped arrays and non-string checkpoint identities are not canonical hashes",()=>{
  for(const field of["blockHash","checkpointBlockHash","snapshotIntegrity"]){const bad={...receipt.ynxDurability,[field]:[receipt.ynxDurability[field]]};reject(()=>parseTransactionDurability(bad,hash))}
});
