import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {connectVideoWallet,restoreVideoWallet,discoverWalletCandidates,WALLET_INSTALLATION_OPTIONS} from "./wallet-connection.js";
import {YNX_TESTNET} from "./ynx-dapp-connect-sdk/constants.js";

const read=name=>readFile(new URL(name,import.meta.url),"utf8");
const sha=value=>createHash("sha256").update(value).digest("hex");

const restoreAccount="0x1111111111111111111111111111111111111111";
const savedRestore={walletId:"restore-ynx",account:restoreAccount,walletName:"YNX Wallet"};
function restoreBrowser(provider,uuid="restore-ynx") {
  const browser=new EventTarget();
  browser.addEventListener("eip6963:requestProvider",()=>browser.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid,name:"YNX Wallet",rdns:"com.ynx.wallet"},provider}})));
  return browser;
}

test("removed or absent Wallet cannot reject guest startup",async()=>{
  assert.equal(await restoreVideoWallet(savedRestore,new EventTarget(),{timeoutMs:1}),null);
  assert.equal(await restoreVideoWallet(null,new EventTarget(),{timeoutMs:1}),null);
  assert.equal(await restoreVideoWallet({...savedRestore,account:42},new EventTarget(),{timeoutMs:1}),null);
});

test("restore binds provider method receiver and performs read-only calls",async()=>{
  const methods=[];
  const provider={request:async function({method}){assert.equal(this,provider);methods.push(method);return method==="eth_accounts"?[restoreAccount]:"0x1917"}};
  const state=await restoreVideoWallet(savedRestore,restoreBrowser(provider),{timeoutMs:1});
  assert.equal(state?.account,restoreAccount);
  assert.equal(state?.chainId,"0x1917");
  assert.equal(state?.productSession,"PRIVATE_SERVICE_DEGRADED");
  assert.deepEqual(methods,["eth_accounts","eth_chainId"]);
});

test("same-label replacement provider is not silently restored",async()=>{
  let calls=0;
  const provider={request:async()=>{calls++;return [restoreAccount]}};
  assert.equal(await restoreVideoWallet(savedRestore,restoreBrowser(provider,"replacement-uuid"),{timeoutMs:1}),null);
  assert.equal(calls,0);
});

test("locked, switched-account and wrong-chain providers leave restore disconnected",async()=>{
  for(const [accounts,chain] of [[[],"0x1917"],[["0x2222222222222222222222222222222222222222"],"0x1917"],[[restoreAccount],"0x1"]]){
    const provider={request:async({method})=>method==="eth_accounts"?accounts:chain};
    assert.equal(await restoreVideoWallet(savedRestore,restoreBrowser(provider),{timeoutMs:1}),null);
  }
});

test("stalled and rejected provider reads cannot indefinitely block guest startup",async()=>{
  for(const request of [()=>new Promise(()=>{}),async()=>{throw new Error("Provider locked")}]){
    assert.equal(await restoreVideoWallet(savedRestore,restoreBrowser({request}),{timeoutMs:1,requestTimeoutMs:5}),null);
  }
});

test("viewer exposes complete truthful interaction paths",async()=>{
  const html=await read("index.html"),js=await read("app.js");
  for(const term of ["Sign in with YNX Wallet","Subscriptions","Playlists","History","Comments","Guest playback"])assert.match(html,new RegExp(term,"i"));
  for(const path of ["/watch","/comments","/reports","/subscription","/playlists","/history"])assert.match(js,new RegExp(path));
  assert.match(js,/connectVideoWallet/);
  assert.match(js,/Product Session v2/);
  assert.match(js,/Published videos will appear here/);
  assert.doesNotMatch(js,/walletAuthorizationURL|ynx-video-web-v1|chain_id=6423|authorize\\?client=/);
  assert.doesNotMatch(js,/Math\\.random|fake views/i);
  assert.match(html,/href="\.\//);
  assert.match(html,/assets\/ynx-logo\.svg/);
  assert.doesNotMatch(html,/ynxwallet:\/\/|ynxvideo:\/\//i);
});

test("accepted browser-safe SDK modules remain byte exact",async()=>{
  const manifest=JSON.parse(await read("ynx-dapp-connect-sdk/manifest.json"));
  for(const [file,expected] of Object.entries(manifest.files))assert.equal(sha(await read("ynx-dapp-connect-sdk/"+file)),expected,file);
  assert.equal(manifest.acceptedSdkSource,"315897e75c0ffe3e63435fe73cfec42244b851cc");
  assert.equal(manifest.productSessionIncluded,false);
});

test("Video has one strict 6423 Testnet configuration and excludes legacy ingress",async()=>{
  assert.deepEqual(YNX_TESTNET,{cosmosChainId:"ynx_6423-1",evmChainId:6423,evmChainHex:"0x1917",nativeAsset:"YNXT",externalAccountFormat:"0x-prefixed EVM account only"});
  for(const file of ["app.js","wallet-connection.js","ynx-dapp-connect-sdk/constants.js","product-release.json"]){
    const source=await read(file);
    assert.doesNotMatch(source,/9102|0x238e/i,`${file} retains a legacy chain ingress`);
  }
});

test("YNX EIP-6963 provider is preferred and switches to 0x1917",async()=>{
  const browser=new EventTarget();
  let chainId="0x1";
  const calls=[];
  const provider={request:async({method})=>{
    calls.push(method);
    if(method==="eth_requestAccounts")return ["0x1111111111111111111111111111111111111111"];
    if(method==="eth_chainId")return chainId;
    if(method==="wallet_switchEthereumChain"){chainId="0x1917";return null}
    throw new Error("unexpected "+method);
  }};
  browser.addEventListener("eip6963:requestProvider",()=>browser.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"ynx-1",name:"YNX Wallet",rdns:"com.ynx.wallet"},provider}})));
  const result=await connectVideoWallet(browser,{timeoutMs:1});
  assert.equal(result.standardConnection,"CONNECTED");
  assert.equal(result.productSession,"PRIVATE_SERVICE_DEGRADED");
  assert.equal(result.account,"0x1111111111111111111111111111111111111111");
  assert.equal(result.chainId,"0x1917");
  assert.equal(result.walletName,"YNX Wallet");
  assert.ok(calls.includes("wallet_switchEthereumChain"));
});

test("missing Wallet fails with exact official installation choices",async()=>{
  const browser=new EventTarget();
  await assert.rejects(connectVideoWallet(browser,{timeoutMs:1}),error=>error.code==="WALLET_NOT_INSTALLED"&&error.details.ynxWallet===WALLET_INSTALLATION_OPTIONS.ynxWallet&&error.details.metaMask===WALLET_INSTALLATION_OPTIONS.metaMask);
  assert.equal(WALLET_INSTALLATION_OPTIONS.ynxWallet,"https://www.ynxweb4.com/dapp/download");
  assert.equal(WALLET_INSTALLATION_OPTIONS.metaMask,"https://metamask.io/download/");
});

test("late YNX and MetaMask providers remain distinct without requesting accounts",async()=>{
  const browser=new EventTarget();
  let accountRequests=0;
  const ynx={request:async({method})=>{if(method==="eth_requestAccounts")accountRequests++;return []},isYNXWallet:true};
  const metamask={request:async({method})=>{if(method==="eth_requestAccounts")accountRequests++;return []},isMetaMask:true};
  setTimeout(()=>browser.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"ynx-late",name:"YNX Wallet",rdns:"com.ynx.wallet"},provider:ynx}})),5);
  setTimeout(()=>browser.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"metamask-late",name:"MetaMask",rdns:"io.metamask",icon:"data:image/svg+xml,%3Csvg/%3E"},provider:metamask}})),7);
  const candidates=await discoverWalletCandidates(browser,{timeoutMs:20});
  assert.equal(candidates.length,2);
  assert.equal(candidates.find(item=>item.info.uuid==="ynx-late")?.isYNXWallet,true);
  assert.equal(candidates.find(item=>item.info.uuid==="ynx-late")?.isMetaMask,false);
  assert.equal(candidates.find(item=>item.info.uuid==="metamask-late")?.isMetaMask,true);
  assert.equal(candidates.find(item=>item.info.uuid==="metamask-late")?.isYNXWallet,false);
  assert.notEqual(candidates[0].icon,candidates[1].icon);
  assert.equal(accountRequests,0);
});

test("late root injection and no-provider state are classified without navigation",async()=>{
  const browser=new EventTarget();
  const provider={request:async()=>[]};
  setTimeout(()=>{browser.ethereum={providers:[provider]};browser.dispatchEvent(new Event("ethereum#initialized"))},5);
  const candidates=await discoverWalletCandidates(browser,{timeoutMs:20});
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].provider,provider);
  const emptyBrowser=new EventTarget();
  await assert.rejects(discoverWalletCandidates(emptyBrowser,{timeoutMs:1}),error=>error.code==="WALLET_NOT_INSTALLED");
});
