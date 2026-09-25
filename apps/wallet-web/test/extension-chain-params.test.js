import assert from "node:assert/strict";
import test from "node:test";
import {YNX_CHAIN} from "../src/provider.js";
import {validateYNXChainMutation} from "../src/extension-chain-params.js";

test("add-chain accepts equivalent trusted metadata independent of key order",()=>{
  const reversed=Object.fromEntries(Object.entries(YNX_CHAIN).reverse());
  assert.equal(validateYNXChainMutation("wallet_addEthereumChain",[reversed],YNX_CHAIN),true);
  assert.equal(validateYNXChainMutation("wallet_addEthereumChain",[{chainId:YNX_CHAIN.chainId,rpcUrls:YNX_CHAIN.rpcUrls}],YNX_CHAIN),true);
  assert.equal(validateYNXChainMutation("wallet_switchEthereumChain",[{chainId:YNX_CHAIN.chainId}],YNX_CHAIN),true);
});

test("add-chain rejects another chain, altered RPC and untrusted fields",()=>{
  for(const input of [{chainId:"0x1"},{...YNX_CHAIN,rpcUrls:["https://evil.example"]},{...YNX_CHAIN,extra:true},null]){
    assert.throws(()=>validateYNXChainMutation("wallet_addEthereumChain",[input],YNX_CHAIN),error=>error.code==="INVALID_CHAIN_PARAMS");
  }
  assert.throws(()=>validateYNXChainMutation("wallet_switchEthereumChain",[{chainId:YNX_CHAIN.chainId,extra:true}],YNX_CHAIN),error=>error.code==="INVALID_CHAIN_PARAMS");
});
