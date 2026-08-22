import assert from "node:assert/strict";
import test from "node:test";
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
  await assert.rejects(()=>verifyExtensionRpc(async()=>response({}, {ok:false,status:503})),error=>error.code==="RPC_UNAVAILABLE");
});

test("read-only RPC forwards only the frozen allowlist and exact JSON-RPC envelope",async()=>{
  let observed;const result=await forwardExtensionRpc("eth_getBalance",["0x1111111111111111111111111111111111111111","latest"],async(url,options)=>{observed={url,body:JSON.parse(options.body)};return response({jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x0"})});
  assert.equal(result,"0x0");assert.equal(observed.url,YNX_RPC_URL);assert.deepEqual(observed.body,{jsonrpc:"2.0",id:RPC_REQUEST_ID,method:"eth_getBalance",params:["0x1111111111111111111111111111111111111111","latest"]});assert.equal(READ_ONLY_RPC_METHODS.includes("eth_getBalance"),true);
  await assert.rejects(()=>forwardExtensionRpc("eth_sendRawTransaction",["0x00"],async()=>response({})),error=>error.code===4200);
});
