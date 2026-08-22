import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStandardWalletNativeBridge,
  createStandardWalletPermissionStorageAdapter,
  discoverEip6963WalletProviders,
  installStandardWalletWebRuntime,
  markStandardWalletPrivateServiceDegraded,
  STANDARD_WALLET_RUNTIME_PLATFORMS,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const SIGNATURE = `0x${"12".repeat(65)}`;
const HASH = `0x${"34".repeat(32)}`;

test("Web runtime exposes distinct YNX EIP-6963/EIP-1193 identity without overwriting another wallet", async () => {
  const scope = browserScope("https://external-dapp.example");
  const otherWallet = { isMetaMask: true, request: async () => [] };
  Object.defineProperty(scope, "ethereum", { configurable: true, writable: true, value: otherWallet });
  const installation = await installStandardWalletWebRuntime({
    scope,
    uuid: "12345678-1234-4234-8234-123456789abc",
    walletAccounts: [ACCOUNT],
    approveAccounts: async () => [ACCOUNT],
    permissionStorage: memoryStorage(),
    signMessage: async () => SIGNATURE,
    signTypedData: async () => SIGNATURE,
    sendTransaction: async () => HASH,
  });
  const discovery = await discoverEip6963WalletProviders(scope, 0);
  assert.equal(discovery.ynx.provider, installation.provider);
  assert.equal(installation.provider.isYNXWallet, true);
  assert.equal(installation.provider.isMetaMask, false);
  assert.equal(installation.provider.providerInfo.rdns, "com.ynx.wallet");
  assert.equal(scope.ethereum, otherWallet);
  assert.equal(installation.legacyInstalled, false);
  assert.deepEqual(await installation.provider.request({ method: "eth_requestAccounts" }), [ACCOUNT]);
  assert.equal(await installation.provider.request({ method: "eth_chainId" }), "0x1917");
  const degraded = markStandardWalletPrivateServiceDegraded(installation.runtime);
  assert.equal(degraded.connected, true);
  assert.deepEqual(await installation.provider.request({ method: "eth_accounts" }), [ACCOUNT]);
  assert.equal(installation.uninstall().uninstalled, true);
});

test("Web runtime installs legacy EIP-1193 only into an empty slot and removes only its own provider", async () => {
  const scope = browserScope("https://first-party.example");
  const installation = await installStandardWalletWebRuntime({ scope, uuid: "abcdefab-cdef-4abc-8def-abcdefabcdef", walletAccounts: [ACCOUNT], approveAccounts: async () => [ACCOUNT] });
  assert.equal(installation.legacyInstalled, true);
  assert.equal(scope.ethereum, installation.provider);
  installation.uninstall();
  assert.equal(scope.ethereum, undefined);
});

test("Android, iOS, macOS and Desktop bridges restore and revoke exact-origin authority", async () => {
  assert.deepEqual(STANDARD_WALLET_RUNTIME_PLATFORMS, ["web", "android", "ios", "macos", "desktop"]);
  for (const platform of ["android", "ios", "macos", "desktop"]) {
    const records = new Map();
    let approvals = 0;
    const config = () => ({
      platform,
      origin: `https://${platform}.external-dapp.example`,
      walletAccounts: [ACCOUNT],
      approveAccounts: async () => { approvals += 1; return [ACCOUNT]; },
      permissionStorage: memoryStorage(records),
      signMessage: async () => SIGNATURE,
      signTypedData: async () => SIGNATURE,
      sendTransaction: async () => HASH,
      emit: () => {},
    });
    const first = createStandardWalletNativeBridge(config());
    await first.start();
    assert.deepEqual(response(await first.handle({ id: 1, jsonrpc: "2.0", method: "eth_requestAccounts" })).result, [ACCOUNT]);
    first.stop();
    const restarted = createStandardWalletNativeBridge(config());
    assert.equal((await restarted.start()).provider.connected, true);
    assert.deepEqual(response(await restarted.handle({ id: 2, jsonrpc: "2.0", method: "eth_accounts" })).result, [ACCOUNT]);
    assert.equal(approvals, 1);
    assert.equal(markStandardWalletPrivateServiceDegraded(restarted.runtime).connected, true);
    assert.equal(response(await restarted.handle({ id: 3, jsonrpc: "2.0", method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })).result, null);
    restarted.stop();
    const revoked = createStandardWalletNativeBridge(config());
    assert.equal((await revoked.start()).provider.connected, false);
    assert.deepEqual(response(await revoked.handle({ id: 4, jsonrpc: "2.0", method: "eth_accounts" })).result, []);
    revoked.stop();
  }
});

function memoryStorage(records = new Map()) {
  return createStandardWalletPermissionStorageAdapter({ getItem: async (key) => records.get(key) ?? null, setItem: async (key, value) => records.set(key, value), removeItem: async (key) => records.delete(key) });
}
function browserScope(origin) {
  const scope = new EventTarget();
  scope.location = { origin };
  scope.Event = Event;
  scope.CustomEvent = globalThis.CustomEvent ?? class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
  return scope;
}
function response(value) { return JSON.parse(value); }
