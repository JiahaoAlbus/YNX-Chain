import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AUTHORIZATION_LAUNCH_PLATFORM_MATRIX,
  createCanonicalAuthorizeLaunch,
  launchCanonicalAuthorization,
  launchNativeAuthorization,
  launchWebAuthorization,
  parseWalletDeepLink,
} from "../src/index.js";
import { NOW, REGISTRY, request } from "./fixtures.mjs";

function browserState() {
  return {
    location: { href: "https://product.example/connect" },
    topLevelPages: [{ url: "https://product.example/connect", title: "Connect" }],
    blankTargets: [],
    elementCreates: 0,
    open() { this.blankTargets.push({ url: "", title: "" }); },
    document: { createElement() { throw new Error("Web launcher must not create an element"); } },
  };
}

function assertBrowserUnchanged(page, before) {
  assert.equal(page.location.href, before.href);
  assert.equal(page.topLevelPages.length, before.pages);
  assert.deepEqual(page.topLevelPages, [{ url: before.href, title: "Connect" }]);
  assert.deepEqual(page.blankTargets, []);
  assert.equal(page.elementCreates, 0);
}

function provider(flags) { return { ...flags, async request() { throw new Error("launcher must not request accounts"); } }; }

test("platform matrix prohibits blind Web custom-scheme transport", () => {
  assert.equal(AUTHORIZATION_LAUNCH_PLATFORM_MATRIX.web.strategy, "standard-provider-discovery");
  assert.equal(AUTHORIZATION_LAUNCH_PLATFORM_MATRIX.extension.strategy, "standard-provider-discovery");
  for (const platform of ["android", "ios", "macos", "windows"]) assert.equal(AUTHORIZATION_LAUNCH_PLATFORM_MATRIX[platform].strategy, "native-resolver");
});

test("native resolver receives the complete canonical request and claims no session", async () => {
  for (const platform of ["android", "ios", "macos", "windows"]) {
    const installed = await launchNativeAuthorization(request(), platform, async (uri) => uri === createCanonicalAuthorizeLaunch(request()).uri);
    assert.equal(installed.status, "installed");
    assert.equal(installed.transport, "native-custom-scheme");
    assert.equal(parseWalletDeepLink(installed.uri, "android", { now: NOW, registry: REGISTRY }).request.nonce, request().nonce);
    assert.equal("session" in installed, false);
  }
});

test("Web without an injected provider returns actions without iframe, blank target or navigation", async () => {
  for (const platform of ["web", "extension"]) {
    const page = browserState();
    const before = { href: page.location.href, pages: page.topLevelPages.length };
    const outcome = await launchCanonicalAuthorization(request(), {
      platform,
      scope: page,
      waitMs: 0,
    });
    assert.equal(outcome.status, "unsupported");
    assert.equal(outcome.detail, "PROVIDER_NOT_INJECTED");
    assert.deepEqual(outcome.recoveryActions, ["unlock-extension", "grant-site-access", "enable-extension", "retry", "return-to-product"]);
    assert.equal(outcome.uri, null);
    assert.equal(outcome.transport, null);
    assert.deepEqual(outcome.fallbackActions.map(({ id }) => id), ["official-ynx-wallet-download", "standard-metamask"]);
    assertBrowserUnchanged(page, before);
  }
});

test("Web prefers one exact YNX EIP-1193 candidate without calling it or navigating", async () => {
  let requests = 0;
  const ynx = { isYNXWallet: true, providerInfo: { rdns: "com.ynx.wallet" }, async request() { requests += 1; } };
  const metamask = provider({ isMetaMask: true, providerInfo: { rdns: "io.metamask" } });
  const page = browserState();
  page.ethereum = { providers: [metamask, ynx] };
  const before = { href: page.location.href, pages: page.topLevelPages.length };
  const outcome = await launchWebAuthorization(request(), { scope: page, waitMs: 0 });
  assert.equal(outcome.status, "provider-ready");
  assert.equal(outcome.detail, "YNX_PROVIDER_DISCOVERED");
  assert.equal(outcome.transport, "eip-1193");
  assert.equal(outcome.uri, null);
  assert.equal(outcome.providerCandidate.provider, ynx);
  assert.equal(requests, 0);
  assertBrowserUnchanged(page, before);
});

test("ambiguous provider discovery fails closed instead of falling through to another provider", async () => {
  const scope = browserState();
  scope.ethereum = { providers: [
    provider({ isYNXWallet: true, providerInfo: { rdns: "com.ynx.wallet" } }),
    provider({ isYNXWallet: true, providerInfo: { rdns: "com.ynx.wallet.companion" } }),
    provider({ isMetaMask: true, providerInfo: { rdns: "io.metamask" } }),
  ] };
  const outcome = await launchWebAuthorization(request(), { scope, waitMs: 0 });
  assert.equal(outcome.status, "unsupported");
  assert.equal(outcome.detail, "PROVIDER_DISCOVERY_AMBIGUOUS");
  assert.equal(outcome.providerCandidate, null);
  assert.equal((await launchWebAuthorization(request(), { scope, waitMs: -1 })).detail, "PROVIDER_DISCOVERY_FAILED");
});

test("launcher source has no iframe, window.open, blank target or top-level navigation primitive", () => {
  const source = readFileSync(new URL("../src/authorize-launcher.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createElement\s*\(|<iframe|\.src\s*=|window\.open\s*\(|target\s*=\s*["']_blank|(?:window|document)\.location\s*=|location\.href\s*=/);
  assert.doesNotMatch(source, /controlled-frame-lifecycle|PAGE_HIDDEN|PAGE_HIDE|NO_VISIBILITY_TRANSITION/);
});
