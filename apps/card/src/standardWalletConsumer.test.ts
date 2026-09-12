import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {discoverWalletProviders,isSharedWalletProvider} from "./standardWalletSdk";
import {connectMetaMaskWallet,disconnectEip1193Wallet,restoreEip1193Wallet,watchEip1193Provider} from "./wallet";

const account="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const other="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
function provider(kind:"metamask"|"ynx-wallet") {
  const handlers=new Map<string,Set<(...args:readonly unknown[])=>void>>(),calls:string[]=[];
  let accounts=[account],chain="0x1917";
  const wallet={
    isMetaMask:kind==="metamask",isYNXWallet:kind==="ynx-wallet",
    providerInfo:{rdns:kind==="metamask"?"io.metamask":"com.ynx.wallet",name:kind==="metamask"?"MetaMask":"YNX Wallet"},
    on(event:string,listener:(...args:readonly unknown[])=>void){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event)!.add(listener);},
    removeListener(event:string,listener:(...args:readonly unknown[])=>void){handlers.get(event)?.delete(listener);},
    request:async({method}:{method:string}):Promise<unknown>=>{calls.push(method);if(method==="eth_accounts"||method==="eth_requestAccounts")return [...accounts];if(method==="eth_chainId")return chain;if(method==="wallet_revokePermissions"){accounts=[];return null;}throw{code:4200};},
  };
  return{wallet,calls,emit(event:string,value?:unknown){if(event==="accountsChanged")accounts=value as string[];if(event==="chainChanged")chain=value as string;for(const handler of [...handlers.get(event)??[]])handler(value);}};
}

test("Card consumes the exact self-contained Wallet Owner artifact",()=>{
  const bytes=readFileSync(new URL("./vendor/wallet-standard-c97f85e9/standard-wallet-browser.mjs",import.meta.url));
  assert.equal(bytes.length,22417);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43");
});

test("late EIP-6963 announcement and injected providers preserve distinct identities without account requests",async()=>{
  const target=new EventTarget(),ynx=provider("ynx-wallet"),metamask=provider("metamask");
  assert.equal((await discoverWalletProviders(target,0)).ynx,null);
  target.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{uuid:"817b4cac-4614-40bd-a5dc-3838fa26a278",...ynx.wallet.providerInfo},provider:ynx.wallet}}));
  const found=await discoverWalletProviders(target,0);
  assert.equal(found.ynx?.provider,ynx.wallet);assert.equal(found.metamask,null);
  assert.equal(isSharedWalletProvider(ynx.wallet,"ynx-wallet"),true);
  assert.equal(isSharedWalletProvider(ynx.wallet,"metamask"),false);
  assert.equal((await discoverWalletProviders({ethereum:metamask.wallet},0)).metamask?.provider,metamask.wallet);
  assert.deepEqual([...ynx.calls,...metamask.calls],[]);
});

test("shared discovery rejects ambiguous MetaMask and a dual-brand provider",async()=>{
  const first=provider("metamask"),second=provider("metamask");
  const found=await discoverWalletProviders({ethereum:{providers:[first.wallet,second.wallet]}},0);
  assert.equal(found.metamask,null);assert.deepEqual(found.ambiguities,["metamask"]);
  assert.equal(isSharedWalletProvider({...first.wallet,isYNXWallet:true},"metamask"),false);
  assert.equal(isSharedWalletProvider({...first.wallet,isYNXWallet:true},"ynx-wallet"),false);
});

test("both selected providers restore without prompts and deliver SDK account/chain/disconnect events",async()=>{
  for(const kind of ["metamask","ynx-wallet"] as const){
    const fixture=provider(kind),seen:unknown[]=[];
    assert.equal((await restoreEip1193Wallet(fixture.wallet,kind))?.address,account);
    assert.deepEqual(fixture.calls,["eth_accounts","eth_chainId"]);
    const stop=watchEip1193Provider(fixture.wallet,kind,{accountsChanged:value=>seen.push(value),chainChanged:value=>seen.push(value),disconnect:()=>seen.push("disconnect")});
    fixture.emit("accountsChanged",[other]);fixture.emit("chainChanged","0x1");fixture.emit("disconnect",{code:4900,message:"Disconnected"});
    stop();assert.deepEqual(seen,[[other],"0x1","disconnect"]);
  }
});

test("permission revoke needs empty-account readback and is not a local-only success",async()=>{
  const fixture=provider("metamask");
  await restoreEip1193Wallet(fixture.wallet,"metamask");
  assert.equal(await disconnectEip1193Wallet(fixture.wallet,"metamask"),"revoked");
  assert.equal(await restoreEip1193Wallet(fixture.wallet,"metamask"),null);
  assert.equal(fixture.calls.includes("eth_requestAccounts"),false);
});

test("a rejected connection retains the exact provider error and creates no account",async()=>{
  const fixture=provider("metamask");
  fixture.wallet.request=async({method})=>{fixture.calls.push(method);if(method==="eth_requestAccounts")throw{code:4001,message:"Rejected"};throw new Error("No read should follow rejection");};
  await assert.rejects(connectMetaMaskWallet(new Date(),fixture.wallet),error=>(error as {code?:unknown}).code===4001);
  assert.deepEqual(fixture.calls,["eth_requestAccounts"]);
});
