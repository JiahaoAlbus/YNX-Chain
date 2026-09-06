import assert from "node:assert/strict";
import test from "node:test";
import {verifyMessage,verifyTypedData,Transaction,toQuantity} from "ethers";
import {NATIVE_FEE_MODEL} from "../src/extension-fee-model.js";
import {extensionIdentity} from "../src/extension-vault.js";
import {extensionReviewText,prepareExtensionRequest,signExtensionRequest} from "../src/extension-signer.js";

const SECRET=`${"00".repeat(31)}01`,ACCOUNT=extensionIdentity(SECRET).account,TO=`0x${"2".repeat(40)}`;
const rpc=async(method)=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},eth_getTransactionCount:"0x1",eth_estimateGas:"0x61a8",eth_gasPrice:NATIVE_FEE_MODEL.gasPrice,eth_getBalance:toQuantity(3n*10n**18n)})[method];
const prepare=(method,params,network=rpc)=>prepareExtensionRequest({expectedAccount:ACCOUNT,method,params,rpc:network});
const sign=(prepared,options={})=>signExtensionRequest({secretHex:SECRET,expectedAccount:ACCOUNT,prepared,rpc,assertAuthorized:async()=>{},...options});

test("vault signer produces recoverable personal and exact 0x1917 typed-data signatures",async()=>{
  const message="0x68656c6c6f",personal=await sign(await prepare("personal_sign",[message,ACCOUNT]));
  assert.equal(verifyMessage(getBytes(message),personal).toLowerCase(),ACCOUNT);
  const typed={domain:{name:"YNX Test",version:"1",chainId:6423,verifyingContract:TO},types:{Mail:[{name:"contents",type:"string"}]},primaryType:"Mail",message:{contents:"Approve only this test"}},signature=await sign(await prepare("eth_signTypedData_v4",[ACCOUNT,JSON.stringify(typed)]));
  assert.equal(verifyTypedData(typed.domain,{Mail:typed.types.Mail},typed.message,signature).toLowerCase(),ACCOUNT);
});

test("vault signer binds and signs one canonical legacy transaction for chain 6423",async()=>{
  const prepared=await prepare("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n),data:"0x"}]),result=await sign(prepared),tx=Transaction.from(result.rawTransaction);
  assert.equal(tx.from.toLowerCase(),ACCOUNT);assert.equal(tx.chainId,6423n);assert.equal(tx.to.toLowerCase(),TO);assert.equal(tx.nonce,1);assert.equal(tx.value,2n*10n**18n);assert.equal(tx.gasLimit,25000n);assert.equal(tx.gasPrice,40000000000000n);assert.equal(prepared.review.networkFee,"1.0");assert.equal(prepared.review.total,"3.0");assert.equal(tx.hash,result.transactionHash);
  await assert.rejects(()=>prepare("eth_sendTransaction",[{from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n),data:"0x"}],async(method)=>method==="eth_chainId"?"0x1":rpc(method)),error=>error.code==="WRONG_NETWORK");
});

test("complete message and typed-data review preserves tails, all types and exact bytes",async()=>{
  const text=`${"a".repeat(1500)}\u202e\u200bTAIL`,message=`0x${Buffer.from(text).toString("hex")}`,personal=await prepare("personal_sign",[message,ACCOUNT]),review=extensionReviewText(personal.review);
  assert.equal(personal.review.messageHex,message);assert.equal(personal.review.messageText,text);assert.equal(personal.review.messageBytes,Buffer.byteLength(text));
  assert.match(review,/\\u202e\\u200bTAIL/);assert.equal(review.includes("\u202e"),false);assert.equal(review.includes(message),true);
  const typed={domain:{name:"Full",chainId:6423},types:{Mail:[{name:"contents",type:"string"}]},primaryType:"Mail",message:{contents:`${"b".repeat(5000)}VISIBLE_TAIL`}},prepared=await prepare("eth_signTypedData_v4",[ACCOUNT,JSON.stringify(typed)]);
  assert.match(extensionReviewText(prepared.review),/VISIBLE_TAIL/);assert.deepEqual(prepared.review.types.Mail,typed.types.Mail);assert.equal(Object.isFrozen(prepared.review.types.Mail[0]),true);
  assert.match((await prepare("personal_sign",["0xff",ACCOUNT])).review.messageText,/Invalid UTF-8/);
  assert.match(extensionReviewText((await prepare("personal_sign",["0xefbbbf41",ACCOUNT])).review),/\\ufeffA/);
  for(const invalid of[{...typed,primaryType:"Harmless"},{...typed,types:{...typed.types,EIP712Domain:[]}},{...typed,domain:{chainId:1}}])await assert.rejects(prepare("eth_signTypedData_v4",[ACCOUNT,JSON.stringify(invalid)]));
});

test("preparation preserves supplied gas and exact maximum budget; signing only revalidates capability and nonce",async()=>{
  const transaction={from:ACCOUNT,to:TO,value:toQuantity(10n**18n),data:"0x",gas:"0x7530"},prepared=await prepare("eth_sendTransaction",[transaction]);
  assert.equal(prepared.params[0].gasLimit,"0x7530");assert.equal("gas" in prepared.params[0],false);assert.equal(prepared.review.maximumFee,"1.2");assert.equal(prepared.review.networkFee,"1.0");
  transaction.value="0x0";assert.throws(()=>prepared.params[0].nonce="0x2");
  const calls=[],result=await sign(prepared,{rpc:async(method,params)=>{calls.push(method);return rpc(method,params)}}),signed=Transaction.from(result.rawTransaction);
  assert.deepEqual(calls,["eth_chainId","ynx_getFeeModel","eth_getTransactionCount"]);assert.equal(signed.unsignedSerialized,Transaction.from({...prepared.params[0],from:undefined,nonce:1}).unsignedSerialized);
  await assert.rejects(sign(prepared),error=>error.code==="UNREVIEWED_REQUEST");
});

test("strict Core capability rejects unknown, legacy, fractional and full-EVM input before review",async()=>{
  const params={from:ACCOUNT,to:TO,value:toQuantity(2n*10n**18n),data:"0x"};
  for(const change of[{value:"0x0"},{value:"0x1"},{data:"0x1234"},{to:null},{to:ACCOUNT},{type:1},{type:2},{accessList:[]},{maxFeePerGas:"0x1"},{gasPrice:"0x1"},{gas:"0x5208"}])await assert.rejects(prepare("eth_sendTransaction",[{...params,...change}]));
  for(const model of[undefined,{...NATIVE_FEE_MODEL,enabled:false},{...NATIVE_FEE_MODEL,enabled:true,decimals:6},{...NATIVE_FEE_MODEL,enabled:true,fullEVM:true}])await assert.rejects(prepare("eth_sendTransaction",[params],async method=>method==="ynx_getFeeModel"?model:rpc(method)));
  await assert.rejects(prepare("eth_sendTransaction",[{...params,gas:"0x7530"}]),{code:"INSUFFICIENT_FUNDS"});
  const prepared=await prepare("eth_sendTransaction",[params]);await assert.rejects(sign(prepared,{rpc:async method=>method==="ynx_getFeeModel"?{...NATIVE_FEE_MODEL,enabled:false}:rpc(method)}),{code:"NATIVE_TRANSFER_DISABLED"});
});

test("missing fees, funds, changed nonce and revoked authorization fail without returning signatures",async()=>{
  const params=[{from:ACCOUNT,to:TO,value:toQuantity(10n**18n),data:"0x"}];
  for(const method of["eth_gasPrice","eth_estimateGas","eth_getTransactionCount","eth_getBalance"])await assert.rejects(prepare("eth_sendTransaction",params,async(name)=>name===method?undefined:rpc(name)));
  await assert.rejects(prepare("eth_sendTransaction",params,async(name)=>name==="eth_getBalance"?"0x0":rpc(name)),error=>error.code==="INSUFFICIENT_FUNDS");
  for(const change of[{gasPrice:"0x1",maxFeePerGas:"0x2"},{gas:"0x5208",gasLimit:"0x6270"},{type:3},{nonce:"0x2"}])await assert.rejects(prepare("eth_sendTransaction",[{...params[0],...change}]));
  await assert.rejects(sign(await prepare("eth_sendTransaction",params),{rpc:async(name)=>name==="eth_getTransactionCount"?"0x2":rpc(name)}),error=>error.code==="TRANSACTION_NONCE_CHANGED");
  const prepared=await prepare("personal_sign",["0x01",ACCOUNT]);await assert.rejects(sign({...prepared}),error=>error.code==="UNREVIEWED_REQUEST");
  let checks=0;await assert.rejects(sign(prepared,{assertAuthorized:async()=>{if(++checks===2)throw Object.assign(new Error("revoked during signing"),{code:"PERMISSION_REVOKED"})}}),error=>error.code==="PERMISSION_REVOKED");assert.equal(checks,2);
});

function getBytes(value){return Uint8Array.from(Buffer.from(value.slice(2),"hex"))}
