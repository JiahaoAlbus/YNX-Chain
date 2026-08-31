import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createStandardWalletPermissionStorageAdapter,
  preflightStandardWalletWalletConnectRuntime,
  createStandardWalletWalletConnectRuntime,
  createStandardWalletWalletConnectSessionStorageAdapter,
  parseStandardWalletWalletConnectSessionSnapshot,
  StandardWalletProviderEngine,
  StandardWalletProviderError,
  STANDARD_WALLET_RUNTIME_VERSION,
  StandardWalletWalletConnectSessionAdapter,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const TOPIC = "wc_runtime_topic_1234567890";
const PROPOSAL = Object.freeze({ requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["personal_sign", "eth_requestAccounts", "eth_accounts", "eth_chainId", "wallet_revokePermissions"], events: ["disconnect", "accountsChanged", "chainChanged"] } } });

test("WalletConnect protected session restores across runtime restart and revoke clears both authorities", async () => {
  const records = new Map();
  let approvals = 0;
  const config = () => ({
    origin: `walletconnect:${TOPIC}`,
    walletAccounts: [ACCOUNT],
    approveAccounts: async () => { approvals += 1; return [ACCOUNT]; },
    permissionStorage: permissionStorage(records),
  });
  const firstEngine = new StandardWalletProviderEngine(config());
  const first = new StandardWalletWalletConnectSessionAdapter({ engine: firstEngine, topic: TOPIC, sessionStorage: sessionStorage(records) });
  const approved = await first.approve(PROPOSAL);
  assert.deepEqual(approved.namespaces.eip155.accounts, [`eip155:6423:${ACCOUNT}`]);
  assert.equal(first.active, true);
  first.close();

  const emitted = [];
  const restartedEngine = new StandardWalletProviderEngine(config());
  const restarted = new StandardWalletWalletConnectSessionAdapter({ engine: restartedEngine, topic: TOPIC, sessionStorage: sessionStorage(records), emit: (event) => emitted.push(event) });
  const restored = await restarted.restore();
  assert.deepEqual(restored.namespaces.eip155.accounts, [`eip155:6423:${ACCOUNT}`]);
  assert.equal(restarted.active, true);
  assert.equal(approvals, 1);
  assert.equal(await restarted.request({ topic: TOPIC, chainId: "eip155:6423", id: 1, request: { method: "eth_chainId" } }), "0x1917");
  assert.equal(await restarted.request({ topic: TOPIC, chainId: "eip155:6423", id: 2, request: { method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } }), null);
  assert.equal(restarted.active, false);
  assert.deepEqual(emitted.map(({ event }) => event), ["accountsChanged", "disconnect"]);
  restarted.close();

  const finalEngine = new StandardWalletProviderEngine(config());
  const final = new StandardWalletWalletConnectSessionAdapter({ engine: finalEngine, topic: TOPIC, sessionStorage: sessionStorage(records) });
  assert.equal(await final.restore(), null);
  assert.deepEqual(finalEngine.state.accounts, []);
  final.close();
});

test("WalletConnect explicit proposal rejection creates no account or session authority", async () => {
  const records = new Map();
  let approvals = 0;
  const engine = new StandardWalletProviderEngine({ origin: `walletconnect:${TOPIC}`, walletAccounts: [ACCOUNT], approveAccounts: async () => { approvals += 1; return [ACCOUNT]; }, permissionStorage: permissionStorage(records) });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine, topic: TOPIC, sessionStorage: sessionStorage(records) });
  const rejected = await adapter.reject(PROPOSAL);
  assert.deepEqual(rejected, { topic: TOPIC, rejected: true, code: 4001, authority: "walletconnect-proposal-rejected-no-authority" });
  assert.equal(approvals, 0);
  assert.equal(adapter.active, false);
  assert.deepEqual(engine.state.accounts, []);
  adapter.close();
});

test("installable WalletConnect runtime owns a topic-bound engine and requires start before relay requests", async () => {
  const records = new Map();
  const runtime = createStandardWalletWalletConnectRuntime(runtimeConfig(records));
  assert.equal(runtime.readiness.ready, true);
  assert.equal(runtime.readiness.authorityCreated, false);
  assert.equal(runtime.readiness.callbacksInvoked, false);
  await assert.rejects(runtime.approve(PROPOSAL), /not started/);
  assert.equal(await runtime.start(), false);
  const approved = await runtime.approve(PROPOSAL);
  assert.deepEqual(approved.namespaces.eip155.accounts, [`eip155:6423:${ACCOUNT}`]);
  assert.equal(runtime.engine.state.origin, `walletconnect:${TOPIC}`);
  assert.equal(await runtime.request({ topic: TOPIC, chainId: "eip155:6423", id: 1, request: { method: "eth_chainId" } }), "0x1917");
  await runtime.disconnect();
  runtime.close();
});

test("WalletConnect runtime capability preflight fails before authority or callback use and emits no sensitive values", () => {
  const calls = [];
  const incomplete = {
    topic: TOPIC,
    walletAccounts: [ACCOUNT],
    approveAccounts: async () => { calls.push("approve"); return [ACCOUNT]; },
    permissionStorage: permissionStorage(new Map()),
    sessionStorage: sessionStorage(new Map()),
  };
  const receipt = preflightStandardWalletWalletConnectRuntime(incomplete);
  assert.deepEqual(receipt, {
    version: "standard-wallet-walletconnect-runtime-readiness-v1",
    ready: false,
    authorityCreated: false,
    callbacksInvoked: false,
    capabilities: {
      permissionStorage: true,
      sessionStorage: true,
      relayEventSink: false,
      rpcTransport: false,
      accountApproval: true,
      personalSignConfirmation: false,
      typedDataConfirmation: false,
      transactionConfirmation: false,
    },
  });
  assert.equal(JSON.stringify(receipt).includes(ACCOUNT), false);
  assert.equal(JSON.stringify(receipt).includes(TOPIC), false);
  assert.throws(() => createStandardWalletWalletConnectRuntime(incomplete), /capability preflight failed/);
  assert.deepEqual(calls, []);
});

test("WalletConnect runtime capability preflight accepts a complete host boundary without invoking it", () => {
  const calls = [];
  const config = runtimeConfig(new Map(), calls);
  const receipt = preflightStandardWalletWalletConnectRuntime(config);
  assert.equal(receipt.ready, true);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.capabilities), true);
  assert.deepEqual(calls, []);
});

test("WalletConnect readiness handoff keeps relay credentials and Product Session outside Layer 1 authority", () => {
  const contract = JSON.parse(readFileSync(new URL("../integration/standard-wallet-walletconnect-runtime-readiness-v1.json", import.meta.url), "utf8"));
  assert.equal(contract.export, "preflightStandardWalletWalletConnectRuntime");
  assert.equal(contract.receipt.containsAccountOrTopic, false);
  assert.equal(contract.receipt.containsProjectIdOrRelayCredential, false);
  assert.equal(contract.receipt.createsAuthority, false);
  assert.equal(contract.factoryBehavior.projectIdOwnership, "platform-relay-owner");
  assert.equal(contract.factoryBehavior.productSessionAuthority, false);
  assert.equal(contract.truth.realRelayConnected, false);
  assert.equal(contract.truth.publicRuntimeLoaded, false);
});

test("WalletConnect persistence failure rolls back provider permission instead of publishing a session", async () => {
  const records = new Map();
  const engine = new StandardWalletProviderEngine({ origin: `walletconnect:${TOPIC}`, walletAccounts: [ACCOUNT], approveAccounts: async () => [ACCOUNT], permissionStorage: permissionStorage(records) });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine, topic: TOPIC, sessionStorage: { load: async () => null, save: async () => { throw new Error("unavailable"); }, clear: async () => {} } });
  await assert.rejects(adapter.approve(PROPOSAL), rpcCode(4100));
  assert.equal(adapter.active, false);
  assert.deepEqual(engine.state.accounts, []);
  adapter.close();
});

test("WalletConnect restore rejects noncanonical or account-mismatched session state fail closed", async () => {
  const records = new Map();
  const permissions = permissionStorage(records);
  const sessions = sessionStorage(records);
  const engine = new StandardWalletProviderEngine({ origin: `walletconnect:${TOPIC}`, walletAccounts: [ACCOUNT], approveAccounts: async () => [ACCOUNT], permissionStorage: permissions });
  await engine.request({ method: "eth_requestAccounts" });
  await sessions.save({ schemaVersion: 1, topic: TOPIC, chainId: "eip155:6423", methods: ["eth_accounts", "eth_requestAccounts"], events: ["accountsChanged"], accounts: ["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"] });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine, topic: TOPIC, sessionStorage: sessions });
  await assert.rejects(adapter.restore(), rpcCode(4100));
  assert.equal(adapter.active, false);
  assert.deepEqual(engine.state.accounts, []);
  adapter.close();
  assert.throws(() => parseStandardWalletWalletConnectSessionSnapshot('{"topic":"wrong"}\n', TOPIC), rpcCode(4100));
});

test("platform parity handoff freezes all install entrypoints without promoting runtime truth", () => {
  const contract = JSON.parse(readFileSync(new URL("../integration/standard-wallet-runtime-v2.json", import.meta.url), "utf8"));
  assert.equal(STANDARD_WALLET_RUNTIME_VERSION, "1.1.0-p0.0");
  assert.deepEqual(contract.subpaths, {
    shared: "@ynx-chain/wallet-auth/standard-wallet-runtime",
    web: "@ynx-chain/wallet-auth/standard-wallet-web",
    native: "@ynx-chain/wallet-auth/standard-wallet-native",
    walletConnect: "@ynx-chain/wallet-auth/standard-wallet-walletconnect",
  });
  assert.equal(contract.ownerDispatch.web.length, 11);
  assert.equal(contract.truth.realBrowserExtensionInstalled, false);
  assert.equal(contract.truth.realNativeWalletInstalled, false);
  assert.equal(contract.truth.realWalletConnectRelay, false);
  assert.equal(contract.truth.productsConsumed, "0/12");
  assert.equal(contract.authority.productSessionMayCreateStandardAuthority, false);
});

function permissionStorage(records) {
  return createStandardWalletPermissionStorageAdapter({ getItem: async (key) => records.get(key) ?? null, setItem: async (key, value) => records.set(key, value), removeItem: async (key) => records.delete(key) });
}
function sessionStorage(records) {
  return createStandardWalletWalletConnectSessionStorageAdapter({ getItem: async (key) => records.get(key) ?? null, setItem: async (key, value) => records.set(key, value), removeItem: async (key) => records.delete(key) });
}
function runtimeConfig(records, calls = []) {
  return {
    topic: TOPIC,
    walletAccounts: [ACCOUNT],
    approveAccounts: async () => { calls.push("approve"); return [ACCOUNT]; },
    permissionStorage: permissionStorage(records),
    sessionStorage: sessionStorage(records),
    emit: () => { calls.push("emit"); },
    rpcTransport: async () => { calls.push("rpc"); return "0x0"; },
    signMessage: async () => { calls.push("personal_sign"); return `0x${"12".repeat(65)}`; },
    signTypedData: async () => { calls.push("typed_data"); return `0x${"12".repeat(65)}`; },
    sendTransaction: async () => { calls.push("send"); return `0x${"34".repeat(32)}`; },
  };
}
function rpcCode(expected) { return (error) => error instanceof StandardWalletProviderError && error.code === expected; }
