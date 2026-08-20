import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {connectCalendarWallet, WALLET_INSTALLATION_OPTIONS, YNX_TESTNET_ADD_CHAIN} from "../web/wallet-connection.js";

const account = "0x1111111111111111111111111111111111111111";

function provider({chainId = "0x1917", reject = false} = {}) {
  let chain = chainId;
  const calls = [];
  return {
    calls,
    async request(input) {
      calls.push(structuredClone(input));
      if (input.method === "eth_requestAccounts") {
        if (reject) throw Object.assign(new Error("User rejected"), {code: 4001});
        return [account];
      }
      if (input.method === "eth_chainId") return chain;
      if (input.method === "wallet_switchEthereumChain") {
        if (chain === "0x999") throw Object.assign(new Error("Unknown chain"), {code: 4902});
        chain = input.params[0].chainId; return null;
      }
      if (input.method === "wallet_addEthereumChain") { chain = input.params[0].chainId; return null; }
      throw new Error(`Unexpected ${input.method}`);
    },
  };
}

function browser(announcements = [], injected = null) {
  const listeners = new Map();
  return {
    ethereum: injected,
    addEventListener(type, listener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      if (event.type === "eip6963:requestProvider") {
        for (const detail of announcements) for (const listener of listeners.get("eip6963:announceProvider") ?? []) listener({type: "eip6963:announceProvider", detail});
      }
      return true;
    },
  };
}

test("Calendar prefers announced YNX Wallet and preserves private service degradation", async () => {
  const ynx = provider();
  const metamask = provider();
  const result = await connectCalendarWallet(browser([
    {info: {uuid: "metamask", name: "MetaMask", rdns: "io.metamask"}, provider: metamask},
    {info: {uuid: "ynx", name: "YNX Wallet", rdns: "com.ynxweb4.wallet"}, provider: ynx},
  ]), {timeoutMs: 0});
  assert.equal(result.account, account);
  assert.equal(result.chainId, "0x1917");
  assert.equal(result.walletName, "YNX Wallet");
  assert.equal(result.standardConnection, "CONNECTED");
  assert.equal(result.productSession, "PRIVATE_SERVICE_DEGRADED");
  assert.equal(metamask.calls.length, 0);
});

test("Calendar adds and verifies YNX Testnet through the accepted EIP-1193 provider", async () => {
  const wallet = provider({chainId: "0x999"});
  const result = await connectCalendarWallet(browser([], wallet), {timeoutMs: 0});
  assert.equal(result.chainId, "0x1917");
  assert.deepEqual(wallet.calls.find((call) => call.method === "wallet_addEthereumChain").params[0], YNX_TESTNET_ADD_CHAIN);
});

test("rejection and missing Wallet fail closed without a local connection", async () => {
  await assert.rejects(connectCalendarWallet(browser([], provider({reject: true})), {timeoutMs: 0}), (error) => error.code === "WALLET_USER_REJECTED");
  await assert.rejects(connectCalendarWallet(browser(), {timeoutMs: 0}), (error) => error.code === "WALLET_NOT_INSTALLED" && error.details === WALLET_INSTALLATION_OPTIONS);
});

test("vendored browser-safe SDK modules are byte-identical to their accepted manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../web/ynx-dapp-connect-sdk/manifest.json", import.meta.url)));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = createHash("sha256").update(readFileSync(new URL(`../web/ynx-dapp-connect-sdk/${name}`, import.meta.url))).digest("hex");
    assert.equal(actual, expected, name);
  }
  assert.equal(manifest.productSessionIncluded, false);
});
