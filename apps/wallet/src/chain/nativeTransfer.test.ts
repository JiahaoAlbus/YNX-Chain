import assert from "node:assert/strict";
import test from "node:test";
import {createSignedNativeTransfer,evmAddressFromYNX,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {ChainNetworkError,DEFAULT_CHAIN_API,DEFAULT_CHAIN_RPC,NativeChainClient,YNX_EVM_CHAIN_ID} from "./nativeTransfer";

const account=ynxAddressFromEVM("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
const address=evmAddressFromYNX(account);
const recipient=ynxAddressFromEVM("0xffffffffffffffffffffffffffffffffffffffff");
const signed=createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to:recipient,amount:25,nonce:7});

test("native client loads exact REST account/activity and broadcasts only matching signed result",async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const client=new NativeChainClient(undefined,undefined,async(url,init)=>{calls.push({url,init});if(url.includes("/accounts/"))return response({account:{address:signed.transaction.from,balance:100,nonce:6}});if(url.includes("/txs?"))return response({transactions:[{hash:signed.hash,type:"transfer",from:signed.transaction.from,to:signed.transaction.to,amount:25,fee:1,nonce:7}]});return response({transaction:{hash:signed.hash,from:signed.transaction.from,to:signed.transaction.to,amount:25,fee:1,nonce:7},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"},201)});
  assert.deepEqual(await client.account(account),{address:signed.transaction.from,balance:100,nonce:6,source:"native-rest",materialized:true});
  assert.equal((await client.activity(account)).length,1);
  assert.equal((await client.broadcast(signed.payload,signed.transaction,signed.hash)).hash,signed.hash);
  assert.equal(calls[2]?.init?.method,"POST");assert.equal(calls[2]?.init?.body,signed.payload);
  assert.equal(DEFAULT_CHAIN_API,"https://rest.ynxweb4.com");
  assert.equal(DEFAULT_CHAIN_RPC,"https://rpc.ynxweb4.com/evm");
  assert.ok(calls.every(({url})=>url.startsWith(`${DEFAULT_CHAIN_API}/`)),"materialized native REST calls must never be sent to the JSON-RPC host");
});

test("REST account-not-found uses exact RPC zero balance and nonce without inventing state",async()=>{
  const requests:Record<string,unknown>[]=[];
  const client=new NativeChainClient(undefined,undefined,async(url,init)=>{
    if(url.startsWith(DEFAULT_CHAIN_API))return response({error:"account not found"},404);
    assert.equal(url,DEFAULT_CHAIN_RPC);
    const request=JSON.parse(String(init?.body)) as Record<string,unknown>;requests.push(request);
    if(request.method==="eth_chainId")return rpc(request,YNX_EVM_CHAIN_ID);
    if(request.method==="eth_getBalance")return rpc(request,"0x0");
    return rpc(request,"0x0");
  });
  assert.deepEqual(await client.account(account),{address,balance:0,nonce:0,source:"evm-json-rpc",materialized:false});
  assert.deepEqual(requests.map(({method})=>method),["eth_chainId","eth_getBalance","eth_getTransactionCount"]);
  for(const request of requests.slice(1))assert.deepEqual(request.params,[address,"latest"],"RPC lookup must bind the selected account's exact 0x identity");
});

test("REST account-not-found preserves the exact nonzero RPC balance and nonce",async()=>{
  const client=new NativeChainClient(undefined,undefined,rpcFallback({balance:"0x2a",nonce:"0x7"}));
  assert.deepEqual(await client.account(account),{address,balance:42,nonce:7,source:"evm-json-rpc",materialized:false});
});

test("account fallback fails closed on wrong chain, malformed response, unsafe quantity, and RPC error",async()=>{
  await assert.rejects(()=>new NativeChainClient(undefined,undefined,rpcFallback({chainId:"0x1"})).account(account),/chain identity/);
  await assert.rejects(()=>new NativeChainClient(undefined,undefined,async(url,init)=>url.startsWith(DEFAULT_CHAIN_API)?response({error:"ACCOUNT_NOT_FOUND"},404):response({jsonrpc:"2.0",id:999,result:YNX_EVM_CHAIN_ID})).account(account),/response is invalid/);
  await assert.rejects(()=>new NativeChainClient(undefined,undefined,rpcFallback({balance:"0x00"})).account(account),/canonical quantity/);
  await assert.rejects(()=>new NativeChainClient(undefined,undefined,async(url,init)=>{if(url.startsWith(DEFAULT_CHAIN_API))return response({error:"account not found"},404);const request=JSON.parse(String(init?.body));return response({jsonrpc:"2.0",id:request.id,error:{code:-32000,message:"unavailable"}})}).account(account),/response is invalid/);
});

test("only exact REST account absence may fall back; other failures remain closed",async()=>{
  let rpcCalls=0;
  const serverFailure=new NativeChainClient(undefined,undefined,async(url)=>{if(url===DEFAULT_CHAIN_RPC)rpcCalls+=1;return response({error:"account not found"},500)});
  await assert.rejects(()=>serverFailure.account(account),/\(500\)/);
  const other404=new NativeChainClient(undefined,undefined,async(url)=>{if(url===DEFAULT_CHAIN_RPC)rpcCalls+=1;return response({error:"transaction not found"},404)});
  await assert.rejects(()=>other404.account(account),/transaction not found/);
  assert.equal(rpcCalls,0);
});

test("native client rejects mismatched authoritative identity, broadcast, and unsafe endpoints",async()=>{
  const mismatch=new NativeChainClient("https://rest.ynxweb4.com",undefined,async()=>response({account:{address:"0x"+"1".repeat(40),balance:1,nonce:0}}));
  await assert.rejects(()=>mismatch.account(account),/identity/);
  const broadcast=new NativeChainClient("https://rest.ynxweb4.com",undefined,async()=>response({transaction:{hash:"0x"+"0".repeat(64),from:signed.transaction.from,to:signed.transaction.to,amount:25,fee:1,nonce:7},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"}));
  await assert.rejects(()=>broadcast.broadcast(signed.payload,signed.transaction,signed.hash),/does not match/);
  assert.throws(()=>new NativeChainClient("http://rpc.ynxweb4.com"),/HTTPS/);
  assert.throws(()=>new NativeChainClient(undefined,"http://rpc.ynxweb4.com/evm"),/HTTPS/);
});

test("native client independently times out if the React Native fetch implementation ignores AbortController",async()=>{
  const client=new NativeChainClient(undefined,undefined,async()=>new Promise<Response>(()=>{}),5);
  await assert.rejects(()=>client.account(account),(caught:unknown)=>caught instanceof ChainNetworkError&&caught.code==="RPC_UNAVAILABLE"&&caught.reason==="timeout");
});

test("native client exposes a canonical unavailable code for immediate React Native transport failure",async()=>{
  const client=new NativeChainClient(undefined,undefined,async()=>{throw new Error("fetch failed: java.net.UnknownHostException")});
  await assert.rejects(()=>client.account(account),(caught:unknown)=>caught instanceof ChainNetworkError&&caught.code==="RPC_UNAVAILABLE"&&caught.reason==="transport");
});

function rpcFallback(overrides:{chainId?:string;balance?:string;nonce?:string}){return async(url:string,init?:RequestInit)=>{if(url.startsWith(DEFAULT_CHAIN_API))return response({error:"account not found"},404);const request=JSON.parse(String(init?.body)) as Record<string,unknown>;if(request.method==="eth_chainId")return rpc(request,overrides.chainId??YNX_EVM_CHAIN_ID);if(request.method==="eth_getBalance")return rpc(request,overrides.balance??"0x0");return rpc(request,overrides.nonce??"0x0")}}
function rpc(request:Record<string,unknown>,result:unknown){return response({jsonrpc:"2.0",id:request.id,result})}
function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}})}
