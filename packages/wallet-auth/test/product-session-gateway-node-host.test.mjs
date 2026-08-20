import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionProofV2, createProductSessionRequest,
  encodeProductSessionGatewayProofHeaderV2, httpBodyDigest, signProductSessionApproval,
  signProductSessionChallenge,
} from "../src/index.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const token = (label) => createHash("sha256").update(label).digest("base64url");
const deviceSecret = Buffer.alloc(32, 29);
const deviceKey = Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url");

test("production Node host mounts v2 with registered-origin CORS and restart-idempotent durable state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-v2-host-")); chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json");
  let challengeIndex = 0;
  const createHost = () => new ProductSessionGatewayNodeHost(registry, { statePath, now: () => NOW, tokenFactory: () => token(`node-host-challenge-${challengeIndex++}`) });
  try {
    const pending = createProductSessionRequest(registry, { productId: "finance", platform: "web", deviceId: "node-host-device-0001", deviceKey, scopes: ["finance.pay.read", "finance.portfolio.read"], purpose: "Verify the production v2 mount and durable restart boundary.", nonce: token("node-host-nonce"), state: token("node-host-state") }, NOW);
    const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
    const body = canonicalJSON({ request: pending, approval });
    let session;
    const firstHost = createHost();
    const first = await serve(firstHost, async (origin) => {
      const negativeSnapshot = canonicalJSON(firstHost.snapshot());
      const preflight = await fetch(`${origin}/v2/product-sessions/challenge`, { method: "OPTIONS", headers: { origin: "https://finance.ynxweb4.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-request-id" } });
      assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-origin"), "https://finance.ynxweb4.com"); assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
      const rejected = await fetch(`${origin}/v2/product-sessions/challenge`, { method: "OPTIONS", headers: { origin: "https://attacker.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-request-id" } });
      assert.equal(rejected.status, 403); assert.equal(JSON.parse(await rejected.text()).error.code, "ORIGIN_NOT_ALLOWED");
      const wrongHeader = await fetch(`${origin}/v2/product-sessions/challenge`, { method: "OPTIONS", headers: { origin: "https://finance.ynxweb4.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-unsafe-header" } });
      assert.equal(wrongHeader.status, 400); assert.equal(JSON.parse(await wrongHeader.text()).error.code, "INVALID_CORS_REQUEST");
      const wrongMethod = await fetch(`${origin}/v2/product-sessions/challenge`, { method: "GET", headers: { "x-request-id": "req_node_host_wrong_method_1" } });
      assert.equal(wrongMethod.status, 405); assert.equal(JSON.parse(await wrongMethod.text()).error.code, "METHOD_NOT_ALLOWED");
      const wrongRoute = await fetch(`${origin}/v2/product-sessions/not-mounted`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "req_node_host_wrong_route_001" }, body: "{}" });
      assert.equal(wrongRoute.status, 404); assert.equal(JSON.parse(await wrongRoute.text()).error.code, "ROUTE_NOT_FOUND");
      const wrongQuery = await fetch(`${origin}/v2/product-sessions/challenge?callback=https://attacker.example`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "req_node_host_wrong_query_001" }, body: "{}" });
      assert.equal(wrongQuery.status, 400); assert.equal(JSON.parse(await wrongQuery.text()).error.code, "INVALID_PATH");
      assert.equal(canonicalJSON(firstHost.snapshot()), negativeSnapshot);
      const response = await post(origin, body); assert.equal(response.status, 200); const challengeText = await response.text();
      const challenge = JSON.parse(challengeText).result;
      const completion = signProductSessionChallenge(challenge, deviceSecret.toString("base64url"));
      const completed = await postRoute(origin, "req_node_host_complete_0001", "/v2/product-sessions/complete", canonicalJSON({ request: pending, approval, completion }));
      assert.equal(completed.status, 200); session = JSON.parse(await completed.text()).result;
      return challengeText;
    });
    const snapshotBeforeRestart = firstHost.snapshot();
    const secondHost = createHost();
    const second = await serve(secondHost, async (origin) => {
      const response = await post(origin, body); assert.equal(response.status, 200); const challengeText = await response.text();
      const introspectBody = canonicalJSON({ requiredScopes: ["finance.pay.read"] });
      const introspectProof = proof(session, "/v2/product-sessions/introspect", introspectBody, "node-host-introspect");
      const introspected = await postRoute(origin, "req_node_host_introspect_01", "/v2/product-sessions/introspect", introspectBody, introspectProof); assert.equal(introspected.status, 200);
      const revokeBody = "{}", revokeProof = proof(session, "/v2/product-sessions/revoke", revokeBody, "node-host-revoke");
      const revoked = await postRoute(origin, "req_node_host_revoke_000001", "/v2/product-sessions/revoke", revokeBody, revokeProof); assert.equal(revoked.status, 200);
      const postRevokeProof = proof(session, "/v2/product-sessions/introspect", introspectBody, "node-host-post-revoke");
      const postRevoke = await postRoute(origin, "req_node_host_post_revoke_1", "/v2/product-sessions/introspect", introspectBody, postRevokeProof); assert.equal(postRevoke.status, 403); assert.equal(JSON.parse(await postRevoke.text()).error.code, "SESSION_REVOKED");
      return challengeText;
    });
    assert.equal(second, first);
    assert.equal(snapshotBeforeRestart.authority.sessions.length, 1);
    assert.equal(secondHost.snapshot().authority.revokedSessions.includes(session.sessionBinding), true);
    assert.equal(createHost().snapshot().authority.revokedSessions.includes(session.sessionBinding), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const [name, expectedCode, mutate] of [
  ["mode-0644", "STATE_PERMISSIONS", ({ statePath }) => chmodSync(statePath, 0o644)],
  ["hardlink", "STATE_PERMISSIONS", ({ directory, statePath }) => linkSync(statePath, join(directory, "state-hardlink.json"))],
  ["symlink", "STATE_PERMISSIONS", ({ directory, statePath }) => { const backup = join(directory, "state-target.json"); renameSync(statePath, backup); symlinkSync(backup, statePath); }],
  ["same-bytes-inode-replacement", "STATE_TAMPERED", ({ directory, statePath, beforeFile }) => { const backup = join(directory, "state-old-inode.json"); renameSync(statePath, backup); writeFileSync(statePath, beforeFile, { encoding: "utf8", mode: 0o600 }); }],
  ["snapshot-digest", "STATE_TAMPERED", ({ statePath, beforeFile }) => { const envelope = JSON.parse(beforeFile); envelope.snapshotDigest = `${envelope.snapshotDigest[0] === "0" ? "1" : "0"}${envelope.snapshotDigest.slice(1)}`; writeFileSync(statePath, canonicalJSON(envelope), "utf8"); }],
]) test(`runtime ${name} tamper fails closed with zero Product Session mutation`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-v2-tamper-")); chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json");
  try {
    const host = new ProductSessionGatewayNodeHost(registry, { statePath, now: () => NOW, tokenFactory: () => token("tamper-token") });
    const beforeFile = readFileSync(statePath, "utf8"), beforeSnapshot = canonicalJSON(host.snapshot());
    mutate({ directory, statePath, beforeFile });
    await serve(host, async (origin) => {
      const response = await fetch(`${origin}/v2/product-sessions/challenge`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "req_tamper_zero_mutation_01" }, body: "{}" });
      assert.equal(response.status, 500); assert.equal(JSON.parse(await response.text()).error.code, expectedCode);
    });
    assert.equal(canonicalJSON(host.snapshot()), beforeSnapshot);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function post(origin, body) { return fetch(`${origin}/v2/product-sessions/challenge`, { method: "POST", headers: { "content-type": "application/json", origin: "https://finance.ynxweb4.com", "x-request-id": "req_node_host_challenge_001" }, body }); }
async function postRoute(origin, requestId, path, body, proofHeader = null) { return fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://finance.ynxweb4.com", "x-request-id": requestId, ...(proofHeader ? { "x-ynx-product-session-proof-v2": proofHeader } : {}) }, body }); }
function proof(session, path, body, label) { return encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session, { method: "POST", path, bodyDigest: httpBodyDigest(body), nonce: token(label), issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T01:00:30.000Z" }, deviceSecret.toString("base64url"))); }
async function serve(host, callback) { const server = createServer(host.handler()); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); try { return await callback(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); } }
