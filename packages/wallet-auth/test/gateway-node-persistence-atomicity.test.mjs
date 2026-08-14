import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, statSync } from "node:fs";
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
    nonce: `persistence_atomic_${suffix}_abcdefghij`,
    purpose: "Prove Node state persistence failure rolls back every canonical authorization mutation.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: `persistence_challenge_${suffix}_abcdefghij`,
    expiresAt: "2026-07-15T12:03:00.000Z",
  }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function proof(session, path, nonce, body = "{}") {
  return encodeGatewayProofHeader(createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
  }, PRODUCT_DEVICE_SECRET));
}

async function serve(host, run) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function post(base, path, body, header = null) {
  const headers = { "content-type": "application/json" };
  if (header !== null) headers["x-ynx-product-session-proof"] = header;
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body });
  return { payload: await response.json(), status: response.status };
}

function persisted(statePath) {
  const envelope = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(envelope.stateDigest, gatewayStateDigest(envelope.snapshot));
  return envelope;
}

function blockTemporaryStatePath(statePath) {
  const temporary = `${statePath}.${process.pid}.tmp`;
  mkdirSync(temporary);
  return () => rmdirSync(temporary);
}

test("completion persistence failure rolls back nonce, session and audit state for exact retry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-persist-complete-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const initial = structuredClone(host.snapshot());
  const input = canonicalJSON(completion(registry, "completion"));
  const unblock = blockTemporaryStatePath(statePath);
  await serve(host, async base => {
    const failed = await post(base, "/v1/wallet/sessions/complete", input);
    assert.equal(failed.status, 500);
    assert.equal(failed.payload.error.code, "INTERNAL");
    assert.equal(failed.payload.stateDigest, gatewayStateDigest(initial));
  });
  assert.deepEqual(host.snapshot(), initial);
  assert.deepEqual(persisted(statePath).snapshot, initial);
  unblock();

  await serve(host, async base => {
    const retried = await post(base, "/v1/wallet/sessions/complete", input);
    assert.equal(retried.status, 200);
  });
  assert.equal(host.snapshot().sessionStore.sessions.length, 1);
  assert.equal(host.snapshot().sessionStore.consumedNonces.length, 1);
  assert.equal(host.snapshot().sessionStore.audit.filter(item => item.type === "session-created").length, 1);
  assert.deepEqual(persisted(statePath).snapshot, host.snapshot());
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
});

test("revoke persistence failure rolls back proof and revocation for exact retry and restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-persist-revoke-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  await serve(host, async base => {
    const completed = await post(base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "revoke")));
    assert.equal(completed.status, 200);
  });
  const session = host.snapshot().sessionStore.sessions[0];
  const before = structuredClone(host.snapshot());
  const signed = proof(session, "/v1/wallet/sessions/revoke", "persistence_revoke_proof_abcdefgh");
  const unblock = blockTemporaryStatePath(statePath);
  await serve(host, async base => {
    const failed = await post(base, "/v1/wallet/sessions/revoke", "{}", signed);
    assert.equal(failed.status, 500);
    assert.equal(failed.payload.error.code, "INTERNAL");
    assert.equal(failed.payload.stateDigest, gatewayStateDigest(before));
  });
  assert.deepEqual(host.snapshot(), before);
  assert.deepEqual(persisted(statePath).snapshot, before);
  unblock();

  await serve(host, async base => {
    const retried = await post(base, "/v1/wallet/sessions/revoke", "{}", signed);
    assert.equal(retried.status, 200);
  });
  assert.deepEqual(host.snapshot().sessionStore.revokedSessionBindings, [session.sessionBinding]);
  assert.equal(host.snapshot().consumedProductProofs.length, 1);
  assert.equal(host.snapshot().sessionStore.audit.filter(item => item.type === "session-revoked").length, 1);
  assert.deepEqual(persisted(statePath).snapshot, host.snapshot());

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const body = canonicalJSON({ requiredScopes: ["account:read"] });
  const fresh = proof(session, "/v1/wallet/sessions/introspect", "persistence_restart_proof_abcdefgh", body);
  const after = structuredClone(restarted.snapshot());
  await serve(restarted, async base => {
    const rejected = await post(base, "/v1/wallet/sessions/introspect", body, fresh);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.payload.error.code, "REVOKED");
  });
  assert.deepEqual(restarted.snapshot(), after);
});
