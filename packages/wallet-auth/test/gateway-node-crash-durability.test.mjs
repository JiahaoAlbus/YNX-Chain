import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
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
    nonce: `crash_durability_completion_${suffix}_abcdef`,
    purpose: "Prove acknowledged Gateway state survives immediate process termination.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: `crash_durability_challenge_${suffix}_abcdefgh`,
    expiresAt: "2026-07-15T12:03:00.000Z",
  }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function proof(session, path, nonce) {
  return encodeGatewayProofHeader(createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest("{}"),
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
  }, PRODUCT_DEVICE_SECRET));
}

async function listen(host) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
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
    kill: () => new Promise((resolve, reject) => {
      child.once("exit", (_code, signal) => signal === "SIGKILL" ? resolve() : reject(new Error(`Gateway child did not terminate by SIGKILL: ${stderr}`)));
      child.kill("SIGKILL");
    }),
  };
}

async function post(base, path, body, header = null) {
  const headers = { "content-type": "application/json" };
  if (header !== null) headers["x-ynx-product-session-proof"] = header;
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body });
  return { payload: await response.json(), status: response.status };
}

function assertPersisted(statePath, snapshot) {
  const envelope = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(envelope.stateDigest, gatewayStateDigest(envelope.snapshot));
  assert.deepEqual(envelope.snapshot, snapshot);
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
}

test("acknowledged completion survives immediate SIGKILL and cold restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-crash-completion-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const child = await listenProcess(statePath);
  const accepted = await post(child.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "accepted")));
  assert.equal(accepted.status, 200);
  await child.kill();
  assert.equal(existsSync(`${statePath}.lock`), false);

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  assert.equal(restarted.snapshot().sessionStore.sessions.length, 1);
  assert.equal(restarted.snapshot().sessionStore.consumedNonces.length, 1);
  assert.equal(restarted.snapshot().sessionStore.audit.filter(item => item.type === "session-created").length, 1);
  assertPersisted(statePath, restarted.snapshot());
});

test("acknowledged revoke survives immediate SIGKILL and cold restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-crash-revoke-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const initializer = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const initialServer = await listen(initializer);
  try {
    const accepted = await post(initialServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry, "revoke")));
    assert.equal(accepted.status, 200);
  } finally {
    await initialServer.close();
  }
  const session = initializer.snapshot().sessionStore.sessions[0];
  const child = await listenProcess(statePath);
  const revoked = await post(child.base, "/v1/wallet/sessions/revoke", "{}", proof(session, "/v1/wallet/sessions/revoke", "crash_durability_revoke_abcdefghijkl"));
  assert.equal(revoked.status, 200);
  await child.kill();
  assert.equal(existsSync(`${statePath}.lock`), false);

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  assert.deepEqual(restarted.snapshot().sessionStore.revokedSessionBindings, [session.sessionBinding]);
  assert.equal(restarted.snapshot().consumedProductProofs.length, 1);
  assert.equal(restarted.snapshot().sessionStore.audit.filter(item => item.type === "session-revoked").length, 1);
  assertPersisted(statePath, restarted.snapshot());
});
