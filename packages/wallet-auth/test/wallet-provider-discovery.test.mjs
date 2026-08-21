import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  WALLET_PROVIDER_DISCOVERY_AUTHORITY, WALLET_PROVIDER_DISCOVERY_STATUS, WALLET_PROVIDER_NOT_INJECTED_POSSIBLE_CAUSES, discoverEip6963WalletProviders, discoverInjectedWalletProviders,
  discoverWalletProviders, selectWalletProviderCandidates, walletAvailabilityFromDiscovery, walletConnectionChoices,
} from "../src/index.js";
import * as discoverySubpath from "@ynx-chain/wallet-auth/wallet-provider-discovery";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));

function provider(flags = {}) { return { ...flags, async request() { return "0x1917"; } }; }
function info(uuid, rdns, name = "Wallet") { return { uuid, rdns, name, icon: "data:image/svg+xml,<svg/>" }; }
function announced(providerValue, infoValue) {
  const scope = new EventTarget();
  scope.Event = Event;
  scope.addEventListener("eip6963:requestProvider", () => scope.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider: providerValue, info: infoValue } })));
  return scope;
}

test("legacy discovery prefers one exact YNX candidate and keeps MetaMask explicit", () => {
  assert.equal(discoverySubpath.discoverWalletProviders, discoverWalletProviders);
  assert.equal(Object.hasOwn(discoverySubpath, "MetaMaskEvmConnectionAdapter"), false);
  const ynx = provider({ isYNXWallet: true, providerInfo: info("11111111-1111-4111-8111-111111111111", "com.ynx.wallet.companion", "YNX Wallet") });
  const metamask = provider({ isMetaMask: true, providerInfo: info("22222222-2222-4222-8222-222222222222", "io.metamask", "MetaMask") });
  const result = discoverInjectedWalletProviders({ ethereum: { providers: [metamask, ynx] } });
  assert.equal(result.ynx.provider, ynx);
  assert.equal(result.metamask.provider, metamask);
  assert.deepEqual(walletAvailabilityFromDiscovery(result), { ynxWalletInstalled: true, metaMaskAvailable: true });
  assert.equal(result.authority, WALLET_PROVIDER_DISCOVERY_AUTHORITY);
  assert.equal(result.status, WALLET_PROVIDER_DISCOVERY_STATUS.AVAILABLE);
});

test("EIP-6963 discovery validates exact identity metadata and removes its listener", async () => {
  const wallet = provider({ isMetaMask: true });
  const scope = announced(wallet, info("33333333-3333-4333-8333-333333333333", "io.metamask", "MetaMask"));
  let active = 0;
  const add = scope.addEventListener.bind(scope), remove = scope.removeEventListener.bind(scope);
  scope.addEventListener = (type, listener) => { if (type === "eip6963:announceProvider") active += 1; return add(type, listener); };
  scope.removeEventListener = (type, listener) => { if (type === "eip6963:announceProvider") active -= 1; return remove(type, listener); };
  const result = await discoverEip6963WalletProviders(scope, 0);
  assert.equal(result.metamask.provider, wallet);
  assert.equal(result.metamask.uuid, "33333333-3333-4333-8333-333333333333");
  assert.equal(active, 0);
});

test("combined discovery de-duplicates the same provider announced and injected", async () => {
  const wallet = provider({ isMetaMask: true, providerInfo: info("44444444-4444-4444-8444-444444444444", "io.metamask", "MetaMask") });
  const scope = announced(wallet, wallet.providerInfo);
  scope.ethereum = wallet;
  const result = await discoverWalletProviders(scope, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.metamask.provider, wallet);
  assert.deepEqual(result.ambiguities, []);
});

test("discovery requests EIP-6963 before and after DOMContentLoaded and then re-reads injection", async () => {
  const wallet = provider({ isMetaMask: true, providerInfo: info("66666666-6666-4666-8666-666666666666", "io.metamask", "MetaMask") });
  const scope = new EventTarget(), documentValue = new EventTarget();
  scope.Event = Event;
  scope.document = documentValue;
  documentValue.readyState = "loading";
  let requests = 0;
  scope.addEventListener("eip6963:requestProvider", () => {
    requests += 1;
    if (documentValue.readyState === "complete") scope.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider: wallet, info: wallet.providerInfo } }));
  });
  setTimeout(() => { documentValue.readyState = "complete"; documentValue.dispatchEvent(new Event("DOMContentLoaded")); }, 1);
  const result = await discoverWalletProviders(scope, 10);
  assert.equal(result.metamask.provider, wallet);
  assert.ok(requests >= 3);
  assert.equal(result.diagnostics.readyStateStart, "loading");
  assert.equal(result.diagnostics.readyStateEnd, "complete");
  assert.equal(result.diagnostics.domContentLoadedObserved, true);
  assert.ok(result.diagnostics.eip6963RequestDispatches >= 3);
});

test("window.ethereum.providers is preferred with root fallback and no false ambiguity", () => {
  const metamask = provider({ isMetaMask: true, providerInfo: info("77777777-7777-4777-8777-777777777777", "io.metamask", "MetaMask") });
  const aggregate = provider({ isMetaMask: true, providers: [metamask] });
  const result = discoverInjectedWalletProviders({ ethereum: aggregate });
  assert.equal(result.metamask.provider, metamask);
  assert.deepEqual(result.ambiguities, []);
  assert.equal(result.diagnostics.injectedProvidersArrayObserved, true);
  assert.equal(result.diagnostics.injectedProviderCount, 1);
});

test("absence is classified as not injected without pretending to observe extension state", async () => {
  const scope = new EventTarget(); scope.Event = Event; scope.document = { readyState: "complete" };
  const result = await discoverWalletProviders(scope, 0);
  assert.equal(result.status, WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED);
  assert.deepEqual(result.possibleCauses, WALLET_PROVIDER_NOT_INJECTED_POSSIBLE_CAUSES);
  assert.equal(result.diagnostics.exactExtensionStateObservable, false);
  assert.equal(result.diagnostics.eip6963RequestDispatches, 2);
  assert.deepEqual(walletAvailabilityFromDiscovery(result), { ynxWalletInstalled: false, metaMaskAvailable: false });
});

test("multiple providers of one kind fail closed instead of auto-selecting", () => {
  const first = discoverInjectedWalletProviders({ ethereum: { providers: [
    provider({ isMetaMask: true }), provider({ isMetaMask: true }),
  ] } });
  assert.equal(first.metamask, null);
  assert.deepEqual(first.ambiguities, ["metamask"]);
  assert.equal(first.status, WALLET_PROVIDER_DISCOVERY_STATUS.AMBIGUOUS);
  assert.deepEqual(walletAvailabilityFromDiscovery(first), { ynxWalletInstalled: false, metaMaskAvailable: false });
});

test("central discovery feeds the canonical chooser with YNX priority and honest EVM fallback", () => {
  const ynx = provider({ isYNXWallet: true, providerInfo: { rdns: "com.ynx.wallet.companion" } });
  const metamask = provider({ isMetaMask: true, providerInfo: { rdns: "io.metamask" } });
  const both = discoverInjectedWalletProviders({ ethereum: { providers: [metamask, ynx] } });
  assert.deepEqual(walletConnectionChoices(registry, "dex", walletAvailabilityFromDiscovery(both)).map(({id}) => id), ["ynx-wallet", "guest"]);
  const evmOnly = discoverInjectedWalletProviders({ ethereum: metamask });
  const choices = walletConnectionChoices(registry, "dex", walletAvailabilityFromDiscovery(evmOnly));
  assert.deepEqual(choices.map(({id, action}) => [id, action]), [["download-ynx-wallet", "download"], ["metamask", "open-evm"], ["guest", "guest"]]);
  assert.equal(choices[1].ynxProductSession, false);
});

test("spoofed, conflicting, malformed and hostile providers are never selected", () => {
  const hostile = Object.defineProperty({}, "request", { get() { throw new Error("hostile getter"); } });
  const cases = [
    provider({ isYNXWallet: true }),
    provider({ isYNXWallet: true, providerInfo: { rdns: "com.ynx.wallet.attacker" } }),
    provider({ isYNXWallet: true, isMetaMask: true, providerInfo: { rdns: "com.ynx.wallet" } }),
    provider({ isMetaMask: true, providerInfo: { rdns: "com.ynx.wallet" } }),
    provider({ isYNXWallet: true, providerInfo: { rdns: "io.metamask" } }),
    provider({ isMetaMask: false, providerInfo: { rdns: "wallet.metamask.attacker" } }),
    provider({ isYNXWallet: true, providerInfo: { rdns: "COM.YNX.WALLET" } }),
    hostile,
    null,
  ];
  const result = discoverInjectedWalletProviders({ ethereum: { providers: cases } });
  assert.equal(result.ynx, null);
  assert.equal(result.metamask, null);
  assert.equal(result.candidates.length, 0);
});

test("duplicate EIP-6963 UUID with different providers is rejected as conflicted", async () => {
  const scope = new EventTarget(); scope.Event = Event;
  const id = "55555555-5555-4555-8555-555555555555";
  scope.addEventListener("eip6963:requestProvider", () => {
    scope.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider: provider({ isMetaMask: true }), info: info(id, "io.metamask") } }));
    scope.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider: provider({ isMetaMask: true }), info: info(id, "io.metamask") } }));
  });
  const result = await discoverEip6963WalletProviders(scope, 0);
  assert.equal(result.metamask, null);
  assert.equal(result.conflictedAnnouncements, 1);
});

test("invalid discovery configuration and forged results fail closed", async () => {
  await assert.rejects(() => discoverEip6963WalletProviders({}, -1), TypeError);
  assert.throws(() => selectWalletProviderCandidates({}, 0), TypeError);
  assert.throws(() => selectWalletProviderCandidates([], -1), TypeError);
  assert.throws(() => walletAvailabilityFromDiscovery({ ynx: null, metamask: null, ambiguities: [], authority: "forged" }), TypeError);
  const realMetaMask = discoverInjectedWalletProviders({ ethereum: provider({ isMetaMask: true }) }).metamask;
  assert.throws(() => walletAvailabilityFromDiscovery({ ynx: realMetaMask, metamask: null, ambiguities: [], conflictedAnnouncements: 0, authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY }), TypeError);
  const hostile = Object.defineProperty({}, "ynx", { get() { throw new Error("hostile discovery getter"); } });
  assert.throws(() => walletAvailabilityFromDiscovery(hostile), TypeError);
  const hostileScope = { ethereum: Object.defineProperty({}, "providers", { get() { throw new Error("hostile providers getter"); } }) };
  assert.equal(discoverInjectedWalletProviders(hostileScope).candidates.length, 0);
  const rejectingScope = { addEventListener() { throw new Error("registration failed"); }, removeEventListener() {}, dispatchEvent() {} };
  assert.equal((await discoverEip6963WalletProviders(rejectingScope, 0)).candidates.length, 0);
});

test("browser evidence fixture imports only the narrow discovery module and disclaims authority", () => {
  const html = readFileSync(new URL("../evidence/wallet-provider-discovery-browser.html", import.meta.url), "utf8");
  assert.match(html, /from "\.\.\/src\/wallet-provider-discovery\.js"/);
  assert.match(html, /LOCAL BROWSER MODULE FIXTURE/);
  assert.match(html, /No installed Wallet, account, Product Session, balance, signature, transaction, or Chain authority is claimed/);
  assert.doesNotMatch(html, /eth_requestAccounts|wallet_switchEthereumChain|personal_sign|eth_sendTransaction/);
});
