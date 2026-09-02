import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function runPageProvider({ethereum} = {}) {
  const listeners = new Map();
  const announcements = [];
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const context = {
    location: {origin:"https://app.uniswap.org",protocol:"https:"},
    ethereum,
    crypto: {randomUUID: () => "11111111-1111-4111-8111-111111111111"},
    CustomEvent,
    Event: CustomEvent,
    queueMicrotask: (callback) => callback(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) {
      if (event.type === "eip6963:announceProvider") announcements.push(event.detail);
      listeners.get(event.type)?.(event);
      return true;
    },
    postMessage() {},
  };
  context.window = context;
  context.globalThis = context;
  const source = await readFile(new URL("../extension/page-provider.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context, {filename:"page-provider.js"});
  return {context, listeners, announcements};
}

test("sealed legacy MetaMask provider cannot suppress YNX EIP-6963 announcement", async () => {
  const metaMask = Object.freeze({isMetaMask:true,request() {}});
  const ethereum = Object.freeze({isMetaMask:true,providers:Object.freeze([metaMask])});
  const {announcements, context, listeners} = await runPageProvider({ethereum});
  assert.equal(context.ethereum, ethereum);
  assert.equal(announcements.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(announcements[0].info)), {
    uuid:"6f4e2a77-7878-4f29-9c0d-191700000001",
    name:"YNX Wallet",
    icon:"__YNX_PROVIDER_ICON_DATA_URI__",
    rdns:"com.ynx.wallet",
  });
  assert.equal(announcements[0].provider.isYNXWallet, true);
  assert.equal(announcements[0].provider.isMetaMask, false);
  listeners.get("eip6963:requestProvider")?.({type:"eip6963:requestProvider"});
  assert.equal(announcements.length, 2);
});

test("provider uses window.ethereum only as a best-effort legacy compatibility surface", async () => {
  const {context, announcements} = await runPageProvider();
  assert.equal(context.ethereum.isYNXWallet, true);
  assert.equal(announcements.length, 1);
});
