import assert from "node:assert/strict";
import test from "node:test";
import {RPC_REQUEST_ID,RPC_TIMEOUT_MS,YNX_CHAIN_ID,YNX_RPC_URL,verifyExtensionRpc} from "../src/extension-rpc.js";

const response = (body, options={}) => ({ok:options.ok??true,status:options.status??200,json:async()=>body});

test("extension RPC sends the exact bounded eth_chainId request and validates 0x1917",async()=>{
  let observed;
  const result=await verifyExtensionRpc(async(url,options)=>{observed={url,options};return response({jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x1917"})});
  assert.equal(observed.url,YNX_RPC_URL);assert.equal(observed.options.method,"POST");assert.deepEqual(JSON.parse(observed.options.body),{jsonrpc:"2.0",id:6423,method:"eth_chainId",params:[]});
  assert.equal(observed.options.signal instanceof AbortSignal,true);assert.equal(RPC_TIMEOUT_MS,12000);assert.equal(result.chainId,YNX_CHAIN_ID);assert.equal(result.responseValidated,true);
});

test("extension RPC rejects wrong chain, malformed envelope, errors and unavailable transport",async()=>{
  for(const [body,code] of [[{jsonrpc:"2.0",id:RPC_REQUEST_ID,result:"0x1"},"WRONG_NETWORK"],[{jsonrpc:"2.0",id:1,result:"0x1917"},"INVALID_RPC_RESPONSE"],[{jsonrpc:"2.0",id:RPC_REQUEST_ID,error:{code:-1}},"INVALID_RPC_RESPONSE"]])await assert.rejects(()=>verifyExtensionRpc(async()=>response(body)),error=>error.code===code);
  await assert.rejects(()=>verifyExtensionRpc(async()=>{throw new TypeError("offline")}),error=>error.code==="RPC_UNAVAILABLE");
  await assert.rejects(()=>verifyExtensionRpc(async()=>response({}, {ok:false,status:503})),error=>error.code==="RPC_UNAVAILABLE");
});
