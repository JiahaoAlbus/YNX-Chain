import assert from "node:assert/strict";
import test from "node:test";
import {createSignedNativeTransfer,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {NativeChainClient,NativeReadError,NativeBroadcastUnknown} from "./nativeTransfer";
import {NATIVE_DURABILITY_MODEL} from "./nativeDurability";

function reply(url:string,status:number,text:string,redirected=false):Response{
  const response=new Response(text,{status});Object.defineProperties(response,{url:{value:url},redirected:{value:redirected}});return response;
}

test("published read-only RPC recovery uses three bounded same-origin reservations and never retries a transfer",async()=>{
  const calls:Array<{url:string;method:string}> = [];
  const client=new NativeChainClient("https://rpc-testnet.ynxweb4.com",async(url,init)=>{
    const body=JSON.parse(init!.body as string);calls.push({url,method:body.method??"transfer"});
    if(calls.length<=2)return reply(url,503,"temporarily unavailable");
    return reply(url,200,JSON.stringify({jsonrpc:"2.0",id:body.id,result:body.method==="eth_chainId"?"0x1917":NATIVE_DURABILITY_MODEL}));
  });
  await client.requireDurabilityCapability();assert.equal(calls.filter(value=>value.method==="eth_chainId").length,4);
  assert.ok(calls.every(value=>value.url==="https://rpc-testnet.ynxweb4.com/evm"));
  let posts=0;
  const signed=createSignedNativeTransfer({accountSecret:"01".repeat(32),to:ynxAddressFromEVM("0x"+"22".repeat(20)),amount:1,nonce:1});
  const failing=new NativeChainClient(undefined,async()=>{posts++;throw new TypeError("synthetic connection loss")});
  await assert.rejects(failing.broadcast(signed.payload,signed.transaction,signed.hash),NativeBroadcastUnknown);assert.equal(posts,1);
});

test("a hanging published RPC read has a bounded final error, not an unbounded refresh spinner",async()=>{
  let calls=0;
  const client=new NativeChainClient(undefined,async()=>{calls++;return new Promise(()=>{})},1);
  await assert.rejects(client.requireDurabilityCapability(),(error:unknown)=>error instanceof NativeReadError&&error.code==="NATIVE_READ_UNAVAILABLE"&&error.retryable);
  assert.equal(calls,3);
});

test("an expired RPC reservation cannot read a late response body after the current refresh succeeded",async()=>{
  const late=Promise.withResolvers<Response>();let calls=0,lateBodyReads=0;
  const client=new NativeChainClient(undefined,async(url,init)=>{
    calls++;if(calls===1)return late.promise;
    const request=JSON.parse(init!.body as string);
    return reply(url,200,JSON.stringify({jsonrpc:"2.0",id:request.id,result:request.method==="eth_chainId"?"0x1917":NATIVE_DURABILITY_MODEL}));
  },10);
  await client.requireDurabilityCapability();
  const response=reply("https://rpc-testnet.ynxweb4.com/evm",200,"{}");
  response.text=async()=>{lateBodyReads++;return"{}"};late.resolve(response);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(lateBodyReads,0);assert.equal(calls,4);
});

test("wrong RPC ID, chain, redirect or malformed evidence does not use transport retries",async()=>{
  for(const mode of ["id","chain","redirect","json"]){let calls=0;const client=new NativeChainClient(undefined,async(url,init)=>{
    calls++;const request=JSON.parse(init!.body as string);
    return reply(url,200,mode==="json"?"{":JSON.stringify({jsonrpc:"2.0",id:mode==="id"?request.id+1:request.id,result:mode==="chain"?"0x1":"0x1917"}),mode==="redirect");
  });await assert.rejects(client.requireDurabilityCapability());assert.equal(calls,1)}
});
