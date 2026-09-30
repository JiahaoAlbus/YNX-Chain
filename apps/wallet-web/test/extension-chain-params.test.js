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

test("published website parameters accept YNXT display alias and trusted RPC subset",()=>{
  const website={chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:{name:"YNXT",symbol:"YNXT",decimals:18},rpcUrls:["https://rpc-testnet.ynxweb4.com"],blockExplorerUrls:["https://explorer.ynxweb4.com"]};
  assert.equal(validateYNXChainMutation("wallet_addEthereumChain",[website],YNX_CHAIN),true);
  for(const urls of [[],["http://rpc-testnet.ynxweb4.com"],["https://rpc-testnet.ynxweb4.com?x=1"],["https://rpc-testnet.ynxweb4.com#x"],["https://user@rpc-testnet.ynxweb4.com"],["https://127.0.0.1"],["https://evil.example"],[...website.rpcUrls,"https://evil.example"],[...website.rpcUrls,...website.rpcUrls]])assert.throws(()=>validateYNXChainMutation("wallet_addEthereumChain",[{...website,rpcUrls:urls}],YNX_CHAIN),error=>error.code==="INVALID_CHAIN_PARAMS");
  for(const input of [{...website,nativeCurrency:{...website.nativeCurrency,decimals:6}},{...website,nativeCurrency:{name:"YNXT",decimals:18}},{...website,nativeCurrency:{...website.nativeCurrency,name:"Fake coin"}},{...website,blockExplorerUrls:["https://evil.example"]},{...website,chainId:"0x1"}])assert.throws(()=>validateYNXChainMutation("wallet_addEthereumChain",[input],YNX_CHAIN),error=>error.code==="INVALID_CHAIN_PARAMS");
  assert.throws(()=>validateYNXChainMutation("unsupported",[website],YNX_CHAIN),error=>error.code==="INVALID_CHAIN_PARAMS");
});
