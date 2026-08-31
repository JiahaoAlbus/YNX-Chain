import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyProductSessionStateToStandardWallet,
  createStandardWalletConnectState,
  productSessionStateToStandardWalletPrivateServiceEvent,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_PRIVATE_SERVICE,
  WalletAuthError,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";

function connected() {
  let state = createStandardWalletConnectState();
  state = reduceStandardWalletConnectState(state, { type: "BEGIN", pendingIntent: "private_service_bridge_1234" });
  state = reduceStandardWalletConnectState(state, { type: "PROVIDER_SELECTED", providerKind: "metamask" });
  state = reduceStandardWalletConnectState(state, { type: "ACCOUNT_APPROVED", account: ACCOUNT });
  return reduceStandardWalletConnectState(state, { type: "CHAIN_CONFIRMED", chainId: "0x1917" });
}

test("canonical Product Session outages degrade an established Standard Wallet without changing its authority", () => {
  const original = connected();
  const degraded = applyProductSessionStateToStandardWallet(original, { status: "network-unavailable", code: "GATEWAY_UNAVAILABLE" });
  assert.equal(degraded.status, "connected");
  assert.equal(degraded.account, ACCOUNT);
  assert.equal(degraded.chainId, "0x1917");
  assert.equal(degraded.privateService, STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED);
  assert.equal(degraded.privateServiceCode, "GATEWAY_UNAVAILABLE");
  assert.equal(degraded.chooserOpen, false);

  const routeUnavailable = applyProductSessionStateToStandardWallet(degraded, { status: "retry-required", code: "ROUTE_NOT_MOUNTED" });
  assert.equal(routeUnavailable.status, "connected");
  assert.equal(routeUnavailable.privateServiceCode, "ROUTE_NOT_MOUNTED");
});

test("unclassified, Guest, and disconnected Product Session states cannot change Standard Wallet authority", () => {
  const original = connected();
  assert.equal(productSessionStateToStandardWalletPrivateServiceEvent({ status: "retry-required" }), null);
  assert.equal(productSessionStateToStandardWalletPrivateServiceEvent({ status: "guest" }), null);
  assert.equal(productSessionStateToStandardWalletPrivateServiceEvent({ status: "disconnected" }), null);
  assert.equal(applyProductSessionStateToStandardWallet(original, { status: "retry-required" }), original);
  assert.equal(applyProductSessionStateToStandardWallet(original, { status: "guest" }), original);
});

test("the bridge fails closed for malformed or noncanonical private-service failure states", () => {
  assert.throws(() => productSessionStateToStandardWalletPrivateServiceEvent({ status: "network-unavailable", code: "NETWORK_UNAVAILABLE" }), code("UNCLASSIFIED_PRODUCT_SESSION_FAILURE"));
  assert.throws(() => productSessionStateToStandardWalletPrivateServiceEvent({ status: "unknown", code: "GATEWAY_UNAVAILABLE" }), code("INVALID_PRODUCT_SESSION_STATE"));
  assert.throws(() => applyProductSessionStateToStandardWallet(createStandardWalletConnectState(), { status: "network-unavailable", code: "GATEWAY_UNAVAILABLE" }), code("INVALID_STANDARD_WALLET_TRANSITION"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
