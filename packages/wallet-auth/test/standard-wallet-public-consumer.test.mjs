import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  installStandardWalletWebRuntime,
  markStandardWalletPrivateServiceDegraded,
  runStandardWalletPublicConsumerHandshake,
  STANDARD_WALLET_PRIVATE_SERVICE,
  WalletAuthError,
} from "../src/index.js";
import * as publicConsumerSubpath from "@ynx-chain/wallet-auth/standard-wallet-public-consumer";

const SOURCE = "9ba0410cbdc7ecafdc085fd58eff23dc745b625b";
const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";

test("public consumer performs one source-bound 6423 handshake while Product Session is degraded", async () => {
  assert.equal(publicConsumerSubpath.runStandardWalletPublicConsumerHandshake, runStandardWalletPublicConsumerHandshake);
  const scope = browserScope("https://consumer.example");
  let privilegedCallbacks = 0;
  const installation = await installStandardWalletWebRuntime({
    scope,
    uuid: "12345678-1234-4234-8234-123456789abc",
    walletAccounts: [ACCOUNT],
    approveAccounts: async () => { privilegedCallbacks += 1; throw new Error("must not request accounts"); },
    signMessage: async () => { privilegedCallbacks += 1; throw new Error("must not sign"); },
    signTypedData: async () => { privilegedCallbacks += 1; throw new Error("must not sign"); },
    sendTransaction: async () => { privilegedCallbacks += 1; throw new Error("must not send"); },
    legacyInjection: "never",
  });
  markStandardWalletPrivateServiceDegraded(installation.runtime);
  let callbackResult;
  const result = await runStandardWalletPublicConsumerHandshake({
    scope,
    waitMs: 0,
    sourceBinding: { consumerId: "website-wallet", sourceCommit: SOURCE, publicUrl: "https://consumer.example/connect" },
    privateServiceStatus: STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED,
    async onResult(value) { callbackResult = value; },
  });
  assert.equal(callbackResult, result);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(result, {
    schemaVersion: 1, status: "ready", code: null, consumerId: "website-wallet", consumerSourceCommit: SOURCE,
    consumerUrl: "https://consumer.example/connect", wallet: "ynx-wallet", providerAvailable: true,
    identity: { name: "YNX Wallet", rdns: "com.ynx.wallet", isYNXWallet: true, isMetaMask: false },
    nativeChainId: "ynx_6423-1", evmChainId: 6423, chainId: "0x1917", privateService: "degraded",
    standardWalletPreserved: true, productSession: false, account: null,
    authority: "discovery-and-chain-readback-only", invokedMethods: ["eth_chainId"],
  });
  assert.equal(privilegedCallbacks, 0);
  assert.equal(installation.provider.selectedAddress, null);
  assert.equal(installation.provider.state.privateService, "degraded");
  installation.uninstall();
});

test("wrong network, ambiguity and missing YNX provider fail without privileged requests", async () => {
  const wrongScope = announcedScope("https://consumer.example", [ynxProvider("0x1")]);
  const wrong = await handshake(wrongScope);
  assert.equal(wrong.status, "wrong-network");
  assert.deepEqual(wrong.invokedMethods, ["eth_chainId"]);
  assert.equal(wrongScope.providers[0].calls.join("\n"), "eth_chainId");

  const ambiguousScope = announcedScope("https://consumer.example", [ynxProvider("0x1917"), ynxProvider("0x1917")]);
  const ambiguous = await handshake(ambiguousScope);
  assert.equal(ambiguous.status, "provider-ambiguous");
  assert.equal(ambiguousScope.providers.every((provider) => provider.calls.length === 0), true);

  const metamask = { isMetaMask: true, isYNXWallet: false, calls: [], async request(input) { this.calls.push(input.method); return "0x1917"; } };
  const missingScope = announcedScope("https://consumer.example", [metamask], "io.metamask");
  const missing = await handshake(missingScope);
  assert.equal(missing.status, "provider-unavailable");
  assert.deepEqual(metamask.calls, []);
});

test("source URL binding and result callback fail closed without provider authority", async () => {
  const scope = browserScope("https://consumer.example");
  await assert.rejects(() => handshake(scope, { publicUrl: "https://attacker.example/connect" }), TypeError);
  await assert.rejects(() => handshake(scope, { sourceCommit: "not-a-commit" }), TypeError);
  await assert.rejects(() => runStandardWalletPublicConsumerHandshake({
    scope, waitMs: 0, sourceBinding: binding(), privateServiceStatus: "not-requested", onResult() { throw new Error("consumer unavailable"); },
  }), (error) => error instanceof WalletAuthError && error.code === "PUBLIC_CONSUMER_CALLBACK_FAILED");
});

test("browser harness is callback-driven and contains no privileged Wallet request", () => {
  const html = readFileSync(new URL("../harness/public-consumer-handshake.html", import.meta.url), "utf8");
  assert.match(html, /runStandardWalletPublicConsumerHandshake/);
  assert.match(html, /__YNX_PUBLIC_CONSUMER_SOURCE_BINDING__/);
  assert.match(html, /ynx:standard-wallet-public-handshake/);
  assert.doesNotMatch(html, /eth_requestAccounts|personal_sign|eth_signTypedData|eth_sendTransaction|ynxwallet:|window\.open|<iframe/i);
});

async function handshake(scope, overrides = {}) {
  let callback;
  const result = await runStandardWalletPublicConsumerHandshake({ scope, waitMs: 0, sourceBinding: binding(overrides), privateServiceStatus: "not-requested", onResult(value) { callback = value; } });
  assert.equal(callback, result);
  return result;
}
function binding(overrides = {}) { return { consumerId: "website-wallet", sourceCommit: SOURCE, publicUrl: "https://consumer.example/connect", ...overrides }; }
function ynxProvider(chainId) { return { isYNXWallet: true, isMetaMask: false, providerInfo: { rdns: "com.ynx.wallet" }, calls: [], async request(input) { this.calls.push(input.method); return chainId; } }; }
function announcedScope(origin, providers, rdns = "com.ynx.wallet") {
  const scope = browserScope(origin); scope.providers = providers;
  scope.addEventListener("eip6963:requestProvider", () => providers.forEach((provider, index) => scope.dispatchEvent(new scope.CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: `12345678-1234-4234-8234-${String(index + 1).padStart(12, "0")}`, name: rdns === "com.ynx.wallet" ? "YNX Wallet" : "MetaMask", rdns }, provider } }))));
  return scope;
}
function browserScope(origin) { const scope = new EventTarget(); scope.location = { origin }; scope.Event = Event; scope.CustomEvent = globalThis.CustomEvent ?? class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } }; return scope; }
