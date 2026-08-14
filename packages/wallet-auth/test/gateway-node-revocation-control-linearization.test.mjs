import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { CanonicalWalletGatewayNodeHost, encodeGatewayProofHeader } from "../src/gateway-node-host.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const APPROVAL_REVOKE = "/v1/wallet/approvals/revoke";
const DEVICE_REVOKE = "/v1/wallet/devices/revoke";
const INTROSPECT = "/v1/wallet/sessions/introspect";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return registry;
}

function completion(registry) {
  const registration = registry.products.find(item => item.productId === "social");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: "revocation_control_race_abcdefghijklmnop",
    purpose: "Prove Approval and Device revoke controls linearize across Gateway processes.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: "revocation_control_race_challenge_abcdefghijkl",
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
  return { code: payload.error?.code ?? null, status: response.status };
}

test("independent-process Approval and Device revokes both persist before all later authority fails closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-revocation-controls-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const initializer = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const initialServer = await listen(initializer);
  try {
    assert.equal((await post(initialServer.base, "/v1/wallet/sessions/complete", canonicalJSON(completion(registry)))).status, 200);
  } finally {
    await initialServer.close();
  }
  const session = initializer.snapshot().sessionStore.sessions[0];
  const approval = await listenProcess(statePath);
  const device = await listenProcess(statePath);
  let results;
  try {
    results = await Promise.all([
      post(approval.base, APPROVAL_REVOKE, "{}", proof(session, APPROVAL_REVOKE, "control_race_approval_abcdefghijkl")),
      post(device.base, DEVICE_REVOKE, "{}", proof(session, DEVICE_REVOKE, "control_race_device_abcdefghijklmn")),
    ]);
  } finally {
    await Promise.all([approval.close(), device.close()]);
  }
  assert.deepEqual(results.map(item => item.status), [200, 200]);

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const snapshot = restarted.snapshot();
  assert.deepEqual(snapshot.sessionStore.revokedApprovalDigests, [session.approvalDigest]);
  assert.deepEqual(snapshot.sessionStore.revokedDeviceBindings, [session.deviceBinding]);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "approval-revoked").length, 1);
  assert.equal(snapshot.sessionStore.audit.filter(item => item.type === "device-revoked").length, 1);
  assert.equal(snapshot.consumedProductProofs.length, 2);

  const server = await listen(restarted);
  try {
    const body = canonicalJSON({ requiredScopes: ["account:read"] });
    const rejected = await post(server.base, INTROSPECT, body, proof(session, INTROSPECT, "control_race_after_revocation_abcdef", body));
    assert.equal(rejected.status, 403);
    assert.equal(rejected.code, "REVOKED");
  } finally {
    await server.close();
  }
  assert.equal(restarted.snapshot().consumedProductProofs.length, 2);
  assert.deepEqual(new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }).snapshot(), restarted.snapshot());
});
