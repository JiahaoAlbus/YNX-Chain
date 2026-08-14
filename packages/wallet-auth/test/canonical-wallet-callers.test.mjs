import assert from "node:assert/strict";
import test from "node:test";
import { classifyWalletCallerPath, scanRepository, scanWalletCallerText } from "../scripts/verify-canonical-wallet-callers.mjs";

test("canonical caller scanner rejects every frozen legacy Android URI form", () => {
  const findings = scanWalletCallerText("apps/example/MainActivity.java", `
    Uri.parse("ynx-wallet://authorize?challenge=x");
    Uri.parse("ynxwallet://sign-app-session?challenge=x");
    const binding = "ynx-wallet://com.ynxweb4.wallet";
  `);
  assert.deepEqual(new Set(findings.map(({ code }) => code)), new Set([
    "LEGACY_SCHEME",
    "LEGACY_SIGN_APP_SESSION",
    "LEGACY_WALLET_BINDING"
  ]));
});

test("canonical caller scanner requires the shared builder instead of URI concatenation", () => {
  assert.deepEqual(scanWalletCallerText(
    "apps/example/src/wallet.ts",
    "export const launch = encoded => `ynxwallet://authorize?request=${encoded}`;"
  ).map(({ code, blocking }) => ({ code, blocking })), [{ code: "MANUAL_AUTHORIZE_URI", blocking: true }]);
  assert.deepEqual(scanWalletCallerText(
    "apps/example/src/wallet.ts",
    'import {encodeRequestDeepLink} from "@ynx-chain/wallet-auth"; export const launch = encodeRequestDeepLink(request);'
  ), []);
});

test("classification separates release runtime, generated bundles and fixtures", () => {
  const paths = new Set(["apps/example/wallet-auth.js", "apps/example/wallet-auth-entry.js"]);
  assert.equal(classifyWalletCallerPath("apps/example/src/wallet.ts", paths), "release-runtime");
  assert.equal(classifyWalletCallerPath("apps/example/wallet-auth.js", paths), "release-bundle");
  assert.equal(classifyWalletCallerPath("apps/wallet/proof/harness.js", paths), "test-fixture");
  const bundle = scanWalletCallerText("apps/example/wallet-auth.js", "`ynxwallet://authorize?request=${encoded}`", { classification: "release-bundle", generatedBuilderBound: true });
  assert.deepEqual(bundle.map(({ code, blocking }) => ({ code, blocking })), [{ code: "BUNDLED_CANONICAL_URI", blocking: false }]);
  const legacyBundle = scanWalletCallerText("apps/example/wallet-auth.js", '"ynx-wallet://authorize"', { classification: "release-bundle", generatedBuilderBound: true });
  assert.equal(legacyBundle[0].blocking, true);
});

test("SDK implementation and exact vendored SDK implementation own the URI literal", () => {
  const implementation = "export function encodeRequestDeepLink(request){return `ynxwallet://authorize?request=${request}`}";
  assert.deepEqual(scanWalletCallerText("packages/wallet-auth/src/deep-link.js", implementation), []);
  assert.deepEqual(scanWalletCallerText("apps/exchange/mobile/vendor/wallet-auth/src/deep-link.js", implementation), []);
});

test("repository scan preserves the known migration blockers as direct evidence", async () => {
  const findings = await scanRepository();
  const has = (path, code) => findings.some((finding) => finding.path === path && finding.code === code);
  assert.equal(has("apps/monitor/src/App.tsx", "LEGACY_SCHEME"), true);
  assert.equal(has("apps/trust-center/mobile/android/app/src/main/java/com/ynxweb4/trust/MainActivity.java", "LEGACY_SIGN_APP_SESSION"), true);
  assert.equal(has("apps/mobile/src/api/mobileSession.ts", "LEGACY_WALLET_BINDING"), true);
  assert.ok(findings.some(({ code }) => code === "MANUAL_AUTHORIZE_URI"));
});
