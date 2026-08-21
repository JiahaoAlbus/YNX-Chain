import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  bareAuthorizationFindings,
  consumerAuthorizationFindings,
  verifyNoBareWalletAuthorize,
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

test("consumer audit rejects Web custom-scheme and native manual URI construction", () => {
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/connect.ts", "location.assign(`ynxwallet://authorize?request=${payload}`)"), [
    { file: "apps/example/web/connect.ts", line: 1, code: "WEB_CUSTOM_SCHEME_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/android/MainActivity.java", `open("ynxwallet://authorize?request=" + payload)`), [
    { file: "apps/example/android/MainActivity.java", line: 1, code: "MANUAL_WALLET_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/web/connect.ts", "launchWebAuthorization(request, {scope: globalThis})"), []);
  assert.deepEqual(consumerAuthorizationFindings("apps/example/app/src/main/java/Launcher.java", `open("ynxwallet://authorize?request=" + payload)`), [
    { file: "apps/example/app/src/main/java/Launcher.java", line: 1, code: "MANUAL_WALLET_AUTHORIZE_URI" },
  ]);
  assert.deepEqual(consumerAuthorizationFindings("internal/example/authority.go", `DeepLink: "ynxwallet://authorize?request=<base64url>"`), []);
});

test("consumer audit does not mistake the protocol-owned canonical builder for a product consumer", () => {
  assert.deepEqual(consumerAuthorizationFindings("packages/wallet-auth/src/deep-link.js", "const route = `ynxwallet://authorize?request=${encoded}`"), []);
});
