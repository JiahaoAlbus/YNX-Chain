import assert from "node:assert/strict";
import test from "node:test";
import {verifyMessage,verifyTypedData,Transaction} from "ethers";
import {extensionIdentity} from "../src/extension-vault.js";
import {signExtensionRequest} from "../src/extension-signer.js";

const SECRET=`${"00".repeat(31)}01`,ACCOUNT=extensionIdentity(SECRET).account,TO=`0x${"2".repeat(40)}`;
const rpc=async(method)=>({eth_chainId:"0x1917",eth_getTransactionCount:"0x1",eth_estimateGas:"0x5208",eth_gasPrice:"0x3b9aca00"})[method];

test("vault signer produces recoverable personal and exact 0x1917 typed-data signatures",async()=>{
  const message="0x68656c6c6f",personal=await signExtensionRequest({secretHex:SECRET,expectedAccount:ACCOUNT,method:"personal_sign",params:[message,ACCOUNT],rpc});
  assert.equal(verifyMessage(getBytes(message),personal).toLowerCase(),ACCOUNT);
  const typed={domain:{name:"YNX Test",version:"1",chainId:6423,verifyingContract:TO},types:{EIP712Domain:[],Mail:[{name:"contents",type:"string"}]},primaryType:"Mail",message:{contents:"Approve only this test"}},signature=await signExtensionRequest({secretHex:SECRET,expectedAccount:ACCOUNT,method:"eth_signTypedData_v4",params:[ACCOUNT,JSON.stringify(typed)],rpc});
  assert.equal(verifyTypedData(typed.domain,{Mail:typed.types.Mail},typed.message,signature).toLowerCase(),ACCOUNT);
});

test("vault signer binds and signs one canonical legacy transaction for chain 6423",async()=>{
  const result=await signExtensionRequest({secretHex:SECRET,expectedAccount:ACCOUNT,method:"eth_sendTransaction",params:[{from:ACCOUNT,to:TO,value:"0x0",data:"0x"}],rpc}),tx=Transaction.from(result.rawTransaction);
  assert.equal(tx.from.toLowerCase(),ACCOUNT);assert.equal(tx.chainId,6423n);assert.equal(tx.to.toLowerCase(),TO);assert.equal(tx.nonce,1);assert.equal(tx.gasLimit,21000n);assert.equal(tx.gasPrice,1000000000n);assert.equal(tx.hash,result.transactionHash);
  await assert.rejects(()=>signExtensionRequest({secretHex:SECRET,expectedAccount:ACCOUNT,method:"eth_sendTransaction",params:[{from:ACCOUNT,to:TO,value:"0x0",data:"0x"}],rpc:async(method)=>method==="eth_chainId"?"0x1":rpc(method)}),error=>error.code==="WRONG_NETWORK");
});

function getBytes(value){return Uint8Array.from(Buffer.from(value.slice(2),"hex"))}
