import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../../packages/wallet-auth/src/index.js";
import {
  ACCOUNT_SECRET,
  NOW,
  PRODUCT_DEVICE_SECRET,
  REGISTRY,
  request,
} from "../../packages/wallet-auth/test/fixtures.mjs";
import { createWalletGatewayServer, loadRegistry } from "./server.mjs";

const registryPath = new URL("../../packages/wallet-auth/central-registry.json", import.meta.url);

test("host mounts the canonical kernel and persists an accepted session before response", async t => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry("social");
  const first = await startHost({ registry, statePath });
  t.after(() => first.server.close());

  const body = canonicalJSON(completion(registry));
  const response = await fetch(`${first.url}/v1/wallet/sessions/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(first.host.snapshot().sessionStore.sessions.length, 1);
  const persisted = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(persisted.stateDigest, payload.stateDigest);
  await close(first.server);

  const restarted = await startHost({ registry, statePath });
  t.after(() => restarted.server.close());
  const health = await fetch(`${restarted.url}/health`).then(value => value.json());
  assert.equal(health.ok, true);
  assert.equal(health.service, "ynx-wallet-gatewayd");
  assert.equal(health.stateDigest, payload.stateDigest);
  assert.equal(restarted.host.snapshot().sessionStore.sessions.length, 1);
});

test("host rolls the canonical kernel back when durable persistence fails", async t => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-failure-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
  const baseline = await startHost({
    registry: approvedRegistry("social"),
    statePath,
  });
  await close(baseline.server);
  const runtime = await startHost({
    registry: approvedRegistry("social"),
    statePath,
    persist: () => {
      throw new Error("injected persistence failure");
    },
  });
  t.after(() => runtime.server.close());
  const response = await fetch(`${runtime.url}/v1/wallet/sessions/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: canonicalJSON(completion(approvedRegistry("social"))),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "PERSISTENCE_FAILURE");
  assert.equal(runtime.host.snapshot().sessionStore.sessions.length, 0);
});

test("host rejects aliases, media type widening and malformed proof headers", async t => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-shape-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = await startHost({
    registry: loadRegistry(registryPath),
    statePath: join(directory, "state.json"),
  });
  t.after(() => runtime.server.close());
  const aliased = await fetch(`${runtime.url}/v1/wallet/sessions/complete?alias=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(aliased.status, 404);
  const widened = await fetch(`${runtime.url}/v1/wallet/sessions/complete`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: "{}",
  });
  assert.equal(widened.status, 415);
  const malformed = await fetch(`${runtime.url}/v1/wallet/sessions/introspect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ynx-product-session-proof": "{",
    },
    body: "{}",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_PROOF_HEADER");
});

test("host fails startup on persisted wrapper tamper", async t => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-tamper-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
  const runtime = await startHost({
    registry: loadRegistry(registryPath),
    statePath,
  });
  await close(runtime.server);
  const persisted = JSON.parse(readFileSync(statePath, "utf8"));
  persisted.extra = true;
  writeFileSync(statePath, JSON.stringify(persisted));
  assert.throws(
    () => createWalletGatewayServer({ registry: loadRegistry(registryPath), statePath }),
    /persisted state schema is invalid/,
  );
});

function approvedRegistry(...productIDs) {
  const value = loadRegistry(registryPath);
  for (const productID of productIDs) {
    const registration = value.products.find(product => product.productId === productID);
    assert.ok(registration);
    registration.reviewState = "approved";
    registration.enabled = true;
  }
  return value;
}

function completion(registry) {
  const registration = registry.products.find(product => product.productId === "social");
  const authorizationRequest = parseAuthorizationRequest(request(), {
    now: NOW,
    registry: { [registration.productClientId]: centralProtocolEntry(registration) },
  });
  const walletApproval = signAuthorization(authorizationRequest, {
    accountSecret: ACCOUNT_SECRET,
    issuedAt: NOW.toISOString(),
  });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: "gateway_host_challenge_abcdefghijklmnop",
    expiresAt: "2026-07-15T12:03:00.000Z",
  }, NOW);
  return {
    authorizationRequest,
    walletApproval,
    gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET),
  };
}

async function startHost(options) {
  const runtime = createWalletGatewayServer({
    ...options,
    build: { commit: "test-commit", release: "test-release", buildTime: NOW.toISOString() },
    startedAt: NOW,
    now: () => NOW,
  });
  await new Promise(resolve => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  return { ...runtime, url: `http://127.0.0.1:${address.port}` };
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
