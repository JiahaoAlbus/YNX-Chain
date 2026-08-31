import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStandardWalletConnectState,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_CHAIN_ID,
  STANDARD_WALLET_CONNECT_STATUS,
  STANDARD_WALLET_PRIVATE_SERVICE,
  STANDARD_WALLET_RPC_PROBE,
  STANDARD_WALLET_RPC_PROBE_TRANSPORT,
  WalletAuthError,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const INTENT = "connect_intent_1234567890";
const reduce = (state, type, fields = {}) => reduceStandardWalletConnectState(state, { type, ...fields });
function connected() {
  let value = createStandardWalletConnectState();
  value = reduce(value, "BEGIN", { pendingIntent: INTENT });
  value = reduce(value, "PROVIDER_SELECTED", { providerKind: "metamask" });
  value = reduce(value, "ACCOUNT_APPROVED", { account: ACCOUNT });
  return reduce(value, "CHAIN_CONFIRMED", { chainId: STANDARD_WALLET_CHAIN_ID });
}

test("success requires selected provider, approved account and exact chain 0x1917", () => {
  let value = createStandardWalletConnectState();
  value = reduce(value, "BEGIN", { pendingIntent: INTENT });
  assert.throws(() => reduce(value, "ACCOUNT_APPROVED", { account: ACCOUNT }), code("INVALID_STANDARD_WALLET_TRANSITION"));
  value = reduce(value, "PROVIDER_SELECTED", { providerKind: "metamask" });
  value = reduce(value, "ACCOUNT_APPROVED", { account: ACCOUNT });
  const wrong = reduce(value, "CHAIN_CONFIRMED", { chainId: "0x1" });
  assert.equal(wrong.status, STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN);
  assert.equal(wrong.chooserOpen, true);
  const success = reduce(value, "CHAIN_CONFIRMED", { chainId: STANDARD_WALLET_CHAIN_ID });
  assert.equal(success.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(success.chooserOpen, false);
  assert.equal(success.pendingIntent, null);
  assert.equal(success.focusRestoreTarget, "wallet-connect-trigger");
  assert.deepEqual(success.standardPermissions, ["account:read", "chain:read"]);
  assert.equal(success.productAccess, "standard-wallet-connected");
});

test("refresh restore uses eth_accounts and chain outcome without reopening chooser", () => {
  const initial = createStandardWalletConnectState();
  const restored = reduce(initial, "RESTORE", { providerKind: "metamask", accounts: [ACCOUNT], chainId: "0x1917" });
  assert.equal(restored.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(restored.chooserOpen, false);
  assert.equal(restored.pendingIntent, null);
  const noAccount = reduce(initial, "RESTORE", { providerKind: "metamask", accounts: [], chainId: "0x1917" });
  assert.equal(noAccount.status, STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED);
});

test("WalletConnect EIP-1193 transport uses the same account, chain and private-service isolation state machine", () => {
  let value = createStandardWalletConnectState();
  value = reduce(value, "BEGIN", { pendingIntent: INTENT });
  value = reduce(value, "PROVIDER_SELECTED", { providerKind: "walletconnect" });
  value = reduce(value, "ACCOUNT_APPROVED", { account: ACCOUNT });
  value = reduce(value, "CHAIN_CONFIRMED", { chainId: "0x1917" });
  assert.equal(value.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(value.providerKind, "walletconnect");
  assert.equal(reduce(value, "PRIVATE_SESSION_DEGRADED", { code: "GATEWAY_UNAVAILABLE" }).status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
});

test("Product Session degradation never blocks or reopens Standard Wallet success", () => {
  const standard = connected();
  const connecting = reduce(standard, "PRIVATE_SESSION_CONNECTING");
  const degraded = reduce(connecting, "PRIVATE_SESSION_DEGRADED", { code: "GATEWAY_UNAVAILABLE" });
  assert.equal(degraded.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(degraded.privateService, STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED);
  assert.equal(degraded.privateServiceCode, "GATEWAY_UNAVAILABLE");
  assert.equal(degraded.chooserOpen, false);
  assert.equal(degraded.account, ACCOUNT);
});

test("direct browser RPC fetch is not a connection prerequisite and CORS-safe probe degradation preserves success", () => {
  const standard = connected();
  assert.equal(standard.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(standard.rpcProbe, STANDARD_WALLET_RPC_PROBE.NOT_RUN);
  assert.throws(() => reduce(standard, "RPC_PROBE_DEGRADED", { probeTransport: "direct-browser-rpc-fetch", code: "RPC_UNAVAILABLE" }), code("UNSAFE_BROWSER_RPC_PROBE"));
  const degraded = reduce(standard, "RPC_PROBE_DEGRADED", { probeTransport: STANDARD_WALLET_RPC_PROBE_TRANSPORT, code: "RPC_UNAVAILABLE" });
  assert.equal(degraded.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(degraded.providerKind, "metamask");
  assert.equal(degraded.account, ACCOUNT);
  assert.equal(degraded.chainId, "0x1917");
  assert.equal(degraded.rpcProbe, STANDARD_WALLET_RPC_PROBE.DEGRADED);
  assert.equal(degraded.rpcProbeCode, "RPC_UNAVAILABLE");
  assert.equal(degraded.chooserOpen, false);
  const ready = reduce(degraded, "RPC_PROBE_READY", { probeTransport: STANDARD_WALLET_RPC_PROBE_TRANSPORT });
  assert.equal(ready.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(ready.rpcProbe, STANDARD_WALLET_RPC_PROBE.READY);
  assert.equal(ready.rpcProbeCode, null);
});

test("opening an already connected Wallet shows details and explicit actions", () => {
  const details = reduce(connected(), "OPEN_CHOOSER");
  assert.equal(details.chooserOpen, true);
  assert.equal(details.chooserMode, "connection-details");
  assert.deepEqual(details.chooserActions, ["disconnect", "switch-account", "close"]);
  const closed = reduce(details, "CLOSE_CHOOSER");
  assert.equal(closed.chooserOpen, false);
  assert.equal(closed.focusRestoreTarget, "wallet-connect-trigger");
});

test("account, chain and provider events are the only connection-invalidating transitions", () => {
  const standard = connected();
  assert.equal(reduce(standard, "ACCOUNTS_CHANGED", { accounts: [OTHER] }).account, OTHER);
  const empty = reduce(standard, "ACCOUNTS_CHANGED", { accounts: [] });
  assert.equal(empty.status, STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED);
  assert.equal(empty.disconnectReason, "accounts-empty");
  const wrong = reduce(standard, "CHAIN_CHANGED", { chainId: "0x1" });
  assert.equal(wrong.status, STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN);
  assert.deepEqual(wrong.standardPermissions, []);
  assert.equal(wrong.chooserOpen, true);
  assert.equal(wrong.chooserMode, "wrong-chain");
  assert.equal(wrong.productAccess, "guest-or-public-only");
  const recovered = reduce(wrong, "CHAIN_CHANGED", { chainId: "0x1917" });
  assert.equal(recovered.status, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
  assert.equal(recovered.chooserOpen, false);
  assert.equal(reduce(standard, "PROVIDER_DISCONNECT").disconnectReason, "provider-disconnect");
  assert.equal(reduce(standard, "DISCONNECT").disconnectReason, "user-disconnect");
});

test("invalid success, account, chain and private-service transitions fail closed", () => {
  const initial = createStandardWalletConnectState();
  assert.throws(() => reduce(initial, "RESTORE", { providerKind: "metamask", accounts: ["fake"], chainId: "0x1917" }), code("INVALID_STANDARD_WALLET_ACCOUNT"));
  assert.throws(() => reduce(initial, "RESTORE", { providerKind: "metamask", accounts: [ACCOUNT], chainId: "6413" }), code("INVALID_STANDARD_WALLET_CHAIN"));
  assert.throws(() => reduce(initial, "PRIVATE_SESSION_DEGRADED", { code: "GATEWAY_UNAVAILABLE" }), code("INVALID_STANDARD_WALLET_TRANSITION"));
  assert.throws(() => reduce(initial, "UNKNOWN"), code("INVALID_STANDARD_WALLET_EVENT"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
