import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTHORIZATION_LAUNCH_PLATFORM_MATRIX,
  createCanonicalAuthorizeLaunch,
  launchNativeAuthorization,
  launchWebAuthorization,
} from "../vendor/wallet-auth/src/index.js";

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
  assert.match(adapter, /wallet_addEthereumChain/);
  assert.match(adapter, /wallet_switchEthereumChain/);
  assert.match(adapter, /chainId: "0x1917"/);
  assert.ok(adapter.indexOf("wallet_switchEthereumChain") < adapter.indexOf("eth_requestAccounts"), "fixed YNX chain selection precedes the account request");
  assert.match(mac, /URLForApplicationToOpenURL:parts\.URL/);
  assert.doesNotMatch(mac, /availability_probe_not_opened/);
});
