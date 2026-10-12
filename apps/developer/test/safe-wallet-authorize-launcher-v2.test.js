import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTHORIZATION_LAUNCH_PLATFORM_MATRIX,
  createCanonicalAuthorizeLaunch,
  launchNativeAuthorization,
  launchWebAuthorization,
} from "../vendor/wallet-auth/src/index.js";
import { closeDeveloperWebWalletConnectionDetails, connectDeveloperWebWallet, disconnectDeveloperWebWallet, discoverDeveloperWebWalletChoices, openDeveloperWebWalletConnectionDetails, reduceDeveloperWalletPrivateServiceDegraded, reduceDeveloperWalletRpcProbeDegraded, restoreDeveloperWebWallet, subscribeDeveloperWebWalletEvents, switchDeveloperWebWalletAccount } from "../frontend/src/wallet/safe-authorize-launcher.ts";

const request = () => Object.freeze({ version:"1", nonce:"A".repeat(43), chainId:"ynx_6423-1", requestingProduct:"developer", productClientId:"ynx-developer-v1", bundleId:"com.ynxweb4.developer.testnetpreview", productDeviceAlgorithm:"p256-sha256", productDeviceKey:"A".repeat(44), callback:"ynxdeveloper://wallet-auth/callback", scopes:["account:read","developer:deploy"], purpose:"Developer launcher v2 contract test", issuedAt:"2026-08-21T00:00:00.000Z", expiresAt:"2026-08-21T00:05:00.000Z" });

function browserScope() {
  return {
    location: { href: "https://developer.ynxweb4.com/" },
    pages: ["https://developer.ynxweb4.com/"],
    opened: 0,
    createElement() { throw new Error("launcher must not create a frame"); },
    open() { this.opened += 1; },
  };
}

test("safe authorize v2 keeps Web and Extension on provider discovery with visible fallbacks", async () => {
  assert.equal(AUTHORIZATION_LAUNCH_PLATFORM_MATRIX.web.strategy, "standard-provider-discovery");
  assert.equal(AUTHORIZATION_LAUNCH_PLATFORM_MATRIX.extension.strategy, "standard-provider-discovery");
  const scope = browserScope(), before = { href: scope.location.href, pages: [...scope.pages] };
  const outcome = await launchWebAuthorization(request(), { scope, waitMs: 0 });
  assert.deepEqual({ status:outcome.status, detail:outcome.detail, uri:outcome.uri, transport:outcome.transport }, { status:"unsupported", detail:"NO_EIP1193_PROVIDER", uri:null, transport:null });
  assert.deepEqual(outcome.fallbackActions.map((item) => item.id), ["official-ynx-wallet-download", "standard-metamask"]);
  assert.equal(scope.location.href, before.href);
  assert.deepEqual(scope.pages, before.pages);
  assert.equal(scope.opened, 0);
});

test("safe authorize v2 discovers one YNX provider without navigation or account request before a product click", async () => {
  let accountRequests = 0;
  const ynx = { isYNXWallet:true, providerInfo:{rdns:"com.ynx.wallet"}, async request() { accountRequests += 1; } };
  const scope = browserScope();
  scope.ethereum = ynx;
  const outcome = await launchWebAuthorization(request(), { scope, waitMs: 0 });
  assert.equal(outcome.status, "provider-ready");
  assert.equal(outcome.detail, "YNX_PROVIDER_DISCOVERED");
  assert.equal(outcome.transport, "eip-1193");
  assert.equal(outcome.uri, null);
  assert.equal(outcome.providerCandidate.provider, ynx);
  assert.equal(accountRequests, 0);
  assert.equal(scope.opened, 0);
});

test("Developer requires an explicit browser Wallet selection when YNX Wallet and MetaMask are both injected", async () => {
  const calls = [];
  const provider = (kind) => ({
    ...(kind === "ynx-wallet" ? { isYNXWallet:true, providerInfo:{rdns:"com.ynx.wallet"} } : { isMetaMask:true, providerInfo:{rdns:"io.metamask"} }),
    async request(input) { calls.push(`${kind}:${input.method}`); if (input.method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"]; if (input.method === "eth_chainId") return "0x1917"; return null; },
  });
  const scope = browserScope();
  scope.ethereum = { providers:[provider("ynx-wallet"), provider("metamask")] };
  const choices = await discoverDeveloperWebWalletChoices(scope);
  assert.deepEqual(choices.choices.map((choice) => choice.kind), ["ynx-wallet", "metamask"]);
  const pending = await connectDeveloperWebWallet(undefined, scope);
  assert.equal(pending.status, "selection-required");
  assert.deepEqual(calls, []);
  const connected = await connectDeveloperWebWallet("metamask", scope);
  assert.equal(connected.status, "connected");
  assert.equal(connected.providerKind, "metamask");
  assert.equal(connected.connection.chooserOpen, false);
  assert.equal(connected.connection.pendingIntent, null);
  assert.equal(connected.connection.chainId, "0x1917");
  assert.deepEqual(calls, ["metamask:wallet_switchEthereumChain", "metamask:eth_requestAccounts", "metamask:eth_chainId"]);
});

test("Developer reports rejected or unavailable browser Wallet requests without retaining an account", async () => {
  const scope = browserScope();
  scope.ethereum = { isMetaMask:true, providerInfo:{rdns:"io.metamask"}, async request(input) { throw { code: input.method === "wallet_switchEthereumChain" ? 4001 : 4900 }; } };
  const rejected = await connectDeveloperWebWallet("metamask", scope);
  assert.equal(rejected.status, "unsupported");
  assert.equal(rejected.detail, "EIP1193_CHAIN_SWITCH_REJECTED");
  assert.equal(rejected.account, null);
  assert.equal(rejected.providerKind, "metamask");
  scope.ethereum = { isMetaMask:true, providerInfo:{rdns:"io.metamask"}, async request(input) { if (input.method === "wallet_switchEthereumChain") return null; throw { code: 4900 }; } };
  const unavailable = await connectDeveloperWebWallet("metamask", scope);
  assert.equal(unavailable.status, "unsupported");
  assert.equal(unavailable.detail, "EIP1193_PROVIDER_DISCONNECTED");
  assert.equal(unavailable.account, null);
});

test("Developer restores only approved accounts on the selected provider and preserves Standard Wallet through optional-service degradation", async () => {
  const calls = [];
  const provider = { isMetaMask:true, providerInfo:{rdns:"io.metamask"}, async request(input) { calls.push(input.method); if (input.method === "eth_accounts") return ["0x2222222222222222222222222222222222222222"]; if (input.method === "eth_chainId") return "0x1917"; throw new Error(`unexpected ${input.method}`); } };
  const scope = browserScope();
  scope.ethereum = provider;
  const restored = await restoreDeveloperWebWallet("metamask", scope);
  assert.equal(restored.status, "connected");
  assert.deepEqual(calls, ["eth_accounts", "eth_chainId"]);
  const privateDegraded = reduceDeveloperWalletPrivateServiceDegraded(restored.connection);
  const rpcDegraded = reduceDeveloperWalletRpcProbeDegraded(privateDegraded);
  assert.equal(rpcDegraded.status, "connected");
  assert.equal(rpcDegraded.chooserOpen, false);
  assert.equal(rpcDegraded.rpcProbe, "degraded");
  const details = openDeveloperWebWalletConnectionDetails(rpcDegraded);
  assert.equal(details.status, "connected");
  assert.equal(details.chooserOpen, true);
  assert.equal(details.chooserMode, "connection-details");
  assert.deepEqual(details.chooserActions, ["disconnect", "switch-account", "close"]);
  assert.equal(details.account, "0x2222222222222222222222222222222222222222");
  assert.equal(details.chainId, "0x1917");
  assert.equal(details.privateService, "degraded");
  const closed = closeDeveloperWebWalletConnectionDetails(details);
  assert.equal(closed.status, "connected");
  assert.equal(closed.chooserMode, "closed");
  const switchAccount = switchDeveloperWebWalletAccount(details);
  assert.equal(switchAccount.status, "disconnected");
  assert.equal(switchAccount.account, null);
  const disconnectedChooser = openDeveloperWebWalletConnectionDetails(switchAccount);
  assert.equal(disconnectedChooser.chooserOpen, true);
  assert.equal(disconnectedChooser.chooserMode, "connect");
  const locallyDisconnected = disconnectDeveloperWebWallet(rpcDegraded);
  assert.equal(locallyDisconnected.status, "disconnected");
  assert.equal(locallyDisconnected.account, null);
  assert.equal(locallyDisconnected.chooserOpen, false);
});

test("Developer invalidates only the selected provider state on account, chain or disconnect events", async () => {
  const listeners = new Map();
  const provider = {
    isMetaMask:true,
    providerInfo:{rdns:"io.metamask"},
    async request(input) { if (input.method === "eth_accounts") return ["0x3333333333333333333333333333333333333333"]; if (input.method === "eth_chainId") return "0x1917"; throw new Error(`unexpected ${input.method}`); },
    on(event, listener) { listeners.set(event, listener); },
    removeListener(event, listener) { if (listeners.get(event) === listener) listeners.delete(event); },
  };
  const scope = browserScope();
  scope.ethereum = provider;
  const restored = await restoreDeveloperWebWallet("metamask", scope);
  const transitions = [];
  const unsubscribe = await subscribeDeveloperWebWalletEvents("metamask", restored.connection, (state) => transitions.push(state), scope);
  listeners.get("chainChanged")("0x1");
  assert.equal(transitions.at(-1).status, "wrong-chain");
  listeners.get("disconnect")();
  assert.equal(transitions.at(-1).status, "disconnected");
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test("native resolver receives the exact canonical payload and cannot claim approval", async () => {
  const launch = createCanonicalAuthorizeLaunch(request());
  const outcome = await launchNativeAuthorization(request(), "macos", async (uri) => uri === launch.uri);
  assert.equal(outcome.status, "installed");
  assert.equal(outcome.transport, "native-custom-scheme");
  assert.equal("session" in outcome, false);
  assert.equal("account" in outcome, false);
});

test("launcher and Developer Web adapter contain no frame, popup, blank target or custom-scheme navigation", async () => {
  const [launcher, adapter, panel, mac] = await Promise.all([
    readFile(new URL("../vendor/wallet-auth/src/authorize-launcher.js", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/wallet/safe-authorize-launcher.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/chain/ChainPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/macos/main.m", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(launcher, /createElement\s*\(|<iframe|window\.open\s*\(|target\s*=\s*["']_blank|(?:window|document)\.location\s*=|location\.href\s*=/);
  assert.doesNotMatch(adapter + panel, /window\.open\s*\(|<iframe|target="_blank"|ynxwallet:\/\/authorize/);
  assert.match(adapter, /eth_requestAccounts/);
  assert.match(adapter, /discoverWalletProviders/);
  assert.match(adapter, /EXPLICIT_WALLET_SELECTION_REQUIRED/);
  assert.match(adapter, /wallet_addEthereumChain/);
  assert.match(adapter, /wallet_switchEthereumChain/);
  assert.match(adapter, /chainId: "0x1917"/);
  assert.ok(adapter.indexOf("wallet_switchEthereumChain") < adapter.indexOf("eth_requestAccounts"), "fixed YNX chain selection precedes the account request");
  assert.match(panel, /Connect YNX Wallet/);
  assert.match(panel, /Connect MetaMask/);
  assert.match(panel, /No Wallet is selected automatically/);
  assert.match(panel, /Disconnect this app/);
  assert.match(panel, /Switch account/);
  assert.match(panel, /chooserMode === "connection-details"/);
  assert.match(panel, /const webWalletConnectionDetails = webWalletConnection\?\.chooserOpen/);
  assert.match(panel, /webWalletConnectionDetails && \(/);
  assert.match(panel, /providerKind: webWalletConnection\.providerKind/);
  assert.match(panel, /Provider:/);
  assert.match(panel, /Network:/);
  assert.match(adapter, /switchDeveloperWebWalletAccount/);
  assert.match(adapter, /disconnectDeveloperWebWallet/);
  assert.match(mac, /URLForApplicationToOpenURL:parts\.URL/);
  assert.doesNotMatch(mac, /availability_probe_not_opened/);
});
