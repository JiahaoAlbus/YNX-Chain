import test from "node:test";
import assert from "node:assert/strict";
import {createHash, webcrypto} from "node:crypto";
import {readFile} from "node:fs/promises";
import {connectVideoWallet,createStandardWalletConnectState,createWalletProviderRegistry,discoverWalletCandidates,listCandidatesFromWindow,reduceStandardWalletConnectState,requestWalletAccountSwitch,restoreVideoWallet,revokeWalletPermissions,SHARED_PROVIDER_AUTHORITY,STANDARD_WALLET_CONNECT_STATUS,WALLET_INSTALLATION_OPTIONS} from "./wallet-connection.js";

const read=name=>readFile(new URL(name,import.meta.url),"utf8");
const sha=value=>createHash("sha256").update(value).digest("hex");
const ACCOUNT_A="0x1111111111111111111111111111111111111111";
const ACCOUNT_B="0x2222222222222222222222222222222222222222";
class BrowserScope extends EventTarget { Event=Event; crypto=webcrypto; }
function announce(scope,{uuid,name,rdns,icon="",provider}){scope.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid,name,rdns,icon},provider}}));}

test("viewer exposes connection details without custom-scheme or blank-tab launchers",async()=>{
  const html=await read("index.html"),js=await read("app.js");
  for(const term of ["Connect Wallet","Subscriptions","Playlists","History","Comments","Guest playback"])assert.match(html,new RegExp(term,"i"));
  for(const term of ["Wallet connection details","Switch account","Disconnect","accountsChanged","chainChanged"])assert.match(js,new RegExp(term));
  for(const path of ["/watch","/comments","/reports","/subscription","/playlists","/history"])assert.match(js,new RegExp(path));
  assert.doesNotMatch(js,/window\.open|about:blank|ynxwallet:|target\s*=\s*["']_blank/i);
  assert.doesNotMatch(html,/target\s*=\s*["']_blank|ynxwallet:/i);
  assert.doesNotMatch(js,/Math\.random|fake views/i);
});

test("accepted SDK and shared Provider authority remain exact",async()=>{
  const manifest=JSON.parse(await read("ynx-dapp-connect-sdk/manifest.json"));
  for(const [file,expected] of Object.entries(manifest.files))assert.equal(sha(await read("ynx-dapp-connect-sdk/"+file)),expected,file);
  assert.equal(manifest.acceptedSdkSource,"315897e75c0ffe3e63435fe73cfec42244b851cc");
  assert.equal(manifest.productSessionIncluded,false);
  assert.equal(SHARED_PROVIDER_AUTHORITY.sourceCommit,"98c6d5d784d212df8981a53b17118a511e246ad2");
  assert.equal(SHARED_PROVIDER_AUTHORITY.sourceTree,"51a60a362d4ad5dd748bcdefb101f71b1d9e0cee");
});

test("YNX and MetaMask identities remain distinct and retain announced logos and RDNS",()=>{
  const candidates=listCandidatesFromWindow(new BrowserScope(),[
    {info:{uuid:"11111111-1111-4111-8111-111111111111",name:"YNX Wallet",rdns:"com.ynx.wallet",icon:"data:image/png;base64,eW54"},provider:{isYNXWallet:true,request:async()=>[]}},
    {info:{uuid:"22222222-2222-4222-8222-222222222222",name:"MetaMask",rdns:"io.metamask",icon:"data:image/png;base64,bW0="},provider:{isMetaMask:true,request:async()=>[]}},
  ]);
  assert.deepEqual(candidates.map(c=>[c.label,c.rdns,c.isYNXWallet,c.isMetaMask,c.icon]),[["YNX Wallet","com.ynx.wallet",true,false,"data:image/png;base64,eW54"],["MetaMask","io.metamask",false,true,"data:image/png;base64,bW0="]]);
});

test("late injection after 160ms is discovered by bounded rediscovery",async()=>{
  const scope=new BrowserScope(),provider={isMetaMask:true,request:async()=>[]};
  let installed=false;
  scope.addEventListener("eip6963:requestProvider",()=>{if(installed)announce(scope,{uuid:"33333333-3333-4333-8333-333333333333",name:"MetaMask",rdns:"io.metamask",provider});});
  const registry=createWalletProviderRegistry(scope,{scheduleMs:[0,50,100,200],deadlineMs:260});
  setTimeout(()=>{installed=true;scope.dispatchEvent(new Event("ethereum#initialized"));},160);
  const candidates=await registry.wait(235); registry.stop();
  assert.equal(candidates.length,1); assert.equal(candidates[0].label,"MetaMask");
});

test("explicit connection requests approval and switches to exact 0x1917",async()=>{
  const scope=new BrowserScope(); let chainId="0x1"; const calls=[];
  const provider={isYNXWallet:true,request:async({method})=>{calls.push(method);if(method==="eth_requestAccounts")return[ACCOUNT_A];if(method==="eth_chainId")return chainId;if(method==="wallet_switchEthereumChain"){chainId="0x1917";return null;}throw new Error("unexpected "+method);}};
  scope.addEventListener("eip6963:requestProvider",()=>announce(scope,{uuid:"11111111-1111-4111-8111-111111111111",name:"YNX Wallet",rdns:"com.ynx.wallet",provider}));
  const result=await connectVideoWallet(scope,{timeoutMs:5});
  assert.equal(result.standardConnection,"CONNECTED"); assert.equal(result.productSession,"PRIVATE_SERVICE_DEGRADED"); assert.equal(result.account,ACCOUNT_A); assert.equal(result.chainId,"0x1917");
  assert.deepEqual(calls.slice(0,3),["eth_requestAccounts","eth_chainId","wallet_switchEthereumChain"]);
});

test("restore is read-only and account switch plus revoke remain explicit",async()=>{
  const scope=new BrowserScope(),calls=[];
  const provider={isMetaMask:true,request:async({method})=>{calls.push(method);if(method==="eth_accounts")return calls.includes("wallet_requestPermissions")?[ACCOUNT_B]:[ACCOUNT_A];if(method==="eth_chainId")return"0x1917";if(method==="wallet_requestPermissions"||method==="wallet_revokePermissions")return[];throw new Error("unexpected "+method);}};
  scope.addEventListener("eip6963:requestProvider",()=>announce(scope,{uuid:"22222222-2222-4222-8222-222222222222",name:"MetaMask",rdns:"io.metamask",provider}));
  const restored=await restoreVideoWallet(scope,{walletId:"22222222-2222-4222-8222-222222222222"});
  assert.equal(restored.account,ACCOUNT_A); assert.equal(calls.includes("eth_requestAccounts"),false);
  assert.equal(await requestWalletAccountSwitch(provider),ACCOUNT_B);
  assert.deepEqual(await revokeWalletPermissions(provider),{providerRevoked:true,localDisconnected:true});
});

test("no-provider terminal state clears connection and chooser",()=>{
  let state=reduceStandardWalletConnectState(createStandardWalletConnectState(),{type:"BEGIN",pendingIntent:"abcdefghijklmnop"});
  state=reduceStandardWalletConnectState(state,{type:"PROVIDER_SELECTED",providerKind:"metamask"});
  state=reduceStandardWalletConnectState(state,{type:"NO_PROVIDER"});
  assert.equal(state.status,STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED);
  for(const key of ["providerKind","account","chainId","pendingIntent"])assert.equal(state[key],null);
  assert.equal(state.chooserOpen,false);
});

test("missing Wallet reports exact official installation choices",async()=>{
  const scope=new BrowserScope();
  await assert.rejects(discoverWalletCandidates(scope,{timeoutMs:1}),error=>error.code==="PROVIDER_NOT_INJECTED"&&error.details.ynxWallet===WALLET_INSTALLATION_OPTIONS.ynxWallet&&error.details.metaMask===WALLET_INSTALLATION_OPTIONS.metaMask);
  assert.equal(WALLET_INSTALLATION_OPTIONS.ynxWallet,"https://www.ynxweb4.com/dapp/download");
  assert.equal(WALLET_INSTALLATION_OPTIONS.metaMask,"https://metamask.io/download/");
});
