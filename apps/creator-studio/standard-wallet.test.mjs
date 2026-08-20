import test from "node:test";
import assert from "node:assert/strict";
import {connectStandardWallet,privateServiceDegraded,WALLET_INSTALL_OPTIONS} from "./standard-wallet.js";

class WindowLike extends EventTarget { constructor(provider){super();this.ethereum=provider} }
test("standard wallet connects independently and enforces YNX Testnet",async()=>{let chain="0x1";const calls=[];const provider={request:async({method,params})=>{calls.push([method,params]);if(method==="eth_requestAccounts")return["0x1111111111111111111111111111111111111111"];if(method==="eth_chainId")return chain;if(method==="wallet_switchEthereumChain"){chain="0x1917";return null}throw new Error(method)},on(){},removeListener(){}};const result=await connectStandardWallet({windowLike:new WindowLike(provider),timeoutMs:0,network:{rpcUrl:"https://evm.ynxweb4.com",explorerUrl:"https://explorer.ynxweb4.com"}});assert.equal(result.account,"0x1111111111111111111111111111111111111111");assert.equal(result.chainId,"0x1917");assert.ok(calls.some(([method])=>method==="wallet_switchEthereumChain"))});
test("private failure preserves standard connection",()=>{const state=privateServiceDegraded({account:"0x1111111111111111111111111111111111111111",chainId:"0x1917"});assert.equal(state.standardConnection.state,"STANDARD_CONNECTED");assert.equal(state.privateService.state,"PRIVATE_SERVICE_DEGRADED")});
test("official YNX Wallet and MetaMask recovery are both offered",()=>{assert.deepEqual(WALLET_INSTALL_OPTIONS.map(x=>x.url),["https://ynxweb4.com/dapp/download","https://metamask.io/download/"])});
