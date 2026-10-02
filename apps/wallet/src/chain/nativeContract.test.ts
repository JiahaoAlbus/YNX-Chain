import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {NativeContractClient,parseBFTNativeContract,bftNativeReadMethods} from "./nativeContract";

const target="0x"+"1".repeat(40),origin="https://rpc-testnet.ynxweb4.com",guard=()=>{};
const artifact={address:target,name:"Original contract",sourceHash:"a".repeat(64),artifactHash:"b".repeat(64),bytecodeHash:"c".repeat(64),deployedBytecodeHash:"d".repeat(64),
  artifactKind:"source-analyzer-artifact",runtimeMode:"deterministic-devnet-pure-view-runtime",limitations:["Local analyzer literal returns only; no remote public proof"],
  functions:[{name:"readValue",signature:"readValue()",selector:"0x20965255",stateMutability:"view"}]};
const result={address:target,function:"readValue",signature:"readValue()",selector:"0x20965255",returnValue:"12",encodedResult:"0x"+"0".repeat(63)+"c",
  artifactKind:artifact.artifactKind,runtimeMode:artifact.runtimeMode,executionStatus:"source_analyzer_literal_return",bytecodeSelectorMatched:false,limitations:artifact.limitations};
// Standard Go encoding/json + SHA-256 generated this synthetic record using the
// original public pinned bytecode. This is not a remote node/state receipt.
const bft=JSON.parse(readFileSync(new URL("./testdata/bft-contract-go-audit-v1.json",import.meta.url),"utf8"));
function fixture(meta:unknown=artifact,read:unknown=result){
  const calls:{route:string;method:string;body:any}[]=[];
  const client=new NativeContractClient(origin,async(url,init)=>{
    const route=url.slice(origin.length),body=init.body===undefined?null:JSON.parse(String(init.body));calls.push({route,method:init.method!,body});
    assert.equal(init.redirect,"error");assert.equal(init.credentials,"omit");
    return new Response(JSON.stringify(route==="/evm"?{jsonrpc:"2.0",id:body.id,result:"0x1917"}:route==="/ide/call"?read:meta));
  });return {client,calls};
}
test("native pure/view reads use original contract lookup and IDE read-only route, not Ethereum simulation",async()=>{
  const f=fixture(),read=await f.client.read(target,"readValue()",guard);
  assert.equal(read.truthfulStatus,"native-local-pure-view-read-no-sign-no-broadcast");
  assert.equal(read.executionStatus,"source_analyzer_literal_return");assert.equal(read.opcodeStepCount,null);
  assert.deepEqual(f.calls.map(c=>c.route),["/evm","/contracts/"+target,"/ide/call","/contracts/"+target,"/evm"]);
  assert.deepEqual(f.calls[2]!.body,{address:target,function:"readValue()"});
  assert.equal(f.calls.some(c=>c.body?.method==="eth_getCode"||c.body?.method==="eth_estimateGas"||c.route==="/ide/execute"),false);
});
test("write functions, missing ABI arguments and ambiguous functions cannot reach the call route",async()=>{
  for(const functions of [[{...artifact.functions[0],stateMutability:"nonpayable"}],[{...artifact.functions[0],inputs:[{name:"owner",type:"address"}]}],[...artifact.functions,...artifact.functions]]){
    const f=fixture({...artifact,functions});await assert.rejects(()=>f.client.read(target,"readValue",guard));
    assert.equal(f.calls.some(c=>c.route==="/ide/call"),false);
  }
});
test("wrong origin response, chain, address and unsupported runtime fail closed",async()=>{
  for(const patch of [{address:"0x"+"2".repeat(40)},{runtimeMode:"full-evm"},{artifactKind:"future-runtime"},{artifactHash:"not-a-hash"}]){
    const f=fixture({...artifact,...patch});await assert.rejects(()=>f.client.read(target,"readValue",guard));
    assert.equal(f.calls.some(c=>c.route==="/ide/call"),false);
  }
  const other=new NativeContractClient(origin,async(_url,init)=>new Response(JSON.stringify({jsonrpc:"2.0",id:JSON.parse(String(init.body)).id,result:"0x1"})));
  await assert.rejects(()=>other.lookup(target,guard),/NATIVE_CONTRACT_CHAIN_MISMATCH/);
});
test("read response must bind ABI/runtime and cannot smuggle a write result or invented EVM claim",async()=>{
  for(const patch of [{address:"0x"+"2".repeat(40)},{signature:"other()"},{selector:"0x00000000"},{executionStatus:"full_evm_success"},
    {transactionHash:"0x"+"f".repeat(64)},{storageWrites:[]},{executionEngine:"arbitrary-engine"},{encodedResult:"0xABC"}]){
    const f=fixture(artifact,{...result,...patch});await assert.rejects(()=>f.client.read(target,"readValue",guard));
  }
});
test("pinned bytecode subset must retain selector match and bounded interpreter evidence",async()=>{
  const meta={...artifact,functions:artifact.functions.map(row=>({...row,bytecodeSelectorMatched:true})),artifactKind:"pinned-solc-bytecode-artifact",runtimeMode:"hardhat-artifact-local-evm-opcode-staticcall-subset"};
  const read={...result,artifactKind:meta.artifactKind,runtimeMode:meta.runtimeMode,executionStatus:"evm_opcode_interpreter_staticcall_subset",bytecodeSelectorMatched:true,executionEngine:"local-bounded-evm-opcode-interpreter",opcodeStepCount:24};
  assert.equal((await fixture(meta,read).client.read(target,"readValue",guard)).opcodeStepCount,24);
  for(const patch of [{bytecodeSelectorMatched:false},{opcodeStepCount:0},{executionEngine:"remote-evm"}])await assert.rejects(()=>fixture(meta,{...read,...patch}).client.read(target,"readValue",guard));
  const unmatched=fixture({...meta,functions:meta.functions.map(row=>({...row,bytecodeSelectorMatched:false}))},read);
  await assert.rejects(()=>unmatched.client.read(target,"readValue",guard),/NATIVE_CONTRACT_SELECTOR_NOT_MATCHED/);
  assert.equal(unmatched.calls.some(c=>c.route==="/ide/call"),false);
});
test("late cancelled reads and transports ignoring abort cannot publish or wait forever",async()=>{
  let active=true;
  const changed=new NativeContractClient(origin,async(_url,init)=>{active=false;return new Response(JSON.stringify({jsonrpc:"2.0",id:JSON.parse(String(init.body)).id,result:"0x1917"}))});
  await assert.rejects(()=>changed.lookup(target,()=>{if(!active)throw new Error("cancelled")}),/cancelled/);
  const hung=new NativeContractClient(origin,async()=>new Promise(()=>{}),5);
  await assert.rejects(()=>hung.lookup(target,guard),/NATIVE_CONTRACT_READ_TIMEOUT/);
});
test("BFT metadata revalidates original code identity, Go audit encoding and deterministic contract address",()=>{
  assert.equal(parseBFTNativeContract(bft,bft.address).auditHash,bft.auditHash);
  for(const change of [{name:"InventedRuntime"},{sourceHash:"a".repeat(64)},{deployedBytecode:"0x6000"},{deployer:"0x"+"2".repeat(40)},
    {runtimeMode:"full-evm"},{auditHash:"f".repeat(64)},{runtimeStorage:{...bft.runtimeStorage,count:"13"}},{blockHeight:Number.MAX_SAFE_INTEGER+1},{extra:"unsupported"}])
    assert.throws(()=>parseBFTNativeContract({...bft,...change},bft.address));
});
test("BFT uses address/calldata and /ide/contracts; no legacy fallback or state-changing route",async()=>{
  const calls:{route:string;body:any}[]=[];
  const client=new NativeContractClient(origin,async(url,init)=>{
    const route=url.slice(origin.length),body=init.body===undefined?null:JSON.parse(String(init.body));calls.push({route,body});
    const value=route==="/evm"?{jsonrpc:"2.0",id:body.id,result:"0x1917"}:route==="/ide/call"?{address:bft.address,encodedResult:result.encodedResult,opcodeStepCount:24,runtimeMode:bft.runtimeMode}:bft;
    return new Response(JSON.stringify(value));
  });
  const read=await client.readBFT(bft.address,"0x06661abd",guard);
  assert.equal(read.truthfulStatus,"bft-bounded-static-read-no-sign-no-broadcast");assert.equal(read.opcodeStepCount,24);
  assert.equal(read.returnValue,"12");
  assert.deepEqual(bftNativeReadMethods(parseBFTNativeContract(bft,bft.address)).map(method=>method.signature),["count()"]);
  assert.deepEqual(calls.map(c=>c.route),["/evm","/ide/contracts/"+bft.address,"/ide/call","/ide/contracts/"+bft.address,"/evm"]);
  assert.deepEqual(calls[2]!.body,{address:bft.address,calldata:"0x06661abd"});
  await assert.rejects(()=>client.readBFT(bft.address,"count()",guard),/NATIVE_CONTRACT_CALLDATA_REQUIRED/);
});

test("BFT read responses cannot smuggle writes, exceed the original interpreter bound or outlive their artifact",async()=>{
  const valid={address:bft.address,encodedResult:result.encodedResult,opcodeStepCount:24,runtimeMode:bft.runtimeMode};
  for(const patch of [{transactionHash:"0x"+"f".repeat(64)},{opcodeStepCount:2049},{opcodeStepCount:0},{runtimeMode:"full-evm"},{address:target},{encodedResult:"0xABC"}]){
    const f=fixture(bft,{...valid,...patch});
    await assert.rejects(()=>f.client.readBFT(bft.address,"0x06661abd",guard));
    assert.equal(f.calls.some(call=>call.route==="/ide/execute"||call.route.startsWith("/contracts/")),false);
  }
  let lookups=0;
  const client=new NativeContractClient(origin,async(url,init)=>{
    const route=url.slice(origin.length),body=init.body===undefined?null:JSON.parse(String(init.body));
    const value=route==="/evm"?{jsonrpc:"2.0",id:body.id,result:"0x1917"}:route==="/ide/call"?valid:++lookups===1?bft:{...bft,auditHash:"f".repeat(64)};
    return new Response(JSON.stringify(value));
  });
  await assert.rejects(()=>client.readBFT(bft.address,"0x06661abd",guard));assert.equal(lookups,2);
});
