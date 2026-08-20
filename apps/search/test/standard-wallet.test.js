import assert from "node:assert/strict";
import test from "node:test";
import {WALLET_INSTALL_OPTIONS,connectStandardWallet,privateServiceDegraded} from "../src/public/standard-wallet.js";

test("standard EVM connection requests an account and switches to YNX Testnet",async()=>{
  const calls=[];
  const provider={request:async({method,params})=>{calls.push({method,params});if(method==="eth_requestAccounts")return["0x1111111111111111111111111111111111111111"];if(method==="eth_chainId")return calls.filter(call=>call.method==="eth_chainId").length<=2?"0x1":"0x1917";if(method==="wallet_switchEthereumChain")return null;throw new Error(method)},on(){},removeListener(){}};
  const result=await connectStandardWallet({windowLike:{ethereum:provider,addEventListener(){},removeEventListener(){},dispatchEvent(){}},timeoutMs:0,network:{rpcUrl:"https://evm.ynxweb4.com",explorerUrl:"https://explorer.ynxweb4.com"}});
  assert.equal(result.account,"0x1111111111111111111111111111111111111111");
  assert.equal(result.chainId,"0x1917");
  assert.ok(calls.some(call=>call.method==="wallet_switchEthereumChain"));
});

test("private Product Session degradation preserves Standard Wallet",()=>{
  const state=privateServiceDegraded({account:"0x2222222222222222222222222222222222222222",chainId:"0x1917"});
  assert.equal(state.standardConnection.state,"STANDARD_CONNECTED");
  assert.equal(state.standardConnection.account,"0x2222222222222222222222222222222222222222");
  assert.equal(state.privateService.state,"PRIVATE_SERVICE_DEGRADED");
});

test("recovery offers official YNX Wallet and MetaMask downloads",()=>{
  assert.deepEqual(WALLET_INSTALL_OPTIONS.map(option=>option.url),["https://ynxweb4.com/dapp/download","https://metamask.io/download/"]);
});
