import assert from "node:assert/strict";
import test from "node:test";
import {Wallet} from "ethers";
import {walletIdentity} from "../../../packages/wallet-auth/src/crypto.js";
import {toEVMAddress,toYNXAddress} from "../src/wallet-address.js";
import {prepareTransaction} from "../src/transaction-input.js";

test("YNX display and recipient input preserve the SDK and signer 20-byte identity",()=>{
  const secret="1".padStart(64,"0"),evm=new Wallet(secret).address.toLowerCase(),ynx=walletIdentity(secret).account;
  assert.equal(toYNXAddress(evm),ynx);assert.equal(toEVMAddress(ynx),evm);assert.equal(toYNXAddress(ynx),ynx);
  assert.deepEqual(prepareTransaction({from:evm,to:ynx,amount:"2"}),prepareTransaction({from:evm,to:evm,amount:"2"}));
  for(const bad of[ynx.slice(0,-1)+(ynx.endsWith("q")?"p":"q"),ynx.toUpperCase(),"ynx"+evm.slice(2),"0x1234","other1"+ynx.slice(4)])assert.throws(()=>prepareTransaction({from:evm,to:bad,amount:"2"}),{code:"INVALID_RECIPIENT"});
});

test("Ethereum compatibility input validates mixed-case checksum before normalization",()=>{
  const checksummed=new Wallet("1".padStart(64,"0")).address,lower=checksummed.toLowerCase(),wrongChecksum=checksummed.replace("E","e");
  assert.notEqual(checksummed,lower);assert.notEqual(wrongChecksum,checksummed);assert.equal(toEVMAddress(checksummed),lower);assert.equal(toEVMAddress(lower),lower);assert.equal(toYNXAddress(checksummed),toYNXAddress(lower));
  for(const bad of[wrongChecksum,"0x"+"a".repeat(39),"0x"+"a".repeat(41)]){
    assert.throws(()=>toEVMAddress(bad),{code:"INVALID_ACCOUNT"});assert.throws(()=>prepareTransaction({from:lower,to:bad,amount:"2"}),{code:"INVALID_RECIPIENT"});
  }
});
