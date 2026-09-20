import assert from "node:assert/strict";
import test from "node:test";
import { walletConnectRuntimeConfig } from "./runtime";

test("WalletConnect is explicitly disabled without a project ID", () => assert.equal(walletConnectRuntimeConfig({}), null));
test("WalletConnect accepts one bounded external project ID", () => assert.deepEqual(walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: "A".repeat(32) }), { projectId: "a".repeat(32),relayUrl:"wss://relay.walletconnect.com" }));
test("WalletConnect rejects malformed project IDs without contacting a relay", () => {
  for (const value of ["x", "a".repeat(31), "a".repeat(33), "../secret", "a".repeat(31) + "-"]) assert.throws(() => walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: value }));
  assert.equal(walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: " " }), null);
});
