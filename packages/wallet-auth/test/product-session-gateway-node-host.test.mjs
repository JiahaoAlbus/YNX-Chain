import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON } from "../src/canonical.js";
import { encodeProductSessionGatewayProofHeaderV2 } from "../src/product-session-gateway-client.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { createProductSessionProofV2 } from "../src/product-session-proof-v2.js";
import { createProductSessionRequest, signProductSessionApproval, signProductSessionChallenge } from "../src/product-session-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T11:00:00.000Z");
const build = Object.freeze({ buildTime: "2026-08-14T11:00:00.000Z", release: "ynx-product-session-gateway-test", sourceCommit: "e5932a2eb0e5c01ca31a1ba6e03f9872ccf0ef7f" });
const token = (label) => createHash("sha256").update(label).digest("base64url");

test("Node host persists a complete Product Session v2 lifecycle before response and restores it after restart", async (context) => {
  const fixture = stateFixture(context);
  let challengeIndex = 0;
  const first = await start(fixture.statePath, () => token(`node-host-challenge-${challengeIndex++}`));
  const secret = Buffer.alloc(32, 23), secretText = secret.toString("base64url");
  const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
  const pending = createProductSessionRequest(registry, { productId: "finance", platform: "web", deviceId: "node-host-device-001", deviceKey, scopes: ["finance.pay.read", "finance.portfolio.read"], purpose: "Verify the exact persistent public Product Session v2 host.", nonce: token("node-host-nonce"), state: token("node-host-state") }, NOW);
  const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T11:03:00.000Z" }, NOW);
  const challengeResponse = await post(first.origin, "/v2/product-sessions/challenge", "req_node_host_challenge_001", { approval, request: pending });
  assert.equal(challengeResponse.status, 200);
  const challenge = challengeResponse.payload.result;
  const completion = signProductSessionChallenge(challenge, secretText);
  const completeResponse = await post(first.origin, "/v2/product-sessions/complete", "req_node_host_complete_0001", { approval, completion, request: pending });
  assert.equal(completeResponse.status, 200);
  const session = completeResponse.payload.result;
  await first.close();

  const second = await start(fixture.statePath, () => token(`node-host-restart-${challengeIndex++}`));
  const body = { requiredScopes: ["finance.pay.read"] };
  const proof = createProductSessionProofV2(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token("node-host-proof"), issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T11:00:30.000Z" }, secretText);
  const introspection = await post(second.origin, "/v2/product-sessions/introspect", "req_node_host_introspect_01", body, encodeProductSessionGatewayProofHeaderV2(proof));
  assert.equal(introspection.status, 200);
  assert.equal(introspection.payload.result.session.sessionBinding, session.sessionBinding);
  await second.close();

  const stateInfo = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  assert.equal(stateInfo.schemaVersion, 1);
  assert.equal(stateInfo.snapshot.schemaVersion, 2);
  assert.equal(stateInfo.snapshot.authority.sessions[0].sessionBinding, session.sessionBinding);
  assert.equal(stateInfo.snapshot.consumedProofs.length, 1);
});

test("Node host serializes 100 concurrent public mount probes and preserves every audit event across restart", async (context) => {
  const fixture = stateFixture(context);
  const running = await start(fixture.statePath, () => token("concurrent-unused"));
  const responses = await Promise.all(Array.from({ length: 100 }, (_, index) => post(running.origin, "/v2/product-sessions/challenge", `req_node_concurrent_${String(index).padStart(4, "0")}`, {})));
  assert.equal(responses.every((response) => response.status === 400 && response.payload.schemaVersion === 2 && response.payload.error.code === "UNKNOWN_OR_MISSING_FIELD"), true);
  assert.equal(running.host.snapshot().audit.length, 100);
  assert.deepEqual(running.host.snapshot().audit.map((event) => event.sequence), Array.from({ length: 100 }, (_, index) => index + 1));
  await running.close();
  const restarted = new ProductSessionGatewayNodeHost(registry, options(fixture.statePath, () => token("restart-unused")), { build, remoteDeployed: true });
  assert.equal(restarted.snapshot().audit.length, 100);
});

test("Node host exposes an exact registry-bound browser preflight without mutating Gateway state", async (context) => {
  const fixture = stateFixture(context);
  const running = await start(fixture.statePath, () => token("cors-unused"));
  const beforeState = readFileSync(fixture.statePath);
  const beforeSnapshot = running.host.snapshot();
  for (const origin of ["https://finance.ynxweb4.com", "https://www.ynxweb4.com"]) {
    const preflight = await fetch(`${running.origin}/v2/product-sessions/challenge`, {
      headers: {
        "access-control-request-headers": "accept, content-type, x-request-id, x-ynx-product-session-proof-v2",
        "access-control-request-method": "POST",
        origin,
      },
      method: "OPTIONS",
    });
    assert.equal(preflight.status, 204);
    assert.equal(await preflight.text(), "");
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Accept, Content-Type, X-Request-Id, X-YNX-Product-Session-Proof-V2");
    assert.equal(preflight.headers.get("vary"), "Origin");
  }
  assert.deepEqual(readFileSync(fixture.statePath), beforeState);
  assert.deepEqual(running.host.snapshot(), beforeSnapshot);

  const origin = "https://finance.ynxweb4.com";
  const rejected = await fetch(`${running.origin}/v2/product-sessions/challenge`, {
    body: "{}",
    headers: { "content-type": "application/json", origin, "x-request-id": "req_cors_actual_error_01" },
    method: "POST",
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.headers.get("access-control-allow-origin"), origin);
  assert.equal(rejected.headers.get("access-control-expose-headers"), "X-Request-Id");
  assert.equal(rejected.headers.get("x-request-id"), "req_cors_actual_error_01");
  await running.close();
});

test("Node host rejects unregistered origins and widened preflights without state mutation", async (context) => {
  const fixture = stateFixture(context);
  const running = await start(fixture.statePath, () => token("cors-negative-unused"));
  try {
    const cases = [
      { origin: "https://attacker.example", path: "/v2/product-sessions/challenge", method: "POST", headers: "content-type", code: "ORIGIN_NOT_ALLOWED" },
      { origin: "https://finance.ynxweb4.com.evil.example", path: "/v2/product-sessions/challenge", method: "POST", headers: "content-type", code: "ORIGIN_NOT_ALLOWED" },
      { origin: "https://finance.ynxweb4.com", path: "/v2/product-sessions/challenge", method: "DELETE", headers: "content-type", code: "PREFLIGHT_NOT_ALLOWED" },
      { origin: "https://finance.ynxweb4.com", path: "/v2/product-sessions/challenge", method: "POST", headers: "authorization", code: "PREFLIGHT_NOT_ALLOWED" },
      { origin: "https://finance.ynxweb4.com", path: "/v2/product-sessions/not-registered", method: "POST", headers: "content-type", code: "ROUTE_NOT_FOUND" },
    ];
    const beforeState = readFileSync(fixture.statePath);
    const beforeSnapshot = running.host.snapshot();
    for (const item of cases) {
      const response = await fetch(`${running.origin}${item.path}`, {
        headers: {
          "access-control-request-headers": item.headers,
          "access-control-request-method": item.method,
          origin: item.origin,
        },
        method: "OPTIONS",
      });
      assert.equal(response.status, item.code === "ROUTE_NOT_FOUND" ? 404 : 403);
      const payload = await response.json();
      assert.equal(payload.error.code, item.code);
      if (item.code === "ORIGIN_NOT_ALLOWED") assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.deepEqual(readFileSync(fixture.statePath), beforeState);
    assert.deepEqual(running.host.snapshot(), beforeSnapshot);
  } finally {
    await running.close();
  }
});

test("Node host exposes exact build identity on loopback and rejects remote identity gaps and state tamper", async (context) => {
  const fixture = stateFixture(context);
  const running = await start(fixture.statePath, () => token("identity-unused"));
  const version = await fetch(`${running.origin}/version`);
  assert.equal(version.status, 200);
  const payload = await version.json();
  assert.deepEqual(payload.build, build);
  assert.equal(payload.productSessionGatewaySchemaVersion, 2);
  assert.equal(payload.remoteDeployed, true);
  await running.close();
  assert.throws(() => new ProductSessionGatewayNodeHost(registry, options(fixture.statePath, () => token("missing-build")), { remoteDeployed: true }), { code: "INVALID_BUILD_IDENTITY" });
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  state.snapshotSha256 = "0".repeat(64);
  writeFileSync(fixture.statePath, `${canonicalJSON(state)}\n`, { encoding: "utf8", mode: 0o600 });
  assert.throws(() => new ProductSessionGatewayNodeHost(registry, options(fixture.statePath, () => token("tampered")), { build, remoteDeployed: true }), { code: "STATE_TAMPERED" });
});

test("Node host detects runtime state permission tamper before protocol mutation and remains fail closed", async (context) => {
  const fixture = stateFixture(context);
  const running = await start(fixture.statePath, () => token("runtime-permission-tamper-unused"));
  const beforeBytes = readFileSync(fixture.statePath);
  const beforeSnapshot = running.host.snapshot();
  chmodSync(fixture.statePath, 0o644);
  const response = await post(running.origin, "/v2/product-sessions/challenge", "req_runtime_mode_tamper_001", {});
  assert.equal(response.status, 503);
  assert.equal(response.payload.error.code, "INSECURE_STATE_FILE");
  assert.deepEqual(readFileSync(fixture.statePath), beforeBytes);
  assert.deepEqual(running.host.snapshot(), beforeSnapshot);
  chmodSync(fixture.statePath, 0o600);
  const afterRepair = await post(running.origin, "/v2/product-sessions/challenge", "req_runtime_mode_repair_001", {});
  assert.equal(afterRepair.status, 503);
  assert.equal(afterRepair.payload.error.code, "SERVICE_NOT_READY");
  assert.deepEqual(readFileSync(fixture.statePath), beforeBytes);
  await running.close();
});

function stateFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-node-host-"));
  chmodSync(directory, 0o700);
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  return { directory, statePath: join(directory, "state.json") };
}

function options(statePath, tokenFactory) { return { emitEvent: () => undefined, now: () => new Date(NOW), statePath, tokenFactory }; }

async function start(statePath, tokenFactory) {
  const host = new ProductSessionGatewayNodeHost(registry, options(statePath, tokenFactory), { build, remoteDeployed: true });
  const server = createServer(host.handler());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  return { host, origin: `http://127.0.0.1:${address.port}`, close: async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await host.waitForIdle(); } };
}

async function post(origin, path, requestId, value, proof = null) {
  const headers = { "content-type": "application/json", "x-request-id": requestId };
  if (proof !== null) headers["x-ynx-product-session-proof-v2"] = proof;
  const response = await fetch(`${origin}${path}`, { body: canonicalJSON(value), headers, method: "POST" });
  return { headers: response.headers, payload: await response.json(), status: response.status };
}
