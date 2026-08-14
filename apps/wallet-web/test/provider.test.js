import assert from "node:assert/strict";
import test from "node:test";
import {
  METAMASK_DOWNLOAD_URL, SESSION_KEY, WalletWebError, YNX_CHAIN, YNX_DOWNLOAD_URL,
  addYNXChain, connectWallet, discoverInjectedProviders,
  forgetSession, readRememberedSession, rememberSession, resolveRememberedWallet,
  invalidatesConnectedSession, restoreTestnetSession, sendTransaction, signMessage, subscribeProviderLifecycle,
  switchToYNXChain, verifyTestnetRpc, walletActionGates, walletDiscoveryPresentation,
} from "../src/provider.js";

const ACCOUNT = `0x${"1".repeat(40)}`;
const TO = `0x${"2".repeat(40)}`;
const SIGNATURE = `0x${"3".repeat(130)}`;
const TX_HASH = `0x${"4".repeat(64)}`;
const rpc = async () => ({ok:true,status:200,json:async()=>({jsonrpc:"2.0",id:1,result:"0x1917"})});

function provider(responses = {}) {
  const calls = [];
  return {
    calls,
    async request(input) {
      calls.push(input);
      if (Object.hasOwn(responses, input.method)) {
        const value = responses[input.method];
        return typeof value === "function" ? value(input) : value;
      }
      throw Object.assign(new Error(`unexpected ${input.method}`), {code:-32601});
    },
  };
}

function storage() {
  const values = new Map();
  return {getItem:(key)=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:(key)=>values.delete(key)};
}

test("frozen chain metadata is exact and complete", () => {
  assert.deepEqual(YNX_CHAIN, {chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:{name:"YNX Testnet",symbol:"YNXT",decimals:18},rpcUrls:["https://evm.ynxweb4.com"],blockExplorerUrls:["https://explorer.ynxweb4.com"]});
});

test("injected discovery prefers YNX and keeps MetaMask explicit", () => {
  const ynx = Object.assign(provider(), {isYNXWallet:true});
  const metamask = Object.assign(provider(), {isMetaMask:true});
  const result = discoverInjectedProviders({ethereum:{providers:[metamask,ynx]}});
  assert.equal(result.ynx, ynx); assert.equal(result.metamask, metamask); assert.equal(result.any, ynx);
});

test("discovery presentation directly prefers YNX and gives two non-empty fallbacks", () => {
  assert.deepEqual(walletDiscoveryPresentation({ynx:provider(),metamask:provider()}),{ynxPresent:true,metamaskPresent:true,showYNXConnect:true,showYNXDownload:false,showMetaMaskChoice:false,metaMaskChoice:"connect"});
  assert.deepEqual(walletDiscoveryPresentation({ynx:null,metamask:provider()}),{ynxPresent:false,metamaskPresent:true,showYNXConnect:false,showYNXDownload:true,showMetaMaskChoice:true,metaMaskChoice:"connect"});
  assert.deepEqual(walletDiscoveryPresentation({}),{ynxPresent:false,metamaskPresent:false,showYNXConnect:false,showYNXDownload:true,showMetaMaskChoice:true,metaMaskChoice:"official-download"});
  assert.equal(new URL(YNX_DOWNLOAD_URL).hostname,"www.ynxweb4.com");
  assert.equal(METAMASK_DOWNLOAD_URL,"https://metamask.io/download");
});

test("RPC verification accepts only exact YNX Testnet", async () => {
  const evidence = await verifyTestnetRpc(rpc);
  assert.equal(evidence.chainId, "0x1917"); assert.equal(evidence.source, "https://evm.ynxweb4.com");
  await assert.rejects(() => verifyTestnetRpc(async()=>({ok:true,json:async()=>({result:"0x1"})})), (error) => error instanceof WalletWebError && error.code === "WRONG_NETWORK");
});

test("RPC recovery requires a new live 0x1917 response after an offline failure", async () => {
  let online = false;
  const recoveringRpc = async () => {
    if (!online) throw new Error("offline");
    return {ok:true,status:200,json:async()=>({jsonrpc:"2.0",id:1,result:"0x1917"})};
  };
  await assert.rejects(() => verifyTestnetRpc(recoveringRpc), (error) => error.code === "RPC_UNAVAILABLE");
  online = true;
  assert.equal((await verifyTestnetRpc(recoveringRpc)).chainId,"0x1917");
});

test("connect switches before requesting a real account", async () => {
  const wallet = provider({wallet_switchEthereumChain:null,eth_chainId:"0x1917",eth_requestAccounts:[ACCOUNT]});
  const session = await connectWallet(wallet,{fetcher:rpc});
  assert.deepEqual(session,{account:ACCOUNT,chainId:"0x1917"});
  assert.deepEqual(wallet.calls.map(({method})=>method),["wallet_switchEthereumChain","eth_chainId","eth_requestAccounts"]);
});

test("add-chain uses frozen metadata and proves the switched chain", async () => {
  const wallet = provider({wallet_addEthereumChain:null,wallet_switchEthereumChain:null,eth_chainId:"0x1917"});
  await addYNXChain(wallet,{fetcher:rpc});
  assert.deepEqual(wallet.calls[0],{method:"wallet_addEthereumChain",params:[YNX_CHAIN]});
  assert.deepEqual(wallet.calls.map(({method})=>method),["wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
});

test("network mutation fails closed before provider call when RPC is unavailable", async () => {
  const wallet = provider({wallet_switchEthereumChain:null});
  await assert.rejects(() => switchToYNXChain(wallet,{fetcher:async()=>{throw new Error("offline")}}), (error) => error.code === "RPC_UNAVAILABLE");
  assert.equal(wallet.calls.length,0);
});

test("signing validates chain and returned signature", async () => {
  const wallet = provider({eth_chainId:"0x1917",eth_accounts:[ACCOUNT],personal_sign:SIGNATURE});
  assert.equal(await signMessage(wallet,ACCOUNT,"YNX Testnet consent"),SIGNATURE);
  assert.equal(wallet.calls[2].params[1],ACCOUNT);
});

test("transaction requires live RPC, exact network, canonical input and real hash", async () => {
  const wallet = provider({eth_chainId:"0x1917",eth_accounts:[ACCOUNT],eth_sendTransaction:TX_HASH});
  assert.equal(await sendTransaction(wallet,{from:ACCOUNT,to:TO,value:"0x0",data:"0x"},{fetcher:rpc}),TX_HASH);
  assert.deepEqual(wallet.calls.map(({method})=>method),["eth_chainId","eth_accounts","eth_sendTransaction"]);
  await assert.rejects(() => sendTransaction(wallet,{from:ACCOUNT,to:"bad",value:"0x0",data:"0x"},{fetcher:rpc}), (error) => error.code === "INVALID_TRANSACTION");
});

test("signing and transaction reject a replaced account before sensitive provider calls", async () => {
  const signingWallet = provider({eth_chainId:"0x1917",eth_accounts:[TO],personal_sign:SIGNATURE});
  await assert.rejects(() => signMessage(signingWallet,ACCOUNT,"stale session"), (error) => error.code === "ACCOUNT_CHANGED");
  assert.deepEqual(signingWallet.calls.map(({method})=>method),["eth_chainId","eth_accounts"]);
  const transactionWallet = provider({eth_chainId:"0x1917",eth_accounts:[TO],eth_sendTransaction:TX_HASH});
  await assert.rejects(() => sendTransaction(transactionWallet,{from:ACCOUNT,to:TO,value:"0x0",data:"0x"},{fetcher:rpc}), (error) => error.code === "ACCOUNT_CHANGED");
  assert.deepEqual(transactionWallet.calls.map(({method})=>method),["eth_chainId","eth_accounts"]);
});

test("second launch restores only an exact live Testnet account", async () => {
  const memory = storage(); rememberSession({account:ACCOUNT,chainId:"0x1917"},"ynx",memory);
  assert.match(memory.getItem(SESSION_KEY),/"wallet":"ynx"/);
  const wallet = provider({eth_chainId:"0x1917",eth_accounts:[ACCOUNT]});
  assert.deepEqual(await restoreTestnetSession(wallet,memory),{account:ACCOUNT,chainId:"0x1917"});
  const wrong = provider({eth_chainId:"0x1",eth_accounts:[ACCOUNT]});
  assert.equal(await restoreTestnetSession(wrong,memory),null); assert.equal(memory.getItem(SESSION_KEY),null);
});

test("tampered local session JSON is removed without a provider request", async () => {
  const memory = storage(); memory.setItem(SESSION_KEY, "{not-json");
  const wallet = provider({});
  assert.equal(await restoreTestnetSession(wallet,memory),null);
  assert.equal(memory.getItem(SESSION_KEY),null); assert.equal(wallet.calls.length,0);
});

test("second launch removes non-canonical and unavailable remembered sessions", () => {
  const memory = storage();
  for (const saved of [
    {account:ACCOUNT,chainId:"0x1",wallet:"ynx"},
    {account:ACCOUNT,chainId:"0x1917",wallet:"unknown"},
    {account:ACCOUNT,chainId:"0x1917",wallet:"ynx",extra:true},
  ]) {
    memory.setItem(SESSION_KEY,JSON.stringify(saved));
    assert.equal(readRememberedSession(memory),null);
    assert.equal(memory.getItem(SESSION_KEY),null);
  }
  rememberSession({account:ACCOUNT,chainId:"0x1917"},"ynx",memory);
  assert.equal(resolveRememberedWallet({ynx:false,metamask:true},memory),null);
  assert.equal(memory.getItem(SESSION_KEY),null);
});

test("second launch invalidates account replacement and provider failure", async () => {
  for (const wallet of [
    provider({eth_chainId:"0x1917",eth_accounts:[TO]}),
    provider({eth_chainId:()=>{throw new Error("disconnected")},eth_accounts:[ACCOUNT]}),
  ]) {
    const memory = storage(); rememberSession({account:ACCOUNT,chainId:"0x1917"},"ynx",memory);
    assert.equal(await restoreTestnetSession(wallet,memory),null);
    assert.equal(memory.getItem(SESSION_KEY),null);
  }
});

test("action gates require a provider and an exact connected Testnet account", () => {
  assert.deepEqual(walletActionGates(null,null,null),{canAddChain:false,canSwitchChain:false,canSign:false,canSendTransaction:false});
  assert.deepEqual(walletActionGates(provider(),ACCOUNT,"0x1"),{canAddChain:true,canSwitchChain:true,canSign:false,canSendTransaction:false});
  assert.deepEqual(walletActionGates(provider(),ACCOUNT,"0x1917"),{canAddChain:true,canSwitchChain:true,canSign:true,canSendTransaction:true});
});

test("only authoritative provider identity failures invalidate the connected UI session", () => {
  for (const code of ["ACCOUNT_CHANGED","WRONG_NETWORK","WALLET_NOT_FOUND",4900,4901]) assert.equal(invalidatesConnectedSession({code}),true);
  for (const code of ["RPC_UNAVAILABLE","INVALID_MESSAGE",4001,-32603,undefined]) assert.equal(invalidatesConnectedSession({code}),false);
});

test("provider lifecycle callbacks normalize accounts and unsubscribe exactly", () => {
  const listeners = new Map(); const removed = [];
  const wallet = {on:(event,listener)=>listeners.set(event,listener),removeListener:(event,listener)=>removed.push([event,listener])};
  const observed = [];
  const unsubscribe = subscribeProviderLifecycle(wallet,{
    accountsChanged:(accounts)=>observed.push(["accounts",accounts]),
    chainChanged:(chainId)=>observed.push(["chain",chainId]),
    disconnect:()=>observed.push(["disconnect"]),
  });
  listeners.get("accountsChanged")([ACCOUNT,"bad"]); listeners.get("chainChanged")("0x1"); listeners.get("disconnect")();
  assert.deepEqual(observed,[["accounts",[ACCOUNT]],["chain","0x1"],["disconnect"]]);
  unsubscribe(); assert.deepEqual(removed.map(([event])=>event),["accountsChanged","chainChanged","disconnect"]);
});

test("forgetSession removes only the wallet session key", () => {
  const memory = storage(); memory.setItem(SESSION_KEY,"saved"); memory.setItem("other","keep"); forgetSession(memory);
  assert.equal(memory.getItem(SESSION_KEY),null); assert.equal(memory.getItem("other"),"keep");
});
