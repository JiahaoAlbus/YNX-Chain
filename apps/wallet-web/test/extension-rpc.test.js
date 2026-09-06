import assert from "node:assert/strict";
import test from "node:test";
import {NATIVE_FEE_MODEL} from "../src/extension-fee-model.js";
import {READ_ONLY_RPC_METHODS,RPC_REQUEST_ID,RPC_TIMEOUT_MS,YNX_CHAIN_ID,YNX_RPC_URL,broadcastExtensionTransaction,forwardExtensionRpc,verifyExtensionRpc} from "../src/extension-rpc.js";

const response = (body, options={}) => ({ok:options.ok??true,status:options.status??200,json:async()=>body});

test("extension RPC sends the exact bounded eth_chainId request and validates 0x1917",async()=>{
  let observed;
  const result=await verifyExtensionRpc(async(url,options)=>{observed={url,options};return response({jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x1917"})});
  assert.equal(observed.url,YNX_RPC_URL);assert.equal(observed.options.method,"POST");assert.deepEqual(JSON.parse(observed.options.body),{jsonrpc:"2.0",id:6423,method:"eth_chainId",params:[]});
  assert.equal(observed.options.signal instanceof AbortSignal,true);assert.equal(RPC_TIMEOUT_MS,12000);assert.equal(result.chainId,YNX_CHAIN_ID);assert.equal(result.responseValidated,true);
});

test("signed transaction broadcast is a separate exact internal RPC gate",async()=>{
  let observed;const raw="0x01",hash=`0x${"a".repeat(64)}`,result=await broadcastExtensionTransaction(raw,async(url,options)=>{observed={url,body:JSON.parse(options.body)};return response({jsonrpc:"2.0",id:RPC_REQUEST_ID,result:hash})});
  assert.equal(result,hash);assert.deepEqual(observed.body,{jsonrpc:"2.0",id:RPC_REQUEST_ID,method:"eth_sendRawTransaction",params:[raw]});
  await assert.rejects(()=>broadcastExtensionTransaction("not-raw",async()=>response({})),error=>error.code==="INVALID_SIGNED_TRANSACTION");
  await assert.rejects(()=>broadcastExtensionTransaction(raw,async()=>response({jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x1"})),error=>error.code==="INVALID_TRANSACTION_HASH");
});

test("extension RPC rejects wrong chain, malformed envelope, errors and unavailable transport",async()=>{
  for(const [body,code] of [[{jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x1"},"WRONG_NETWORK"],[{jsonrpc:"2.0",id:1,result:"0x1917"},"INVALID_RPC_RESPONSE"],[{jsonrpc:"2.0",id:RPC_REQUEST_ID,error:{code:-1}},"INVALID_RPC_RESPONSE"]])await assert.rejects(()=>verifyExtensionRpc(async()=>response(body)),error=>error.code===code);
  await assert.rejects(()=>verifyExtensionRpc(async()=>{throw new TypeError("offline")}),error=>error.code==="RPC_UNAVAILABLE");
  await assert.rejects(()=>verifyExtensionRpc(async()=>response({jsonrpc:"2.0",id:6423,result:null}, {ok:false,status:503})),error=>error.code==="RPC_UNAVAILABLE");
});

test("read-only RPC forwards only the frozen allowlist and exact JSON-RPC envelope",async()=>{
  let observed;const result=await forwardExtensionRpc("eth_getTransactionCount",["0x1111111111111111111111111111111111111111","latest"],async(url,options)=>{observed={url,body:JSON.parse(options.body)};return response({jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x0"})});
  assert.equal(result,"0x0");assert.equal(observed.url,YNX_RPC_URL);assert.deepEqual(observed.body,{jsonrpc:"2.0",id:RPC_REQUEST_ID,method:"eth_getTransactionCount",params:["0x1111111111111111111111111111111111111111","latest"]});assert.equal(READ_ONLY_RPC_METHODS.includes("eth_getBalance"),true);
  await assert.rejects(()=>forwardExtensionRpc("eth_sendRawTransaction",["0x00"],async()=>response({})),error=>error.code===4200);
});


test("RPC error envelopes preserve Core uncertainty code and data, including HTTP failures",async()=>{
  const data={status:"transaction_durability_uncertain",transactionHash:`0x${"a".repeat(64)}`};
  for(const status of[200,503])await assert.rejects(broadcastExtensionTransaction("0x01",async()=>response({jsonrpc:"2.0",id:6423,error:{code:-32002,message:"transaction durability needs confirmation",data}},{ok:status===200,status})),error=>error.code===-32002&&error.data.transactionHash===data.transactionHash&&error.data.status===data.status);
});

test("legacy balance exposes whole-YNXT explicitly and cannot masquerade as standard wei",async()=>{
  for(const enabled of[false,true]){
    const calls=[],fetcher=async(_url,options)=>{const{method}=JSON.parse(options.body);calls.push(method);return response({jsonrpc:"2.0",id:6423,result:{eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled},eth_getBalance:enabled?`0x${(100n*10n**18n).toString(16)}`:"0x64"}[method]})};
    const details=await forwardExtensionRpc("ynx_getBalanceDetails",["0x1111111111111111111111111111111111111111","latest"],fetcher);
    assert.equal(details.amountYNXT,"100");assert.equal(details.rawUnit,enabled?"wei":"whole-YNXT");assert.equal(details.fullEVM,false);assert.deepEqual(calls,["eth_chainId","ynx_getFeeModel","eth_getBalance","eth_chainId","ynx_getFeeModel"]);
    if(enabled)assert.equal(await forwardExtensionRpc("eth_getBalance",[],fetcher),details.rawBalance);else await assert.rejects(forwardExtensionRpc("eth_getBalance",[],fetcher),{code:"LEGACY_BALANCE_UNITS"});
  }
  let balances=0;await assert.rejects(forwardExtensionRpc("eth_getBalance",[],async(_url,options)=>{const{method}=JSON.parse(options.body);if(method==="eth_getBalance")balances++;return response({jsonrpc:"2.0",id:6423,result:method==="eth_chainId"?"0x1917":null})}),{code:"RPC_CAPABILITY_UNAVAILABLE"});assert.equal(balances,0);
});


test("RPC deadline includes a response body that never completes",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const pending=broadcastExtensionTransaction("0x01",async()=>({ok:true,text:async()=>new Promise(()=>{})}));
  const rejected=assert.rejects(pending,{code:"RPC_TIMEOUT"});
  await Promise.resolve();t.mock.timers.tick(RPC_TIMEOUT_MS);await rejected;
});
