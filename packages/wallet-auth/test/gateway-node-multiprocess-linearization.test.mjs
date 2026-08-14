import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
    nonce: `shared_state_completion_${suffix}_abcdef`,
    purpose: "Prove shared-state Gateway linearization without asset authority.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: `shared_state_challenge_${suffix}_abcdefgh`,
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

async function listen(host) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function listenProcess(statePath) {
  const script = fileURLToPath(new URL("./helpers/gateway-node-shared-state-child.mjs", import.meta.url));
  const child = fork(script, [statePath], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.once("message", message => resolve(message.port));
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Gateway child exited before listening (${code}): ${stderr}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Gateway child close failed (${code}): ${stderr}`)));
      child.send("close");
    }),
  };
}

async function post(base, path, body, header = null) {
  const headers = { "content-type": "application/json" };
  if (header !== null) headers["x-ynx-product-session-proof"] = header;
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body });
  const payload = await response.json();
  return { code: payload.error?.code ?? null, payload, status: response.status };
}

function persisted(statePath) {
  const envelope = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(envelope.stateDigest, gatewayStateDigest(envelope.snapshot));
  return envelope.snapshot;
}

function outcomes(values) {
  return values.map(item => ({ status: item.status, code: item.code })).sort((left, right) => left.status - right.status || String(left.code).localeCompare(String(right.code)));
}

test("two in-process Gateway hosts sharing one state path preserve concurrent distinct completions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-shared-state-completion-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const firstHost = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const secondHost = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const firstServer = await listen(firstHost);
  const secondServer = await listen(secondHost);
  try {
    const results = await Promise.all([
      post(firstServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "first"))),
      post(secondServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "second"))),
    ]);
    assert.deepEqual(results.map(item => item.status), [200, 200]);
  } finally {
    await Promise.all([firstServer.close(), secondServer.close()]);
  }
  const snapshot = persisted(statePath);
  assert.equal(snapshot.sessionStore.sessions.length, 2);
  assert.equal(snapshot.sessionStore.consumedNonces.length, 2);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-created").length, 2);
  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  assert.deepEqual(restarted.snapshot(), snapshot);
});

test("two independent Gateway processes sharing one state path preserve concurrent distinct completions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-cross-process-completion-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const firstProcess = await listenProcess(statePath);
  const secondProcess = await listenProcess(statePath);
  try {
    const results = await Promise.all([
      post(firstProcess.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "process_first"))),
      post(secondProcess.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "process_second"))),
    ]);
    assert.deepEqual(results.map(item => item.status), [200, 200]);
  } finally {
    await Promise.all([firstProcess.close(), secondProcess.close()]);
  }
  const snapshot = persisted(statePath);
  assert.equal(snapshot.sessionStore.sessions.length, 2);
  assert.equal(snapshot.sessionStore.consumedNonces.length, 2);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-created").length, 2);
});

test("shared-state introspection and revoke linearize without proof or revocation loss", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-shared-state-revoke-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const initializer = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const initialServer = await listen(initializer);
  try {
    assert.equal((await post(initialServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "revoke")))).status, 200);
  } finally {
    await initialServer.close();
  }
  const session = initializer.snapshot().sessionStore.sessions[0];
  const firstHost = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const secondHost = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const firstServer = await listen(firstHost);
  const secondServer = await listen(secondHost);
  const introspectBody = canonicalJSON({ requiredScopes: ["account:read"] });
  try {
    const results = await Promise.all([
      post(firstServer.base, INTROSPECT, introspectBody, proof(session, INTROSPECT, "shared_introspect_abcdefghijklmnop", introspectBody)),
      post(secondServer.base, REVOKE, "{}", proof(session, REVOKE, "shared_revoke_abcdefghijklmnopqr")),
    ]);
    assert.equal(results[1].status, 200);
    assert.ok(results[0].status === 200 || (results[0].status === 403 && results[0].code === "REVOKED"));
  } finally {
    await Promise.all([firstServer.close(), secondServer.close()]);
  }
  const snapshot = persisted(statePath);
  assert.deepEqual(snapshot.sessionStore.revokedSessionBindings, [session.sessionBinding]);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-revoked").length, 1);
  assert.ok(snapshot.consumedProductProofs.length === 1 || snapshot.consumedProductProofs.length === 2);
});

test("two Gateway hosts produce exactly one duplicate-revoke winner", async () => {
  for (const [suffix, exact, expectedCode] of [["distinct", false, "ALREADY_REVOKED"], ["exact", true, "REPLAY"]]) {
    const directory = mkdtempSync(join(tmpdir(), `ynx-wallet-shared-state-${suffix}-`));
    const statePath = join(directory, "state.json");
    const registry = approvedRegistry();
    const initializer = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
    const initialServer = await listen(initializer);
    try {
      assert.equal((await post(initialServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, `duplicate_${suffix}`)))).status, 200);
    } finally {
      await initialServer.close();
    }
    const session = initializer.snapshot().sessionStore.sessions[0];
    const first = proof(session, REVOKE, `shared_${suffix}_first_abcdefghijklmnop`);
    const second = exact ? first : proof(session, REVOKE, `shared_${suffix}_second_abcdefghijklmnop`);
    const firstServer = await listen(new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }));
    const secondServer = await listen(new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }));
    let results;
    try {
      results = await Promise.all([
        post(firstServer.base, REVOKE, "{}", first),
        post(secondServer.base, REVOKE, "{}", second),
      ]);
    } finally {
      await Promise.all([firstServer.close(), secondServer.close()]);
    }
    assert.deepEqual(outcomes(results), outcomes([{ status: 200, code: null }, { status: 409, code: expectedCode }]));
    const snapshot = persisted(statePath);
    assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "session-revoked").length, 1);
    assert.equal(snapshot.consumedProductProofs.length, 1);
  }
});

test("unreleased shared-state lock fails closed with zero mutation and exact retry succeeds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-shared-state-lock-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const before = structuredClone(host.snapshot());
  mkdirSync(`${statePath}.lock`, { mode: 0o700 });
  const server = await listen(host);
  const body = canonicalJSON(completion(registry, "locked"));
  try {
    const rejected = await post(server.base, "/v1/wallet/sessions/complete", body);
    assert.equal(rejected.status, 503);
    assert.equal(rejected.code, "STATE_LOCKED");
    assert.deepEqual(host.snapshot(), before);
    assert.deepEqual(persisted(statePath), before);
    rmdirSync(`${statePath}.lock`);
    const accepted = await post(server.base, "/v1/wallet/sessions/complete", body);
    assert.equal(accepted.status, 200);
  } finally {
    await server.close();
  }
  assert.equal(persisted(statePath).sessionStore.sessions.length, 1);
});
