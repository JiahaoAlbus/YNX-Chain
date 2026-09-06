import assert from "node:assert/strict";
import test from "node:test";
import {
  METAMASK_DOWNLOAD_URL, SESSION_KEY, WALLET_DOWNLOAD_MATRIX, WalletWebError, YNX_CHAIN, YNX_DOWNLOAD_URL,
  addYNXChain, connectStandardWallet, connectWallet, createExtensionProvider, discoverEip6963, discoverInjectedProviders, discoverWallets, extensionWalletAvailability,
  forgetSession, readRememberedSession, rememberSession, resolveRememberedWallet,
  invalidatesConnectedSession, restoreTestnetSession, sendTransaction, signMessage, subscribeProviderLifecycle,
  switchToYNXChain, verifyTestnetRpc, walletActionGates, walletDiscoveryPresentation,
} from "../src/provider.js";
import {
  canonicalYNXAuthorizationState, isMobileWalletBrowser, metaMaskMobileDappUrl, mobileWalletPresentation,
} from "../src/mobile-wallet-routing.js";

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

function extensionRuntime(responses = {}) {
  const messages = [];
  return {
    messages,
    async sendMessage(message) {
      messages.push(message);
      const method = message.input?.method;
      const response = responses[method];
      if (typeof response === "function") return response(message);
      return response ?? {ok:false,error:{code:"PROVIDER_REQUEST_FAILED",message:`unexpected ${method}`}};
    },
  };
}

test("frozen chain metadata is exact and complete", () => {
  assert.deepEqual(YNX_CHAIN, {chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:{name:"YNX Testnet",symbol:"YNXT",decimals:18},rpcUrls:["https://evm.ynxweb4.com"],blockExplorerUrls:["https://explorer.ynxweb4.com"]});
});

test("injected discovery prefers YNX and keeps MetaMask explicit", () => {
  const ynx = Object.assign(provider(), {isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"}});
  const metamask = Object.assign(provider(), {isMetaMask:true});
  const result = discoverInjectedProviders({ethereum:{providers:[metamask,ynx]}});
  assert.equal(result.ynx, ynx); assert.equal(result.metamask, metamask); assert.equal(result.any, ynx);
});

test("provider identity does not trust an arbitrary rdns substring", () => {
  const spoofed = Object.assign(provider(),{isMetaMask:true,providerInfo:{rdns:"com.ynx.fixture.metamask"}});
  const ynx = Object.assign(provider(),{isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"}});
  const result = discoverInjectedProviders({ethereum:{providers:[spoofed,ynx]}});
  assert.equal(result.ynx,ynx);assert.equal(result.metamask,spoofed);
});

test("discovery presentation directly prefers YNX and gives two non-empty fallbacks", () => {
  assert.deepEqual(walletDiscoveryPresentation({ynx:provider(),metamask:provider(),exactExtensionStateObservable:true}),{ynxPresent:true,metamaskPresent:true,showYNXConnect:true,showYNXDownload:false,showMetaMaskChoice:false,metaMaskChoice:"connect",status:"available",errorKey:null,exactExtensionStateObservable:true});
  assert.deepEqual(walletDiscoveryPresentation({ynx:null,metamask:provider(),exactExtensionStateObservable:true}),{ynxPresent:false,metamaskPresent:true,showYNXConnect:false,showYNXDownload:true,showMetaMaskChoice:true,metaMaskChoice:"connect",status:"available",errorKey:null,exactExtensionStateObservable:true});
  assert.deepEqual(walletDiscoveryPresentation({}),{ynxPresent:false,metamaskPresent:false,showYNXConnect:false,showYNXDownload:true,showMetaMaskChoice:true,metaMaskChoice:"official-download",status:"no-provider",errorKey:"providerNotInjected",exactExtensionStateObservable:false});
  assert.equal(new URL(YNX_DOWNLOAD_URL).hostname,"www.ynxweb4.com");
  assert.equal(METAMASK_DOWNLOAD_URL,"https://metamask.io/download");
});

test("EIP-6963 discovers exact YNX and MetaMask announcements including late injection", async () => {
  const listeners=new Map();
  const ynx=Object.assign(provider(),{isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"}});
  const metamask=Object.assign(provider(),{isMetaMask:true});
  let dispatches=0;
  class TestEvent { constructor(type){this.type=type;} }
  const scope={Event:TestEvent,document:{readyState:"complete"},addEventListener(type,listener){listeners.set(type,listener)},removeEventListener(type){listeners.delete(type)},dispatchEvent(event){
    if(event.type!=="eip6963:requestProvider")return true;
    dispatches+=1;
    if(dispatches===2)listeners.get("eip6963:announceProvider")?.({detail:{info:{uuid:"11111111-1111-4111-8111-111111111111",rdns:"com.ynx.wallet",name:"YNX Wallet"},provider:ynx}});
    if(dispatches===3)listeners.get("eip6963:announceProvider")?.({detail:{info:{uuid:"22222222-2222-4222-8222-222222222222",rdns:"io.metamask",name:"MetaMask"},provider:metamask}});
    return true;
  }};
  const announced=await discoverEip6963(scope,4);
  assert.deepEqual(announced.map(({info})=>info.rdns),["com.ynx.wallet","io.metamask"]);
  dispatches=0;
  const result=await discoverWallets(scope);
  assert.equal(result.ynx,ynx);assert.equal(result.metamask,metamask);assert.equal(result.status,"available");
});

test("repeated EIP-6963 requests deduplicate providers and retain YNX versus MetaMask identity",async()=>{
  const listeners=new Map(),ynx=Object.assign(provider(),{isYNXWallet:true,isMetaMask:false,providerInfo:{rdns:"com.ynx.wallet"}}),metamask=Object.assign(provider(),{isMetaMask:true,isYNXWallet:false});
  class TestEvent{constructor(type){this.type=type}}
  const scope={Event:TestEvent,document:{readyState:"complete"},addEventListener(type,listener){listeners.set(type,listener)},removeEventListener(type){listeners.delete(type)},dispatchEvent(event){if(event.type!=="eip6963:requestProvider")return true;for(let repeat=0;repeat<2;repeat++){listeners.get("eip6963:announceProvider")?.({detail:{info:{uuid:"11111111-1111-4111-8111-111111111111",rdns:"com.ynx.wallet",name:"YNX Wallet"},provider:ynx}});listeners.get("eip6963:announceProvider")?.({detail:{info:{uuid:"22222222-2222-4222-8222-222222222222",rdns:"io.metamask",name:"MetaMask"},provider:metamask}})}return true}};
  const announced=await discoverEip6963(scope,2);
  assert.equal(announced.length,2);
  const result=await discoverWallets(scope);
  assert.equal(result.ynx,ynx);assert.equal(result.metamask,metamask);
  assert.equal(result.ynx.isMetaMask,false);assert.equal(result.metamask.isYNXWallet,false);
});

test("ethereum.providers fallback observes delayed injection without inventing installation state",async()=>{
  const ethereum={providers:[]},ynx=Object.assign(provider(),{isYNXWallet:true,isMetaMask:false,providerInfo:{rdns:"com.ynx.wallet"}});
  const scope={ethereum,Event:class{constructor(type){this.type=type}},document:{readyState:"complete"},addEventListener(){},removeEventListener(){},dispatchEvent(){ethereum.providers.push(ynx);return true}};
  const result=await discoverWallets(scope);
  assert.equal(result.ynx,ynx);assert.equal(result.classification,"available");assert.equal(result.exactExtensionStateObservable,true);
});

test("no-provider locked and site-access-denied classifications require explicit diagnostics",async()=>{
  const scope={Event:class{constructor(type){this.type=type}},document:{readyState:"complete"},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}};
  const absent=await discoverWallets(scope),locked=await discoverWallets(scope,{extensionInstalled:true,extensionLocked:true}),denied=await discoverWallets(scope,{extensionInstalled:true,siteAccessDenied:true});
  assert.deepEqual({status:absent.status,observable:absent.exactExtensionStateObservable,error:walletDiscoveryPresentation(absent).errorKey},{status:"no-provider",observable:false,error:"providerNotInjected"});
  assert.deepEqual({status:locked.status,observable:locked.exactExtensionStateObservable,error:walletDiscoveryPresentation(locked).errorKey},{status:"extension-locked",observable:true,error:"walletLocked"});
  assert.deepEqual({status:denied.status,observable:denied.exactExtensionStateObservable,error:walletDiscoveryPresentation(denied).errorKey},{status:"site-access-denied",observable:true,error:"siteAccessDenied"});
});

test("mobile discovery separates unavailable canonical YNX auth from MetaMask dapp routing", () => {
  assert.equal(metaMaskMobileDappUrl(),"https://metamask.app.link/dapp/www.ynxweb4.com/dapp/wallet");
  assert.deepEqual(mobileWalletPresentation({},true),{
    ynxRoute:"canonical-auth-unavailable",metaMaskRoute:"mobile-dapp",
    metaMaskHref:"https://metamask.app.link/dapp/www.ynxweb4.com/dapp/wallet",
    canonicalYNXAuthAvailable:false,
  });
  assert.deepEqual(mobileWalletPresentation({},false),{
    ynxRoute:"hidden",metaMaskRoute:"official-download",metaMaskHref:"https://metamask.io/download",canonicalYNXAuthAvailable:false,
  });
});

test("real injected providers remain the only connect routes on mobile", () => {
  assert.deepEqual(mobileWalletPresentation({ynx:provider(),metamask:provider()},true),{
    ynxRoute:"injected-provider",metaMaskRoute:"injected-provider",metaMaskHref:null,canonicalYNXAuthAvailable:false,
  });
});

test("mobile browser detection covers phone and iPad desktop UA without affecting desktop", () => {
  assert.equal(isMobileWalletBrowser({userAgent:"Mozilla/5.0 (Linux; Android 16) AppleWebKit Mobile"}),true);
  assert.equal(isMobileWalletBrowser({userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)"}),true);
  assert.equal(isMobileWalletBrowser({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",maxTouchPoints:5}),true);
  assert.equal(isMobileWalletBrowser({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",maxTouchPoints:0}),false);
});

test("canonical YNX mobile authorization stays closed until Core freezes the exact HTTPS callback", () => {
  const unavailable={enabled:false,reviewState:"pending-review",webCallbacks:[]};
  assert.deepEqual(canonicalYNXAuthorizationState(unavailable),{route:"canonical-auth-unavailable",available:false,callback:null,error:"CANONICAL_AUTH_UNAVAILABLE"});
  const wrongCallback={enabled:true,reviewState:"approved",webCallbacks:["https://evil.example/wallet-auth/callback"]};
  assert.equal(canonicalYNXAuthorizationState(wrongCallback).available,false);
  const frozen={enabled:true,reviewState:"approved",webCallbacks:["https://www.ynxweb4.com/wallet-auth/callback"]};
  assert.equal(canonicalYNXAuthorizationState(frozen).available,false);
  assert.deepEqual(canonicalYNXAuthorizationState(frozen,"https://www.ynxweb4.com/wallet-auth/callback"),{route:"canonical-auth",available:true,callback:"https://www.ynxweb4.com/wallet-auth/callback",error:null});
});

test("official platform matrix exposes only the verified Android route", () => {
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.hosted,true);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.url,YNX_DOWNLOAD_URL);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.bytes,78392878);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.sha256,"fd924ef853cf17d42ca2d36504528ef879c73fcb4b01ea72b1bfe7ae85085fef");
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.contentType,"application/vnd.android.package-archive");
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.productionSigned,false);
  assert.equal(new URL(YNX_DOWNLOAD_URL).hostname,"www.ynxweb4.com");
  for(const [platform,item] of Object.entries(WALLET_DOWNLOAD_MATRIX))if(platform!=="android")assert.deepEqual({url:item.url,hosted:item.hosted},{url:null,hosted:false});
  assert.equal(WALLET_DOWNLOAD_MATRIX.pwaPackage.publicStatusUrl,"https://www.ynxweb4.com/dapp/wallet");
});

test("extension discovery propagates runtime failure and rejects malformed responses", async () => {
  await assert.rejects(() => extensionWalletAvailability({sendMessage:async()=>({ynx:false,metamask:false,error:{code:"MIGRATION_INCOMPLETE",message:"cleanup failed"}})}), (error) => error.code === "MIGRATION_INCOMPLETE");
  for (const response of [null,{}, {ynx:true}, {ynx:1,metamask:false}]) await assert.rejects(() => extensionWalletAvailability({sendMessage:async()=>response}), (error) => error.code === "INVALID_DISCOVERY_RESPONSE");
  assert.deepEqual(await extensionWalletAvailability({sendMessage:async()=>({ynx:true,metamask:false})}),{ynx:true,metamask:false});
});

test("optional CORS-safe RPC probe accepts only exact YNX Testnet and is not connection authority", async () => {
  await assert.rejects(()=>verifyTestnetRpc(rpc),(error)=>error.code==="UNSAFE_BROWSER_RPC_PROBE");
  const evidence = await verifyTestnetRpc(rpc,YNX_CHAIN.rpcUrls[0],{probeTransport:"accepted-cors-safe"});
  assert.equal(evidence.chainId, "0x1917"); assert.equal(evidence.source, "https://evm.ynxweb4.com");
  await assert.rejects(() => verifyTestnetRpc(async()=>({ok:true,json:async()=>({jsonrpc:"2.0",id:1,result:"0x1"})}),YNX_CHAIN.rpcUrls[0],{probeTransport:"accepted-cors-safe"}), (error) => error instanceof WalletWebError && error.code === "WRONG_NETWORK");
});

test("RPC verification rejects malformed, mismatched and error envelopes", async () => {
  for (const envelope of [
    null,
    {jsonrpc:"2.0",id:2,result:"0x1917"},
    {jsonrpc:"1.0",id:1,result:"0x1917"},
    {jsonrpc:"2.0",id:1,error:{code:-32603},result:"0x1917"},
    {jsonrpc:"2.0",id:1,result:6423},
  ]) await assert.rejects(() => verifyTestnetRpc(async()=>({ok:true,json:async()=>envelope}),YNX_CHAIN.rpcUrls[0],{probeTransport:"accepted-cors-safe"}), (error) => error.code === "INVALID_RPC_RESPONSE");
});

test("RPC recovery requires a new live 0x1917 response after an offline failure", async () => {
  let online = false;
  const recoveringRpc = async () => {
    if (!online) throw new Error("offline");
    return {ok:true,status:200,json:async()=>({jsonrpc:"2.0",id:1,result:"0x1917"})};
  };
  const options={probeTransport:"accepted-cors-safe"};
  await assert.rejects(() => verifyTestnetRpc(recoveringRpc,YNX_CHAIN.rpcUrls[0],options), (error) => error.code === "RPC_UNAVAILABLE");
  online = true;
  assert.equal((await verifyTestnetRpc(recoveringRpc,YNX_CHAIN.rpcUrls[0],options)).chainId,"0x1917");
});

test("connect success is bound to approval then provider chain confirmation", async () => {
  const wallet = provider({wallet_switchEthereumChain:null,eth_chainId:"0x1917",eth_requestAccounts:[ACCOUNT]});
  const session = await connectWallet(wallet);
  assert.deepEqual(session,{account:ACCOUNT,chainId:"0x1917"});
  assert.deepEqual(wallet.calls.map(({method})=>method),["eth_requestAccounts","eth_chainId"]);
  const result=await connectStandardWallet(provider({eth_requestAccounts:[ACCOUNT],eth_chainId:"0x1917"}),"ynx",{pendingIntent:"connect_1234567890abcdef"});
  assert.equal(result.connectState.status,"connected");assert.equal(result.connectState.chooserOpen,false);assert.equal(result.connectState.pendingIntent,null);assert.equal(result.connectState.focusRestoreTarget,"wallet-connect-trigger");
});

test("first MetaMask connect adds frozen YNX chain only after exact unknown-chain failure", async () => {
  let chainId="0x1",switches=0;
  const wallet=provider({
    eth_requestAccounts:[ACCOUNT],
    eth_chainId:()=>chainId,
    wallet_switchEthereumChain:()=>{switches+=1;if(switches===1)throw Object.assign(new Error("Unrecognized chain ID"),{code:4902});chainId="0x1917";return null},
    wallet_addEthereumChain:(input)=>{assert.deepEqual(input.params,[YNX_CHAIN]);return null},
  });
  const result=await connectStandardWallet(wallet,"metamask",{pendingIntent:"connect_1234567890abcdef"});
  assert.equal(result.connectState.status,"connected");
  assert.deepEqual(wallet.calls.map(({method})=>method),["eth_requestAccounts","eth_chainId","wallet_switchEthereumChain","wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
});

test("non-4902 switch rejection never adds a chain or fabricates connection", async () => {
  const wallet=provider({eth_requestAccounts:[ACCOUNT],eth_chainId:"0x1",wallet_switchEthereumChain:()=>{throw Object.assign(new Error("User rejected"),{code:4001})},wallet_addEthereumChain:null});
  await assert.rejects(()=>connectStandardWallet(wallet,"metamask",{pendingIntent:"connect_1234567890abcdef"}),(error)=>error.code===4001);
  assert.deepEqual(wallet.calls.map(({method})=>method),["eth_requestAccounts","eth_chainId","wallet_switchEthereumChain"]);
});

test("legacy nested unknown-chain error is accepted narrowly and still requires 0x1917 readback", async () => {
  let chainId="0x1";
  const wallet=provider({wallet_switchEthereumChain:()=>{if(chainId==="0x1")throw {code:-32603,message:"Unknown chain",data:{originalError:{code:4902}}};return null},wallet_addEthereumChain:()=>{chainId="0x2";return null},eth_chainId:()=>chainId});
  await assert.rejects(()=>switchToYNXChain(wallet),(error)=>error.code==="WRONG_NETWORK");
  assert.deepEqual(wallet.calls.map(({method})=>method),["wallet_switchEthereumChain","wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
});

test("add-chain uses frozen metadata and proves the switched chain", async () => {
  const wallet = provider({wallet_addEthereumChain:null,wallet_switchEthereumChain:null,eth_chainId:"0x1917"});
  await addYNXChain(wallet,{fetcher:rpc});
  assert.deepEqual(wallet.calls[0],{method:"wallet_addEthereumChain",params:[YNX_CHAIN]});
  assert.deepEqual(wallet.calls.map(({method})=>method),["wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
});

test("extension provider add-chain switches and proves exact 0x1917 through runtime messages", async () => {
  const runtime = extensionRuntime({
    wallet_addEthereumChain:{ok:true,result:null},
    wallet_switchEthereumChain:{ok:true,result:null},
    eth_chainId:{ok:true,result:"0x1917"},
  });
  assert.equal(await addYNXChain(createExtensionProvider("ynx",runtime),{fetcher:rpc}),"0x1917");
  assert.deepEqual(runtime.messages.map(({type,preference,input})=>[type,preference,input.method]),[
    ["YNX_WALLET_REQUEST","ynx","wallet_addEthereumChain"],
    ["YNX_WALLET_REQUEST","ynx","wallet_switchEthereumChain"],
    ["YNX_WALLET_REQUEST","ynx","eth_chainId"],
  ]);
  assert.deepEqual(runtime.messages[0].input.params,[YNX_CHAIN]);
});

test("extension provider switch rejects a wrong-chain result", async () => {
  const runtime = extensionRuntime({wallet_switchEthereumChain:{ok:true,result:null},eth_chainId:{ok:true,result:"0x1"}});
  await assert.rejects(() => switchToYNXChain(createExtensionProvider("metamask",runtime),{fetcher:rpc}), (error) => error.code === "WRONG_NETWORK");
  assert.deepEqual(runtime.messages.map(({input})=>input.method),["wallet_switchEthereumChain","eth_chainId"]);
});

test("extension disconnect invalidates restore and reconnect requires fresh runtime approval", async () => {
  let connected = false;
  const runtime = extensionRuntime({
    eth_chainId:()=>connected?{ok:true,result:"0x1917"}:{ok:false,error:{code:4900,message:"Provider disconnected"}},
    eth_accounts:()=>({ok:true,result:connected?[ACCOUNT]:[]}),
    wallet_switchEthereumChain:()=>connected?{ok:true,result:null}:{ok:false,error:{code:4900,message:"Provider disconnected"}},
    eth_requestAccounts:()=>({ok:true,result:connected?[ACCOUNT]:[]}),
  });
  const extensionProvider = createExtensionProvider("ynx",runtime);
  const memory = storage(); rememberSession({account:ACCOUNT,chainId:"0x1917"},"ynx",memory);
  assert.equal(await restoreTestnetSession(extensionProvider,memory),null);
  assert.equal(memory.getItem(SESSION_KEY),null);
  connected = true;
  assert.deepEqual(await connectWallet(extensionProvider,{fetcher:rpc}),{account:ACCOUNT,chainId:"0x1917"});
  assert.deepEqual(runtime.messages.slice(-2).map(({input})=>input.method),["eth_requestAccounts","eth_chainId"]);
});

test("extension sign and transaction require live account preflight before runtime mutation", async () => {
  const runtime = extensionRuntime({
    eth_chainId:{ok:true,result:"0x1917"},
    eth_accounts:{ok:true,result:[ACCOUNT]},
    personal_sign:{ok:true,result:SIGNATURE},
    eth_sendTransaction:{ok:true,result:TX_HASH},
  });
  const extensionProvider = createExtensionProvider("ynx",runtime);
  assert.equal(await signMessage(extensionProvider,ACCOUNT,"extension approval"),SIGNATURE);
  assert.deepEqual(runtime.messages.map(({input})=>input.method),["eth_chainId","eth_accounts","personal_sign"]);
  runtime.messages.length = 0;
  assert.equal(await sendTransaction(extensionProvider,{from:ACCOUNT,to:TO,value:"0x0",data:"0x"},{fetcher:rpc}),TX_HASH);
  assert.deepEqual(runtime.messages.map(({input})=>input.method),["eth_chainId","eth_accounts","eth_sendTransaction"]);
});

test("extension account replacement and user rejection never fabricate sensitive success", async () => {
  const replaced = extensionRuntime({eth_chainId:{ok:true,result:"0x1917"},eth_accounts:{ok:true,result:[TO]},personal_sign:{ok:true,result:SIGNATURE}});
  await assert.rejects(() => signMessage(createExtensionProvider("ynx",replaced),ACCOUNT,"stale"), (error) => error.code === "ACCOUNT_CHANGED");
  assert.deepEqual(replaced.messages.map(({input})=>input.method),["eth_chainId","eth_accounts"]);
  const rejected = extensionRuntime({eth_chainId:{ok:true,result:"0x1917"},eth_accounts:{ok:true,result:[ACCOUNT]},personal_sign:{ok:false,error:{code:4001,message:"User rejected"}}});
  await assert.rejects(() => signMessage(createExtensionProvider("ynx",rejected),ACCOUNT,"declined"), (error) => error.code === 4001);
  assert.equal(invalidatesConnectedSession({code:4001}),false);
});

test("network mutation is provider-authoritative and fails closed on wrong chain response", async () => {
  const wallet = provider({wallet_switchEthereumChain:null,eth_chainId:"0x1"});
  await assert.rejects(() => switchToYNXChain(wallet), (error) => error.code === "WRONG_NETWORK");
  assert.deepEqual(wallet.calls.map(({method})=>method),["wallet_switchEthereumChain","eth_chainId"]);
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
  assert.deepEqual(walletActionGates(provider(),ACCOUNT,"0x1",true),{canAddChain:true,canSwitchChain:true,canSign:false,canSendTransaction:false});
  assert.deepEqual(walletActionGates(provider(),ACCOUNT,"0x1917",true),{canAddChain:true,canSwitchChain:true,canSign:true,canSendTransaction:true});
});

test("network mutation never depends on a direct browser RPC probe", async () => {
  const wallet = provider({wallet_switchEthereumChain:null,eth_chainId:"0x1917"});
  assert.equal(walletActionGates(wallet,null,null,false).canSwitchChain,true);
  assert.equal(await switchToYNXChain(wallet,{fetcher:async()=>{throw new Error("must not be called")}}),"0x1917");
  assert.equal(walletActionGates(wallet,null,null,true).canSwitchChain,true);
  assert.deepEqual(wallet.calls.map(({method})=>method),["wallet_switchEthereumChain","eth_chainId"]);
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
