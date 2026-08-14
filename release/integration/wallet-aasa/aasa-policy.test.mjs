import assert from "node:assert/strict";
import test from "node:test";
import { buildAASA, verifyAASA } from "./aasa-policy.mjs";

const valid = Object.freeze({
  YNX_ASSOCIATED_DOMAIN_FROZEN: "true",
  APPLE_TEAM_ID: "A1B2C3D4E5",
  WALLET_BUNDLE_ID: "com.ynxweb4.wallet",
  YNX_AASA_COMPONENTS_JSON: JSON.stringify([{ "/": "/core-frozen-path/*" }]),
});

test("generation fails closed without every production input", () => {
  assert.throws(() => buildAASA({}), /not frozen/);
  assert.throws(() => buildAASA({ ...valid, APPLE_TEAM_ID: "FAKETEAMID" }), /real 10-character/);
  assert.throws(() => buildAASA({ ...valid, WALLET_BUNDLE_ID: "com.example.wallet" }), /signed Wallet/);
  assert.throws(() => buildAASA({ ...valid, YNX_AASA_COMPONENTS_JSON: "[]" }), /non-empty/);
});

test("generation binds the real signed app to Core-provided components", () => {
  assert.deepEqual(buildAASA(valid), {
    applinks: {
      apps: [],
      details: [{
        appID: "A1B2C3D4E5.com.ynxweb4.wallet",
        components: [{ "/": "/core-frozen-path/*" }],
      }],
    },
  });
});

test("public verification rejects SPA fallback and route substitution", () => {
  const expected = buildAASA(valid);
  assert.throws(
    () => verifyAASA({ body: "<!doctype html>", contentType: "text/html", redirected: false, expected }),
    /application\/json/,
  );
  assert.throws(
    () => verifyAASA({ body: JSON.stringify(expected), contentType: "application/json", redirected: true, expected }),
    /must not redirect/,
  );
  assert.throws(
    () => verifyAASA({ body: JSON.stringify({ applinks: { apps: [], details: [] } }), contentType: "application/json", redirected: false, expected }),
    /does not match/,
  );
  assert.equal(
    verifyAASA({ body: JSON.stringify(expected), contentType: "application/json", redirected: false, expected }).valid,
    true,
  );
});
