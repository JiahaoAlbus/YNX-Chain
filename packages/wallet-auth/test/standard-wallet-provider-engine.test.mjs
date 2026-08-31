import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createStandardWalletConnectState,
  METAMASK_EVM_CHAIN,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_CHAIN_ID,
  STANDARD_WALLET_NETWORK,
  STANDARD_WALLET_PRIVATE_SERVICE,
  StandardWalletProviderEngine,
  StandardWalletProviderError,
  StandardWalletWalletConnectSessionAdapter,
  standardWalletEip6963Announcement,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const SIGNATURE = `0x${"12".repeat(65)}`;
const HASH = `0x${"34".repeat(32)}`;
const ORIGIN = "https://dapp.example";

function engine(overrides = {}) {
  return new StandardWalletProviderEngine({
    origin: ORIGIN,
    walletAccounts: [ACCOUNT, OTHER],
    approveAccounts: async () => [ACCOUNT],
    signMessage: async () => SIGNATURE,
    signTypedData: async () => SIGNATURE,
    sendTransaction: async () => HASH,
    rpcTransport: async ({ method }) => method === "eth_blockNumber" ? "0x2a" : null,
    ...overrides,
  });
}

test("provider exposes exact YNX network and only the approved 0x account", async () => {
  const provider = engine();
  assert.equal(provider.isYNXWallet, true);
  assert.equal(await provider.request({ method: "eth_chainId" }), "0x1917");
  assert.equal(await provider.request({ method: "net_version" }), "6423");
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
  assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [ACCOUNT]);
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), [ACCOUNT]);
  assert.equal(provider.selectedAddress, ACCOUNT);
  assert.equal("nativeAccount" in provider.state, false);
  assert.equal("productSession" in provider.state, false);
  assert.deepEqual(STANDARD_WALLET_NETWORK, { nativeChainId: "ynx_6423-1", evmChainId: 6423, chainId: "0x1917", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 } });
});

test("permissions, signing and transaction routes bind the approved origin and account", async () => {
  const calls = [];
  const provider = engine({
    signMessage: async (input) => { calls.push(input); return SIGNATURE; },
    signTypedData: async (input) => { calls.push(input); return SIGNATURE; },
    sendTransaction: async (input) => { calls.push(input); return HASH; },
  });
  await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  assert.equal(await provider.request({ method: "personal_sign", params: ["0x6869", ACCOUNT] }), SIGNATURE);
  assert.equal(await provider.request({ method: "eth_signTypedData_v4", params: [ACCOUNT, JSON.stringify({ domain: { chainId: 6423 }, types: { Mail: [] }, primaryType: "Mail", message: {} })] }), SIGNATURE);
  assert.equal(await provider.request({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to: OTHER, value: "0x1" }] }), HASH);
  assert.equal(calls.every((call) => call.origin === ORIGIN && call.account === ACCOUNT), true);
  await assert.rejects(provider.request({ method: "personal_sign", params: ["0x6869", OTHER] }), rpcCode(4100));
});

test("chain add/switch is exact and unsupported methods fail closed", async () => {
  const provider = engine();
  assert.equal(await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1917" }] }), null);
  assert.equal(await provider.request({ method: "wallet_addEthereumChain", params: [METAMASK_EVM_CHAIN] }), null);
  await assert.rejects(provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }), rpcCode(4902));
  await assert.rejects(provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x238e" }] }), rpcCode(4902));
  await assert.rejects(provider.request({ method: "wallet_addEthereumChain", params: [{ ...METAMASK_EVM_CHAIN, chainName: "Fake" }] }), rpcCode(-32602));
  await assert.rejects(provider.request({ method: "eth_sign", params: [ACCOUNT, "0x00"] }), rpcCode(4200));
});

test("RPC and Product Session degradation never invalidates the Standard Wallet layer", async () => {
  const provider = engine({ rpcTransport: async () => { throw new Error("offline"); } });
  await provider.request({ method: "eth_requestAccounts" });
  await assert.rejects(provider.request({ method: "eth_blockNumber" }), rpcCode(4900));
  assert.equal(provider.state.connected, true);
  assert.equal(provider.setRpcStatus("degraded").connected, true);
  const degraded = provider.setPrivateServiceStatus(STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED);
  assert.equal(degraded.connected, true);
  assert.equal(degraded.accounts[0], ACCOUNT);
  assert.equal(degraded.privateService, "degraded");
});

test("event model emits canonical connect/account/message/disconnect without listener faults escaping", async () => {
  const provider = engine();
  const events = [];
  provider.on("accountsChanged", (payload) => events.push(["accountsChanged", payload]));
  provider.on("connect", (payload) => events.push(["connect", payload]));
  provider.on("message", () => { throw new Error("consumer fault"); });
  provider.on("disconnect", (payload) => events.push(["disconnect", payload]));
  await provider.request({ method: "eth_requestAccounts" });
  provider.setRpcStatus("ready");
  await provider.disconnect();
  assert.deepEqual(events.map(([name]) => name), ["accountsChanged", "connect", "accountsChanged", "disconnect"]);
  assert.deepEqual(events[0][1], [ACCOUNT]);
  assert.deepEqual(events[2][1], []);
});

test("concurrent account requests are single-flight and emit one connection transition", async () => {
  let approvals = 0, release;
  const approval = new Promise((resolve) => { release = resolve; });
  const provider = engine({ approveAccounts: async () => { approvals += 1; return approval; } });
  const events = [];
  provider.on("connect", (payload) => events.push(["connect", payload]));
  provider.on("accountsChanged", (payload) => events.push(["accountsChanged", payload]));
  const first = provider.request({ method: "eth_requestAccounts" });
  const second = provider.request({ method: "eth_requestAccounts" });
  release([ACCOUNT]);
  assert.deepEqual(await Promise.all([first, second]), [[ACCOUNT], [ACCOUNT]]);
  assert.equal(approvals, 1);
  assert.deepEqual(events.map(([name]) => name), ["accountsChanged", "connect"]);
});

test("account inventory mutation during approval cannot resurrect removed authority", async () => {
  let release;
  const approval = new Promise((resolve) => { release = resolve; });
  const provider = engine({ approveAccounts: async () => approval });
  const pending = provider.request({ method: "eth_requestAccounts" });
  await provider.replaceWalletAccounts([OTHER]);
  release([ACCOUNT]);
  await assert.rejects(pending, rpcCode(4100));
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
  assert.equal(provider.state.connected, false);
});

test("chain change events are exact and leaving 0x1917 revokes connection authority", async () => {
  const provider = engine();
  const events = [];
  provider.on("chainChanged", (value) => events.push(["chainChanged", value]));
  provider.on("accountsChanged", (value) => events.push(["accountsChanged", value]));
  provider.on("disconnect", (value) => events.push(["disconnect", value]));
  await provider.request({ method: "eth_requestAccounts" });
  events.length = 0;
  const changed = await provider.notifyChainChanged("0x1");
  assert.equal(changed.connected, false);
  assert.deepEqual(changed.accounts, []);
  assert.deepEqual(events.map(([name]) => name), ["chainChanged", "accountsChanged", "disconnect"]);
  assert.equal(events[2][1].code, 4901);
});

test("account inventory changes preserve only still-approved accounts and disconnect on removal", async () => {
  const provider = engine();
  const changes = [];
  provider.on("accountsChanged", (accounts) => changes.push(accounts));
  await provider.request({ method: "eth_requestAccounts" });
  assert.equal((await provider.replaceWalletAccounts([ACCOUNT])).connected, true);
  assert.equal((await provider.replaceWalletAccounts([OTHER])).connected, false);
  assert.deepEqual(changes, [[ACCOUNT], []]);
});

test("EIP-6963 announcement is exact and carries no connection authority", () => {
  const provider = engine();
  const announcement = standardWalletEip6963Announcement(provider, "12345678-1234-4234-8234-123456789abc");
  assert.equal(announcement.info.rdns, "com.ynx.wallet");
  assert.equal(announcement.provider, provider);
  assert.equal(provider.state.connected, false);
});

test("WalletConnect approves only eip155:6423 and routes through the same permission engine", async () => {
  const wcEngine = engine({ origin: "walletconnect:topic_1234567890abcdef" });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine: wcEngine, topic: "topic_1234567890abcdef" });
  const session = await adapter.approve({ requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["eth_accounts", "eth_requestAccounts", "eth_chainId", "personal_sign"], events: ["accountsChanged", "chainChanged"] } } });
  assert.deepEqual(session.namespaces.eip155.accounts, [`eip155:6423:${ACCOUNT}`]);
  assert.equal(await adapter.request({ topic: adapter.topic, chainId: "eip155:6423", id: 1, request: { method: "eth_chainId" } }), "0x1917");
  await assert.rejects(adapter.request({ topic: adapter.topic, chainId: "eip155:1", id: 2, request: { method: "eth_accounts" } }), rpcCode(4901));
  assert.equal((await adapter.disconnect()).active, false);
});

test("WalletConnect rejects namespace, chain and method widening before approval", async () => {
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine: engine({ origin: "walletconnect:topic_abcdef1234567890" }), topic: "topic_abcdef1234567890" });
  for (const requiredNamespaces of [
    { cosmos: { chains: ["cosmos:ynx"], methods: ["eth_accounts"], events: ["accountsChanged"] } },
    { eip155: { chains: ["eip155:1"], methods: ["eth_accounts", "eth_requestAccounts"], events: ["accountsChanged"] } },
    { eip155: { chains: ["eip155:6423"], methods: ["eth_accounts", "eth_requestAccounts", "wallet_unsafe"], events: ["accountsChanged"] } },
  ]) await assert.rejects(adapter.approve({ requiredNamespaces }), rpcCode(5100));
  assert.equal(adapter.active, false);
});

test("WalletConnect disconnect racing approval cannot publish a late session", async () => {
  let release;
  const approval = new Promise((resolve) => { release = resolve; });
  const wcEngine = engine({ origin: "walletconnect:topic_cancel_12345678", approveAccounts: async () => approval });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine: wcEngine, topic: "topic_cancel_12345678" });
  const pending = adapter.approve({ requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["eth_accounts", "eth_requestAccounts"], events: ["accountsChanged"] } } });
  await adapter.disconnect();
  release([ACCOUNT]);
  await assert.rejects(pending, rpcCode(4900));
  assert.equal(adapter.active, false);
  assert.deepEqual(wcEngine.state.accounts, []);
});

test("malformed, wrong-chain and oversized requests fail before a privileged callback", async () => {
  let privileged = 0;
  const provider = engine({
    signMessage: async () => { privileged += 1; return SIGNATURE; },
    signTypedData: async () => { privileged += 1; return SIGNATURE; },
    sendTransaction: async () => { privileged += 1; return HASH; },
  });
  await provider.request({ method: "eth_requestAccounts" });
  await assert.rejects(provider.request({ method: "personal_sign", params: [`0x${"aa".repeat(140000)}`, ACCOUNT] }), rpcCode(-32600));
  await assert.rejects(provider.request({ method: "personal_sign", params: ["0x0", ACCOUNT] }), rpcCode(-32602));
  await assert.rejects(provider.request({ method: "eth_signTypedData_v4", params: [ACCOUNT, { domain: { chainId: 1 }, types: { Mail: [] }, primaryType: "Mail", message: {} }] }), rpcCode(4901));
  await assert.rejects(provider.request({ method: "eth_signTypedData_v4", params: [ACCOUNT, { domain: {}, types: {}, primaryType: "Mail", message: {} }] }), rpcCode(-32602));
  await assert.rejects(provider.request({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to: "0x1", value: "1" }] }), rpcCode(-32602));
  await assert.rejects(provider.request({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to: OTHER, accessList: [{ address: OTHER, storageKeys: ["0x00"] }] }] }), rpcCode(-32602));
  assert.equal(privileged, 0);
});

test("shared connect reducer preserves Standard Wallet authority when Gateway is degraded", () => {
  let state = createStandardWalletConnectState();
  state = reduceStandardWalletConnectState(state, { type: "BEGIN", pendingIntent: "connect_intent_1234567890" });
  state = reduceStandardWalletConnectState(state, { type: "PROVIDER_SELECTED", providerKind: "ynx-wallet" });
  state = reduceStandardWalletConnectState(state, { type: "ACCOUNT_APPROVED", account: ACCOUNT });
  state = reduceStandardWalletConnectState(state, { type: "CHAIN_CONFIRMED", chainId: STANDARD_WALLET_CHAIN_ID });
  state = reduceStandardWalletConnectState(state, { type: "PRIVATE_SESSION_DEGRADED", code: "GATEWAY_UNAVAILABLE" });
  assert.equal(state.status, "connected");
  assert.equal(state.privateService, "degraded");
  assert.equal(state.account, ACCOUNT);
});

test("machine conformance vector freezes network, privacy and independent-layer truth", () => {
  const vector = JSON.parse(readFileSync(new URL("../testdata/standard-wallet-provider-conformance-v1.json", import.meta.url), "utf8"));
  const contract = JSON.parse(readFileSync(new URL("../integration/standard-wallet-provider-v1.json", import.meta.url), "utf8"));
  assert.deepEqual(vector.network, { nativeChainId: "ynx_6423-1", evmChainId: 6423, chainId: "0x1917", walletConnectChainId: "eip155:6423", symbol: "YNXT" });
  assert.equal(contract.layers.standardWallet.independent, true);
  assert.equal(contract.layers.standardWallet.externalDappProductRegistryRequired, false);
  assert.equal(contract.layers.privateProductSession.failureEffect, "DEGRADED");
  assert.equal(contract.persistence.approvalAndRevocationLinearized, true);
  assert.equal(vector.persistence.postRevokeAccounts.length, 0);
  assert.equal(vector.requests.find(({ id }) => id === "personal-sign-rejected").signatureFabricated, false);
  assert.equal(contract.privacy.exposeUnapprovedEvmAccount, false);
  assert.equal(contract.truth.platformConsumed, false);
  assert.equal(contract.truth.productsConsumed, "0/12");
});

test("Layer 1 provider modules have no Gateway, Product Session or product registry dependency", () => {
  for (const file of [
    "standard-wallet-provider-events.js", "standard-wallet-provider-common.js", "standard-wallet-permission-storage.js", "standard-wallet-permissions.js", "standard-wallet-json-rpc.js",
    "standard-wallet-provider-engine.js", "standard-wallet-walletconnect.js", "standard-wallet-walletconnect-storage.js", "standard-wallet-walletconnect-runtime.js", "standard-wallet-connect-state.js",
  ]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:gateway|product-session|registry|metamask-evm-adapter)[^"']*["']/i, file);
  }
});

function rpcCode(expected) { return (error) => error instanceof StandardWalletProviderError && error.code === expected; }
