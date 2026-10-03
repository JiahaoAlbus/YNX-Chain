import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createSignedNativeTransfer,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {DesktopNativePayChain} from "../src/native-pay-chain.mjs";
import {validateNativeJSONReceipt} from "../src/transaction-durability.mjs";
import {CANONICAL_RPC_URL} from "../src/rpc.mjs";
import {payTestSecret,signedPayFixture} from "./fixture-signed-pay.mjs";
const literal=JSON.parse(await readFile(new URL("./fixtures/transaction-durability/native-json-contract-fixture.json",import.meta.url),"utf8"));
function fixture(){
  const f=signedPayFixture(),signed=createSignedNativeTransfer({accountSecret:payTestSecret,to:f.input.review.to,amount:25,nonce:2}),calls=[];
  const receipt={...literal.durableReceipt,transactionHash:signed.hash,from:signed.transaction.from,to:signed.transaction.to,ynxDurability:{...literal.durableReceipt.ynxDurability,transactionHash:signed.hash},ynxNativeTransaction:{type:"transfer",amountYNXT:"25",feeYNXT:"1",nonce:"0x2"}};
  const state={receipt,proof:receipt.ynxDurability,model:literal.capability,chainId:"0x1917",response:null,broadcast:null};
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});assert.ok(url.startsWith(CANONICAL_RPC_URL+"/"));assert.equal(init.redirect,"error");
    let value;if(url.endsWith("/transactions/broadcast")){
      assert.equal(init.body,signed.payload);if(state.broadcast) return state.broadcast();
      value={transaction:{hash:signed.hash,...signed.transaction},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"};
    }else if(url.includes("/accounts/"))value={account:{address:evmAddressFromYNX(f.identity.account),balance:26,nonce:1}};
    else{assert.equal(url,CANONICAL_RPC_URL+"/evm");const request=JSON.parse(init.body);value={jsonrpc:"2.0",id:request.id,result:{eth_chainId:state.chainId,ynx_getDurabilityModel:state.model,ynx_getTransactionDurability:state.proof,eth_getTransactionReceipt:state.receipt}[request.method]};
      if(state.response)value=state.response(value,request);
    }
    return new Response(JSON.stringify(value));
  };
  return {f,signed,receipt,state,calls,client:new DesktopNativePayChain({fetchImpl})};
}
test("Desktop literal Core native JSON proof validates without Ethereum gas projection or nonce offset",()=>{
  const r=literal.durableReceipt,n=r.ynxNativeTransaction,expected={type:"transfer",chainId:6423,from:r.from,to:r.to,amount:Number(n.amountYNXT),fee:1,nonce:Number(BigInt(n.nonce))};
  const evidence=validateNativeJSONReceipt(expected,literal.nativeJSONTransactionHash,r,literal.capability);assert.equal(evidence.ynxDurability.status,"durable");assert.equal("gasUsed" in evidence,false);
  assert.throws(()=>validateNativeJSONReceipt({...expected,nonce:expected.nonce-1},literal.nativeJSONTransactionHash,r,literal.capability));
});
test("Desktop native routes return whole units, exact admission ACK and separately verified checkpoint",async()=>{
  const f=fixture();assert.equal((await f.client.account(f.f.identity.account)).balance,26);
  const ack=await f.client.broadcast(f.signed.payload,f.signed.transaction,f.signed.hash);assert.equal(ack.durabilityConfirmed,false);assert.equal(ack.durabilityEvidence,null);
  const proof=await f.client.checkTransferDurability(f.signed.transaction,f.signed.hash);assert.equal(proof.status,"durable");assert.equal(proof.evidence.origin,CANONICAL_RPC_URL);assert.equal(proof.evidence.capability.consensusFinality,false);
  assert.equal(f.calls.filter(call=>call.url.endsWith("/transactions/broadcast")).length,1);
});
for(const mode of ["lost","http","redirect","hash","amount","malformed"])test(`Desktop ${mode} broadcast response stays unknown with one original POST`,async()=>{
  const f=fixture();f.state.broadcast=async()=>{
    if(mode==="lost")throw new TypeError("lost ACK");if(mode==="http")return new Response("{}",{status:400});if(mode==="redirect")return {redirected:true};
    if(mode==="malformed")return new Response("not JSON");
    return new Response(JSON.stringify({transaction:{hash:mode==="hash"?"0x"+"f".repeat(64):f.signed.hash,...f.signed.transaction,amount:mode==="amount"?24:25},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"}));
  };
  await assert.rejects(f.client.broadcast(f.signed.payload,f.signed.transaction,f.signed.hash),error=>error.code==="NATIVE_BROADCAST_UNKNOWN"&&error.hash===f.signed.hash);assert.equal(f.calls.length,1);
});
test("Desktop substituted payload/hash fails before native POST",async()=>{
  const f=fixture();await assert.rejects(f.client.broadcast(f.signed.payload,{...f.signed.transaction,amount:1},f.signed.hash));await assert.rejects(f.client.broadcast(f.signed.payload,f.signed.transaction,"0x"+"f".repeat(64)));assert.equal(f.calls.length,0);
});
test("Desktop wrong chain, missing exact capability, receipt mismatch and checkpoint substitution cannot verify",async()=>{
  for(const mode of ["chain","model","hash","amount","nonce","checkpoint","status"]){const f=fixture();
    if(mode==="chain")f.state.chainId="0x1";if(mode==="model")f.state.model={...literal.capability,consensusFinality:true};if(mode==="hash")f.state.receipt={...f.receipt,transactionHash:"0x"+"f".repeat(64)};
    if(mode==="amount")f.state.receipt={...f.receipt,ynxNativeTransaction:{...f.receipt.ynxNativeTransaction,amountYNXT:"24"}};if(mode==="nonce")f.state.receipt={...f.receipt,ynxNativeTransaction:{...f.receipt.ynxNativeTransaction,nonce:"0x1"}};
    if(mode==="checkpoint")f.state.proof={...f.state.proof,blockHash:"0x"+"f".repeat(64),checkpointBlockHash:"0x"+"f".repeat(64)};if(mode==="status")f.state.receipt={...f.receipt,status:"0x0"};
    await assert.rejects(f.client.checkTransferDurability(f.signed.transaction,f.signed.hash));assert.equal(f.calls.some(call=>call.url.endsWith("/transactions/broadcast")),false);
  }
});
test("Desktop non-durable statuses cannot become a mined proof",async()=>{
  for(const status of ["not_found","memory_only","uncertain"]){const f=fixture();f.state.proof={version:literal.capability.version,scope:"local-snapshot",status,transactionHash:f.signed.hash};
    const result=await f.client.checkTransferDurability(f.signed.transaction,f.signed.hash);assert.equal(result.status,status);assert.equal(result.evidence,null);assert.equal(f.calls.some(call=>call.init.body?.includes("eth_getTransactionReceipt")),false);
  }
});
test("Desktop malformed RPC envelopes and invalidated read guard cannot yield proof",async()=>{
  const f=fixture();f.state.response=value=>({...value,id:999});await assert.rejects(f.client.checkTransferDurability(f.signed.transaction,f.signed.hash));
  const next=fixture();let guards=0;await assert.rejects(next.client.checkTransferDurability(next.signed.transaction,next.signed.hash,()=>{if(++guards===2)throw Error("locked")}),/locked/);assert.equal(next.calls.length,1);
});
