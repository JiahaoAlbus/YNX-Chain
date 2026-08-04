import assert from "node:assert/strict";
import test from "node:test";
import {createSignedNativeTransfer,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {NativeChainClient} from "./nativeTransfer";

const account=ynxAddressFromEVM("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
const recipient=ynxAddressFromEVM("0xffffffffffffffffffffffffffffffffffffffff");
const signed=createSignedNativeTransfer({accountSecret:"0".repeat(63)+"1",to:recipient,amount:25,nonce:7});

test("native client loads exact account/activity and broadcasts only matching signed result",async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const client=new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{calls.push({url,init});if(url.includes("/accounts/"))return response({account:{address:signed.transaction.from,balance:100,nonce:6}});if(url.includes("/txs?"))return response({transactions:[{hash:signed.hash,type:"transfer",from:signed.transaction.from,to:signed.transaction.to,amount:25,fee:1,nonce:7}]});return response({transaction:{hash:signed.hash,from:signed.transaction.from,to:signed.transaction.to,amount:25,fee:1,nonce:7},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"},201)});
  assert.deepEqual(await client.account(account),{address:signed.transaction.from,balance:100,nonce:6});
  assert.equal((await client.activity(account)).length,1);
  assert.equal((await client.broadcast(signed.payload,signed.transaction,signed.hash)).hash,signed.hash);
  assert.equal(calls[2]?.init?.method,"POST");assert.equal(calls[2]?.init?.body,signed.payload);
});

test("native client rejects mismatched authoritative identity and broadcast",async()=>{
  const mismatch=new NativeChainClient("https://rpc.ynxweb4.com",async()=>response({account:{address:"0x"+"1".repeat(40),balance:1,nonce:0}}));
  await assert.rejects(()=>mismatch.account(account),/identity/);
  const broadcast=new NativeChainClient("https://rpc.ynxweb4.com",async()=>response({transaction:{hash:"0x"+"0".repeat(64),from:signed.transaction.from,to:signed.transaction.to,amount:25,fee:1,nonce:7},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"}));
  await assert.rejects(()=>broadcast.broadcast(signed.payload,signed.transaction,signed.hash),/does not match/);
  assert.throws(()=>new NativeChainClient("http://rpc.ynxweb4.com"),/HTTPS/);
});

function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}})}
