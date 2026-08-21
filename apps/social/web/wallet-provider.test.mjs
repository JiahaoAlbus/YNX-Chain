import assert from "node:assert/strict";
import test from "node:test";
import { connectWallet, selectProvider } from "./wallet-provider.js";

function target(details) {
  const listeners = new Map();
  return {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(event) {
      if (event.type === "eip6963:requestProvider") for (const detail of details) listeners.get("eip6963:announceProvider")?.({ detail });
    },
    setTimeout(callback) { callback(); },
  };
}

test("selects exact YNX and MetaMask providers without substitution", () => {
  const ynx = { info: { uuid: "ynx", name: "YNX Wallet", rdns: "com.ynx.wallet" }, provider: { isYNXWallet: true } };
  const metamask = { info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" }, provider: { isMetaMask: true } };
  assert.equal(selectProvider([ynx, metamask], "ynx").detail, ynx);
  assert.equal(selectProvider([ynx, metamask], "metamask").detail, metamask);
  assert.equal(selectProvider([metamask], "ynx").code, "YNX_WALLET_NOT_FOUND");
});

test("connects MetaMask and adds then verifies YNX Testnet", async () => {
  const calls = [];
  let chain = "0x1";
  const provider = {
    isMetaMask: true,
    async request(input) {
      calls.push(input.method);
      if (input.method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (input.method === "eth_chainId") return chain;
      if (input.method === "wallet_switchEthereumChain") {
        if (!calls.includes("wallet_addEthereumChain")) throw Object.assign(new Error("missing"), { code: 4902 });
        chain = "0x1917";
        return null;
      }
      if (input.method === "wallet_addEthereumChain") return null;
      throw new Error(input.method);
    },
  };
  const result = await connectWallet("metamask", target([{ info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" }, provider }]));
  assert.equal(result.ok, true);
  assert.equal(result.chainId, "0x1917");
  assert.deepEqual(calls, ["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]);
});

test("no provider returns an on-page result without navigation", async () => {
  assert.deepEqual(await connectWallet("ynx", target([])), { ok: false, code: "YNX_WALLET_NOT_FOUND" });
});
