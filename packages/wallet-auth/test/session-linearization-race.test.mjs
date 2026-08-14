import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductSessionProof,
  gatewayStateDigest,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { CanonicalWalletGatewayNodeHost, encodeGatewayProofHeader } from "../src/gateway-node-host.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const vector = JSON.parse(readFileSync(new URL("../testdata/session-linearization-race-v1.json", import.meta.url), "utf8"));
const INTROSPECT = "/v1/wallet/sessions/introspect";
const REVOKE = "/v1/wallet/sessions/revoke";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return registry;
}

function completion(registry, suffix) {
  const registration = registry.products.find(item => item.productId === "social");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: `linearization_completion_${suffix}_abcdef`,
    purpose: "Prove canonical single-process session lifecycle linearization without asset authority.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: `linearization_challenge_${suffix}_abcdef`,
    expiresAt: "2026-07-15T12:03:00.000Z",
  }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function proof(session, path, nonce, body = "{}", issuedAt = NOW.toISOString(), expiresAt = "2026-07-15T12:00:30.000Z") {
  return encodeGatewayProofHeader(createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce,
    issuedAt,
    expiresAt,
  }, PRODUCT_DEVICE_SECRET));
}

async function serve(host, run) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function post(base, path, body, header) {
  const headers = { "content-type": "application/json" };
  if (header !== null) headers["x-ynx-product-session-proof"] = header;
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body });
  const payload = await response.json();
  return { code: payload.error?.code ?? null, payload, status: response.status };
}

async function setup(suffix, clock = { value: NOW }) {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-linearization-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => clock.value });
  await serve(host, async base => {
    const response = await post(base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, suffix)), null);
    assert.equal(response.status, 200);
  });
  return { clock, host, registry, statePath, session: host.snapshot().sessionStore.sessions[0] };
}

function assertPersisted(host, statePath) {
  const stored = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stored.stateDigest, gatewayStateDigest(stored.snapshot));
  assert.equal(stored.stateDigest, gatewayStateDigest(host.snapshot()));
  assert.deepEqual(stored.snapshot, host.snapshot());
}

function outcomes(values) {
  return values.map(item => ({ status: item.status, code: item.code })).sort((left, right) => left.status - right.status || String(left.code).localeCompare(String(right.code)));
}

test("published session linearization race vector is exact and bounded", () => {
  assert.equal(vector.schemaVersion, 1);
  assert.equal(vector.domain, "YNX_SESSION_LINEARIZATION_RACE_V1");
  assert.equal(vector.scenarios.length, 4);
  assert.equal(new Set(vector.scenarios.map(item => item.id)).size, 4);
  assert.deepEqual(vector.routes, [INTROSPECT, REVOKE]);
  assert.equal(vector.invariants.multiProcessOrMultiRegionClaimed, false);
});

test("concurrent introspection and revoke linearize to one revoked final state", async () => {
  const { clock, host, registry, session, statePath } = await setup("introspect_revoke", { value: NOW });
  const introspectBody = canonicalJSON({ requiredScopes: ["account:read"] });
  const introspectProof = proof(session, INTROSPECT, "linearize_introspect_abcdefghijkl", introspectBody);
  const revokeProof = proof(session, REVOKE, "linearize_revoke_abcdefghijklmnop", "{}");
  let results;
  await serve(host, async base => {
    results = await Promise.all([
      post(base, INTROSPECT, introspectBody, introspectProof),
      post(base, REVOKE, "{}", revokeProof),
    ]);
  });
  assert.equal(results[1].status, 200);
  assert.ok(results[0].status === 200 || (results[0].status === 403 && results[0].code === "REVOKED"));
  const snapshot = host.snapshot();
  assert.deepEqual(snapshot.sessionStore.revokedSessionBindings, [session.sessionBinding]);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-revoked").length, 1);
  assert.ok(snapshot.consumedProductProofs.length === 1 || snapshot.consumedProductProofs.length === 2);
  assertPersisted(host, statePath);

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => clock.value });
  const fresh = proof(session, INTROSPECT, "linearize_restart_abcdefghijklmn", introspectBody);
  await serve(restarted, async base => {
    const rejected = await post(base, INTROSPECT, introspectBody, fresh);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.code, "REVOKED");
  });
  assert.deepEqual(restarted.snapshot(), snapshot);
});

test("concurrent duplicate revoke has exactly one winner for distinct or identical proofs", async () => {
  for (const [suffix, exact, expectedCode] of [["distinct", false, "ALREADY_REVOKED"], ["exact", true, "REPLAY"]]) {
    const { host, session, statePath } = await setup(`duplicate_${suffix}`);
    const first = proof(session, REVOKE, `duplicate_${suffix}_first_abcdefghij`);
    const second = exact ? first : proof(session, REVOKE, `duplicate_${suffix}_second_abcdefghi`);
    let results;
    await serve(host, async base => {
      results = await Promise.all([post(base, REVOKE, "{}", first), post(base, REVOKE, "{}", second)]);
    });
    assert.deepEqual(outcomes(results), outcomes([{ status: 200, code: null }, { status: 409, code: expectedCode }]));
    const snapshot = host.snapshot();
    assert.deepEqual(snapshot.sessionStore.revokedSessionBindings, [session.sessionBinding]);
    assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-revoked").length, 1);
    assert.equal(snapshot.consumedProductProofs.length, 1);
    assertPersisted(host, statePath);
  }
});

test("expiry-boundary introspection and revoke yield one winner without resurrection", async () => {
  const clock = { value: NOW };
  const { host, session, statePath } = await setup("expiry_boundary", clock);
  const beforeExpiry = new Date("2026-07-15T12:02:59.998Z");
  const atExpiry = new Date("2026-07-15T12:02:59.999Z");
  const queue = [beforeExpiry, atExpiry];
  Object.defineProperty(clock, "value", { get: () => queue.shift() ?? atExpiry });
  const issuedAt = "2026-07-15T12:02:29.999Z";
  const expiresAt = atExpiry.toISOString();
  const introspectBody = canonicalJSON({ requiredScopes: ["account:read"] });
  const introspectProof = proof(session, INTROSPECT, "expiry_race_introspect_abcdefghij", introspectBody, issuedAt, expiresAt);
  const revokeProof = proof(session, REVOKE, "expiry_race_revoke_abcdefghijklmn", "{}", issuedAt, expiresAt);
  let results;
  await serve(host, async base => {
    results = await Promise.all([
      post(base, INTROSPECT, introspectBody, introspectProof),
      post(base, REVOKE, "{}", revokeProof),
    ]);
  });
  assert.deepEqual(outcomes(results), outcomes([{ status: 200, code: null }, { status: 403, code: "EXPIRED" }]));
  const snapshot = host.snapshot();
  assert.equal(snapshot.consumedProductProofs.length, 1);
  assert.ok(snapshot.sessionStore.revokedSessionBindings.length === 0 || snapshot.sessionStore.revokedSessionBindings.length === 1);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-revoked").length, snapshot.sessionStore.revokedSessionBindings.length);
  assertPersisted(host, statePath);

  const after = structuredClone(host.snapshot());
  const expiredProof = proof(session, INTROSPECT, "expiry_post_boundary_abcdefghijkl", introspectBody, issuedAt, expiresAt);
  await serve(host, async base => {
    const rejected = await post(base, INTROSPECT, introspectBody, expiredProof);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.code, "EXPIRED");
  });
  assert.deepEqual(host.snapshot(), after);
});
