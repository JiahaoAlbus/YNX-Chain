import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runStandardWalletPublicConsumerHandshake,
  STANDARD_WALLET_PRIVATE_SERVICE,
  WalletAuthError,
} from "../src/index.js";
import * as publicConsumerSubpath from "@ynx-chain/wallet-auth/standard-wallet-public-consumer";

const SOURCE = "f418a8dbc36aa4855396741fed8cafac5d498858";

test("source-bound public handshake reads only 0x1917 while private service is degraded", async () => {
  assert.equal(publicConsumerSubpath.runStandardWalletPublicConsumerHandshake, runStandardWalletPublicConsumerHandshake);
  const provider = ynxProvider("0x1917");
  const scope = announcedScope("https://consumer.example", [provider]);
  let callback;
  const result = await handshake(scope, { privateServiceStatus: STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED, onResult(value) { callback = value; } });
  assert.equal(callback, result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.status, "ready");
  assert.equal(result.privateService, "degraded");
  assert.equal(result.account, null);
  assert.equal(result.productSession, false);
  assert.deepEqual(result.invokedMethods, ["eth_chainId"]);
  assert.deepEqual(provider.calls, ["eth_chainId"]);
});

test("wrong network, ambiguity, identity mismatch and missing source binding fail before authority", async () => {
  const wrongProvider = ynxProvider("0x1");
  const wrong = await handshake(announcedScope("https://consumer.example", [wrongProvider]));
  assert.equal(wrong.status, "wrong-network");
  assert.deepEqual(wrongProvider.calls, ["eth_chainId"]);

  const first = ynxProvider("0x1917"), second = ynxProvider("0x1917");
  const ambiguous = await handshake(announcedScope("https://consumer.example", [first, second]));
  assert.equal(ambiguous.status, "provider-ambiguous");
  assert.deepEqual(first.calls, []); assert.deepEqual(second.calls, []);

  const mixed = { ...ynxProvider("0x1917"), isMetaMask: true };
  const mismatch = await handshake(announcedScope("https://consumer.example", [mixed]));
  // Discovery rejects the mixed identity before this consumer can select it.
  assert.equal(mismatch.code, "YNX_PROVIDER_UNAVAILABLE");
  assert.deepEqual(mixed.calls, []);

  await assert.rejects(() => handshake(announcedScope("https://consumer.example", [ynxProvider("0x1917")]), { sourceBinding: { consumerId: "router", sourceCommit: SOURCE, publicUrl: "https://attacker.example/connect" } }), TypeError);
});

test("result callback failure remains explicit and cannot gain provider authority", async () => {
  const scope = announcedScope("https://consumer.example", [ynxProvider("0x1917")]);
  await assert.rejects(() => handshake(scope, { onResult() { throw new Error("consumer unavailable"); } }), (error) => error instanceof WalletAuthError && error.code === "PUBLIC_CONSUMER_CALLBACK_FAILED");
});

async function handshake(scope, overrides = {}) {
  return runStandardWalletPublicConsumerHandshake({
    scope,
    waitMs: 0,
    sourceBinding: { consumerId: "router", sourceCommit: SOURCE, publicUrl: "https://consumer.example/connect" },
    privateServiceStatus: STANDARD_WALLET_PRIVATE_SERVICE.NOT_REQUESTED,
    onResult() {},
    ...overrides,
  });
}
function ynxProvider(chainId) { return { isYNXWallet: true, isMetaMask: false, providerInfo: { rdns: "com.ynx.wallet" }, calls: [], async request(input) { this.calls.push(input.method); return chainId; } }; }
function announcedScope(origin, providers) {
  const scope = new EventTarget();
  scope.location = { origin };
  scope.CustomEvent = globalThis.CustomEvent ?? class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
  scope.addEventListener("eip6963:requestProvider", () => providers.forEach((provider, index) => scope.dispatchEvent(new scope.CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: `12345678-1234-4234-8234-${String(index + 1).padStart(12, "0")}`, name: "YNX Wallet", rdns: "com.ynx.wallet" }, provider } }))));
  return scope;
}
