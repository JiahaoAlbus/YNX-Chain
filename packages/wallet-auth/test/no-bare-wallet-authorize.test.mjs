import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bareAuthorizationFindings, verifyNoBareWalletAuthorize } from "../scripts/verify-no-bare-wallet-authorize.mjs";

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
