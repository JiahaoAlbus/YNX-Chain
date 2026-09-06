import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import type {SignedNativeTransfer} from "@ynx-chain/wallet-auth";
import {createNativeDurabilityEvidence,NATIVE_DURABILITY_MODEL,NativeDurabilityInvalid,nativeQuantity,parseNativeDurabilityModel,parseNativeDurabilityState,parseNativeDurableReceipt,verifyNativeDurability} from "./nativeDurability";

// Exact public Core 0468d65 contract fixture; no key material or live RPC.
const fixture=JSON.parse(readFileSync(new URL("./testdata/native-durability-v1.json",import.meta.url),"utf8"));
const txHash=fixture.nativeJSONTransactionHash;
const intent={from:fixture.durableReceipt.from,to:fixture.durableReceipt.to,amount:2,fee:1,nonce:1,type:"transfer",chainId:6423} as SignedNativeTransfer;
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const origin="https://rpc.ynxweb4.com";
const hash="0x"+"f".repeat(64);
const state=(status:string)=>({version:NATIVE_DURABILITY_MODEL.version,scope:"local-snapshot",status,transactionHash:txHash});

test("Core native JSON receipt works with adapter-disabled legacy gas, including a cold snapshot integrity change",()=>{
  assert.deepEqual(parseNativeDurabilityModel(fixture.capability),NATIVE_DURABILITY_MODEL);
  for(const proof of [fixture.durableReceipt.ynxDurability,fixture.coldProof]){
    const receipt={...fixture.durableReceipt,ynxDurability:proof};
    const evidence=createNativeDurabilityEvidence(origin,fixture.capability,receipt,intent,txHash);
    assert.equal(verifyNativeDurability(evidence,intent,txHash,origin),true);
    assert.equal((evidence.receipt as any).ynxNativeTransaction.amountYNXT,"2");
    assert.equal("gasUsed" in (evidence.receipt as object),false,"legacy gas must not be interpreted as the native fee");
  }
});

test("capability is exact, versioned and explicitly not a finality claim",()=>{
  for(const key of Object.keys(fixture.capability)){
    const missing=clone(fixture.capability);delete missing[key];assert.throws(()=>parseNativeDurabilityModel(missing),NativeDurabilityInvalid);
    assert.throws(()=>parseNativeDurabilityModel({...fixture.capability,[key]:"future"}),NativeDurabilityInvalid);
  }
  for(const value of [null,[],{...fixture.capability,consensusFinality:true},{...fixture.capability,enabled:false}])assert.throws(()=>parseNativeDurabilityModel(value),NativeDurabilityInvalid);
});

test("all nonterminal states validate exact fields without becoming mined proofs",()=>{
  const checkpoint={checkpointBlockNumber:"0x0",checkpointBlockHash:hash,snapshotIntegrity:hash};
  for(const status of ["not_found","uncertain","memory_only","pending_durable"]){
    const proof={...state(status),...(status==="pending_durable"?checkpoint:{})};
    assert.equal(parseNativeDurabilityState(proof,txHash).status,status);
    assert.throws(()=>parseNativeDurableReceipt({...fixture.durableReceipt,ynxDurability:proof},intent,txHash),NativeDurabilityInvalid);
    assert.throws(()=>parseNativeDurabilityState({...proof,unknown:true},txHash),NativeDurabilityInvalid);
  }
  for(const status of ["uncertain","memory_only"]){
    assert.equal(parseNativeDurabilityState({...state(status),blockNumber:"0x2",blockHash:hash},txHash).status,status);
    for(const extra of [{blockNumber:"0x2"},{blockHash:hash},checkpoint])assert.throws(()=>parseNativeDurabilityState({...state(status),...extra},txHash),NativeDurabilityInvalid);
  }
  assert.throws(()=>parseNativeDurabilityState({...state("not_found"),blockNumber:"0x2",blockHash:hash},txHash),NativeDurabilityInvalid);
});

test("canonical uint64 heights preserve precision above JavaScript safe integers",()=>{
  assert.equal(nativeQuantity("0xffffffffffffffff"),0xffffffffffffffffn);
  for(const value of ["0x00","0x01","0X1","0xA","0x10000000000000000","1",1,null])assert.throws(()=>nativeQuantity(value),NativeDurabilityInvalid);
  const proof={...fixture.coldProof,blockNumber:"0x20000000000001",checkpointBlockNumber:"0x20000000000002",checkpointBlockHash:hash};
  assert.equal(parseNativeDurabilityState(proof,txHash).blockNumber,"0x20000000000001");
  assert.throws(()=>parseNativeDurabilityState({...proof,checkpointBlockNumber:"0x20000000000000"},txHash),NativeDurabilityInvalid);
  assert.throws(()=>parseNativeDurabilityState({...fixture.coldProof,checkpointBlockHash:hash},txHash),NativeDurabilityInvalid);
  assert.throws(()=>parseNativeDurabilityState({...fixture.coldProof,checkpointBlockNumber:"0x3"},txHash),NativeDurabilityInvalid);
  assert.throws(()=>parseNativeDurabilityState({...fixture.coldProof,blockNumber:"0x0"},txHash),NativeDurabilityInvalid);
});

const receiptMutations:Record<string,(value:any)=>void>={
  "wrong hash":r=>{r.transactionHash=hash},"wrong sender":r=>{r.from=r.to},"wrong recipient":r=>{r.to=r.from},
  "non-success":r=>{r.status="0x0"},"contract creation":r=>{r.contractAddress=r.to},"missing null contract":r=>{delete r.contractAddress},
  "different inclusion":r=>{r.blockHash=hash},"different height":r=>{r.blockNumber="0x3"},"noncanonical index":r=>{r.transactionIndex="0x00"},
  "wrong amount":r=>{r.ynxNativeTransaction.amountYNXT="3"},"zero fee":r=>{r.ynxNativeTransaction.feeYNXT="0"},
  "Ethereum rather than native nonce":r=>{r.ynxNativeTransaction.nonce="0x0"},"wrong nonce":r=>{r.ynxNativeTransaction.nonce="0x2"},
  "wrong type":r=>{r.ynxNativeTransaction.type="evm"},"extra native field":r=>{r.ynxNativeTransaction.wei="2"},
  "missing native field":r=>{delete r.ynxNativeTransaction.feeYNXT},"uppercase hash":r=>{r.ynxDurability.snapshotIntegrity=hash.toUpperCase()},
  "wrong proof hash":r=>{r.ynxDurability.transactionHash=hash},"checkpoint before inclusion":r=>{r.ynxDurability.checkpointBlockNumber="0x1"},
  "unknown proof field":r=>{r.ynxDurability.confirmed=true},"wrong scope":r=>{r.ynxDurability.scope="consensus"},
  "missing proof":r=>{delete r.ynxDurability},"missing native identity":r=>{delete r.ynxNativeTransaction},
};
for(const [name,mutate] of Object.entries(receiptMutations))test(`${name} cannot validate a durable native receipt`,()=>{
  const receipt=clone(fixture.durableReceipt);mutate(receipt);
  assert.throws(()=>parseNativeDurableReceipt(receipt,intent,txHash),NativeDurabilityInvalid);
});

test("decimal ledger amounts are bounded canonical int64 strings and match the exact safe whole-YNXT intent",()=>{
  for(const amount of ["02","+2","2.0","2e0",2,"-0","9223372036854775808","-9223372036854775809"]){
    const receipt=clone(fixture.durableReceipt);receipt.ynxNativeTransaction.amountYNXT=amount;
    assert.throws(()=>parseNativeDurableReceipt(receipt,intent,txHash),NativeDurabilityInvalid);
  }
  for(const patch of [{chainId:1},{amount:Number.MAX_SAFE_INTEGER+1},{nonce:0},{fee:2},{type:"other"}])assert.throws(()=>parseNativeDurableReceipt(fixture.durableReceipt,{...intent,...patch} as SignedNativeTransfer,txHash),NativeDurabilityInvalid);
});

test("saved evidence binds source origin, chain, capability and original identity again on reload",()=>{
  const evidence=createNativeDurabilityEvidence(origin,fixture.capability,fixture.durableReceipt,intent,txHash);
  assert.equal(verifyNativeDurability(evidence,intent,txHash,origin),true);
  for(const patch of [{origin:"https://other.example"},{chainId:"0x1"},{version:2},{extra:true},{capability:{...fixture.capability,consensusFinality:true}}])assert.equal(verifyNativeDurability({...evidence,...patch},intent,txHash,origin),false);
  assert.equal(verifyNativeDurability(evidence,{...intent,amount:3},txHash,origin),false);
  assert.equal(verifyNativeDurability(evidence,intent,hash,origin),false);
});
