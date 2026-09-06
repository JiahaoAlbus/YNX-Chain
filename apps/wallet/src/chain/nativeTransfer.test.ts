import assert from "node:assert/strict";
import test from "node:test";
import {createSignedNativeTransfer,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {AccountNotRecordedError,NativeChainClient,loadNativeChainState} from "./nativeTransfer";

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

test("only the exact account lookup reports a missing on-chain record without inventing balance or nonce",async()=>{
  const calls:{url:string;method?:string}[]=[];
  const client=new NativeChainClient("https://rpc.ynxweb4.com",async(url,init)=>{calls.push({url,method:init?.method});return response({error:"account not found"},404)});
  await assert.rejects(()=>client.account(account),(error:unknown)=>{
    assert.ok(error instanceof AccountNotRecordedError);assert.equal(error.account,account);
    assert.equal("balance" in error,false);assert.equal("nonce" in error,false);return true;
  });
  assert.deepEqual(calls,[{url:`https://rpc.ynxweb4.com/accounts/${encodeURIComponent(account)}`,method:"GET"}]);
  for(const action of [()=>client.activity(account),()=>client.broadcast(signed.payload,signed.transaction,signed.hash)])await assert.rejects(action,(error:unknown)=>error instanceof Error&&!(error instanceof AccountNotRecordedError)&&/404/.test(error.message));
  const before=calls.length;
  await assert.rejects(()=>client.account("not-a-ynx-address"));
  assert.equal(calls.length,before,"an invalid address never reaches the account endpoint");
});

for(const [label,fetcher] of [
  ["generic route 404",async()=>response({error:"not found"},404)],
  ["different BFT contract",async()=>response({error:"YNX account not found"},404)],
  ["extra response fields",async()=>response({error:"account not found",code:"NOT_FOUND"},404)],
  ["server error",async()=>response({error:"account not found"},500)],
  ["non-JSON route response",async()=>new Response("404 page not found",{status:404})],
  ["invalid JSON",async()=>new Response('{"error":',{status:404})],
  ["network failure",async()=>{throw new TypeError("Network request failed")}],
  ["aborted request",async()=>{throw new DOMException("Request timed out","AbortError")}],
  ["invalid successful account",async()=>response({error:"account not found"})],
] as const)test(`${label} remains a failed account lookup`,async()=>{
  const client=new NativeChainClient("https://rpc.ynxweb4.com",fetcher);
  await assert.rejects(()=>client.account(account),(error:unknown)=>error instanceof Error&&!(error instanceof AccountNotRecordedError));
  const state=await loadNativeChainState(client,account);
  assert.equal(state.phase,"failed");assert.equal(state.account,undefined);
});

test("missing account and activity failures remain independent, and a later real account restores data",async()=>{
  let recorded=false,activityAvailable=false;
  const client=new NativeChainClient("https://rpc.ynxweb4.com",async(url)=>url.includes("/accounts/")?recorded?response({account:{address:signed.transaction.from,balance:100,nonce:6}}):response({error:"account not found"},404):activityAvailable?response({transactions:[]}):response({error:"history unavailable"},503));
  const unavailableActivity=await loadNativeChainState(client,account);
  assert.equal(unavailableActivity.phase,"unrecorded");assert.equal(unavailableActivity.account,undefined);
  assert.equal(unavailableActivity.activityPhase,"failed");assert.match(unavailableActivity.activityError??"",/503.*history unavailable/);
  activityAvailable=true;
  const emptyActivity=await loadNativeChainState(client,account);
  assert.equal(emptyActivity.phase,"unrecorded");assert.equal(emptyActivity.account,undefined);
  assert.equal(emptyActivity.activityPhase,"ready");assert.deepEqual(emptyActivity.activity,[]);
  recorded=true;
  const loaded=await loadNativeChainState(client,account);
  assert.equal(loaded.phase,"ready");assert.deepEqual(loaded.account,{address:signed.transaction.from,balance:100,nonce:6});
  assert.equal(loaded.activityPhase,"ready");assert.equal(loaded.error,undefined);
});

test("valid balance remains available when the independent activity endpoint fails",async()=>{
  const client=new NativeChainClient("https://rpc.ynxweb4.com",async(url)=>url.includes("/accounts/")?response({account:{address:signed.transaction.from,balance:0,nonce:0}}):response({error:"not found"},404));
  const state=await loadNativeChainState(client,account);
  assert.equal(state.phase,"ready");assert.deepEqual(state.account,{address:signed.transaction.from,balance:0,nonce:0});
  assert.equal(state.activityPhase,"failed");assert.match(state.activityError??"",/404/);
});

function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}})}
