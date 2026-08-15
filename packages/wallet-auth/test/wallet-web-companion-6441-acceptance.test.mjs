import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyWalletWebCompanionCorsBoundary, WALLET_WEB_COMPANION_ORIGIN } from "../scripts/verify-wallet-web-companion-6441-acceptance.mjs";

const handoff = JSON.parse(readFileSync(new URL("../../../release/integration/wallet-web-companion-6441-deployment-handoff.json", import.meta.url), "utf8"));

function headers(origin = null) { return origin === null ? {} : { "access-control-allow-headers": "Content-Type, X-Request-Id, X-YNX-Product-Session-Proof-V2", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-origin": origin, vary: "Origin" }; }
function fixture({ rejectApproved = false } = {}) { return async (_url, init) => {
  const origin = new Headers(init.headers).get("origin"); const method = new Headers(init.headers).get("access-control-request-method");
  if (origin !== WALLET_WEB_COMPANION_ORIGIN) return new Response("", { status: 403 });
  if (method !== "POST") return new Response("", { status: 405 });
  return new Response(rejectApproved ? "" : null, { status: rejectApproved ? 403 : 204, headers: headers(rejectApproved ? null : origin) });
}; }

test("6441 Web companion CORS boundary accepts only the exact Origin and POST contract", async () => {
  const result = await verifyWalletWebCompanionCorsBoundary({ endpoint: "https://rest.ynxweb4.com", fetchImplementation: fixture() });
  assert.deepEqual(result, { approvedOrigin: WALLET_WEB_COMPANION_ORIGIN, approvedStatus: 204, endpoint: "https://rest.ynxweb4.com", unapprovedStatus: 403, wrongMethodStatus: 405 });
});

test("current public mismatch shape fails closed instead of promoting gatewayLoadedPublic", async () => {
  await assert.rejects(verifyWalletWebCompanionCorsBoundary({ endpoint: "https://rest.ynxweb4.com", fetchImplementation: fixture({ rejectApproved: true }) }), (error) => error?.code === "APPROVED_ORIGIN_REJECTED");
});

test("6441 owner handoff binds the exact Core candidate, registry and acceptance command without public promotion", () => {
  assert.equal(handoff.coreCandidate.commit, "f5e0ef319b0fe8ff0993021e435fdc6627b0d931");
  assert.equal(handoff.coreCandidate.productSessionRegistrySha256, "f8a25702bdc7e3bd12b0cdecd6ac513b0a3d3ac25832a112efbe6b788ff8de9b");
  assert.match(handoff.acceptance.command, /YNX_WALLET_WEB_COMPANION_6441_SOURCE=\$DEPLOYED_SOURCE_COMMIT/);
  assert.equal(handoff.truthBoundary.deployedByCore, false);
  assert.equal(handoff.truthBoundary.gatewayLoadedPublic, false);
});
