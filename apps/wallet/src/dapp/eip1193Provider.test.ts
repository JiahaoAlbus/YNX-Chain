import assert from "node:assert/strict";
import { test } from "node:test";
import { Transaction, getBytes, verifyMessage, verifyTypedData } from "ethers";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { EIP1193_METHODS, SHARED_PROVIDER_AUTHORITY, YNX_EVM_CAIP2, YNX_EVM_CHAIN_QUANTITY, answerEip1193Read, approveAndSignEip1193Request, approveEip1193Session, parseEip1193Request } from "./eip1193Provider";

const SECRET=`${"00".repeat(31)}01`,OTHER=`${"00".repeat(31)}02`,identity=walletIdentity(SECRET),account="0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const NOW=new Date("2026-08-22T04:00:00.000Z"),ISSUED="2026-08-22T03:59:59.000Z",EXPIRES="2026-08-22T04:04:59.000Z";
const proposal={sessionId:"wc_session_abcdefghijklmnop",transport:"walletconnect-v2",origin:"https://dapp.example",name:"External Test DApp",chains:[YNX_EVM_CAIP2],methods:[...EIP1193_METHODS],events:["accountsChanged","chainChanged"],expiresAt:"2026-08-23T04:00:00.000Z"};
const session=()=>approveEip1193Session(proposal,identity.account,NOW);
const request=(method:string,params:unknown[]=[])=>parseEip1193Request({sessionId:proposal.sessionId,requestId:42,transport:proposal.transport,origin:proposal.origin,chainId:YNX_EVM_CAIP2,method,params,issuedAt:ISSUED,expiresAt:EXPIRES},session(),NOW);

test("Wallet approves exact WalletConnect v2 namespace without Product Session authority",()=>{
  const value=session();assert.equal(value.account,account);assert.equal(value.caip10Account,`eip155:6423:${account}`);assert.equal(value.productSession,false);assert.equal(value.privateService,"not-requested");assert.equal(value.authority,"standard-wallet-eip1193-provider");assert.equal(Object.isFrozen(value),true);
  assert.deepEqual(SHARED_PROVIDER_AUTHORITY,{sourceCommit:"98c6d5d784d212df8981a53b17118a511e246ad2",sourceTree:"51a60a362d4ad5dd748bcdefb101f71b1d9e0cee",evidenceCommit:"c3ab255c32bdeb9c8e056882c315f8ad43c29c7f"});
});

test("approved account and network reads expose only canonical EIP-1193 identity",()=>{
  assert.deepEqual(answerEip1193Read(request("eth_accounts")),[account]);assert.deepEqual(answerEip1193Read(request("eth_requestAccounts")),[account]);assert.equal(answerEip1193Read(request("eth_chainId")),YNX_EVM_CHAIN_QUANTITY);assert.equal(answerEip1193Read(request("net_version")),"6423");
  assert.throws(()=>answerEip1193Read(request("personal_sign",["0x6869",account])),has("USER_APPROVAL_REQUIRED"));
});

test("personal_sign produces a recoverable EIP-191 signature only after the ordered approval boundary",async()=>{
  const pending=request("personal_sign",["0x68656c6c6f",account]),events:string[]=[];const signature=await approveAndSignEip1193Request(pending,{authorize:async method=>events.push(`authorize:${method}`),readAccountSecret:async selected=>{events.push(`secret:${selected}`);return SECRET},assertActive:()=>events.push("active"),now:()=>NOW});assert.match(signature,/^0x[0-9a-f]{130}$/);assert.equal(verifyMessage(getBytes("0x68656c6c6f"),signature).toLowerCase(),account);assert.deepEqual(events,["active","authorize:personal_sign","active",`secret:${account}`,"active","active"]);await assert.rejects(approveAndSignEip1193Request(pending,{authorize:async()=>{},readAccountSecret:async()=>OTHER,assertActive:()=>{},now:()=>NOW}),has("ACCOUNT_MISMATCH"));
});

test("eth_signTypedData_v4 binds chain 6423 domain, account and structured message",async()=>{
  const typed={domain:{name:"YNX External DApp",version:"1",chainId:6423,verifyingContract:"0x1111111111111111111111111111111111111111"},types:{EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],Permit:[{name:"owner",type:"address"},{name:"spender",type:"address"},{name:"value",type:"uint256"}]},primaryType:"Permit",message:{owner:account,spender:"0x2222222222222222222222222222222222222222",value:"7"}},json=JSON.stringify(typed),pending=request("eth_signTypedData_v4",[account,json]),signature=await sign(pending);const {EIP712Domain:_,...types}=typed.types;assert.equal(verifyTypedData(typed.domain,types,typed.message,signature).toLowerCase(),account);
  assert.throws(()=>request("eth_signTypedData_v4",[account,JSON.stringify({...typed,domain:{...typed.domain,chainId:1}})]),has("UNSUPPORTED_CHAIN"));
});

test("eth_sendTransaction signs one complete EIP-1559 chain-6423 transaction",async()=>{
  const tx={from:account,to:"0x3333333333333333333333333333333333333333",chainId:"0x1917",nonce:"0x2",gas:"0x5208",maxFeePerGas:"0x3b9aca00",maxPriorityFeePerGas:"0x3b9aca00",value:"0x7",data:"0x",type:"0x2"},pending=request("eth_sendTransaction",[tx]),serialized=await sign(pending),parsed=Transaction.from(serialized);assert.equal(parsed.chainId,6423n);assert.equal(parsed.from?.toLowerCase(),account);assert.equal(parsed.to?.toLowerCase(),tx.to);assert.equal(parsed.nonce,2);assert.equal(parsed.value,7n);assert.equal(parsed.isSigned(),true);
});

test("wrong chain, origin, account, method, lifetime and transaction widening fail closed",()=>{
  for(const override of [{chains:["eip155:1"]},{origin:"http://dapp.example"},{methods:["eth_sign"]},{events:["message"]},{expiresAt:"2026-09-22T04:00:00.000Z"}])assert.throws(()=>approveEip1193Session({...proposal,...override},identity.account,NOW));
  assert.throws(()=>parseEip1193Request({sessionId:proposal.sessionId,requestId:42,transport:proposal.transport,origin:proposal.origin,chainId:"eip155:1",method:"eth_accounts",params:[],issuedAt:ISSUED,expiresAt:EXPIRES},session(),NOW),has("SESSION_BINDING_MISMATCH"));
  assert.throws(()=>request("personal_sign",["0x00","0x4444444444444444444444444444444444444444"]),has("ACCOUNT_MISMATCH"));assert.throws(()=>request("eth_sendTransaction",[{from:account,to:account,chainId:"0x1917",nonce:"0x00",gas:"0x5208",maxFeePerGas:"0x1",maxPriorityFeePerGas:"0x2",value:"0x0",data:"0x",type:"0x2"}]));
  assert.throws(()=>parseEip1193Request({sessionId:proposal.sessionId,requestId:42,transport:proposal.transport,origin:proposal.origin,chainId:YNX_EVM_CAIP2,method:"eth_accounts",params:[],issuedAt:ISSUED,expiresAt:"2026-08-22T04:00:00.000Z"},session(),NOW),has("INVALID_EXPIRY"));
});

function has(code:string){return(error:unknown)=>typeof error==="object"&&error!==null&&(error as {code?:unknown}).code===code}
function sign(pending:ReturnType<typeof request>){return approveAndSignEip1193Request(pending,{authorize:async()=>{},readAccountSecret:async()=>SECRET,assertActive:()=>{},now:()=>NOW})}
