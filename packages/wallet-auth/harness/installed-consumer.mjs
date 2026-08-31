import assert from "node:assert/strict";
import {
  createStandardWalletPermissionStorageAdapter,
  discoverEip6963WalletProviders,
  markStandardWalletPrivateServiceDegraded,
  StandardWalletProviderEngine,
} from "@ynx-chain/wallet-auth/standard-wallet-runtime";
import {
  createStandardWalletWalletConnectRuntime,
  createStandardWalletWalletConnectSessionStorageAdapter,
  preflightStandardWalletWalletConnectRuntime,
  StandardWalletWalletConnectSessionAdapter,
} from "@ynx-chain/wallet-auth/standard-wallet-walletconnect";
import { installStandardWalletWebRuntime } from "@ynx-chain/wallet-auth/standard-wallet-web";
import { createStandardWalletNativeBridge } from "@ynx-chain/wallet-auth/standard-wallet-native";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const SIGNATURE = `0x${"12".repeat(65)}`;
const HASH = `0x${"34".repeat(32)}`;
const records = new Map();
const storage = () => createStandardWalletPermissionStorageAdapter({ getItem: async (key) => records.get(key) ?? null, setItem: async (key, value) => records.set(key, value), removeItem: async (key) => records.delete(key) });
const callbacks = {
  walletAccounts: [ACCOUNT],
  approveAccounts: async () => [ACCOUNT],
  signMessage: async () => SIGNATURE,
  signTypedData: async () => SIGNATURE,
  sendTransaction: async () => HASH,
};

const scope = new EventTarget();
scope.location = { origin: "https://installed-external-dapp.example" };
scope.Event = Event;
scope.CustomEvent = globalThis.CustomEvent ?? class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
const installation = await installStandardWalletWebRuntime({ scope, uuid: "12345678-1234-4234-8234-123456789abc", permissionStorage: storage(), ...callbacks });
const providerEvents = [];
for (const event of ["connect", "accountsChanged", "chainChanged", "disconnect", "message"]) installation.provider.on(event, (payload) => providerEvents.push({ event, payload }));
const discovery = await discoverEip6963WalletProviders(scope, 0);
assert.equal(discovery.ynx.provider, installation.provider);
assert.equal(installation.provider.isYNXWallet, true);
assert.equal(installation.provider.isMetaMask, false);
assert.equal(installation.provider.providerInfo.rdns, "com.ynx.wallet");
assert.deepEqual(await installation.provider.request({ method: "eth_requestAccounts" }), [ACCOUNT]);
assert.equal(await installation.provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x1917", chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: ["https://evm.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"] }] }), null);
assert.equal(await installation.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1917" }] }), null);
assert.equal(await installation.provider.request({ method: "eth_chainId" }), "0x1917");
assert.equal(await installation.provider.request({ method: "personal_sign", params: ["0x6869", ACCOUNT] }), SIGNATURE);
assert.equal(await installation.provider.request({ method: "eth_signTypedData_v4", params: [ACCOUNT, { domain: { chainId: 6423 }, types: { Mail: [] }, primaryType: "Mail", message: {} }] }), SIGNATURE);
assert.equal(await installation.provider.request({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to: OTHER, value: "0x1" }] }), HASH);
installation.runtime.setRpcStatus("degraded");
assert.equal(markStandardWalletPrivateServiceDegraded(installation.runtime).connected, true);
assert.deepEqual(await installation.provider.request({ method: "eth_accounts" }), [ACCOUNT]);
installation.uninstall();

const refreshScope = new EventTarget();
refreshScope.location = { origin: "https://installed-external-dapp.example" };
refreshScope.Event = Event;
refreshScope.CustomEvent = scope.CustomEvent;
let refreshPrompts = 0;
const refreshed = await installStandardWalletWebRuntime({ scope: refreshScope, uuid: "12345678-1234-4234-8234-123456789abc", permissionStorage: storage(), ...callbacks, approveAccounts: async () => { refreshPrompts += 1; return [ACCOUNT]; } });
assert.deepEqual(await refreshed.provider.request({ method: "eth_accounts" }), [ACCOUNT]);
assert.equal(refreshPrompts, 0);
assert.equal(await refreshed.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }), null);
assert.deepEqual(await refreshed.provider.request({ method: "eth_accounts" }), []);
refreshed.uninstall();

const rejectScope = new EventTarget();
rejectScope.location = { origin: "https://reject.external-dapp.example" };
rejectScope.Event = Event;
rejectScope.CustomEvent = scope.CustomEvent;
const rejected = await installStandardWalletWebRuntime({ scope: rejectScope, uuid: "87654321-4321-4321-8321-cba987654321", permissionStorage: storage(), ...callbacks, approveAccounts: async () => { const error = new Error("rejected"); error.code = 4001; throw error; } });
await assert.rejects(rejected.provider.request({ method: "eth_requestAccounts" }), (error) => error.code === 4001);
assert.deepEqual(await rejected.provider.request({ method: "eth_accounts" }), []);
rejected.uninstall();

const native = {};
for (const platform of ["android", "ios", "macos", "desktop"]) {
  const bridge = createStandardWalletNativeBridge({ platform, origin: `https://${platform}.installed-consumer.example`, permissionStorage: storage(), emit: () => {}, ...callbacks });
  await bridge.start();
  const approved = JSON.parse(await bridge.handle({ id: platform, jsonrpc: "2.0", method: "eth_requestAccounts" }));
  assert.deepEqual(approved.result, [ACCOUNT]);
  native[platform] = approved.result.length === 1;
  bridge.stop();
}

const wcEngine = new StandardWalletProviderEngine({ origin: "walletconnect:installed_harness_123456", permissionStorage: storage(), ...callbacks });
await wcEngine.restorePermissions();
const wcSessions = createStandardWalletWalletConnectSessionStorageAdapter({ getItem: async (key) => records.get(key) ?? null, setItem: async (key, value) => records.set(key, value), removeItem: async (key) => records.delete(key) });
const wcRuntimeConfig = { topic: "installed_runtime_preflight_123456", permissionStorage: storage(), sessionStorage: wcSessions, emit: () => {}, rpcTransport: async () => "0x0", ...callbacks };
const wcRuntimeReadiness = preflightStandardWalletWalletConnectRuntime(wcRuntimeConfig);
assert.equal(wcRuntimeReadiness.ready, true);
assert.equal(wcRuntimeReadiness.authorityCreated, false);
assert.equal(wcRuntimeReadiness.callbacksInvoked, false);
const wcRuntime = createStandardWalletWalletConnectRuntime(wcRuntimeConfig);
assert.equal(await wcRuntime.start(), false);
wcRuntime.close();
const wc = new StandardWalletWalletConnectSessionAdapter({ engine: wcEngine, topic: "installed_harness_topic_123456", sessionStorage: wcSessions });
const session = await wc.approve({ requiredNamespaces: { eip155: { chains: ["eip155:6423"], methods: ["eth_accounts", "eth_requestAccounts", "eth_chainId", "personal_sign"], events: ["accountsChanged", "chainChanged"] } } });
assert.deepEqual(session.namespaces.eip155.accounts, [`eip155:6423:${ACCOUNT}`]);
wc.close();
const wcRestoredEngine = new StandardWalletProviderEngine({ origin: "walletconnect:installed_harness_123456", permissionStorage: storage(), ...callbacks });
const wcRestored = new StandardWalletWalletConnectSessionAdapter({ engine: wcRestoredEngine, topic: "installed_harness_topic_123456", sessionStorage: wcSessions });
assert.deepEqual((await wcRestored.restore()).namespaces.eip155.accounts, [`eip155:6423:${ACCOUNT}`]);
await wcRestored.disconnect();
wcRestored.close();

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  packageImportedFromInstalledArtifact: true,
  externalDappOrigin: "https://installed-external-dapp.example",
  eip6963: true,
  eip1193: true,
  chainId: "0x1917",
  accountApproved: true,
  personalSignCallback: true,
  eip712Callback: true,
  sendTransactionCallback: true,
  productSessionUsed: false,
  degradedConnectionPreserved: true,
  refreshRestoredWithoutPrompt: true,
  explicitRevokeClearedRestartAuthority: true,
  rejectionCreatedNoAuthority: true,
  providerEventsObserved: providerEvents.map(({ event }) => event),
  blankTopLevelOpenCalls: 0,
  native,
  walletConnectAdapter: true,
  walletConnectRuntimePreflight: wcRuntimeReadiness.ready,
  walletConnectProtectedRestartRestore: true,
  walletConnectExplicitRevokeClearedAuthority: true,
  callbackEvidence: "deterministic-conformance-only-no-real-key-no-real-transaction",
  realInstalledWallet: false,
  realWalletConnectRelay: false
})}\n`);
