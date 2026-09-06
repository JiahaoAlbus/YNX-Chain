import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionProofV2, createProductSessionRequest,
  createProductSessionReturnURL, encodeProductSessionGatewayProofHeaderV2,
  httpBodyDigest, parseProductSessionRequest, parseProductSessionReturnURL,
  productPlatformBinding, ProductSessionGatewayHttpHandler,
  signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const now = new Date("2026-09-06T04:00:00.000Z");
const token = (value) => createHash("sha256").update(value).digest("base64url");
const deviceSecret = Buffer.alloc(32, 31);
const deviceKey = Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url");
const cases = [
  { productId: "creator-studio", clientId: "ynx-creator-studio-web-v1", applicationId: "com.ynxweb4.creator-studio.web", origin: "https://creator.ynxweb4.com", scopes: ["creator:account", "creator:publish", "creator:revenue"], requiredScopes: ["creator:publish"] },
  { productId: "video", clientId: "ynx-video-mobile-v1", applicationId: "com.ynxweb4.video.web", origin: "https://video.ynxweb4.com", scopes: ["video:account", "video:library", "video:playback"], requiredScopes: ["video:playback"] },
];

for (const expected of cases) {
  test(`${expected.productId} has the exact v2 Web identity and signed API introspection contract`, () => {
    const binding = productPlatformBinding(registry, expected.productId, "web");
    for (const field of ["clientId", "applicationId", "origin", "scopes"]) assert.deepEqual(binding[field], expected[field]);
    assert.equal(binding.callback, `${expected.origin}/wallet-auth/callback`);
    assert.equal(binding.bundleId, null);
    assert.equal(binding.packageId, null);
    const request = createProductSessionRequest(registry, { productId: expected.productId, platform: "web", deviceId: "creator-video-contract-device", deviceKey, scopes: expected.scopes, purpose: "Connect the selected YNX Wallet account.", nonce: token(`${expected.productId}-nonce`), state: token(`${expected.productId}-state`) }, now);
    for (const mutation of [
      { applicationId: `${expected.applicationId}.web` },
      { origin: "https://web4.ynxweb4.com" },
      { callback: "https://web4.ynxweb4.com/wallet-auth/callback" },
      { clientId: cases.find((item) => item.productId !== expected.productId).clientId },
    ]) assert.throws(() => parseProductSessionRequest(registry, { ...request, ...mutation }, now), { code: "SESSION_BINDING_MISMATCH" });

    const rejected = createProductSessionReturnURL(registry, request, { result: "rejected", reason: "user_rejected" }, now);
    assert.equal(parseProductSessionReturnURL(registry, request, rejected, now).status, "user-rejected");
    const approval = signProductSessionApproval(registry, request, { accountSecret: "1".padStart(64, "0"), scopes: request.scopes, expiresAt: "2026-09-06T04:03:00.000Z" }, now);
    const returned = createProductSessionReturnURL(registry, request, { result: "approved", approval }, now);
    assert.equal(new URL(returned).origin, expected.origin);
    assert.equal(parseProductSessionReturnURL(registry, request, returned, now).status, "ready");

    const gateway = new ProductSessionGatewayHttpHandler(registry, () => token(`${expected.productId}-challenge`));
    const dispatch = (suffix, path, body, proofHeader = null) => gateway.handle({ requestId: `req_contract_${expected.productId}_${suffix}`, method: "POST", path, contentType: "application/json", body: canonicalJSON(body), proofHeader, networkAvailable: true }, now);
    const challengeResponse = dispatch("challenge", "/v2/product-sessions/challenge", { request, approval });
    assert.equal(challengeResponse.status, 200, challengeResponse.body);
    const completion = signProductSessionChallenge(JSON.parse(challengeResponse.body).result, deviceSecret.toString("base64url"));
    const completed = dispatch("complete", "/v2/product-sessions/complete", { request, approval, completion });
    assert.equal(completed.status, 200, completed.body);
    const session = JSON.parse(completed.body).result;
    const body = { requiredScopes: expected.requiredScopes };
    const path = "/v2/product-sessions/introspect";
    const makeProof = (nonce, signedPath = path, signedBody = body) => encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session, { method: "POST", path: signedPath, bodyDigest: httpBodyDigest(canonicalJSON(signedBody)), nonce: token(`${expected.productId}-${nonce}`), issuedAt: now.toISOString(), expiresAt: "2026-09-06T04:00:30.000Z" }, deviceSecret.toString("base64url")));

    assert.notEqual(dispatch("wrong_path", path, body, makeProof("wrong-path", "/video/api/uploads")).status, 200);
    assert.notEqual(dispatch("wrong_body", path, body, makeProof("wrong-body", path, { requiredScopes: [expected.scopes[0]] })).status, 200);
    const proof = makeProof("introspect");
    const introspected = dispatch("introspect", path, body, proof);
    assert.equal(introspected.status, 200, introspected.body);
    const result = JSON.parse(introspected.body).result;
    assert.equal(result.active, true);
    assert.equal(result.session.productId, expected.productId);
    assert.equal(result.session.applicationId, expected.applicationId);
    assert.equal(result.session.account, approval.account);
    assert.equal(dispatch("replay", path, body, proof).status, 409);
    const otherScopes = { requiredScopes: cases.find((item) => item.productId !== expected.productId).requiredScopes };
    assert.equal(dispatch("scope_expansion", path, otherScopes, makeProof("scope-expansion", path, otherScopes)).status, 403);
  });
}
