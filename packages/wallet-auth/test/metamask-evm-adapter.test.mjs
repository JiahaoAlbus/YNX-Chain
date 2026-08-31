import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MetaMaskEvmConnectionAdapter, METAMASK_EVM_CHAIN, METAMASK_EVM_CHAIN_ID, METAMASK_EVM_CHAIN_QUANTITY,
  WalletAuthError,
} from "../src/index.js";
import * as metamaskSubpath from "@ynx-chain/wallet-auth/metamask-evm";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const ADDRESS = "0x1234567890ABCDEF1234567890aBcDeF12345678";

function provider(handler) {
  return { isMetaMask: true, request: handler };
}

test("MetaMask adapter performs a real EIP-1193 chain switch and account approval for an EVM product", async () => {
  assert.equal(metamaskSubpath.MetaMaskEvmConnectionAdapter, MetaMaskEvmConnectionAdapter);
  assert.equal(Object.hasOwn(metamaskSubpath, "ProductSessionGatewayKernel"), false);
  let chain = "0x1";
  const calls = [];
  const adapter = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async (input) => {
    calls.push(input);
    if (input.method === "eth_chainId") return chain;
    if (input.method === "wallet_switchEthereumChain") { chain = input.params[0].chainId; return null; }
    if (input.method === "eth_requestAccounts") return [ADDRESS];
    throw new Error("unexpected method");
  }) });
  const connection = await adapter.connect();
  assert.deepEqual(calls, [
    { method: "eth_chainId" },
    { method: "wallet_switchEthereumChain", params: [{ chainId: "0x1917" }] },
    { method: "eth_chainId" },
    { method: "eth_requestAccounts" },
  ]);
  assert.deepEqual(connection, {
    status: "connected-evm", wallet: "metamask", connectionMode: "evm-only",
    authority: "eip-1193-provider-only", productId: "dex", chainId: METAMASK_EVM_CHAIN_ID,
    chainQuantity: METAMASK_EVM_CHAIN_QUANTITY, address: ADDRESS.toLowerCase(),
    ynxProductSession: false, productSession: null,
    limitations: ["evm-provider-only", "no-ynx-product-session", "no-wallet-ai-gateway-session", "no-native-ynx-account-authority"],
  });
  assert.equal(Object.isFrozen(connection), true);
  assert.equal(Object.hasOwn(connection, "balance"), false);
  assert.equal(Object.hasOwn(connection, "transaction"), false);
  assert.equal(Object.hasOwn(connection, "account"), false);
});

test("MetaMask adapter does not switch when the provider is already on canonical chain 6423", async () => {
  const methods = [];
  const adapter = new MetaMaskEvmConnectionAdapter({ registry, productId: "pay", provider: provider(async ({ method }) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1917";
    if (method === "eth_requestAccounts") return [ADDRESS];
    throw new Error("unexpected method");
  }) });
  await adapter.connect();
  assert.deepEqual(methods, ["eth_chainId", "eth_requestAccounts"]);
});

test("MetaMask adapter adds the fixed canonical YNX chain after MetaMask reports 4902, then switches and connects", async () => {
  let chain = "0x1";
  let added = false;
  const calls = [];
  const adapter = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async (input) => {
    calls.push(input);
    if (input.method === "eth_chainId") return chain;
    if (input.method === "wallet_switchEthereumChain" && !added) throw Object.assign(new Error("unknown chain"), { code: 4902 });
    if (input.method === "wallet_addEthereumChain") { added = true; return null; }
    if (input.method === "wallet_switchEthereumChain") { chain = input.params[0].chainId; return null; }
    if (input.method === "eth_requestAccounts") return [ADDRESS];
    throw new Error("unexpected method");
  }) });
  const connection = await adapter.connect();
  assert.equal(connection.address, ADDRESS.toLowerCase());
  assert.deepEqual(calls, [
    { method: "eth_chainId" },
    { method: "wallet_switchEthereumChain", params: [{ chainId: "0x1917" }] },
    { method: "wallet_addEthereumChain", params: [METAMASK_EVM_CHAIN] },
    { method: "wallet_switchEthereumChain", params: [{ chainId: "0x1917" }] },
    { method: "eth_chainId" },
    { method: "eth_requestAccounts" },
  ]);
  assert.deepEqual(METAMASK_EVM_CHAIN, {
    chainId: "0x1917", chainName: "YNX Testnet",
    nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 },
    rpcUrls: ["https://evm.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"],
  });
});

test("MetaMask adapter rejects unavailable, generic, and non-EVM providers before connection", async () => {
  const missing = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: null });
  await assert.rejects(missing.connect(), code("METAMASK_NOT_INSTALLED"));
  const generic = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: { request: async () => "0x1917" } });
  await assert.rejects(generic.connect(), code("INVALID_METAMASK_PROVIDER"));
  const hostile = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: Object.defineProperty({}, "request", { get() { throw new Error("secret provider failure"); } }) });
  await assert.rejects(hostile.connect(), code("INVALID_METAMASK_PROVIDER"));
  let mixedIdentityRequestCount = 0;
  const mixedIdentity = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: { isMetaMask: true, isYNXWallet: true, async request() { mixedIdentityRequestCount += 1; return "0x1917"; } } });
  await assert.rejects(mixedIdentity.connect(), code("INVALID_METAMASK_PROVIDER"));
  assert.equal(mixedIdentityRequestCount, 0);
  assert.throws(() => new MetaMaskEvmConnectionAdapter({ registry, productId: "social", provider: null }), code("EVM_NOT_SUPPORTED"));
  assert.throws(() => new MetaMaskEvmConnectionAdapter({ registry, productId: "missing", provider: null }), code("UNKNOWN_PRODUCT"));
});

test("MetaMask adapter maps rejection, missing chain and disconnected provider errors without fallback", async () => {
  for (const [providerCode, expected] of [[4001, "USER_REJECTED"], ["4001", "USER_REJECTED"]]) {
    const adapter = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async ({ method }) => {
      if (method === "eth_chainId") return "0x1917";
      throw Object.assign(new Error("rejected"), { code: providerCode });
    }) });
    await assert.rejects(adapter.connect(), code(expected));
  }
  const missingChain = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async ({ method }) => {
    if (method === "eth_chainId") return "0x1";
    throw Object.assign(new Error("unknown chain"), { code: 4902 });
  }) });
  await assert.rejects(missingChain.connect(), code("CHAIN_NOT_AVAILABLE"));
  const rejectsAdd = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async ({ method }) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("unknown chain"), { code: 4902 });
    throw Object.assign(new Error("rejected"), { code: 4001 });
  }) });
  await assert.rejects(rejectsAdd.connect(), code("USER_REJECTED"));
  const disconnected = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async () => {
    throw Object.assign(new Error("offline"), { code: 4900 });
  }) });
  await assert.rejects(disconnected.connect(), code("WALLET_UNAVAILABLE"));
  const hostileError = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async () => {
    throw Object.defineProperty(new Error("secret provider failure"), "code", { get() { throw new Error("secret code failure"); } });
  }) });
  await assert.rejects(hostileError.connect(), code("WALLET_UNAVAILABLE"));
});

test("MetaMask adapter rejects malicious or malformed chain and account responses", async () => {
  for (const chain of [6423, "6423", "0x01917", "0xzz", {}, null]) {
    const adapter = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async () => chain) });
    await assert.rejects(adapter.connect(), code("INVALID_WALLET_RESPONSE"));
  }
  for (const accounts of [[], ["0x1234"], ["ynx1attacker"], "0x1234", null]) {
    const adapter = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async ({ method }) => method === "eth_chainId" ? "0x1917" : accounts) });
    await assert.rejects(adapter.connect(), code("INVALID_WALLET_RESPONSE"));
  }
  const refusesSwitch = new MetaMaskEvmConnectionAdapter({ registry, productId: "dex", provider: provider(async ({ method }) => method === "eth_chainId" ? "0x1" : null) });
  await assert.rejects(refusesSwitch.connect(), code("WRONG_NETWORK"));
});

test("live evidence harness loads the shared adapter and preserves its EVM-only truth boundary", () => {
  const html = readFileSync(new URL("../evidence/metamask-eip1193-live.html", import.meta.url), "utf8");
  assert.match(html, /MetaMaskEvmConnectionAdapter/);
  assert.match(html, /import\("\.\.\/src\/metamask-evm-adapter\.js"\)/);
  assert.match(html, /discoverWalletProviders/);
  assert.match(html, /discovery\.metamask\.provider/);
  assert.doesNotMatch(html, /provider:globalThis\.ethereum/);
  assert.match(html, /"@noble\/hashes\/":"\.\.\/node_modules\/@noble\/hashes\/"/);
  assert.match(html, /ynxProductSession=false/);
  assert.match(html, /No local or canned result was substituted/);
  assert.doesNotMatch(html, /eth_getBalance|personal_sign|eth_sign|eth_sendTransaction|wallet_sendCalls/);
  assert.doesNotMatch(html, /CONNECTED EVM PROVIDER[\s\S]{0,300}0x[0-9a-fA-F]{40}/);
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
