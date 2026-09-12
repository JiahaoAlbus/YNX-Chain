import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionProofV2, createProductSessionRequest,
  encodeProductSessionGatewayProofHeaderV2, httpBodyDigest,
  signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { ProductSessionControlNodeHost } from "../src/product-session-control-node-host.js";
import { migrateProductSessionControlStateFileV2 } from "../src/product-session-control-node-store.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const additions = ["ai", "cloud", "docs"];
// Fixed historical input: c97f85e9ae4d4580b99860c51738e6040ca9ca18 registry,
// with its three additions omitted once at fixture creation. Never derive history
// from the current registry: existing products may legitimately gain new scopes.
const legacyRegistry = {
  "schemaVersion": 2,
  "chainId": "ynx_6423-1",
  "wallet": {
    "authorizeCallback": "ynxwallet://authorize",
    "downloadUrl": "https://www.ynxweb4.com/dapp/download",
    "metaMaskDownloadUrl": "https://metamask.io/download"
  },
  "products": [
    {
      "productId": "calendar",
      "clientId": "ynx-calendar-v1",
      "displayName": "YNX Calendar",
      "applicationId": "com.ynxweb4.calendar",
      "webOrigin": "https://calendar.ynxweb4.com",
      "nativeCallback": "ynxcalendar://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxcalendar",
        "ynxcalendar://wallet-auth/callback"
      ],
      "scopes": [
        "calendar:account",
        "calendar:recover"
      ],
      "evmCompatible": false,
      "sessionDurationSeconds": 240
    },
    {
      "productId": "card",
      "clientId": "ynx-card-v1",
      "displayName": "YNX Card",
      "applicationId": "com.ynxweb4.card",
      "webOrigin": "https://card.ynxweb4.com",
      "nativeCallback": "ynxcard://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxcard",
        "ynxcard://wallet-auth/callback"
      ],
      "scopes": [
        "account:read",
        "card:application:write",
        "card:controls:write",
        "card:dispute:write"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 180
    },
    {
      "productId": "creator-studio",
      "clientId": "ynx-creator-studio-web-v1",
      "displayName": "YNX Creator Studio",
      "applicationId": "com.ynxweb4.creator-studio",
      "webOrigin": "https://creator.ynxweb4.com",
      "nativeCallback": "ynxcreator://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxcreator",
        "ynxcreator://wallet-auth/callback"
      ],
      "scopes": [
        "creator:account",
        "creator:publish",
        "creator:revenue"
      ],
      "evmCompatible": false,
      "sessionDurationSeconds": 240
    },
    {
      "productId": "developer",
      "clientId": "ynx-developer-v1",
      "displayName": "YNX Developer",
      "applicationId": "com.ynxweb4.developer.testnetpreview",
      "webOrigin": "https://developer.ynxweb4.com",
      "nativeCallback": "ynxdeveloper://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxdeveloper",
        "ynxdeveloper://wallet-auth/callback"
      ],
      "scopes": [
        "account:read",
        "developer:deploy"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 180
    },
    {
      "productId": "dex",
      "clientId": "ynx-dex-v1",
      "displayName": "YNX DEX",
      "applicationId": "com.ynxweb4.dex",
      "webOrigin": "https://dex.ynxweb4.com",
      "nativeCallback": "ynxdex://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxdex",
        "ynxdex://wallet-auth/callback"
      ],
      "scopes": [
        "dex:account",
        "dex:orders",
        "dex:trade"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 180
    },
    {
      "productId": "exchange",
      "clientId": "ynx-exchange-v1",
      "displayName": "YNX Exchange",
      "applicationId": "com.ynxweb4.exchange",
      "webOrigin": "https://exchange.ynxweb4.com",
      "nativeCallback": "ynxexchange://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxexchange",
        "ynxexchange://wallet-auth/callback"
      ],
      "scopes": [
        "exchange:ai",
        "exchange:deposit",
        "exchange:read",
        "exchange:trade",
        "exchange:withdrawal-review"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 180
    },
    {
      "productId": "finance",
      "clientId": "ynx-finance-v1",
      "displayName": "YNX Finance",
      "applicationId": "com.ynxweb4.finance",
      "webOrigin": "https://finance.ynxweb4.com",
      "nativeCallback": "ynxfinance://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxfinance",
        "ynxfinance://wallet-auth/callback"
      ],
      "scopes": [
        "finance.ai.draft",
        "finance.pay.read",
        "finance.portfolio.read",
        "finance.profile.write"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 240
    },
    {
      "productId": "pay",
      "clientId": "ynx-pay-v1",
      "displayName": "YNX Pay",
      "applicationId": "com.ynxweb4.pay",
      "webOrigin": "https://pay.ynxweb4.com",
      "nativeCallback": "ynxpay://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxpay",
        "ynxpay://wallet-auth/callback"
      ],
      "scopes": [
        "account:read",
        "pay:case:create",
        "pay:settlement:submit"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 180
    },
    {
      "productId": "quant",
      "clientId": "ynx-quant-v1",
      "displayName": "YNX Quant",
      "applicationId": "com.ynxweb4.quant",
      "webOrigin": "https://quant.ynxweb4.com",
      "nativeCallback": "ynxquant://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxquant",
        "ynxquant://wallet-auth/callback"
      ],
      "scopes": [
        "quant:account",
        "quant:mandate:create",
        "quant:mandate:execute",
        "quant:mandate:revoke"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 180
    },
    {
      "productId": "shop",
      "clientId": "ynx-shop-v1",
      "displayName": "YNX Shop",
      "applicationId": "com.ynxweb4.shop",
      "webOrigin": "https://shop.ynxweb4.com",
      "nativeCallback": "ynxshop://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxshop",
        "ynxshop://wallet-auth/callback"
      ],
      "scopes": [
        "account:read",
        "shop:orders:write",
        "shop:profile:write"
      ],
      "evmCompatible": true,
      "sessionDurationSeconds": 240
    },
    {
      "productId": "social",
      "clientId": "ynx-social-v1",
      "displayName": "YNX Social",
      "applicationId": "com.ynx.social",
      "webOrigin": "https://social.ynxweb4.com",
      "nativeCallback": "ynx-social://com.ynx.social",
      "legacyCallbacks": [
        "ynx-social",
        "ynx-social://com.ynx.social"
      ],
      "scopes": [
        "account:read",
        "profile:link"
      ],
      "evmCompatible": false,
      "sessionDurationSeconds": 240
    },
    {
      "productId": "video",
      "clientId": "ynx-video-mobile-v1",
      "displayName": "YNX Video",
      "applicationId": "com.ynxweb4.video",
      "webOrigin": "https://video.ynxweb4.com",
      "nativeCallback": "ynxvideo://wallet-auth/callback",
      "legacyCallbacks": [
        "ynxvideo",
        "ynxvideo://wallet-auth/callback"
      ],
      "scopes": [
        "video:account",
        "video:library",
        "video:playback"
      ],
      "evmCompatible": false,
      "sessionDurationSeconds": 300
    }
  ]
};
const sha = value => createHash("sha256").update(value).digest("hex");
const token = value => createHash("sha256").update(value).digest("base64url");
const NOW = new Date("2026-09-12T00:00:00.000Z");
// Synthetic local signing fixtures; never read an installed Wallet or call a public Gateway.
const accountSecret = "1".padStart(64, "0"), deviceSecret = Buffer.alloc(32, 43).toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(Buffer.from(deviceSecret, "base64url"), true)).toString("base64url");

function approved(source, productId, label) {
  const product = source.products.find(item => item.productId === productId);
  const request = createProductSessionRequest(source, {
    productId, platform: "web", deviceId: `upgrade-device-${label}`, deviceKey, scopes: [product.scopes[0]],
    purpose: "Verify registry upgrade preserves existing authority.", nonce: token(`${label}:nonce`), state: token(`${label}:state`),
  }, NOW);
  const approval = signProductSessionApproval(source, request, { accountSecret, scopes: request.scopes, expiresAt: request.expiresAt }, NOW);
  return { request, approval };
}

function proof(session, route, body, label) {
  return encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session, {
    method: "POST", path: route, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token(label),
    issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
  }, deviceSecret));
}

async function serve(host) {
  const server = createServer(host.handler());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}

async function post(server, route, body, requestId, { origin, proofHeader } = {}) {
  const response = await fetch(server.base + route, {
    method: "POST", redirect: "error", headers: {
      "content-type": "application/json", "x-request-id": requestId,
      ...(origin ? { origin } : {}), ...(proofHeader ? { "x-ynx-product-session-proof-v2": proofHeader } : {}),
    }, body: canonicalJSON(body),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

async function login(server, source, productId, label) {
  const start = approved(source, productId, label);
  const challenge = await post(server, "/v2/product-sessions/challenge", start, `req_upgrade_challenge_${label}`, { origin: start.request.origin });
  assert.equal(challenge.status, 200, challenge.text);
  const completeBody = { ...start, completion: signProductSessionChallenge(challenge.body.result, deviceSecret) };
  const completeId = `req_upgrade_complete_${label}`;
  const complete = await post(server, "/v2/product-sessions/complete", completeBody, completeId, { origin: start.request.origin });
  assert.equal(complete.status, 200, complete.text);
  return { session: complete.body.result, completeBody, completeId, completeText: complete.text };
}

for (const version of [2, 3]) test(`v${version} durable Gateway retains pre-upgrade sessions, replay and revocation when reopening with 15 products`, async () => {
  // Independent historical semantic checksum is unchanged by later product edits.
  assert.equal(legacyRegistry.products.length, 12);
  assert.equal(sha(canonicalJSON(legacyRegistry)), "9ec9e02da841a1d0d4efe937af0a6f85cf221190eb5cc6ec337108994e6ca61e");
  assert.equal(registry.products.length, 15);
  const directory = mkdtempSync(join(tmpdir(), "ynx-registry-upgrade-")); chmodSync(directory, 0o700);
  const v2Path = join(directory, "v2.json"), statePath = version === 2 ? v2Path : join(directory, "v3.json");
  let sequence = 0, server;
  const options = path => ({ statePath: path, now: () => NOW, tokenFactory: () => token(`upgrade-challenge-${version}-${sequence++}`) });
  const Host = version === 2 ? ProductSessionGatewayNodeHost : ProductSessionControlNodeHost;
  try {
    new ProductSessionGatewayNodeHost(legacyRegistry, options(v2Path));
    if (version === 3) migrateProductSessionControlStateFileV2({
      sourcePath: v2Path, targetPath: statePath, backupPath: join(directory, "v2-backup.json"), expectedSourceDigest: sha(readFileSync(v2Path)),
    });
    const previous = new Host(legacyRegistry, options(statePath));
    server = await serve(previous);
    const active = await login(server, legacyRegistry, "social", "old_active");
    const revoked = await login(server, legacyRegistry, "card", "old_revoked");
    const introspectBody = { requiredScopes: active.session.scopes }, introspectRoute = "/v2/product-sessions/introspect";
    const usedProof = proof(active.session, introspectRoute, introspectBody, "upgrade-proof-consumed");
    assert.equal((await post(server, introspectRoute, introspectBody, "req_upgrade_used_proof_0001", { origin: active.session.origin, proofHeader: usedProof })).status, 200);
    const revokeRoute = "/v2/product-sessions/revoke";
    const revoke = await post(server, revokeRoute, {}, "req_upgrade_revoke_old_0001", { origin: revoked.session.origin, proofHeader: proof(revoked.session, revokeRoute, {}, "upgrade-revoke") });
    assert.equal(revoke.status, 200, revoke.text);
    // Keep an issued but unfinished challenge in the old authority as well.
    const unfinished = approved(legacyRegistry, "finance", "old_unfinished");
    const waiting = await post(server, "/v2/product-sessions/challenge", unfinished, "req_upgrade_unfinished_0001", { origin: unfinished.request.origin });
    assert.equal(waiting.status, 200, waiting.text);
    for (const productId of additions) {
      const candidate = approved(registry, productId, `before_${productId}`);
      const rejected = await post(server, "/v2/product-sessions/challenge", candidate, `req_upgrade_before_${productId}`, { origin: candidate.request.origin });
      assert.equal(rejected.status, 403); assert.equal(rejected.body.error.code, "ORIGIN_NOT_ALLOWED");
    }
    await server.close(); server = undefined;
    const beforeBytes = readFileSync(statePath), before = previous.snapshot();
    assert.equal(before.authority.sessions.length, 2);
    assert.ok(before.authority.revokedSessions.includes(revoked.session.sessionBinding));
    assert.ok(before.consumedProofs.length >= 2);
    assert.ok(before.idempotency.length >= 5);
    const upgraded = new Host(registry, options(statePath));
    assert.deepEqual(upgraded.snapshot(), before);
    assert.deepEqual(readFileSync(statePath), beforeBytes, "opening with an expanded registry must not rewrite old state");
    server = await serve(upgraded);
    const cached = await post(server, "/v2/product-sessions/complete", active.completeBody, active.completeId, { origin: active.session.origin });
    assert.equal(cached.status, 200); assert.equal(cached.text, active.completeText, "exact retry returns the original receipt, not a new session");
    const replayedProof = await post(server, introspectRoute, introspectBody, "req_upgrade_replay_proof_0001", { origin: active.session.origin, proofHeader: usedProof });
    assert.equal(replayedProof.status, 409); assert.equal(replayedProof.body.error.code, "REPLAY");
    const replayedComplete = await post(server, "/v2/product-sessions/complete", active.completeBody, "req_upgrade_replay_complete_1", { origin: active.session.origin });
    assert.equal(replayedComplete.status, 400); assert.equal(replayedComplete.body.error.code, "CHALLENGE_NOT_ISSUED");
    const activeCheck = await post(server, introspectRoute, introspectBody, "req_upgrade_fresh_proof_0001", { origin: active.session.origin, proofHeader: proof(active.session, introspectRoute, introspectBody, "upgrade-fresh") });
    assert.equal(activeCheck.status, 200); assert.equal(activeCheck.body.result.active, true);
    const revokedCheck = await post(server, introspectRoute, { requiredScopes: [] }, "req_upgrade_revoked_check_01", { origin: revoked.session.origin, proofHeader: proof(revoked.session, introspectRoute, { requiredScopes: [] }, "upgrade-revoked-check") });
    assert.equal(revokedCheck.status, 403); assert.equal(revokedCheck.body.error.code, "SESSION_REVOKED");
    const finished = await post(server, "/v2/product-sessions/complete", { ...unfinished, completion: signProductSessionChallenge(waiting.body.result, deviceSecret) }, "req_upgrade_finish_waiting_1", { origin: unfinished.request.origin });
    assert.equal(finished.status, 200, finished.text);
    for (const productId of additions) {
      const candidate = approved(registry, productId, `new_${productId}`), authorityBefore = upgraded.snapshot().authority;
      const wrongOrigin = await post(server, "/v2/product-sessions/challenge", candidate, `req_upgrade_wrong_origin_${productId}`, { origin: active.session.origin });
      assert.equal(wrongOrigin.status, 403); assert.equal(wrongOrigin.body.error.code, "ORIGIN_NOT_ALLOWED");
      for (const mutation of [{ clientId: "ynx-card-v1" }, { applicationId: "com.ynxweb4.card.web" }, { callback: candidate.request.origin + "/other/callback" }]) {
        const response = await post(server, "/v2/product-sessions/challenge", { ...candidate, request: { ...candidate.request, ...mutation } }, `req_upgrade_bad_${productId}_${Object.keys(mutation)[0]}`, { origin: candidate.request.origin });
        assert.equal(response.status, 400); assert.equal(response.body.error.code, "SESSION_BINDING_MISMATCH");
      }
      const widened = await post(server, "/v2/product-sessions/challenge", { ...candidate, request: { ...candidate.request, scopes: ["card:application:write"] } }, `req_upgrade_scope_${productId}`, { origin: candidate.request.origin });
      assert.equal(widened.status, 403); assert.equal(widened.body.error.code, "SCOPE_WIDENING");
      if (productId === "cloud") {
        const native = await post(server, "/v2/product-sessions/challenge", { ...candidate, request: { ...candidate.request, platform: "android" } }, "req_upgrade_cloud_native_001", { origin: candidate.request.origin });
        assert.equal(native.status, 400); assert.equal(native.body.error.code, "INVALID_PLATFORM");
      }
      assert.deepEqual(upgraded.snapshot().authority, authorityBefore);
      const added = await login(server, registry, productId, `accepted_${productId}`);
      assert.equal(added.session.productId, productId);
      assert.equal(added.session.origin, candidate.request.origin);
      assert.equal(added.session.callback, candidate.request.callback);
    }
    const after = upgraded.snapshot();
    assert.deepEqual(after.authority.sessions.filter(item => before.authority.sessions.some(old => old.sessionBinding === item.sessionBinding)), before.authority.sessions);
    assert.deepEqual(after.authority.revokedSessions, before.authority.revokedSessions);
    for (const key of ["consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges"]) {
      for (const old of before.authority[key]) assert.ok(after.authority[key].includes(old), `retains ${key}`);
    }
    assert.deepEqual(after.audit.slice(0, before.audit.length), before.audit);
    for (const consumed of before.consumedProofs) assert.ok(after.consumedProofs.includes(consumed), "retains every consumed proof despite sorted insertion");
    for (const entry of before.idempotency) assert.deepEqual(after.idempotency.find(item => item.requestId === entry.requestId), entry);
    await server.close(); server = undefined;
    assert.deepEqual(new Host(registry, options(statePath)).snapshot(), after, "all resulting history survives a second cold reopen");
  } finally {
    if (server) await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
