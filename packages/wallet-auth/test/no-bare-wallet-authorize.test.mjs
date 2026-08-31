import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  bareAuthorizationFindings,
  consumerAuthorizationFindings,
  legacyCallbackShorthandFindings,
  noncanonicalWalletAuthorizeFindings,
  verifyNoBareWalletAuthorize,
  webAuthorizationBehaviorFindings,
  webWalletCapabilityAudit,
} from "../scripts/verify-no-bare-wallet-authorize.mjs";

test("release source gate rejects bare, empty and wrong-query authorization URIs", () => {
  for (const source of [
    `open("ynxwallet://authorize")`,
    `location.href = "ynxwallet://authorize?"`,
    `launch("ynxwallet://authorize?request=")`,
    `open("ynxwallet://authorize?redirect=attacker")`,
    `open("ynxwallet://authorize" + payload)`,
  ]) assert.equal(bareAuthorizationFindings("apps/example/connect.ts", source).length, 1);
});

test("release source gate accepts only a visibly populated request parameter", () => {
  assert.deepEqual(bareAuthorizationFindings("apps/example/connect.ts", "open(`ynxwallet://authorize?request=${payload}`)"), []);
  assert.deepEqual(bareAuthorizationFindings("packages/wallet-auth/src/product-session-registry.js", `value !== "ynxwallet://authorize"`), []);
});

test("current publishable source contains no bare authorization URI", async () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  assert.deepEqual(await verifyNoBareWalletAuthorize(root), []);
});

test("release check chains the cross-product consumer audit instead of treating the package check as migration proof", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["check:release"], "npm run check && npm run audit:authorize-consumers");
});

test("consumer audit rejects Web custom-scheme and native manual URI construction", () => {
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/connect.ts", "location.assign(`ynxwallet://authorize?request=${payload}`)"), [
    { file: "apps/example/web/connect.ts", line: 1, code: "WEB_TOP_LEVEL_WALLET_AUTHORIZATION_NAVIGATION" },
    { file: "apps/example/web/connect.ts", line: 1, code: "WEB_CUSTOM_SCHEME_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/android/MainActivity.java", `open("ynxwallet://authorize?request=" + payload)`), [
    { file: "apps/example/android/MainActivity.java", line: 1, code: "MANUAL_WALLET_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/connect.ts", "launchWebAuthorization(request, {scope: globalThis})"), []);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/app/src/main/java/Launcher.java", `open("ynxwallet://authorize?request=" + payload)`), [
    { file: "apps/example/app/src/main/java/Launcher.java", line: 1, code: "MANUAL_WALLET_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("wallet-auth.js", "location.assign(`ynxwallet://authorize?request=${payload}`)"), [
    { file: "wallet-auth.js", line: 1, code: "WEB_TOP_LEVEL_WALLET_AUTHORIZATION_NAVIGATION" },
    { file: "wallet-auth.js", line: 1, code: "WEB_CUSTOM_SCHEME_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("internal/example/authority.go", `DeepLink: "ynxwallet://authorize?request=<base64url>"`), []);
});

test("consumer audit does not mistake the protocol-owned canonical builder for a product consumer", () => {
  assert.deepEqual(consumerAuthorizationFindings("packages/wallet-auth/src/deep-link.js", "const route = `ynxwallet://authorize?request=${encoded}`"), []);
});

test("consumer audit rejects direct legacy callback shorthand while preserving protocol-owned migration", () => {
  assert.deepEqual(legacyCallbackShorthandFindings("apps/example/android/MainActivity.java", `Uri.parse("ynx-social")`), [
    { file: "apps/example/android/MainActivity.java", line: 1, code: "LEGACY_CALLBACK_SCHEME_SHORTHAND" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/wallet.js", `const callback = "ynx-social";`), [
    { file: "apps/example/web/wallet.js", line: 1, code: "LEGACY_CALLBACK_SCHEME_SHORTHAND" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/wallet.js", `const productId = "ynx-social";`), []);
  assert.deepEqual(consumerAuthorizationFindings("packages/wallet-auth/src/product-session-registry.js", `const legacyCallbacks = ["ynx-social"];`), []);
});

test("consumer audit rejects a YNX-like but noncanonical authorization scheme", () => {
  assert.deepEqual(noncanonicalWalletAuthorizeFindings("apps/example/web/wallet.js", "location.href = \"ynx-wallet://authorize?request=payload\""), [
    { file: "apps/example/web/wallet.js", line: 1, code: "NONCANONICAL_WALLET_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/wallet.js", "location.href = \"ynx-wallet://authorize?request=payload\""), [
    { file: "apps/example/web/wallet.js", line: 1, code: "WEB_TOP_LEVEL_WALLET_AUTHORIZATION_NAVIGATION" },
    { file: "apps/example/web/wallet.js", line: 1, code: "NONCANONICAL_WALLET_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(noncanonicalWalletAuthorizeFindings("apps/example/web/wallet.js", `const callback = "ynxsocial://wallet-auth/callback";`), []);
});

test("Web behavior audit rejects indirect top-level navigation and handwritten request encoding", () => {
  assert.deepEqual(webAuthorizationBehaviorFindings("apps/example/web/app.js", "location.href = await walletAuthorizationURL(request)"), [
    { file: "apps/example/web/app.js", line: 1, code: "WEB_TOP_LEVEL_WALLET_AUTHORIZATION_NAVIGATION" },
  ]);
  const handwritten = `const productClientId="example"; const productDeviceKey="key";\nconst encoded=base64url(new TextEncoder().encode(JSON.stringify({productClientId,productDeviceKey})));\nlocation.assign("ynxwallet://authorize?request="+encoded);`;
  assert.deepEqual(webAuthorizationBehaviorFindings("apps/example/web/wallet.js", handwritten), [
    { file: "apps/example/web/wallet.js", line: 3, code: "WEB_TOP_LEVEL_WALLET_AUTHORIZATION_NAVIGATION" },
    { file: "apps/example/web/wallet.js", line: 2, code: "HANDWRITTEN_AUTHORIZATION_REQUEST_ENCODING" },
  ]);
});

test("Web capability audit records provider, MetaMask, fallback and degradation primitives without claiming runtime", () => {
  assert.deepEqual(webWalletCapabilityAudit("apps/example/web/wallet.js", `
    // EIP-6963 EIP-1193 PRIVATE_SERVICE_DEGRADED
    launchWebAuthorization(request);
    provider.request({method:"eth_requestAccounts"});
    provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x1917"}]});
    provider.request({method:"wallet_addEthereumChain",params:[{chainId:"0x1917"}]});
    const ynx="https://www.ynxweb4.com/dapp/download";
    const mm="https://metamask.io/download/";
  `), {
    eip6963: true,
    eip1193: true,
    ethRequestAccounts: true,
    switchChain0x1917: true,
    addChain0x1917: true,
    officialWalletAction: true,
    officialMetaMaskAction: true,
    safeLauncherV2Call: true,
    productSessionDegraded: true,
  });
});
